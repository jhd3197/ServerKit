from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, Application
from app.services.database_service import DatabaseService

databases_bp = Blueprint('databases', __name__)


def admin_required(fn):
    """Decorator to require admin role."""
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        if not user or user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return fn(*args, **kwargs)
    return wrapper


# ==================== STATUS ====================

@databases_bp.route('/status', methods=['GET'])
@jwt_required()
def get_status():
    """Get database servers status."""
    status = DatabaseService.get_status()
    return jsonify(status), 200


# ==================== MYSQL DATABASES ====================

@databases_bp.route('/mysql', methods=['GET'])
@jwt_required()
def list_mysql_databases():
    """List MySQL databases.

    For security, root_password should be passed via X-DB-Password header, not query params.
    """
    # Read root_password from header for security (not exposed in URL/logs)
    root_password = request.headers.get('X-DB-Password')
    databases = DatabaseService.mysql_list_databases(root_password)
    return jsonify({'databases': databases}), 200


@databases_bp.route('/mysql', methods=['POST'])
@jwt_required()
@admin_required
def create_mysql_database():
    """Create a MySQL database."""
    data = request.get_json()

    if not data or 'name' not in data:
        return jsonify({'error': 'name is required'}), 400

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

    return jsonify(result), 201 if result['success'] else 400


@databases_bp.route('/mysql/<name>', methods=['DELETE'])
@jwt_required()
@admin_required
def drop_mysql_database(name):
    """Drop a MySQL database."""
    data = request.get_json() or {}
    result = DatabaseService.mysql_drop_database(name, data.get('root_password'))
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/mysql/<name>/tables', methods=['GET'])
@jwt_required()
def get_mysql_tables(name):
    """Get tables in a MySQL database.

    For security, root_password should be passed via X-DB-Password header.
    """
    root_password = request.headers.get('X-DB-Password')
    tables = DatabaseService.mysql_get_tables(name, root_password)
    return jsonify({'tables': tables}), 200


@databases_bp.route('/mysql/<name>/backup', methods=['POST'])
@jwt_required()
@admin_required
def backup_mysql_database(name):
    """Backup a MySQL database."""
    data = request.get_json() or {}
    result = DatabaseService.mysql_backup(name, root_password=data.get('root_password'))
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/mysql/<name>/restore', methods=['POST'])
@jwt_required()
@admin_required
def restore_mysql_database(name):
    """Restore a MySQL database from backup."""
    data = request.get_json()

    if not data or 'backup_path' not in data:
        return jsonify({'error': 'backup_path is required'}), 400

    result = DatabaseService.mysql_restore(
        name,
        data['backup_path'],
        data.get('root_password')
    )
    return jsonify(result), 200 if result['success'] else 400


# ==================== MYSQL USERS ====================

@databases_bp.route('/mysql/users', methods=['GET'])
@jwt_required()
def list_mysql_users():
    """List MySQL users.

    For security, root_password should be passed via X-DB-Password header.
    """
    root_password = request.headers.get('X-DB-Password')
    users = DatabaseService.mysql_list_users(root_password)
    return jsonify({'users': users}), 200


@databases_bp.route('/mysql/users', methods=['POST'])
@jwt_required()
@admin_required
def create_mysql_user():
    """Create a MySQL user."""
    data = request.get_json()

    if not data or 'username' not in data:
        return jsonify({'error': 'username is required'}), 400

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
@jwt_required()
@admin_required
def drop_mysql_user(username):
    """Drop a MySQL user."""
    data = request.get_json() or {}
    host = data.get('host', 'localhost')
    result = DatabaseService.mysql_drop_user(username, host, data.get('root_password'))
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/mysql/users/<username>/privileges', methods=['GET'])
@jwt_required()
def get_mysql_user_privileges(username):
    """Get privileges for a MySQL user.

    For security, root_password should be passed via X-DB-Password header.
    """
    host = request.args.get('host', 'localhost')
    root_password = request.headers.get('X-DB-Password')
    privileges = DatabaseService.mysql_get_user_privileges(username, host, root_password)
    return jsonify({'privileges': privileges}), 200


@databases_bp.route('/mysql/users/<username>/grant', methods=['POST'])
@jwt_required()
@admin_required
def grant_mysql_privileges(username):
    """Grant privileges to a MySQL user."""
    data = request.get_json()

    if not data or 'database' not in data:
        return jsonify({'error': 'database is required'}), 400

    result = DatabaseService.mysql_grant_privileges(
        username,
        data['database'],
        data.get('privileges', 'ALL'),
        data.get('host', 'localhost'),
        data.get('root_password')
    )
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/mysql/users/<username>/revoke', methods=['POST'])
@jwt_required()
@admin_required
def revoke_mysql_privileges(username):
    """Revoke privileges from a MySQL user."""
    data = request.get_json()

    if not data or 'database' not in data:
        return jsonify({'error': 'database is required'}), 400

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
@jwt_required()
def list_pg_databases():
    """List PostgreSQL databases."""
    databases = DatabaseService.pg_list_databases()
    return jsonify({'databases': databases}), 200


