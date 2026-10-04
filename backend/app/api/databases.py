# Bucket: PER-APP (plan 29 #9). The per-app docker DB read (/docker/app/<app_id>)
# gates on can_access_app; the bare-container docker routes have no app linkage
# and are system-level admin-only, matching their kill/drop siblings.
# The host-level raw routes (engine lists, tables/structure, users/privileges,
# backups list, and the raw query consoles) likewise have no app linkage and are
# admin-only (Decision 7) — per-app managed-database flows go through the
# /docker/app/<app_id> and /managed surfaces instead.
import logging

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, Application
from app.services.database_service import DatabaseService
from app.services.db_process_service import DbProcessService
from app.services.managed_database_service import ManagedDatabaseService
from app.middleware.rbac import admin_required, get_current_user, require_admin_user
from app.services.resource_grant_service import ResourceGrantService
from app.exceptions import field_required, not_found, permission_denied

logger = logging.getLogger(__name__)

databases_bp = Blueprint('databases', __name__)


def _persist_provisioned(engine, name, result, data):
    """Track a just-provisioned database as a managed resource. Best-effort and
    additive — a persistence failure never fails the provisioning that succeeded."""
    try:
        from app.services.workspace_service import WorkspaceService
        user = get_current_user()
        ws_id = WorkspaceService.resolve_workspace_id(
            user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
        ManagedDatabaseService.record_provisioned(
            engine, name,
            admin_username=result.get('user'),
            admin_secret=result.get('password'),
            owner_application_id=(data or {}).get('application_id'),
            workspace_id=ws_id,
        )
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning('Failed to track provisioned database %s/%s: %s', engine, name, exc)


# ==================== STATUS ====================

@databases_bp.route('/status', methods=['GET'])
@jwt_required()
def get_status():
    """Get database servers status."""
    status = DatabaseService.get_status()
    return jsonify(status), 200


# ==================== MYSQL DATABASES ====================

@databases_bp.route('/mysql', methods=['GET'])
@admin_required
def list_mysql_databases():
    """List MySQL databases.

    For security, root_password should be passed via X-DB-Password header, not query params.
    """
    # Read root_password from header for security (not exposed in URL/logs)
    root_password = request.headers.get('X-DB-Password')
    databases = DatabaseService.mysql_list_databases(root_password)
    return jsonify({'databases': databases}), 200


@databases_bp.route('/mysql', methods=['POST'])
@admin_required
def create_mysql_database():
    """Create a MySQL database."""
    data = request.get_json()

    if not data or 'name' not in data:
        raise field_required('name')

    result = DatabaseService.mysql_create_database(
        data['name'],
        data.get('charset', 'utf8mb4'),
        data.get('collation', 'utf8mb4_unicode_ci'),
        data.get('root_password')
    )

    if result['success']:
        # Optionally create user with same name
        if data.get('create_user'):
            password = data.get('user_password') or DatabaseService.generate_password()
            DatabaseService.mysql_create_user(
                data['name'],
                password,
                data.get('host', 'localhost'),
                data.get('root_password')
            )
            DatabaseService.mysql_grant_privileges(
                data['name'],
                data['name'],
                'ALL',
                data.get('host', 'localhost'),
                data.get('root_password')
            )
            result['user'] = data['name']
            result['password'] = password

        _persist_provisioned('mysql', data['name'], result, data)

    return jsonify(result), 201 if result['success'] else 400


@databases_bp.route('/mysql/<name>', methods=['DELETE'])
@admin_required
def drop_mysql_database(name):
    """Drop a MySQL database."""
    data = request.get_json() or {}
    result = DatabaseService.mysql_drop_database(name, data.get('root_password'))
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/mysql/<name>/tables', methods=['GET'])
@admin_required
def get_mysql_tables(name):
    """Get tables in a MySQL database.

    For security, root_password should be passed via X-DB-Password header.
    """
    root_password = request.headers.get('X-DB-Password')
    tables = DatabaseService.mysql_get_tables(name, root_password)
    return jsonify({'tables': tables}), 200


@databases_bp.route('/mysql/<name>/backup', methods=['POST'])
@admin_required
def backup_mysql_database(name):
    """Backup a MySQL database."""
    data = request.get_json() or {}
    result = DatabaseService.mysql_backup(name, root_password=data.get('root_password'))
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/mysql/<name>/restore', methods=['POST'])
@admin_required
def restore_mysql_database(name):
    """Restore a MySQL database from backup."""
    data = request.get_json()

    if not data or 'backup_path' not in data:
        raise field_required('backup_path')

    result = DatabaseService.mysql_restore(
        name,
        data['backup_path'],
        data.get('root_password')
    )
    return jsonify(result), 200 if result['success'] else 400


# ==================== MYSQL USERS ====================

@databases_bp.route('/mysql/users', methods=['GET'])
@admin_required
def list_mysql_users():
    """List MySQL users.

    For security, root_password should be passed via X-DB-Password header.
    """
    root_password = request.headers.get('X-DB-Password')
    users = DatabaseService.mysql_list_users(root_password)
    return jsonify({'users': users}), 200


@databases_bp.route('/mysql/users', methods=['POST'])
@admin_required
def create_mysql_user():
    """Create a MySQL user."""
    data = request.get_json()

    if not data or 'username' not in data:
        raise field_required('username')

    password = data.get('password') or DatabaseService.generate_password()

    result = DatabaseService.mysql_create_user(
        data['username'],
        password,
        data.get('host', 'localhost'),
        data.get('root_password')
    )

    if result['success']:
        result['password'] = password

        # Grant privileges if database specified
        if data.get('database'):
            DatabaseService.mysql_grant_privileges(
                data['username'],
                data['database'],
                data.get('privileges', 'ALL'),
                data.get('host', 'localhost'),
                data.get('root_password')
            )

    return jsonify(result), 201 if result['success'] else 400


@databases_bp.route('/mysql/users/<username>', methods=['DELETE'])
@admin_required
def drop_mysql_user(username):
    """Drop a MySQL user."""
    data = request.get_json() or {}
    host = data.get('host', 'localhost')
    result = DatabaseService.mysql_drop_user(username, host, data.get('root_password'))
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/mysql/users/<username>/privileges', methods=['GET'])
@admin_required
def get_mysql_user_privileges(username):
    """Get privileges for a MySQL user.

    For security, root_password should be passed via X-DB-Password header.
    """
    host = request.args.get('host', 'localhost')
    root_password = request.headers.get('X-DB-Password')
    privileges = DatabaseService.mysql_get_user_privileges(username, host, root_password)
    return jsonify({'privileges': privileges}), 200


@databases_bp.route('/mysql/users/<username>/grant', methods=['POST'])
@admin_required
def grant_mysql_privileges(username):
    """Grant privileges to a MySQL user."""
    data = request.get_json()

    if not data or 'database' not in data:
        raise field_required('database')

    result = DatabaseService.mysql_grant_privileges(
        username,
        data['database'],
        data.get('privileges', 'ALL'),
        data.get('host', 'localhost'),
        data.get('root_password')
    )
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/mysql/users/<username>/revoke', methods=['POST'])
@admin_required
def revoke_mysql_privileges(username):
    """Revoke privileges from a MySQL user."""
    data = request.get_json()

    if not data or 'database' not in data:
        raise field_required('database')

    result = DatabaseService.mysql_revoke_privileges(
        username,
        data['database'],
        data.get('privileges', 'ALL'),
        data.get('host', 'localhost'),
        data.get('root_password')
    )
    return jsonify(result), 200 if result['success'] else 400


# ==================== POSTGRESQL DATABASES ====================

@databases_bp.route('/postgresql', methods=['GET'])
@admin_required
def list_pg_databases():
    """List PostgreSQL databases."""
    databases = DatabaseService.pg_list_databases()
    return jsonify({'databases': databases}), 200


@databases_bp.route('/postgresql', methods=['POST'])
@admin_required
def create_pg_database():
    """Create a PostgreSQL database."""
    data = request.get_json()

    if not data or 'name' not in data:
        raise field_required('name')

    result = DatabaseService.pg_create_database(
        data['name'],
        data.get('owner'),
        data.get('encoding', 'UTF8')
    )

    if result['success']:
        # Optionally create user with same name
        if data.get('create_user'):
            password = data.get('user_password') or DatabaseService.generate_password()
            DatabaseService.pg_create_user(data['name'], password)
            DatabaseService.pg_grant_privileges(data['name'], data['name'], 'ALL')
            result['user'] = data['name']
            result['password'] = password

        _persist_provisioned('postgresql', data['name'], result, data)

    return jsonify(result), 201 if result['success'] else 400


@databases_bp.route('/postgresql/<name>', methods=['DELETE'])
@admin_required
def drop_pg_database(name):
    """Drop a PostgreSQL database."""
    result = DatabaseService.pg_drop_database(name)
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/postgresql/<name>/tables', methods=['GET'])
@admin_required
def get_pg_tables(name):
    """Get tables in a PostgreSQL database."""
    tables = DatabaseService.pg_get_tables(name)
    return jsonify({'tables': tables}), 200


@databases_bp.route('/postgresql/<name>/backup', methods=['POST'])
@admin_required
def backup_pg_database(name):
    """Backup a PostgreSQL database."""
    result = DatabaseService.pg_backup(name)
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/postgresql/<name>/restore', methods=['POST'])
@admin_required
def restore_pg_database(name):
    """Restore a PostgreSQL database from backup."""
    data = request.get_json()

    if not data or 'backup_path' not in data:
        raise field_required('backup_path')

    result = DatabaseService.pg_restore(name, data['backup_path'])
    return jsonify(result), 200 if result['success'] else 400


# ==================== POSTGRESQL USERS ====================

@databases_bp.route('/postgresql/users', methods=['GET'])
@admin_required
def list_pg_users():
    """List PostgreSQL users."""
    users = DatabaseService.pg_list_users()
    return jsonify({'users': users}), 200


@databases_bp.route('/postgresql/users', methods=['POST'])
@admin_required
def create_pg_user():
    """Create a PostgreSQL user."""
    data = request.get_json()

    if not data or 'username' not in data:
        raise field_required('username')

    password = data.get('password') or DatabaseService.generate_password()

    result = DatabaseService.pg_create_user(data['username'], password)

    if result['success']:
        result['password'] = password

        # Grant privileges if database specified
        if data.get('database'):
            DatabaseService.pg_grant_privileges(
                data['username'],
                data['database'],
                data.get('privileges', 'ALL')
            )

    return jsonify(result), 201 if result['success'] else 400


@databases_bp.route('/postgresql/users/<username>', methods=['DELETE'])
@admin_required
def drop_pg_user(username):
    """Drop a PostgreSQL user."""
    result = DatabaseService.pg_drop_user(username)
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/postgresql/users/<username>/grant', methods=['POST'])
@admin_required
def grant_pg_privileges(username):
    """Grant privileges to a PostgreSQL user."""
    data = request.get_json()

    if not data or 'database' not in data:
        raise field_required('database')

    result = DatabaseService.pg_grant_privileges(
        username,
        data['database'],
        data.get('privileges', 'ALL')
    )
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/postgresql/users/<username>/revoke', methods=['POST'])
@admin_required
def revoke_pg_privileges(username):
    """Revoke privileges from a PostgreSQL user."""
    data = request.get_json()

    if not data or 'database' not in data:
        raise field_required('database')

    result = DatabaseService.pg_revoke_privileges(
        username,
        data['database'],
        data.get('privileges', 'ALL')
    )
    return jsonify(result), 200 if result['success'] else 400


# ==================== BACKUPS ====================

@databases_bp.route('/backups', methods=['GET'])
@admin_required
def list_backups():
    """List all database backups."""
    db_type = request.args.get('type')
    backups = DatabaseService.list_backups(db_type)
    return jsonify({'backups': backups}), 200


@databases_bp.route('/backups/<filename>', methods=['DELETE'])
@admin_required
def delete_backup(filename):
    """Delete a backup file."""
    result = DatabaseService.delete_backup(filename)
    return jsonify(result), 200 if result['success'] else 400


# ==================== QUERY EXECUTION ====================

@databases_bp.route('/mysql/<name>/query', methods=['POST'])
@admin_required
def execute_mysql_query(name):
    """Execute a query on a MySQL database.

    Request body:
        query: SQL query to execute
        readonly: If true, only allow SELECT/SHOW/DESCRIBE/EXPLAIN (default: true)

    Security: Readonly mode is enforced by default. Admin role required to disable.
    """
    data = request.get_json()

    if not data or 'query' not in data:
        raise field_required('query')

    query = data['query']
    readonly = data.get('readonly', True)
    root_password = request.headers.get('X-DB-Password')

    # Only admins can disable readonly mode
    if not readonly:
        require_admin_user()

    result = DatabaseService.mysql_execute_query(
        database=name,
        query=query,
        readonly=readonly,
        root_password=root_password,
        timeout=30,
        max_rows=1000
    )

    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/postgresql/<name>/query', methods=['POST'])
@admin_required
def execute_pg_query(name):
    """Execute a query on a PostgreSQL database.

    Request body:
        query: SQL query to execute
        readonly: If true, only allow SELECT/SHOW/DESCRIBE/EXPLAIN (default: true)

    Security: Readonly mode is enforced by default. Admin role required to disable.
    """
    data = request.get_json()

    if not data or 'query' not in data:
        raise field_required('query')

    query = data['query']
    readonly = data.get('readonly', True)

    # Only admins can disable readonly mode
    if not readonly:
        require_admin_user()

    result = DatabaseService.pg_execute_query(
        database=name,
        query=query,
        readonly=readonly,
        timeout=30,
        max_rows=1000
    )

    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/sqlite/query', methods=['POST'])
@admin_required
def execute_sqlite_query():
    """Execute a query on a SQLite database file.

    Request body:
        path: Path to the SQLite database file
        query: SQL query to execute
        readonly: If true, only allow SELECT queries (default: true)

    Security: Readonly mode is enforced by default. Admin role required to disable.
    """
    data = request.get_json()

    if not data or 'path' not in data or 'query' not in data:
        return jsonify({'error': 'path and query are required'}), 400

    db_path = data['path']
    query = data['query']
    readonly = data.get('readonly', True)

    # Only admins can disable readonly mode
    if not readonly:
        require_admin_user()

    result = DatabaseService.sqlite_execute_query(
        db_path=db_path,
        query=query,
        readonly=readonly,
        timeout=30,
        max_rows=1000
    )

    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/mysql/<name>/tables/<table>/structure', methods=['GET'])
@admin_required
def get_mysql_table_structure(name, table):
    """Get the structure/schema of a MySQL table."""
    root_password = request.headers.get('X-DB-Password')
    result = DatabaseService.mysql_get_table_structure(name, table, root_password)
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/postgresql/<name>/tables/<table>/structure', methods=['GET'])
@admin_required
def get_pg_table_structure(name, table):
    """Get the structure/schema of a PostgreSQL table."""
    result = DatabaseService.pg_get_table_structure(name, table)
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/sqlite/tables/<table>/structure', methods=['GET'])
@admin_required
def get_sqlite_table_structure(table):
    """Get the structure/schema of a SQLite table.

    Query params:
        path: Path to the SQLite database file
    """
    db_path = request.args.get('path')
    if not db_path:
        return jsonify({'error': 'path query parameter is required'}), 400

    result = DatabaseService.sqlite_get_table_structure(db_path, table)
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/sqlite', methods=['GET'])
@admin_required
def list_sqlite_databases():
    """List SQLite database files found in common locations."""
    databases = DatabaseService.sqlite_list_databases()
    return jsonify({'databases': databases}), 200


@databases_bp.route('/sqlite/tables', methods=['GET'])
@admin_required
def get_sqlite_tables():
    """Get tables in a SQLite database.

    Query params:
        path: Path to the SQLite database file
    """
    db_path = request.args.get('path')
    if not db_path:
        return jsonify({'error': 'path query parameter is required'}), 400

    tables = DatabaseService.sqlite_get_tables(db_path)
    return jsonify({'tables': tables}), 200


# ==================== DOCKER CONTAINER DATABASES ====================

@databases_bp.route('/docker', methods=['GET'])
@admin_required
def list_docker_databases():
    """List all databases running in Docker containers.

    This includes MySQL/MariaDB containers from template-deployed apps.
    """
    containers = DatabaseService.list_docker_mysql_containers()
    return jsonify({'containers': containers}), 200


@databases_bp.route('/docker/databases', methods=['GET'])
@jwt_required()
def list_all_docker_databases():
    """Flat list of databases discovered across every Docker app the caller can
    access, each tagged with its owning app and engine.

    Powers grouping Docker-hosted databases under their engine node — e.g. a
    containerised MySQL created by a WordPress stack appears under
    'MySQL / MariaDB', not only buried under 'Docker apps'.
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    # Workspace-aware scoping (#33). Docker databases are app-children — scope the
    # enumeration to the apps the caller can see (own + granted, workspace-narrowed)
    # via the same helper apps/domains use. With no workspace context this is the
    # prior behavior. NOTE: the host-level MySQL/PostgreSQL/SQLite endpoints above
    # are server-global system resources with no app/workspace linkage, so they are
    # intentionally NOT workspace-scoped (their mutations are already admin-gated).
    from app.services.workspace_service import WorkspaceService
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    app_q = WorkspaceService.scope_query(
        Application.query_active().filter_by(app_type='docker'), Application, user,
        workspace_id=ws_id, owner_attr='user_id', grant_resource_type='application')

    out = []
    for app in app_q.all():
        if not app.root_path:
            continue
        info = DatabaseService.get_app_database_info(app.name, app.root_path)
        if not info:
            continue
        for db in info:
            entry = dict(db)
            entry['app_id'] = app.id
            entry['app_name'] = app.name
            out.append(entry)

    return jsonify({'databases': out}), 200


@databases_bp.route('/docker/app/<int:app_id>', methods=['GET'])
@jwt_required()
def get_app_databases(app_id):
    """Get database info for a Docker application.

    This reads the docker-compose.yml and .env files to find database
    containers and their credentials.
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

    if app.app_type != 'docker' or not app.root_path:
        return jsonify({'error': 'This service is not a Docker service'}), 400

    db_info = DatabaseService.get_app_database_info(app.name, app.root_path)

    if not db_info:
        return jsonify({'databases': [], 'message': 'No database containers found'}), 200

    return jsonify({'databases': db_info}), 200


@databases_bp.route('/docker/<container>/databases', methods=['GET'])
@admin_required
def list_docker_container_databases(container):
    """List databases in a Docker MySQL container."""
    user = request.args.get('user', 'root')
    password = request.headers.get('X-DB-Password')

    databases = DatabaseService.docker_mysql_list_databases(container, user, password)
    return jsonify({'databases': databases}), 200


@databases_bp.route('/docker/<container>/<database>/tables', methods=['GET'])
@admin_required
def get_docker_database_tables(container, database):
    """Get tables in a Docker MySQL database."""
    user = request.args.get('user', 'root')
    password = request.headers.get('X-DB-Password')

    result = DatabaseService.docker_mysql_get_tables(container, database, user, password)
    return jsonify({
        'tables': result['tables'],
        'connected': result['connected'],
        'error': result['error'],
    }), 200


@databases_bp.route('/docker/<container>/<database>/query', methods=['POST'])
@admin_required
def execute_docker_query(container, database):
    """Execute a query on a Docker MySQL database.

    Request body:
        query: SQL query to execute
        readonly: If true, only allow SELECT/SHOW/DESCRIBE/EXPLAIN (default: true)

    Security: Readonly mode is enforced by default. Admin role required to disable.
    """
    data = request.get_json()

    if not data or 'query' not in data:
        raise field_required('query')

    query = data['query']
    readonly = data.get('readonly', True)
    user = data.get('user', 'root')
    password = request.headers.get('X-DB-Password') or data.get('password')

    # Only admins can disable readonly mode
    if not readonly:
        require_admin_user()

    result = DatabaseService.docker_mysql_execute_query(
        container_name=container,
        database=database,
        query=query,
        user=user,
        password=password,
        readonly=readonly,
        timeout=30,
        max_rows=1000
    )

    return jsonify(result), 200 if result['success'] else 400


# ==================== MANAGED DATABASES ====================
# Durable tracking beside the live introspection above. Listing is available to
# any authenticated user; mutations + credential reveal are admin-only.

def _workspace_id():
    from app.services.workspace_service import WorkspaceService
    user = get_current_user()
    return WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))


