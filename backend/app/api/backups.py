from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, Application
from app.services.backup_service import BackupService

backups_bp = Blueprint('backups', __name__)


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


@backups_bp.route('', methods=['GET'])
@jwt_required()
def list_backups():
    """List all backups."""
    backup_type = request.args.get('type')
    backups = BackupService.list_backups(backup_type)
    return jsonify({'backups': backups}), 200


@backups_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_stats():
    """Get backup statistics."""
    stats = BackupService.get_backup_stats()
    return jsonify(stats), 200


@backups_bp.route('/config', methods=['GET'])
@jwt_required()
@admin_required
def get_config():
    """Get backup configuration."""
    config = BackupService.get_config()
    return jsonify(config), 200


@backups_bp.route('/config', methods=['PUT'])
@jwt_required()
@admin_required
def update_config():
    """Update backup configuration."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    current_config = BackupService.get_config()
    current_config.update(data)
    result = BackupService.save_config(current_config)
    return jsonify(result), 200 if result['success'] else 400


@backups_bp.route('/application', methods=['POST'])
@jwt_required()
@admin_required
def backup_application():
    """Backup an application."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    app_id = data.get('application_id')
    if not app_id:
        return jsonify({'error': 'application_id is required'}), 400

    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = BackupService.backup_application(
        app_name=app.name,
        app_path=app.path,
        include_db=data.get('include_db', False),
        db_config=data.get('db_config')
    )

    return jsonify(result), 201 if result['success'] else 400


@backups_bp.route('/database', methods=['POST'])
@jwt_required()
@admin_required
def backup_database():
    """Backup a database."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['db_type', 'db_name']
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    result = BackupService.backup_database(
        db_type=data['db_type'],
        db_name=data['db_name'],
        user=data.get('user'),
        password=data.get('password'),
        host=data.get('host', 'localhost')
    )

    return jsonify(result), 201 if result['success'] else 400


@backups_bp.route('/restore/application', methods=['POST'])
@jwt_required()
@admin_required
def restore_application():
    """Restore an application from backup."""
    data = request.get_json()

    if not data or 'backup_path' not in data:
        return jsonify({'error': 'backup_path is required'}), 400

    result = BackupService.restore_application(
        backup_path=data['backup_path'],
        restore_path=data.get('restore_path')
    )

    return jsonify(result), 200 if result['success'] else 400


@backups_bp.route('/restore/database', methods=['POST'])
@jwt_required()
@admin_required
def restore_database():
    """Restore a database from backup."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['backup_path', 'db_type', 'db_name']
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    result = BackupService.restore_database(
        backup_path=data['backup_path'],
        db_type=data['db_type'],
        db_name=data['db_name'],
        user=data.get('user'),
        password=data.get('password'),
        host=data.get('host', 'localhost')
    )

    return jsonify(result), 200 if result['success'] else 400


@backups_bp.route('/<path:backup_path>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_backup(backup_path):
    """Delete a backup."""
    # Ensure path is within backup directory
    full_path = f"/var/backups/serverkit/{backup_path}"
    result = BackupService.delete_backup(full_path)
    return jsonify(result), 200 if result['success'] else 400


@backups_bp.route('/cleanup', methods=['POST'])
@jwt_required()
@admin_required
def cleanup_backups():
    """Clean up old backups."""
    data = request.get_json() or {}
    retention_days = data.get('retention_days')

    result = BackupService.cleanup_old_backups(retention_days)
    return jsonify(result), 200 if result['success'] else 400


# Schedules
@backups_bp.route('/schedules', methods=['GET'])
@jwt_required()
@admin_required
def list_schedules():
    """List backup schedules."""
    schedules = BackupService.get_schedules()
    return jsonify({'schedules': schedules}), 200


@backups_bp.route('/schedules', methods=['POST'])
@jwt_required()
@admin_required
def add_schedule():
    """Add a backup schedule."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['name', 'backup_type', 'target', 'schedule_time']
    missing = [f for f in required if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    result = BackupService.add_schedule(
        name=data['name'],
        backup_type=data['backup_type'],
        target=data['target'],
        schedule_time=data['schedule_time'],
        days=data.get('days')
    )

    return jsonify(result), 201 if result['success'] else 400


@backups_bp.route('/schedules/<schedule_id>', methods=['DELETE'])
@jwt_required()
@admin_required
def remove_schedule(schedule_id):
    """Remove a backup schedule."""
    result = BackupService.remove_schedule(schedule_id)
    return jsonify(result), 200 if result['success'] else 400
