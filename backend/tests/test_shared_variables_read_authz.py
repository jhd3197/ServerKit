"""GHSA-893r-j92f-5q9x: the resolved-variables routes took a resource id and
scope ids from the query string and checked neither, so any account could
read another workspace's variable groups.

Each refusal has its control: members still resolve their own.
"""
import pytest

from factories import headers_for, make_application, make_user


@pytest.fixture
def variables(app):
    from app import db
    from app.services.shared_resource_service import SharedResourceService
    from app.services.workspace_service import WorkspaceService
    admin = make_user(db, 'v893_admin', 'admin')
    member = make_user(db, 'v893_member', 'developer')
    outsider = make_user(db, 'v893_outsider', 'developer')
    ws_a = WorkspaceService.create_workspace({'name': 'V893-A'}, admin.id)
    WorkspaceService.add_member(ws_a.id, member.id)
    ws_b = WorkspaceService.create_workspace({'name': 'V893-B'}, outsider.id)
    group = SharedResourceService.create_group('workspace', ws_a.id, 'tenant-a')
    SharedResourceService.set_variable(group.id, 'TENANT_A_PLAIN', 'visible-value-a')
    SharedResourceService.set_variable(group.id, 'TENANT_A_KEY', 'secret-a', is_secret=True)
    app_a = make_application(db, name='v893-a', user_id=member.id, workspace_id=ws_a.id)
    SharedResourceService.attach_group(group.id, 'application', app_a.id)
    app_b = make_application(db, name='v893-b', user_id=outsider.id, workspace_id=ws_b.id)
    return {'member': member.id, 'outsider': outsider.id, 'admin': admin.id,
            'ws_a': ws_a.id, 'ws_b': ws_b.id, 'app_a': app_a.id, 'app_b': app_b.id}


def _resolved(client, user, path, **query):
    qs = '&'.join(f'{key}={value}' for key, value in query.items())
    return client.get(f'/api/v1/shared/{path}?{qs}', headers=headers_for(user))


_NEEDLES = ('TENANT_A_PLAIN', 'TENANT_A_KEY', 'visible-value-a', 'secret-a', 'tenant-a')


def test_outsider_cannot_layer_in_a_foreign_workspace(client, variables):
    """The reported call: the caller's OWN app, another workspace's id."""
    resp = _resolved(client, variables['outsider'], 'resolved/hierarchical',
                     resource_type='application', resource_id=variables['app_b'],
                     workspace_id=variables['ws_a'])
    assert resp.status_code in (403, 404)
    assert not [n for n in _NEEDLES if n in resp.get_data(as_text=True)]


@pytest.mark.parametrize('path', ['resolved', 'resolved/hierarchical'])
def test_outsider_cannot_resolve_a_foreign_resource(client, variables, path):
    resp = _resolved(client, variables['outsider'], path,
                     resource_type='application', resource_id=variables['app_a'])
    assert resp.status_code in (403, 404)
    assert not [n for n in _NEEDLES if n in resp.get_data(as_text=True)]


@pytest.mark.parametrize('path', ['resolved', 'resolved/hierarchical'])
def test_unknown_resource_types_fail_closed(client, variables, path):
    resp = _resolved(client, variables['outsider'], path,
                     resource_type='nonsense', resource_id=1, workspace_id=variables['ws_b'])
    assert resp.status_code == 403


@pytest.mark.parametrize('who', ['member', 'admin'])
def test_members_still_resolve_their_own(client, variables, who):
    resp = _resolved(client, variables[who], 'resolved/hierarchical',
                     resource_type='application', resource_id=variables['app_a'],
                     workspace_id=variables['ws_a'])
    assert resp.status_code == 200
    keys = {row['key'] for row in resp.get_json()['variables']}
    assert {'TENANT_A_PLAIN', 'TENANT_A_KEY'} <= keys
    assert 'secret-a' not in resp.get_data(as_text=True)      # still masked
    flat = _resolved(client, variables[who], 'resolved',
                     resource_type='application', resource_id=variables['app_a'])
    assert flat.status_code == 200
    assert 'TENANT_A_PLAIN' in flat.get_data(as_text=True)


def test_outsider_still_resolves_inside_their_own_workspace(client, variables):
    resp = _resolved(client, variables['outsider'], 'resolved/hierarchical',
                     resource_type='application', resource_id=variables['app_b'],
                     workspace_id=variables['ws_b'])
    assert resp.status_code == 200
