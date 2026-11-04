"""Built-in periodic job handlers + their schedules.

These are the platform's own recurring tasks. They used to each run in a
dedicated daemon thread spawned from ``app/__init__.py`` (auto-sync,
snapshot-retention, workflow scheduler, health-check poller, WP safe-update,
hourly API background, pairing pruner, registrar expiry). They now run as
``ScheduledJob`` rows enqueued by the single ``JobScheduler`` and executed by the
single ``JobConsumer``.

The check/run functions below are relocated verbatim from ``app/__init__.py`` so
behavior — cadence handling, per-task de-dup, idempotency — is unchanged; only
the trigger moved from a bare thread to the unified job system.
"""
import logging
import os

from app.jobs.registry import register

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Relocated check/run functions (formerly in app/__init__.py)
# ---------------------------------------------------------------------------
def check_auto_sync_schedules():
    """Check all auto-sync enabled sites and run syncs that are due."""
    from app.models.wordpress_site import WordPressSite
    from datetime import datetime

    sites = WordPressSite.query.filter_by(auto_sync_enabled=True).all()
    if not sites:
        return

    try:
        from croniter import croniter
    except ImportError:
        logger.debug('croniter not installed, skipping auto-sync check')
        return

    now = datetime.utcnow()

    for site in sites:
        if not site.auto_sync_schedule:
            continue
        try:
            if not croniter.is_valid(site.auto_sync_schedule):
                continue
            cron = croniter(site.auto_sync_schedule, now)
            prev_run = cron.get_prev(datetime)
            # Was a run due in the last 90 seconds (accounts for the tick interval)?
            seconds_since_due = (now - prev_run).total_seconds()
            if seconds_since_due <= 90:
                logger.info(f'Auto-sync triggered for site {site.id} ({site.name})')
                from app.services.environment_pipeline_service import EnvironmentPipelineService
                EnvironmentPipelineService.sync_from_production(
                    env_site_id=site.id,
                    sync_type='full',
                    user_id=None,
                )
        except Exception as e:
            logger.error(f'Auto-sync check failed for site {site.id}: {e}')


# How often the per-site WordPress health poller runs (seconds).
HEALTH_CHECK_INTERVAL = 300
# Retention for recorded health-check samples (days) — bounds unbounded growth
# from the continuous poller; matches the longest uptime window (uptime_90d).
# Pruned at most once per day.
HEALTH_CHECK_RETENTION_DAYS = 90
_last_health_prune = None


def run_health_checks():
    """Run a health check for every managed (production) WordPress site and sync
    any monitors bound to it. Per-site try/except so one hung site never stalls
    the whole sweep."""
    from app import db
    from app.models.wordpress_site import WordPressSite
    from app.models.status_page import StatusComponent
    from app.services.environment_health_service import EnvironmentHealthService
    from app.services.monitor_service import MonitorService

    _prune_old_health_checks()

    # The check engine is core now (it used to live in the serverkit-status
    # extension and was reached through get_installed_extension_attr), so a lean
    # panel with no status pages still keeps its site-bound monitors up to date.
    sites = WordPressSite.query.filter_by(is_production=True).all()
    for site in sites:
        try:
            # Only poll sites the operator expects to be up — skip archived/stopped
            # stacks so an intentional stop never looks like an outage.
            if not site.application or site.application.status != 'running':
                continue
            result = EnvironmentHealthService.check_health(site.id)
            overall = result.get('overall_status')
            if not overall:
                continue
            monitors = StatusComponent.query.filter_by(wordpress_site_id=site.id).all()
            for monitor in monitors:
                if monitor.is_paused:
                    continue
                MonitorService.sync_component_from_health(monitor, overall)
        except Exception as e:
            logger.error(f'Health check failed for site {site.id}: {e}')
            try:
                db.session.rollback()
            except Exception:
                pass


def run_monitor_checks():
    """Poll every monitor whose interval has elapsed.

    This is what actually makes monitoring happen: before it existed, checks only
    ran when someone pressed "Check now", so a configured monitor never noticed an
    outage on its own. Per-monitor try/except mirrors run_health_checks — one
    unreachable target must not stall the sweep.
    """
    from app import db
    from app.services.monitor_service import MonitorService

    due = MonitorService.due_monitors()
    if not due:
        return
    checked = 0
    for monitor in due:
        try:
            MonitorService.run_check(monitor.id)
            checked += 1
        except Exception as e:
            logger.error(f'Monitor check failed for monitor {monitor.id}: {e}')
            try:
                db.session.rollback()
            except Exception:
                pass
    logger.debug('Monitor sweep polled %s of %s due monitors', checked, len(due))