@databases_bp.route('/managed', methods=['GET'])
@jwt_required()
def list_managed_databases():
    """List tracked databases (credentials masked)."""
    rows = ManagedDatabaseService.list(workspace_id=_workspace_id())
    return jsonify({'databases': [r.to_dict() for r in rows]}), 200


@databases_bp.route('/managed', methods=['POST'])
@admin_required
def create_managed_database():
    """Provision a new database (mysql|postgresql) AND track it as managed."""
    data = request.get_json() or {}
    engine = (data.get('engine') or '').strip().lower()
    name = data.get('name')
    if not name:
        raise field_required('name')
    if engine not in ('mysql', 'postgresql'):
        return jsonify({'error': 'engine must be mysql or postgresql'}), 400

    if engine == 'mysql':
        result = DatabaseService.mysql_create_database(
            name, data.get('charset', 'utf8mb4'),
            data.get('collation', 'utf8mb4_unicode_ci'), data.get('root_password'))
        if result.get('success') and data.get('create_user'):
            password = data.get('user_password') or DatabaseService.generate_password()
            DatabaseService.mysql_create_user(name, password, data.get('host', 'localhost'), data.get('root_password'))
            DatabaseService.mysql_grant_privileges(name, name, 'ALL', data.get('host', 'localhost'), data.get('root_password'))
            result['user'] = name
            result['password'] = password
    else:
        result = DatabaseService.pg_create_database(name, data.get('owner'), data.get('encoding', 'UTF8'))
        if result.get('success') and data.get('create_user'):
            password = data.get('user_password') or DatabaseService.generate_password()
            DatabaseService.pg_create_user(name, password)
            DatabaseService.pg_grant_privileges(name, name, 'ALL')
            result['user'] = name
            result['password'] = password

    if not result.get('success'):
        return jsonify(result), 400

    managed = ManagedDatabaseService.record_provisioned(
        engine, name,
        admin_username=result.get('user'),
        admin_secret=result.get('password'),
        owner_application_id=data.get('application_id'),
        workspace_id=_workspace_id(),
    )
    return jsonify({'database': managed.to_dict()}), 201


