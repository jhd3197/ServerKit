"""
Fleet Monitor API

Endpoints for fleet-wide monitoring: heatmaps, comparisons,
alert thresholds, anomaly detection, capacity forecasting,
fleet search, and metrics export.
"""

from flask import Blueprint, request, jsonify, Response
from flask_jwt_extended import jwt_required

from app.services.fleet_monitor_service import fleet_monitor_service
from app.middleware.rbac import admin_required, get_current_user
from app.api._request import json_object
from app.api.servers import _get_operable_server

fleet_monitor_bp = Blueprint('fleet_monitor', __name__)


# ==================== Heatmap ====================

@fleet_monitor_bp.route('/heatmap', methods=['GET'])
@jwt_required()
def get_fleet_heatmap():
    """Get latest metrics for all servers in heatmap format."""
    group_id = request.args.get('group_id')
    return jsonify(fleet_monitor_service.get_fleet_heatmap(group_id))


# ==================== Comparison ====================

@fleet_monitor_bp.route('/comparison', methods=['GET'])
@jwt_required()
def get_comparison():
    """Get multi-server comparison time-series."""
    ids_param = request.args.get('ids', '')
    server_ids = [s.strip() for s in ids_param.split(',') if s.strip()]
    metric = request.args.get('metric', 'cpu')
    period = request.args.get('period', '24h')

    if not server_ids:
        return jsonify({'error': 'ids parameter is required'}), 400

    return jsonify(fleet_monitor_service.get_comparison_timeseries(server_ids, metric, period))


# ==================== Alerts ====================

@fleet_monitor_bp.route('/alerts', methods=['GET'])
@jwt_required()
def get_alerts():
    """Get metric alerts."""
    status = request.args.get('status')
    severity = request.args.get('severity')
    server_id = request.args.get('server_id')
    limit = request.args.get('limit', 50, type=int)

    return jsonify(fleet_monitor_service.get_alerts(status, severity, server_id, limit))


@fleet_monitor_bp.route('/alerts/<alert_id>/acknowledge', methods=['POST'])
@admin_required
def acknowledge_alert(alert_id):
    """Acknowledge an active alert."""
    # Through the one identity door: @admin_required admits API-key callers,
    # for whom reading the JWT directly raises.
    caller = get_current_user()
    user_id = caller.id if caller else None
    success = fleet_monitor_service.acknowledge_alert(alert_id, user_id)
    if not success:
        return jsonify({'error': 'Cannot acknowledge alert'}), 400
    return jsonify({'success': True})


@fleet_monitor_bp.route('/alerts/<alert_id>/resolve', methods=['POST'])
@admin_required
def resolve_alert(alert_id):
    """Resolve an alert."""
    success = fleet_monitor_service.resolve_alert(alert_id)
    if not success:
        return jsonify({'error': 'Cannot resolve alert'}), 400
    return jsonify({'success': True})


# ==================== Thresholds ====================

@fleet_monitor_bp.route('/thresholds', methods=['GET'])
@jwt_required()
def get_thresholds():
    """Get alert thresholds."""
    server_id = request.args.get('server_id')
    return jsonify(fleet_monitor_service.get_thresholds(server_id))


@fleet_monitor_bp.route('/thresholds', methods=['POST'])
@admin_required
def create_threshold():
    """Create or update an alert threshold."""
    data = json_object()
    result = fleet_monitor_service.upsert_threshold(data)
    if 'error' in result:
        return jsonify(result), 400
    return jsonify(result), 201


@fleet_monitor_bp.route('/thresholds/<threshold_id>', methods=['DELETE'])
@admin_required
def delete_threshold(threshold_id):
    """Delete an alert threshold."""
    success = fleet_monitor_service.delete_threshold(threshold_id)
    if not success:
        return jsonify({'error': 'Threshold not found'}), 404
    return jsonify({'success': True})


# ==================== Anomalies ====================

@fleet_monitor_bp.route('/anomalies', methods=['GET'])
@jwt_required()
def get_anomalies():
    """Get anomaly detection results."""
    server_id = request.args.get('server_id')
    return jsonify(fleet_monitor_service.detect_anomalies(server_id))


# ==================== Capacity Forecast ====================

@fleet_monitor_bp.route('/forecast/<server_id>', methods=['GET'])
@jwt_required()
def get_forecast(server_id):
    """Get capacity forecast for a server."""
    _get_operable_server(server_id)
    metric = request.args.get('metric', 'disk')
    return jsonify(fleet_monitor_service.forecast_capacity(server_id, metric))


# ==================== Fleet Search ====================

@fleet_monitor_bp.route('/search', methods=['GET'])
@jwt_required()
def search_fleet():
    """Search across fleet for servers, containers, services, ports."""
    query = request.args.get('q', '')
    search_type = request.args.get('type', 'any')

    if not query or len(query) < 2:
        return jsonify({'error': 'Query must be at least 2 characters'}), 400

    return jsonify(fleet_monitor_service.search_fleet(query, search_type))


# ==================== Export ====================

@fleet_monitor_bp.route('/export/csv', methods=['GET'])
@jwt_required()
def export_csv():
    """Export metrics as CSV download."""
    ids_param = request.args.get('ids', '')
    server_ids = [s.strip() for s in ids_param.split(',') if s.strip()]
    metric = request.args.get('metric', 'cpu')
    period = request.args.get('period', '24h')

    if not server_ids:
        return jsonify({'error': 'ids parameter is required'}), 400

    csv_data = fleet_monitor_service.export_metrics_csv(server_ids, metric, period)
    return Response(
        csv_data,
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename=fleet_{metric}_{period}.csv'}
    )


@fleet_monitor_bp.route('/export/json', methods=['GET'])
@jwt_required()
def export_json():
    """Export metrics as JSON."""
    ids_param = request.args.get('ids', '')
    server_ids = [s.strip() for s in ids_param.split(',') if s.strip()]
    metric = request.args.get('metric', 'cpu')
    period = request.args.get('period', '24h')

    if not server_ids:
        return jsonify({'error': 'ids parameter is required'}), 400

    return jsonify(fleet_monitor_service.get_comparison_timeseries(server_ids, metric, period))


# ==================== Prometheus ====================

@fleet_monitor_bp.route('/prometheus', methods=['GET'])
def prometheus_metrics():
    """Prometheus-compatible metrics endpoint (no JWT, uses token param).

    Accepts ``PROMETHEUS_TOKEN`` from the environment or the panel's own scrape
    token, the one the Prometheus template is installed with.
    """
    from app.services import metrics_token_service
    token = request.args.get('token') or request.headers.get('X-Prometheus-Token')
    if not metrics_token_service.is_valid(token):
        return Response('Unauthorized', status=401)

    metrics = fleet_monitor_service.get_prometheus_metrics()
    return Response(metrics, mimetype='text/plain; version=0.0.4; charset=utf-8')
