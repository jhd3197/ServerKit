from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User
from app.services.log_service import LogService

logs_bp = Blueprint('logs', __name__)


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


@logs_bp.route('', methods=['GET'])
@jwt_required()
@admin_required
def list_log_files():
    """List available log files."""
    logs = LogService.get_log_files()
    return jsonify({'logs': logs}), 200


@logs_bp.route('/read', methods=['GET'])
@jwt_required()
@admin_required
def read_log():
    """Read lines from a log file."""
    filepath = request.args.get('path')
    lines = request.args.get('lines', 100, type=int)
    from_end = request.args.get('from_end', 'true').lower() == 'true'

    if not filepath:
        return jsonify({'error': 'path parameter is required'}), 400

    result = LogService.read_log(filepath, lines, from_end)
    return jsonify(result), 200 if result['success'] else 400


@logs_bp.route('/search', methods=['GET'])
@jwt_required()
@admin_required
def search_log():
    """Search log file for a pattern."""
    filepath = request.args.get('path')
    pattern = request.args.get('pattern')
    lines = request.args.get('lines', 100, type=int)

    if not filepath or not pattern:
        return jsonify({'error': 'path and pattern parameters are required'}), 400

    result = LogService.search_log(filepath, pattern, lines)
    return jsonify(result), 200 if result['success'] else 400


@logs_bp.route('/app/<app_name>', methods=['GET'])
@jwt_required()
@admin_required
def get_app_logs(app_name):
    """Get logs for a specific application."""
    log_type = request.args.get('type', 'access')
    lines = request.args.get('lines', 100, type=int)

    result = LogService.get_app_logs(app_name, log_type, lines)
    return jsonify(result), 200 if result['success'] else 400


@logs_bp.route('/journal', methods=['GET'])
@jwt_required()
@admin_required
def get_journal_logs():
    """Get logs from systemd journal."""
    unit = request.args.get('unit')
    lines = request.args.get('lines', 100, type=int)
    since = request.args.get('since')
    priority = request.args.get('priority')

    result = LogService.get_journalctl_logs(unit, lines, since, priority)
    return jsonify(result), 200 if result['success'] else 400


@logs_bp.route('/clear', methods=['POST'])
@jwt_required()
@admin_required
def clear_log():
    """Clear/truncate a log file."""
    data = request.get_json()
    filepath = data.get('path') if data else None

    if not filepath:
        return jsonify({'error': 'path is required'}), 400

    result = LogService.clear_log(filepath)
    return jsonify(result), 200 if result['success'] else 400


@logs_bp.route('/rotate', methods=['POST'])
@jwt_required()
@admin_required
def rotate_logs():
    """Trigger log rotation."""
    result = LogService.rotate_logs()
    return jsonify(result), 200 if result['success'] else 400