def _prune_old_health_checks():
    """Delete health-check samples older than the retention window, at most once
    per day, so the continuous poller doesn't grow the health_checks table without
    bound. Best-effort — failure never stalls the health sweep."""
    global _last_health_prune
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    if _last_health_prune is not None and (now - _last_health_prune).total_seconds() < 86400:
        return
    from app import db
    from app.models.status_page import HealthCheck
    cutoff = now - timedelta(days=HEALTH_CHECK_RETENTION_DAYS)
    try:
        deleted = HealthCheck.query.filter(HealthCheck.checked_at < cutoff).delete(synchronize_session=False)
        db.session.commit()
        _last_health_prune = now
        if deleted:
            logger.info(f'Pruned {deleted} health-check row(s) older than {HEALTH_CHECK_RETENTION_DAYS}d')
    except Exception as e:
        logger.error(f'Health-check prune failed: {e}')
        try:
            db.session.rollback()
        except Exception:
            pass


def check_update_schedules():
    from app.models.wordpress_site import WordPressSite, WordPressUpdateRun
    from datetime import datetime
    import json as _json

    try:
        from croniter import croniter
    except ImportError:
        return

    sites = WordPressSite.query.filter(WordPressSite.auto_update_schedule.isnot(None)).all()
    if not sites:
        return

    # Resolve the extension's update service only when scheduled WP sites
    # actually exist — with serverkit-wordpress uninstalled there is nothing
    # to run, and the bridge would raise (graceful absence).
    from app.services.wordpress_bridge import wp_update_service
    try:
        WpUpdateService = wp_update_service()
    except Exception as e:
        logger.warning(f'WP update schedules exist but the WordPress extension '
                       f'is not installed; skipping: {e}')
        return
    now = datetime.utcnow()
    for site in sites:
        try:
            expr = (site.auto_update_schedule or '').strip()
            if not expr or not croniter.is_valid(expr):
                continue
            if not site.application or site.application.status != 'running':
                continue
            prev = croniter(expr, now).get_prev(datetime)
            if not (0 < (now - prev).total_seconds() <= 90):
                continue
            # de-dup: skip if a run already started in the last ~10 minutes
            last = (WordPressUpdateRun.query.filter_by(site_id=site.id)
                    .order_by(WordPressUpdateRun.started_at.desc()).first())
            if last and last.started_at and (now - last.started_at).total_seconds() < 600:
                continue
            exclude = []
            if site.auto_update_exclude:
                try:
                    exclude = _json.loads(site.auto_update_exclude)
                except Exception:
                    exclude = []
            logger.info(f'Scheduled WordPress safe-update: site {site.id}')
            WpUpdateService.start_update(site, exclude=exclude, trigger='scheduled')
        except Exception as e:
            logger.error(f'Update schedule check failed for site {site.id}: {e}')


def run_snapshot_retention():
    """Set DatabaseSnapshot.expires_at per the retention policy and prune expired
    snapshots (file + DB row)."""
    from app.services.db_sync_service import DatabaseSyncService
    from app.services.settings_service import SettingsService
    days = SettingsService.get(
        'snapshot_retention_days',
        DatabaseSyncService.DEFAULT_SNAPSHOT_RETENTION_DAYS,
    )
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = DatabaseSyncService.DEFAULT_SNAPSHOT_RETENTION_DAYS
    result = DatabaseSyncService.prune_expired_snapshots(retention_days=days)
    return result if isinstance(result, dict) else None


def run_restore_point_retention():
    """Prune expired and over-cap generic restore points."""
    from app.services.restore_point_service import (
        DEFAULT_RETENTION_DAYS,
        prune,
    )
    from app.services.settings_service import SettingsService

    days = SettingsService.get(
        'restore_point_retention_days', DEFAULT_RETENTION_DAYS,
    )
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = DEFAULT_RETENTION_DAYS
    result = prune(retention_days=days)
    if not isinstance(result, dict) or result.get('success') is False:
        detail = result.get('error') if isinstance(result, dict) else None
        raise RuntimeError(detail or 'Restore-point retention failed')
    return result


def run_pairing_prune():
    """Prune expired pending agent pairings."""
    from app.services import pairing_service
    pairing_service.prune_expired()


