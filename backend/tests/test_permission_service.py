"""PermissionService + User permission resolution per role."""
import pytest
from werkzeug.security import generate_password_hash

from app import db
from app.models import User
from app.services.permission_service import PermissionService


def _user(role, name=None):
    u = User(email=f'{name or role}@example.com', username=name or role,
             password_hash=generate_password_hash('x'), role=role, is_active=True)
    db.session.add(u)
    db.session.commit()
    return u


def test_role_templates_cover_every_feature_for_admin():
    admin = PermissionService.get_role_template('admin')
    assert set(admin) == set(User.PERMISSION_FEATURES)
    assert all(v == {'read': True, 'write': True} for v in admin.values())


def test_unknown_role_has_no_permissions(app):
    assert PermissionService.get_role_template('wizard') == {}
    u = _user('viewer', 'nobody')
    u.role = 'wizard'
    assert not u.has_permission('files')


def test_developer_defaults_follow_template(app):
    dev = _user('developer')
    assert dev.has_permission('applications', 'write')
    assert dev.has_permission('monitoring', 'read')
    assert not dev.has_permission('monitoring', 'write')
    assert not dev.has_permission('users')  # not in the developer template


def test_admin_always_allowed(app):
    admin = _user('admin')
    assert all(admin.has_permission(f, 'write') for f in User.PERMISSION_FEATURES)
    assert admin.has_permission('anything-at-all')


def test_viewer_cannot_write_anything(app):
    viewer = _user('viewer')
    assert not any(viewer.has_permission(f, 'write') for f in User.PERMISSION_FEATURES)


def test_get_user_permissions_missing_user(app):
    assert PermissionService.get_user_permissions(999999) is None


def test_update_custom_permissions_overrides_role(app):
    dev = _user('developer')
    res = PermissionService.update_user_permissions(
        dev.id, {'files': {'read': True, 'write': False}})
    assert res['success']
    assert res['permissions'] == {'files': {'read': True, 'write': False}}
    assert not dev.has_permission('files', 'write')
    assert not dev.has_permission('applications')  # custom set replaces the template wholesale


def test_reset_restores_role_template(app):
    dev = _user('developer')
    PermissionService.update_user_permissions(dev.id, {'files': {'read': True}})
    res = PermissionService.reset_to_role_defaults(dev.id)
    assert res['success'] and res['permissions'] == User.ROLE_PERMISSION_TEMPLATES['developer']
    assert dev.permissions is None


def test_admin_permissions_cannot_be_customized(app):
    admin = _user('admin')
    res = PermissionService.update_user_permissions(admin.id, {'files': {'read': False}})
    assert res == {'success': False, 'error': 'Admin permissions cannot be customized'}


def test_unknown_user_is_reported(app):
    assert PermissionService.update_user_permissions(424242, {}) == {
        'success': False, 'error': 'User not found'}
    assert PermissionService.reset_to_role_defaults(424242) == {
        'success': False, 'error': 'User not found'}


@pytest.mark.parametrize('perms, fragment', [
    ('nope', 'must be an object'),
    ({'bogus': {'read': True}}, 'Unknown feature'),
    ({'files': True}, 'read/write object'),
    ({'files': {'execute': True}}, 'Invalid permission key'),
    ({'files': {'read': 'yes'}}, 'must be boolean'),
    ({'files': {'read': False, 'write': True}}, 'without read'),
])
def test_validate_permissions_rejects(perms, fragment):
    assert fragment in PermissionService.validate_permissions(perms)


def test_validate_permissions_accepts_good_input():
    assert PermissionService.validate_permissions({}) is None
    assert PermissionService.validate_permissions(
        {'files': {'read': True, 'write': True}, 'cron': {'read': True}}) is None


def test_invalid_update_does_not_persist(app):
    dev = _user('developer')
    res = PermissionService.update_user_permissions(dev.id, {'bogus': {}})
    assert not res['success']
    assert dev.permissions is None
