"""SSO sign-in must not open a door password registration keeps shut."""
import pytest

from app.models import User
from app.services import sso_service
from app.services.settings_service import SettingsService


def _profile(email, sub='sub-1', **extra):
    return {'provider_user_id': sub, 'email': email, 'display_name': 'X', **extra}


def test_unknown_account_is_not_provisioned_by_default(app):
    with pytest.raises(ValueError, match='auto-provisioning is disabled'):
        sso_service.find_or_create_user('github', _profile('stranger@example.com'))
    assert User.query.filter_by(email='stranger@example.com').first() is None


def test_opted_in_provisioning_defaults_to_viewer(app):
    SettingsService.set('sso_auto_provision', True)
    try:
        user, is_new = sso_service.find_or_create_user(
            'github', _profile('newbie@example.com', sub='sub-2'))
    finally:
        SettingsService.set('sso_auto_provision', False)
    assert is_new
    assert user.role == User.ROLE_VIEWER
