"""GHSA-vrwv-j8w5-p94q: a viewer created an app, then set a backup hook the
panel runs as a shell command on its own host.

Each refusal has its control: the fix must not lock out the people who are
supposed to be able to do the thing.
"""
import pytest

from factories import headers_for, make_user


def _create(client, user, name):
    return client.post('/api/v1/apps', json={'name': name, 'app_type': 'static'},
                       headers=headers_for(user))


def test_viewer_cannot_create_a_service(client, app):
    from app import db
    from app.models.application import Application
    viewer = make_user(db, 'vrwv_viewer', 'viewer')
    assert _create(client, viewer, 'vrwv-viewer-app').status_code == 403
    assert Application.query.filter_by(name='vrwv-viewer-app').first() is None
    developer = make_user(db, 'vrwv_dev', 'developer')
    assert _create(client, developer, 'vrwv-dev-app').status_code == 201


def test_only_an_admin_can_set_a_backup_hook(client, app):
    from app import db
    from app.models.backup_policy import BackupPolicy
    developer = make_user(db, 'vrwv_owner', 'developer')
    admin = make_user(db, 'vrwv_admin', 'admin')
    app_id = _create(client, developer, 'vrwv-owned').get_json()['app']['id']
    url = f'/api/v1/apps/{app_id}/backup-policy'

    def policy():
        return BackupPolicy.query.filter_by(target_type='application', target_id=app_id).one()

    for field in ('pre_backup_hook', 'post_backup_hook'):
        resp = client.put(url, json={field: 'id > /tmp/pwned'}, headers=headers_for(developer))
        assert resp.status_code == 403, field
        assert getattr(policy(), field) in (None, '')

    # The owner still manages the rest of the policy...
    resp = client.put(url, json={'retention_count': 9}, headers=headers_for(developer))
    assert resp.status_code == 200 and policy().retention_count == 9

    # ...an admin sets the hook...
    resp = client.put(url, json={'pre_backup_hook': 'echo ok'}, headers=headers_for(admin))
    assert resp.status_code == 200 and policy().pre_backup_hook == 'echo ok'

    # ...and the owner can send the policy back unchanged (a round trip of what
    # GET returned) without that counting as setting a hook, but not alter it.
    resp = client.put(url, json={'pre_backup_hook': 'echo ok', 'retention_count': 4},
                      headers=headers_for(developer))
    assert resp.status_code == 200 and policy().retention_count == 4
    resp = client.put(url, json={'pre_backup_hook': 'echo changed'},
                      headers=headers_for(developer))
    assert resp.status_code == 403 and policy().pre_backup_hook == 'echo ok'
    resp = client.put(url, json={'pre_backup_hook': ''}, headers=headers_for(developer))
    assert resp.status_code == 403 and policy().pre_backup_hook == 'echo ok'


def test_hook_changes_are_denied_by_default_in_the_service(app):
    """A new caller that forwards request data gets the refusal, not a shell."""
    from app.exceptions import PermissionDeniedError
    from app.services.backup_policy_service import BackupPolicyService
    policy = BackupPolicyService.get_or_create_policy('application', 987654)
    with pytest.raises(PermissionDeniedError):
        BackupPolicyService.update_policy(policy, {'post_backup_hook': 'id'})
    assert policy.post_backup_hook in (None, '')