@databases_bp.route('/managed/adopt', methods=['POST'])
@admin_required
def adopt_managed_database():
    """Track a live-discovered database that isn't tracked yet."""
    data = request.get_json() or {}
    engine = (data.get('engine') or '').strip().lower()
    name = data.get('name')
    if not name or engine not in ('mysql', 'postgresql', 'mongodb'):
        return jsonify({'error': 'engine (mysql|postgresql|mongodb) and name are required'}), 400
    managed = ManagedDatabaseService.adopt(
        engine, data.get('host', 'localhost'), name,
        port=data.get('port'),
        host_kind=data.get('host_kind', 'host'),
        container_ref=data.get('container_ref'),
        admin_username=data.get('admin_username'),
        admin_secret=data.get('admin_secret'),
        owner_application_id=data.get('application_id'),
        workspace_id=_workspace_id(),
    )
    return jsonify({'database': managed.to_dict()}), 201


@databases_bp.route('/managed/<int:managed_id>', methods=['GET'])
@jwt_required()
def get_managed_database(managed_id):
    """Detail + a best-effort live-sync state (does the DB still exist?)."""
    managed = ManagedDatabaseService.get(managed_id)
    if not managed:
        raise not_found('database')
    data = managed.to_dict()
    data['sync'] = ManagedDatabaseService.sync_state(managed)
    return jsonify({'database': data}), 200


