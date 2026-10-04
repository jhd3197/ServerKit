"""A/B slot deploys for apps (plan 87 §B).

The panel's own updater builds the new version into the idle slot while the
live one serves, flips a symlink, health-checks, and flips back if the check
fails. This is the same idea for the apps ServerKit runs:

1. the new release boots in the IDLE slot, on its own loopback port, while
   the live slot keeps serving;
2. it must pass the health gate there (§A3) — a release that never becomes
   healthy is torn down and the site never noticed;
3. the switch is ``app.port = <idle slot port>`` + ``write_app_vhost`` (which
   runs ``nginx -t`` and restores the old vhost on failure) — so every reader
   of ``app.port`` follows without knowing slots exist;
4. a watch window keeps probing after the switch and switches back on its own
   if the release falls over under real traffic;
5. the old slot stays running as a warm standby for an instant switch back,
   then is stopped (not removed) by the standby sweep.

One live copy per app, always: no load balancer, no replicas, no canaries.

Container names: slot containers are ``serverkit-slot-<id>-<a|b>``. Not
``serverkit-app-<id>-<x>``: that prefix belongs to Procfile workers, and the
worker deploy removes everything under it. An app adopted into slots keeps its
existing ``serverkit-app-<id>`` container as slot ``a`` until slot ``a`` is
next deployed into.
"""
import logging
import os
import time
from datetime import datetime, timedelta
from typing import Callable, Dict, Optional

from app import db
from app.models.app_slot import AppSlot, SLOTS, other
from app.services import deploy_settings, health_gate
from app.services.health_gate import HealthGateError

logger = logging.getLogger(__name__)

# Seams the tests replace, so a watch window does not take a real minute.
_sleep = time.sleep
_clock = time.monotonic
_now = datetime.utcnow

WATCH_INTERVAL = 2.0
WATCH_FAILURES = 3          # consecutive failed probes that trigger a revert
REVERT_CHECK_TIMEOUT = 20   # the restored slot must answer within this
NGINX_PROBE_URL = 'http://127.0.0.1/'   # host nginx, asked with the site's Host header


def slot_container_name(app, slot: str) -> str:
    return f'serverkit-slot-{app.id}-{slot}'


def legacy_container_name(app) -> str:
    """What the in-place deploy (and an adopted slot ``a``) calls the container."""
    return f'serverkit-app-{app.id}'


def live_container_name(app) -> str:
    """The container that is serving ``app`` right now (slot-aware)."""
    if getattr(app, 'slot_deploys_enabled', False) and getattr(app, 'active_slot', None):
        row = AppSlot.query.filter_by(application_id=app.id, slot=app.active_slot).first()
        if row and row.container_name:
            return row.container_name
    return legacy_container_name(app)


def _compose_files(slot: AppSlot):
    """The file(s) a compose slot's project was brought up from."""
    from app.services import slot_compose_service as sc
    app = slot.application
    if slot.project_name == sc.original_project(app):
        return [os.path.join(app.root_path, app.compose_file)]
    return [sc.slot_file(app, slot.slot)]


def _slot_start(slot: AppSlot) -> bool:
    from app.services.docker_service import DockerService
    if slot.project_name:
        from app.services import slot_compose_service as sc
        return bool(sc.compose(slot.project_name, _compose_files(slot), 'start',
                               cwd=slot.application.root_path).get('success'))
    if not slot.container_name:
        return False
    return bool(DockerService.start_container(slot.container_name).get('success'))


def _slot_stop(slot: AppSlot) -> None:
    from app.services.docker_service import DockerService
    if slot.project_name:
        from app.services import slot_compose_service as sc
        sc.compose(slot.project_name, _compose_files(slot), 'stop', cwd=slot.application.root_path)
    elif slot.container_name:
        DockerService.stop_container(slot.container_name)


def _slot_remove(slot: AppSlot) -> None:
    """Remove a slot's containers. Never its volumes: those are shared."""
    from app.services.docker_service import DockerService
    if slot.project_name:
        from app.services import slot_compose_service as sc
        sc.compose(slot.project_name, _compose_files(slot), 'down', '--remove-orphans',
                   cwd=slot.application.root_path)
    elif slot.container_name:
        DockerService.stop_container(slot.container_name)
        DockerService.remove_container(slot.container_name)


def _restorable(app):
    from app.services import release_phase_service
    return release_phase_service.restorable(app)


class SlotDeployError(RuntimeError):
    pass


def _log(log, line):
    logger.info(line)
    if log:
        try:
            log(line)
        except Exception:  # noqa: BLE001 - a log sink never breaks a deploy
            pass


def _notify(event, app, severity, message, **extra):
    try:
        from app.plugins_sdk import notify
        notify.send(event, to='admins', severity=severity,
                    data={'app': app.name, 'app_id': app.id, 'message': message, **extra})
    except Exception as exc:  # noqa: BLE001 - notification is best-effort
        logger.warning('could not send %s for app %s: %s', event, app.id, exc)


