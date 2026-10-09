"""A deleted application must stop being an application.

Making Application soft-deletable silently changed the meaning of every
existing `Application.query`: before, it could only return live rows. Domain
went through this and TEN read paths were wrong, four with effects outside the
panel. Application has 13x the call sites and drives more: container
lifecycles, nginx, backups, registry pulls, the OS crontab.

These pin the behaviours where a leaked tombstone is a real, externally-visible
bug rather than a cosmetic one, plus the promise that makes the tombstone worth
keeping at all: that a restore gives you a working app back.
"""
import os

import pytest

from app import db
from app.models import Application, Domain
from app.services import application_restore, recycle_bin_service
from app.services.cron_service import CronService


@pytest.fixture
def live_app(app):
    with app.app_context():
        row = Application(name='shop', app_type='docker', port=8001, user_id=1,
                          root_path='/srv/apps/shop', source='upload',
                          private_slug='shop', private_url_enabled=True)
        db.session.add(row)
        db.session.commit()
        yield row


@pytest.fixture
def dead_app(app, live_app):
    with app.app_context():
        row = Application.query.get(live_app.id)
        row.soft_delete(user_id=1)
        db.session.commit()
        yield row


# ---------------------------------------------------------------- the basics

def test_soft_delete_keeps_the_row_but_query_active_hides_it(app, dead_app):
    with app.app_context():
        assert Application.query.get(dead_app.id) is not None
        assert Application.query_active().filter_by(id=dead_app.id).first() is None


def test_a_tombstone_is_offered_by_the_recycle_bin(app, dead_app):
    with app.app_context():
        kinds = [i['kind'] for i in recycle_bin_service.list_deleted()]
        assert 'application' in kinds


def test_deleted_ids_is_what_the_sibling_sweeps_read(app, dead_app, live_app):
    """ContainerSleepPolicy/BackupPolicy/DeploymentJob enumerate their OWN table
    and resolve application_id afterwards, so they never appear in a search for
    Application.query. This set is how those loops skip a deleted app."""
    with app.app_context():
        dead = Application.deleted_ids()
        assert dead_app.id in dead


# ------------------------------------------------- the promise of a tombstone

def test_a_deleted_app_frees_its_private_slug(app, dead_app):
    """The partial unique index is what lets the slug be reused; without it the
    delete would burn `/p/<slug>` forever and 'you can get it back' would be a
    lie about the URL."""
    with app.app_context():
        twin = Application(name='shop2', app_type='docker', port=8002, user_id=1,
                           private_slug='shop')
        db.session.add(twin)
        db.session.commit()          # must not raise
        assert twin.id != dead_app.id


def test_restore_is_refused_when_the_slug_was_taken_again(app, dead_app):
    """Reachable precisely BECAUSE the delete frees the slug — so it has to be
    a readable refusal, not an IntegrityError at commit."""
    with app.app_context():
        db.session.add(Application(name='shop2', app_type='docker', port=8002,
                                   user_id=1, private_slug='shop'))
        db.session.commit()

        item, err = recycle_bin_service.restore('application', dead_app.id)
        assert item is None
        assert 'private URL' in err
        # A refused restore must not half-apply.
        assert Application.query.get(dead_app.id).deleted_at is not None


def test_restore_is_refused_when_the_name_was_reused(app, dead_app, monkeypatch):
    """Two live apps with one name means one vhost filename for two apps, and
    whichever writes last wins."""
    monkeypatch.setattr(os.path, 'exists', lambda _p: True)
    with app.app_context():
        db.session.add(Application(name='shop', app_type='docker', port=8002, user_id=1))
        db.session.commit()

        item, err = recycle_bin_service.restore('application', dead_app.id)
        assert item is None
        assert 'created again' in err


def test_restore_is_refused_when_the_files_are_gone(app, dead_app):
    """Restoring the record without its files gives an app with nothing to
    serve — say so instead of handing back a broken row."""
    with app.app_context():
        item, err = recycle_bin_service.restore('application', dead_app.id)
        assert item is None
        assert 'files are gone' in err


# ------------------------------------------------------- delete vs purge line

def test_soft_delete_never_removes_volumes(app, live_app, monkeypatch):
    """THE line that makes the tombstone honest. compose_down(volumes=True) on
    the delete path would destroy the data the Restore button is promising."""
    calls = []
    from app.services import docker_service
    monkeypatch.setattr(docker_service.DockerService, 'compose_down',
                        classmethod(lambda cls, path, **kw: calls.append(kw) or {'success': True}))
    monkeypatch.setattr(application_restore.CronService, 'suspend_for_application',
                        classmethod(lambda cls, _id: 0))

    with app.app_context():
        row = Application.query.get(live_app.id)
        application_restore.suspend_application(row, user_id=1)

    assert calls, 'compose_down should still run — the app must stop serving'
    assert all(kw.get('volumes') is False for kw in calls), \
        'a soft delete must keep the volumes; they go at purge'


