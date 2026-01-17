from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User
from app.services.monitoring_service import MonitoringService

monitoring_bp = Blueprint('monitoring', __name__)


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


@monitoring_bp.route('/status', methods=['GET'])
@jwt_required()
def get_status():
    """Get monitoring status and current metrics."""
    status = MonitoringService.get_status()
    return jsonify(status), 200


@monitoring_bp.route('/metrics', methods=['GET'])
@jwt_required()
def get_metrics():
    """Get current system metrics."""
    metrics = MonitoringService.get_current_metrics()
    return jsonify(metrics), 200


@monitoring_bp.route('/alerts/check', methods=['GET'])
@jwt_required()
def check_alerts():
    """Check current threshold violations."""
    alerts = MonitoringService.check_thresholds()
    return jsonify({'alerts': alerts}), 200


@monitoring_bp.route('/alerts/history', methods=['GET'])
@jwt_required()
def get_alert_history():
    """Get alert history."""
    limit = request.args.get('limit', 100, type=int)
    alerts = MonitoringService.get_alert_history(limit)
    return jsonify({'alerts': alerts}), 200


@monitoring_bp.route('/alerts/history', methods=['DELETE'])
@jwt_required()
@admin_required
def clear_alert_history():
    """Clear alert history."""
    result = MonitoringService.clear_alert_history()
    return jsonify(result), 200 if result['success'] else 400


@monitoring_bp.route('/config', methods=['GET'])
@jwt_required()
@admin_required
def get_config():
    """Get monitoring configuration."""
    config = MonitoringService.get_config()
    # Don't expose sensitive data
    if 'email' in config and 'smtp_password' in config['email']:
        config['email']['smtp_password'] = '***' if config['email']['smtp_password'] else ''
    return jsonify(config), 200


@monitoring_bp.route('/config', methods=['PUT'])
@jwt_required()
@admin_required
def update_config():
    """Update monitoring configuration."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    current_config = MonitoringService.get_config()

    # Update config with new values
    if 'thresholds' in data:
        current_config['thresholds'] = {**current_config.get('thresholds', {}), **data['thresholds']}

    if 'check_interval' in data:
        current_config['check_interval'] = data['check_interval']

    if 'email' in data:
        email_config = current_config.get('email', {})
        new_email = data['email']

        # Preserve password if not provided or masked
        if new_email.get('smtp_password') in [None, '', '***']:
            new_email['smtp_password'] = email_config.get('smtp_password', '')

        current_config['email'] = {**email_config, **new_email}

    if 'webhook' in data:
        current_config['webhook'] = {**current_config.get('webhook', {}), **data['webhook']}

    result = MonitoringService.save_config(current_config)
    return jsonify(result), 200 if result['success'] else 400


@monitoring_bp.route('/thresholds', methods=['GET'])
@jwt_required()
def get_thresholds():
    """Get alert thresholds."""
    thresholds = MonitoringService.get_thresholds()
    return jsonify({'thresholds': thresholds}), 200


@monitoring_bp.route('/thresholds', methods=['PUT'])
@jwt_required()
@admin_required
def update_thresholds():
    """Update alert thresholds."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    result = MonitoringService.set_thresholds(data)
    return jsonify(result), 200 if result['success'] else 400


@monitoring_bp.route('/start', methods=['POST'])
@jwt_required()
@admin_required
def start_monitoring():
    """Start background monitoring."""
    result = MonitoringService.start_monitoring()
    return jsonify(result), 200 if result['success'] else 400


@monitoring_bp.route('/stop', methods=['POST'])
@jwt_required()
@admin_required
def stop_monitoring():
    """Stop background monitoring."""
    result = MonitoringService.stop_monitoring()
    return jsonify(result), 200 if result['success'] else 400


@monitoring_bp.route('/test/email', methods=['POST'])
@jwt_required()
@admin_required
def test_email_alert():
    """Send a test email alert."""
    test_alerts = [{
        'type': 'test',
        'severity': 'info',
        'message': 'This is a test alert from ServerKit',
        'value': 0,
        'threshold': 0
    }]
    result = MonitoringService.send_email_alert(test_alerts)
    return jsonify(result), 200 if result['success'] else 400


@monitoring_bp.route('/test/webhook', methods=['POST'])
@jwt_required()
@admin_required
def test_webhook_alert():
    """Send a test webhook alert."""
    test_alerts = [{
        'type': 'test',
        'severity': 'info',
        'message': 'This is a test alert from ServerKit',
        'value': 0,
        'threshold': 0
    }]
    result = MonitoringService.send_webhook_alert(test_alerts)
    return jsonify(result), 200 if result['success'] else 400
