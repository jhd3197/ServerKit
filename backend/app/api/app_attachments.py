# Bucket: PER-APP (plan 29 #9). Reads gate on can_access_app; attach/detach
# gate on can_edit_app for the app AND can_access_app for the service used.
"""Attach services an app uses (plan 86 §C2/§C4). Mounted under ``/api/v1/apps``.

  GET    /<app_id>/attachments                 — this app's attachments
  GET    /attachments/services?kind=<kind>     — installed services for a kind
  POST   /<app_id>/attachments/<kind>          — {service_app_id}; kind is
                                                 storage, cache or queue
  DELETE /<app_id>/attachments/<attachment_id> — detach (keeps the bucket)

Attach and detach change the app's env; it applies on the next deploy or
restart, so responses say ``redeploy_required``.
"""
from flask import Blueprint, jsonify, request

from app.exceptions import NotFoundError, ValidationError, not_found
from app.middleware.rbac import developer_required, get_current_user, viewer_required
from app.models.app_attachment import AppAttachment
from app.services.app_attachment_service import (
    FAILURE_MODES, AppAttachmentService, AttachmentError)
from app.services.resource_grant_service import ResourceGrantService

app_attachments_bp = Blueprint('app_attachments', __name__)


@app_attachments_bp.route('/<int:app_id>/attachments', methods=['GET'])
@viewer_required
def list_attachments(app_id):
    app = AppAttachmentService.live_app(app_id)
    if app is None or not ResourceGrantService.can_access_app(get_current_user(), app):
        raise not_found('service')
    return jsonify({'attachments': [a.to_dict() for a in AppAttachmentService.list_for_app(app)],
                    'kinds': AppAttachmentService.kinds_for(app)})


def _kind_or_400(kind):
    if kind not in AppAttachment.KINDS:
        raise ValidationError(f"kind must be one of: {', '.join(AppAttachment.KINDS)}")
    return kind


@app_attachments_bp.route('/attachments/services', methods=['GET'])
@viewer_required
def list_services():
    kind = _kind_or_400(request.args.get('kind', ''))
    user = get_current_user()
    services = [s for s in AppAttachmentService.services_for(kind)
                if ResourceGrantService.can_access_app(user, s)]
    return jsonify({'kind': kind, 'failure_mode': FAILURE_MODES.get(kind),
                    'services': [{'id': s.id, 'name': s.name, 'status': s.status}
                                 for s in services]})


@app_attachments_bp.route('/<int:app_id>/attachments/<kind>', methods=['POST'])
@developer_required
def attach_service(app_id, kind):
    user = get_current_user()
    app = AppAttachmentService.live_app(app_id)
    if app is None or not ResourceGrantService.can_edit_app(user, app):
        raise not_found('service')
    data = request.get_json(silent=True) or {}
    service_app_id = data.get('service_app_id')
    if not isinstance(service_app_id, int) or isinstance(service_app_id, bool):
        raise ValidationError("'service_app_id' is required")
    kind = _kind_or_400(kind)
    service = AppAttachmentService.live_app(service_app_id)
    if service is None or not ResourceGrantService.can_access_app(user, service):
        raise not_found('service')
    try:
        row, created = AppAttachmentService.attach(app, service, kind, user_id=user.id)
    except AttachmentError as exc:
        raise ValidationError(str(exc)) from exc
    return jsonify({'attachment': row.to_dict(), 'redeploy_required': created}), (201 if created else 200)


@app_attachments_bp.route('/<int:app_id>/attachments/<int:attachment_id>', methods=['DELETE'])
@developer_required
def detach(app_id, attachment_id):
    user = get_current_user()
    app = AppAttachmentService.live_app(app_id)
    if app is None or not ResourceGrantService.can_edit_app(user, app):
        raise not_found('service')
    attachment = AppAttachmentService.get(app, attachment_id)
    if attachment is None:
        raise NotFoundError('Attachment not found')
    warning = AppAttachmentService.detach(attachment, user_id=user.id)
    body = {'success': True, 'redeploy_required': True}
    if warning:
        body['warning'] = warning
    return jsonify(body)


# ==================== CONNECTION POOLING (plan 86 §D1) ====================

@app_attachments_bp.route('/<int:app_id>/pooler', methods=['GET'])
@viewer_required
def get_pooler(app_id):
    from app.services import pooler_service
    app = AppAttachmentService.live_app(app_id)
    if app is None or not ResourceGrantService.can_access_app(get_current_user(), app):
        raise not_found('service')
    return jsonify({'available': pooler_service.is_postgres_engine(app),
                    'enabled': bool(app.pooler_enabled),
                    'host': pooler_service.container_name(app),
                    'tradeoff': pooler_service.TRADEOFF})


@app_attachments_bp.route('/<int:app_id>/pooler', methods=['PUT'])
@developer_required
def set_pooler(app_id):
    from app.services import pooler_service
    app = AppAttachmentService.live_app(app_id)
    if app is None or not ResourceGrantService.can_edit_app(get_current_user(), app):
        raise not_found('service')
    if not pooler_service.is_postgres_engine(app):
        raise ValidationError('Connection pooling is for an installed PostgreSQL')
    data = request.get_json(silent=True) or {}
    if not isinstance(data.get('enabled'), bool):
        raise ValidationError("'enabled' must be true or false")
    result = pooler_service.set_enabled(app, data['enabled'])
    return jsonify(result)


# ==================== BOTTLENECK HINTS (plan 86 §A5) ====================

@app_attachments_bp.route('/<int:app_id>/hints', methods=['GET'])
@viewer_required
def get_hints(app_id):
    from app.services.bottleneck_hints_service import BottleneckHintsService
    app = AppAttachmentService.live_app(app_id)
    if app is None or not ResourceGrantService.can_access_app(get_current_user(), app):
        raise not_found('service')
    return jsonify({'hints': BottleneckHintsService.hints(app)})


# ==================== IMMUTABLE ASSETS (plan 86 §B2) ====================

@app_attachments_bp.route('/<int:app_id>/immutable-assets', methods=['PUT'])
@developer_required
def set_immutable_assets(app_id):
    """Long-cache fingerprinted assets (``app.3f9a2c1d.js``) in the vhost.
    Off by default: the panel cannot know an app's asset layout."""
    from app.services.site_domain_service import SiteDomainService
    app = AppAttachmentService.live_app(app_id)
    if app is None or not ResourceGrantService.can_edit_app(get_current_user(), app):
        raise not_found('service')
    data = request.get_json(silent=True) or {}
    if not isinstance(data.get('enabled'), bool):
        raise ValidationError("'enabled' must be true or false")
    return jsonify(SiteDomainService.set_immutable_assets(app, data['enabled']))
