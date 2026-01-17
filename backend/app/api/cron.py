"""
Cron Job Management API

Endpoints for managing scheduled tasks and cron jobs.
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.services.cron_service import CronService

cron_bp = Blueprint('cron', __name__)


@cron_bp.route('/status', methods=['GET'])
@jwt_required()
def get_status():
    """Get cron service status."""
    status = CronService.get_status()
    return jsonify(status)


@cron_bp.route('/jobs', methods=['GET'])
@jwt_required()
def list_jobs():
    """List all cron jobs."""
    result = CronService.list_jobs()
    return jsonify(result)


@cron_bp.route('/jobs', methods=['POST'])
@jwt_required()
def create_job():
    """Create a new cron job."""
    data = request.get_json()

    schedule = data.get('schedule')
    command = data.get('command')
    name = data.get('name')
    description = data.get('description')

    if not schedule:
        return jsonify({'success': False, 'error': 'Schedule is required'}), 400

    if not command:
        return jsonify({'success': False, 'error': 'Command is required'}), 400

    result = CronService.add_job(
        schedule=schedule,
        command=command,
        name=name,
        description=description
    )

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@cron_bp.route('/jobs/<job_id>', methods=['DELETE'])
@jwt_required()
def delete_job(job_id):
    """Delete a cron job."""
    result = CronService.remove_job(job_id)

    if result.get('success'):
        return jsonify(result)
    return jsonify(result), 400


@cron_bp.route('/jobs/<job_id>/toggle', methods=['POST'])
@jwt_required()
def toggle_job(job_id):
    """Enable or disable a cron job."""
    data = request.get_json()
    enabled = data.get('enabled', True)

    result = CronService.toggle_job(job_id, enabled)

    if result.get('success'):
        return jsonify(result)
    return jsonify(result), 400


@cron_bp.route('/jobs/<job_id>/run', methods=['POST'])
@jwt_required()
def run_job(job_id):
    """Run a job immediately."""
    result = CronService.run_job_now(job_id)

    if result.get('success'):
        return jsonify(result)
    return jsonify(result), 400


@cron_bp.route('/presets', methods=['GET'])
@jwt_required()
def get_presets():
    """Get available schedule presets."""
    result = CronService.get_presets()
    return jsonify(result)
