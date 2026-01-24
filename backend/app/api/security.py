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


# ==========================================
# FAIL2BAN
# ==========================================
@security_bp.route('/fail2ban/status', methods=['GET'])
@jwt_required()
@admin_required
def get_fail2ban_status():
    """Get Fail2ban status."""
    status = SecurityService.get_fail2ban_status()
    return jsonify(status), 200


@security_bp.route('/fail2ban/install', methods=['POST'])
@jwt_required()
@admin_required
def install_fail2ban():
    """Install Fail2ban."""
    result = SecurityService.install_fail2ban()
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/fail2ban/jails/<jail>', methods=['GET'])
@jwt_required()
@admin_required
def get_jail_status(jail):
    """Get status of a specific jail."""
    result = SecurityService.get_fail2ban_jail_status(jail)
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/fail2ban/bans', methods=['GET'])
@jwt_required()
@admin_required
def get_all_bans():
    """Get all banned IPs across all jails."""
    result = SecurityService.get_all_fail2ban_bans()
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/fail2ban/unban', methods=['POST'])
@jwt_required()
@admin_required
def unban_ip():
    """Unban an IP address."""
    data = request.get_json()
    if not data or 'ip' not in data:
        return jsonify({'error': 'IP address required'}), 400

    jail = data.get('jail')
    result = SecurityService.unban_ip(data['ip'], jail)
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/fail2ban/ban', methods=['POST'])
@jwt_required()
@admin_required
def ban_ip():
    """Manually ban an IP address."""
    data = request.get_json()
    if not data or 'ip' not in data:
        return jsonify({'error': 'IP address required'}), 400

    jail = data.get('jail', 'sshd')
    result = SecurityService.ban_ip(data['ip'], jail)
    return jsonify(result), 200 if result['success'] else 400


# ==========================================
# SSH KEYS
# ==========================================
@security_bp.route('/ssh-keys', methods=['GET'])
@jwt_required()
@admin_required
def get_ssh_keys():
    """Get SSH authorized keys."""
    user = request.args.get('user', 'root')
    result = SecurityService.get_ssh_keys(user)
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/ssh-keys', methods=['POST'])
@jwt_required()
@admin_required
def add_ssh_key():
    """Add an SSH public key."""
    data = request.get_json()
    if not data or 'key' not in data:
        return jsonify({'error': 'SSH key required'}), 400

    user = data.get('user', 'root')
    result = SecurityService.add_ssh_key(data['key'], user)
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/ssh-keys/<int:key_id>', methods=['DELETE'])
@jwt_required()
@admin_required
def remove_ssh_key(key_id):
    """Remove an SSH key."""
    user = request.args.get('user', 'root')
    result = SecurityService.remove_ssh_key(key_id, user)
    return jsonify(result), 200 if result['success'] else 400


# ==========================================
# IP ALLOWLIST/BLOCKLIST
# ==========================================
@security_bp.route('/ip-lists', methods=['GET'])
@jwt_required()
@admin_required
def get_ip_lists():
    """Get IP allowlist and blocklist."""
    result = SecurityService.get_ip_lists()
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/ip-lists/<list_type>', methods=['POST'])
@jwt_required()
@admin_required
def add_to_ip_list(list_type):
    """Add IP to allowlist or blocklist."""
    data = request.get_json()
    if not data or 'ip' not in data:
        return jsonify({'error': 'IP address required'}), 400

    comment = data.get('comment', '')
    result = SecurityService.add_to_ip_list(data['ip'], list_type, comment)
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/ip-lists/<list_type>/<ip>', methods=['DELETE'])
@jwt_required()
@admin_required
def remove_from_ip_list(list_type, ip):
    """Remove IP from allowlist or blocklist."""
    result = SecurityService.remove_from_ip_list(ip, list_type)
    return jsonify(result), 200 if result['success'] else 400


# ==========================================
# SECURITY AUDIT
# ==========================================
@security_bp.route('/audit', methods=['GET'])
@jwt_required()
@admin_required
def generate_audit():
    """Generate a security audit report."""
    result = SecurityService.generate_security_audit()
    return jsonify(result), 200 if result['success'] else 400


# ==========================================
# VULNERABILITY SCANNING (Lynis)
# ==========================================
@security_bp.route('/lynis/status', methods=['GET'])
@jwt_required()
@admin_required
def get_lynis_status():
    """Get Lynis installation status."""
    status = SecurityService.get_lynis_status()
    return jsonify(status), 200


@security_bp.route('/lynis/install', methods=['POST'])
@jwt_required()
@admin_required
def install_lynis():
    """Install Lynis."""
    result = SecurityService.install_lynis()
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/lynis/scan', methods=['POST'])
@jwt_required()
@admin_required
def run_lynis_scan():
    """Start a Lynis security scan."""
    result = SecurityService.run_lynis_scan()
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/lynis/scan/status', methods=['GET'])
@jwt_required()
@admin_required
def get_lynis_scan_status():
    """Get Lynis scan status."""
    status = SecurityService.get_lynis_scan_status()
    return jsonify(status), 200


# ==========================================
# AUTOMATIC UPDATES
# ==========================================
@security_bp.route('/auto-updates/status', methods=['GET'])
@jwt_required()
@admin_required
def get_auto_updates_status():
    """Get automatic updates status."""
    status = SecurityService.get_auto_updates_status()
    return jsonify(status), 200


@security_bp.route('/auto-updates/install', methods=['POST'])
@jwt_required()
@admin_required
def install_auto_updates():
    """Install automatic updates package."""
    result = SecurityService.install_auto_updates()
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/auto-updates/enable', methods=['POST'])
@jwt_required()
@admin_required
def enable_auto_updates():
    """Enable automatic security updates."""
    result = SecurityService.enable_auto_updates()
    return jsonify(result), 200 if result['success'] else 400


@security_bp.route('/auto-updates/disable', methods=['POST'])
@jwt_required()
@admin_required
def disable_auto_updates():
    """Disable automatic security updates."""
    result = SecurityService.disable_auto_updates()
    return jsonify(result), 200 if result['success'] else 400
