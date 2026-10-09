"""Host-port checks for the panel's port inputs. Mounted at ``/api/v1/ports``.

  GET /check?port=<n>     — valid / free / privileged, and who holds it
  GET /suggest?start=<n>  — the next free port at or above ``start``

Read-only. Developer role, the same as deploying the app that would use it.
"""
from flask import Blueprint, jsonify, request

from app.middleware.rbac import developer_required
from app.services import port_service

ports_bp = Blueprint('ports', __name__)


@ports_bp.route('/check', methods=['GET'])
@developer_required
def check_port():
    return jsonify(port_service.check_port(request.args.get('port'))), 200


@ports_bp.route('/suggest', methods=['GET'])
@developer_required
def suggest_port():
    return jsonify({'port': port_service.suggest_port(request.args.get('start', 8000))}), 200
