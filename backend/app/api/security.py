from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User
from app.services.security_service import SecurityService

security_bp = Blueprint('security', __name__)


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


# ==========================================
# STATUS & CONFIG
# ==========================================
@security_bp.route('/status', methods=['GET'])
@jwt_required()
def get_security_status():
    """Get overall security status summary."""
    summary = SecurityService.get_security_summary()
    return jsonify(summary), 200


@security_bp.route('/config', methods=['GET'])
@jwt_required()
@admin_required
def get_config():
    """Get security configuration."""
    config = SecurityService.get_config()
    return jsonify(config), 200


@security_bp.route('/config', methods=['PUT'])
@jwt_required()
@admin_required
def update_config():
    """Update security configuration."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    current_config = SecurityService.get_config()

    # Update nested config sections
    for key in ['clamav', 'file_integrity', 'suspicious_activity', 'notifications']:
        if key in data:
            current_config[key] = {**current_config.get(key, {}), **data[key]}

    result = SecurityService.save_config(current_config)
    return jsonify(result), 200 if result['success'] else 400


# ==========================================
# CLAMAV
# ==========================================
@security_bp.route('/clamav/status', methods=['GET'])
@jwt_required()
def get_clamav_status():
    """Get ClamAV installation and service status."""
    status = SecurityService.get_clamav_status()
    return jsonify(status), 200


@security_bp.route('/clamav/install', methods=['POST'])
@jwt_required()
@admin_required
def install_clamav():
    """Install ClamAV packages."""
    result = SecurityService.install_clamav()
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/clamav/update', methods=['POST'])
@jwt_required()
@admin_required
def update_definitions():
    """Update ClamAV virus definitions."""
    result = SecurityService.update_definitions()
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/scan/file', methods=['POST'])
@jwt_required()
@admin_required
def scan_file():
    """Scan a single file for malware."""
    data = request.get_json()
    if not data or 'path' not in data:
        return jsonify({'error': 'File path required'}), 400

    result = SecurityService.scan_file(data['path'])
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/scan/directory', methods=['POST'])
@jwt_required()
@admin_required
def scan_directory():
    """Start a directory scan (runs in background)."""
    data = request.get_json()
    if not data or 'path' not in data:
        return jsonify({'error': 'Directory path required'}), 400

    recursive = data.get('recursive', True)
    result = SecurityService.scan_directory(data['path'], recursive)
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/scan/status', methods=['GET'])
@jwt_required()
def get_scan_status():
    """Get current scan status."""
    status = SecurityService.get_scan_status()
    return jsonify(status), 200


@security_bp.route('/scan/cancel', methods=['POST'])
@jwt_required()
@admin_required
def cancel_scan():
    """Cancel running scan."""
    result = SecurityService.cancel_scan()
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/scan/history', methods=['GET'])
@jwt_required()
def get_scan_history():
    """Get scan history."""
    limit = request.args.get('limit', 50, type=int)
    result = SecurityService.get_scan_history(limit)
    return jsonify(result), 200 if result['success'] else 400


# ==========================================
# QUARANTINE
# ==========================================
@security_bp.route('/quarantine', methods=['GET'])
@jwt_required()
@admin_required
def get_quarantined_files():
    """List quarantined files."""
    result = SecurityService.get_quarantined_files()
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/quarantine', methods=['POST'])
@jwt_required()
@admin_required
def quarantine_file():
    """Move a file to quarantine."""
    data = request.get_json()
    if not data or 'path' not in data:
        return jsonify({'error': 'File path required'}), 400

    result = SecurityService.quarantine_file(data['path'])
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/quarantine/<filename>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_quarantined_file(filename):
    """Permanently delete a quarantined file."""
    result = SecurityService.delete_quarantined_file(filename)
    return jsonify(result), 200 if result['success'] else 400


# ==========================================
# FILE INTEGRITY
# ==========================================
@security_bp.route('/integrity/initialize', methods=['POST'])
@jwt_required()
@admin_required
def initialize_integrity():
    """Create baseline for file integrity monitoring."""
    data = request.get_json() or {}
    paths = data.get('paths')
    result = SecurityService.initialize_integrity_database(paths)
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/integrity/check', methods=['GET'])
@jwt_required()
@admin_required
def check_integrity():
    """Check files against integrity database."""
    result = SecurityService.check_file_integrity()
    return jsonify(result), 200 if result['success'] else 400


# ==========================================
# SUSPICIOUS ACTIVITY
# ==========================================
@security_bp.route('/failed-logins', methods=['GET'])
@jwt_required()
@admin_required
def check_failed_logins():
    """Check for failed login attempts."""
    hours = request.args.get('hours', 24, type=int)
    result = SecurityService.check_failed_logins(hours)
    return jsonify(result), 200 if result['success'] else 400


# ==========================================
# EVENTS & ALERTS
# ==========================================
@security_bp.route('/events', methods=['GET'])
@jwt_required()
def get_security_events():
    """Get recent security events/alerts."""
    limit = request.args.get('limit', 100, type=int)
    result = SecurityService.get_security_events(limit)
    return jsonify(result), 200 if result['success'] else 400


# ==========================================
# QUICK SCAN PRESETS
# ==========================================
@security_bp.route('/scan/quick', methods=['POST'])
@jwt_required()
@admin_required
def quick_scan():
    """Run a quick scan on common web directories."""
    config = SecurityService.get_config()
    scan_paths = config.get('clamav', {}).get('scan_paths', ['/var/www', '/home'])

    # Scan each path
    results = []
    for path in scan_paths:
        result = SecurityService.scan_directory(path, recursive=True)
        results.append({'path': path, 'result': result})

    return jsonify({
        'success': True,
        'message': f'Started scans for {len(scan_paths)} directories',
        'scans': results
    }), 200


@security_bp.route('/scan/full', methods=['POST'])
@jwt_required()
@admin_required
def full_scan():
    """Run a full system scan."""
    result = SecurityService.scan_directory('/', recursive=True)
    return jsonify(result), 200 if result['success'] else 400
