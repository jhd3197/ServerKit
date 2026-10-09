"""
Environment Variable Management Service

Handles CRUD operations for application environment variables,
including encryption, history tracking, and .env file operations.
"""

import logging
import re
import uuid
from app import db
from app.models import Application, EnvironmentVariable, EnvironmentVariableHistory

logger = logging.getLogger(__name__)

# Sentinel so callers can distinguish "leave target_service unchanged" (default)
# from "clear it to all-services" (None) on update.
_UNSET = object()


def _new_batch_id():
    """Return the shared ledger id for one multi-variable operation."""
    return str(uuid.uuid4())


def _auto_capture(application_id, action, user_id):
    """Best-effort checkpoint immediately before an env mutation."""
    from app.services.restore_point_service import (
        auto_capture,
        auto_capture_is_suppressed,
    )

    if auto_capture_is_suppressed():
        return None
    application = Application.query_active().filter_by(id=application_id).first()
    return auto_capture(
        'env', str(application_id), action, actor=user_id,
        server_id=application.server_id if application else None,
    )


class EnvService:
    """Service for managing application environment variables."""

    # Valid environment variable key pattern
    KEY_PATTERN = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')

    @staticmethod
    def validate_key(key):
        """Validate environment variable key format."""
        if not key:
            return False, "Key cannot be empty"
        if len(key) > 255:
            return False, "Key cannot exceed 255 characters"
        if not EnvService.KEY_PATTERN.match(key):
            return False, "Key must start with a letter or underscore and contain only letters, numbers, and underscores"
        return True, None

    @staticmethod
    def get_env_vars(application_id, mask_secrets=False):
        """Get all environment variables for an application."""
        env_vars = EnvironmentVariable.query.filter_by(
            application_id=application_id
        ).order_by(EnvironmentVariable.key).all()

        return [ev.to_dict(include_value=True, mask_secrets=mask_secrets) for ev in env_vars]

    @staticmethod
    def get_effective_env(application_id):
        """Resolve the environment an app's container should actually receive.

        Merges, lowest → highest precedence:

            shared variable groups (workspace < project < environment < direct)
                < the app's own local environment variables

        So a key set both in a shared group and locally yields the LOCAL value
        (matching the "Set locally — local value applies" hint in the UI), and
        shared groups fill in everything the app doesn't define itself.

        Returns a plain ``{key: value}`` dict with secrets DECRYPTED — this is
        the value injected into the running container, so callers must treat it
        as sensitive. Shared resolution is best-effort: if it fails, the app's
        local env vars are still returned so a deploy is never blocked.
        """
        app = Application.query_active().filter_by(id=application_id).first()
        if not app:
            return {}

        merged = {}

        # 1) Shared variable groups — the base layer (lowest precedence).
        try:
            from app.services.shared_resource_service import SharedResourceService
            context = {
                # scope_id is stored as a string when groups are created, so
                # coerce the app's numeric ids to match on lookup.
                'workspace_id': str(app.workspace_id) if app.workspace_id is not None else None,
                'project_id': str(app.project_id) if app.project_id is not None else None,
                'environment_id': str(app.environment_id) if app.environment_id is not None else None,
            }
            resolved = SharedResourceService.resolve_hierarchical(
                'application', application_id, context=context,
                mask_secrets=False, interpolate=True,
            )
            for entry in resolved or []:
                key = entry.get('key')
                if key:
                    merged[key] = entry.get('value')
        except Exception as e:  # best-effort — never block a deploy on shared vars
            logger.warning('Shared variable resolution failed for app %s: %s', application_id, e)

        # 2) Local env vars — the override layer (highest precedence wins).
        for ev in EnvironmentVariable.query.filter_by(application_id=application_id).all():
            merged[ev.key] = EnvService._resolve_var_value(app, ev)

        return merged

    @staticmethod
    def _resolve_var_value(app, ev):
        """Decrypt a plain value, or resolve a manifest reference at injection."""
        if not ev.value_from:
            return ev.value
        try:
            from app.services.env_reference_service import EnvReferenceResolver
            value, error = EnvReferenceResolver.resolve(app, ev.get_reference())
            if error:
                logger.warning('Env reference %s on app %s unresolved: %s',
                               ev.key, ev.application_id, error)
                return ''
            return value
        except Exception as exc:  # best-effort — never block a deploy
            logger.warning('Env reference %s resolution failed: %s', ev.key, exc)
            return ''

    @staticmethod
    def set_env_reference(application_id, key, reference, user_id=None,
                          target_service=_UNSET, description=_UNSET,
                          batch_id=None):
        """Create/update a variable that resolves from a reference (manifest).

        ``reference`` is a dict e.g. {'kind':'secret','secret':'name'} or
        {'kind':'service','service':'db','property':'connectionString'}. The real
        value is never stored — encrypted_value holds a placeholder.
        """
        valid, error = EnvService.validate_key(key)
        if not valid:
            return None, False, error
        app = Application.query_active().filter_by(id=application_id).first()
        if not app:
            return None, False, 'Service not found'

        norm_target = None if target_service in ('', _UNSET) else target_service
        existing = EnvService.get_env_var(application_id, key)
        _auto_capture(application_id, 'env.set_env_reference', user_id)
        if existing:
            old_value = '<reference>' if existing.get_reference() else existing.value
            existing.set_reference(reference)
            existing.is_secret = True
            existing.value = ''  # clear any stored literal
            if target_service is not _UNSET:
                existing.target_service = norm_target
            if description is not _UNSET:
                existing.description = description
            EnvironmentVariableHistory.record_change(
                existing, 'updated', old_value=old_value,
                new_value='<reference>', user_id=user_id, batch_id=batch_id,
            )
            db.session.commit()
            return existing, False, None

        env_var = EnvironmentVariable(
            application_id=application_id, key=key, is_secret=True,
            target_service=norm_target, created_by=user_id,
        )
        if description is not _UNSET:
            env_var.description = description
        env_var.set_reference(reference)
        env_var.value = ''
        db.session.add(env_var)
        db.session.flush()
        EnvironmentVariableHistory.record_change(
            env_var, 'created', new_value='<reference>', user_id=user_id,
            batch_id=batch_id,
        )
        db.session.commit()
        return env_var, True, None

    @staticmethod
    def get_effective_env_for_services(application_id, service_names):
        """Per-service effective env for a compose app.

        For each service in ``service_names`` returns the merged ``{key: value}``
        it should receive: variables targeting all services (``target_service``
        NULL) plus variables targeting that specific service, with the app's own
        local env vars overriding shared variable groups. Variables targeted at a
        *different* service are excluded for that service.

        Returns ``{service_name: {key: value}}`` (decrypted). Best-effort — shared
        resolution failures fall back to local vars and never block a deploy.
        """
        app = Application.query_active().filter_by(id=application_id).first()
        if not app or not service_names:
            return {}

        context = {
            'workspace_id': str(app.workspace_id) if app.workspace_id is not None else None,
            'project_id': str(app.project_id) if app.project_id is not None else None,
            'environment_id': str(app.environment_id) if app.environment_id is not None else None,
        }
        local_vars = EnvironmentVariable.query.filter_by(application_id=application_id).all()

        result = {}
        for svc in service_names:
            env = {}
            # Shared groups applicable to this service (NULL-target + this svc).
            try:
                from app.services.shared_resource_service import SharedResourceService
                resolved = SharedResourceService.resolve_hierarchical(
                    'application', application_id, context=context,
                    mask_secrets=False, interpolate=True, service=svc,
                )
                for entry in resolved or []:
                    key = entry.get('key')
                    if key:
                        env[key] = entry.get('value')
            except Exception as e:  # best-effort
                logger.warning('Shared resolution failed for app %s svc %s: %s',
                               application_id, svc, e)
            # Local vars override; include all-services + this-service targets.
            for ev in local_vars:
                tgt = ev.target_service
                if tgt in (None, '') or tgt == svc:
                    env[ev.key] = EnvService._resolve_var_value(app, ev)
            result[svc] = env
        return result

    @staticmethod
    def get_env_var(application_id, key):
        """Get a single environment variable by key."""
        return EnvironmentVariable.query.filter_by(
            application_id=application_id,
            key=key
        ).first()

    @staticmethod
    def get_env_var_by_id(env_var_id):
        """Get a single environment variable by ID."""
        return EnvironmentVariable.query.get(env_var_id)

    @staticmethod
    def set_env_var(application_id, key, value, is_secret=False, description=None,
                    user_id=None, target_service=_UNSET, batch_id=None):
        """
        Set an environment variable (create or update).
        Returns (env_var, created, error)

        ``target_service`` scopes the var to one compose service (None = all
        services). Left unset on update, the existing target is preserved.
        """
        # Validate key
        valid, error = EnvService.validate_key(key)
        if not valid:
            return None, False, error

        # Normalize an empty target to "all services" (None).
        norm_target = None if target_service in ('', _UNSET) else target_service

        # Check if application exists
        app = Application.query_active().filter_by(id=application_id).first()
        if not app:
            return None, False, "Service not found"

        # Check if key already exists
        existing = EnvService.get_env_var(application_id, key)
        _auto_capture(application_id, 'env.set_env_var', user_id)

        if existing:
            # Update existing
            old_value = '<reference>' if existing.get_reference() else existing.value
            # A literal write intentionally replaces a manifest reference.
            # Restore code skips masked literals before reaching this door, so
            # a redaction sentinel can never accidentally clear a reference.
            existing.set_reference(None)
            existing.value = value
            existing.is_secret = is_secret
            if description is not None:
                existing.description = description
            if target_service is not _UNSET:
                existing.target_service = norm_target

            # Record history
            EnvironmentVariableHistory.record_change(
                existing, 'updated', old_value=old_value, new_value=value,
                user_id=user_id, batch_id=batch_id,
            )

            db.session.commit()
            return existing, False, None
        else:
            # Create new
            env_var = EnvironmentVariable(
                application_id=application_id,
                key=key,
                is_secret=is_secret,
                description=description,
                target_service=norm_target,
                created_by=user_id
            )
            env_var.value = value

            db.session.add(env_var)
            db.session.flush()  # Get ID before commit

            # Record history
            EnvironmentVariableHistory.record_change(
                env_var, 'created', new_value=value, user_id=user_id,
                batch_id=batch_id,
            )

            db.session.commit()
            return env_var, True, None

    @staticmethod
    def update_env_var(application_id, key, *, value=_UNSET,
                       is_secret=_UNSET, description=_UNSET,
                       target_service=_UNSET, user_id=None, batch_id=None):
        """Update only supplied fields on an existing environment variable.

        This is the service-layer door used by the PUT controller.  Keeping
        partial-update semantics here prevents API code from mutating ORM rows
        directly and ensures the restore-point hook cannot be bypassed.
        """
        existing = EnvService.get_env_var(application_id, key)
        if not existing:
            return None, 'Environment variable not found'

        if all(value is _UNSET for value in (
                value, is_secret, description, target_service)):
            return existing, None

        _auto_capture(application_id, 'env.update_env_var', user_id)

        old_value = '<reference>' if existing.get_reference() else existing.value
        if value is not _UNSET:
            existing.set_reference(None)
            existing.value = value
        if is_secret is not _UNSET:
            existing.is_secret = bool(is_secret)
        if description is not _UNSET:
            existing.description = description
        if target_service is not _UNSET:
            existing.target_service = target_service or None

        new_value = '<reference>' if existing.get_reference() else existing.value
        EnvironmentVariableHistory.record_change(
            existing, 'updated', old_value=old_value, new_value=new_value,
            user_id=user_id, batch_id=batch_id,
        )
        db.session.commit()
        return existing, None

    @staticmethod
    def delete_env_var(application_id, key, user_id=None, batch_id=None):
        """Delete an environment variable. Returns (success, error)."""
        env_var = EnvService.get_env_var(application_id, key)

        if not env_var:
            return False, "Environment variable not found"

        _auto_capture(application_id, 'env.delete_env_var', user_id)
        old_value = '<reference>' if env_var.get_reference() else env_var.value

        # Record history before deletion
        EnvironmentVariableHistory.record_change(
            env_var, 'deleted', old_value=old_value, user_id=user_id,
            batch_id=batch_id,
        )

        db.session.delete(env_var)
        db.session.commit()

        return True, None

    @staticmethod
    def delete_env_var_by_id(env_var_id, user_id=None, batch_id=None):
        """Delete an environment variable by ID. Returns (success, error)."""
        env_var = EnvironmentVariable.query.get(env_var_id)

        if not env_var:
            return False, "Environment variable not found"

        _auto_capture(
            env_var.application_id, 'env.delete_env_var_by_id', user_id,
        )
        old_value = '<reference>' if env_var.get_reference() else env_var.value

        # Record history before deletion
        EnvironmentVariableHistory.record_change(
            env_var, 'deleted', old_value=old_value, user_id=user_id,
            batch_id=batch_id,
        )

        db.session.delete(env_var)
        db.session.commit()

        return True, None

    @staticmethod
    def bulk_set_env_vars(application_id, env_vars_dict, user_id=None,
                          batch_id=None):
        """
        Set multiple environment variables at once.
        env_vars_dict: {key: value} or {key: {value, is_secret, description}}
        Returns (count, errors)
        """
        count = 0
        errors = []
        batch_id = batch_id or _new_batch_id()

        _auto_capture(application_id, 'env.bulk_set_env_vars', user_id)
        from app.services.restore_point_service import suppress_auto_capture

        with suppress_auto_capture():
            for key, val in env_vars_dict.items():
                if isinstance(val, dict):
                    value = val.get('value', '')
                    is_secret = val.get('is_secret', False)
                    description = val.get('description')
                    target_service = val.get('target_service', _UNSET)
                else:
                    value = val
                    is_secret = False
                    description = None
                    target_service = _UNSET

                env_var, created, error = EnvService.set_env_var(
                    application_id, key, value, is_secret, description,
                    user_id, target_service=target_service,
                    batch_id=batch_id,
                )

                if error:
                    errors.append(f"{key}: {error}")
                else:
                    count += 1

        return count, errors

    @staticmethod
    def _unescape_double_quoted(value):
        """Reverse the escaping export_to_env_format applies inside double
        quotes: \\\\ -> \\, \\" -> ", \\n -> newline. Unknown sequences stay
        as written so hand-authored values like C:\\path are not mangled."""
        return re.sub(
            r'\\([\\"n])',
            lambda m: '\n' if m.group(1) == 'n' else m.group(1),
            value)

    @staticmethod
    def parse_env_file(content):
        """
        Parse .env file content into a dictionary.
        Handles comments, quotes, and multiline values.
        Returns (dict, errors)
        """
        env_vars = {}
        errors = []
        lines = content.split('\n')
        current_key = None
        current_value = None
        in_multiline = False

        for line_num, line in enumerate(lines, 1):
            # Skip empty lines and comments (unless in multiline)
            if not in_multiline:
                stripped = line.strip()
                if not stripped or stripped.startswith('#'):
                    continue

                # Check for key=value
                if '=' not in line:
                    errors.append(f"Line {line_num}: Invalid format (missing '=')")
                    continue

                # Split on first =
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip()

                # Validate key
                valid, error = EnvService.validate_key(key)
                if not valid:
                    errors.append(f"Line {line_num}: {error}")
                    continue

                # Check for quoted values
                if value.startswith('"') and not value.endswith('"'):
                    # Start of multiline
                    in_multiline = True
                    current_key = key
                    current_value = value[1:]  # Remove opening quote
                elif value.startswith('"') and value.endswith('"') and len(value) > 1:
                    # Quoted value (single line). Decode the escapes
                    # export_to_env_format writes (\\, \", \n) so an
                    # export → import cycle is lossless; any other
                    # backslash sequence is left untouched.
                    env_vars[key] = EnvService._unescape_double_quoted(value[1:-1])
                elif value.startswith("'") and value.endswith("'") and len(value) > 1:
                    # Single-quoted value
                    env_vars[key] = value[1:-1]
                else:
                    # Unquoted value
                    env_vars[key] = value
            else:
                # Continue multiline value
                if line.rstrip().endswith('"'):
                    # End of multiline
                    current_value += '\n' + line.rstrip()[:-1]
                    env_vars[current_key] = current_value
                    in_multiline = False
                    current_key = None
                    current_value = None
                else:
                    current_value += '\n' + line

        if in_multiline:
            errors.append("Unterminated quoted value")

        return env_vars, errors

    @staticmethod
    def export_to_env_format(application_id, include_secrets=True):
        """
        Export environment variables to .env file format.
        Returns string content.
        """
        env_vars = EnvironmentVariable.query.filter_by(
            application_id=application_id
        ).order_by(EnvironmentVariable.key).all()

        lines = []
        lines.append("# Environment variables")
        lines.append(f"# Exported from ServerKit")
        lines.append("")

        for ev in env_vars:
            if ev.is_secret and not include_secrets:
                lines.append(f"# {ev.key}=<secret>")
            else:
                value = ev.value or ''
                # Quote values that contain special characters
                if any(c in value for c in [' ', '"', "'", '\n', '#', '$']):
                    # Escape quotes/backslashes and encode newlines so the
                    # value stays on one line — parse_env_file reverses
                    # exactly these three escapes on import.
                    value = (value.replace('\\', '\\\\')
                                  .replace('"', '\\"')
                                  .replace('\n', '\\n'))
                    lines.append(f'{ev.key}="{value}"')
                else:
                    lines.append(f"{ev.key}={value}")

            # Add description as comment if present. Whitespace-collapsed so
            # user text cannot break out of the comment and inject KEY=value
            # lines into the re-import (same hardening as the cron marker).
            if ev.description:
                clean_desc = re.sub(r'\s+', ' ', str(ev.description)).strip()
                if clean_desc:
                    lines[-1] = f"# {clean_desc}\n" + lines[-1]

        return '\n'.join(lines)

    @staticmethod
    def get_history(application_id, limit=50):
        """Get change history for an application's environment variables."""
        history = EnvironmentVariableHistory.query.filter_by(
            application_id=application_id
        ).order_by(EnvironmentVariableHistory.changed_at.desc()).limit(limit).all()

        return [h.to_dict() for h in history]

    @staticmethod
    def get_env_dict(application_id):
        """Get environment variables as a simple key:value dictionary."""
        env_vars = EnvironmentVariable.query.filter_by(
            application_id=application_id
        ).all()

        return {ev.key: ev.value for ev in env_vars}

    @staticmethod
    def clear_all(application_id, user_id=None, batch_id=None):
        """Delete all environment variables for an application."""
        env_vars = EnvironmentVariable.query.filter_by(
            application_id=application_id
        ).all()

        if env_vars:
            _auto_capture(application_id, 'env.clear_all', user_id)
        batch_id = batch_id or _new_batch_id()

        count = 0
        for ev in env_vars:
            old_value = '<reference>' if ev.get_reference() else ev.value
            EnvironmentVariableHistory.record_change(
                ev, 'deleted', old_value=old_value, user_id=user_id,
                batch_id=batch_id,
            )
            db.session.delete(ev)
            count += 1

        db.session.commit()
        return count