class SlotDeployService:

    @staticmethod
    def live_app(app_id):
        from app.models.application import Application
        return Application.query_active().filter_by(id=app_id).first()

    # ------------------------------------------------------------------ #
    # Eligibility (shown in the UI with its reasons; re-checked per deploy)
    # ------------------------------------------------------------------ #
    @classmethod
    def eligibility(cls, app) -> Dict:
        from app.services.deployment_service import DeploymentService
        reasons, warnings = [], []
        compose = DeploymentService._uses_compose(app)
        mode = 'compose' if compose else 'container'

        if app.server_id:
            reasons.append('Runs on a remote server. Slot deploys need the agent to '
                           'support them first; this app keeps in-place deploys.')
        if app.app_type != 'docker':
            reasons.append(f'A {app.app_type} app is served by nginx or systemd directly, '
                           'not from a container, so there is no second copy to boot.')
        if (app.ingress_plane or 'nginx') != 'nginx':
            reasons.append('Served by the proxy stack. Slots switch traffic in host nginx.')
        if not app.port:
            reasons.append('Has no port for nginx to route to.')
        if not (app.live_domains or app.private_url_enabled):
            reasons.append('Not published on a domain or private URL. Slots switch traffic '
                           'in nginx, and an app reached on its raw port would lose it.')

        split_needed = False
        if compose and not reasons:
            from app.services import slot_compose_service
            verdict = slot_compose_service.eligibility(app)
            reasons.extend(verdict['reasons'])
            warnings.extend(verdict['warnings'])
            split_needed = verdict.get('split_needed', False)
        elif compose:
            pass
        elif app.volumes:
            settings = deploy_settings.effective(app)
            names = ', '.join(sorted(v.name for v in app.volumes))
            if settings['slot_volumes_confirmed']:
                warnings.append(f'Both slots mount the same volumes ({names}) for a few '
                                'seconds around each switch. You confirmed the app handles it.')
            else:
                reasons.append(f'Both slots would mount the same volumes ({names}) for a few '
                               'seconds around each switch. Something like SQLite breaks when '
                               'two processes write to it; confirm the app handles it to enable.')
        return {'eligible': not reasons, 'mode': mode, 'reasons': reasons, 'warnings': warnings,
                'split_needed': split_needed}

    # ------------------------------------------------------------------ #
    # Slot rows
    # ------------------------------------------------------------------ #
    @classmethod
    def slots(cls, app) -> Dict[str, AppSlot]:
        rows = {row.slot: row for row in AppSlot.query.filter_by(application_id=app.id).all()}
        for slot in SLOTS:
            if slot not in rows:
                rows[slot] = AppSlot(application_id=app.id, slot=slot, state='empty')
                db.session.add(rows[slot])
        return rows

    @classmethod
    def adopt(cls, app) -> Dict[str, AppSlot]:
        """Make the app's current container slot ``a``, in place (no restart).

        Its next deploy goes to ``b``. Idempotent: an app that already has an
        active slot is returned as it is.
        """
        from app.models.deployment import Deployment
        from app.services.docker_service import DockerService

        from app.services.deployment_service import DeploymentService
        rows = cls.slots(app)
        if app.active_slot in SLOTS:
            db.session.commit()
            return rows
        if DeploymentService._uses_compose(app):
            return cls._adopt_compose(app, rows)
        a = rows['a']
        a.host_port = app.port
        a.container_port = app.port
        a.container_name = legacy_container_name(app)
        a.image_ref = app.docker_image
        current = Deployment.get_current(app.id)
        if current:
            a.deployment_id = current.id
            a.commit_sha = current.commit_hash
            a.image_ref = current.image_tag or a.image_ref
        info = DockerService.get_container(a.container_name)
        running = bool(info and (info.get('State') or {}).get('Running'))
        a.state = 'live' if running else ('stopped' if info else 'empty')
        a.started_at = _now() if running else None
        app.active_slot = 'a'
        db.session.commit()
        return rows

    @classmethod
    def _adopt_compose(cls, app, rows) -> Dict[str, AppSlot]:
        """The compose project running today becomes slot a, untouched."""
        from app.models.deployment import Deployment
        from app.services import slot_compose_service as sc
        config, error = sc.merged_config(app)
        if config is None:
            raise SlotDeployError(f'Could not read the compose file: {error}')
        web, target = sc.web_service(config, app.port)
        if not web:
            raise SlotDeployError(f'No service publishes port {app.port}.')
        deploy_settings.set_internal(app, 'compose_web', web)
        deploy_settings.set_internal(app, 'compose_web_port', app.port)
        a = rows['a']
        a.project_name = sc.original_project(app)
        a.host_port = app.port
        a.container_port = target
        found = sc.project_containers(a.project_name, web)
        a.container_name = found[0]['name'] if found else None
        running = bool(found and found[0]['state'] == 'running')
        a.state = 'live' if running else ('stopped' if found else 'empty')
        a.started_at = _now() if running else None
        current = Deployment.get_current(app.id)
        if current:
            a.deployment_id = current.id
            a.commit_sha = current.commit_hash
        a.image_ref = f'compose:d{current.id}' if current else None
        app.active_slot = 'a'
        db.session.commit()
        return rows

    @classmethod
    def status(cls, app) -> Dict:
        rows = {row.slot: row for row in AppSlot.query.filter_by(application_id=app.id).all()}
        return {
            'enabled': bool(app.slot_deploys_enabled),
            'active_slot': app.active_slot,
            'eligibility': cls.eligibility(app),
            'volumes': sorted(v.name for v in app.volumes),
            'restorable_db': _restorable(app),
            'slots': [rows[s].to_dict() for s in SLOTS if s in rows],
        }

    @classmethod
    def set_enabled(cls, app, enabled: bool) -> Dict:
        """Opt in (adopting the current container as slot a) or out."""
        if enabled:
            verdict = cls.eligibility(app)
            if not verdict['eligible']:
                return {'success': False, 'error': verdict['reasons'][0],
                        'eligibility': verdict}
            app.slot_deploys_enabled = True
            db.session.commit()
            try:
                cls.adopt(app)
            except SlotDeployError as exc:
                app.slot_deploys_enabled = False
                db.session.commit()
                return {'success': False, 'error': str(exc)}
            return {'success': True, 'slots': cls.status(app)}
        if deploy_settings.get(app, 'compose_data_split'):
            return {'success': False,
                    'error': 'This service\'s stateful containers live in a shared data project now; '
                             'it keeps deploying through slots.'}
        # Opting out keeps the slots until the next deploy, which goes back to
        # the in-place path and folds them away (release_slots).
        app.slot_deploys_enabled = False
        db.session.commit()
        return {'success': True, 'slots': cls.status(app),
                'note': 'The next deploy replaces the app in place again.'}

    @classmethod
    def switch_back(cls, app, user_id=None, log=None) -> Dict:
        """Make the standby live again: a rollback to the release it holds.

        It goes through ``DeploymentService.rollback`` so history, the deploy
        lock and the health gate all apply; the slot engine sees the standby
        already holds that image and restarts it instead of rebuilding.
        """
        from app.services.deployment_service import DeploymentService
        if not app.slot_deploys_enabled or app.active_slot not in SLOTS:
            return {'success': False, 'error': 'Slot deploys are not on for this service.'}
        standby = AppSlot.query.filter_by(application_id=app.id,
                                          slot=other(app.active_slot)).first()
        if (standby is None or standby.state not in ('standby', 'stopped')
                or standby.deployment is None):
            return {'success': False,
                    'error': 'There is no standby to switch back to. Roll back to an '
                             'earlier deployment from the history instead.'}
        return DeploymentService.rollback(app.id, target_version=standby.deployment.version,
                                          user_id=user_id, log_callback=log)

    @classmethod
    def plan_steps(cls, app):
        """The Deploy Console stages of a slot deploy, or None for an app
        that deploys in place. PipelineStrip renders ``job.plan.steps`` as is."""
        if not app.slot_deploys_enabled:
            return None
        idle = other(app.active_slot) if app.active_slot in SLOTS else 'b'
        return ['Preflight', 'Build', 'Snapshot', 'Release', f'Boot slot {idle.upper()}',
                'Health gate', 'Switch', 'Watch']

    @classmethod
    def restore_databases(cls, app, deployment_id) -> Dict:
        """Put the app's databases back to before ``deployment_id``'s release."""
        from app.models.deployment import Deployment
        from app.services import release_phase_service
        from app.services.deploy_lock import deploy_lock
        deployment = Deployment.query.filter_by(id=deployment_id, app_id=app.id).first()
        if deployment is None:
            return {'success': False, 'error': 'Deployment not found'}
        with deploy_lock(app.id, 'database restore'):
            result = release_phase_service.restore_databases(app, deployment)
        if result.get('success'):
            deployment.update_metadata('db_restored_at', _now().isoformat())
            db.session.commit()
        return result

    @classmethod
    def protected_images(cls, app) -> set:
        return {row.image_ref for row in AppSlot.query.filter_by(application_id=app.id).all()
                if row.image_ref}

    # ------------------------------------------------------------------ #
    # Deploy (single container)
    # ------------------------------------------------------------------ #
    @classmethod
    def deploy_container(cls, app, deployment, image: str, env: Dict, volumes,
                         log: Optional[Callable[[str], None]] = None,
                         stage: Optional[Callable[[str], None]] = None) -> Dict:
        """Boot ``image`` in the idle slot, gate it, switch, watch.

        Returns the usual ``{'success', ...}``. A failure carries
        ``still_serving`` when the previous release never stopped serving —
        which is every failure except a revert whose restored slot did not
        answer.
        """
        from app.services.docker_service import DockerService
        from app.services.worker_process_service import (
            WorkerProcessService, connect_shared_network)

        from app.services import deploy_stages
        stage = stage or deploy_stages.mark
        rows = cls.adopt(app)
        live = rows[app.active_slot]
        idle = rows[other(app.active_slot)]
        container_port = live.container_port or app.port
        version = f'v{live.deployment.version}' if live.deployment else 'the previous release'

        # A rollback to the release the standby still holds: no new container,
        # just (re)start it, gate it and switch. Seconds, not a rebuild.
        reuse = (idle.image_ref == image and idle.state in ('standby', 'stopped')
                 and idle.container_name and DockerService.get_container(idle.container_name))

        # ---- snapshot + release (§D): once, before the switch, old slot live
        from app.services import release_phase_service as release
        stage('Snapshot')
        release.snapshot_databases(app, deployment, log)
        stage('Release')
        old_stopped = False
        command, source = release.resolve_release_command(app)
        if command and (reuse or getattr(deployment, 'deploy_trigger', None) == 'rollback'):
            # Rolling code back never re-runs migrations; the DB stays as it is.
            _log(log, f'Rollback: not running the release command ({source}).')
            command = None
        if command:
            if deploy_settings.get(app, 'stop_old_before_release'):
                _log(log, f'Stopping slot {live.slot.upper()} before the release command, as this '
                          'app is set to: the site is down until the new release passes its '
                          'health check.')
                _slot_stop(live)
                old_stopped = True
            ran = release.run_release(app, image, env, volumes, command, log)
            deployment.update_metadata('release_ran', True)
            db.session.commit()
            if not ran['success']:
                return cls._abort(app, live, old_stopped,
                                  f"The release command ({source}) failed: {ran['error']}. "
                                  f'The new release was not started; the site is still serving {version}.')

        name = idle.container_name if reuse else slot_container_name(app, idle.slot)
        stage(f'Boot slot {idle.slot.upper()}')
        if reuse:
            _log(log, f'Slot {idle.slot.upper()} still holds this release; starting it again...')
            started = DockerService.start_container(name)
            if not started.get('success'):
                reuse = False
        if not reuse:
            if not idle.host_port or idle.host_port == live.host_port:
                idle.host_port = cls._pick_port(app, exclude={live.host_port, app.port})
            for stale in {idle.container_name, slot_container_name(app, idle.slot)} - {None}:
                if stale != live.container_name and DockerService.get_container(stale):
                    DockerService.stop_container(stale)
                    DockerService.remove_container(stale)
            name = slot_container_name(app, idle.slot)
            _log(log, f'Booting slot {idle.slot.upper()} on 127.0.0.1:{idle.host_port} '
                      f'while slot {live.slot.upper()} keeps serving...')
        idle.container_port = container_port
        idle.container_name = name
        idle.image_ref = image
        idle.deployment_id = deployment.id
        idle.commit_sha = getattr(deployment, 'commit_hash', None)
        idle.state = 'booting'
        idle.standby_until = None
        db.session.commit()

        if not reuse:
            run = DockerService.run_container(
                image=image, name=name,
                ports=[f'127.0.0.1:{idle.host_port}:{container_port}'],
                volumes=volumes or None, env=env or None,
                restart_policy='unless-stopped', detach=True)
            if not run.get('success'):
                idle.state = 'failed'
                idle.last_health = (run.get('error') or 'did not start')[:255]
                db.session.commit()
                return cls._abort(app, live, old_stopped,
                                  f"The new release did not start: {run.get('error')}. "
                                  f'The site is still serving {version}.')
            connect_shared_network(app, name)

        failed = cls._bring_live(app, live, idle, name, reuse, old_stopped, version, log, stage)
        if failed:
            return failed
        workers = WorkerProcessService.deploy(app, image, env, volumes, log=log)
        return {'success': True, 'slot': idle.slot, 'workers': workers, 'container_id': name}

    @classmethod
    def _bring_live(cls, app, live, idle, container, reuse, old_stopped, version, log, stage):
        """Gate the booted idle slot, switch to it, watch it, retire the old
        one to standby. None on success, else the failure result."""
        stage('Health gate')
        try:
            result = health_gate.gate_for_app(app, port=idle.host_port, container=container,
                                              log=lambda line: _log(log, line))
            idle.last_health = f"{result['status']} on {result['url']}"[:255]
        except HealthGateError as exc:
            cls._discard(idle, str(exc), remove=not reuse)
            return cls._abort(app, live, old_stopped,
                              f'The new release never became healthy: {exc}. '
                              f'The site is still serving {version}.', log=log)
        idle.state = 'healthy'
        db.session.commit()

        stage('Switch')
        switched = cls._switch(app, idle, live, log)
        if not switched['success']:
            cls._discard(idle, switched['error'], remove=not reuse)
            return cls._abort(app, live, old_stopped,
                              f"Could not switch traffic: {switched['error']}. "
                              f'The site is still serving {version}.')

        stage('Watch')
        watched = cls._watch(app, idle, log)
        if not watched['success']:
            reverted = cls._revert(app, bad=idle, good=live, reason=watched['error'], log=log,
                                   remove=not reuse)
            return {'success': False, 'still_serving': reverted, 'deployment_status': 'rolled_back',
                    'error': (f"The new release failed after the switch ({watched['error']}) and "
                              + (f'traffic went back to {version}.' if reverted
                                 else 'switching back FAILED — the site may be down.'))}

        cls._make_standby(app, live, log)
        return None

    # ------------------------------------------------------------------ #
    # Deploy (compose, §C)
    # ------------------------------------------------------------------ #
    @classmethod
    def deploy_compose(cls, app, deployment, log=None, stage=None, reuse_standby=False) -> Dict:
        """The compose project booted as ``<name>-<idle slot>`` beside the live
        one, then the same gate / switch / watch / standby as a container.

        The caller has already run the compose preflight (validate, build,
        pull) against the app's own compose file while the live slot served.
        """
        from app.services import deploy_stages, release_phase_service as release
        from app.services import slot_compose_service as sc

        stage = stage or deploy_stages.mark
        rows = cls.adopt(app)       # SlotDeployError: nothing was touched yet
        live = rows[app.active_slot]
        idle = rows[other(app.active_slot)]
        version = f'v{live.deployment.version}' if live.deployment else 'the previous release'

        reuse = bool(reuse_standby and idle.state in ('standby', 'stopped') and idle.project_name
                     and sc.project_containers(idle.project_name))
        if not reuse:
            config, error = sc.merged_config(app)
            if config is None:
                return cls._abort(app, live, False, f'Could not read the compose file: {error}. '
                                                    f'The site is still serving {version}.')
            web = deploy_settings.get(app, 'compose_web')
            if web not in (config.get('services') or {}):
                return cls._abort(app, live, False,
                                  f'The compose file no longer has the web service {web!r}. '
                                  f'The site is still serving {version}.')
            split = bool(deploy_settings.get(app, 'compose_data_split'))
            if not idle.host_port or idle.host_port == live.host_port:
                idle.host_port = cls._pick_port(app, exclude={live.host_port, app.port})
            container_port = live.container_port
            tags = {name: f'serverkit-app-{app.id}-{name}:d{deployment.id}'
                    for name, service in config['services'].items()
                    if service.get('build') and not (split and name in sc.classify(config, web)[1])}
            rendered = sc.render_slot(app, config, web, idle.host_port, container_port, tags,
                                      with_data_network=split)
            project = sc.slot_project(app, idle.slot)
            path = sc.slot_file(app, idle.slot)
            sc.write(path, rendered)
            if tags:
                stage('Build')
                built = sc.compose(project, [path], 'build', cwd=app.root_path)
                if not built.get('success'):
                    return cls._abort(app, live, False,
                                      f"Building the slot images failed: {built.get('error')}. "
                                      f'The site is still serving {version}.')

        # ---- snapshot + release, once, before the switch
        stage('Snapshot')
        release.snapshot_databases(app, deployment, log)
        stage('Release')
        old_stopped = False
        command, source = release.resolve_release_command(app)
        if command and (reuse or getattr(deployment, 'deploy_trigger', None) == 'rollback'):
            _log(log, f'Rollback: not running the release command ({source}).')
            command = None
        if command:
            if deploy_settings.get(app, 'stop_old_before_release'):
                _log(log, f'Stopping slot {live.slot.upper()} before the release command, as this '
                          'app is set to: the site is down until the new release passes its '
                          'health check.')
                _slot_stop(live)
                old_stopped = True
            _log(log, f'Running release command in a one-off {web} container: {command}')
            ran = sc.compose(project, [path], 'run', '--rm', '--no-deps', web, 'sh', '-c', command,
                             cwd=app.root_path, timeout=release.RELEASE_TIMEOUT)
            for line in (ran.get('output') or '').splitlines()[-40:]:
                _log(log, line)
            deployment.update_metadata('release_ran', True)
            db.session.commit()
            if not ran.get('success'):
                return cls._abort(app, live, old_stopped,
                                  f"The release command ({source}) failed: {ran.get('error')}. "
                                  f'The new release was not started; the site is still serving {version}.')

        stage(f'Boot slot {idle.slot.upper()}')
        if reuse:
            _log(log, f'Slot {idle.slot.upper()} still holds this release; starting it again...')
            if not _slot_start(idle):
                return cls._abort(app, live, old_stopped,
                                  f'The standby in slot {idle.slot.upper()} would not start. '
                                  f'The site is still serving {version}.')
        else:
            # Whatever the idle slot ran before (an older release, or the
            # adopted in-place project) makes way; the live slot is untouched.
            if idle.project_name and idle.project_name != live.project_name:
                _slot_remove(idle)
            _log(log, f'Booting slot {idle.slot.upper()} ({project}) on 127.0.0.1:{idle.host_port} '
                      f'while slot {live.slot.upper()} keeps serving...')
            up = sc.compose(project, [path], 'up', '-d', '--no-build', '--remove-orphans',
                            cwd=app.root_path)
            idle.project_name = project
            idle.container_port = container_port
            if not up.get('success'):
                idle.state = 'failed'
                idle.last_health = (up.get('error') or 'did not start')[:255]
                db.session.commit()
                _slot_remove(idle)
                return cls._abort(app, live, old_stopped,
                                  f"The new release did not start: {up.get('error')}. "
                                  f'The site is still serving {version}.')
            web_rows = sc.project_containers(project, web)
            idle.container_name = web_rows[0]['name'] if web_rows else None
            idle.image_ref = f'compose:d{deployment.id}'
        idle.deployment_id = deployment.id
        idle.commit_sha = getattr(deployment, 'commit_hash', None)
        idle.state = 'booting'
        idle.standby_until = None
        db.session.commit()

        failed = cls._bring_live(app, live, idle, idle.container_name, reuse, old_stopped,
                                 version, log, stage)
        if failed:
            return failed
        return {'success': True, 'slot': idle.slot, 'container_id': idle.container_name}

    @classmethod
    def rollback_compose(cls, app, target, rollback_deployment, log=None) -> Dict:
        """Roll a compose slot app back: the warm/stopped standby when it holds
        ``target``, otherwise a slot deploy of ``target``'s commit."""
        from app.services.deployment_service import DeploymentService
        idle = AppSlot.query.filter_by(application_id=app.id,
                                       slot=other(app.active_slot or 'a')).first()
        if idle is not None and idle.deployment_id == target.id:
            return cls.deploy_compose(app, rollback_deployment, log=log, reuse_standby=True)
        if not target.commit_hash:
            return {'success': False, 'still_serving': True,
                    'error': f'v{target.version} is not in the standby and has no commit to '
                             'rebuild from; only the standby can be switched back to.'}
        checkout = DeploymentService._checkout(app, target.commit_hash, log)
        if not checkout.get('success'):
            return {'success': False, 'still_serving': True, 'error': checkout.get('error')}
        from app.services import deploy_preflight_service as preflight
        checks = preflight.preflight_compose_project(app.root_path, app.compose_file, log=log)
        if not checks.ok:
            return {'success': False, 'still_serving': True, 'error': checks.error}
        return cls.deploy_compose(app, rollback_deployment, log=log)

    # ------------------------------------------------------------------ #
    # The one-time data split (§C)
    # ------------------------------------------------------------------ #
    @classmethod
    def compose_split_preview(cls, app) -> Dict:
        from app.services import slot_compose_service as sc
        import yaml
        config, error = sc.merged_config(app)
        if config is None:
            return {'success': False, 'error': error}
        web, target = sc.web_service(config, app.port)
        if not web:
            return {'success': False, 'error': f'No service publishes port {app.port}.'}
        _stateless, stateful = sc.classify(config, web)
        if not stateful:
            return {'success': False, 'error': 'This stack has no stateful services to move.'}
        data = sc.render_data(app, config, web)
        slot = sc.render_slot(app, config, web, 0, target, {}, with_data_network=True)
        return {'success': True, 'web': web, 'stateful': stateful,
                'data_project': sc.slot_project(app, sc.DATA),
                'data_compose': yaml.safe_dump(data, sort_keys=False),
                'slot_compose': yaml.safe_dump(slot, sort_keys=False).replace(
                    '127.0.0.1:0:', '127.0.0.1:<slot port>:'),
                'downtime': ('The app is stopped while its stateful services move to the shared '
                             'data project on the same volumes, then starts again as slot A. '
                             'Expect a short outage, once.')}

    @classmethod
    def compose_split_apply(cls, app, log=None) -> Dict:
        """Move the stateful services into ``<name>-data`` and restart the
        stateless ones as slot a. One announced outage; data stays on the same
        volumes (pinned names)."""
        from app.models.deployment import Deployment
        from app.services import slot_compose_service as sc
        from app.services.deploy_lock import deploy_lock
        from app.services.docker_service import DockerService

        with deploy_lock(app.id, 'compose split', log=log):
            preview = cls.compose_split_preview(app)
            if not preview.get('success'):
                return preview
            config, _ = sc.merged_config(app)
            web, target = sc.web_service(config, app.port)
            base_port = app.port
            data_project = sc.slot_project(app, sc.DATA)
            data_path = sc.slot_file(app, sc.DATA)
            sc.write(data_path, sc.render_data(app, config, web))
            original = sc.original_project(app)
            original_files = [os.path.join(app.root_path, app.compose_file)]

            _log(log, f'Stopping {original} (announced outage)...')
            sc.compose(original, original_files, 'down', '--remove-orphans', cwd=app.root_path)
            DockerService.ensure_network(sc.data_network(app))
            _log(log, f"Starting {data_project}: {', '.join(preview['stateful'])}...")
            up = sc.compose(data_project, [data_path], 'up', '-d', cwd=app.root_path)
            if not up.get('success'):
                DockerService.compose_up(app.root_path, detach=True, compose_file=app.compose_file)
                return {'success': False,
                        'error': f"Starting the data project failed: {up.get('error')}. "
                                 'The original stack was started again.'}

            rows = cls.slots(app)
            a = rows['a']
            a.host_port = base_port
            a.container_port = target
            project = sc.slot_project(app, 'a')
            path = sc.slot_file(app, 'a')
            sc.write(path, sc.render_slot(app, config, web, base_port, target, {},
                                          with_data_network=True))
            _log(log, f'Starting {project} as slot A...')
            up = sc.compose(project, [path], 'up', '-d', '--remove-orphans', cwd=app.root_path)
            if not up.get('success'):
                sc.compose(data_project, [data_path], 'down', cwd=app.root_path)
                DockerService.compose_up(app.root_path, detach=True, compose_file=app.compose_file)
                return {'success': False,
                        'error': f"Starting slot A failed: {up.get('error')}. "
                                 'The original stack was started again.'}
            found = sc.project_containers(project, web)
            a.project_name = project
            a.container_name = found[0]['name'] if found else None
            current = Deployment.get_current(app.id)
            a.deployment_id = current.id if current else None
            a.image_ref = f'compose:d{current.id}' if current else None
            a.state = 'live'
            a.started_at = _now()
            app.active_slot = 'a'
            app.slot_deploys_enabled = True
            app.container_id = a.container_name
            deploy_settings.set_internal(app, 'compose_data_split', True)
            deploy_settings.set_internal(app, 'compose_web', web)
            deploy_settings.set_internal(app, 'compose_web_port', base_port)
            db.session.commit()
            from app.services import container_status_service
            container_status_service.invalidate(app.id)
            return {'success': True, 'slots': cls.status(app)}

    @classmethod
    def _abort(cls, app, live: AppSlot, old_stopped: bool, message: str, log=None) -> Dict:
        """End a deploy before the switch. The live slot kept serving — unless
        the app stops it for its release, in which case it is started again."""
        serving = True
        if old_stopped:
            serving = _slot_start(live)
            if not serving:
                message += ' Starting the previous release again FAILED — the site is down.'
        _log(log, message)
        _notify('app.deploy_aborted' if serving else 'app.deploy_revert_failed', app,
                'warning' if serving else 'critical', message)
        return {'success': False, 'still_serving': serving, 'error': message}

    # ------------------------------------------------------------------ #
    # Switch / watch / revert / standby
    # ------------------------------------------------------------------ #
    @classmethod
    def _switch(cls, app, to_slot: AppSlot, from_slot: AppSlot, log=None) -> Dict:
        """Point nginx at ``to_slot``: ``app.port`` + ``write_app_vhost``.

        ``write_app_vhost`` runs ``nginx -t`` and restores the previous vhost
        when the test fails, so a failed switch leaves traffic where it was.
        """
        from app.services import container_status_service
        from app.services.site_domain_service import SiteDomainService

        previous = (app.port, app.active_slot, app.container_id)
        app.port = to_slot.host_port
        app.active_slot = to_slot.slot
        _log(log, f'Switching traffic to slot {to_slot.slot.upper()} (port {to_slot.host_port})...')
        if app.live_domains:
            result = SiteDomainService.write_app_vhost(app)
            nginx = result.get('nginx') or {}
            if result.get('warning') and not nginx.get('success'):
                app.port, app.active_slot, app.container_id = previous
                db.session.commit()
                return {'success': False, 'error': result['warning']}
            cls._reapply_vhost_extras(app)
        if app.private_url_enabled and app.private_slug:
            from app.services.nginx_service import NginxService
            private = NginxService.regenerate_all_private_urls()
            if not private.get('success'):
                logger.warning('private URL refresh after switch failed for app %s: %s',
                               app.id, private.get('error'))
        to_slot.state = 'live'
        to_slot.started_at = _now()
        app.container_id = to_slot.container_name
        db.session.commit()
        container_status_service.invalidate(app.id)
        return {'success': True}

    @staticmethod
    def _reapply_vhost_extras(app):
        """write_app_vhost regenerates from the template and drops the WAF
        include; put it back so a switch never strips protection."""
        try:
            from app.services.waf_service import WafService
            WafService.reapply_if_enforcing(app.id)
        except Exception as exc:  # noqa: BLE001 - logged; the switch stands
            logger.warning('WAF re-apply after switch failed for app %s: %s', app.id, exc)

    @classmethod
    def _watch(cls, app, slot: AppSlot, log=None) -> Dict:
        """Probe the new slot (and the site through nginx) for the watch window."""
        seconds = deploy_settings.get(app, 'watch_seconds')
        if not seconds:
            return {'success': True}
        settings = deploy_settings.effective(app)
        _log(log, f'Watching the new release for {seconds}s...')
        host = cls._primary_host(app)
        deadline = _clock() + seconds
        failures, last = 0, None
        while True:
            state, _health = health_gate.container_health(slot.container_name)
            if state in ('exited', 'dead'):
                return {'success': False, 'error': f'the container {state}'}
            ok, last = cls._probe_once(app, slot, host, settings)
            failures = 0 if ok else failures + 1
            if failures >= WATCH_FAILURES:
                return {'success': False, 'error': f'{failures} failed checks in a row ({last})'}
            if _clock() >= deadline:
                break
            _sleep(WATCH_INTERVAL)
        slot.last_health = f'watch passed ({last})'[:255]
        db.session.commit()
        _log(log, 'Watch window passed.')
        return {'success': True}

    @staticmethod
    def _probe_once(app, slot, host, settings):
        direct = f'http://127.0.0.1:{slot.host_port}{health_gate.normalize_path(app.healthcheck_path)}'
        status, error = health_gate.probe(direct)
        if not health_gate.status_passes(status, settings['healthcheck_allow_4xx']):
            return False, f'{direct} -> {status or error}'
        if host:
            # Through nginx with the site's Host header: a 502/504 here means
            # the switch routed traffic somewhere that does not answer. A 3xx
            # (the HTTPS redirect) or 4xx is nginx and the app talking.
            via, error = health_gate.probe(NGINX_PROBE_URL, host_header=host)
            if via is None or via >= 500:
                return False, f'{host} via nginx -> {via or error}'
        return True, status

    @staticmethod
    def _primary_host(app):
        domains = app.live_domains
        primary = next((d for d in domains if d.is_primary), domains[0] if domains else None)
        return primary.name if primary else None

    @classmethod
    def _revert(cls, app, bad: AppSlot, good: AppSlot, reason: str, log=None,
                remove: bool = True) -> bool:
        """Switch back to ``good`` and confirm it answers. True when it does."""
        _log(log, f'Release failed after the switch ({reason}); switching back to slot '
                  f'{good.slot.upper()}...')
        _slot_start(good)
        switched = cls._switch(app, good, bad, log)
        answered = False
        if switched['success']:
            try:
                health_gate.gate_for_app(app, port=good.host_port, container=good.container_name,
                                         consecutive=1, timeout=REVERT_CHECK_TIMEOUT)
                answered = True
            except HealthGateError as exc:
                reason = f'{reason}; the restored slot did not answer either: {exc}'
        cls._discard(bad, reason, remove=remove)
        if answered:
            _notify('app.deploy_reverted', app, 'warning',
                    f'The new release of {app.name} failed after going live ({reason}). '
                    'Traffic was switched back to the previous release automatically.')
        else:
            _notify('app.deploy_revert_failed', app, 'critical',
                    f'The new release of {app.name} failed after going live and switching back '
                    f'did not bring the previous release back ({reason}). The site may be down.')
        return answered

    @classmethod
    def _discard(cls, slot: AppSlot, reason: str, remove: bool = True):
        """Take a failed slot out of the way. It never served traffic, so
        removing it loses nothing; a reused standby is only stopped."""
        if remove:
            _slot_remove(slot)
        else:
            _slot_stop(slot)
        slot.state = 'failed'
        slot.last_health = (reason or '')[:255]
        db.session.commit()

    @classmethod
    def _make_standby(cls, app, slot: AppSlot, log=None):
        minutes = deploy_settings.get(app, 'standby_warm_minutes')
        slot.state = 'standby'
        slot.standby_until = _now() + timedelta(minutes=minutes)
        db.session.commit()
        if minutes <= 0:
            cls._stop_standby(slot)
        else:
            _log(log, f'Slot {slot.slot.upper()} stays warm for {minutes} min for an instant '
                      'switch back.')

    @staticmethod
    def _stop_standby(slot: AppSlot):
        _slot_stop(slot)
        slot.state = 'stopped'
        slot.standby_until = None
        db.session.commit()

    @staticmethod
    def is_compose_slot_app(app) -> bool:
        """A local compose app whose live release is a slot project."""
        return bool(getattr(app, 'slot_deploys_enabled', False) and getattr(app, 'active_slot', None)
                    and getattr(app, 'compose_file', None) and not getattr(app, 'server_id', None))

    @classmethod
    def live_action(cls, app, action: str) -> Dict:
        """start / stop / restart the live slot's compose project. Stopping
        the app also stops its warm standby."""
        from app.services import slot_compose_service as sc
        live = AppSlot.query.filter_by(application_id=app.id, slot=app.active_slot).first()
        if live is None or not live.project_name:
            return {'success': False, 'error': 'The live slot has no compose project.'}
        result = sc.compose(live.project_name, _compose_files(live), action, cwd=app.root_path)
        if action == 'stop':
            cls.stop_standby(app)
        return {'success': bool(result.get('success')), 'error': result.get('error')}

    @classmethod
    def stop_standby(cls, app) -> None:
        """Stop the app's warm standby now (the app itself is being stopped)."""
        for slot in AppSlot.query.filter_by(application_id=app.id, state='standby').all():
            cls._stop_standby(slot)

    @classmethod
    def containers(cls, app) -> list:
        """The live slot, the standby and the Procfile workers, for listings.

        The live container is service ``web`` (what logs and the terminal
        open by default); the standby is listed as ``standby`` so it is visible
        but never mistaken for the release that serves.
        """
        import json
        from app.services.docker_service import DockerService
        from app.services.worker_process_service import container_prefix
        rows = AppSlot.query.filter_by(application_id=app.id).all()
        if any(r.project_name for r in rows):
            from app.services import slot_compose_service as sc
            listed = []
            for row in sorted(rows, key=lambda r: r.slot != app.active_slot):
                if not row.project_name:
                    continue
                for c in sc.project_containers(row.project_name):
                    if row.slot != app.active_slot:
                        c = {**c, 'service': f"standby-{c['service']}"}
                    listed.append(c)
            return listed
        live = live_container_name(app)
        rows = AppSlot.query.filter_by(application_id=app.id).all()
        slot_names = {r.container_name for r in rows if r.container_name}
        prefix = container_prefix(app)
        listed = DockerService.run(
            ['ps', '-a', '--filter', f'name=^serverkit-slot-{app.id}-',
             '--filter', f'name=^{legacy_container_name(app)}$',
             '--filter', f'name=^{prefix}',
             '--format', '{{json .}}'], timeout=30)
        result = []
        for line in (listed.get('output') or '').splitlines() if listed.get('success') else []:
            try:
                c = json.loads(line)
            except ValueError:
                continue
            name = c.get('Names') or ''
            if name == live:
                service = 'web'
            elif name in slot_names:
                service = 'standby'
            elif name.startswith(prefix):
                service = name[len(prefix):]
            else:
                continue        # a stale slot container no row points at
            result.append({'id': c.get('ID'), 'name': name, 'service': service,
                           'state': (c.get('State') or '').lower()})
        order = {'web': 0, 'standby': 2}
        return sorted(result, key=lambda c: (order.get(c['service'], 1), c['service']))

    @classmethod
    def sweep_standby(cls) -> Dict:
        """Stop warm standbys whose time is up (a builtin periodic tick).

        Stop, not remove: a stopped standby costs disk, not RAM, and a switch
        back to it is still a start + gate away.
        """
        from app.models.application import Application
        from app.services.deploy_lock import is_locked
        deleted = Application.deleted_ids()
        due = AppSlot.query.filter(AppSlot.state == 'standby',
                                   AppSlot.standby_until.isnot(None),
                                   AppSlot.standby_until <= _now()).all()
        stopped = []
        for slot in due:
            if slot.application_id in deleted or is_locked(slot.application_id):
                continue            # a deploy in flight owns this slot now
            cls._stop_standby(slot)
            stopped.append(f'{slot.application_id}/{slot.slot}')
        return {'stopped': stopped} if stopped else {}

    # ------------------------------------------------------------------ #
    # Leaving slots (the in-place path folds them away)
    # ------------------------------------------------------------------ #
    @classmethod
    def release_slots(cls, app, log=None) -> Optional[int]:
        """Remove slot containers and rows; return the container port to
        publish in place, or None when the app never had slots."""
        from app.services.docker_service import DockerService
        rows = AppSlot.query.filter_by(application_id=app.id).all()
        if not rows:
            return None
        container_port = next((r.container_port for r in rows if r.container_port), None)
        if any(r.project_name for r in rows):
            from app.services import slot_compose_service as sc
            original = sc.original_project(app)
            for row in rows:
                if row.project_name and row.project_name != original:
                    _log(log, f'Removing slot project {row.project_name}...')
                    _slot_remove(row)
                db.session.delete(row)
            app.active_slot = None
            db.session.commit()
            return deploy_settings.get(app, 'compose_web_port')
        for row in rows:
            if row.container_name and row.container_name != legacy_container_name(app):
                if DockerService.get_container(row.container_name):
                    _log(log, f'Removing slot container {row.container_name}...')
                    DockerService.stop_container(row.container_name)
                    DockerService.remove_container(row.container_name)
            db.session.delete(row)
        app.active_slot = None
        db.session.commit()
        return container_port

    # ------------------------------------------------------------------ #
    @classmethod
    def _pick_port(cls, app, exclude=()) -> int:
        from app.services.template_service import TemplateService
        start = max(int(app.port or 8000) + 1, 1025)
        port = TemplateService._find_available_port(start_port=start)
        while port in exclude:
            port = TemplateService._find_available_port(start_port=port + 1)
        return port
