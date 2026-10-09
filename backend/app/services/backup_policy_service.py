"""Backup "protection" policy service.

Owns the lifecycle of a :class:`BackupPolicy`: CRUD, mirroring the cron schedule
into a ``ScheduledJob`` on the unified job bus, enqueuing one-off runs, and the
job handlers that actually produce :class:`BackupRun` records.

Job kinds (intentionally distinct from the legacy ``backup.run`` config-schedule
handler so the two systems coexist):
  * ``backup.policy.run`` — run a policy's backup once.
  * ``restore.run``       — restore a target from a specific BackupRun.
"""
import logging
import os
import shutil
from datetime import datetime, timedelta
from decimal import Decimal

from app import db
from app.utils.system import run_checked
from app.utils.formatting import format_bytes

logger = logging.getLogger(__name__)

BACKUP_POLICY_JOB_KIND = 'backup.policy.run'
RESTORE_JOB_KIND = 'restore.run'

VALID_COMPRESSION = ('fast', 'balanced', 'max')
# A 'running' run older than this is treated as crashed, not in-flight.
STALE_RUN_AFTER = timedelta(hours=6)


class BackupPolicyError(ValueError):
    """Raised for invalid policy input or rejected operations (maps to HTTP 400)."""


class BackupPolicyService:

    # ------------------------------------------------------------------ #
    # Policy CRUD
    # ------------------------------------------------------------------ #

    @staticmethod
    def _job_name(policy):
        return f'backup.{policy.target_type}.{policy.target_id}'

    @classmethod
    def get_policy(cls, target_type, target_id):
        from app.models.backup_policy import BackupPolicy
        return BackupPolicy.query.filter_by(
            target_type=target_type, target_id=int(target_id)
        ).first()

    @staticmethod
    def validate_target_type(target_type):
        """Reject unknown target types (maps to HTTP 400).

        Every policy route funnels through here, so accepting a registered
        plugin kind is what opens the whole blueprint — and the Protection
        panel, which is already generic over target_type — to it.
        """
        from app.models.backup_policy import VALID_TARGET_TYPES
        if target_type in VALID_TARGET_TYPES:
            return
        from app.services import backup_kind_registry
        if backup_kind_registry.get(target_type):
            return
        raise BackupPolicyError(
            f"target_type must be one of {VALID_TARGET_TYPES}, got {target_type!r}"
        )

    @classmethod
    def get_or_create_policy(cls, target_type, target_id, target_subtype=None, target_meta=None):
        from app.models.backup_policy import BackupPolicy
        cls.validate_target_type(target_type)
        policy = cls.get_policy(target_type, target_id)
        if policy:
            # Refresh target descriptors for non-resource targets (database/files)
            # whose connection/path details can change between calls.
            if target_subtype is not None:
                policy.target_subtype = target_subtype
            if target_meta is not None:
                policy.set_target_meta(target_meta)
            if target_subtype is not None or target_meta is not None:
                db.session.commit()
            return policy
        policy = BackupPolicy(target_type=target_type, target_id=int(target_id))
        if target_subtype is not None:
            policy.target_subtype = target_subtype
        if target_meta is not None:
            policy.set_target_meta(target_meta)
        db.session.add(policy)
        db.session.commit()
        cls.ensure_scheduled_job(policy)
        return policy

    @classmethod
    def validate_fields(cls, fields):
        """Validate a partial update dict; raises BackupPolicyError."""
        for key in ('retention_count', 'retention_days', 'full_every_n_days'):
            if key in fields and fields[key] is not None:
                try:
                    if int(fields[key]) < 1:
                        raise BackupPolicyError(f'{key} must be >= 1')
                except (TypeError, ValueError):
                    raise BackupPolicyError(f'{key} must be an integer >= 1')
        if fields.get('compression') is not None and fields['compression'] not in VALID_COMPRESSION:
            raise BackupPolicyError(f"compression must be one of {VALID_COMPRESSION}")
        cron = fields.get('schedule_cron')
        if cron is not None and not cls._cron_valid(cron):
            raise BackupPolicyError('Invalid cron expression')
        if fields.get('remote_copy'):
            from app.services.backup_cost_service import BackupCostService
            if not BackupCostService.configured_remote_provider():
                raise BackupPolicyError(
                    'Remote storage is not configured. Configure it in Backups → Storage first.'
                )

    @staticmethod
    def _cron_valid(cron):
        if not cron or len(cron.split()) < 5:
            return False
        try:
            from croniter import croniter
            return bool(croniter.is_valid(cron))
        except ImportError:
            return True  # can't validate without croniter; trust the caller

    # Whitelisted, mutable policy fields.
    _MUTABLE = (
        'enabled', 'schedule_cron', 'retention_count', 'retention_days',
        'full_every_n_days', 'compression', 'remote_copy',
        'pre_backup_hook', 'post_backup_hook',
    )

    @classmethod
    def update_policy(cls, policy, fields):
        """Apply a partial update, persist, and re-sync the ScheduledJob."""
        clean = {k: v for k, v in (fields or {}).items() if k in cls._MUTABLE}
        cls.validate_fields(clean)
        for key, value in clean.items():
            if key in ('retention_count', 'retention_days', 'full_every_n_days') and value is not None:
                value = int(value)
            setattr(policy, key, value)
        db.session.commit()
        cls.ensure_scheduled_job(policy)
        return policy

    # ------------------------------------------------------------------ #
    # Scheduled-job wiring
    # ------------------------------------------------------------------ #

    @classmethod
    def ensure_scheduled_job(cls, policy):
        """Upsert the ScheduledJob row mirroring this policy's cron + enabled."""
        from app.jobs.service import ScheduledJobService
        from app.jobs.models import ScheduledJob
        name = cls._job_name(policy)
        ScheduledJobService.ensure(
            name=name,
            kind=BACKUP_POLICY_JOB_KIND,
            cron=policy.schedule_cron,
            payload={'policy_id': policy.id},
            max_attempts=1,  # backups aren't idempotent — no auto-retry
            enabled=policy.enabled,
        )
        # ensure() preserves the existing enabled flag on update, so push the
        # policy's current toggle explicitly.
        scheduled = ScheduledJob.query.filter_by(name=name).first()
        if scheduled and scheduled.enabled != policy.enabled:
            ScheduledJobService.set_enabled(scheduled.id, policy.enabled)
        return scheduled

    @classmethod
    def _scheduled_job(cls, policy):
        from app.jobs.models import ScheduledJob
        return ScheduledJob.query.filter_by(name=cls._job_name(policy)).first()

    # ------------------------------------------------------------------ #
    # Manual trigger + concurrency
    # ------------------------------------------------------------------ #

    @classmethod
    def is_running(cls, policy):
        from app.models.backup_run import BackupRun
        cutoff = datetime.utcnow() - STALE_RUN_AFTER
        return db.session.query(BackupRun.id).filter(
            BackupRun.policy_id == policy.id,
            BackupRun.status.in_(('running', 'verifying')),
            BackupRun.started_at >= cutoff,
        ).first() is not None

    @classmethod
    def run_policy_now(cls, policy, manual=True):
        """Enqueue a one-off backup.policy.run job; rejects if one is in flight."""
        from app.jobs.service import JobService
        if cls.is_running(policy):
            raise BackupPolicyError('A backup is already in progress.')
        job = JobService.enqueue(
            BACKUP_POLICY_JOB_KIND,
            payload={'policy_id': policy.id, 'manual': bool(manual)},
            max_attempts=1,
            owner_type='backup_policy',
            owner_id=policy.id,
        )
        return job

    # ------------------------------------------------------------------ #
    # Target resolution
    # ------------------------------------------------------------------ #

    @classmethod
    def _resolve_target(cls, policy):
        """Return a dict describing the live target, or raise if missing.

        keys: name, root_path, target_type, site (wp only), app, plus
        db_config (database) / file_paths (files) for the non-resource targets.
        """
        # Checked first: extension-registered kinds (plan 52 D4 — e.g.
        # 'wordpress_site' while the WordPress extension is installed) own
        # their resolution. An unrecognised type must NEVER reach the
        # application fallthrough at the bottom (it would back up the wrong
        # thing), so unknown-without-provider raises explicitly there.
        from app.services import backup_kind_registry
        if backup_kind_registry.get(policy.target_type):
            return backup_kind_registry.resolve(policy)

        if policy.target_type == 'database':
            meta = policy.get_target_meta()
            # Managed database: target_id is a real FK into managed_databases and
            # the descriptor (incl. the encrypted admin secret) lives on the row.
            # Legacy policies have no 'managed' marker and keep the JSON path below.
            if meta.get('managed'):
                from app.models.managed_database import ManagedDatabase
                from app.services.managed_database_service import ManagedDatabaseService
                # Deliberately tombstone-blind: a soft-deleted managed DB
                # keeps its backup policy running until PURGE, so the data
                # stays recoverable for the whole Recycle Bin window.
                managed = ManagedDatabase.query.get(policy.target_id)
                if managed is None:
                    raise BackupPolicyError('Managed database is no longer tracked')
                return {
                    'name': managed.name, 'root_path': None,
                    'target_type': 'database', 'site': None, 'app': None,
                    'managed_db': managed,
                    'db_config': ManagedDatabaseService.backup_descriptor(managed),
                }
            db_name = meta.get('db_name')
            if not db_name:
                raise BackupPolicyError('Database target is missing db_name')
            return {
                'name': db_name, 'root_path': None,
                'target_type': 'database', 'site': None, 'app': None,
                'db_config': {
                    'db_type': policy.target_subtype or meta.get('db_type') or 'mysql',
                    'db_name': db_name,
                    'user': meta.get('user'),
                    'password': meta.get('password'),
                    'host': meta.get('host', 'localhost'),
                },
            }

        if policy.target_type == 'files':
            meta = policy.get_target_meta()
            file_paths = list(meta.get('paths') or [])
            # Appliance tier (plan 35): a manifest disk backs a named docker
            # volume, so back up its live HOST mountpoint, not the in-container
            # path. Falls back to `paths` when the volume isn't resolvable yet.
            vol_mount = meta.get('volume_mount')
            if vol_mount and meta.get('app_id'):
                try:
                    from app.models.application import Application
                    from app.services.volume_service import VolumeService
                    app = Application.query_active().filter_by(id=meta['app_id']).first()
                    host_path = VolumeService.host_path_for_mount(app, vol_mount)
                    if host_path:
                        file_paths = [host_path]
                except Exception:
                    pass
            # Unit disks live in a synthetic per-container docker volume (plan 35);
            # resolve its live mountpoint directly by name.
            docker_volume = meta.get('docker_volume')
            if docker_volume:
                try:
                    from app.services.docker_service import DockerService
                    live = DockerService.inspect_volume(docker_volume)
                    if live.get('present') and live.get('mountpoint'):
                        file_paths = [live['mountpoint']]
                except Exception:
                    pass
            if not file_paths:
                raise BackupPolicyError('Files target has no paths configured')
            return {
                'name': meta.get('label') or f'files-{policy.target_id}',
                'root_path': None, 'target_type': 'files',
                'site': None, 'app': None, 'file_paths': list(file_paths),
            }

        if policy.target_type == 'server':
            raise BackupPolicyError('Whole-server backups are not yet implemented')

        # Anything that is not a core type and had no registered provider above
        # is a target whose extension is absent/disabled — refuse loudly with a
        # "provider missing" error rather than mis-resolving it as an app.
        if policy.target_type != 'application':
            raise BackupPolicyError(
                f"Backup target type {policy.target_type!r} has no provider: the "
                f"extension that supplies it is not installed or not active"
            )

        # application
        # A BackupPolicy outlives the app it points at, and its ScheduledJob keeps
        # firing, so a deleted app must fail here rather than have tar/restic run
        # against it and eat remote storage quota.
        from app.models.application import Application
        app = Application.query_active().filter_by(id=policy.target_id).first()
        if not app:
            raise BackupPolicyError('Service not found')
        if not app.root_path:
            raise BackupPolicyError('Target path not found')
        return {
            'name': app.name, 'root_path': app.root_path,
            'target_type': 'application', 'site': None, 'app': app,
        }

    # ------------------------------------------------------------------ #
    # Backup execution (Phase 1: full backups; Phase 3 adds incremental)
    # ------------------------------------------------------------------ #

    @classmethod
    def _run_hook(cls, hook, label, target):
        """Run an optional pre/post shell hook; raise on non-zero exit."""
        if not hook or not hook.strip():
            return
        env = dict(os.environ)
        env['SERVERKIT_TARGET_NAME'] = target['name']
        env['SERVERKIT_TARGET_PATH'] = target['root_path'] or ''
        try:
            # shell=True stays: this is an operator-authored hook, and running
            # it through a shell is the documented contract (plan 75 anti-goal).
            result = run_checked(
                hook, shell=True, cwd=target['root_path'] or None, env=env,
                timeout=600,
            )
        except Exception as exc:
            raise BackupPolicyError(f'{label} hook error: {exc}')
        if not result['success']:
            raise BackupPolicyError(
                f"{label} hook failed (exit {result['returncode']}): "
                f"{(result['error'] or result['output'])[:300]}"
            )

    @classmethod
    def _policy_dir(cls, policy):
        from app.services.backup_service import BackupService
        return os.path.join(BackupService.BACKUP_BASE_DIR, 'policies', str(policy.id))

    @classmethod
    def _snar_path(cls, policy):
        return os.path.join(cls._policy_dir(policy), 'incremental.snar')

    @classmethod
    def _decide_kind(cls, policy):
        """Choose full vs incremental for the next run. WordPress is always full
        (files + db via wp-cli); applications use the snar-based tar chain: full
        on first run / missing snar / when a full is due, else incremental."""
        from app.models.backup_run import BackupRun
        if policy.target_type != 'application':
            return 'full'
        if not os.path.exists(cls._snar_path(policy)):
            return 'full'
        last_full = (BackupRun.query
                     .filter_by(policy_id=policy.id, status='success', kind='full')
                     .order_by(BackupRun.started_at.desc()).first())
        if not last_full:
            return 'full'
        days_since_full = (datetime.utcnow() - (last_full.started_at or datetime.utcnow())).days
        if days_since_full >= (policy.full_every_n_days or 7):
            return 'full'
        return 'incremental'

    @classmethod
    def _execute_backup(cls, policy, target, kind):
        """Produce a backup for the target. Returns (storage_path, size, metadata).
        The actual kind used is metadata['kind'] (a tar fallback can downgrade an
        incremental to a full). Raises on failure."""
        from app.services import backup_kind_registry
        if backup_kind_registry.get(target['target_type']):
            return backup_kind_registry.execute(policy, target, kind)

        meta = {'engine': target['target_type']}
        if target['target_type'] == 'database':
            from app.services.backup_service import BackupService
            cfg = target['db_config']
            result = BackupService.backup_database(
                db_type=cfg['db_type'], db_name=cfg['db_name'],
                user=cfg.get('user'), password=cfg.get('password'),
                host=cfg.get('host', 'localhost'),
            )
            if not result.get('success'):
                raise BackupPolicyError(result.get('error') or 'Database backup failed')
            backup = result.get('backup') or {}
            storage_path = backup.get('path')
            size = backup.get('size') or cls._path_size(storage_path)
            meta.update({
                'kind': 'full', 'compression': 'gzip', 'incremental': False,
                'includes': ['database'], 'backup_name': backup.get('name'),
                'primary_archive': storage_path,
                'db_type': cfg['db_type'], 'db_name': cfg['db_name'],
            })
            return storage_path, size, meta

        if target['target_type'] == 'files':
            from app.services.backup_service import BackupService
            result = BackupService.backup_files(target['file_paths'], target['name'])
            if not result.get('success'):
                raise BackupPolicyError(result.get('error') or 'File backup failed')
            backup = result.get('backup') or {}
            storage_path = result.get('path') or backup.get('path')
            size = backup.get('size') or cls._path_size(storage_path)
            meta.update({
                'kind': 'full', 'compression': 'gzip', 'incremental': False,
                'includes': ['files'], 'backup_name': backup.get('name'),
                'primary_archive': storage_path, 'paths': target['file_paths'],
            })
            return storage_path, size, meta

        # application — smart incremental + compression tiering
        from app.models.backup_run import BackupRun
        from app.services.backup_service import BackupService
        ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        run_dir = os.path.join(cls._policy_dir(policy), ts)
        res = BackupService.smart_backup_files(
            target['root_path'], run_dir, kind, policy.compression, cls._snar_path(policy),
        )
        meta.update({
            'kind': res['kind'], 'compression': res['compression'],
            'incremental': res.get('incremental', False), 'includes': ['files'],
            'backup_name': f"{target['name']}_{ts}_{res['kind']}",
            'primary_archive': res['archive'],
        })
        if res['kind'] == 'incremental':
            last_full = (BackupRun.query
                         .filter_by(policy_id=policy.id, status='success', kind='full')
                         .order_by(BackupRun.started_at.desc()).first())
            meta['full_run_id'] = last_full.id if last_full else None
        return run_dir, res['size'], meta

    @classmethod
    def _upload_run(cls, policy, run, meta):
        """Upload a run's local files to remote storage and verify the primary
        archive. Mutates run.size_remote/cost_remote/remote_key/verified + meta."""
        from app.services.storage_provider_service import StorageProviderService
        from app.services.backup_cost_service import BackupCostService
        provider = BackupCostService.configured_remote_provider()
        run_dir = run.storage_path
        if not provider or not run_dir or not os.path.isdir(run_dir):
            return
        prefix = f"policies/{policy.id}/{os.path.basename(run_dir.rstrip('/'))}"
        primary_local = meta.get('primary_archive')
        total = 0
        primary_key = None
        for root, _dirs, files in os.walk(run_dir):
            for fname in files:
                local = os.path.join(root, fname)
                rel = os.path.relpath(local, run_dir).replace(os.sep, '/')
                key = f"{prefix}/{rel}"
                up = StorageProviderService.upload_file(local, key)
                if not up.get('success'):
                    raise RuntimeError(up.get('error') or f'upload failed: {rel}')
                total += os.path.getsize(local)
                if primary_local and os.path.abspath(local) == os.path.abspath(primary_local):
                    primary_key = up.get('remote_key') or key
        run.size_remote = total
        run.cost_remote = BackupCostService.compute_cost(total, provider)
        run.remote_key = primary_key or prefix
        meta['remote_prefix'] = prefix
        if primary_local:
            meta['remote_source'] = primary_local
        if primary_key and primary_local and os.path.exists(primary_local):
            try:
                vr = StorageProviderService.verify_file(primary_key, primary_local)
                run.verified = bool(vr.get('verified'))
            except Exception:
                run.verified = False

    @staticmethod
    def _path_size(path):
        if not path or not os.path.exists(path):
            return 0
        if os.path.isfile(path):
            return os.path.getsize(path)
        total = 0
        for root, _dirs, files in os.walk(path):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(root, f))
                except OSError:
                    pass
        return total

    # ------------------------------------------------------------------ #
    # Job handler: backup.policy.run
    # ------------------------------------------------------------------ #

    @classmethod
    def run_backup_policy_job(cls, job):
        from app.models.backup_policy import BackupPolicy
        from app.models.backup_run import BackupRun
        from app.services.backup_cost_service import BackupCostService

        payload = job.get_payload() or {}
        policy = BackupPolicy.query.get(payload.get('policy_id'))
        if not policy:
            raise ValueError(f"backup policy {payload.get('policy_id')!r} not found")

        # Don't overlap an in-flight run (e.g. a schedule firing over a manual run).
        if cls.is_running(policy):
            logger.info('Skipping backup for policy %s — a run is already in progress', policy.id)
            return {'skipped': True, 'reason': 'already running'}

        target = cls._resolve_target(policy)  # raises -> job fails with a clear message
        kind = cls._decide_kind(policy)

        run = BackupRun(policy_id=policy.id, job_id=job.id, kind=kind,
                        status='running', started_at=datetime.utcnow())
        db.session.add(run)
        db.session.commit()
        run_id = run.id
        started = run.started_at

        try:
            cls._run_hook(policy.pre_backup_hook, 'pre-backup', target)
            storage_path, size, meta = cls._execute_backup(policy, target, kind)
            cls._run_hook(policy.post_backup_hook, 'post-backup', target)

            run = BackupRun.query.get(run_id)
            run.kind = meta.get('kind', kind)  # tar fallback may downgrade incr -> full
            run.status = 'success'
            run.finished_at = datetime.utcnow()
            run.duration_seconds = int((run.finished_at - started).total_seconds())
            run.size_local = size
            run.cost_local = BackupCostService.compute_cost(size, 'local')
            run.storage_path = storage_path
            run.set_metadata(meta)

            # Remote copy (upload + verify) — best-effort; a remote failure must
            # not discard the good local backup.
            if policy.remote_copy:
                try:
                    cls._upload_run(policy, run, meta)
                    run.set_metadata(meta)
                except Exception as exc:  # noqa: BLE001
                    logger.warning('Remote copy failed for run %s: %s', run_id, exc)

            cls._update_policy_cache(policy.id, run)
            db.session.commit()

            # Retention cleanup is best-effort and must never fail the backup.
            try:
                cls.apply_retention(policy)
            except Exception as exc:  # noqa: BLE001
                logger.warning('Retention cleanup failed for policy %s: %s', policy.id, exc)

            cls._notify('backup.completed', target['name'], {
                'app': target['name'],
                'backup_name': meta.get('backup_name'),
                'size': format_bytes(size),
                'kind': run.kind,
            })
            return {'run_id': run_id, 'status': 'success', 'size': size,
                    'kind': run.kind, 'name': target['name']}

        except Exception as exc:  # noqa: BLE001 — record + re-raise so the job fails
            db.session.rollback()
            failed = BackupRun.query.get(run_id)
            if failed:
                failed.status = 'failed'
                failed.error_message = str(exc)[:2000]
                failed.finished_at = datetime.utcnow()
                failed.duration_seconds = int((failed.finished_at - started).total_seconds())
                cls._update_policy_cache(policy.id, failed)
                db.session.commit()
            cls._notify('backup.failed', target.get('name') if isinstance(target, dict) else None, {
                'app': (target.get('name') if isinstance(target, dict) else None) or 'site',
                'error_message': str(exc)[:300],
            })
            raise

    @classmethod
    def _update_policy_cache(cls, policy_id, run):
        from app.models.backup_policy import BackupPolicy
        policy = BackupPolicy.query.get(policy_id)
        if not policy:
            return
        policy.last_run_at = run.finished_at or run.started_at
        policy.last_status = run.status
        policy.last_size = run.size_local
        policy.last_cost_local = run.cost_local
        policy.last_cost_remote = run.cost_remote
        policy.last_job_id = run.job_id

    @classmethod
    def apply_retention(cls, policy):
        """Prune backups beyond the policy's count/age limits.

        A successful backup is kept if it is within the last ``retention_count``
        successes AND newer than ``retention_days``. The most recent successful
        backup is always kept. Chain ancestors (the full + intervening
        incrementals) of any kept incremental are also protected, so a kept
        backup never loses the archives needed to restore it. Failed runs and
        out-of-window successes are deleted (local + remote + row)."""
        from app.models.backup_run import BackupRun
        successes = (BackupRun.query
                     .filter_by(policy_id=policy.id, status='success')
                     .order_by(BackupRun.started_at.desc()).all())  # newest first
        if not successes:
            return
        cutoff = datetime.utcnow() - timedelta(days=policy.retention_days or 30)
        keep = {successes[0].id}  # always keep the most recent successful backup
        for idx, run in enumerate(successes):
            within_count = idx < (policy.retention_count or 14)
            within_days = (run.started_at or datetime.utcnow()) >= cutoff
            if within_count and within_days:
                keep.add(run.id)

        # Protect the chain ancestors of every kept incremental.
        by_id = {r.id: r for r in successes}
        for run in successes:
            if run.id not in keep:
                continue
            meta = run.get_metadata() or {}
            if not meta.get('incremental'):
                continue
            full = by_id.get(meta.get('full_run_id'))
            if not full:
                continue
            keep.add(full.id)
            for other in successes:
                if (other.kind == 'incremental'
                        and other.started_at is not None
                        and full.started_at is not None
                        and full.started_at <= other.started_at <= run.started_at):
                    keep.add(other.id)

        # Delete every terminal run that isn't protected.
        candidates = (BackupRun.query
                      .filter(BackupRun.policy_id == policy.id,
                              BackupRun.status.in_(('success', 'failed')))
                      .all())
        for run in candidates:
            if run.id in keep:
                continue
            try:
                cls.delete_run(policy, run.id)
            except Exception as exc:  # noqa: BLE001
                logger.warning('retention: failed to delete run %s: %s', run.id, exc)

    # ------------------------------------------------------------------ #
    # Restore (Phase 1: working full/files/db restore; Phase 4 adds the UI,
    # selected-table scope, and richer safety options)
    # ------------------------------------------------------------------ #

    @classmethod
    def request_restore(cls, policy, run_id, options):
        from app.jobs.service import JobService
        from app.models.backup_run import BackupRun
        run = BackupRun.query.filter_by(id=run_id, policy_id=policy.id).first()
        if not run:
            raise BackupPolicyError('Backup not found')
        if run.status != 'success':
            raise BackupPolicyError('Only a successful backup can be restored')
        if cls.is_running(policy):
            raise BackupPolicyError('A backup or restore is already in progress.')
        from app.services import backup_kind_registry
        if (backup_kind_registry.get(policy.target_type)
                and not backup_kind_registry.supports_restore(policy.target_type)):
            # Answer here rather than by queueing a job that will fail: the
            # kind's own author decided not to implement restore.
            raise BackupPolicyError(
                f'Backups of type "{policy.target_type}" cannot be restored '
                'from the panel.')
        payload = {
            'policy_id': policy.id,
            'run_id': run_id,
            'scope': (options or {}).get('scope', 'full'),
            'tables': (options or {}).get('tables') or [],
            'safety_backup': bool((options or {}).get('safety_backup', True)),
            'copy_permissions': bool((options or {}).get('copy_permissions', False)),
            'maintenance_mode': bool((options or {}).get('maintenance_mode', True)),
        }
        return JobService.enqueue(
            RESTORE_JOB_KIND, payload=payload, max_attempts=1,
            owner_type='backup_policy', owner_id=policy.id,
        )

    @classmethod
    def run_restore_job(cls, job):
        from app.models.backup_policy import BackupPolicy
        from app.models.backup_run import BackupRun

        payload = job.get_payload() or {}
        policy = BackupPolicy.query.get(payload.get('policy_id'))
        if not policy:
            raise ValueError('backup policy not found')
        run = BackupRun.query.filter_by(id=payload.get('run_id'), policy_id=policy.id).first()
        if not run:
            raise ValueError('backup run not found')
        target = cls._resolve_target(policy)
        scope = payload.get('scope', 'full')

        try:
            # Optional safety snapshot of the current state before overwriting.
            if payload.get('safety_backup'):
                try:
                    cls._safety_backup(policy, target)
                except Exception as exc:  # safety backup is best-effort
                    logger.warning('Safety backup before restore failed: %s', exc)

            from app.services import backup_kind_registry
            if backup_kind_registry.get(target['target_type']):
                # Ahead of the else-branch below, which would otherwise unpack
                # a plugin's archive over an application directory.
                backup_kind_registry.restore(policy, target, run, payload)
            elif target['target_type'] == 'database':
                cls._restore_database(target, run)
            elif target['target_type'] == 'files':
                cls._restore_files(target, run, payload)
            elif target['target_type'] == 'application':
                cls._restore_application(policy, target, run, scope)
            else:
                # Registered-kind restore is handled above; reaching here means
                # the target's extension is gone (provider missing) — never
                # fall through to the application restore with foreign bytes.
                raise BackupPolicyError(
                    f"Cannot restore target type {target['target_type']!r}: the "
                    f"extension that supplies it is not installed or not active"
                )

            cls._notify('restore.completed', target['name'], {
                'app': target['name'], 'scope': scope,
            })
            return {'status': 'success', 'scope': scope, 'name': target['name']}
        except Exception as exc:  # noqa: BLE001
            db.session.rollback()
            cls._notify('restore.failed', target['name'], {
                'app': target['name'], 'error_message': str(exc)[:300],
            })
            raise

    @classmethod
    def _safety_backup(cls, policy, target):
        from app.models.backup_run import BackupRun
        from app.services.backup_cost_service import BackupCostService
        run = BackupRun(policy_id=policy.id, kind='full', status='running',
                        started_at=datetime.utcnow())
        db.session.add(run)
        db.session.commit()
        storage_path, size, meta = cls._execute_backup(policy, target, 'full')
        meta['safety'] = True
        run.kind = meta.get('kind', 'full')
        run.status = 'success'
        run.finished_at = datetime.utcnow()
        run.duration_seconds = int((run.finished_at - run.started_at).total_seconds())
        run.size_local = size
        run.cost_local = BackupCostService.compute_cost(size, 'local')
        run.storage_path = storage_path
        run.set_metadata(meta)
        db.session.commit()

    @classmethod
    def _restore_database(cls, target, run):
        """Restore a standalone database from its dump (mysql/postgres/etc.)."""
        from app.services.backup_service import BackupService
        cfg = target['db_config']
        backup_path = (run.get_metadata() or {}).get('primary_archive') or run.storage_path
        if not backup_path or not os.path.exists(backup_path):
            raise BackupPolicyError('Backup archive not found')
        result = BackupService.restore_database(
            backup_path=backup_path, db_type=cfg['db_type'], db_name=cfg['db_name'],
            user=cfg.get('user'), password=cfg.get('password'),
            host=cfg.get('host', 'localhost'),
        )
        if not result.get('success'):
            raise BackupPolicyError(result.get('error') or 'Database restore failed')

    @classmethod
    def _restore_files(cls, target, run, payload):
        """Extract a files backup. Restores into an explicit ``restore_path``
        (from options) or a safe ``restores/`` staging dir — never blindly over
        the originals, since a path-list archive only preserves basenames."""
        import tarfile
        from app.services.backup_service import BackupService
        backup_path = (run.get_metadata() or {}).get('primary_archive') or run.storage_path
        if not backup_path or not os.path.exists(backup_path):
            raise BackupPolicyError('Backup archive not found')
        dest = (payload or {}).get('restore_path')
        if not dest:
            dest = os.path.join(BackupService.BACKUP_BASE_DIR, 'restores',
                                f'files-{run.id}')
        os.makedirs(dest, exist_ok=True)
        with tarfile.open(backup_path, 'r:gz') as tar:
            tar.extractall(dest, filter='data')
        return {'restore_path': dest}

    @classmethod
    def _chain_archives(cls, policy, run):
        """Ordered list of local archive paths needed to restore ``run`` — the
        base full first, then each incremental up to and including ``run``.
        Raises if any required archive is missing locally."""
        from app.models.backup_run import BackupRun
        meta = run.get_metadata() or {}
        if not meta.get('incremental'):
            primary = meta.get('primary_archive')
            if not primary or not os.path.exists(primary):
                raise BackupPolicyError('Backup archive not found')
            return [primary]
        full = BackupRun.query.get(meta.get('full_run_id')) if meta.get('full_run_id') else None
        if not full:
            raise BackupPolicyError('Base full backup for this incremental is missing')
        chain = (BackupRun.query
                 .filter(BackupRun.policy_id == policy.id, BackupRun.status == 'success',
                         BackupRun.started_at >= full.started_at,
                         BackupRun.started_at <= run.started_at)
                 .order_by(BackupRun.started_at.asc()).all())
        archives = []
        for r in chain:
            m = r.get_metadata() or {}
            if r.id == full.id or m.get('full_run_id') == full.id:
                path = m.get('primary_archive')
                if not path or not os.path.exists(path):
                    raise BackupPolicyError(f'Backup archive missing for run {r.id}')
                archives.append(path)
        return archives

    @classmethod
    def _restore_application(cls, policy, target, run, scope):
        """Restore an application's files by replaying its incremental chain
        (full + intervening incrementals) over the app root."""
        from app.services.backup_service import BackupService
        archives = cls._chain_archives(policy, run)
        result = BackupService.restore_incremental_chain(archives, target['root_path'])
        if not result.get('success'):
            raise BackupPolicyError(result.get('error') or 'Restore failed')

    # ------------------------------------------------------------------ #
    # Reads for the API
    # ------------------------------------------------------------------ #

    @classmethod
    def list_runs(cls, policy, limit=200):
        from app.models.backup_run import BackupRun
        runs = (BackupRun.query.filter_by(policy_id=policy.id)
                .order_by(BackupRun.started_at.desc()).limit(limit).all())
        return [r.to_dict() for r in runs]

    @classmethod
    def get_run(cls, policy, run_id):
        from app.models.backup_run import BackupRun
        return BackupRun.query.filter_by(id=run_id, policy_id=policy.id).first()

    @classmethod
    def verify_run(cls, policy, run_id):
        """Verify a run's remote copy (size + checksum) and persist the result."""
        run = cls.get_run(policy, run_id)
        if not run:
            raise BackupPolicyError('Backup not found')
        if not run.remote_key:
            raise BackupPolicyError('This backup has no remote copy to verify')
        from app.services.storage_provider_service import StorageProviderService
        local = (run.get_metadata() or {}).get('remote_source') or run.storage_path
        result = StorageProviderService.verify_file(run.remote_key, local)
        run.verified = bool(result.get('verified'))
        db.session.commit()
        return {'success': True, 'verified': run.verified, 'detail': result}

    @classmethod
    def delete_run(cls, policy, run_id):
        """Delete a backup run: local files, remote copy, and the row."""
        run = cls.get_run(policy, run_id)
        if not run:
            raise BackupPolicyError('Backup not found')
        # Local files
        path = run.storage_path
        try:
            if path and os.path.exists(path):
                if os.path.isdir(path):
                    shutil.rmtree(path, ignore_errors=True)
                else:
                    os.remove(path)
        except OSError as exc:
            logger.warning('Failed to delete backup files at %s: %s', path, exc)
        # Remote copy
        if run.remote_key:
            try:
                from app.services.storage_provider_service import StorageProviderService
                StorageProviderService.delete_file(run.remote_key)
            except Exception as exc:  # best-effort
                logger.warning('Failed to delete remote backup %s: %s', run.remote_key, exc)
        db.session.delete(run)
        db.session.commit()
        return True

    @classmethod
    def serialize_policy_view(cls, policy):
        """Full payload for the protection panel: policy + status + projection."""
        from sqlalchemy import func
        from app.models.backup_run import BackupRun
        from app.services.backup_cost_service import BackupCostService

        last_run = (BackupRun.query.filter_by(policy_id=policy.id)
                    .order_by(BackupRun.started_at.desc()).first())

        # Average size of recent successful runs → drives the projection.
        recent_sizes = [r.size_local or 0 for r in (
            BackupRun.query.filter_by(policy_id=policy.id, status='success')
            .order_by(BackupRun.started_at.desc()).limit(10).all()
        )]
        avg_size = (sum(recent_sizes) / len(recent_sizes)) if recent_sizes else (policy.last_size or 0)

        totals = db.session.query(
            func.coalesce(func.sum(BackupRun.size_local), 0),
            func.coalesce(func.sum(BackupRun.size_remote), 0),
        ).filter(BackupRun.policy_id == policy.id).first()
        storage_used = int((totals[0] or 0) + (totals[1] or 0))

        scheduled = cls._scheduled_job(policy)
        next_run = scheduled.next_run_at if (scheduled and scheduled.enabled and policy.enabled) else None

        monthly = BackupCostService.project_monthly_cost(policy, avg_size)

        return {
            'policy': policy.to_dict(),
            'last_run': last_run.to_dict() if last_run else None,
            'next_run_at': next_run.isoformat() if next_run else None,
            'monthly_cost': float(monthly),
            'monthly_cost_display': BackupCostService.format_cost(monthly),
            'storage_used': storage_used,
            'storage_used_human': format_bytes(storage_used),
            'remote_configured': BackupCostService.configured_remote_provider() is not None,
            'is_running': cls.is_running(policy),
            'restore_proof': cls._restore_proof_view(policy),
        }

    # ------------------------------------------------------------------ #
    # Restore-proof view (plan 23 Phase 3) — the "last proven restore" badge
    # ------------------------------------------------------------------ #

    # A drilled policy reads as "stale" once its last successful drill is older
    # than this multiple of the cadence interval.
    _DRILL_STALE_MULT = 1.5

    @classmethod
    def _drill_badge(cls, policy):
        """One-word restore-proof state from the policy's drill cache.

        ``never`` | ``failed`` | ``skipped`` | ``unknown`` | ``stale`` | ``ok``.

        **``ok`` must be positively earned.** This used to return ``ok`` for any
        status that was not literally ``'failed'``, so a drill skipped for lack
        of scratch space — which records ``skipped_no_space`` and stamps
        ``last_drill_at`` — fell through every branch and the doctor reported
        "A recent restore drill proved this backup restores." A drill that never
        ran had become proof that the backup restores.

        It also self-perpetuated: each skip refreshed ``last_drill_at``, so a
        policy permanently short of scratch space could never even go ``stale``.

        Staleness is only meaningful for a drill that actually succeeded, so it
        is evaluated after the status is known good.
        """
        if not policy.last_drill_at:
            return 'never'

        status = policy.last_drill_status
        if status == 'failed':
            return 'failed'
        if status == 'skipped_no_space':
            return 'skipped'
        if status != 'success':
            # An unrecognised status is not evidence of anything. Reporting it
            # as ok is how this went wrong the first time.
            return 'unknown'

        from app.services.backup_drill_service import CADENCE_DAYS
        days = CADENCE_DAYS.get(policy.drill_cadence or 'off')
        if days is not None:
            threshold = timedelta(days=days * cls._DRILL_STALE_MULT)
            if (datetime.utcnow() - policy.last_drill_at) > threshold:
                return 'stale'
        return 'ok'

    @classmethod
    def _restore_proof_view(cls, policy, drill_limit=5):
        """Restore-proof projection for the protection panel: the drill cadence,
        the current badge (never/ok/stale/failed), and the most recent drill
        rows serialized."""
        from app.models.restore_drill import RestoreDrill
        recent = (RestoreDrill.query
                  .filter_by(policy_id=policy.id)
                  .order_by(RestoreDrill.started_at.desc())
                  .limit(drill_limit).all())
        return {
            'drill_cadence': policy.drill_cadence or 'off',
            'badge': cls._drill_badge(policy),
            'recent_drills': [d.to_dict() for d in recent],
        }

    # ------------------------------------------------------------------ #
    # Notifications (best-effort)
    # ------------------------------------------------------------------ #

    @staticmethod
    def _notify(event, name, data):
        try:
            from app.plugins_sdk import notify
            notify.send(event, to='admins', data=data, category='backups')
        except Exception as exc:  # never let a notification failure break a backup
            logger.debug('notify %s failed: %s', event, exc)

    # ------------------------------------------------------------------ #
    # Registration
    # ------------------------------------------------------------------ #

    @classmethod
    def register_jobs(cls):
        """Register the policy backup + restore handlers with the job registry.
        Called once at app startup (see app/__init__.py)."""
        from app.jobs import registry
        registry.register(BACKUP_POLICY_JOB_KIND, cls.run_backup_policy_job, replace=True)
        registry.register(RESTORE_JOB_KIND, cls.run_restore_job, replace=True)
