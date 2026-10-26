"""A custom domain's own certificate must survive every vhost rebuild.

"Enable SSL" used to edit the vhost in place (add_ssl_to_site) while every
later rewrite — deploys, slot switches, attaching a domain, drift repair,
restore — rebuilt it from the Domain rows, which only knew wildcard certs.
So HTTPS on shop.com vanished at the next deploy while the row still said
ssl_enabled. Rebuilds now read each domain's own cert.
"""
import pytest

from app import db
from app.models import Application, Domain
from app.services.nginx_service import NginxService
from app.services.site_domain_service import SiteDomainService

SHOP = ('/etc/letsencrypt/live/shop.com/fullchain.pem', '/etc/letsencrypt/live/shop.com/privkey.pem')
WILD = ('/etc/le/live/acme.dev/fullchain.pem', '/etc/le/live/acme.dev/privkey.pem')


@pytest.fixture
def site(app, monkeypatch):
    monkeypatch.setattr(SiteDomainService, 'covering_base',
                        classmethod(lambda cls, h: 'acme.dev' if h.endswith('.acme.dev') else None))
    monkeypatch.setattr(SiteDomainService, 'https_enabled', classmethod(lambda cls, base: True))
    monkeypatch.setattr(SiteDomainService, 'wildcard_cert_paths', classmethod(lambda cls, base: WILD))
    application = Application(name='shopcssl', app_type='docker', port=8011, user_id=1)
    db.session.add(application)
    db.session.flush()
    shop = Domain(name='shop.com', application_id=application.id, is_primary=True,
                  ssl_enabled=True, ssl_certificate_path=SHOP[0], ssl_key_path=SHOP[1])
    db.session.add(shop)
    db.session.commit()
    yield application
    Domain.query.filter_by(application_id=application.id).delete()
    db.session.delete(application)
    db.session.commit()


def _render(application):
    kwargs, reason = SiteDomainService.app_vhost_kwargs(application)
    assert reason is None
    rendered = NginxService.render_site_config(**kwargs)
    assert rendered['success'], rendered
    return kwargs, rendered['config']


def test_custom_domain_cert_is_rendered(site):
    kwargs, config = _render(site)
    assert (kwargs['ssl_cert'], kwargs['ssl_key']) == SHOP
    assert f'ssl_certificate {SHOP[0]};' in config


def test_legacy_row_without_key_path_still_serves_https(site):
    """The domains API saved the key under a column that doesn't exist, so
    older rows carry only the fullchain path."""
    Domain.query.filter_by(name='shop.com').update({'ssl_key_path': None})
    db.session.commit()
    kwargs, _ = _render(site)
    assert (kwargs['ssl_cert'], kwargs['ssl_key']) == SHOP


def test_mixed_certs_get_one_server_set_each(site):
    db.session.add(Domain(name='shop.acme.dev', application_id=site.id))
    db.session.add(Domain(name='plain.example.org', application_id=site.id))
    db.session.commit()
    kwargs, config = _render(site)
    groups = {tuple(names): cert for names, *cert in kwargs['cert_groups']}
    assert groups[('shop.com',)] == list(SHOP)
    assert groups[('shop.acme.dev',)] == list(WILD)
    assert groups[('plain.example.org',)] == [None, None]
    assert config.count('listen 443 ssl') == 2  # one per HTTPS group
    assert 'server_name plain.example.org;' in config
    assert f'ssl_certificate {SHOP[0]};' in config and f'ssl_certificate {WILD[0]};' in config


def test_disabled_ssl_drops_back_to_http(site):
    Domain.query.filter_by(name='shop.com').update({'ssl_enabled': False})
    db.session.commit()
    kwargs, config = _render(site)
    assert kwargs['ssl_cert'] is None
    assert 'ssl_certificate' not in config


def test_add_ssl_to_site_twice_swaps_the_cert(tmp_path, monkeypatch):
    """The manual path re-run must not duplicate the 443 listen."""
    first = NginxService.render_site_config(
        'manual', 'static', ['m.example.com'], root_path='/var/www/m',
        ssl_cert='/old/fullchain.pem', ssl_key='/old/privkey.pem')['config']
    written = {}
    monkeypatch.setattr(NginxService, 'SITES_AVAILABLE', str(tmp_path))
    (tmp_path / 'manual').write_text(first, encoding='utf-8')
    monkeypatch.setattr(NginxService, 'read_vhost', classmethod(lambda cls, n: first))
    monkeypatch.setattr(NginxService, 'write_vhost',
                        classmethod(lambda cls, n, c, **k: written.setdefault('c', c) and {'success': True}))
    NginxService.add_ssl_to_site('manual', '/new/fullchain.pem', '/new/privkey.pem')
    assert written['c'].count('listen 443 ssl') == first.count('listen 443 ssl')
    assert 'ssl_certificate /new/fullchain.pem;' in written['c']
    assert 'ssl_certificate_key /new/privkey.pem;' in written['c']
    assert '/old/' not in written['c']
