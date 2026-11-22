"""Adopting a site that already runs on the host (issue #269).

The contract under test: discovery reads the live nginx / PHP-FPM / WordPress
config and describes each site; adopting writes database rows and NOTHING on
the host; and once adopted, no panel path rewrites or removes the config that
is serving the site.
"""
import hashlib
from unittest.mock import patch

import pytest

from factories import headers_for, make_user

WP_CONFIG = """<?php
define( 'DB_NAME', 'shop_wp' );
define( 'DB_USER', 'shop_user' );
define( 'DB_PASSWORD', 'never-read-this' );
define( 'DB_HOST', 'localhost' );
$table_prefix = 'shp_';
"""


@pytest.fixture
def host(tmp_path, monkeypatch):
    """A fake host: one WordPress site on PHP-FPM, one static site, one proxied
    app, a www redirect, the panel's own vhost and the distro default."""
    from app.services import site_adoption_service
    from app.services.nginx_service import NginxService

    nginx = tmp_path / 'nginx'
    available, enabled = nginx / 'sites-available', nginx / 'sites-enabled'
    for directory in (available, enabled, nginx / 'conf.d'):
        directory.mkdir(parents=True)
    php = tmp_path / 'php'
    pool_dir = php / '8.4' / 'fpm' / 'pool.d'
    pool_dir.mkdir(parents=True)
    (pool_dir / 'shop.conf').write_text(
        '; pool for the shop\n[shop]\nuser = shop\nlisten = /run/php/shop.sock\n',
        encoding='utf-8')

    shop_root = tmp_path / 'www' / 'shop' / 'public'
    (shop_root / 'wp-includes').mkdir(parents=True)
    (shop_root / 'wp-config.php').write_text(WP_CONFIG, encoding='utf-8')
    (shop_root / 'wp-includes' / 'version.php').write_text(
        "<?php\n$wp_version = '6.8.1';\n", encoding='utf-8')
    docs_root = tmp_path / 'www' / 'docs'
    docs_root.mkdir(parents=True)

    files = {
        'shop.example.com.conf': f"""
            # Site: shop
            server {{
                listen 80;
                server_name shop.example.com www.shop.example.com;
                return 301 https://shop.example.com$request_uri;
            }}
            server {{
                listen 443 ssl http2;
                server_name shop.example.com;
                root {shop_root.as_posix()};
                ssl_certificate /etc/letsencrypt/live/shop.example.com/fullchain.pem;
                ssl_certificate_key /etc/letsencrypt/live/shop.example.com/privkey.pem;
                location ~ \\.php$ {{
                    fastcgi_pass unix:/run/php/shop.sock;
                }}
            }}
        """,
        'docs.example.com.conf': f"""
            server {{
                listen 80;
                server_name docs.example.com;
                root "{docs_root.as_posix()}";
            }}
        """,
        'api.example.com.conf': """
            server {
                listen 80;
                server_name api.example.com;
                location / { proxy_pass http://127.0.0.1:3210; }
            }
        """,
        'serverkit.conf': """
            server { listen 80 default_server; server_name _; root /opt/serverkit; }
        """,
        'default': """
            server { listen 80; server_name _; root /var/www/html; }
        """,
    }
    for name, body in files.items():
        (available / name).write_text(body, encoding='utf-8')
        # A copy, not a symlink: Windows dev boxes cannot create symlinks.
        (enabled / name).write_text(body, encoding='utf-8')

    monkeypatch.setattr(NginxService, 'NGINX_CONF_DIR', str(nginx))
    monkeypatch.setattr(NginxService, 'SITES_AVAILABLE', str(available))
    monkeypatch.setattr(NginxService, 'SITES_ENABLED', str(enabled))
    monkeypatch.setattr(site_adoption_service, 'PHP_ETC_DIR', str(php))
    return {'root': tmp_path, 'shop_root': shop_root.as_posix(),
            'docs_root': docs_root.as_posix()}


def _snapshot(root):
    """Content hash of every file under the fake host."""
    return {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(root.rglob('*')) if path.is_file()}


@pytest.fixture
def admin(app):
    from app import db
    return make_user(db, 'adopt_admin', 'admin')


def _by_domain(sites):
    return {site['primary_domain']: site for site in sites}


# --------------------------------------------------------------- discovery

