"""Plan 73 item 5 — the SSL modal re-asked for the same email every time.

The app-detail Settings tab remembered the address in localStorage; the
Domains modal did not, and the backend hard-required one per call. So the
address was retyped per certificate, per browser — and the automatic issuance
paths, which have no form to type into, guessed ``admin@<host>``, an address
that usually does not exist and therefore silently discarded every Let's
Encrypt expiry notice.

There is now one panel-wide ACME contact in settings that every issuance path
falls back to, and that an explicit address updates.
"""
from unittest.mock import patch

import pytest

from app.services.ssl_service import (
    ACME_EMAIL_SETTING,
    get_acme_contact,
    remember_acme_contact,
)
from app.services.settings_service import SettingsService


STORED = 'ops@example.com'
EXPLICIT = 'someone-else@example.com'


@pytest.fixture
def stored_contact(app):
    SettingsService.set(ACME_EMAIL_SETTING, STORED)
    return STORED


# --------------------------------------------------------------------------- #
# Resolution
# --------------------------------------------------------------------------- #
class TestGetAcmeContact:

    def test_explicit_address_wins(self, app, stored_contact):
        assert get_acme_contact(EXPLICIT) == EXPLICIT

    def test_falls_back_to_the_stored_contact(self, app, stored_contact):
        assert get_acme_contact(None) == STORED
        assert get_acme_contact('') == STORED
        assert get_acme_contact('   ') == STORED

    def test_none_when_nothing_is_stored(self, app):
        assert get_acme_contact(None) is None

    def test_whitespace_is_trimmed(self, app):
        assert get_acme_contact('  a@b.com  ') == 'a@b.com'

    def test_settings_failure_does_not_break_issuance(self, app):
        """A settings lookup blowing up must not take certificate issuance
        down with it."""
        with patch.object(SettingsService, 'get', side_effect=Exception('db gone')):
            assert get_acme_contact(None) is None
            assert get_acme_contact(EXPLICIT) == EXPLICIT


class TestRememberAcmeContact:

    def test_stores_the_address(self, app):
        remember_acme_contact(EXPLICIT)
        assert SettingsService.get(ACME_EMAIL_SETTING) == EXPLICIT

    def test_later_address_replaces_the_earlier_one(self, app, stored_contact):
        remember_acme_contact(EXPLICIT)
        assert SettingsService.get(ACME_EMAIL_SETTING) == EXPLICIT

    def test_empty_input_never_clears_a_stored_contact(self, app, stored_contact):
        """The automatic paths pass whatever they were given, often nothing —
        that must not wipe a contact the operator configured."""
        remember_acme_contact(None)
        remember_acme_contact('')
        remember_acme_contact('   ')
        assert SettingsService.get(ACME_EMAIL_SETTING) == STORED

    def test_unchanged_address_is_not_rewritten(self, app, stored_contact):
        with patch.object(SettingsService, 'set') as setter:
            remember_acme_contact(STORED)
        setter.assert_not_called()

    def test_storage_failure_is_swallowed(self, app):
        """Failing to remember an address must never turn a successful
        certificate issuance into an error."""
        with patch.object(SettingsService, 'set', side_effect=Exception('nope')):
            remember_acme_contact(EXPLICIT)  # must not raise


# --------------------------------------------------------------------------- #
# API surfaces
# --------------------------------------------------------------------------- #
@pytest.fixture
def admin_headers(app):
    from flask_jwt_extended import create_access_token
    from werkzeug.security import generate_password_hash
    from app import db
    from app.models import User

    user = User(email='acme@test.local', username='acmeadmin',
                password_hash=generate_password_hash('x'),
                role=User.ROLE_ADMIN, is_active=True)
    db.session.add(user)
    db.session.commit()
    return {'Authorization': f'Bearer {create_access_token(identity=user.id)}'}, user


@pytest.fixture
def ssl_domain(app, admin_headers):
    from app import db
    from app.models.application import Application
    from app.models.domain import Domain

    _, user = admin_headers
    site = Application(name='acmesite', app_type='static', user_id=user.id)
    db.session.add(site)
    db.session.flush()
    row = Domain(name='acme.example.com', application_id=site.id)
    db.session.add(row)
    db.session.commit()
    return row


class TestAcmeContactEndpoint:

    def test_returns_the_stored_contact(self, client, admin_headers, stored_contact):
        headers, _ = admin_headers
        resp = client.get('/api/v1/ssl/acme-contact', headers=headers)

        assert resp.status_code == 200
        assert resp.get_json() == {'email': STORED}

    def test_returns_empty_string_when_unset(self, client, admin_headers):
        headers, _ = admin_headers
        resp = client.get('/api/v1/ssl/acme-contact', headers=headers)

        assert resp.status_code == 200
        assert resp.get_json() == {'email': ''}

    def test_requires_authentication(self, client):
        assert client.get('/api/v1/ssl/acme-contact').status_code == 401


class TestEnableSslUsesTheStoredContact:

    def _enable(self, client, headers, domain, body):
        cert = {'success': True, 'certificate_path': '/c.pem',
                'private_key_path': '/k.pem'}
        with patch('app.api.domains.SSLService.obtain_certificate',
                   return_value=cert) as obtain, \
                patch('app.services.site_domain_service.SiteDomainService.write_app_vhost',
                      return_value={'nginx': {'success': True}, 'warning': None}):
            resp = client.post(f'/api/v1/domains/{domain.id}/ssl/enable',
                               json=body, headers=headers)
        return resp, obtain

    def test_request_without_an_email_uses_the_stored_contact(
            self, client, admin_headers, ssl_domain, stored_contact):
        """The whole point of the item: the modal stops asking."""
        headers, _ = admin_headers
        resp, obtain = self._enable(client, headers, ssl_domain, {})

        assert resp.status_code == 200
        assert obtain.call_args.kwargs['email'] == STORED

    def test_explicit_email_wins_and_is_remembered(
            self, client, admin_headers, ssl_domain, stored_contact):
        headers, _ = admin_headers
        resp, obtain = self._enable(client, headers, ssl_domain,
                                    {'email': EXPLICIT})

        assert resp.status_code == 200
        assert obtain.call_args.kwargs['email'] == EXPLICIT
        assert SettingsService.get(ACME_EMAIL_SETTING) == EXPLICIT

    def test_no_email_anywhere_still_refuses(self, client, admin_headers, ssl_domain):
        headers, _ = admin_headers
        resp, obtain = self._enable(client, headers, ssl_domain, {})

        assert resp.status_code == 400
        assert 'Email is required' in resp.get_json()['error']
        obtain.assert_not_called()

    def test_a_failed_issuance_does_not_remember_the_address(
            self, client, admin_headers, ssl_domain):
        """Remembering an address Let's Encrypt rejected would be worse than
        remembering none."""
        headers, _ = admin_headers
        with patch('app.api.domains.SSLService.obtain_certificate',
                   return_value={'success': False, 'error': 'rejected'}):
            resp = client.post(f'/api/v1/domains/{ssl_domain.id}/ssl/enable',
                               json={'email': EXPLICIT}, headers=headers)

        assert resp.status_code == 400
        assert not (SettingsService.get(ACME_EMAIL_SETTING) or '')
