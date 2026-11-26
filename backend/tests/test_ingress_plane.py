"""Ingress-plane boundary: defaults, eligibility, and proxy/app mismatch audit."""
import pytest

from app.utils.ingress import (
    INGRESS_NGINX, INGRESS_PROXY,
    proxy_eligible, default_ingress_plane, normalize_ingress_plane,
    expected_plane_for_proxy,
)


# ---- pure helpers -------------------------------------------------------

def test_default_plane_is_always_nginx():
    for t in ('php', 'wordpress', 'static', 'flask', 'django', 'docker'):
        assert default_ingress_plane(t) == INGRESS_NGINX


def test_only_container_apps_are_proxy_eligible():
    assert proxy_eligible('docker') is True
    assert proxy_eligible('php') is False
    assert proxy_eligible('wordpress') is False
    assert proxy_eligible('static') is False
    assert proxy_eligible('flask') is False
    # compose-managed non-docker app type is still eligible
    assert proxy_eligible('generic', managed_by='docker_compose') is True


def test_normalize_rejects_proxy_for_ineligible_types():
    # WordPress/PHP/static can never be tagged for the proxy stack
    assert normalize_ingress_plane('proxy_stack', 'wordpress') == INGRESS_NGINX
    assert normalize_ingress_plane('proxy_stack', 'php') == INGRESS_NGINX
    assert normalize_ingress_plane('proxy_stack', 'static') == INGRESS_NGINX
    # Docker can opt in
    assert normalize_ingress_plane('proxy_stack', 'docker') == INGRESS_PROXY
    # Unknown / empty -> default nginx
    assert normalize_ingress_plane('', 'docker') == INGRESS_NGINX
    assert normalize_ingress_plane('bogus', 'docker') == INGRESS_NGINX
    assert normalize_ingress_plane(None, 'docker') == INGRESS_NGINX


def test_expected_plane_for_proxy():
    assert expected_plane_for_proxy('nginx') == INGRESS_NGINX
    assert expected_plane_for_proxy(None) == INGRESS_NGINX
    assert expected_plane_for_proxy('traefik') == INGRESS_PROXY
    assert expected_plane_for_proxy('caddy') == INGRESS_PROXY


# ---- DB-backed audit ----------------------------------------------------

def _make_server(app, name='srv'):
    from app import db
    from app.models.server import Server
    s = Server(name=name, status='online')
    db.session.add(s)
    db.session.commit()
    return s


def _make_app(server_id, app_type='docker', ingress_plane=None, name='a'):
    from app import db
    from app.models.application import Application
    a = Application(
        name=name, app_type=app_type, status='running',
        server_id=server_id, user_id=1, ingress_plane=ingress_plane,
    )
    db.session.add(a)
    db.session.commit()
    return a


def test_audit_no_mismatch_on_default_nginx_server(app):
    from app.services.proxy_stack_service import ProxyStackService
    with app.app_context():
        s = _make_server(app, 'nginx-srv')
        _make_app(s.id, 'wordpress')          # nginx plane (default)
        _make_app(s.id, 'docker')             # nginx plane (default — opt-in only)
        audit = ProxyStackService.ingress_audit(s.id)
        assert audit['proxy_type'] == 'nginx'
        assert audit['expected_plane'] == INGRESS_NGINX
        assert audit['app_count'] == 2
        assert audit['mismatch_count'] == 0


def test_audit_flags_nginx_app_on_proxy_server(app):
    from app.services.proxy_stack_service import ProxyStackService
    with app.app_context():
        s = _make_server(app, 'traefik-srv')
        ProxyStackService.switch(s.id, 'traefik')   # server now expects proxy_stack
        wp = _make_app(s.id, 'wordpress', name='wp')          # expects nginx -> mismatch
        svc = _make_app(s.id, 'docker', ingress_plane='proxy_stack', name='svc')  # matches
        audit = ProxyStackService.ingress_audit(s.id)
        assert audit['expected_plane'] == INGRESS_PROXY
        assert audit['app_count'] == 2
        assert audit['mismatch_count'] == 1
        by_name = {r['name']: r for r in audit['apps']}
        assert by_name['wp']['mismatch'] is True
        assert by_name['wp']['reason']
        assert by_name['svc']['mismatch'] is False


def test_fleet_overview_reports_mismatch_counts(app):
    from app.services.proxy_stack_service import ProxyStackService
    with app.app_context():
        s = _make_server(app, 'fleet-srv')
        ProxyStackService.switch(s.id, 'caddy')
        _make_app(s.id, 'php', name='php-site')   # nginx plane on a caddy server -> mismatch
        from app import db
        from factories import make_user
        admin = make_user(db, role='admin')
        rows = {r['server_id']: r for r in ProxyStackService.fleet_overview(admin)}
        row = rows[s.id]
        assert row['proxy_type'] == 'caddy'
        assert row['app_count'] == 1
        assert row['mismatch_count'] == 1


def test_audit_endpoint_resolves(app, client, auth_headers):
    with app.app_context():
        s = _make_server(app, 'ep-srv')
        sid = s.id  # capture before the context (and the row) detaches
    res = client.get(f'/api/v1/servers/{sid}/proxy/ingress-audit', headers=auth_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert 'expected_plane' in body and 'apps' in body
