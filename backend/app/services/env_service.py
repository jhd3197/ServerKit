"""
Environment Variable Management Service

Handles CRUD operations for application environment variables,
including encryption, history tracking, and .env file operations.
"""

import re
from app import db
from app.models import Application, EnvironmentVariable, EnvironmentVariableHistory


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
    def set_env_var(application_id, key, value, is_secret=False, description=None, user_id=None):
        """
        Set an environment variable (create or update).
        Returns (env_var, created, error)
        """
        # Validate key
        valid, error = EnvService.validate_key(key)
        if not valid:
            return None, False, error

        # Check if application exists
        app = Application.query.get(application_id)
        if not app:
            return None, False, "Application not found"

        # Check if key already exists
        existing = EnvService.get_env_var(application_id, key)

        if existing:
            # Update existing
            old_value = existing.value
            existing.value = value
            existing.is_secret = is_secret
            if description is not None:
                existing.description = description

            # Record history
            EnvironmentVariableHistory.record_change(
                existing, 'updated', old_value=old_value, new_value=value, user_id=user_id
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
                created_by=user_id
            )
            env_var.value = value

            db.session.add(env_var)
            db.session.flush()  # Get ID before commit

            # Record history
            EnvironmentVariableHistory.record_change(
                env_var, 'created', new_value=value, user_id=user_id
            )

            db.session.commit()
            return env_var, True, None

    @staticmethod
    def delete_env_var(application_id, key, user_id=None):
        """Delete an environment variable. Returns (success, error)."""
        env_var = EnvService.get_env_var(application_id, key)

        if not env_var:
            return False, "Environment variable not found"

        old_value = env_var.value

        # Record history before deletion
        EnvironmentVariableHistory.record_change(
            env_var, 'deleted', old_value=old_value, user_id=user_id
        )

        db.session.delete(env_var)
        db.session.commit()

        return True, None

    @staticmethod
    def delete_env_var_by_id(env_var_id, user_id=None):
        """Delete an environment variable by ID. Returns (success, error)."""
        env_var = EnvironmentVariable.query.get(env_var_id)

        if not env_var:
            return False, "Environment variable not found"

        old_value = env_var.value

        # Record history before deletion
        EnvironmentVariableHistory.record_change(
            env_var, 'deleted', old_value=old_value, user_id=user_id
        )

        db.session.delete(env_var)
        db.session.commit()

        return True, None

    @staticmethod
    def bulk_set_env_vars(application_id, env_vars_dict, user_id=None):
        """
        Set multiple environment variables at once.
        env_vars_dict: {key: value} or {key: {value, is_secret, description}}
        Returns (count, errors)
        """
        count = 0
        errors = []

        for key, val in env_vars_dict.items():
            if isinstance(val, dict):
                value = val.get('value', '')
                is_secret = val.get('is_secret', False)
                description = val.get('description')
            else:
                value = val
                is_secret = False
                description = None

            env_var, created, error = EnvService.set_env_var(
                application_id, key, value, is_secret, description, user_id
            )

            if error:
                errors.append(f"{key}: {error}")
            else:
                count += 1

        return count, errors

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
                    # Quoted value (single line)
                    env_vars[key] = value[1:-1]
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
                value = ev.value
                # Quote values that contain special characters
                if any(c in value for c in [' ', '"', "'", '\n', '#', '$']):
                    # Escape existing quotes and wrap in quotes
                    value = value.replace('\\', '\\\\').replace('"', '\\"')
                    lines.append(f'{ev.key}="{value}"')
                else:
                    lines.append(f"{ev.key}={value}")

            # Add description as comment if present
            if ev.description:
                lines[-1] = f"# {ev.description}\n" + lines[-1]

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
    def clear_all(application_id, user_id=None):
        """Delete all environment variables for an application."""
        env_vars = EnvironmentVariable.query.filter_by(
            application_id=application_id
        ).all()

        count = 0
        for ev in env_vars:
            EnvironmentVariableHistory.record_change(
                ev, 'deleted', old_value=ev.value, user_id=user_id
            )
            db.session.delete(ev)
            count += 1

        db.session.commit()
        return count
