"""
Uptime Tracking API

Endpoints for server uptime monitoring and statistics.
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.services.uptime_service import UptimeService

uptime_bp = Blueprint('uptime', __name__)


@uptime_bp.route('/current', methods=['GET'])
@jwt_required()
def get_current_uptime():
    """Get current server uptime."""
    uptime = UptimeService.get_current_uptime()
    return jsonify(uptime)


@uptime_bp.route('/stats', methods=['GET'])
@jwt_required()
def get_uptime_stats():
    """Get comprehensive uptime statistics."""
    stats = UptimeService.get_uptime_stats()
    return jsonify(stats)


@uptime_bp.route('/graph', methods=['GET'])
@jwt_required()
def get_uptime_graph():
    """
    Get uptime graph data.

    Query params:
        period: '24h', '7d', '30d', '90d' (default: '24h')
    """
    period = request.args.get('period', '24h')
    if period not in ['24h', '7d', '30d', '90d']:
        period = '24h'

    data = UptimeService.get_uptime_graph_data(period)
    return jsonify(data)


@uptime_bp.route('/history', methods=['GET'])
@jwt_required()
def get_uptime_history():
    """
    Get uptime check history.

    Query params:
        hours: Number of hours to look back (default: 24)
    """
    hours = request.args.get('hours', 24, type=int)
    hours = min(max(hours, 1), 24 * 90)  # Limit to 90 days

    history = UptimeService.get_uptime_history(hours)
    return jsonify({
        'hours': hours,
        'checks': history,
        'total': len(history)
    })


@uptime_bp.route('/tracking/start', methods=['POST'])
@jwt_required()
def start_tracking():
    """Start uptime tracking."""
    result = UptimeService.start_tracking()
    if result.get('success'):
        return jsonify(result)
    return jsonify(result), 400


@uptime_bp.route('/tracking/stop', methods=['POST'])
@jwt_required()
def stop_tracking():
    """Stop uptime tracking."""
    result = UptimeService.stop_tracking()
    return jsonify(result)


@uptime_bp.route('/tracking/status', methods=['GET'])
@jwt_required()
def get_tracking_status():
    """Get uptime tracking status."""
    return jsonify({
        'is_tracking': UptimeService.is_tracking()
    })
