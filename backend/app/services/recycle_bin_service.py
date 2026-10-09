"""The Recycle Bin: one place that lists, restores and purges soft-deleted
records across every model that opted into SoftDeleteMixin.

A model registers itself with a label function and (optionally) a restore hook,
so the bin can present "domain · shop.example.com, deleted 2 days ago by admin"
without knowing anything about domains. Adding a new type is one register()
call — the API, the listing and the restore flow do not change.

    register('domain', Domain, label=lambda d: d.name,
             description=lambda d: f'app #{d.application_id}',
             on_restore=nginx_service.rewrite_site)

RESTORE IS NOT ALWAYS FREE. Soft-deleting a record does not undo the side
effects that went with it — a deleted domain still had its nginx vhost and its
certificate torn down. `on_restore` is where a type re-does that work; a type
without one restores the ROW only, which is the honest default.
"""
from datetime import datetime, timedelta

from app import db

# name -> {model, label, description, on_restore, verb}
_REGISTRY = {}

# How long a tombstone survives before `purge_expired` may reap it. Long enough
# that "I deleted the wrong thing last week" is still recoverable.
DEFAULT_RETENTION_DAYS = 30


def register(kind, model, *, label, description=None, on_restore=None,
             pre_restore=None, on_purge=None, noun=None):
    """Make a soft-deletable model visible to the Recycle Bin.

    `pre_restore(row)` runs BEFORE the tombstone is cleared and returns an error
    string to refuse the restore. It exists because a partial unique index makes
    "restorable" a moving target: deleting a domain frees its name, so something
    live may hold it by the time you press Restore. Clearing the tombstone then
    violates the index and raises IntegrityError at commit — a 500 for what is
    really a normal, explainable conflict.

    `on_purge(row)` runs just BEFORE the row is destroyed for good, and is where
    a type puts the work that cannot be undone. Deleting an application stops
    its containers and unpublishes it — reversible — but removing its data
    volumes and its uploaded source is not, so that half waits here. Without
    this hook the bin would be offering to restore a row whose files the delete
    had already destroyed, which is a promise it cannot keep.

    An exception from `on_purge` must NOT block the purge: the caller asked for
    the row to go, and a failure to reclaim a directory is not a reason to keep
    a record they have said twice they do not want.
    """
    if not hasattr(model, 'deleted_at'):
        raise TypeError(f'{model.__name__} does not use SoftDeleteMixin')
    _REGISTRY[kind] = {
        'model': model,
        'label': label,
        'description': description,
        'on_restore': on_restore,
        'pre_restore': pre_restore,
        'on_purge': on_purge,
        'noun': noun or kind.replace('_', ' '),
    }


def registered_kinds():
    return sorted(_REGISTRY.keys())


def _entry(kind):
    entry = _REGISTRY.get(kind)
    if not entry:
        raise KeyError(kind)
    return entry


def _serialize(kind, entry, row):
    return {
        'kind': kind,
        'noun': entry['noun'],
        'id': row.id,
        'label': entry['label'](row),
        'description': entry['description'](row) if entry['description'] else None,
        'deleted_at': row.deleted_at.isoformat() if row.deleted_at else None,
        'deleted_by_id': row.deleted_by_id,
        'restorable': True,
    }


def list_deleted(kind=None, limit=200):
    """Everything currently in the bin, newest deletion first."""
    kinds = [kind] if kind else registered_kinds()
    items = []
    for k in kinds:
        entry = _REGISTRY.get(k)
        if not entry:
            continue
        rows = (entry['model'].query_deleted()
                .order_by(entry['model'].deleted_at.desc())
                .limit(limit).all())
        items.extend(_serialize(k, entry, r) for r in rows)
    items.sort(key=lambda i: i['deleted_at'] or '', reverse=True)
    return items[:limit]


def restore(kind, record_id):
    entry = _entry(kind)
    row = entry['model'].query.filter_by(id=record_id).first()
    if row is None:
        return None, 'not found'
    if row.deleted_at is None:
        return _serialize(kind, entry, row), None      # already active; idempotent
    if entry['pre_restore']:
        blocked = entry['pre_restore'](row)
        if blocked:
            return None, blocked
    row.restore()
    db.session.commit()
    item = _serialize(kind, entry, row)
    if entry['on_restore']:
        try:
            # A hook may RETURN a string: something the user should know about a
            # restore that otherwise worked (a domain coming back without its
            # certificate, say). That is a notice, not a failure — it rides on
            # the item so the caller can tell it apart from the error slot.
            notice = entry['on_restore'](row)
            if notice:
                item['notice'] = str(notice)
        except Exception as exc:                        # noqa: BLE001
            # The row IS back; the side effect is what failed. Say so rather
            # than rolling back a restore the user asked for.
            return item, f'restored, but re-applying config failed: {exc}'
    return item, None