def test_purge_is_what_removes_the_volumes(app, dead_app, monkeypatch):
    calls = []
    from app.services import docker_service
    monkeypatch.setattr(docker_service.DockerService, 'compose_down',
                        classmethod(lambda cls, path, **kw: calls.append(kw) or {'success': True}))
    monkeypatch.setattr(application_restore.CronService, 'clear_application',
                        classmethod(lambda cls, _id: 0))

    with app.app_context():
        ok, warning = recycle_bin_service.purge('application', dead_app.id)
        assert ok
        # Assert NO warning, not just success. _run_purge_hook swallows anything
        # the hook raises so a failed cleanup cannot block the purge -- which
        # means a plain `assert ok` passes even when the cleanup did nothing at
        # all. A bad import inside the hook hid exactly that during development:
        # volumes never reclaimed, source never removed, purge still "fine".
        assert warning is None, warning
        assert Application.query.get(dead_app.id) is None

    assert calls and calls[0].get('volumes') is True


def test_purge_takes_the_one_to_one_policy_rows_with_it(app, dead_app, monkeypatch):
    """Field report: purging an app that had a one-to-one policy row died with
    `IntegrityError: NOT NULL constraint failed: <policy table>
    .application_id` (auto-scale policies then; that feature is gone). Without a delete cascade SQLAlchemy's default on parent
    delete is to NULL the child FK — and these one-to-one rows declare the FK
    NOT NULL, so the purge itself crashed. The policy rows must ride along."""
    from app.services import docker_service
    monkeypatch.setattr(docker_service.DockerService, 'compose_down',
                        classmethod(lambda cls, path, **kw: {'success': True}))
    monkeypatch.setattr(application_restore.CronService, 'clear_application',
                        classmethod(lambda cls, _id: 0))

    from app.models.container_sleep_policy import ContainerSleepPolicy
    from app.models.deployment import Deployment

    with app.app_context():
        db.session.add(ContainerSleepPolicy(application_id=dead_app.id))
        db.session.add(Deployment(app_id=dead_app.id, version=1))
        db.session.commit()

        ok, warning = recycle_bin_service.purge('application', dead_app.id)
        assert ok
        assert warning is None, warning
        assert Application.query.get(dead_app.id) is None
        assert ContainerSleepPolicy.query.filter_by(
            application_id=dead_app.id).first() is None
        assert Deployment.query.filter_by(app_id=dead_app.id).first() is None


def test_every_not_null_child_relationship_cascades_deletes(app):
    """The invariant behind the purge crash, pinned for EVERY model: a
    one-to-many whose child FK is NOT NULL must carry a delete cascade, because
    SQLAlchemy's default on parent delete — dynamic relationships included — is
    to NULL the child FK, which the NOT NULL constraint turns into an
    IntegrityError the moment anything hard-deletes the parent (Recycle Bin
    purge, retention pruning, admin deletes).

    The cascade is applied by _delete_cascade_policy's mapper hook, so this is
    a test that THE DOOR WORKS, not a checklist for model authors. Exceptions
    live (with their justification) in DELIBERATELY_UNCASCADED there."""
    from sqlalchemy.orm import configure_mappers

    from app.models._delete_cascade_policy import DELIBERATELY_UNCASCADED

    with app.app_context():
        configure_mappers()
        offenders = set()
        for mapper in db.Model.registry.mappers:
            for rel in mapper.relationships:
                if rel.direction.name != 'ONETOMANY' or rel.viewonly:
                    continue
                fk_cols = [c for c in rel.remote_side if c.foreign_keys]
                if not fk_cols or all(c.nullable for c in fk_cols):
                    continue
                if 'delete' not in rel.cascade:
                    offenders.add(f'{mapper.class_.__name__}.{rel.key}')
        unexpected = offenders - set(DELIBERATELY_UNCASCADED)
        assert not unexpected, (
            'NOT NULL child relationships the cascade policy did not reach '
            f'(a parent hard-delete would IntegrityError): {sorted(unexpected)}')
        # The registry may only shrink: an entry that stops matching is stale.
        stale = set(DELIBERATELY_UNCASCADED) - offenders
        assert not stale, f'stale DELIBERATELY_UNCASCADED entries: {sorted(stale)}'


