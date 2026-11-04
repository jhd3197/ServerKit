"""Update detection: registry + builtin rows, compat, consent hints, API shape."""
import io
import json
import zipfile

import pytest

from app import db
from app.models.plugin import InstalledPlugin
from app.services import plugin_service, registry_service

pytestmark = pytest.mark.fresh_app


@pytest.fixture(autouse=True)
def _reset_registry_cache():
    registry_service._cache.update({'ts': 0.0, 'entries': None, 'source': None})
    yield
    registry_service._cache.update({'ts': 0.0, 'entries': None, 'source': None})


@pytest.fixture
def plugin_dirs(tmp_path, monkeypatch):
    d = {n: tmp_path / n for n in ('b', 'f', 'builtin')}
    for p in d.values():
        p.mkdir()
    monkeypatch.setattr(plugin_service, 'BACKEND_PLUGINS_DIR', str(d['b']))
    monkeypatch.setattr(plugin_service, 'FRONTEND_PLUGINS_DIR', str(d['f']))
    monkeypatch.setattr(plugin_service, 'BUILTIN_EXTENSIONS_DIR', str(d['builtin']))
    return d


def _manifest(slug, version):
    return {'name': slug, 'display_name': 'Ext ' + slug, 'version': version,
            'category': 'utility',
            'contributions': {'nav': [{'id': slug, 'label': 'X', 'route': '/x'}]}}


def _zip(slug, version):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('plugin.json', json.dumps(_manifest(slug, version)))
        zf.writestr('frontend/index.jsx', 'export function P(){return null;}\n')
    return buf.getvalue()


def _install_registry_row(monkeypatch, version='1.0.0'):
    data = _zip('regext', version)
    monkeypatch.setattr(plugin_service, '_download_zip', lambda url: io.BytesIO(data))
    return plugin_service.install_from_url('https://x/regext.zip')


def _advertise(version, **extra):
    registry_service._cache.update({
        'ts': 9e18, 'source': 'test',
        'entries': [registry_service._normalize({
            'slug': 'regext', 'display_name': 'Registry Ext', 'version': version,
            'source': 'https://x/regext.zip', 'min_panel_version': '0.0.1',
            **extra})],
    })


def _by_slug():
    return {u['slug']: u for u in plugin_service.check_for_updates()}


def test_registry_update_fields(app, plugin_dirs, monkeypatch):
    _install_registry_row(monkeypatch)
    _advertise('2.0.0')
    u = _by_slug()['regext']
    assert u['update_available'] is True
    assert u['display_name'] == 'Registry Ext'
    assert u['update_source'] == 'registry'
    assert isinstance(u['requires_ack'], bool)
    assert u['requires_ack'] == (u['risk'] is not None)
    assert u['incompatible_reason'] is None


def test_up_to_date(app, plugin_dirs, monkeypatch):
    _install_registry_row(monkeypatch)
    _advertise('1.0.0')
    assert _by_slug()['regext']['update_available'] is False


def test_incompatible_panel(app, plugin_dirs, monkeypatch):
    _install_registry_row(monkeypatch)
    _advertise('2.0.0', min_panel_version='999.0.0')
    u = _by_slug()['regext']
    assert u['compatible'] is False
    assert '999.0.0' in u['incompatible_reason']


def test_malformed_version_no_raise(app, plugin_dirs, monkeypatch):
    p = _install_registry_row(monkeypatch)
    _advertise('banana')
    assert _by_slug()['regext']['update_available'] is False
    p.version = 'also-bad'
    db.session.commit()
    assert _by_slug()['regext']['update_available'] is False


def test_builtin_update(app, plugin_dirs, monkeypatch):
    folder = plugin_dirs['builtin'] / 'bi-ext'
    (folder / 'frontend').mkdir(parents=True)
    (folder / 'frontend' / 'index.jsx').write_text('export function P(){return null;}\n')
    (folder / 'plugin.json').write_text(json.dumps(_manifest('bi-ext', '1.0.0')))
    p = plugin_service.install_from_path(str(folder), source_type='builtin')
    assert p.source_type == 'builtin'
    # A registry entry with the same slug must be ignored for builtin rows.
    assert plugin_service.check_for_updates()[0]['update_available'] is False

    (folder / 'plugin.json').write_text(json.dumps(_manifest('bi-ext', '1.1.0')))
    u = _by_slug()['bi-ext']
    assert u['update_available'] is True
    assert u['update_source'] == 'builtin'
    assert u['requires_ack'] is False and u['risk'] is None

    updated = plugin_service.update_plugin(p.id)
    assert updated.version == '1.1.0'
    assert updated.source_type == 'builtin'
    assert InstalledPlugin.query.filter_by(slug='bi-ext').count() == 1


def test_api_shape_and_refresh(app, client, auth_headers, plugin_dirs, monkeypatch):
    calls = []
    _install_registry_row(monkeypatch)
    _advertise('2.0.0')
    monkeypatch.setattr(registry_service, 'refresh',
                        lambda force=False: calls.append(force) or registry_service._cache['entries'])
    r = client.get('/api/v1/plugins/updates', headers=auth_headers)
    assert r.status_code == 200
    body = r.get_json()
    assert body['count'] == 1 and body['checked_at']
    assert 'registry_source' in body
    assert True not in calls
    client.get('/api/v1/plugins/updates?refresh=1', headers=auth_headers)
    assert True in calls
