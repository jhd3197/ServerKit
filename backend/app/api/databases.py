from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User
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
    """List MySQL databases."""
    root_password = request.args.get('root_password')
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
    """Get tables in a MySQL database."""
    root_password = request.args.get('root_password')
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
    """List MySQL users."""
    root_password = request.args.get('root_password')
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
    """Get privileges for a MySQL user."""
    host = request.args.get('host', 'localhost')
    root_password = request.args.get('root_password')
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


# ==================== UTILITY ====================

@databases_bp.route('/generate-password', methods=['GET'])
@jwt_required()
def generate_password():
    """Generate a secure random password."""
    length = request.args.get('length', 16, type=int)
    password = DatabaseService.generate_password(length)
    return jsonify({'password': password}), 200
