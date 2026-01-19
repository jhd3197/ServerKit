"""API endpoints for historical metrics data."""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.services.metrics_history_service import MetricsHistoryService

metrics_bp = Blueprint('metrics', __name__)


@metrics_bp.route('/history', methods=['GET'])
@jwt_required()
def get_metrics_history():
    """Get historical metrics data.

    Query params:
        period: 1h, 6h, 24h, 7d, 30d (default: 1h)

    Returns:
        JSON with time-series data points and summary statistics
    """
    period = request.args.get('period', '1h')

    # Validate period
    valid_periods = ['1h', '6h', '24h', '7d', '30d']
    if period not in valid_periods:
        return jsonify({
            'error': f"Invalid period. Must be one of: {', '.join(valid_periods)}"
        }), 400

    data = MetricsHistoryService.get_history(period)
    return jsonify(data), 200


@metrics_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_metrics_stats():
    """Get statistics about stored metrics data.

    Returns:
        JSON with record counts and date ranges per aggregation level
    """
    stats = MetricsHistoryService.get_stats()
    return jsonify({
        'stats': stats,
        'collection_running': MetricsHistoryService.is_running()
    }), 200


@metrics_bp.route('/collection/start', methods=['POST'])
@jwt_required()
def start_collection():
    """Start metrics collection (admin only).

    Returns:
        JSON with success status
    """
    from flask import current_app

    if MetricsHistoryService.is_running():
        return jsonify({'message': 'Collection already running'}), 200

    MetricsHistoryService.start_collection(current_app._get_current_object())
    return jsonify({'message': 'Collection started'}), 200


@metrics_bp.route('/collection/stop', methods=['POST'])
@jwt_required()
def stop_collection():
    """Stop metrics collection (admin only).

    Returns:
        JSON with success status
    """
    MetricsHistoryService.stop_collection()
    return jsonify({'message': 'Collection stopped'}), 200


@metrics_bp.route('/aggregate', methods=['POST'])
@jwt_required()
def trigger_aggregation():
    """Manually trigger data aggregation (admin only).

    Returns:
        JSON with aggregation results
    """
    hourly = MetricsHistoryService.aggregate_hourly()
    daily = MetricsHistoryService.aggregate_daily()
    cleanup = MetricsHistoryService.cleanup_old_data()

    return jsonify({
        'message': 'Aggregation complete',
        'hourly_created': hourly,
        'daily_created': daily,
        'cleaned_up': cleanup
    }), 200