def _run_purge_hook(entry, row):
    """The type's irreversible cleanup, best-effort.

    Never allowed to block the purge: the caller has now said twice that they
    want the row gone, and failing to reclaim a directory is not a reason to
    keep a record against their wishes. Returns a warning string, or None.
    """
    if not entry.get('on_purge'):
        return None
    try:
        entry['on_purge'](row)
        return None
    except Exception as exc:                            # noqa: BLE001
        return f'purged, but cleanup failed: {exc}'


# purge()'s error for a missing row. Callers compare against this constant
# (`err is PURGE_NOT_FOUND`), never against the wording, so rephrasing the
# message can't turn the route's 404 into a 400.
PURGE_NOT_FOUND = 'not found'


def purge(kind, record_id):
    """Delete for real. The only irreversible action in this module."""
    entry = _entry(kind)
    row = entry['model'].query.filter_by(id=record_id).first()
    if row is None:
        return False, PURGE_NOT_FOUND
    if row.deleted_at is None:
        return False, 'record is not in the recycle bin'
    warning = _run_purge_hook(entry, row)
    db.session.delete(row)
    db.session.commit()
    return True, warning


def purge_expired(retention_days=DEFAULT_RETENTION_DAYS):
    """Reap tombstones older than the retention window. Returns a per-kind count."""
    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    counts = {}
    for kind, entry in _REGISTRY.items():
        rows = entry['model'].query.filter(
            entry['model'].deleted_at.isnot(None),
            entry['model'].deleted_at < cutoff,
        ).all()
        for row in rows:
            # The retention sweep is the OTHER way a row reaches the end of its
            # life, so it owes the same cleanup an explicit purge does — without
            # it, a directory is reclaimed only when someone happens to click
            # Purge, and never for the 30-day expiry path.
            _run_purge_hook(entry, row)
            db.session.delete(row)
        if rows:
            counts[kind] = len(rows)
    if counts:
        db.session.commit()
    return counts


def register_builtin_types():
    """Wire the models that ship with the panel. Called from create_app."""
    from app.models.application import Application
    from app.models.domain import Domain
    from app.models.saved_view import SavedView
    from app.services.application_restore import (
        on_purge_application, on_restore_application, pre_restore_application,
    )
    from app.services.domain_restore import on_restore_domain, pre_restore_domain

    # Applications carry the only on_purge in the registry: a delete stops the
    # app, a PURGE destroys its volumes and uploaded source. See
    # application_restore for why that split is what makes the tombstone honest.
    register(
        'application', Application, noun='application',
        label=lambda a: a.name,
        description=lambda a: (f'{a.app_type} · {a.root_path}' if a.root_path else a.app_type),
        pre_restore=pre_restore_application,
        on_restore=on_restore_application,
        on_purge=on_purge_application,
    )

    register(
        'domain', Domain, noun='domain',
        label=lambda d: d.name,
        description=lambda d: (f'linked to app #{d.application_id}'
                               if d.application_id else None),
        pre_restore=pre_restore_domain,
        on_restore=on_restore_domain,
    )
    def _pre_restore_view(view):
        # Same partial-unique-index conflict as Domain: deleting a view frees
        # its name AND its slug, so either can be taken by the time you press
        # Restore. Clearing the tombstone would then violate
        # uq_saved_views_user_page_name_live / _slug_live and 500 at commit.
        clash = (SavedView.query_active()
                 .filter(SavedView.user_id == view.user_id,
                         SavedView.page == view.page,
                         SavedView.id != view.id)
                 .filter(db.or_(SavedView.name == view.name,
                                SavedView.slug == view.slug))
                 .first())
        if clash:
            return (f'you already have a “{clash.name}” view on this page '
                    f'-- rename it first, or leave this one in the bin')
        return None

    register(
        'saved_view', SavedView, noun='saved view',
        label=lambda v: v.name,
        description=lambda v: f'{v.page} view',
        pre_restore=_pre_restore_view,
    )

    from app.models.managed_database import ManagedDatabase

    def _on_purge_managed_database(managed):
        # Purge removes the managed BackupPolicy that kept running while the
        # row sat in the bin. It NEVER drops the database content — the only
        # destructive path for data is the explicit ?drop=true delete.
        from app.services.managed_database_service import ManagedDatabaseService
        ManagedDatabaseService._delete_managed_policy(managed)

    register(
        'managed_database', ManagedDatabase, noun='managed database',
        label=lambda m: m.name,
        description=lambda m: f'{m.engine} on {m.host}'
                              + (f':{m.port}' if m.port else ''),
        on_purge=_on_purge_managed_database,
    )