@databases_bp.route('/postgresql', methods=['POST'])
@jwt_required()
@admin_required
def create_pg_database():
    """Create a PostgreSQL database."""
    data = request.get_json()

    if not data or 'name' not in data:
        return jsonify({'error': 'name is required'}), 400

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

    return jsonify(result), 201 if result['success'] else 400


@databases_bp.route('/postgresql/<name>', methods=['DELETE'])
@jwt_required()
@admin_required
def drop_pg_database(name):
    """Drop a PostgreSQL database."""
    result = DatabaseService.pg_drop_database(name)
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/postgresql/<name>/tables', methods=['GET'])
@jwt_required()
def get_pg_tables(name):
    """Get tables in a PostgreSQL database."""
    tables = DatabaseService.pg_get_tables(name)
    return jsonify({'tables': tables}), 200


@databases_bp.route('/postgresql/<name>/backup', methods=['POST'])
@jwt_required()
@admin_required
def backup_pg_database(name):
    """Backup a PostgreSQL database."""
    result = DatabaseService.pg_backup(name)
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/postgresql/<name>/restore', methods=['POST'])
@jwt_required()
@admin_required
def restore_pg_database(name):
    """Restore a PostgreSQL database from backup."""
    data = request.get_json()

    if not data or 'backup_path' not in data:
        return jsonify({'error': 'backup_path is required'}), 400

    result = DatabaseService.pg_restore(name, data['backup_path'])
    return jsonify(result), 200 if result['success'] else 400


# ==================== POSTGRESQL USERS ====================

@databases_bp.route('/postgresql/users', methods=['GET'])
@jwt_required()
def list_pg_users():
    """List PostgreSQL users."""
    users = DatabaseService.pg_list_users()
    return jsonify({'users': users}), 200


@databases_bp.route('/postgresql/users', methods=['POST'])
@jwt_required()
@admin_required
def create_pg_user():
    """Create a PostgreSQL user."""
    data = request.get_json()

    if not data or 'username' not in data:
        return jsonify({'error': 'username is required'}), 400

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
@jwt_required()
@admin_required
def drop_pg_user(username):
    """Drop a PostgreSQL user."""
    result = DatabaseService.pg_drop_user(username)
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/postgresql/users/<username>/grant', methods=['POST'])
@jwt_required()
@admin_required
def grant_pg_privileges(username):
    """Grant privileges to a PostgreSQL user."""
    data = request.get_json()

    if not data or 'database' not in data:
        return jsonify({'error': 'database is required'}), 400

    result = DatabaseService.pg_grant_privileges(
        username,
        data['database'],
        data.get('privileges', 'ALL')
    )
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/postgresql/users/<username>/revoke', methods=['POST'])
@jwt_required()
@admin_required
def revoke_pg_privileges(username):
    """Revoke privileges from a PostgreSQL user."""
    data = request.get_json()

    if not data or 'database' not in data:
        return jsonify({'error': 'database is required'}), 400

    result = DatabaseService.pg_revoke_privileges(
        username,
        data['database'],
        data.get('privileges', 'ALL')
    )
    return jsonify(result), 200 if result['success'] else 400


# ==================== BACKUPS ====================

@databases_bp.route('/backups', methods=['GET'])
@jwt_required()
def list_backups():
    """List all database backups."""
    db_type = request.args.get('type')
    backups = DatabaseService.list_backups(db_type)
    return jsonify({'backups': backups}), 200


