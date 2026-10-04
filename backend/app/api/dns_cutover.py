"""Reversible DNS cutover endpoints (``/api/v1/dns-cutover``).

Snapshot a domain's live provider records, perform (or dry-run) a cutover that
repoints them at the imported site's new address, verify propagation across
public resolvers, and revert — restoring the pre-cutover world byte-for-byte.

Read verbs (ttl-guidance, list/get snapshots, verify) are open to any
authenticated user; the mutating verbs (snapshot, cutover, revert) are
admin-only (plan 31 #1/#2/#3).
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.services.dns_cutover_service import DnsCutoverService, DnsCutoverError
from app.middleware.rbac import require_admin_user
from app.exceptions import not_found

dns_cutover_bp = Blueprint('dns_cutover', __name__)


def _cutover_error(exc):
    """Render a DnsCutoverError, naming the provider when it carries one so a
    ``NO_PROVIDER`` tells the operator which provider is unsupported."""
    body = {'error': exc.message, 'code': exc.code}
    if getattr(exc, 'provider', None):
        body['provider'] = exc.provider
    return jsonify(body), exc.status_code


@dns_cutover_bp.route('/ttl-guidance', methods=['POST'])
@jwt_required()
def ttl_guidance():
    data = request.get_json(silent=True) or {}
    return jsonify(DnsCutoverService.ttl_guidance(data.get('records') or []))


@dns_cutover_bp.route('/snapshot', methods=['POST'])
@jwt_required()
def create_snapshot():
    require_admin_user()
    data = request.get_json(silent=True) or {}
    try:
        snapshot = DnsCutoverService.create_snapshot(
            domain=data.get('domain'),
            provider_zone_id=data.get('provider_zone_id'),
            provider=data.get('provider'),
            names=data.get('names'))
        return jsonify(snapshot.to_dict()), 201
    except DnsCutoverError as exc:
        return _cutover_error(exc)


@dns_cutover_bp.route('/snapshots', methods=['GET'])
@jwt_required()
def list_snapshots():
    domain = request.args.get('domain')
    snapshots = DnsCutoverService.list_snapshots(domain)
    return jsonify({'snapshots': [s.to_dict() for s in snapshots]})


@dns_cutover_bp.route('/snapshots/<int:snapshot_id>', methods=['GET'])
@jwt_required()
def get_snapshot(snapshot_id):
    snapshot = DnsCutoverService.get_snapshot(snapshot_id)
    if not snapshot:
        raise not_found('snapshot')
    return jsonify(snapshot.to_dict())


@dns_cutover_bp.route('/cutover', methods=['POST'])
@jwt_required()
def cutover():
    require_admin_user()
    data = request.get_json(silent=True) or {}
    snapshot_id = data.get('snapshot_id')
    if not snapshot_id:
        return jsonify({'error': 'snapshot_id is required — a cutover needs a '
                                 'snapshot so it can be reverted'}), 400
    snapshot = DnsCutoverService.get_snapshot(snapshot_id)
    if not snapshot:
        raise not_found('snapshot')
    try:
        result = DnsCutoverService.cutover(
            snapshot, target=data.get('target'),
            record_types=data.get('record_types') or ['A'],
            dry_run=bool(data.get('dry_run')))
        return jsonify(result)
    except DnsCutoverError as exc:
        return _cutover_error(exc)


@dns_cutover_bp.route('/verify', methods=['POST'])
@jwt_required()
def verify():
    data = request.get_json(silent=True) or {}
    try:
        result = DnsCutoverService.verify(
            domain=data.get('domain'),
            record_type=data.get('record_type') or 'A',
            expected=data.get('expected'),
            snapshot_id=data.get('snapshot_id'))
        return jsonify(result)
    except DnsCutoverError as exc:
        return _cutover_error(exc)


@dns_cutover_bp.route('/snapshots/<int:snapshot_id>/revert', methods=['POST'])
@jwt_required()
def revert(snapshot_id):
    require_admin_user()
    snapshot = DnsCutoverService.get_snapshot(snapshot_id)
    if not snapshot:
        raise not_found('snapshot')
    try:
        result = DnsCutoverService.revert(snapshot)
        return jsonify(result)
    except DnsCutoverError as exc:
        return _cutover_error(exc)
