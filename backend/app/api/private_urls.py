# Bucket: PER-APP (plan 29 #9). Private-URL routes gate on the shared app-access
# seam (can_access_app for reads, can_edit_app for mutations).
"""API endpoints for managing private URLs for applications."""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Application, User
from app.services.private_url_service import PrivateURLService
from app.services.nginx_service import NginxService
from app.services.resource_grant_service import ResourceGrantService
from app.exceptions import not_found, permission_denied

private_urls_bp = Blueprint('private_urls', __name__)


@private_urls_bp.route('/<int:app_id>/private-url', methods=['POST'])
@jwt_required()
def enable_private_url(app_id):
    """Enable private URL for an application and generate/set slug.

    Request body (optional):
        {
            "slug": "custom-slug"  // Optional custom slug
        }

    Returns:
        JSON with private_slug and private_url
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

    # Check if already enabled
    if app.private_url_enabled:
        return jsonify({
            'error': 'Private URL is already enabled',
            'private_slug': app.private_slug,
            'private_url': f'/p/{app.private_slug}'
        }), 400

    data = request.get_json() or {}
    custom_slug = data.get('slug')

    if custom_slug:
        # Validate custom slug
        is_valid, error = PrivateURLService.validate_slug(custom_slug)
        if not is_valid:
            return jsonify({'error': error}), 400

        if not PrivateURLService.is_slug_available(custom_slug, exclude_app_id=app_id):
            return jsonify({'error': 'Slug is already in use'}), 409

        slug = custom_slug
    else:
        # Generate unique slug
        slug = PrivateURLService.generate_unique_slug()
        if not slug:
            return jsonify({'error': 'Could not generate unique slug'}), 500

    app.private_slug = slug
    app.private_url_enabled = True
    db.session.commit()

    # Update Nginx config if app has port
    nginx_result = None
    if app.port:
        nginx_result = NginxService.update_private_url_config(app)

    return jsonify({
        'message': 'Private URL enabled',
        'private_slug': slug,
        'private_url': f'/p/{slug}',
        'nginx_updated': nginx_result.get('success') if nginx_result else None
    }), 200


@private_urls_bp.route('/<int:app_id>/private-url', methods=['GET'])
@jwt_required()
def get_private_url(app_id):
    """Get private URL info for an application.

    Returns:
        JSON with private_slug, private_url_enabled, and private_url
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

    return jsonify({
        'private_url_enabled': app.private_url_enabled,
        'private_slug': app.private_slug,
        'private_url': f'/p/{app.private_slug}' if app.private_slug else None
    }), 200


@private_urls_bp.route('/<int:app_id>/private-url', methods=['PUT'])
@jwt_required()
def update_private_url(app_id):
    """Update the private URL slug for an application.

    Request body:
        {
            "slug": "new-custom-slug"
        }

    Returns:
        JSON with updated private_slug and private_url
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

    if not app.private_url_enabled:
        return jsonify({'error': 'Private URL is not enabled for this service'}), 400

    data = request.get_json()
    if not data or 'slug' not in data:
        return jsonify({'error': 'Slug is required'}), 400

    new_slug = data['slug']

    # Validate
    is_valid, error = PrivateURLService.validate_slug(new_slug)
    if not is_valid:
        return jsonify({'error': error}), 400

    if not PrivateURLService.is_slug_available(new_slug, exclude_app_id=app_id):
        return jsonify({'error': 'Slug is already in use'}), 409

    old_slug = app.private_slug
    app.private_slug = new_slug
    db.session.commit()

    # Update Nginx config
    nginx_result = None
    if app.port:
        nginx_result = NginxService.update_private_url_config(app, old_slug=old_slug)

    return jsonify({
        'message': 'Private URL updated',
        'private_slug': new_slug,
        'private_url': f'/p/{new_slug}',
        'nginx_updated': nginx_result.get('success') if nginx_result else None
    }), 200


@private_urls_bp.route('/<int:app_id>/private-url', methods=['DELETE'])
@jwt_required()
def disable_private_url(app_id):
    """Disable private URL for an application.

    Returns:
        JSON with success message
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

    if not app.private_url_enabled:
        return jsonify({'error': 'Private URL is not enabled for this service'}), 400

    old_slug = app.private_slug
    app.private_slug = None
    app.private_url_enabled = False
    db.session.commit()

    # Remove from Nginx config
    nginx_result = None
    if old_slug:
        nginx_result = NginxService.remove_private_url_config(old_slug)

    return jsonify({
        'message': 'Private URL disabled',
        'nginx_updated': nginx_result.get('success') if nginx_result else None
    }), 200


@private_urls_bp.route('/<int:app_id>/private-url/regenerate', methods=['POST'])
@jwt_required()
def regenerate_private_url(app_id):
    """Generate a new random slug for an application.

    Returns:
        JSON with new private_slug and private_url
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

    if not app.private_url_enabled:
        return jsonify({'error': 'Private URL is not enabled for this service'}), 400

    old_slug = app.private_slug
    new_slug = PrivateURLService.generate_unique_slug()

    if not new_slug:
        return jsonify({'error': 'Could not generate unique slug'}), 500

    app.private_slug = new_slug
    db.session.commit()

    # Update Nginx config
    nginx_result = None
    if app.port:
        nginx_result = NginxService.update_private_url_config(app, old_slug=old_slug)

    return jsonify({
        'message': 'Private URL regenerated',
        'private_slug': new_slug,
        'private_url': f'/p/{new_slug}',
        'nginx_updated': nginx_result.get('success') if nginx_result else None
    }), 200


# =============================================================================
# Public Endpoint - No Authentication Required
# =============================================================================

@private_urls_bp.route('/p/<slug>', methods=['GET'])
@jwt_required()
def resolve_private_url(slug):
    """Resolve a private URL slug to app info.

    This endpoint is for API consumers that need to look up which app
    a private URL points to. The actual proxying is handled by Nginx.

    Args:
        slug: The private URL slug

    Returns:
        JSON with app_id, app_name, port, and status
    """
    # Slug-keyed: a tombstone still holds its slug (that reservation is what
    # keeps a restore from colliding), so an unfiltered .first() could resolve
    # /p/<slug> to a deleted app and hand out its port.
    app = Application.query_active().filter_by(
        private_slug=slug,
        private_url_enabled=True
    ).first()

    if not app:
        return jsonify({'error': 'Not found'}), 404

    return jsonify({
        'app_id': app.id,
        'app_name': app.name,
        'port': app.port,
        'status': app.status
    }), 200