def test_discovery_describes_each_site_and_skips_the_panel(app, host):
    from app.services import site_adoption_service
    sites = _by_domain(site_adoption_service.discover())
    # The panel's own vhost and the catch-all default are not sites.
    assert set(sites) == {'shop.example.com', 'docs.example.com', 'api.example.com'}

    shop = sites['shop.example.com']
    assert shop['kind'] == 'php' and shop['app_type'] == 'wordpress'
    assert shop['root'] == host['shop_root']
    # The :80 redirect block and its www name fold into the one site.
    assert shop['domains'] == ['shop.example.com', 'www.shop.example.com']
    # 8.4 is outside PHPService.SUPPORTED_VERSIONS — found by the pool's socket.
    assert shop['php'] == {'version': '8.4', 'pool': 'shop', 'listen': '/run/php/shop.sock',
                           'pool_file': shop['php']['pool_file']}
    assert shop['ssl']['enabled'] and shop['ssl']['letsencrypt']
    assert shop['ssl']['certificate'].endswith('shop.example.com/fullchain.pem')
    assert shop['wordpress']['version'] == '6.8.1'
    assert shop['database'] == {'engine': 'mysql', 'name': 'shop_wp',
                                'user': 'shop_user', 'host': 'localhost'}
    assert shop['adoptable'] and shop['linked_app'] is None

    docs = sites['docs.example.com']
    assert (docs['kind'], docs['app_type'], docs['adoptable']) == ('static', 'static', True)
    assert docs['root'] == host['docs_root'] and docs['php'] is None

    api = sites['api.example.com']
    assert (api['kind'], api['port'], api['adoptable']) == ('proxy', 3210, False)
    assert 'Docker Compose or systemd' in api['reason']


def test_discovery_never_exposes_the_database_password(app, host):
    from app.services import site_adoption_service
    assert 'never-read-this' not in repr(site_adoption_service.discover())


def test_php_version_falls_back_to_the_socket_name(app, host):
    from app.services import site_adoption_service
    assert site_adoption_service._php_for('unix:/run/php/php8.2-fpm.sock', [])['version'] == '8.2'
    assert site_adoption_service._php_for('127.0.0.1:9000', [])['version'] is None


# ----------------------------------------------------------------- adopting

def test_dry_run_is_the_default_and_changes_nothing(client, host, admin):
    from app.models.application import Application
    before = _snapshot(host['root'])
    resp = client.post('/api/v1/site-adoption/adopt', json={'site': 'shop.example.com'},
                       headers=headers_for(admin))
    assert resp.status_code == 200
    body = resp.get_json()
    assert body['dry_run'] is True and body['adoptable'] is True
    assert body['plan']['application'] == {
        'name': 'shop-example-com', 'app_type': 'wordpress', 'managed_by': 'host',
        'source': 'manual', 'root_path': host['shop_root'], 'php_version': '8.4'}
    assert [d['name'] for d in body['plan']['domains']] == [
        'shop.example.com', 'www.shop.example.com']
    assert any(path.endswith('shop.example.com.conf') for path in body['plan']['untouched'])
    assert Application.query.filter_by(name='shop-example-com').first() is None
    assert _snapshot(host['root']) == before


def test_adopt_records_the_site_and_writes_nothing_to_the_host(client, host, admin):
    from app.models.application import Application
    from app.models.domain import Domain
    from app.models.managed_database import ManagedDatabase
    from app.models.wordpress_site import WordPressSite
    before = _snapshot(host['root'])
    with patch('app.services.nginx_service.NginxService.create_site',
               side_effect=AssertionError('adoption wrote a vhost')), \
            patch('app.services.nginx_service.NginxService.write_vhost',
                  side_effect=AssertionError('adoption wrote a vhost')):
        resp = client.post('/api/v1/site-adoption/adopt',
                           json={'site': 'shop.example.com', 'dry_run': False},
                           headers=headers_for(admin))
    assert resp.status_code == 201, resp.get_json()
    assert _snapshot(host['root']) == before

    app_row = Application.query_active().filter_by(name='shop-example-com').one()
    assert (app_row.app_type, app_row.managed_by, app_row.source) == ('wordpress', 'host', 'manual')
    assert (app_row.status, app_row.php_version, app_row.root_path) == (
        'running', '8.4', host['shop_root'])
    assert app_row.is_host_managed and app_row.workspace_id is not None

    domains = Domain.query_active().filter_by(application_id=app_row.id).order_by(Domain.id).all()
    assert [(d.name, d.is_primary, d.ssl_enabled) for d in domains] == [
        ('shop.example.com', True, True), ('www.shop.example.com', False, True)]
    assert domains[0].ssl_certificate_path.endswith('shop.example.com/fullchain.pem')

    wp = WordPressSite.query.filter_by(application_id=app_row.id).one()
    assert (wp.db_name, wp.db_user, wp.db_prefix, wp.wp_version) == (
        'shop_wp', 'shop_user', 'shp_', '6.8.1')
    # Not a compose site: nothing invented for the container fields.
    assert wp.compose_project_name is None and wp.container_prefix is None

    database = ManagedDatabase.query_active().filter_by(name='shop_wp').one()
    assert database.owner_application_id == app_row.id and database.origin == 'adopted'


