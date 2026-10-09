# Bucket: PER-APP (plan 29 #9). Reads require app access (can_access_app); the
# enable/sync/redeploy/destroy mutations require write access (can_edit_app),
# replacing the old panel-wide @developer_required.
"""PR Preview Environments API.

Mounted by the host at ``/api/v1/apps`` so every route here is nested under an
application id, e.g. ``GET /api/v1/apps/<app_id>/previews``.
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.models import Application
from app.models.application_preview import ApplicationPreview
from app.services.preview_service import PreviewService
from app.services.resource_grant_service import ResourceGrantService
from app.middleware.rbac import get_current_user
from app.error_reporting import unexpected_response
from app.exceptions import not_found

previews_bp = Blueprint('previews', __name__)


def _get_app_or_404(app_id, write=False):
    """Resolve the app and enforce per-app access (plan 29 #9). ``write`` requires
    can_edit_app (owner/admin/editor); otherwise can_access_app (adds workspace
    members). A caller without the needed tier gets a sealed 404 (no leak)."""
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        raise not_found('service')
    user = get_current_user()
    ok = ResourceGrantService.can_edit_app(user, app) if write \
        else ResourceGrantService.can_access_app(user, app)
    if not ok:
        raise not_found('service')
    return app, None


@previews_bp.route('/<int:app_id>/previews', methods=['GET'])
@jwt_required()
def list_previews(app_id):
    """List the non-destroyed previews for an application (newest first)."""
    app, err = _get_app_or_404(app_id)
    if err:
        return err
    previews = ApplicationPreview.query.filter(
        ApplicationPreview.application_id == app_id,
        ApplicationPreview.status != ApplicationPreview.STATUS_DESTROYED,
    ).order_by(ApplicationPreview.pr_number.desc()).all()
    return jsonify({'previews': [p.to_dict() for p in previews]}), 200


@previews_bp.route('/<int:app_id>/previews/settings', methods=['GET'])
@jwt_required()
def get_preview_settings(app_id):
    """Return the per-app preview settings (defaults when never configured)."""
    app, err = _get_app_or_404(app_id)
    if err:
        return err
    settings = PreviewService.get_settings(app_id)
    return jsonify(settings.to_dict()), 200


@previews_bp.route('/<int:app_id>/previews/settings', methods=['PUT'])
@jwt_required()
def update_preview_settings(app_id):
    """Enable/disable previews and set the domain template + TTL for an app."""
    app, err = _get_app_or_404(app_id, write=True)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    try:
        result = PreviewService.enable_previews(app_id, data)
    except Exception as exc:  # pragma: no cover - defensive
        # Only a failed commit lands here: a crash, not the caller's mistake.
        return unexpected_response(exc)
    return jsonify(result), 200


@previews_bp.route('/<int:app_id>/previews/sync', methods=['POST'])
@jwt_required()
def sync_previews(app_id):
    """Reconcile this app's previews against its open PRs (best-effort)."""
    app, err = _get_app_or_404(app_id, write=True)
    if err:
        return err
    result = PreviewService.sync_previews(app_id)
    status = 400 if result.get('error') else 200
    return jsonify(result), status


@previews_bp.route('/<int:app_id>/previews/<int:preview_id>/redeploy', methods=['POST'])
@jwt_required()
def redeploy_preview(app_id, preview_id):
    """Re-provision a preview for the same PR (idempotent update-in-place)."""
    app, err = _get_app_or_404(app_id, write=True)
    if err:
        return err
    preview = ApplicationPreview.query.filter_by(
        id=preview_id, application_id=app_id).first()
    if not preview:
        return jsonify({'error': 'Preview not found'}), 404
    result = PreviewService.create_preview(app, {
        'pr_number': preview.pr_number,
        'branch': preview.branch,
        'pr_title': preview.pr_title,
        'commit_sha': preview.commit_sha,
    })
    status = 400 if result.get('error') else 200
    return jsonify(result), status


@previews_bp.route('/<int:app_id>/previews/<int:preview_id>', methods=['DELETE'])
@jwt_required()
def destroy_preview(app_id, preview_id):
    """Tear down and mark a preview destroyed."""
    app, err = _get_app_or_404(app_id, write=True)
    if err:
        return err
    preview = ApplicationPreview.query.filter_by(
        id=preview_id, application_id=app_id).first()
    if not preview:
        return jsonify({'error': 'Preview not found'}), 404
    result = PreviewService.destroy_preview(preview_id)
    status = 400 if result.get('error') else 200
    return jsonify(result), status