# NOT NULL FK columns with NO parent-side one-to-many relationship: the
# cascade policy door cannot see them, so when the parent is hard-deleted these
# rows are left DANGLING — SQLite ships with FK enforcement off, and a purged
# parent id can be reused by a future row (orphaned env vars attaching to a new
# app is the nightmare case). Known debt, frozen so it can only SHRINK: a new
# model declares the parent-side relationship instead (the door then handles
# its delete), or consciously adds itself here in the commit that explains why.
KNOWN_DANGLING_ON_DELETE = set()  # all 26 audited FKs now declare the
# parent-side relationship (the door cascades them, or the parent's delete
# path guards) — keep this EMPTY.


def test_dangling_on_delete_fk_set_may_only_shrink(app):
    """Companion ratchet to the cascade sweep: FKs the door CANNOT protect
    because no parent-side relationship exists. Frozen at the audited set —
    fixing one (adding the relationship, or explicit purge-time cleanup plus
    removal here) shrinks it; new unprotected FKs fail the build."""
    from sqlalchemy.orm import configure_mappers

    with app.app_context():
        configure_mappers()
        covered = set()
        for mapper in db.Model.registry.mappers:
            for rel in mapper.relationships:
                if rel.direction.name != 'ONETOMANY' or rel.viewonly:
                    continue
                covered.update(c for c in rel.remote_side if c.foreign_keys)
        current = set()
        seen = set()
        for mapper in db.Model.registry.mappers:
            table = mapper.local_table
            if table is None or table.name in seen:
                continue
            seen.add(table.name)
            for c in table.columns:
                if c.foreign_keys and not c.nullable and c not in covered:
                    target = list(c.foreign_keys)[0].column.table.name
                    current.add(f'{table.name}.{c.key} -> {target}')
        new = current - KNOWN_DANGLING_ON_DELETE
        assert not new, (
            'new NOT NULL FKs with no parent-side relationship (rows would '
            'dangle when the parent is hard-deleted) — declare the '
            f'relationship instead: {sorted(new)}')
        fixed = KNOWN_DANGLING_ON_DELETE - current
        assert not fixed, (
            f'these entries are fixed — remove them from the set: {sorted(fixed)}')


def test_every_fk_column_is_indexed(app):
    """FK columns are born indexed — every join, per-parent listing, and the
    cascade deletes applied by _delete_cascade_policy scan the whole table
    without one. Declare index=True on the column (migration 096 covers
    existing installs). PK and single-column-unique FKs are already served."""
    with app.app_context():
        offenders = []
        seen = set()
        for mapper in db.Model.registry.mappers:
            table = mapper.local_table
            if table is None or table.name in seen:
                continue
            seen.add(table.name)
            leading = {list(ix.columns)[0].key
                       for ix in table.indexes if list(ix.columns)}
            for c in table.columns:
                if not c.foreign_keys or c.primary_key or c.unique:
                    continue
                if c.key not in leading:
                    offenders.append(f'{table.name}.{c.key}')
        assert not offenders, (
            f'FK columns without an index — add index=True: {sorted(offenders)}')


def test_deleting_a_workspace_with_projects_is_refused(app):
    """The Workspace.projects entry in DELIBERATELY_UNCASCADED is only honest
    while delete_workspace refuses instead of 500ing."""
    import pytest as _pytest

    from app.models import Project
    from app.models.workspace import Workspace
    from app.services.workspace_service import WorkspaceService

    with app.app_context():
        ws = Workspace(name='doomed-ws', slug='doomed-ws')
        db.session.add(ws)
        db.session.commit()
        db.session.add(Project(name='keeper', slug='keeper', workspace_id=ws.id))
        db.session.commit()
        with _pytest.raises(ValueError, match='still contains'):
            WorkspaceService.delete_workspace(ws.id)
        assert Workspace.query.get(ws.id) is not None


def test_deleting_a_user_who_owns_applications_is_refused(app, client, auth_headers, dead_app):
    """The User.applications entry in DELIBERATELY_UNCASCADED is only honest
    while delete_user refuses instead of 500ing — even for a tombstoned app,
    which still holds the NOT NULL FK."""
    from werkzeug.security import generate_password_hash
    from app.models import User

    with app.app_context():
        owner = User(email='app-owner@test.local', username='app-owner',
                     password_hash=generate_password_hash('x'),
                     role=User.ROLE_DEVELOPER, is_active=True)
        db.session.add(owner)
        db.session.commit()
        Application.query.get(dead_app.id).user_id = owner.id
        db.session.commit()
        owner_id = owner.id

    res = client.delete(f'/api/v1/admin/users/{owner_id}', headers=auth_headers)
    assert res.status_code == 409, res.get_json()
    assert 'service' in res.get_json()['error']


