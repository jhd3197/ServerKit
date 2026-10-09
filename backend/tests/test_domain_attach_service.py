"""Proving suite for DomainAttachService (manifest task #12).

Generalizes the WordPress one-call "attach a custom domain" flow to any app.
The suite runs on Windows (``os.name == 'nt'``), where nginx and certbot are
unavailable, so the tests assert the service degrades every external stage to a
warning and never raises — the Domain row is the only hard requirement.

Proving points:
- attach(..., ssl='off') records the Domain row, returns success, does NOT
  attempt a certificate, and survives with nginx unavailable
- an invalid host (no dot) returns {'success': False} and records nothing
- the DNS best-effort result is captured and its "add manually" message
  surfaces as a warning
- ssl='auto' calls obtain_certificate; a failed cert degrades to a warning
  (attach still succeeds) and a successful cert sets ssl_enabled + paths
- make_primary re-points the primary domain
- re-attaching the same host is idempotent (created=False, no duplicate row)
"""
import pytest

from app import db
from app.models import Application, User
from app.models.domain import Domain
from app.services.domain_attach_service import DomainAttachService
from app.services.dns_provider_service import DNSProviderService
from app.services.site_domain_service import SiteDomainService
from app.services.ssl_service import SSLService


# ── helpers ──────────────────────────────────────────────────────────────────

def _owner(username='testadmin'):
    """The admin user the auth_headers fixture creates, or a fresh one."""
    user = User.query.filter_by(username=username).first()
    if user:
        return user
    from werkzeug.security import generate_password_hash
    user = User(email=f'{username}@test.local', username=username,
                password_hash=generate_password_hash('x'),
                role=User.ROLE_ADMIN, is_active=True)
    db.session.add(user)
    db.session.commit()
    return user


def _mk_app(name='attach-app', app_type='docker', port=8300, **kw):
    a = Application(name=name, app_type=app_type, user_id=_owner().id, port=port, **kw)
    db.session.add(a)
    db.session.commit()
    return a


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch):
    """Keep every test offline: DNS never touches a provider, and the nginx
    write is a no-op. Individual tests override these as needed."""
    monkeypatch.setattr(DNSProviderService, 'ensure_a_record',
                        classmethod(lambda cls, host, ip: {'created': False,
                                                           'reason': 'no_provider',
                                                           'message': f'add {host} manually'}))
    monkeypatch.setattr(SiteDomainService, 'write_app_vhost',
                        classmethod(lambda cls, a, force_type=None: {'nginx': None, 'warning': None}))


# ── core attach ──────────────────────────────────────────────────────────────

def test_attach_ssl_off_creates_domain_and_succeeds(client, auth_headers, app, monkeypatch):
    """The headline case: attach a domain with SSL off. A Domain row is created,
    success is True, and nothing raises despite nginx being unavailable."""
    # Assert SSL is never attempted when ssl='off'.
    monkeypatch.setattr(SSLService, 'obtain_certificate',
                        classmethod(lambda cls, *a, **kw:
                                    (_ for _ in ()).throw(AssertionError('SSL must not run'))))

    app_row = _mk_app(name='attach-off')
    result = DomainAttachService.attach(app_row, 'foo.example.com', ssl='off')

    assert result['success'] is True
    assert result['domain'] == 'foo.example.com'
    assert result['created'] is True
    assert result['ssl'] == {'enabled': False}
    row = Domain.query.filter_by(name='foo.example.com', application_id=app_row.id).first()
    assert row is not None
    assert row.ssl_enabled is not True


def test_dns_result_captured_and_warned(client, auth_headers, app):
    app_row = _mk_app(name='attach-dns')
    result = DomainAttachService.attach(app_row, 'bar.example.com', ssl='off')
    assert result['dns']['reason'] == 'no_provider'
    assert any('add bar.example.com manually' in w for w in result['warnings'])