def test_an_adopted_site_is_no_longer_reported_or_adoptable(client, host, admin):
    listing = client.get('/api/v1/site-adoption/sites', headers=headers_for(admin)).get_json()
    assert (listing['unmanaged'], listing['adoptable']) == (3, 2)

    client.post('/api/v1/site-adoption/adopt',
                json={'site': 'docs.example.com', 'dry_run': False, 'name': 'docs'},
                headers=headers_for(admin))
    listing = client.get('/api/v1/site-adoption/sites', headers=headers_for(admin)).get_json()
    assert (listing['unmanaged'], listing['adoptable']) == (2, 1)
    docs = _by_domain(listing['sites'])['docs.example.com']
    assert docs['linked_app']['name'] == 'docs' and not docs['adoptable']

    again = client.post('/api/v1/site-adoption/adopt',
                        json={'site': 'docs.example.com', 'dry_run': False},
                        headers=headers_for(admin))
    assert again.status_code == 409 and 'Already managed' in again.get_json()['error']


@pytest.mark.parametrize('site,status', [
    ('api.example.com', 409),       # a proxied process, not a host site
    ('nope.example.com', 404),      # nothing nginx serves
    ('serverkit.conf', 404),        # the panel itself is never offered
])
def test_adopt_refuses_what_it_should_not_register(client, host, admin, site, status):
    resp = client.post('/api/v1/site-adoption/adopt', json={'site': site, 'dry_run': False},
                       headers=headers_for(admin))
    assert resp.status_code == status


def test_adoption_is_admin_only(client, host, app):
    from app import db
    developer = make_user(db, 'adopt_dev', 'developer')
    assert client.get('/api/v1/site-adoption/sites',
                      headers=headers_for(developer)).status_code == 403
    assert client.post('/api/v1/site-adoption/adopt', json={'site': 'docs.example.com'},
                       headers=headers_for(developer)).status_code == 403
    assert client.get('/api/v1/site-adoption/sites').status_code == 401


# ------------------------------------- the panel leaves the running config alone

@pytest.fixture
def adopted(client, host, admin):
    from app.models.application import Application
    client.post('/api/v1/site-adoption/adopt',
                json={'site': 'shop.example.com', 'dry_run': False}, headers=headers_for(admin))
    return Application.query_active().filter_by(name='shop-example-com').one()


def test_vhost_writer_and_drift_skip_a_host_managed_site(app, adopted):
    from app.services import drift_service
    from app.services.site_domain_service import SiteDomainService
    with patch('app.services.nginx_service.NginxService.create_site',
               side_effect=AssertionError('rewrote a host-managed vhost')):
        result = SiteDomainService.write_app_vhost(adopted)
    assert result['nginx'] is None and 'host-managed' in result['warning']
    assert adopted.id not in {app_id for app_id, _ in drift_service._nginx_list_resources()}
    assert drift_service._nginx_render_expected(adopted.id) == {}


def test_adding_a_domain_records_it_without_touching_nginx(client, admin, host):
    # The static site, not the WordPress one: a static app has everything the
    # vhost writer needs (a root), so only the host-managed guard stops it.
    from app.models.application import Application
    client.post('/api/v1/site-adoption/adopt',
                json={'site': 'docs.example.com', 'dry_run': False}, headers=headers_for(admin))
    adopted = Application.query_active().filter_by(name='docs-example-com').one()
    before = _snapshot(host['root'])
    # A mock, not a raising stub: the vhost writer swallows exceptions by design.
    with patch('app.services.nginx_service.NginxService.create_site') as create_site:
        resp = client.post('/api/v1/domains',
                           json={'name': 'store.example.com', 'application_id': adopted.id},
                           headers=headers_for(admin))
    assert resp.status_code in (200, 201), resp.get_json()
    create_site.assert_not_called()
    assert _snapshot(host['root']) == before


