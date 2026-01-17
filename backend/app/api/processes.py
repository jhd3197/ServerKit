from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User
from app.services.process_service import ProcessService

processes_bp = Blueprint('processes', __name__)


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


@processes_bp.route('', methods=['GET'])
@jwt_required()
@admin_required
def get_processes():
    """Get list of running processes."""
    limit = request.args.get('limit', 50, type=int)
    sort_by = request.args.get('sort', 'cpu')

    processes = ProcessService.get_processes(limit, sort_by)
    return jsonify({'processes': processes}), 200


@processes_bp.route('/<int:pid>', methods=['GET'])
@jwt_required()
@admin_required
def get_process(pid):
    """Get detailed information about a process."""
    details = ProcessService.get_process_details(pid)
    if details:
        return jsonify({'process': details}), 200
    return jsonify({'error': 'Process not found'}), 404


@processes_bp.route('/<int:pid>', methods=['DELETE'])
@jwt_required()
@admin_required
def kill_process(pid):
    """Kill a process by PID."""
    force = request.args.get('force', 'false').lower() == 'true'
    result = ProcessService.kill_process(pid, force)
    return jsonify(result), 200 if result['success'] else 400


@processes_bp.route('/services', methods=['GET'])
@jwt_required()
@admin_required
def get_services():
    """Get status of monitored services."""
    services = ProcessService.get_services_status()
    return jsonify({'services': services}), 200


@processes_bp.route('/services/<service_name>', methods=['POST'])
@jwt_required()
@admin_required
def control_service(service_name):
    """Control a system service."""
    data = request.get_json()
    action = data.get('action') if data else None

    if not action:
        return jsonify({'error': 'action is required (start, stop, restart, reload)'}), 400

    result = ProcessService.control_service(service_name, action)
    return jsonify(result), 200 if result['success'] else 400


@processes_bp.route('/services/<service_name>/logs', methods=['GET'])
@jwt_required()
@admin_required
def get_service_logs(service_name):
    """Get logs for a service."""
    lines = request.args.get('lines', 100, type=int)
    result = ProcessService.get_service_logs(service_name, lines)
    return jsonify(result), 200 if result['success'] else 400
