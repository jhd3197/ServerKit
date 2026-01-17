"""Firewall API endpoints for managing firewalld and ufw."""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from ..services.firewall_service import FirewallService

firewall_bp = Blueprint('firewall', __name__)


@firewall_bp.route('/status', methods=['GET'])
@jwt_required()
def get_status():
    """Get firewall status."""
    result = FirewallService.get_status()
    return jsonify(result), 200


@firewall_bp.route('/enable', methods=['POST'])
@jwt_required()
def enable_firewall():
    """Enable the firewall."""
    data = request.get_json() or {}
    firewall = data.get('firewall')

    result = FirewallService.enable(firewall)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@firewall_bp.route('/disable', methods=['POST'])
@jwt_required()
def disable_firewall():
    """Disable the firewall."""
    data = request.get_json() or {}
    firewall = data.get('firewall')

    result = FirewallService.disable(firewall)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@firewall_bp.route('/rules', methods=['GET'])
@jwt_required()
def get_rules():
    """Get all firewall rules."""
    firewall = request.args.get('firewall')
    result = FirewallService.get_rules(firewall)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@firewall_bp.route('/rules', methods=['POST'])
@jwt_required()
def add_rule():
    """Add a firewall rule."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body required'}), 400

    rule_type = data.get('type')
    if not rule_type:
        return jsonify({'success': False, 'error': 'Rule type required'}), 400

    # Extract parameters based on rule type
    kwargs = {k: v for k, v in data.items() if k != 'type'}

    result = FirewallService.add_rule(rule_type, **kwargs)

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@firewall_bp.route('/rules', methods=['DELETE'])
@jwt_required()
def remove_rule():
    """Remove a firewall rule."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body required'}), 400

    rule_type = data.get('type')
    if not rule_type:
        return jsonify({'success': False, 'error': 'Rule type required'}), 400

    kwargs = {k: v for k, v in data.items() if k != 'type'}

    result = FirewallService.remove_rule(rule_type, **kwargs)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@firewall_bp.route('/block-ip', methods=['POST'])
@jwt_required()
def block_ip():
    """Quick block an IP address."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body required'}), 400

    ip = data.get('ip')
    if not ip:
        return jsonify({'success': False, 'error': 'IP address required'}), 400

    permanent = data.get('permanent', True)

    result = FirewallService.block_ip(ip, permanent)

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@firewall_bp.route('/unblock-ip', methods=['POST'])
@jwt_required()
def unblock_ip():
    """Unblock an IP address."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body required'}), 400

    ip = data.get('ip')
    if not ip:
        return jsonify({'success': False, 'error': 'IP address required'}), 400

    permanent = data.get('permanent', True)

    result = FirewallService.unblock_ip(ip, permanent)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@firewall_bp.route('/blocked-ips', methods=['GET'])
@jwt_required()
def get_blocked_ips():
    """Get list of blocked IP addresses."""
    result = FirewallService.get_blocked_ips()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@firewall_bp.route('/allow-port', methods=['POST'])
@jwt_required()
def allow_port():
    """Allow a port through the firewall."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body required'}), 400

    port = data.get('port')
    if not port:
        return jsonify({'success': False, 'error': 'Port number required'}), 400

    protocol = data.get('protocol', 'tcp')
    permanent = data.get('permanent', True)

    result = FirewallService.allow_port(port, protocol, permanent)

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@firewall_bp.route('/deny-port', methods=['POST'])
@jwt_required()
def deny_port():
    """Remove a port from the firewall."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body required'}), 400

    port = data.get('port')
    if not port:
        return jsonify({'success': False, 'error': 'Port number required'}), 400

    protocol = data.get('protocol', 'tcp')
    permanent = data.get('permanent', True)

    result = FirewallService.deny_port(port, protocol, permanent)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@firewall_bp.route('/zones', methods=['GET'])
@jwt_required()
def get_zones():
    """Get firewalld zones."""
    result = FirewallService.get_zones()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@firewall_bp.route('/zones/default', methods=['POST'])
@jwt_required()
def set_default_zone():
    """Set default firewalld zone."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body required'}), 400

    zone = data.get('zone')
    if not zone:
        return jsonify({'success': False, 'error': 'Zone name required'}), 400

    result = FirewallService.set_default_zone(zone)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@firewall_bp.route('/install', methods=['POST'])
@jwt_required()
def install_firewall():
    """Install a firewall (ufw or firewalld)."""
    data = request.get_json() or {}
    firewall = data.get('firewall', 'ufw')

    result = FirewallService.install_firewall(firewall)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400