def test_purge_honours_an_explicit_remove_data_false(app, dead_app, monkeypatch):
    """Database engines default to preserving their volumes — losing the data is
    the only irreversible part of that uninstall."""
    calls = []
    from app.services import docker_service
    monkeypatch.setattr(docker_service.DockerService, 'compose_down',
                        classmethod(lambda cls, path, **kw: calls.append(kw) or {'success': True}))
    monkeypatch.setattr(application_restore.CronService, 'clear_application',
                        classmethod(lambda cls, _id: 0))

    with app.app_context():
        row = Application.query.get(dead_app.id)
        row._purge_remove_data = False
        application_restore.on_purge_application(row)

    assert calls and calls[0].get('volumes') is False


# ------------------------------------------------------------- purge cleanup

def _stub_purge_side_effects(monkeypatch):
    """compose_down and cron detach are not what these tests are about."""
    from app.services import docker_service
    monkeypatch.setattr(docker_service.DockerService, 'compose_down',
                        classmethod(lambda cls, path, **kw: {'success': True}))
    monkeypatch.setattr(application_restore.CronService, 'clear_application',
                        classmethod(lambda cls, _id: 0))


def test_purge_removes_a_managed_clone_regardless_of_source(app, monkeypatch, tmp_path):
    """A purged git app must take its clone with it. Leaving the directory
    blocks the name on the next create ("App directory already exists") while
    the Recycle Bin shows nothing to explain it — the field failure this
    pins."""
    from app import paths
    _stub_purge_side_effects(monkeypatch)
    monkeypatch.setattr(paths, 'APPS_DIR', str(tmp_path))
    clone = tmp_path / 'repo-app'
    clone.mkdir()
    (clone / 'docker-compose.yml').write_text('services: {}')

    with app.app_context():
        row = Application(name='repo-app', app_type='docker', user_id=1,
                          root_path=str(clone), source='github')
        application_restore.on_purge_application(row)

    assert not clone.exists()


def test_purge_never_removes_a_manual_apps_directory(app, monkeypatch, tmp_path):
    """A manual app's root_path is a directory the operator already had —
    removing it would destroy data ServerKit never created, even when it
    happens to sit under APPS_DIR."""
    from app import paths
    _stub_purge_side_effects(monkeypatch)
    monkeypatch.setattr(paths, 'APPS_DIR', str(tmp_path))
    existing = tmp_path / 'my-site'
    existing.mkdir()
    (existing / 'index.php').write_text('<?php')

    with app.app_context():
        row = Application(name='my-site', app_type='php', user_id=1,
                          root_path=str(existing), source='manual')
        application_restore.on_purge_application(row)

    assert (existing / 'index.php').is_file()


def test_purge_leaves_directories_outside_apps_dir_alone(app, monkeypatch, tmp_path):
    """Only ServerKit-managed paths are reclaimed; anything else is the
    operator's."""
    from app import paths
    _stub_purge_side_effects(monkeypatch)
    monkeypatch.setattr(paths, 'APPS_DIR', str(tmp_path / 'managed'))
    elsewhere = tmp_path / 'elsewhere'
    elsewhere.mkdir()
    (elsewhere / 'app.py').write_text('# not ours')

    with app.app_context():
        row = Application(name='elsewhere', app_type='flask', user_id=1,
                          root_path=str(elsewhere), source='github')
        application_restore.on_purge_application(row)

    assert (elsewhere / 'app.py').is_file()


def test_a_failing_purge_hook_still_purges(app, dead_app):
    """The caller has said twice that they want the row gone; a directory that
    will not delete is not a reason to keep the record."""
    # Re-register with a throwing hook, and put the real registration back in a
    # finally. _REGISTRY is module-level global state that outlives monkeypatch,
    # so leaving a broken hook in it silently breaks every LATER test in the
    # session -- which is exactly what happened: a purge test two files away
    # started failing only when this one ran first.
    def _boom(_row):
        raise RuntimeError('disk busy')

    recycle_bin_service.register(
        'application', Application, noun='application',
        label=lambda a: a.name, on_purge=_boom,
    )
    try:
        with app.app_context():
            ok, warning = recycle_bin_service.purge('application', dead_app.id)
            assert ok
            assert 'cleanup failed' in warning
            assert Application.query.get(dead_app.id) is None
    finally:
        recycle_bin_service.register_builtin_types()


