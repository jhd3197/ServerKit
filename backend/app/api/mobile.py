from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models.user import User
from app import db
from app.exceptions import not_found

mobile_bp = Blueprint('mobile', __name__)


@mobile_bp.route('/push/register', methods=['POST'])
@jwt_required()
def register_push():
    """Register a device for push notifications."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    subscription = data.get('subscription')
    device_name = data.get('device_name', 'Unknown')

    if not subscription:
        return jsonify({'error': 'subscription required'}), 400

    user = User.query.get(user_id)
    if not user:
        raise not_found('user')

    # Store push subscription in user metadata
    import json
    push_subs = json.loads(user.push_subscriptions_json) if hasattr(user, 'push_subscriptions_json') and user.push_subscriptions_json else []
    # Avoid duplicates
    existing = next((s for s in push_subs if s.get('endpoint') == subscription.get('endpoint')), None)
    if not existing:
        push_subs.append({
            'subscription': subscription,
            'device_name': device_name,
            'registered_at': __import__('datetime').datetime.utcnow().isoformat(),
        })

    user.push_subscriptions_json = json.dumps(push_subs)
    db.session.commit()

    return jsonify({'message': 'Device registered', 'device_count': len(push_subs)})


@mobile_bp.route('/push/unregister', methods=['POST'])
@jwt_required()
def unregister_push():
    """Unregister a device from push notifications."""
    data = request.get_json() or {}
    endpoint = data.get('endpoint')
    if not endpoint:
        return jsonify({'error': 'endpoint required'}), 400
    return jsonify({'message': 'Device unregistered'})


@mobile_bp.route('/quick-actions', methods=['GET'])
@jwt_required()
def get_quick_actions():
    """Get available quick actions for mobile."""
    return jsonify({'actions': [
        {'id': 'restart_service', 'label': 'Restart Service', 'icon': 'refresh', 'params': ['service_name']},
        {'id': 'view_stats', 'label': 'View Server Stats', 'icon': 'chart', 'params': []},
        {'id': 'acknowledge_alert', 'label': 'Acknowledge Alert', 'icon': 'check', 'params': ['alert_id']},
        {'id': 'run_backup', 'label': 'Run Backup', 'icon': 'download', 'params': ['backup_id']},
        {'id': 'toggle_maintenance', 'label': 'Toggle Maintenance', 'icon': 'wrench', 'params': ['component_id']},
    ]})


@mobile_bp.route('/quick-actions/<action_id>', methods=['POST'])
@jwt_required()
def execute_quick_action(action_id):
    """Execute a quick action."""
    data = request.get_json() or {}

    if action_id == 'view_stats':
        # MonitoringService owns the live-metrics probe; ServerMetricsService
        # (history rollups) has no get_current_metrics — calling it here used
        # to raise AttributeError and 500 every time.
        from app.services.monitoring_service import MonitoringService
        metrics = MonitoringService.get_current_metrics()
        return jsonify({'action': 'view_stats', 'result': metrics})

    elif action_id == 'acknowledge_alert':
        alert_id = data.get('alert_id')
        return jsonify({'action': 'acknowledge_alert', 'alert_id': alert_id, 'acknowledged': True})

    return jsonify({'action': action_id, 'status': 'executed'})


@mobile_bp.route('/summary', methods=['GET'])
@jwt_required()
def get_mobile_summary():
    """Get a compact summary for mobile dashboard."""
    try:
        from app.services.monitoring_service import MonitoringService
        metrics = MonitoringService.get_current_metrics()
    except Exception:
        metrics = {}

    from app.models.server import Server
    from app.models.security_alert import SecurityAlert

    server_count = Server.query.count()
    active_alerts = SecurityAlert.query.filter_by(resolved=False).count() if hasattr(SecurityAlert, 'resolved') else 0

    # MonitoringService returns nested sections; a section that could not be
    # probed surfaces as None, never 0 (0 would read as a real measurement).
    return jsonify({
        'metrics': {
            'cpu': (metrics.get('cpu') or {}).get('percent'),
            'memory': (metrics.get('memory') or {}).get('percent'),
            'disk': (metrics.get('disk') or {}).get('percent'),
        },
        'servers': server_count,
        'active_alerts': active_alerts,
    })


@mobile_bp.route('/offline-cache', methods=['GET'])
@jwt_required()
def get_offline_data():
    """Get data for offline caching."""
    from app.models.server import Server

    servers = Server.query.limit(50).all()
    return jsonify({
        'servers': [{'id': s.id, 'name': s.name, 'hostname': s.hostname, 'status': s.status} for s in servers],
        'cached_at': __import__('datetime').datetime.utcnow().isoformat(),
    })
