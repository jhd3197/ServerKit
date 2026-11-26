"""Recycle-bin hooks for Application: what a delete stops, and what a purge destroys.

The split this module exists to enforce:

    SOFT DELETE   stop serving. Containers down (volumes KEPT), vhost removed,
                  firewall ports closed, cron suspended. Every one of those is
                  reversible.
    RESTORE       re-publish. Vhost rewritten from the app's live domains,
                  firewall reopened, cron resumed. Containers are left STOPPED.
    PURGE         the irreversible half: data volumes removed, uploaded source
                  tree deleted, cron association dropped, row destroyed.

Why the split matters: `delete_app` used to run `compose_down(volumes=True)` and
`shutil.rmtree()` on the way out. Doing that AND keeping a tombstone would offer
a Restore button for a row whose data the delete had already destroyed — the one
promise the recycle bin cannot break. So the destructive half moved to purge and
the tombstone now means something.

Containers are deliberately NOT restarted on restore, for the reason
`domain_restore` does not re-issue certificates: "put it back" should not
silently start processes, open ports to the internet, or begin consuming CPU on
a machine whose owner has not looked at this app in three weeks. The row is
back, it is published, and Start is one click away.
"""
import logging
import os
import shutil

from app import db
from app.models import Application
from app.models.application import is_host_managed
from app.services.cron_service import CronService

logger = logging.getLogger(__name__)


def applications_owned_by(user_id):
    """Count of Application rows a user owns — live AND tombstoned.

    Applications never ride a user delete: their user_id is NOT NULL, but the
    rows own containers and volumes that must go through app delete + Recycle
    Bin purge — never a silent cascade. Unfiltered on purpose: a tombstoned
    app still holds the FK, so it blocks too.
    """
    return Application.query.filter_by(user_id=user_id).count()


def _live_name_clash(app):
    """Another LIVE app already using this one's name, if any."""
    return (Application.query_active()
            .filter(Application.name == app.name, Application.id != app.id)
            .first())


def pre_restore_application(app):
    """Refuse a restore that cannot work, with a sentence the user can act on.

    Mirrors `pre_restore_domain`: a partial unique index makes "restorable" a
    moving target, so the conflict has to be reported rather than raised as an
    IntegrityError at commit.
    """
    if app.private_slug:
        clash = (Application.query_active()
                 .filter(Application.private_slug == app.private_slug,
                         Application.id != app.id)
                 .first())
        if clash:
            return (f'the private URL “/p/{app.private_slug}” has been taken by '
                    f'“{clash.name}” since this was deleted. Free it there first, '
                    f'or leave this in the bin.')

    # `name` has no unique constraint, so this is NOT an integrity failure — but
    # a second live app with the same name means one nginx vhost filename for
    # two apps, and whichever writes last wins. Refusing is kinder than
    # restoring something that will silently fight over its own config.
    clash = _live_name_clash(app)
    if clash:
        return (f'“{app.name}” has been created again since this was deleted '
                f'(app #{clash.id}). Rename one of them first, or leave this in '
                f'the bin.')

    if app.root_path and not os.path.exists(app.root_path):
        return (f'its files are gone from {app.root_path}, so restoring the '
                f'record would give you an app with nothing to serve')

    return None


def on_restore_application(app):
    """Re-publish a restored app. Returns a notice string, or None.

    Deliberately does NOT start containers — see the module docstring.
    """
    notices = []

    # Re-open any public ports the app declared. Best-effort: a firewall that
    # refuses is worth telling the user about, not worth failing the restore.
    try:
        from app.services.app_port_service import AppPortService
        declared = AppPortService.get_ports(app)
        if declared:
            AppPortService.open_firewall(declared)
    except Exception as exc:                            # noqa: BLE001
        logger.warning('Restore %s: firewall reopen failed: %s', app.name, exc)
        notices.append('its firewall ports could not be reopened')

    # Rewrite the vhost from the app's LIVE domains, through the same path the
    # domain restore uses — write_app_vhost re-enables the site and re-attaches
    # a covering wildcard cert, which a bare create_site would not.
    try:
        from app.services.site_domain_service import SiteDomainService
        result = SiteDomainService.write_app_vhost(app) or {}
        if result.get('warning'):
            notices.append(result['warning'])
    except Exception as exc:                            # noqa: BLE001
        logger.warning('Restore %s: vhost rewrite failed: %s', app.name, exc)
        notices.append(f'its vhost could not be rewritten ({exc})')

    # Re-enable exactly the cron jobs the delete suspended.
    try:
        resumed = CronService.resume_for_application(app.id)
        if resumed:
            notices.append(f'{resumed} cron job{"s" if resumed != 1 else ""} resumed')
    except Exception as exc:                            # noqa: BLE001
        logger.warning('Restore %s: cron resume failed: %s', app.name, exc)
        notices.append('its cron jobs could not be resumed')

    notices.append('containers were left stopped — start it when you are ready')
    return f'“{app.name}” is back: ' + '; '.join(notices) + '.'


