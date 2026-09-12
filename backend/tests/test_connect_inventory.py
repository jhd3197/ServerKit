"""The panel half of the Cloud inventory.

What matters: the key is the row id and survives a rename; a collector that
fails leaves its section out of `capabilities` and names the reason; nothing
that could carry a secret is in the document; the frame is the existing
`facts` stream kind so an older Cloud is not confused by it.
"""
import json
from datetime import datetime, timedelta

import pytest
from types import SimpleNamespace

from app.services import connect_inventory
from factories import make_application, make_user


@pytest.fixture()
def apps(app):
    from app import db
    from app.models.deployment import Deployment
    from app.models.domain import Domain
    from app.models.user import User

    with app.app_context():
        user = User.query.first()
        if user is None:
            user = make_user(db)
        shop = make_application(db, name='shop', app_type='wordpress', status='running',
                                port=8080, user_id=user.id, managed_by=None,
                                compose_file=None, docker_image=None)
        worker = make_application(db, name='worker', app_type='docker', status='error',
                                  docker_image='registry.test/worker:1', user_id=user.id,
                                  managed_by=None, compose_file=None)
        db.session.add(Domain(name='shop.example.test', is_primary=True, ssl_enabled=True,
                              ssl_expires_at=datetime.utcnow() + timedelta(days=30),
                              application_id=shop.id))
        started = datetime.utcnow() - timedelta(minutes=10)
        db.session.add(Deployment(app_id=shop.id, version=3, status='live',
                                  commit_hash='a41f9c2b1d5e', image_tag='registry.test/shop:3',
                                  build_started_at=started,
                                  build_completed_at=started + timedelta(seconds=32),
                                  deploy_started_at=started + timedelta(seconds=32),
                                  deploy_completed_at=started + timedelta(seconds=50)))
        db.session.add(Deployment(app_id=shop.id, version=2, status='failed',
                                  build_started_at=started - timedelta(hours=1)))
        db.session.commit()
        yield {'shop': shop.id, 'worker': worker.id}


def _by_key(doc, key):
    return next(a for a in doc['applications'] if a['key'] == str(key))


def test_applications_are_keyed_on_the_row_id_and_carry_only_safe_fields(app, apps):
    doc = connect_inventory.build_inventory(app, generation=4)
    assert doc['schema'] == 'inventory/1'
    assert doc['generation'] == 4
    assert 'applications' in doc['capabilities']
    assert doc['sections']['applications'] == {'complete': True}

    shop = _by_key(doc, apps['shop'])
    assert shop['name'] == 'shop'
    assert shop['runtime'] == 'native'
    assert shop['state'] == 'running'
    assert shop['domains'][0]['host'] == 'shop.example.test'
    assert shop['domains'][0]['tls_expires_at']
    assert shop['ports'] == [8080]
    assert shop['deployment']['key'] == f'{apps["shop"]}:3'
    assert shop['deployment']['status'] == 'succeeded'
    assert shop['source'] == {'commit': 'a41f9c2b1d5e'}
    # The panel installed this WordPress, so its dashboard is a fact.
    assert shop['admin_url'] == 'https://shop.example.test/wp-admin/'

    worker = _by_key(doc, apps['worker'])
    assert worker['runtime'] == 'docker'
    assert worker['state'] == 'failed'
    assert 'admin_url' not in worker

    text = json.dumps(doc)
    for forbidden in ('root_path', 'admin_secret', 'container_id', 'env', 'password'):
        assert forbidden not in text, forbidden


def test_a_rename_keeps_the_key(app, apps):
    from app import db
    from app.models.application import Application
    before = _by_key(connect_inventory.build_inventory(app), apps['shop'])['key']
    with app.app_context():
        row = db.session.get(Application, apps['shop'])
        row.name = 'shop-v2'
        db.session.commit()
    after = _by_key(connect_inventory.build_inventory(app), apps['shop'])
    assert after['key'] == before and after['name'] == 'shop-v2'


def test_deployments_are_history_with_stages_only_where_recorded(app, apps):
    doc = connect_inventory.build_inventory(app)
    assert 'deployments' in doc['capabilities']
    mine = [d for d in doc['deployments'] if d['app_key'] == str(apps['shop'])]
    assert [d['key'] for d in mine] == [f'{apps["shop"]}:3', f'{apps["shop"]}:2']
    live = mine[0]
    assert live['status'] == 'succeeded'
    assert live['artifact'] == {'image': 'registry.test/shop:3', 'commit': 'a41f9c2b1d5e'}
    assert [s['name'] for s in live['stages']] == ['build', 'deploy']
    assert round(live['stages'][0]['duration_s']) == 32
    assert round(live['duration_s']) == 50
    failed = mine[1]
    assert failed['status'] == 'failed' and 'stages' not in failed


def test_a_collector_that_raises_leaves_its_section_out_and_says_why(app, apps, monkeypatch):
    def boom():
        raise RuntimeError('docker did not answer')
    monkeypatch.setattr(connect_inventory, '_databases', boom)
    doc = connect_inventory.build_inventory(app)
    assert 'databases' not in doc
    assert 'databases' not in doc['capabilities']
    assert doc['sections']['databases']['complete'] is False
    assert doc['sections']['databases']['error'] == 'RuntimeError'
    # The other sections are still there.
    assert 'applications' in doc['capabilities']


def test_the_repo_slug_never_carries_a_host_or_a_token():
    slug = connect_inventory._repo_slug
    assert slug('https://oauth2:ghp_secret@github.com/acme/api.git') == 'acme/api'
    assert slug('git@github.com:acme/api.git') == 'acme/api'
    assert slug('https://gitlab.example.test/group/sub/api') == 'sub/api'
    assert slug('') is None and slug(None) is None