@pytest.mark.parametrize('action', ['start', 'stop', 'restart'])
def test_lifecycle_refuses_instead_of_lying(client, admin, adopted, action):
    resp = client.post(f'/api/v1/apps/{adopted.id}/{action}', headers=headers_for(admin))
    assert resp.status_code >= 400
    assert 'host-managed' in resp.get_data(as_text=True)
    assert adopted.status == 'running'


def test_deleting_an_adopted_site_forgets_it_but_keeps_it_serving(client, admin, adopted, host):
    from app.models.application import Application
    before = _snapshot(host['root'])
    # Mocks, not raising stubs: the delete path catches exceptions per step,
    # so a raise would be swallowed and this would pass with the guard removed.
    with patch('app.services.nginx_service.NginxService.disable_site') as disable_site, \
            patch('app.services.nginx_service.NginxService.delete_site') as delete_site:
        resp = client.delete(f'/api/v1/apps/{adopted.id}', headers=headers_for(admin))
    assert resp.status_code == 200, resp.get_json()
    disable_site.assert_not_called()
    delete_site.assert_not_called()
    assert Application.query_active().filter_by(id=adopted.id).first() is None
    assert _snapshot(host['root']) == before


def test_status_follows_nginx_and_never_guesses(app, adopted):
    from app import db
    from app.api.apps import _sync_manual_app_status
    probe = 'app.services.process_service.ProcessService.get_systemd_unit_status'
    with patch(probe, return_value={'success': True, 'status': 'inactive', 'active': False}):
        _sync_manual_app_status(adopted)
    assert adopted.status == 'stopped'
    with patch(probe, return_value={'success': True, 'status': 'active', 'active': True}):
        _sync_manual_app_status(adopted)
    assert adopted.status == 'running'
    # No systemd to ask (a dev box): keep what we knew.
    with patch(probe, return_value={'success': True, 'status': 'unknown', 'active': False}):
        _sync_manual_app_status(adopted)
    assert adopted.status == 'running'
    db.session.rollback()


def test_manual_route_accepts_host_for_sites_only(client, admin, host):
    ok = client.post('/api/v1/apps/manual', headers=headers_for(admin), json={
        'name': 'docs-manual', 'app_type': 'static', 'root_path': host['docs_root'],
        'managed_by': 'host'})
    assert ok.status_code == 201, ok.get_json()
    assert ok.get_json()['app']['managed_by'] == 'host'
    bad = client.post('/api/v1/apps/manual', headers=headers_for(admin), json={
        'name': 'api-manual', 'app_type': 'docker', 'root_path': host['docs_root'],
        'managed_by': 'host'})
    assert bad.status_code == 400


# ------------------------------------------------------------- drift report

def test_doctor_reports_unmanaged_sites_until_they_are_adopted(client, host, admin):
    from app.services.doctor_service import DoctorService

    def unmanaged():
        return {check['key']: check for check in DoctorService._unmanaged_site_checks()}

    checks = unmanaged()
    assert set(checks) == {'sites.unmanaged.shop.example.com.conf',
                           'sites.unmanaged.docs.example.com.conf',
                           'sites.unmanaged.api.example.com.conf'}
    shop = checks['sites.unmanaged.shop.example.com.conf']
    assert shop['status'] == 'warn' and not shop['repairable']
    assert 'serverkit adopt-site shop.example.com --apply' in shop['detail']
    # A proxied process is still reported, with why it is not adopted here.
    assert 'Docker Compose or systemd' in checks['sites.unmanaged.api.example.com.conf']['detail']

    client.post('/api/v1/site-adoption/adopt',
                json={'site': 'shop.example.com', 'dry_run': False}, headers=headers_for(admin))
    assert 'sites.unmanaged.shop.example.com.conf' not in unmanaged()


def test_doctor_stays_quiet_on_a_host_with_no_stray_sites(app, tmp_path, monkeypatch):
    from app.services.doctor_service import DoctorService
    from app.services.nginx_service import NginxService
    monkeypatch.setattr(NginxService, 'NGINX_CONF_DIR', str(tmp_path / 'absent'))
    monkeypatch.setattr(NginxService, 'SITES_ENABLED', str(tmp_path / 'absent' / 'sites-enabled'))
    assert DoctorService._unmanaged_site_checks() == []