def run_recycle_bin_retention():
    """Reap tombstones past the retention window.

    Nothing called `purge_expired` on a schedule before: a deleted domain is a
    row, and leaving rows around costs nothing anyone notices. Applications
    changed that -- their delete now KEEPS the data volumes and the uploaded
    source so a restore can work, and those are reclaimed by the purge hook. So
    without this the disk a delete used to free would never come back.

    Daily is the right cadence for a 30-day window; the exact hour is irrelevant
    and a shorter period would just re-scan the same rows.
    """
    from app.services import recycle_bin_service
    counts = recycle_bin_service.purge_expired()
    if counts:
        logger.info('Recycle bin retention: purged %s', counts)
        return counts
    return None


def run_registrar_expiry():
    """Notify when a registrar domain crosses an expiry threshold."""
    from app.services.registrar_service import RegistrarService
    n = RegistrarService.notify_expiring()
    if n:
        logger.info(f'Registrar expiry: sent {n} notification(s)')
        return {'notified': n}
    return None


def run_api_background():
    """Hourly API analytics aggregation + event delivery retry."""
    from app.services.api_analytics_service import ApiAnalyticsService
    from app.services.event_service import EventService
    ApiAnalyticsService.aggregate_hourly()
    EventService.retry_failed()


def run_backup_scheduler():
    """Enqueue any scheduled backups that are due (gated by backup config)."""
    from app.services.backup_service import BackupService
    BackupService.check_backup_schedules()


def run_job_retention():
    """Prune old terminal jobs so scheduler-tick rows (backup/workflow/auto-sync
    ticks) don't accumulate forever — the "107,834 Total" fix at the source.
    Succeeded/cancelled are kept ``jobs.retention_days`` (default 14), failed
    kept 3x that; queued/running rows are never touched. ``0`` disables it."""
    from app.jobs.service import JobService
    from app.services.settings_service import SettingsService
    days = SettingsService.get('jobs.retention_days', 14)
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 14
    if days <= 0:
        return None
    deleted = JobService.prune_terminal(retention_days=days)
    if deleted:
        logger.info(f'Job retention pruned {deleted} terminal job row(s)')
        return {'deleted': deleted}
    return None


def run_telemetry_retention():
    """Prune the telemetry stream so the database cannot grow without bound.

    ``jobs`` has had retention since day one, but the three tables that grow
    alongside it never did: ``queue_messages`` and ``system_events`` gain a row
    per scheduler tick and ``api_usage_logs`` one per request. Measured on a
    single-app box that is ~25k rows/day, or ~11 MB/day forever — which is how
    a 25 GB host filled from nothing but routine updates (each update copies
    the database twice as its pre-upgrade safety net).

    Kept ``telemetry.retention_days`` (default 30); ``0`` disables it. Rows are
    only deleted once terminal, and a queue message still referenced by a
    surviving job is always kept.
    """
    from app.services.settings_service import SettingsService
    from app.services import disk_reclaim_service
    days = SettingsService.get('telemetry.retention_days', 30)
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 30
    by_table = {}
    if days > 0:
        # No VACUUM here: it needs an exclusive lock and free space equal to
        # the database. Steady-state pruning keeps the freed pages on the
        # freelist for reuse, so the file stops growing without ever blocking
        # the panel. Use `serverkit disk` to actually shrink the file.
        report = disk_reclaim_service.prune_telemetry(days=days, vacuum=False)
        by_table.update(report.get('deleted') or {})
    # History tables (audit, notifications, cron runs, ...) ride the same tick
    # under their own settings, so disabling telemetry retention leaves them on.
    from app.services import history_retention_service
    by_table.update(history_retention_service.prune())
    deleted = sum(by_table.values())
    result = {'deleted': deleted, 'by_table': by_table} if deleted else {}
    if os.name != 'nt':
        # Files on the same tick: old update/build logs, and the previous
        # version's install once the current one has been live a day.
        from app.services import log_limits_service, slot_retention_service
        files = {k: v for k, v in log_limits_service.prune_files().items() if v}
        if files:
            result['files'] = files
        slot = slot_retention_service.remove_previous_slot()
        if slot:
            result['previous_slot'] = slot
    if result:
        logger.info('Retention pruned: %s', result)
        return result
    return None


