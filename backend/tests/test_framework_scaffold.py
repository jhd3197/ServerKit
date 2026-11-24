"""Framework picker: registry, Laravel scaffolding, env wiring, migrate hook.

No Composer download, Docker daemon or PHP binary is needed: every subprocess
goes through FrameworkScaffoldService._run, which these tests replace.
"""

import os

import pytest

from app.services import framework_registry
from app.services.framework_scaffold_service import (
    FrameworkError, FrameworkScaffoldService as Svc,
)

LARAVEL = framework_registry.FRAMEWORKS['laravel']

ENV_EXAMPLE = (
    'APP_NAME=Laravel\nAPP_ENV=local\nAPP_KEY=\nAPP_DEBUG=true\nAPP_URL=http://localhost\n\n'
    'DB_CONNECTION=sqlite\n# DB_HOST=127.0.0.1\n# DB_PORT=3306\n'
)


@pytest.fixture(autouse=True)
def _reset_runner():
    yield
    Svc.set_runner(None)


@pytest.fixture
def apps_dir(tmp_path, monkeypatch):
    from app import paths
    monkeypatch.setattr(paths, 'APPS_DIR', str(tmp_path))
    return tmp_path


def _ok(output=''):
    return {'success': True, 'output': output, 'error': None, 'returncode': 0}


# -- registry ---------------------------------------------------------------
def test_registry_exposes_laravel_with_mysql_default_on():
    listed = {f['id']: f for f in framework_registry.list_frameworks()}
    assert listed['laravel']['available'] is True
    assert listed['laravel']['database']['default'] is True
    assert listed['laravel']['php_version'] == '8.3'
    assert framework_registry.get_framework('Laravel') is LARAVEL
    assert framework_registry.get_framework('nope') is None


def test_registry_database_env_covers_laravel_names():
    env = LARAVEL['database']['env']
    assert set(env) == {'DB_HOST', 'DB_PORT', 'DB_DATABASE', 'DB_USERNAME', 'DB_PASSWORD'}
    assert LARAVEL['post_deploy'] == [['php', 'artisan', 'migrate', '--force']]


# -- pure helpers -----------------------------------------------------------
def test_app_key_matches_artisan_format():
    import base64
    key = Svc.generate_app_key()
    assert key.startswith('base64:')
    assert len(base64.b64decode(key[7:])) == 32
    assert key != Svc.generate_app_key()


def test_render_env_replaces_uncomments_and_appends():
    out = Svc.render_env(ENV_EXAMPLE, {'APP_KEY': 'base64:x', 'DB_HOST': 'h', 'NEW': '1'})
    assert 'APP_KEY=base64:x' in out
    assert '\nDB_HOST=h\n' in out and '# DB_HOST' not in out
    assert out.rstrip().endswith('NEW=1')
    assert 'APP_ENV=local' in out  # untouched keys survive


def test_validate_domain():
    assert Svc.validate_domain('') is None
    assert Svc.validate_domain('https://Blog.Example.com/x') == 'blog.example.com'
    with pytest.raises(FrameworkError):
        Svc.validate_domain('not a domain')


def test_build_plan_generates_fpm_nginx_image_on_public():
    from app.services.buildpack_service import BuildpackService
    dockerfile = BuildpackService.generate_dockerfile(Svc.build_plan(LARAVEL, 8123))
    assert 'FROM php:8.3-fpm' in dockerfile
    assert 'listen 8123;' in dockerfile and 'root /var/www/html/public;' in dockerfile
    assert 'pdo_mysql' in dockerfile and '|| true' not in dockerfile and 'php -S' not in dockerfile


# -- scaffolding ------------------------------------------------------------
def test_scaffold_runs_composer_in_container_and_creates_project(apps_dir, monkeypatch):
    target = str(apps_dir / 'shop')
    calls = []

    def fake(cmd, cwd=None, timeout=None):
        calls.append(cmd)
        open(os.path.join(target, 'artisan'), 'w').close()
        return _ok('Created project')

    Svc.set_runner(fake)
    monkeypatch.setattr('shutil.which', lambda b: '/usr/bin/docker' if b == 'docker' else None)
    Svc.scaffold_project(LARAVEL, target, lambda m: None)

    cmd = calls[0]
    assert cmd[:3] == ['docker', 'run', '--rm']
    assert 'composer:2' in cmd
    script = cmd[-1]
    assert 'create-project laravel/laravel:^11.0' in script
    assert 'platform.php 8.3.0' in script


