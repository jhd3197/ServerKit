"""API analytics endpoints."""
from flask import Blueprint, jsonify, request
from app.middleware.rbac import admin_required, auth_required, get_current_user
from app.services.api_analytics_service import ApiAnalyticsService
from app.services.api_key_service import ApiKeyService
from app.exceptions import permission_denied

api_analytics_bp = Blueprint('api_analytics', __name__)


@api_analytics_bp.route('/overview', methods=['GET'])
@admin_required
def overview():
    """Get API usage overview."""
    period = request.args.get('period', '24h')
    return jsonify(ApiAnalyticsService.get_overview(period))


@api_analytics_bp.route('/endpoints', methods=['GET'])
@admin_required
def endpoints():
    """Get top endpoints by usage."""
    period = request.args.get('period', '24h')
    limit = request.args.get('limit', 20, type=int)
    return jsonify({'endpoints': ApiAnalyticsService.get_endpoint_stats(period, limit)})


@api_analytics_bp.route('/errors', methods=['GET'])
@admin_required
def errors():
    """Get error breakdown."""
    period = request.args.get('period', '24h')
    return jsonify({'errors': ApiAnalyticsService.get_error_stats(period)})


@api_analytics_bp.route('/timeseries', methods=['GET'])
@admin_required
def timeseries():
    """Get time series data for charts."""
    period = request.args.get('period', '24h')
    interval = request.args.get('interval', 'hour')
    return jsonify({'data': ApiAnalyticsService.get_time_series(period, interval)})


@api_analytics_bp.route('/keys/<int:key_id>/usage', methods=['GET'])
@auth_required()
def key_usage(key_id):
    """Get usage stats for a specific API key."""
    period = request.args.get('period', '24h')

    # Allow key owners to view their own usage
    user = get_current_user()
    api_key = ApiKeyService.get_key(key_id)
    if not api_key:
        return jsonify({'error': 'API key not found'}), 404

    if not user.is_admin and api_key.user_id != user.id:
        raise permission_denied()

    return jsonify(ApiAnalyticsService.get_key_usage(key_id, period))
