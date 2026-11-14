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


@pytest.mark.parametrize('provider,info', [
    ('google', {'sub': 'g1', 'email': 'victim@example.com', 'email_verified': False}),
    ('oidc', {'sub': 'o1', 'email': 'victim@example.com'}),
    ('oidc', {'sub': 'o2', 'email': 'victim@example.com', 'email_verified': 'false'}),
])
def test_unverified_email_never_links_to_an_existing_account(app, provider, info):
    from app import db
    from factories import make_user
    from app.models.oauth_identity import OAuthIdentity
    victim = make_user(db, 'sso_victim_' + info['sub'], 'admin')
    victim.email = 'victim@example.com'
    db.session.commit()
    profile = sso_service._normalize_profile(provider, info)
    with pytest.raises(ValueError, match='not verified'):
        sso_service.find_or_create_user(provider, profile)
    assert OAuthIdentity.query.filter_by(user_id=victim.id).count() == 0
    db.session.delete(victim)
    db.session.commit()


@pytest.mark.parametrize('verified', [True, 'true'])
def test_verified_email_still_links(app, verified):
    from app import db
    from factories import make_user
    user = make_user(db, 'sso_owner_' + str(verified), 'developer')
    user.email = f'owner{verified}@example.com'
    db.session.commit()
    profile = sso_service._normalize_profile(
        'google', {'sub': f'g-{verified}', 'email': user.email, 'email_verified': verified})
    linked, is_new = sso_service.find_or_create_user('google', profile)
    assert linked.id == user.id and not is_new
