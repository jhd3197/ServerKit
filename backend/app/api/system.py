import os
from flask import Blueprint, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User
from app.services.system_service import SystemService

system_bp = Blueprint('system', __name__)


@system_bp.route('/version', methods=['GET'])
def get_version():
    """Get ServerKit version - no auth required."""
    version = '1.0.0'  # Default version

    # Try to read from VERSION file
    version_paths = [
        '/opt/serverkit/VERSION',
        os.path.join(current_app.root_path, '..', 'VERSION'),
        os.path.join(current_app.root_path, '..', '..', 'VERSION'),
    ]

    for path in version_paths:
        try:
            if os.path.exists(path):
                with open(path, 'r') as f:
                    version = f.read().strip()
                break
        except Exception:
            pass

    return jsonify({
        'version': version,
        'name': 'ServerKit'
    }), 200


@system_bp.route('/metrics', methods=['GET'])
@jwt_required()
def get_metrics():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    metrics = SystemService.get_all_metrics()
    return jsonify(metrics), 200


@system_bp.route('/cpu', methods=['GET'])
@jwt_required()
def get_cpu_metrics():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    return jsonify(SystemService.get_cpu_metrics()), 200


@system_bp.route('/memory', methods=['GET'])
@jwt_required()
def get_memory_metrics():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    return jsonify(SystemService.get_memory_metrics()), 200


@system_bp.route('/disk', methods=['GET'])
@jwt_required()
def get_disk_metrics():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    return jsonify(SystemService.get_disk_metrics()), 200


@system_bp.route('/network', methods=['GET'])
@jwt_required()
def get_network_metrics():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    return jsonify(SystemService.get_network_metrics()), 200


@system_bp.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint - no auth required"""
    return jsonify({
        'status': 'healthy',
        'service': 'serverkit-api'
    }), 200


@system_bp.route('/processes', methods=['GET'])
@jwt_required()
def get_processes():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    processes = []
    for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent', 'status']):
        try:
            pinfo = proc.info
            if pinfo['cpu_percent'] > 0 or pinfo['memory_percent'] > 0.1:
                processes.append({
                    'pid': pinfo['pid'],
                    'name': pinfo['name'],
                    'cpu_percent': pinfo['cpu_percent'],
                    'memory_percent': round(pinfo['memory_percent'], 2),
                    'status': pinfo['status']
                })
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass

    # Sort by CPU usage
    processes.sort(key=lambda x: x['cpu_percent'], reverse=True)

    return jsonify({
        'processes': processes[:50]  # Top 50 processes
    }), 200


@system_bp.route('/services', methods=['GET'])
@jwt_required()
def get_services():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    # Common services to check
    service_names = ['nginx', 'mysql', 'postgresql', 'redis', 'docker', 'php-fpm']
    services = []

    for name in service_names:
        running = False
        for proc in psutil.process_iter(['name']):
            try:
                if name.lower() in proc.info['name'].lower():
                    running = True
                    break
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        services.append({
            'name': name,
            'status': 'running' if running else 'stopped'
        })

    return jsonify({'services': services}), 200
