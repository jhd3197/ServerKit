"""Recycle Bin — list, restore and purge soft-deleted records.

Type-agnostic on purpose: every route works off a `kind` registered in
recycle_bin_service, so adding a soft-deletable model needs no change here.
"""
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.middleware.rbac import admin_required
from app.exceptions import NotFoundError
from app.services import recycle_bin_service

recycle_bin_bp = Blueprint('recycle_bin', __name__)


@recycle_bin_bp.route('', methods=['GET'])
@jwt_required()
def list_deleted():
    """Everything currently in the bin, newest deletion first."""
    kind = request.args.get('kind', '').strip() or None
    if kind and kind not in recycle_bin_service.registered_kinds():
        return jsonify({'error': f'Unknown kind: {kind}'}), 400
    try:
        limit = min(int(request.args.get('limit', 200)), 500)
    except (TypeError, ValueError):
        limit = 200
    return jsonify({
        'items': recycle_bin_service.list_deleted(kind=kind, limit=limit),
        'kinds': recycle_bin_service.registered_kinds(),
        'retention_days': recycle_bin_service.DEFAULT_RETENTION_DAYS,
    })


@recycle_bin_bp.route('/<kind>/<int:record_id>/restore', methods=['POST'])
@admin_required
def restore(kind, record_id):
    try:
        item, err = recycle_bin_service.restore(kind, record_id)
    except KeyError:
        return jsonify({'error': f'Unknown kind: {kind}'}), 400
    if item is None:
        return jsonify({'error': err or 'not found'}), 404
    # A non-null err with an item means the row came back but a side effect
    # (re-writing a vhost, say) failed — a warning, not a failure.
    return jsonify({'item': item, 'warning': err}), 200


@recycle_bin_bp.route('/<kind>/<int:record_id>', methods=['DELETE'])
@admin_required
def purge(kind, record_id):
    """Delete for real. Admin-only: this is the one irreversible action."""
    try:
        ok, err = recycle_bin_service.purge(kind, record_id)
    except KeyError:
        return jsonify({'error': f'Unknown kind: {kind}'}), 400
    if not ok:
        if err is recycle_bin_service.PURGE_NOT_FOUND:
            raise NotFoundError('Item not found in the recycle bin')
        return jsonify({'error': err}), 400
    return jsonify({'success': True})


@recycle_bin_bp.route('/purge-expired', methods=['POST'])
@admin_required
def purge_expired():
    body = request.get_json(silent=True) or {}
    days = body.get('retention_days', recycle_bin_service.DEFAULT_RETENTION_DAYS)
    try:
        days = max(1, int(days))
    except (TypeError, ValueError):
        days = recycle_bin_service.DEFAULT_RETENTION_DAYS
    return jsonify({'purged': recycle_bin_service.purge_expired(days)})