def test_scaffold_falls_back_to_host_composer(apps_dir, monkeypatch):
    target = str(apps_dir / 'shop')
    seen = []

    def fake(cmd, cwd=None, timeout=None):
        seen.append(cmd)
        open(os.path.join(target, 'artisan'), 'w').close()
        return _ok()

    Svc.set_runner(fake)
    monkeypatch.setattr('shutil.which', lambda b: None if b == 'docker' else '/usr/bin/' + b)
    Svc.scaffold_project(LARAVEL, target, lambda m: None)
    assert seen[0][:2] == ['sh', '-c']


def test_scaffold_without_docker_or_composer_is_a_clear_error(apps_dir, monkeypatch):
    monkeypatch.setattr('shutil.which', lambda b: None)
    with pytest.raises(RuntimeError, match='Docker'):
        Svc.scaffold_project(LARAVEL, str(apps_dir / 'shop'), lambda m: None)


def test_scaffold_surfaces_composer_failure(apps_dir, monkeypatch):
    Svc.set_runner(lambda cmd, cwd=None, timeout=None: {
        'success': False, 'output': 'Could not resolve host', 'error': 'exit 1', 'returncode': 1})
    monkeypatch.setattr('shutil.which', lambda b: '/usr/bin/' + b)
    with pytest.raises(RuntimeError, match='composer create-project failed'):
        Svc.scaffold_project(LARAVEL, str(apps_dir / 'shop'), lambda m: None)


def test_scaffold_reuses_existing_project(apps_dir):
    (apps_dir / 'shop').mkdir()
    (apps_dir / 'shop' / 'artisan').write_text('')
    Svc.set_runner(lambda *a, **k: pytest.fail('must not re-run composer'))
    Svc.scaffold_project(LARAVEL, str(apps_dir / 'shop'), lambda m: None)


# -- files + env ------------------------------------------------------------
class _App:
    id = 7
    name = 'shop'
    port = 8123

    def __init__(self, root):
        self.root_path = str(root)


def test_write_project_files_generates_key_once_and_keeps_secrets_out_of_image(tmp_path):
    (tmp_path / '.env.example').write_text(ENV_EXAMPLE)
    app = _App(tmp_path)

    key = Svc.write_project_files(LARAVEL, app, 'https://shop.example.com', True, lambda m: None)
    env = (tmp_path / '.env').read_text()
    assert f'APP_KEY={key}' in env
    assert 'APP_URL=https://shop.example.com' in env
    assert 'APP_ENV=production' in env and 'DB_CONNECTION=mysql' in env
    assert 'DB_PASSWORD' not in env
    assert (tmp_path / 'Dockerfile').read_text().startswith('# syntax=docker/dockerfile:1')
    assert '.env' in (tmp_path / '.dockerignore').read_text().splitlines()

    again = Svc.write_project_files(LARAVEL, app, 'https://shop.example.com', True, lambda m: None)
    assert again == key  # a retry must not rotate the key


def test_write_project_files_without_database_uses_sqlite_and_file_sessions(tmp_path):
    (tmp_path / '.env.example').write_text(ENV_EXAMPLE)
    Svc.write_project_files(LARAVEL, _App(tmp_path), 'http://h:1', False, lambda m: None)
    env = (tmp_path / '.env').read_text()
    assert 'SESSION_DRIVER=file' in env
    assert (tmp_path / 'database' / 'database.sqlite').exists()


# -- DB provisioning + env wiring (real models) -------------------------------
@pytest.fixture
def web_app(app):
    from app import db
    from app.models import Application
    from factories import make_user
    row = Application(name='shop', app_type='docker', status='stopped', port=8123,
                      user_id=make_user(db).id)
    db.session.add(row)
    db.session.commit()
    return row


