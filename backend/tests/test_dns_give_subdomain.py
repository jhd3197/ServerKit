"""Proving tests for Phase 4 ergonomics: give-this-a-subdomain + all-managed view.

A first-class "publish this app at <slug>.<base>" action (Domain row + nginx vhost +
per-site DNS record when in per-site mode), plus one endpoint that lists every record
ServerKit owns across all zones.
"""


def _set(key, value):
    from app import db
    from app.services.settings_service import SettingsService
    SettingsService.set(key, value)
    db.session.commit()


def _mk_app(name='Acme Blog', port=8500):
    from app import db
    from app.models import User, Application
    from werkzeug.security import generate_password_hash
    u = User(email=f'{name}@p4.local', username=f'p4-{name}'.replace(' ', '-').lower(),
             password_hash=generate_password_hash('x'), role=User.ROLE_ADMIN, is_active=True)
    db.session.add(u)
    db.session.commit()
    a = Application(name=name, app_type='docker', user_id=u.id,
                    root_path=f'/srv/{name}', port=port)
    db.session.add(a)
    db.session.commit()
    return a


# ── give_subdomain (service) ─────────────────────────────────────────────────

def test_give_subdomain_requires_base_domain(app, monkeypatch):
    from app.services.site_domain_service import SiteDomainService
    # TestingConfig pins SITES_BASE_DOMAIN=lvh.me; clear it to exercise the unset path.
    monkeypatch.setitem(app.config, 'SITES_BASE_DOMAIN', '')
    a = _mk_app()
    res = SiteDomainService.give_subdomain(a)
    assert res['success'] is False and 'base domain' in res['error'].lower()


def test_give_subdomain_creates_domain_and_per_site_dns(app, monkeypatch):
    from app.models.domain import Domain
    from app.services.site_domain_service import SiteDomainService
    from app.services.nginx_service import NginxService
    from app.services.dns_provider_service import DNSProviderService

    _set('sites_base_domain', 'apps.example.com')
    _set('sites_dns_mode', 'per-site')
    _set('server_public_ip', '203.0.113.9')
    a = _mk_app(name='Acme Blog', port=8500)

    monkeypatch.setattr(NginxService, 'create_site', staticmethod(lambda **k: {'success': True}))
    monkeypatch.setattr(NginxService, 'enable_site', staticmethod(lambda name: {'success': True}))
    seen = {}
    monkeypatch.setattr(DNSProviderService, 'ensure_a_record', classmethod(
        lambda cls, host, ip: (seen.update(host=host, ip=ip) or {'created': True, 'record': {}})))

    res = SiteDomainService.give_subdomain(a)
    assert res['success'] and res['host'] == 'acme-blog.apps.example.com'
    dom = Domain.query.filter_by(name='acme-blog.apps.example.com').first()
    assert dom and dom.is_primary and dom.application_id == a.id
    assert seen == {'host': 'acme-blog.apps.example.com', 'ip': '203.0.113.9'}


def test_give_subdomain_wildcard_mode_skips_per_site_record(app, monkeypatch):
    from app.models.domain import Domain
    from app.services.site_domain_service import SiteDomainService
    from app.services.nginx_service import NginxService
    from app.services.dns_provider_service import DNSProviderService

    _set('sites_base_domain', 'apps.example.com')   # default mode = wildcard
    a = _mk_app(name='Wild One', port=8600)

    monkeypatch.setattr(NginxService, 'create_site', staticmethod(lambda **k: {'success': True}))
    monkeypatch.setattr(NginxService, 'enable_site', staticmethod(lambda name: {'success': True}))
    called = {'n': 0}
    monkeypatch.setattr(DNSProviderService, 'ensure_a_record',
                        classmethod(lambda cls, h, ip: called.update(n=called['n'] + 1)))

    res = SiteDomainService.give_subdomain(a)
    assert res['success'] and res['dns'].get('skipped')
    assert called['n'] == 0
    assert Domain.query.filter_by(name='wild-one.apps.example.com').first() is not None


def _capture_create_site(monkeypatch):
    """Patch NginxService so give_subdomain writes no real vhost but we can see
    exactly which template/params it chose. Returns the captured kwargs dict."""
    from app.services.nginx_service import NginxService
    captured = {}
    monkeypatch.setattr(NginxService, 'create_site',
                        staticmethod(lambda **k: (captured.update(k), {'success': True})[1]))
    monkeypatch.setattr(NginxService, 'enable_site', staticmethod(lambda name: {'success': True}))
    return captured


