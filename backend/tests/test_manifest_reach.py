"""Proving tests for Phase 5 backend — fleet targeting + previews (plan 17)."""

import pytest

import app.models.application_manifest  # noqa: F401
from app.services.manifest_spec_service import ManifestSpecService
from app.services.manifest_apply_service import ManifestApplyService


@pytest.fixture
def owner(app):
    from app import db
    from app.models import User
    user = User.query.filter_by(username='testadmin').first()
    if not user:
        user = User(username='testadmin', email='a@b.co', role='admin')
        db.session.add(user)
        db.session.commit()
    return user


@pytest.fixture
def project(app):
    from app import db
    from app.models import Project, Environment
    from app.services.workspace_service import WorkspaceService
    ws = WorkspaceService.ensure_default_workspace()
    proj = Project(workspace_id=ws.id, name='Reach', slug='reach')
    db.session.add(proj)
    db.session.commit()
    env = Environment(project_id=proj.id, name='Prod', slug='prod', is_default=True)
    db.session.add(env)
    db.session.commit()
    return proj


def _server(name='edge'):
    from app import db
    from app.models.server import Server
    s = Server(id=f'srv-{name}', name=name)
    db.session.add(s)
    db.session.commit()
    return s


def test_manifest_server_sets_app_server_id(project, owner):
    srv = _server('frankfurt')
    manifest = {'version': 1, 'server': 'frankfurt',
                'services': [{'name': 'api', 'type': 'web', 'port': 8000}]}
    n = ManifestSpecService.normalize(manifest)
    plan = ManifestApplyService.plan(project, n)
    create = next(s for s in plan['steps'] if s['type'] == 'create_app')
    assert create['payload']['server_id'] == srv.id

    result = ManifestApplyService.apply(project, n, user_id=owner.id)
    assert result['success'] is True
    from app.models import Application
    api = Application.query.filter_by(project_id=project.id, name='api').first()
    assert api.server_id == srv.id


def test_per_service_server_override(project, owner):
    _server('edge')
    home = _server('home')
    manifest = {'version': 1, 'server': 'edge',
                'services': [{'name': 'api', 'type': 'web', 'server': 'home'}]}
    n = ManifestSpecService.normalize(manifest)
    result = ManifestApplyService.apply(project, n, user_id=owner.id)
    from app.models import Application
    api = Application.query.filter_by(project_id=project.id, name='api').first()
    assert api.server_id == home.id


def test_unknown_server_is_plan_issue(project, owner):
    manifest = {'version': 1, 'server': 'ghost',
                'services': [{'name': 'api', 'type': 'web'}]}
    n = ManifestSpecService.normalize(manifest)
    plan = ManifestApplyService.plan(project, n)
    assert any(i['kind'] == 'unknown_server' and i['server'] == 'ghost'
               for i in plan['issues'])