def test_invalid_host_returns_failure(client, auth_headers, app):
    """A host with no dot is rejected and records nothing."""
    app_row = _mk_app(name='attach-bad')
    result = DomainAttachService.attach(app_row, 'nodothost', ssl='off')
    assert result['success'] is False
    assert 'error' in result
    assert Domain.query.filter_by(application_id=app_row.id).count() == 0


def test_full_url_is_normalized_to_host(client, auth_headers, app):
    app_row = _mk_app(name='attach-url')
    result = DomainAttachService.attach(app_row, 'https://Site.Example.com:8443/path',
                                        ssl='off')
    assert result['success'] is True
    assert result['domain'] == 'site.example.com'
    assert Domain.query.filter_by(name='site.example.com').first() is not None


# ── idempotency + primary ────────────────────────────────────────────────────

def test_reattach_is_idempotent(client, auth_headers, app):
    app_row = _mk_app(name='attach-idem')
    first = DomainAttachService.attach(app_row, 'idem.example.com', ssl='off')
    second = DomainAttachService.attach(app_row, 'idem.example.com', ssl='off')
    assert first['created'] is True
    assert second['created'] is False
    assert Domain.query.filter_by(name='idem.example.com').count() == 1


def test_make_primary_repoints_primary(client, auth_headers, app):
    app_row = _mk_app(name='attach-primary')
    db.session.add(Domain(name='old.example.com', is_primary=True, application_id=app_row.id))
    db.session.commit()

    result = DomainAttachService.attach(app_row, 'new.example.com', ssl='off',
                                        make_primary=True)
    assert result['success'] is True
    old = Domain.query.filter_by(name='old.example.com').first()
    new = Domain.query.filter_by(name='new.example.com').first()
    assert old.is_primary is False
    assert new.is_primary is True


def test_host_owned_by_other_app_is_rejected(client, auth_headers, app):
    a1 = _mk_app(name='attach-owner-1')
    a2 = _mk_app(name='attach-owner-2')
    assert DomainAttachService.attach(a1, 'shared.example.com', ssl='off')['success'] is True
    result = DomainAttachService.attach(a2, 'shared.example.com', ssl='off')
    assert result['success'] is False
    assert 'another service' in result['error']


# ── SSL best-effort ──────────────────────────────────────────────────────────

def test_ssl_auto_failure_degrades_to_warning(client, auth_headers, app, monkeypatch):
    """A cert failure must never fail the attach — it becomes a warning."""
    monkeypatch.setattr(SSLService, 'obtain_certificate',
                        classmethod(lambda cls, domains, email, **kw:
                                    {'success': False, 'error': 'DNS not propagated'}))
    app_row = _mk_app(name='attach-ssl-fail')
    result = DomainAttachService.attach(app_row, 'ssl.example.com', ssl='auto')
    assert result['success'] is True
    assert result['ssl']['enabled'] is False
    assert result['ssl']['error'] == 'DNS not propagated'
    assert any('HTTPS is not set up yet' in w for w in result['warnings'])


def test_ssl_auto_success_sets_flags(client, auth_headers, app, monkeypatch):
    monkeypatch.setattr(SSLService, 'obtain_certificate',
                        classmethod(lambda cls, domains, email, **kw:
                                    {'success': True,
                                     'certificate_path': '/c/fullchain.pem',
                                     'private_key_path': '/c/privkey.pem'}))
    from app.services.nginx_service import NginxService
    monkeypatch.setattr(NginxService, 'add_ssl_to_site',
                        classmethod(lambda cls, name, cert, key: {'success': True}))

    app_row = _mk_app(name='attach-ssl-ok')
    result = DomainAttachService.attach(app_row, 'https.example.com', ssl='auto')
    assert result['success'] is True
    assert result['ssl'] == {'enabled': True}
    row = Domain.query.filter_by(name='https.example.com').first()
    assert row.ssl_enabled is True
    assert row.ssl_certificate_path == '/c/fullchain.pem'
    assert row.ssl_key_path == '/c/privkey.pem'