@databases_bp.route('/backups/<filename>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_backup(filename):
    """Delete a backup file."""
    result = DatabaseService.delete_backup(filename)
    return jsonify(result), 200 if result['success'] else 400


# ==================== QUERY EXECUTION ====================

@databases_bp.route('/mysql/<name>/query', methods=['POST'])
@jwt_required()
def execute_mysql_query(name):
    """Execute a query on a MySQL database.

    Request body:
        query: SQL query to execute
        readonly: If true, only allow SELECT/SHOW/DESCRIBE/EXPLAIN (default: true)

    Security: Readonly mode is enforced by default. Admin role required to disable.
    """
    data = request.get_json()

    if not data or 'query' not in data:
        return jsonify({'error': 'query is required'}), 400

    query = data['query']
    readonly = data.get('readonly', True)
    root_password = request.headers.get('X-DB-Password')

    # Only admins can disable readonly mode
    if not readonly:
        current_user_id = get_jwt_identity()
        from app.models import User
        user = User.query.get(current_user_id)
        if not user or user.role != 'admin':
            return jsonify({'error': 'Admin access required to execute write queries'}), 403

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
@jwt_required()
def execute_pg_query(name):
    """Execute a query on a PostgreSQL database.

    Request body:
        query: SQL query to execute
        readonly: If true, only allow SELECT/SHOW/DESCRIBE/EXPLAIN (default: true)

    Security: Readonly mode is enforced by default. Admin role required to disable.
    """
    data = request.get_json()

    if not data or 'query' not in data:
        return jsonify({'error': 'query is required'}), 400

    query = data['query']
    readonly = data.get('readonly', True)

    # Only admins can disable readonly mode
    if not readonly:
        current_user_id = get_jwt_identity()
        from app.models import User
        user = User.query.get(current_user_id)
        if not user or user.role != 'admin':
            return jsonify({'error': 'Admin access required to execute write queries'}), 403

    result = DatabaseService.pg_execute_query(
        database=name,
        query=query,
        readonly=readonly,
        timeout=30,
        max_rows=1000
    )

    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/sqlite/query', methods=['POST'])
@jwt_required()
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
        current_user_id = get_jwt_identity()
        from app.models import User
        user = User.query.get(current_user_id)
        if not user or user.role != 'admin':
            return jsonify({'error': 'Admin access required to execute write queries'}), 403

    result = DatabaseService.sqlite_execute_query(
        db_path=db_path,
        query=query,
        readonly=readonly,
        timeout=30,
        max_rows=1000
    )

    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/mysql/<name>/tables/<table>/structure', methods=['GET'])
@jwt_required()
def get_mysql_table_structure(name, table):
    """Get the structure/schema of a MySQL table."""
    root_password = request.headers.get('X-DB-Password')
    result = DatabaseService.mysql_get_table_structure(name, table, root_password)
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/postgresql/<name>/tables/<table>/structure', methods=['GET'])
@jwt_required()
def get_pg_table_structure(name, table):
    """Get the structure/schema of a PostgreSQL table."""
    result = DatabaseService.pg_get_table_structure(name, table)
    return jsonify(result), 200 if result['success'] else 400


@databases_bp.route('/sqlite/tables/<table>/structure', methods=['GET'])
@jwt_required()
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
@jwt_required()
def list_sqlite_databases():
    """List SQLite database files found in common locations."""
    databases = DatabaseService.sqlite_list_databases()
    return jsonify({'databases': databases}), 200


@databases_bp.route('/sqlite/tables', methods=['GET'])
@jwt_required()
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
@jwt_required()
def list_docker_databases():
    """List all databases running in Docker containers.

    This includes MySQL/MariaDB containers from template-deployed apps.
    """
    containers = DatabaseService.list_docker_mysql_containers()
    return jsonify({'containers': containers}), 200


@databases_bp.route('/docker/app/<int:app_id>', methods=['GET'])
@jwt_required()
def get_app_databases(app_id):
    """Get database info for a Docker application.

    This reads the docker-compose.yml and .env files to find database
    containers and their credentials.
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    if app.app_type != 'docker' or not app.root_path:
        return jsonify({'error': 'Application is not a Docker app'}), 400

    db_info = DatabaseService.get_app_database_info(app.name, app.root_path)

    if not db_info:
        return jsonify({'databases': [], 'message': 'No database containers found'}), 200

    return jsonify({'databases': db_info}), 200


@databases_bp.route('/docker/<container>/databases', methods=['GET'])
@jwt_required()
def list_docker_container_databases(container):
    """List databases in a Docker MySQL container."""
    user = request.args.get('user', 'root')
    password = request.headers.get('X-DB-Password')

    databases = DatabaseService.docker_mysql_list_databases(container, user, password)
    return jsonify({'databases': databases}), 200


@databases_bp.route('/docker/<container>/<database>/tables', methods=['GET'])
@jwt_required()
def get_docker_database_tables(container, database):
    """Get tables in a Docker MySQL database."""
    user = request.args.get('user', 'root')
    password = request.headers.get('X-DB-Password')

    tables = DatabaseService.docker_mysql_get_tables(container, database, user, password)
    return jsonify({'tables': tables}), 200


@databases_bp.route('/docker/<container>/<database>/query', methods=['POST'])
@jwt_required()
def execute_docker_query(container, database):
    """Execute a query on a Docker MySQL database.

    Request body:
        query: SQL query to execute
        readonly: If true, only allow SELECT/SHOW/DESCRIBE/EXPLAIN (default: true)

    Security: Readonly mode is enforced by default. Admin role required to disable.
    """
    data = request.get_json()

    if not data or 'query' not in data:
        return jsonify({'error': 'query is required'}), 400

    query = data['query']
    readonly = data.get('readonly', True)
    user = data.get('user', 'root')
    password = request.headers.get('X-DB-Password') or data.get('password')

    # Only admins can disable readonly mode
    if not readonly:
        current_user_id = get_jwt_identity()
        user_obj = User.query.get(current_user_id)
        if not user_obj or user_obj.role != 'admin':
            return jsonify({'error': 'Admin access required to execute write queries'}), 403

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


# ==================== UTILITY ====================

@databases_bp.route('/generate-password', methods=['GET'])
@jwt_required()
def generate_password():
    """Generate a secure random password."""
    length = request.args.get('length', 16, type=int)
    password = DatabaseService.generate_password(length)
    return jsonify({'password': password}), 200