def run_disk_alert():
    """Notify admins when the panel host's disk crosses 85% / 95%.
On by default; ``storage.disk_alert_percent=0`` disables."""
    from app.services import disk_alert_service
    level = disk_alert_service.check()
    return {'level': level} if level else None


def run_request_metrics():
    """Roll new access-log lines into per-app request metrics.

    A builtin tick, so its once-a-minute successes get the 24 h tick retention
    rather than the full job retention."""
    from app.services.request_metrics_service import RequestMetricsService
    return RequestMetricsService.sample()


def run_slot_standby_sweep():
    """Stop warm standby slots whose time is up. Stopped, not
    removed: a switch back to one is a start + health gate away."""
    from app.services.slot_deploy_service import SlotDeployService
    return SlotDeployService.sweep_standby() or None


def run_crash_loop_check():
    """Count container restarts and open/resolve crash-loop incidents.
A builtin tick: successes keep the 24 h tick retention."""
    from app.services.crash_loop_service import CrashLoopService
    return CrashLoopService.sweep()


def run_security_feed_check():
    """Daily security-advisory feed check.

    Pulls the normalized GHSA feed from serverkit.ai and notifies admins when
    the running panel version falls inside a published advisory's affected
    range, plus one-time post-fix reminders (e.g. key rotation) after an
    upgrade crosses a fix boundary. Fails silent on outbound errors."""
    from app.services.security_feed_service import check_security_feed

    try:
        return check_security_feed()
    except Exception as e:
        logger.debug(f'Security feed check skipped: {e}')
        return None


def run_extension_update_check():
    """Daily registry check for installed-extension updates (#50).

    Notifies admins through the Notifications Bus — but only when the set of
    available (slug, version) pairs CHANGED since the last notification, so a
    pending update nags once per release, not once per day. The Marketplace
    badge remains the always-current surface.
    """
    import json as _json
    from app.services.plugin_service import check_for_updates
    from app.services.settings_service import SettingsService

    try:
        updates = [u for u in check_for_updates() if u.get('update_available')]
    except Exception as e:
        logger.debug(f'Extension update check skipped: {e}')
        return None
    if not updates:
        return None

    fingerprint = _json.dumps(sorted(
        f"{u.get('slug')}@{u.get('available_version')}" for u in updates))
    marker_key = 'extensions.update_notified'
    if fingerprint == SettingsService.get(marker_key, ''):
        return {'updates': len(updates), 'notified': False}

    summary = ', '.join(
        f"{u.get('slug')} v{u.get('installed_version')} → v{u.get('available_version')}"
        for u in updates[:5])
    if len(updates) > 5:
        summary += f' (+{len(updates) - 5} more)'

    from app.notifications.sdk import NotifySdk
    NotifySdk().send(
        'extensions.updates_available',
        to='admins',
        data={'count': len(updates), 'summary': summary,
              'message': f'Updates available: {summary}. '
                         f'Review them on the Marketplace → Installed tab.'},
    )
    SettingsService.set(marker_key, fingerprint)
    return {'updates': len(updates), 'notified': True}


# How often fleet alert thresholds are evaluated (seconds). The evaluation
# itself averages a server's samples over each threshold's own
# ``duration_seconds`` window, so this is only how late a sustained breach can
# be noticed, not what counts as sustained.
FLEET_THRESHOLD_INTERVAL = 60


def run_fleet_threshold_checks():
    """Evaluate every enabled fleet alert threshold, and say what changed.

    ``FleetMonitorService.check_fleet_thresholds`` existed, was correct, and
    had no caller anywhere in the backend: thresholds could be configured on
    the Fleet page and were never evaluated, so a server could sit at 99% CPU
    for a week without opening an alert. This is the missing half — the
    schedule, and the notification that turns an ``MetricAlert`` row into
    something a person hears about.

    Both directions are notified. A breach that nobody is told about is the
    bug; a recovery that nobody is told about leaves somebody chasing a problem
    that has gone. A row closed because the severity changed is neither, and is
    not announced twice: the new alert already says what happened.
    """
    from app.services.fleet_monitor_service import FleetMonitorService

    result = FleetMonitorService.check_fleet_thresholds()
    if not result or (not result.get('opened') and not result.get('resolved')):
        return None

    opened = result.get('opened') or []
    resolved = result.get('resolved') or []
    _notify_fleet_alerts(opened, resolved)
    return {'opened': len(opened), 'resolved': len(resolved),
            'superseded': len(result.get('superseded') or []),
            'servers': result.get('servers', 0),
            'evaluated': result.get('evaluated', 0)}


