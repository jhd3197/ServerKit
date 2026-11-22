"""Managed-database persistence — the thin, durable layer under the databases
ServerKit provisions.

The Databases feature is otherwise 100% live introspection (``database_service``
runs ``SHOW DATABASES`` / ``SELECT datname …``). This service **adds** a tracked
``managed_databases`` row beside that introspection (it does not replace it) so
backups, connection strings, and the UI have durable state to hang off. It is
NOT a DBaaS: no pooling, replicas, scaling, or failover.

Headline payoff: a ``BackupPolicy`` targeting a managed database gets a **real
FK** (``target_id = managed_databases.id`` + a ``managed`` marker in
``target_meta_json``) instead of an arbitrary int, while legacy JSON-descriptor
policies keep working unchanged.
"""
import logging

from app import db
from app.models.managed_database import ManagedDatabase
from app.services.database_service import DatabaseService

logger = logging.getLogger(__name__)

# db_type strings understood by the backup executor / database_service.
_ENGINE_TO_DBTYPE = {'mysql': 'mysql', 'postgresql': 'postgresql', 'mongodb': 'mongodb'}


class ManagedDatabaseService:
    """CRUD + connection-string + backup-wiring for tracked databases."""

    # ── persistence ──
    @classmethod
    def _upsert(cls, engine, name, host='localhost', *, origin, port=None,
                host_kind='host', container_ref=None, owner_application_id=None,
                admin_username=None, admin_secret=None, workspace_id=None):
        """Find-or-create a row keyed by (engine, host, name), refreshing the
        mutable descriptors. ``origin`` is only set on creation — adopting a row
        ServerKit already provisioned never downgrades its origin."""
        engine = (engine or '').strip().lower()
        host = (host or 'localhost').strip() or 'localhost'
        managed = ManagedDatabase.query_active().filter_by(engine=engine, host=host, name=name).first()
        created = managed is None
        if created:
            managed = ManagedDatabase(engine=engine, name=name, host=host, origin=origin)
            db.session.add(managed)

        if port is not None:
            managed.port = port
        if host_kind:
            managed.host_kind = host_kind
        if container_ref is not None:
            managed.container_ref = container_ref
        if owner_application_id is not None:
            managed.owner_application_id = owner_application_id
        if admin_username is not None:
            managed.admin_username = admin_username
        if admin_secret:
            managed.admin_secret = admin_secret
        if workspace_id is not None:
            managed.workspace_id = workspace_id

        db.session.commit()
        return managed

    @classmethod
    def record_provisioned(cls, engine, name, **kwargs):
        """Persist a DB ServerKit just created (``origin='provisioned'``).
        Additive: called after the SQL provisioning succeeds, never blocks it."""
        return cls._upsert(engine, name, origin='provisioned', **kwargs)

    @classmethod
    def adopt(cls, engine, host, name, **kwargs):
        """Track a live-discovered database (``origin='adopted'``). Idempotent —
        adopting an already-tracked DB just refreshes its descriptors."""
        return cls._upsert(engine, name, host=host, origin='adopted', **kwargs)

    @classmethod
    def list(cls, workspace_id=None):
        q = ManagedDatabase.query_active()
        if workspace_id is not None:
            q = q.filter(db.or_(
                ManagedDatabase.workspace_id == workspace_id,
                ManagedDatabase.workspace_id.is_(None),
            ))
        return q.order_by(ManagedDatabase.created_at.desc()).all()

    @classmethod
    def get(cls, managed_id):
        if not managed_id:
            return None
        return ManagedDatabase.query_active().filter_by(id=managed_id).first()

    @classmethod
    def delete(cls, managed, drop=False, user_id=None):
        """Delete a managed database (semantics).

        - ``drop=False``: SOFT delete — the row tombstones into the Recycle
          Bin. The actual database on the server is untouched and any managed
          BackupPolicy keeps running, so a restore brings everything back
          intact.
        - ``drop=True``: the operator explicitly asked to DROP the data —
          stays the immediate destructive path (host engines only; policy
          removed, row hard-deleted, nothing to restore).
        """
        if drop:
            if managed.host_kind == 'host':
                if managed.engine == 'mysql':
                    DatabaseService.mysql_drop_database(managed.name)
                elif managed.engine == 'postgresql':
                    DatabaseService.pg_drop_database(managed.name)
                # mongodb drop is out of scope (read-first); untrack only.
            cls._delete_managed_policy(managed)
            db.session.delete(managed)
            db.session.commit()
            return

        managed.soft_delete(user_id)
        db.session.commit()

    # ── connection string ──
    @classmethod
    def build_connection_uri(cls, managed, user=None, reveal=False):
        """The real DB connection URI the codebase otherwise lacks:
        ``mysql://user:***@host:port/name`` (password masked unless ``reveal``)."""
        scheme = ManagedDatabase.URI_SCHEMES.get(managed.engine, managed.engine)
        username = user or managed.admin_username
        password = None
        if managed.admin_secret_encrypted:
            password = managed.admin_secret if reveal else '***'

        userinfo = ''
        if username:
            userinfo = username
            if password is not None:
                userinfo += f':{password}'
            userinfo += '@'

        port = managed.effective_port()
        hostport = managed.host + (f':{port}' if port else '')
        return f'{scheme}://{userinfo}{hostport}/{managed.name}'

    # ── live reconciliation ──
    @classmethod
    def sync_state(cls, managed):
        """Best-effort reconcile against live state. Returns
        ``{'exists': bool|None, 'drifted': bool}``. ``exists=None`` means we
        couldn't determine it (docker/mongo) — not treated as drift."""
        exists = None
        try:
            if managed.host_kind == 'host' and managed.engine == 'mysql':
                names = [d.get('name') for d in DatabaseService.mysql_list_databases()]
                exists = managed.name in names
            elif managed.host_kind == 'host' and managed.engine == 'postgresql':
                names = [d.get('name') for d in DatabaseService.pg_list_databases()]
                exists = managed.name in names
        except Exception as e:  # pragma: no cover - defensive
            logger.debug('sync_state failed for %s: %s', managed.name, e)
            exists = None
        return {'exists': exists, 'drifted': exists is False}

    # ── backup wiring (the headline) ──
    @classmethod
    def backup_descriptor(cls, managed):
        """The ``db_config`` the backup executor expects, resolved from the row."""
        return {
            'db_type': _ENGINE_TO_DBTYPE.get(managed.engine, managed.engine),
            'db_name': managed.name,
            'user': managed.admin_username,
            'password': managed.admin_secret or None,
            'host': managed.host,
        }

    @classmethod
    def protect(cls, managed, fields=None, allow_host_commands=False):
        """Create/refresh a BackupPolicy for this managed DB with a **real FK**
        (``target_id = managed.id``) plus a ``managed`` marker so the executor
        resolves the descriptor from the row (not a free-floating JSON blob)."""
        from app.services.backup_policy_service import BackupPolicyService
        policy = BackupPolicyService.get_or_create_policy(
            target_type='database',
            target_id=managed.id,
            target_subtype=managed.engine,
            target_meta={'managed': True, 'db_name': managed.name,
                         'db_type': _ENGINE_TO_DBTYPE.get(managed.engine, managed.engine),
                         'host': managed.host},
        )
        if fields:
            policy = BackupPolicyService.update_policy(
                policy, fields, allow_host_commands=allow_host_commands)
        return policy

    @staticmethod
    def _delete_managed_policy(managed):
        """Remove the managed BackupPolicy for a DB being untracked, if any."""
        from app.models.backup_policy import BackupPolicy
        policy = BackupPolicy.query.filter_by(target_type='database', target_id=managed.id).first()
        if policy is not None and policy.get_target_meta().get('managed'):
            db.session.delete(policy)
