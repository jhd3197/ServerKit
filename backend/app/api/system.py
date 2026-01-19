import os
import time
import urllib.request
import json
from flask import Blueprint, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User
from app.services.system_service import SystemService

# Cache for update check (to avoid hitting GitHub API too often)
_update_cache = {
    'last_check': 0,
    'result': None,
    'ttl': 3600  # 1 hour cache
}

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


@system_bp.route('/check-update', methods=['GET'])
def check_update():
    """Check for updates from GitHub releases - no auth required."""
    global _update_cache

    # Return cached result if still valid
    if _update_cache['result'] and (time.time() - _update_cache['last_check']) < _update_cache['ttl']:
        return jsonify(_update_cache['result']), 200

    # Get current version
    current_version = '1.0.0'
    version_paths = [
        '/opt/serverkit/VERSION',
        os.path.join(current_app.root_path, '..', 'VERSION'),
        os.path.join(current_app.root_path, '..', '..', 'VERSION'),
    ]
    for path in version_paths:
        try:
            if os.path.exists(path):
                with open(path, 'r') as f:
                    current_version = f.read().strip()
                break
        except Exception:
            pass

    result = {
        'current_version': current_version,
        'latest_version': None,
        'update_available': False,
        'release_url': None,
        'release_notes': None,
        'error': None
    }

    try:
        # Fetch latest release from GitHub API
        req = urllib.request.Request(
            'https://api.github.com/repos/jhd3197/ServerKit/releases/latest',
            headers={'User-Agent': 'ServerKit-UpdateChecker'}
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))

            latest_version = data.get('tag_name', '').lstrip('v')
            result['latest_version'] = latest_version
            result['release_url'] = data.get('html_url')
            result['release_notes'] = data.get('body', '')[:500]  # Truncate release notes

            # Simple version comparison (works for semver-like versions)
            def parse_version(v):
                try:
                    return tuple(int(x) for x in v.split('.'))
                except:
                    return (0, 0, 0)

            if parse_version(latest_version) > parse_version(current_version):
                result['update_available'] = True

    except urllib.error.HTTPError as e:
        if e.code == 404:
            result['error'] = 'No releases found'
        else:
            result['error'] = f'GitHub API error: {e.code}'
    except Exception as e:
        result['error'] = f'Failed to check for updates: {str(e)}'

    # Cache the result
    _update_cache['last_check'] = time.time()
    _update_cache['result'] = result

    return jsonify(result), 200


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


@system_bp.route('/time', methods=['GET'])
@jwt_required()
def get_server_time():
    """Get current server time and timezone."""
    return jsonify(SystemService.get_server_time()), 200


@system_bp.route('/timezones', methods=['GET'])
@jwt_required()
def get_timezones():
    """Get list of available timezones."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    timezones = SystemService.get_available_timezones()
    return jsonify({'timezones': timezones}), 200


@system_bp.route('/timezone', methods=['PUT'])
@jwt_required()
def set_timezone():
    """Set server timezone (admin only)."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role != 'admin':
        return jsonify({'error': 'Admin access required'}), 403

    data = request.get_json()
    if not data or 'timezone' not in data:
        return jsonify({'error': 'Timezone is required'}), 400

    result = SystemService.set_timezone(data['timezone'])

    if result['success']:
        return jsonify(result), 200
    else:
        return jsonify(result), 400


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