@databases_bp.route('/managed/<int:managed_id>', methods=['DELETE'])
@admin_required
def delete_managed_database(managed_id):
    """Untrack a managed database (optional ``?drop=true`` to also DROP it)."""
    managed = ManagedDatabaseService.get(managed_id)
    if not managed:
        raise not_found('database')
    drop = str(request.args.get('drop', '')).lower() in ('1', 'true', 'yes')
    from flask_jwt_extended import get_jwt_identity
    ManagedDatabaseService.delete(managed, drop=drop, user_id=get_jwt_identity())
    return jsonify({'success': True, 'dropped': drop}), 200


@databases_bp.route('/managed/<int:managed_id>/connection-uri', methods=['POST'])
@admin_required
def reveal_managed_connection_uri(managed_id):
    """Reveal the real connection string (audited)."""
    from app.models.audit_log import AuditLog
    from app.services.audit_service import AuditService
    managed = ManagedDatabaseService.get(managed_id)
    if not managed:
        raise not_found('database')
    uri = ManagedDatabaseService.build_connection_uri(managed, reveal=True)
    AuditService.log(
        action=getattr(AuditLog, 'ACTION_SECRET_REVEALED', 'secret.revealed'),
        user_id=get_jwt_identity(),
        target_type='managed_database', target_id=managed.id,
        details={'engine': managed.engine, 'name': managed.name},
    )
    return jsonify({'connection_uri': uri}), 200