def test_wire_env_uses_from_service_refs_not_literal_secrets(web_app):
    from app.models import EnvironmentVariable
    Svc.wire_env(LARAVEL, web_app, 'http://h:8123', 'base64:abc', True, None)

    rows = {e.key: e for e in EnvironmentVariable.query.filter_by(application_id=web_app.id)}
    for key, prop in LARAVEL['database']['env'].items():
        ref = rows[key].get_reference()
        assert ref == {'kind': 'service', 'service': 'shop-db', 'property': prop}
    assert rows['APP_URL'].value_from is None and 'APP_KEY' in rows
    assert rows['APP_KEY'].is_secret
    assert rows['DB_CONNECTION'] is not None


def test_provision_database_installs_mysql_template_once(web_app, monkeypatch):
    from app.services import database_engine_service as engines
    from app.services.deployment_job_service import DeploymentJobService
    installs = []
    monkeypatch.setattr(engines, 'plan_install', lambda **kw: {
        'app_name': kw['instance_name'], 'variables': {'DB_NAME': kw['initial_database']}})
    monkeypatch.setattr(DeploymentJobService, 'install_template', classmethod(
        lambda cls, **kw: installs.append(kw) or {'success': True}))

    Svc.provision_database(LARAVEL, web_app, True, None, lambda m: None)
    assert installs[0]['template_id'] == 'mysql' and installs[0]['app_name'] == 'shop-db'
    assert installs[0]['wait'] is True
    assert installs[0]['user_variables'] == {'DB_NAME': 'shop'}


def test_provision_database_failure_is_raised(web_app, monkeypatch):
    from app.services import database_engine_service as engines
    from app.services.deployment_job_service import DeploymentJobService
    monkeypatch.setattr(engines, 'plan_install', lambda **kw: {'app_name': 'shop-db', 'variables': {}})
    monkeypatch.setattr(DeploymentJobService, 'install_template', classmethod(
        lambda cls, **kw: {'success': False, 'error': 'port in use'}))
    with pytest.raises(RuntimeError, match='port in use'):
        Svc.provision_database(LARAVEL, web_app, True, None, lambda m: None)


def test_provision_database_skipped_when_unchecked(web_app, monkeypatch):
    from app.services.deployment_job_service import DeploymentJobService
    monkeypatch.setattr(DeploymentJobService, 'install_template', classmethod(
        lambda cls, **kw: pytest.fail('no DB requested')))
    Svc.provision_database(LARAVEL, web_app, False, None, lambda m: None)


# -- migrate-on-ready ---------------------------------------------------------
def test_migrate_retries_until_database_accepts_connections():
    results = [
        {'success': False, 'output': 'SQLSTATE[HY000] [2002] Connection refused', 'returncode': 1},
        {'success': False, 'output': 'SQLSTATE[HY000] [2002] Connection refused', 'returncode': 1},
        _ok('Migrated: create_users_table'),
    ]
    cmds = []
    Svc.set_runner(lambda cmd, cwd=None, timeout=None: cmds.append(cmd) or results.pop(0))

    Svc.run_post_deploy(LARAVEL, _App('/x'), True, lambda m: None, attempts=5, delay=0)

    assert len(cmds) == 3
    assert cmds[0][-4:] == ['php', 'artisan', 'migrate', '--force']
    assert 'serverkit-app-7' in cmds[0]


def test_migrate_failure_is_surfaced_not_swallowed():
    Svc.set_runner(lambda cmd, cwd=None, timeout=None: {
        'success': False, 'output': 'Access denied for user', 'returncode': 1})
    with pytest.raises(RuntimeError, match='Access denied'):
        Svc.run_post_deploy(LARAVEL, _App('/x'), True, lambda m: None, attempts=2, delay=0)


def test_migrate_without_database_runs_once():
    calls = []
    Svc.set_runner(lambda cmd, cwd=None, timeout=None: calls.append(cmd) or {
        'success': False, 'output': 'boom', 'returncode': 1})
    with pytest.raises(RuntimeError):
        Svc.run_post_deploy(LARAVEL, _App('/x'), False, lambda m: None, attempts=9, delay=0)
    assert len(calls) == 1