def _notify_fleet_alerts(opened, resolved):
    """Send one notification per alert, through the Notification Bus.

    Per alert rather than per sweep: an operator needs to know *which* server
    and *which* metric, and the bus already de-duplicates and routes by
    preference. A failure to notify is logged and never allowed to lose the
    alert rows, which are committed by the time we get here.
    """
    try:
        from app.notifications.sdk import NotifySdk
    except Exception as e:                       # notifications unavailable
        logger.warning('Fleet thresholds fired but the notification bus is '
                       'unavailable: %s', e)
        return

    sdk = NotifySdk()
    for alert in opened:
        server = getattr(alert, 'server', None)
        hostname = getattr(server, 'name', None) or alert.server_id
        try:
            sdk.send(
                'system.alert',
                to='admins',
                severity='critical' if alert.severity == 'critical' else 'warning',
                data={
                    'hostname': hostname,
                    'alert_type': f'{alert.metric} {alert.severity}',
                    'metric': alert.metric,
                    'value': alert.value,
                    'threshold': alert.threshold,
                    'message': alert.detail or (
                        f'{hostname}: {alert.metric} averaged {alert.value} over '
                        f'{alert.duration_seconds}s, past the '
                        f'{alert.severity} threshold of {alert.threshold}.'),
                },
            )
        except Exception as e:
            logger.error('Could not notify fleet alert %s: %s', alert.id, e)

    for alert in resolved:
        server = getattr(alert, 'server', None)
        hostname = getattr(server, 'name', None) or alert.server_id
        try:
            sdk.send(
                'system.alert',
                to='admins',
                severity='info',
                data={
                    'hostname': hostname,
                    'alert_type': f'{alert.metric} recovered',
                    'metric': alert.metric,
                    'message': (f'{hostname}: {alert.metric} recovered.'
                                if alert.detail else
                                f'{hostname}: {alert.metric} is back under its '
                                f'threshold.'),
                },
            )
        except Exception as e:
            logger.error('Could not notify fleet recovery %s: %s', alert.id, e)


# ---------------------------------------------------------------------------
# Handler registration + schedule seeding
# ---------------------------------------------------------------------------
# (kind, handler, schedule-name, interval seconds, startup-delay seconds)
# The interval/delay pairs reproduce the original per-thread cadence: each
# former loop's sleep(settle) + sleep(interval) maps to startup_delay + interval.
_BUILTINS = [
    ('builtin.auto_sync',           check_auto_sync_schedules, 'auto-sync',          60,    60),
    ('builtin.snapshot_retention',  run_snapshot_retention,    'snapshot-retention', 3600,  120),
    ('builtin.restore_point_retention', run_restore_point_retention, 'restore-point-retention', 3600, 180),
    ('builtin.health_check',        run_health_checks,         'health-check',       300,   30),
    # 30s tick, not the monitor interval: the sweep only polls monitors whose own
    # interval has elapsed, so this bounds how late a 30s check can fire.
    ('builtin.monitor_check',       run_monitor_checks,        'monitor-check',      30,    20),
    ('builtin.wp_update',           check_update_schedules,    'wp-update',          60,    105),
    ('builtin.api_background',      run_api_background,        'api-background',     3600,  3600),
    ('builtin.pairing_prune',       run_pairing_prune,         'pairing-prune',      3600,  60),
    ('builtin.registrar_expiry',    run_registrar_expiry,      'registrar-expiry',   86400, 300),
    ('builtin.recycle_retention',   run_recycle_bin_retention, 'recycle-retention',  86400, 900),
    ('builtin.backup_scheduler',    run_backup_scheduler,      'backup-scheduler',   30,    30),
    ('builtin.extension_updates',   run_extension_update_check, 'extension-updates', 86400, 600),
    ('builtin.security_feed',       run_security_feed_check,   'security-feed',     86400, 600),
    ('builtin.job_retention',       run_job_retention,         'job-retention',      21600, 1500),
    ('builtin.telemetry_retention', run_telemetry_retention,   'telemetry-retention', 21600, 1800),
    ('builtin.disk_alert',          run_disk_alert,            'disk-alert',         900,   240),
    ('builtin.request_metrics',     run_request_metrics,       'request-metrics',    60,    90),
    ('builtin.crash_loop',          run_crash_loop_check,      'crash-loop',         60,    120),
    ('builtin.slot_standby',        run_slot_standby_sweep,    'slot-standby',       60,    150),
    # Fleet alert thresholds. Configurable since the Fleet page shipped, and
    # never evaluated until this row existed.
    ('builtin.fleet_thresholds',    run_fleet_threshold_checks, 'fleet-thresholds', FLEET_THRESHOLD_INTERVAL, 45),
]