@databases_bp.route('/managed/<int:managed_id>/protect', methods=['POST'])
@admin_required
def protect_managed_database(managed_id):
    """Create/refresh a BackupPolicy for a managed database (real FK target)."""
    managed = ManagedDatabaseService.get(managed_id)
    if not managed:
        raise not_found('database')
    data = request.get_json() or {}
    policy = ManagedDatabaseService.protect(managed, fields=data.get('policy'))
    return jsonify({'policy': policy.to_dict()}), 201


# ==================== PROCESSES ====================
# Live SHOW PROCESSLIST / pg_stat_activity per server or container, with an
# admin-only kill/terminate action. Targets mirror the explorer's connection
# shapes (host engine vs docker container).

def _process_error_response(result):
    # The services tag the one client-caused failure with a code; the status
    # never depends on the wording of the error.
    code = 400 if result.get('code') == 'unsupported_engine' else 502
    return jsonify({'error': result['error']}), code


@databases_bp.route('/mysql/processes', defaults={'engine': 'mysql'}, methods=['GET'])
@databases_bp.route('/postgresql/processes', defaults={'engine': 'postgresql'}, methods=['GET'])
@admin_required
def list_host_db_processes(engine):
    """List live server processes on a host engine."""
    target = {'engine': engine, 'password': request.headers.get('X-DB-Password')}
    result = DbProcessService.list_processes(target)
    if 'error' in result:
        return _process_error_response(result)
    return jsonify(result), 200