def test_the_frame_is_the_facts_stream_kind():
    frame = connect_inventory.inventory_frame('inv1', {'schema': 'inventory/1'})
    assert frame == {'s': 'inv1', 't': 'open', 'k': 'facts', 'p': {'schema': 'inventory/1'}}


def test_diagnostics_never_include_a_command_line(monkeypatch):
    doc = connect_inventory.build_diagnostics(60)
    assert doc['schema'] == 'diagnostics/1'
    assert doc['interval_s'] == 60
    assert len(doc['processes']) <= connect_inventory.MAX_PROCESSES
    for proc in doc['processes']:
        assert set(proc) <= {'pid', 'name', 'user', 'cpu_pct', 'rss_bytes', 'started_at'}
    assert 'processes' in doc['completeness'] and 'mounts' in doc['completeness']


def test_the_client_backs_off_when_cloud_refuses_diagnostics():
    from app.services import connect_client
    client = connect_client.RelayClient(None)
    client._apply_diagnostics_ack({'ok': False, 'reason': 'scope_not_granted', 'collect': False})
    import time
    assert client._diagnostics_next_at > time.monotonic() + connect_client.DIAGNOSTICS_INTERVAL_S
    client._apply_inventory_ack({'ok': True, 'next_interval_s': 300})
    assert client._inventory_next_at > time.monotonic() + 200


@pytest.mark.parametrize('url', [
    'https://oauth2:secret@github.com/acme/api.git?token=secret#private',
    'git@github.com:acme/api.git?token=secret#private',
    'https://github.com/acme/api.git#token=secret',
])
def test_repo_slugs_strip_queries_and_fragments(url):
    assert connect_inventory._repo_slug(url) == 'acme/api'


def test_admin_link_uses_primary_domains_own_tls_state():
    secondary = SimpleNamespace(name='secondary.test', is_primary=False, ssl_enabled=True,
                                ssl_expires_at=datetime.utcnow() + timedelta(days=30))
    primary = SimpleNamespace(name='primary.test', is_primary=True, ssl_enabled=False)
    row = SimpleNamespace(app_type='wordpress', live_domains=[secondary, primary])
    domains = connect_inventory._app_domains(row)
    assert connect_inventory._admin_url(row, domains) == 'http://primary.test/wp-admin/'
    primary.ssl_enabled = True
    domains = connect_inventory._app_domains(row)
    assert connect_inventory._admin_url(row, domains) == 'https://primary.test/wp-admin/'


def test_deleted_resources_and_their_logs_are_excluded(app, apps):
    from app import db
    from app.models.application import Application
    from app.models.managed_database import ManagedDatabase
    from app.services.connect_logs import AppOutput, DeployOutput

    with app.app_context():
        shop = db.session.get(Application, apps['shop'])
        shop.soft_delete()
        active = ManagedDatabase(name='active-db', engine='postgresql')
        deleted = ManagedDatabase(name='deleted-db', engine='postgresql')
        deleted.soft_delete()
        db.session.add_all([active, deleted])
        db.session.commit()
        doc = connect_inventory.build_inventory(app)
        assert str(shop.id) not in {r['key'] for r in doc['applications']}
        assert str(shop.id) not in {r['app_key'] for r in doc['deployments']}
        assert [r['name'] for r in doc['databases']] == ['active-db']
        assert shop.id not in {r.id for r in AppOutput(app)._applications()}
        assert shop.id not in {r.app_id for r in DeployOutput(app)._recent()}


@pytest.mark.parametrize('consent', [None, False, 1, 'true'])
def test_diagnostics_probes_never_collect_without_explicit_consent(monkeypatch, consent):
    from app.services import connect_client
    client = connect_client.RelayClient()

    def forbidden(*args):
        pytest.fail('processes and mounts must not be collected without consent')

    monkeypatch.setattr(connect_inventory, 'build_diagnostics', forbidden)
    frames = []
    ws = SimpleNamespace(send=lambda raw: frames.append(json.loads(raw)))
    assert client._publish_diagnostics(ws)
    assert frames[-1]['p']['processes'] == []
    assert frames[-1]['p']['mounts'] == []
    payload = {'ok': True}
    if consent is not None:
        payload['collect'] = consent
    client._apply_diagnostics_ack(payload)
    client._diagnostics_next_at = 0.0  # the refusal retry window has elapsed
    assert client._publish_diagnostics(ws)
    assert frames[-1]['p']['processes'] == []
    assert client._diagnostics_collect is False


def test_explicit_diagnostics_consent_enables_next_collection(monkeypatch):
    from app.services import connect_client
    client = connect_client.RelayClient()
    frames = []
    ws = SimpleNamespace(send=lambda raw: frames.append(json.loads(raw)))
    client._publish_diagnostics(ws)
    client._handle_frame(ws, json.dumps({
        's': frames[-1]['s'], 't': 'close', 'p': {'ok': True, 'collect': True},
    }))
    monkeypatch.setattr(connect_inventory, 'build_diagnostics',
                        lambda *args: {'schema': 'diagnostics/1', 'processes': [{'pid': 7}]})
    assert client._publish_diagnostics(ws)
    assert frames[-1]['p']['processes'] == [{'pid': 7}]
    client._handle_frame(ws, json.dumps({
        's': frames[-1]['s'], 't': 'close', 'p': {'ok': False, 'collect': False},
    }))
    assert client._diagnostics_collect is False