def on_purge_application(app):
    """The irreversible half of deleting an app.

    Runs immediately before the row is destroyed, from BOTH purge paths (an
    explicit purge and the retention sweep). Anything here is unrecoverable by
    definition, which is exactly why it is not on the delete path.
    """
    from app import paths
    from app.services.docker_service import DockerService

    # A purge normally reclaims the volumes -- that is most of what it is for.
    # `_purge_remove_data` is the one exception: DELETE ?purge=true skips the
    # bin, and the caller may have said `?remove_data=false` (or be uninstalling
    # a database ENGINE, which defaults to preserving its volumes because losing
    # the data is the only irreversible part of that uninstall). The flag is
    # stamped on the row by that route; the retention sweep sets nothing and so
    # gets the default.
    remove_data = getattr(app, '_purge_remove_data', True)
    if app.app_type == 'docker' and app.root_path:
        try:
            DockerService.compose_down(app.root_path, volumes=remove_data,
                                       remove_orphans=True)
        except Exception as exc:                        # noqa: BLE001
            logger.warning('Purge %s: compose down failed: %s', app.name, exc)

    # Reclaim the app's directory whenever ServerKit created it — anything
    # whose root_path lives under APPS_DIR: a git clone, an uploaded source
    # tree, a template render. A purge that leaves the directory behind blocks
    # the name forever ("App directory already exists" on the next create)
    # while the Recycle Bin shows nothing to explain it. The one exception is
    # a `manual` app: its root_path points at a directory the operator already
    # had, and removing that would destroy data ServerKit never created — the
    # same guard delete_app has always carried.
    try:
        base = os.path.abspath(paths.APPS_DIR)
        root = os.path.abspath(app.root_path) if app.root_path else None
        if (app.source != 'manual' and root
                and root.startswith(base + os.sep)
                and os.path.exists(root)):
            shutil.rmtree(root)
    except Exception as exc:                            # noqa: BLE001
        logger.warning('Purge %s: root path removal failed: %s', app.name, exc)

    # Now that the app is going for good, its cron jobs fall back to the System
    # bucket rather than pointing at an id that no longer resolves.
    try:
        CronService.clear_application(app.id)
    except Exception as exc:                            # noqa: BLE001
        logger.warning('Purge %s: cron detach failed: %s', app.name, exc)


def suspend_application(app, user_id=None):
    """Tombstone an app and stop it serving. The reversible half of a delete.

    Returns a dict of what happened, in the shape `delete_app` already reports.
    """
    from app.services.docker_service import DockerService
    from app.services.nginx_service import NginxService

    results = {'docker': None, 'nginx': None, 'cron': None, 'firewall': None}

    try:
        from app.services.app_port_service import AppPortService
        declared = AppPortService.get_ports(app)
        if declared:
            results['firewall'] = AppPortService.close_firewall(declared)
    except Exception as exc:                            # noqa: BLE001
        results['firewall'] = {'error': str(exc)}

    if app.app_type == 'docker' and app.root_path:
        try:
            # volumes=False, ALWAYS. The volumes are what makes this undoable;
            # they go at purge. This is the single most important line here.
            results['docker'] = DockerService.compose_down(
                app.root_path, volumes=False, remove_orphans=True)
        except Exception as exc:                        # noqa: BLE001
            results['docker'] = {'error': str(exc)}

    if is_host_managed(app):
        # Deleting an adopted site forgets it; it does not take it offline.
        # The vhost was never ours, and a site named like its vhost file
        # would otherwise lose its live config here.
        results['nginx'] = {'success': True, 'skipped': 'host-managed'}
    else:
        try:
            NginxService.disable_site(app.name)
            NginxService.delete_site(app.name)
            results['nginx'] = {'success': True}
        except Exception as exc:                        # noqa: BLE001
            results['nginx'] = {'error': str(exc)}

    try:
        results['cron'] = {'suspended': CronService.suspend_for_application(app.id)}
    except Exception as exc:                            # noqa: BLE001
        results['cron'] = {'error': str(exc)}

    app.soft_delete(user_id)
    app.status = 'stopped'
    db.session.commit()
    from app.services.previews.lifecycle import cleanup_application
    results['previews'] = cleanup_application(app.id)
    return results