@databases_bp.route('/mysql/processes/<int:pid>/kill', defaults={'engine': 'mysql'}, methods=['POST'])
@databases_bp.route('/postgresql/processes/<int:pid>/kill', defaults={'engine': 'postgresql'}, methods=['POST'])
@admin_required
def kill_host_db_process(engine, pid):
    """Kill/terminate a process on a host engine (admin only)."""
    target = {'engine': engine, 'password': request.headers.get('X-DB-Password')}
    result = DbProcessService.kill_process(target, pid)
    if 'error' in result:
        return _process_error_response(result)
    return jsonify(result), 200


@databases_bp.route('/docker/<container>/processes', methods=['GET'])
@admin_required
def list_docker_db_processes(container):
    """List live server processes inside a Docker database container."""
    target = {
        'engine': request.args.get('type', 'mysql'),
        'container': container,
        'user': request.args.get('user'),
        'password': request.headers.get('X-DB-Password'),
        'database': request.args.get('database'),
    }
    result = DbProcessService.list_processes(target)
    if 'error' in result:
        return _process_error_response(result)
    return jsonify(result), 200


@databases_bp.route('/docker/<container>/processes/<int:pid>/kill', methods=['POST'])
@admin_required
def kill_docker_db_process(container, pid):
    """Kill/terminate a process inside a Docker database container (admin only)."""
    data = request.get_json(silent=True) or {}
    target = {
        'engine': data.get('type') or request.args.get('type', 'mysql'),
        'container': container,
        'user': data.get('user'),
        'password': request.headers.get('X-DB-Password') or data.get('password'),
        'database': data.get('database'),
    }
    result = DbProcessService.kill_process(target, pid)
    if 'error' in result:
        return _process_error_response(result)
    return jsonify(result), 200