def register_builtin_handlers():
    """Register all built-in periodic handlers. Pure in-memory; idempotent."""
    for kind, fn, _name, _interval, _delay in _BUILTINS:
        # Wrap so handlers match the fn(job) signature and ignore the job arg.
        register(kind, (lambda f: (lambda job: f()))(fn), replace=True)


def seed_builtin_schedules():
    """Idempotently create the ScheduledJob rows for the built-in tasks."""
    from app.jobs.service import ScheduledJobService
    for kind, _fn, name, interval, delay in _BUILTINS:
        ScheduledJobService.ensure(
            name, kind, interval_seconds=interval, startup_delay_seconds=delay,
        )
    # One-time login-link reaper — handler registered by
    # login_link_service.register_jobs() at boot.
    from app.services import login_link_service
    ScheduledJobService.ensure(
        login_link_service.REAP_SCHEDULE_NAME, login_link_service.REAP_JOB_KIND,
        interval_seconds=3600, startup_delay_seconds=120,
    )
    # Adminer SSO shadow-credential reaper — handler registered by
    # DbAdminSsoService.register_jobs() at boot.
    from app.services import db_admin_sso_service
    ScheduledJobService.ensure(
        db_admin_sso_service.REAP_SCHEDULE_NAME, db_admin_sso_service.REAP_JOB_KIND,
        interval_seconds=300, startup_delay_seconds=120,
    )
    # Daily configuration-drift sweep — handler registered by
    # DriftService.register_jobs() at boot.
    from app.services.drift_service import DRIFT_JOB_KIND, DRIFT_SCHEDULE_NAME
    ScheduledJobService.ensure(
        DRIFT_SCHEDULE_NAME, DRIFT_JOB_KIND,
        interval_seconds=86400, startup_delay_seconds=900,
    )
    # File-integrity sweep — handler registered by
    # FileIntegrityService.register_jobs() at boot.
    from app.services import file_integrity_service
    ScheduledJobService.ensure(
        file_integrity_service.FIM_SCHEDULE_NAME, file_integrity_service.FIM_JOB_KIND,
        interval_seconds=21600, startup_delay_seconds=1200,
    )
    # Daily per-site bandwidth aggregation — handler registered by
    # BandwidthService.register_jobs() at boot.
    from app.services import bandwidth_service
    ScheduledJobService.ensure(
        bandwidth_service.BANDWIDTH_SCHEDULE_NAME, bandwidth_service.BANDWIDTH_JOB_KIND,
        interval_seconds=86400, startup_delay_seconds=1800,
    )
    # Daily host "doctor" health sweep — handler registered by
    # DoctorService.register_jobs() at boot.
    from app.services.doctor_service import DOCTOR_JOB_KIND, DOCTOR_SCHEDULE_NAME
    ScheduledJobService.ensure(
        DOCTOR_SCHEDULE_NAME, DOCTOR_JOB_KIND,
        interval_seconds=86400, startup_delay_seconds=600,
    )
    # Daily fleet-wide health sweep — handler registered by
    # FleetDoctorService.register_jobs() at boot. Same daily cadence as the host
    # doctor above but deliberately staggered 30 minutes behind it: the fleet
    # sweep fans out over the single-worker agent gateway, so it must not
    # contend with the local sweep (or the boot-time agent reconnect storm).
    from app.services.fleet_doctor_service import (
        FLEET_DOCTOR_JOB_KIND, FLEET_DOCTOR_SCHEDULE_NAME)
    ScheduledJobService.ensure(
        FLEET_DOCTOR_SCHEDULE_NAME, FLEET_DOCTOR_JOB_KIND,
        interval_seconds=86400, startup_delay_seconds=2400,
    )
    # Weekly setup-health nag — handler registered by
    # SetupHealthService.register_jobs() at boot.
    from app.services.setup_health_service import NAG_JOB_KIND, NAG_SCHEDULE_NAME
    ScheduledJobService.ensure(
        NAG_SCHEDULE_NAME, NAG_JOB_KIND,
        interval_seconds=604800, startup_delay_seconds=3600,
    )