# -- start() / API ------------------------------------------------------------
def test_start_rejects_unknown_framework_and_bad_name(app, apps_dir):
    with pytest.raises(FrameworkError):
        Svc.start(framework_id='rails', name='shop', user_id=None)
    with pytest.raises(FrameworkError):
        Svc.start(framework_id='laravel', name='x', user_id=None)


def test_scaffold_api_queues_job_and_creates_app(client, auth_headers, apps_dir, monkeypatch):
    from app.services.deployment_job_service import DeploymentJobService
    queued = {}
    monkeypatch.setattr(DeploymentJobService, 'start_registered', classmethod(
        lambda cls, kind, **kw: queued.update(kind=kind, **kw) or {'success': True, 'job_id': 'j1'}))

    resp = client.post('/api/v1/frameworks/scaffold', headers=auth_headers, json={
        'framework': 'laravel', 'name': 'My Shop', 'domain': 'shop.example.com'})

    assert resp.status_code == 202, resp.get_json()
    body = resp.get_json()
    assert body['deploy_job_id'] == 'j1' and body['app']['name'] == 'my-shop'
    assert queued['kind'] == 'framework.scaffold'
    assert queued['plan']['add_database'] is True  # Laravel default
    assert queued['plan']['domain'] == 'shop.example.com'


def test_scaffold_api_requires_admin(client):
    assert client.post('/api/v1/frameworks/scaffold', json={}).status_code in (401, 403)


def test_list_api_returns_registry(client, auth_headers):
    resp = client.get('/api/v1/frameworks', headers=auth_headers)
    assert resp.status_code == 200
    assert [f['id'] for f in resp.get_json()['frameworks']] == ['laravel']


# -- orchestration --------------------------------------------------------------
def _fake_job(app_id):
    class _Stream:
        def log(self, *a, **k): pass
        def set_step(self, *a, **k): pass

    class _Job:
        id = 'j'
        requested_by = None
        def __init__(self): self.app_id = app_id
        def get_plan(self): return {'framework': 'laravel', 'add_database': True,
                                    'domain': None, 'public_host': 'panel.test'}
    return _Job(), _Stream()


def _stub_pipeline(monkeypatch, order, deploy_ok=True):
    from app.services.build_service import BuildService
    from app.services.deployment_service import DeploymentService
    monkeypatch.setattr(Svc, 'scaffold_project', classmethod(lambda cls, *a: order.append('scaffold')))
    monkeypatch.setattr(Svc, 'write_project_files', classmethod(
        lambda cls, *a: order.append('files') or 'base64:k'))
    monkeypatch.setattr(Svc, 'provision_database', classmethod(lambda cls, *a: order.append('db')))
    monkeypatch.setattr(Svc, 'wire_env', classmethod(lambda cls, *a: order.append('env')))
    monkeypatch.setattr(Svc, 'run_post_deploy', classmethod(lambda cls, *a: order.append('migrate')))
    monkeypatch.setattr(BuildService, 'configure_build', classmethod(
        lambda cls, **kw: order.append('build-config') or {'success': True}))
    monkeypatch.setattr(DeploymentService, 'deploy', classmethod(
        lambda cls, *a, **kw: order.append('deploy') or {'success': deploy_ok, 'error': 'build broke'}))


def test_run_orders_db_before_deploy_and_migrate_last(web_app, monkeypatch):
    order = []
    _stub_pipeline(monkeypatch, order)
    job, stream = _fake_job(web_app.id)
    monkeypatch.setattr('app.services.run_log_service.stream_for', lambda j: stream)

    result = Svc.run(job)

    assert order == ['scaffold', 'files', 'db', 'env', 'build-config', 'deploy', 'migrate']
    assert result['app_url'] == 'http://panel.test:8123'


def test_run_failed_deploy_skips_migrate_and_raises(web_app, monkeypatch):
    order = []
    _stub_pipeline(monkeypatch, order, deploy_ok=False)
    job, stream = _fake_job(web_app.id)
    monkeypatch.setattr('app.services.run_log_service.stream_for', lambda j: stream)

    with pytest.raises(RuntimeError, match='build broke'):
        Svc.run(job)
    assert 'migrate' not in order