# ==================== INSIGHTS (plan 86 §A3) ====================
# Read-only top queries + connection / cache-hit gauges for a Docker database
# container, and the one write it offers: turning pg_stat_statements on
# (through the config tuner, so its rollback undoes it).

def _docker_db_target(container, source):
    return {
        'engine': source.get('type') or 'mysql',
        'container': container,
        'user': source.get('user'),
        'password': request.headers.get('X-DB-Password'),
        'database': source.get('database'),
    }


@databases_bp.route('/docker/<container>/insights', methods=['GET'])
@admin_required
def docker_db_insights(container):
    from app.services.db_insights_service import DbInsightsService
    result = DbInsightsService.insights(_docker_db_target(container, request.args))
    if 'error' in result:
        return _process_error_response(result)
    return jsonify(result), 200


@databases_bp.route('/docker/<container>/insights/pg-stat-statements', methods=['POST'])
@admin_required
def enable_pg_stat_statements(container):
    from app.services.db_config_tuner_service import DbConfigTunerService
    data = request.get_json(silent=True) or {}
    target = _docker_db_target(container, dict(data, type='postgresql'))
    return jsonify(DbConfigTunerService.enable_pg_stat_statements(target)), 200


# ==================== UTILITY ====================

@databases_bp.route('/generate-password', methods=['GET'])
@jwt_required()
def generate_password():
    """Generate a secure random password."""
    length = request.args.get('length', 16, type=int)
    password = DatabaseService.generate_password(length)
    return jsonify({'password': password}), 200
