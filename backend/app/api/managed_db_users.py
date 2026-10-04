"""Managed database users + one-click Adminer SSO.

Nested under a managed database id:
    GET    /api/v1/managed-databases/<id>/users
    POST   /api/v1/managed-databases/<id>/users
    DELETE /api/v1/managed-databases/<id>/users/<user_id>
    POST   /api/v1/managed-databases/<id>/sso
"""
import logging

from flask import Blueprint, request, jsonify

from app.middleware.rbac import admin_required, developer_required
from app.services.managed_database_service import ManagedDatabaseService
from app.services.managed_db_user_service import ManagedDbUserService
from app.exceptions import not_found

logger = logging.getLogger(__name__)

managed_db_users_bp = Blueprint('managed_db_users', __name__)


def _get_managed_or_404(managed_id):
    managed = ManagedDatabaseService.get(managed_id)
    if not managed:
        raise not_found('database')
    return managed, None


@managed_db_users_bp.route('/<int:managed_id>/users', methods=['GET'])
@developer_required
def list_managed_db_users(managed_id):
    """Tracked users merged best-effort with the live engine list."""
    managed, err = _get_managed_or_404(managed_id)
    if err:
        return err
    users = ManagedDbUserService.list_users(managed)
    return jsonify({'users': users}), 200


@managed_db_users_bp.route('/<int:managed_id>/users', methods=['POST'])
@admin_required
def create_managed_db_user(managed_id):
    """CREATE USER + GRANT scoped to this database. The password is returned
    exactly once in this response and never stored."""
    managed, err = _get_managed_or_404(managed_id)
    if err:
        return err
    data = request.get_json(silent=True) or {}
    result = ManagedDbUserService.create_user(
        managed,
        username=data.get('username'),
        password=data.get('password'),
        grants=data.get('grants'),
    )
    if 'error' in result:
        return jsonify({'error': result['error']}), 400
    return jsonify(result), 201


@managed_db_users_bp.route('/<int:managed_id>/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_managed_db_user(managed_id, user_id):
    """DROP USER in the engine and remove the tracking row."""
    from app.models.managed_database_user import ManagedDatabaseUser
    managed, err = _get_managed_or_404(managed_id)
    if err:
        return err
    row = ManagedDatabaseUser.query.filter_by(
        id=user_id, managed_database_id=managed.id).first()
    if not row:
        raise not_found('user')
    result = ManagedDbUserService.delete_user(managed, row)
    if 'error' in result:
        return jsonify({'error': result['error']}), 400
    return jsonify({'success': True}), 200


@managed_db_users_bp.route('/<int:managed_id>/sso', methods=['POST'])
@admin_required
def launch_managed_db_sso(managed_id):
    """Mint a 5-minute, single-database shadow credential and return the
    Adminer launch descriptor. The password crosses once, right here."""
    from app.middleware.rbac import get_current_user
    from app.services.db_admin_sso_service import DbAdminSsoService

    managed, err = _get_managed_or_404(managed_id)
    if err:
        return err

    user = get_current_user()
    descriptor = DbAdminSsoService.launch(
        managed, requested_by=getattr(user, 'id', None))
    if 'error' in descriptor:
        status = 503 if descriptor.get('code') == 'docker_required' else 400
        return jsonify({'error': descriptor['error']}), status

    # Build the browser-reachable URL from the panel host the client used.
    panel_host = (request.host or 'localhost').rsplit(':', 1)[0]
    descriptor['url'] = f"http://{panel_host}:{descriptor['port']}"

    try:
        from app.services.audit_service import AuditService
        AuditService.log(
            action='db_sso_launch', user_id=getattr(user, 'id', None),
            target_type='managed_database', target_id=managed.id,
            details={'engine': managed.engine, 'name': managed.name,
                     'username': descriptor['username'],
                     'expires_at': descriptor['expires_at']},
        )
    except Exception as e:  # pragma: no cover - audit is best-effort
        logger.debug('SSO audit log failed: %s', e)

    return jsonify(descriptor), 200
