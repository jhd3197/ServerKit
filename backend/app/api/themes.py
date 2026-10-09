"""Themes API (plan 60) — /api/v1/themes.

A theme is data, not code: a validated map of CSS custom-property tokens. This
blueprint lists themes (bundled seeds + installed), imports a pasted/uploaded
theme.json, sets the panel-wide default, and exposes an UNAUTHENTICATED
`GET /public/active` so the login/setup screens can paint themselves with the
panel default before anyone signs in.

Registry browse/install routes are added in Phase 3.
"""
import json
import logging

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from app.exceptions import NotFoundError
from app.services import theme_service
from app.services.audit_service import AuditService
from app.models.audit_log import AuditLog
from app.middleware.rbac import require_admin_user

logger = logging.getLogger(__name__)

themes_bp = Blueprint('themes', __name__)


@themes_bp.route('/installed', methods=['GET'])
@jwt_required()
def list_installed():
    """All selectable themes (bundled seeds + installed) plus the panel default.
    Any authenticated user may read this — themes are per-user cosmetic."""
    return jsonify({
        'themes': theme_service.list_all(),
        'default': theme_service.get_default_slug(),
    })


@themes_bp.route('/<slug>', methods=['GET'])
@jwt_required()
def get_theme(slug):
    theme = theme_service.get_theme(slug)
    if not theme:
        return jsonify({'error': 'Theme not found'}), 404
    return jsonify(theme)


@themes_bp.route('/import', methods=['POST'])
@jwt_required()
def import_theme():
    """Import a theme from a pasted JSON body or an uploaded theme.json (admin).

    Accepts either a raw theme object as the JSON body, an object wrapped as
    ``{"theme": {...}}``, or a multipart upload under ``file``. The token
    whitelist + value validators run server-side before anything is stored.
    """
    user = require_admin_user()

    raw = None
    upload = request.files.get('file')
    if upload is not None:
        try:
            raw = json.loads(upload.read().decode('utf-8'))
        except Exception:
            return jsonify({'error': 'Uploaded file is not valid JSON'}), 400
    else:
        body = request.get_json(silent=True)
        if isinstance(body, dict) and isinstance(body.get('theme'), dict):
            raw = body['theme']
        else:
            raw = body
    if not isinstance(raw, dict):
        return jsonify({'error': 'No theme provided'}), 400

    source = 'studio' if request.args.get('source') == 'studio' else 'import'
    theme, verr = theme_service.import_theme(raw, source=source)
    if verr:
        return jsonify({'error': verr}), 400

    AuditService.log(
        action=AuditLog.ACTION_RESOURCE_CREATE,
        user_id=user.id,
        target_type='theme',
        target_id=theme['slug'],
        details={'name': theme['name'], 'source': source},
    )
    return jsonify(theme), 201


@themes_bp.route('/<slug>', methods=['DELETE'])
@jwt_required()
def delete_theme(slug):
    """Uninstall an installed theme (admin). Bundled seeds cannot be removed."""
    user = require_admin_user()
    ok, derr = theme_service.delete_theme(slug)
    if not ok:
        if derr is theme_service.THEME_NOT_FOUND:
            raise NotFoundError(derr)
        return jsonify({'error': derr}), 400
    AuditService.log(
        action=AuditLog.ACTION_RESOURCE_DELETE,
        user_id=user.id,
        target_type='theme',
        target_id=slug,
        details={'slug': slug},
    )
    return jsonify({'success': True}), 200


@themes_bp.route('/default', methods=['GET'])
@jwt_required()
def get_default():
    return jsonify({'default': theme_service.get_default_slug()})


@themes_bp.route('/default', methods=['POST'])
@jwt_required()
def set_default():
    """Set the panel-wide default theme (admin) — what login/setup and new
    users get before picking their own."""
    user = require_admin_user()
    body = request.get_json(silent=True) or {}
    slug = body.get('slug')
    if not isinstance(slug, str) or not slug:
        return jsonify({'error': 'Missing slug'}), 400
    ok, derr = theme_service.set_default_slug(slug)
    if not ok:
        return jsonify({'error': derr}), 400
    AuditService.log(
        action=AuditLog.ACTION_SETTINGS_UPDATE,
        user_id=user.id,
        target_type='theme',
        target_id=slug,
        details={'default_theme': slug},
    )
    return jsonify({'default': slug}), 200


@themes_bp.route('/registry', methods=['GET'])
@jwt_required()
def list_registry():
    """Remote-registry themes (with live install state), for the Browse gallery.
    Read-only; offline-tolerant (falls back to the bundled index)."""
    from app.services import theme_registry_service
    return jsonify({
        'themes': theme_registry_service.list_catalog(),
        'source': theme_registry_service.registry_source_label(),
    })


@themes_bp.route('/registry/<slug>/install', methods=['POST'])
@jwt_required()
def install_registry(slug):
    """Install a theme from the registry by slug (admin). Fetches the theme.json,
    validates it server-side, and stores it — no zips, no checksums."""
    user = require_admin_user()
    from app.services import theme_registry_service
    theme = theme_registry_service.install(slug)
    AuditService.log(
        action=AuditLog.ACTION_RESOURCE_CREATE,
        user_id=user.id,
        target_type='theme',
        target_id=theme['slug'],
        details={'name': theme['name'], 'source': 'registry'},
    )
    return jsonify(theme), 201


@themes_bp.route('/public/active', methods=['GET'])
def public_active():
    """UNAUTHENTICATED — the panel-default theme's tokens for the login/setup
    screens. Extends the existing pre-auth branding channel; returns only
    cosmetic token data, never anything sensitive."""
    return jsonify(theme_service.get_public_active())