# -------------------------------------------------------------------- cron

def test_soft_delete_suspends_only_the_jobs_that_were_enabled(app, monkeypatch):
    """The OS crontab does not know the app is in the bin, so the jobs have to
    be actively disabled — and ONLY the ones that were on, or a restore would
    re-enable jobs the user had deliberately turned off."""
    store = {'jobs': {
        'a': {'application_id': 7, 'enabled': True, 'command': 'x', 'schedule': '* * * * *'},
        'b': {'application_id': 7, 'enabled': False, 'command': 'y', 'schedule': '* * * * *'},
        'c': {'application_id': 9, 'enabled': True, 'command': 'z', 'schedule': '* * * * *'},
    }}
    monkeypatch.setattr(CronService, '_load_jobs_metadata', classmethod(lambda cls: store))
    monkeypatch.setattr(CronService, '_save_jobs_metadata', classmethod(lambda cls, d: None))
    monkeypatch.setattr(CronService, 'is_linux', classmethod(lambda cls: False))

    assert CronService.suspend_for_application(7) == 1
    assert store['jobs']['a']['suspended_by_app'] is True
    assert store['jobs']['b'].get('suspended_by_app') is not True   # was already off
    assert store['jobs']['c'].get('suspended_by_app') is not True   # different app


def test_restore_resumes_exactly_what_the_delete_suspended(app, monkeypatch):
    store = {'jobs': {
        'a': {'application_id': 7, 'enabled': False, 'suspended_by_app': True,
              'command': 'x', 'schedule': '* * * * *'},
        'b': {'application_id': 7, 'enabled': False, 'command': 'y', 'schedule': '* * * * *'},
    }}
    monkeypatch.setattr(CronService, '_load_jobs_metadata', classmethod(lambda cls: store))
    monkeypatch.setattr(CronService, '_save_jobs_metadata', classmethod(lambda cls, d: None))
    monkeypatch.setattr(CronService, 'is_linux', classmethod(lambda cls: False))

    assert CronService.resume_for_application(7) == 1
    assert store['jobs']['a']['enabled'] is True
    assert store['jobs']['a']['suspended_by_app'] is False
    assert store['jobs']['b']['enabled'] is False   # never ours to re-enable


def test_clear_application_is_purge_only_and_lossy(app, monkeypatch):
    """It nulls the link without recording it, which is why the soft-delete path
    must NOT use it — nothing could put the association back."""
    store = {'jobs': {'a': {'application_id': 7, 'enabled': True}}}
    monkeypatch.setattr(CronService, '_load_jobs_metadata', classmethod(lambda cls: store))
    monkeypatch.setattr(CronService, '_save_jobs_metadata', classmethod(lambda cls, d: None))

    assert CronService.clear_application(7) == 1
    assert store['jobs']['a']['application_id'] is None


# ----------------------------------------------------------- domains cascade

def test_a_tombstoned_app_keeps_its_domains(app, live_app):
    """delete-orphan on `domains` hard-deletes a child that falls out of the
    collection. A soft delete is an UPDATE, so nothing should cascade — the
    domains must survive for the restore to have anything to publish."""
    with app.app_context():
        db.session.add(Domain(name='shop.example.com', application_id=live_app.id))
        db.session.commit()

        row = Application.query.get(live_app.id)
        row.soft_delete()
        db.session.commit()

        assert Domain.query.filter_by(application_id=live_app.id).count() == 1


# ------------------------------------------------ naming the name reservation

def test_a_tombstone_clash_names_the_recycle_bin(app, client, auth_headers, dead_app):
    """The reservation is deliberate, but "already exists" points at an app
    that is in no list — the message must say where the name is being held
    and how to release it (GH report: delete an app, can't reuse the name)."""
    res = client.post('/api/v1/templates/validate-install', headers=auth_headers,
                      json={'template_id': 'actualbudget', 'app_name': 'shop'})

    assert res.status_code == 400
    errors = ' '.join(res.get_json()['errors'])
    assert 'Recycle Bin' in errors
    assert 'purge' in errors


def test_a_live_clash_keeps_the_plain_already_exists(app, client, auth_headers, live_app):
    res = client.post('/api/v1/templates/validate-install', headers=auth_headers,
                      json={'template_id': 'actualbudget', 'app_name': 'shop'})

    assert res.status_code == 400
    errors = ' '.join(res.get_json()['errors'])
    assert 'already exists' in errors
    assert 'Recycle Bin' not in errors