def test_give_subdomain_routes_php_app_from_root(app, monkeypatch):
    """A managed PHP app (no port, has a root) must get a real php-fpm vhost —
    not the old docker-only skip that left it at localhost only."""
    from app import db
    from app.services.site_domain_service import SiteDomainService

    _set('sites_base_domain', 'apps.example.com')
    a = _mk_app(name='Legacy PHP', port=None)
    a.app_type = 'php'
    a.root_path = '/srv/legacy-php'
    db.session.commit()

    captured = _capture_create_site(monkeypatch)
    res = SiteDomainService.give_subdomain(a)
    assert res['success'] and res.get('warning') is None
    assert captured['app_type'] == 'php'
    assert captured['root_path'] == '/srv/legacy-php'
    assert 'legacy-php.apps.example.com' in captured['domains']


def test_give_subdomain_routes_static_app_from_root(app, monkeypatch):
    from app import db
    from app.services.site_domain_service import SiteDomainService

    _set('sites_base_domain', 'apps.example.com')
    a = _mk_app(name='Brochure', port=None)
    a.app_type = 'static'
    a.root_path = '/srv/brochure'
    db.session.commit()

    captured = _capture_create_site(monkeypatch)
    res = SiteDomainService.give_subdomain(a)
    assert res['success'] and res.get('warning') is None
    assert captured['app_type'] == 'static'
    assert captured['root_path'] == '/srv/brochure'


def test_give_subdomain_routes_python_app_by_port(app, monkeypatch):
    from app import db
    from app.services.site_domain_service import SiteDomainService

    _set('sites_base_domain', 'apps.example.com')
    a = _mk_app(name='Flask API', port=9100)
    a.app_type = 'python'
    db.session.commit()

    captured = _capture_create_site(monkeypatch)
    res = SiteDomainService.give_subdomain(a)
    assert res['success'] and res.get('warning') is None
    assert captured['app_type'] == 'python'
    assert captured['port'] == 9100


def test_give_subdomain_warns_when_app_type_unroutable(app, monkeypatch):
    """A php app with no root can't be served — the publish records the Domain
    but surfaces a warning instead of silently pretending it routed."""
    from app import db
    from app.models.domain import Domain
    from app.services.site_domain_service import SiteDomainService

    _set('sites_base_domain', 'apps.example.com')
    a = _mk_app(name='Broken PHP', port=None)
    a.app_type = 'php'
    a.root_path = None
    db.session.commit()

    _capture_create_site(monkeypatch)
    res = SiteDomainService.give_subdomain(a)
    assert res['success'] and res['nginx'] is None
    assert 'root' in (res.get('warning') or '')
    assert Domain.query.filter_by(name='broken-php.apps.example.com').first() is not None


def test_give_subdomain_rejects_label_taken_by_other_app(app, monkeypatch):
    from app import db
    from app.models.domain import Domain
    from app.services.site_domain_service import SiteDomainService

    _set('sites_base_domain', 'apps.example.com')
    other = _mk_app(name='Other', port=8700)
    db.session.add(Domain(name='shared.apps.example.com', application_id=other.id))
    db.session.commit()

    a = _mk_app(name='Mine', port=8800)
    res = SiteDomainService.give_subdomain(a, label='shared')
    assert res['success'] is False and 'another service' in res['error']


# ── endpoints ────────────────────────────────────────────────────────────────

def test_suggest_subdomain_endpoint(app, client, auth_headers):
    _set('sites_base_domain', 'apps.example.com')
    a = _mk_app(name='My Service', port=8900)
    resp = client.get(f'/api/v1/domains/suggest-subdomain?application_id={a.id}', headers=auth_headers)
    assert resp.status_code == 200
    assert resp.get_json()['suggestion'] == 'my-service.apps.example.com'


def test_managed_records_endpoint(app, client, auth_headers):
    from app.services.dns_ownership_service import DnsOwnershipService
    DnsOwnershipService.record_write('cloudflare', 'Z1', 'A', 'www.example.com',
                                     provider_record_id='R1', source='zone')
    resp = client.get('/api/v1/dns/managed', headers=auth_headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['count'] >= 1
    assert any(r['name'] == 'www.example.com' for r in data['records'])
