"""
Deployment Service - Orchestrates build and deploy workflows.

Supports:
- Full deployment workflow (build -> deploy)
- Deployment status tracking
- One-click rollback
- Deployment retention policies
- Diff generation between deployments
"""

import logging
import os
import subprocess
import json
import shutil
from datetime import datetime
from typing import Dict, List, Optional, Callable

from app import db
from app.utils.system import ServiceControl, run_checked
from app.models.deployment import Deployment, DeploymentDiff
from app.models.application import Application
from app.services.build_service import BuildService
from app.services.docker_service import DockerService
from app.services.git_service import GitService
from app.services import deploy_stages
from app import paths


logger = logging.getLogger(__name__)


class DeploymentService:
    """Service for orchestrating deployments."""

    DEPLOYMENT_DIR = paths.DEPLOYMENTS_DIR

    @classmethod
    def create_deployment(cls, app_id: int, user_id: int = None,
                         trigger: str = 'manual', version_tag: str = None) -> Dict:
        """Create a new deployment record."""
        # query_active: a deploy builds, writes files and restarts containers —
        # a tombstoned app must fail here rather than be redeployed.
        app = Application.query_active().filter_by(id=app_id).first()
        if not app:
            return {'success': False, 'error': 'Service not found'}

        # Get git commit info if available
        commit_hash = None
        commit_message = None
        if app.root_path:
            git_info = GitService.get_commit_info(app.root_path)
            if git_info:
                commit_hash = git_info.get('hash')
                commit_message = git_info.get('message')

        # Get build config
        build_config = BuildService.get_app_build_config(app_id)
        build_method = None
        if build_config:
            build_method = build_config.get('build_method', 'auto')
            if build_method == 'auto':
                detection = BuildService.detect_build_method(app.root_path)
                build_method = detection.get('build_method')

        # Create deployment record
        version = Deployment.get_next_version(app_id)
        deployment = Deployment(
            app_id=app_id,
            version=version,
            version_tag=version_tag or f"v{version}",
            status='pending',
            build_method=build_method,
            commit_hash=commit_hash,
            commit_message=commit_message,
            deployed_by=user_id,
            deploy_trigger=trigger
        )
        db.session.add(deployment)
        db.session.commit()

        return {
            'success': True,
            'deployment': deployment.to_dict()
        }

    @classmethod
    def deploy(cls, app_id: int, user_id: int = None,
              no_cache: bool = False,
              trigger: str = 'manual',
              version_tag: str = None,
              log_callback: Callable[[str], None] = None) -> Dict:
        """Execute a full deployment (build + deploy).

        This is the main entry point for deployments. It holds the app's deploy
        lock for the whole run, so a second deploy of the same app waits for
        this one instead of racing it (plan 87 §A5).
        """
        from app.services.deploy_lock import deploy_lock, DeployLockTimeout
        try:
            with deploy_lock(app_id, 'deploy', log=log_callback):
                return cls._deploy_locked(app_id, user_id, no_cache, trigger,
                                          version_tag, log_callback)
        except DeployLockTimeout as exc:
            return {'success': False, 'error': str(exc)}

    @classmethod
    def _deploy_locked(cls, app_id, user_id, no_cache, trigger, version_tag,
                       log_callback) -> Dict:
        # Create deployment record (inside the lock: the version number is
        # read-then-written, so two unlocked deploys could both claim vN).
        result = cls.create_deployment(app_id, user_id, trigger, version_tag)
        if not result.get('success'):
            return result

        deployment_id = result['deployment']['id']
        deployment = Deployment.query.get(deployment_id)

        app = Application.query_active().filter_by(id=app_id).first()
        build_config = BuildService.get_app_build_config(app_id)

        try:
            # Capture an immutable config snapshot at deploy start. Best-effort:
            # a snapshot failure must never block a deployment.
            try:
                from app.services.configuration_service import ConfigurationService
                ConfigurationService.create_snapshot(app, deployment)
            except Exception as snap_err:
                logger.warning('Config snapshot capture failed (deploy): %s', snap_err)

            # Update app status
            app.status = 'deploying'
            db.session.commit()

            # A Docker app deployed from Git builds its branch's latest commit:
            # "Deploy latest" and push webhooks both end up here, and building
            # the stale checkout redeployed old code. Non-Docker apps pull in
            # _deploy_traditional instead.
            if app.app_type == 'docker':
                pull_result = cls._pull_latest(app, log_callback)
                if not pull_result.get('success'):
                    return cls._fail(app, deployment, pull_result.get('error') or 'Git pull failed')
                # create_deployment read HEAD before this pull, so the row named
                # the commit that was live, not the one being deployed (§A2).
                cls._record_commit(app, deployment)

            if cls._uses_compose(app):
                # The whole compose project: build, validate and pull while
                # the current release keeps serving, then switch over.
                deployment.status = 'building'
                deployment.build_started_at = datetime.utcnow()
                db.session.commit()
                deploy_result = cls._deploy_compose(app, deployment, log_callback)
                deployment.build_completed_at = datetime.utcnow()
                if not deploy_result.get('success'):
                    return cls._fail(app, deployment, deploy_result.get('error') or 'Deploy failed',
                                     status=deploy_result.get('deployment_status', 'failed'),
                                     still_serving=bool(deploy_result.get('still_serving')))
            else:
                # Step 1: Build
                deployment.status = 'building'
                deployment.build_started_at = datetime.utcnow()
                db.session.commit()

                if log_callback:
                    log_callback(f"Starting build for {app.name}...")

                deploy_stages.mark('Build')
                # An immutable tag per deployment: a rollback then redeploys
                # the image that actually ran, not whatever :latest became (§A1).
                from app.services.app_image_retention import deploy_image_tag
                build_result = BuildService.build(
                    app_id,
                    no_cache=no_cache,
                    log_callback=log_callback,
                    image_tag=deploy_image_tag(app_id, deployment.id),
                )

                deployment.build_completed_at = datetime.utcnow()

                if not build_result.get('success'):
                    return cls._fail(app, deployment, build_result.get('error', 'Build failed'))

                # Store build artifacts
                if build_result.get('image_tag'):
                    deployment.image_tag = build_result['image_tag']

                if build_result.get('build_log'):
                    # Store build log path for later retrieval
                    log_dir = os.path.join(paths.BUILD_LOG_DIR, str(app_id))
                    log_file = f"build-{deployment.created_at.isoformat().replace(':', '-')}.json"
                    deployment.build_log_path = os.path.join(log_dir, log_file)

                db.session.commit()

                # Step 2: Deploy
                deployment.status = 'deploying'
                deployment.deploy_started_at = datetime.utcnow()
                db.session.commit()

                if log_callback:
                    log_callback("Build successful, starting deployment...")

                deploy_result = cls._deploy_application(app, deployment, log_callback)

                if not deploy_result.get('success'):
                    return cls._fail(app, deployment, deploy_result.get('error', 'Deploy failed'),
                                     status=deploy_result.get('deployment_status', 'failed'),
                                     still_serving=bool(deploy_result.get('still_serving')))

            # Mark previous live deployment as rolled_back
            current = Deployment.get_current(app_id)
            if current and current.id != deployment.id:
                current.status = 'rolled_back'

            # Update deployment status
            deployment.status = 'live'
            deployment.deploy_completed_at = datetime.utcnow()
            deployment.container_id = deploy_result.get('container_id')

            # Update app
            app.status = 'running'
            app.last_deployed_at = datetime.utcnow()
            if deployment.image_tag:
                app.docker_image = deployment.image_tag
            if deploy_result.get('container_id'):
                app.container_id = deploy_result.get('container_id')

            db.session.commit()

            # A deploy replaces containers; the cached aggregate is now about
            # containers that no longer exist. Force the next read to re-collect.
            from app.services import container_status_service
            container_status_service.invalidate(app_id)

            # Generate diff with previous deployment
            cls._generate_diff(deployment)

            # Cleanup old deployments
            if build_config:
                keep_count = build_config.get('keep_deployments', 5)
                Deployment.cleanup_old_deployments(app_id, keep_count)

            # One image per deploy is a disk leak unless something prunes it
            # (plan 85). Keeps the newest few for rollback.
            if app.app_type == 'docker' and not app.server_id:
                from app.services import app_image_retention, deploy_settings
                app_image_retention.prune(app_id, keep=deploy_settings.get(app, 'keep_images'),
                                          protect=cls._protected_images(app))

            if log_callback:
                log_callback(f"Deployment successful! Version {deployment.version} is now live.")

            # app.deployed was in the event catalog but nothing emitted it.
            # Webhook subscribers and in-process listeners (a CDN purge,
            # plan 86 §B4) hear it now. Best-effort: never fails the deploy.
            try:
                from app.services.event_service import EventService
                EventService.emit('app.deployed', {
                    'event': 'app.deployed',
                    'timestamp': datetime.utcnow().isoformat(),
                    'app_id': app.id, 'app_name': app.name,
                    'version': deployment.version, 'deployment_id': deployment.id,
                    'domains': [d.name for d in app.live_domains if d.name],
                }, user_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning('app.deployed emit failed for app %s: %s', app.id, exc)

            return {
                'success': True,
                'deployment': deployment.to_dict()
            }

        except Exception as e:
            deployment.status = 'failed'
            deployment.error_message = str(e)
            app.status = 'error'
            db.session.commit()
            return {
                'success': False,
                'error': str(e),
                'deployment': deployment.to_dict()
            }

    @classmethod
    def _fail(cls, app: Application, deployment: Deployment, error: str,
              status: str = 'failed', still_serving: bool = False) -> Dict:
        deployment.status = status
        deployment.error_message = error
        # A slot deploy that aborted before (or reverted after) the switch
        # left the previous release serving: the app is fine, the deploy
        # is not. Only a deploy that took the site down marks the app.
        app.status = 'running' if still_serving else 'error'
        db.session.commit()
        return {'success': False, 'error': error, 'still_serving': still_serving,
                'deployment': deployment.to_dict()}

    @staticmethod
    def _record_commit(app: Application, deployment: Deployment) -> None:
        """Stamp the deployment with the commit now checked out (after a pull)."""
        if not app.root_path:
            return
        info = GitService.get_commit_info(app.root_path)
        if info and info.get('hash'):
            deployment.commit_hash = info.get('hash')
            deployment.commit_message = info.get('message')
            db.session.commit()

    @staticmethod
    def _protected_images(app: Application) -> set:
        """Image refs a slot still points at (never pruned)."""
        from app.services.slot_deploy_service import SlotDeployService
        return SlotDeployService.protected_images(app)

    @staticmethod
    def _uses_compose(app: Application) -> bool:
        """A local app whose runtime is its own compose project."""
        return bool(app.compose_file and app.root_path and not app.server_id)

    @classmethod
    def _pull_latest(cls, app: Application, log_callback: Callable[[str], None] = None) -> Dict:
        """Check out the configured branch's latest commit, if deployed from Git."""
        deploy_config = GitService.get_app_config(app.id)
        if not deploy_config:
            return {'success': True, 'skipped': True}
        branch = deploy_config.get('branch') or 'main'
        if log_callback:
            log_callback(f"Pulling latest changes from {branch}...")
        return GitService.pull_changes(app.root_path, branch)

    @classmethod
    def _deploy_compose(cls, app: Application, deployment: Deployment,
                        log_callback: Callable[[str], None] = None) -> Dict:
        """Deploy an app that is a compose project (every service it declares).

        The preflight validates the file, builds and pulls every image and
        checks ports while the current release is still serving; `up -d
        --build` then recreates only the services whose image or config
        changed, so an unchanged database keeps running through a deploy.
        """
        from app.services import deploy_preflight_service as preflight

        checks = preflight.preflight_compose_project(app.root_path, app.compose_file, log=log_callback)
        if not checks.ok:
            # Nothing was stopped: the previous release is still serving.
            return {'success': False, 'error': checks.error, 'preflight': checks.to_dict()}

        deployment.status = 'deploying'
        deployment.deploy_started_at = datetime.utcnow()
        db.session.commit()

        from app.services.slot_deploy_service import SlotDeployService, SlotDeployError
        if app.slot_deploys_enabled:
            # A/B slots (plan 87 §C): the project boots as <name>-<idle slot>
            # beside the live one instead of recreating it in place.
            verdict = SlotDeployService.eligibility(app)
            if not verdict['eligible']:
                return {'success': False, 'still_serving': True,
                        'error': 'Slot deploys are on but this service no longer qualifies: '
                                 + ' '.join(verdict['reasons'])}
            try:
                return SlotDeployService.deploy_compose(app, deployment, log=log_callback)
            except SlotDeployError as exc:
                return {'success': False, 'still_serving': True, 'error': str(exc)}

        # Slots switched off: fold the slot projects away; the in-place
        # project publishes its own port again.
        released_port = SlotDeployService.release_slots(app, log=log_callback)
        if log_callback:
            log_callback(f"Starting compose project {app.compose_file}...")
        result = DockerService.compose_up(app.root_path, detach=True, build=True,
                                          compose_file=app.compose_file)
        if not result.get('success'):
            return {'success': False, 'error': result.get('error') or 'docker compose up failed'}
        if released_port and released_port != app.port:
            app.port = released_port
            db.session.commit()
            if app.live_domains:
                from app.services.site_domain_service import SiteDomainService
                SiteDomainService.write_app_vhost(app)
                SlotDeployService._reapply_vhost_extras(app)
        return {'success': True}

    @classmethod
    def _deploy_application(cls, app: Application, deployment: Deployment,
                           log_callback: Callable[[str], None] = None) -> Dict:
        """Deploy the application based on app type."""
        try:
            if deployment.image_tag:
                # Docker-based deployment
                return cls._deploy_docker(app, deployment, log_callback)
            else:
                # Non-Docker deployment (use existing deployment mechanisms)
                return cls._deploy_traditional(app, deployment, log_callback)
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _deploy_docker(cls, app: Application, deployment: Deployment,
                      log_callback: Callable[[str], None] = None) -> Dict:
        """Deploy a Docker-based application."""
        image_tag = deployment.image_tag
        container_name = f"serverkit-app-{app.id}"

        if log_callback:
            log_callback(f"Deploying Docker image: {image_tag}")

        # Configure container
        ports = []
        if app.port:
            ports.append(f"{app.port}:{app.port}")

        # Resolved deploy env: shared variable groups (workspace < project <
        # environment < direct) underneath the app's own local env vars, which
        # take precedence. get_effective_env returns a decrypted {key: value}.
        from app.services.env_service import EnvService
        env = EnvService.get_effective_env(app.id)

        # ---- preflight (plan 72 B.1) -------------------------------------
        # Everything that can fail while the old container keeps serving runs
        # HERE, above the stop. The image is the only pre-traffic requirement
        # this path has: a build already ran to completion in deploy() step 1,
        # and a registry-bound app pulls now instead of after the stop — that
        # pull used to sit below the stop/remove, so a registry hiccup left the
        # app with no container at all. Gated on registry_id: apps built from
        # source never set it, so their locally-built image_tag is untouched
        # (an authenticated pull of it would fail).
        from app.services.container_registry_service import ContainerRegistryService
        from app.services import deploy_preflight_service as preflight
        registry = ContainerRegistryService.for_app(app)

        def _registry_pull():
            return DockerService.pull_image(image_tag, tag=None, registry=registry)

        pull_fn = None
        if registry is not None:
            if log_callback:
                log_callback(f"Authenticating with registry {registry.name}...")
            pull_fn = _registry_pull

        checks = preflight.preflight_image(image_tag, pull=pull_fn, log=log_callback)
        if not checks.ok:
            return {'success': False, 'error': checks.error, 'still_serving': True,
                    'preflight': checks.to_dict()}

        # Attach any managed volumes so app data persists across redeploys
        # (each returns a `name:/mount[:ro]` spec for `docker run -v`).
        from app.services.volume_service import VolumeService
        volumes = VolumeService.run_args(app)

        from app.services.slot_deploy_service import SlotDeployService
        if app.slot_deploys_enabled:
            # A/B slots (plan 87 §B): boot beside the live release, gate,
            # switch, watch. Eligibility is re-checked on every deploy; an app
            # that stopped qualifying fails here rather than silently taking
            # the downtime of an in-place deploy.
            verdict = SlotDeployService.eligibility(app)
            if not verdict['eligible']:
                return {'success': False, 'still_serving': True,
                        'error': 'Slot deploys are on but this service no longer qualifies: '
                                 + ' '.join(verdict['reasons'])
                                 + ' Turn slot deploys off to deploy in place.'}
            return SlotDeployService.deploy_container(app, deployment, image_tag, env, volumes,
                                                      log=log_callback)

        # Slots switched off: fold them away and publish in place again, on
        # the port the app listens on inside the container.
        released_port = SlotDeployService.release_slots(app, log=log_callback)
        if released_port and released_port != app.port:
            app.port = released_port
            ports = [f"{app.port}:{app.port}"]

        # ---- switchover: past this line the live container is gone ---------
        existing = DockerService.get_container(container_name)
        if existing:
            if log_callback:
                log_callback("Stopping existing container...")
            DockerService.stop_container(container_name)
            DockerService.remove_container(container_name)

        # Run new container
        if log_callback:
            log_callback(f"Starting container {container_name}...")

        result = DockerService.run_container(
            image=image_tag,
            name=container_name,
            ports=ports if ports else None,
            volumes=volumes if volumes else None,
            env=env if env else None,
            restart_policy='unless-stopped',
            detach=True
        )

        if result.get('success'):
            from app.services.worker_process_service import (
                WorkerProcessService, connect_shared_network)
            connect_shared_network(app, container_name)
            if released_port:
                # Leaving slots moved app.port back; nginx has to follow.
                db.session.commit()
                from app.services.site_domain_service import SiteDomainService
                if app.live_domains:
                    SiteDomainService.write_app_vhost(app)
                    SlotDeployService._reapply_vhost_extras(app)
            # Procfile worker/scheduler lines run as siblings of the same image
            # (plan 86 §C3). Best-effort: the web process is already live.
            workers = WorkerProcessService.deploy(
                app, image_tag, env, volumes, log=log_callback)
            if workers['failed'] and log_callback:
                for process, error in workers['failed'].items():
                    log_callback(f'Worker {process} did not start: {error}')
            return {
                'success': True,
                'container_id': result.get('container_id'),
                'workers': workers,
            }
        return result

    @classmethod
    def _deploy_traditional(cls, app: Application, deployment: Deployment,
                           log_callback: Callable[[str], None] = None) -> Dict:
        """Deploy using traditional methods (git pull, service restart, etc.)."""
        from app.services.git_service import GitService

        # If git is configured, pull latest
        deploy_config = GitService.get_app_config(app.id)
        if deploy_config:
            if log_callback:
                log_callback("Pulling latest changes...")

            pull_result = GitService.pull_changes(
                app.root_path,
                deploy_config.get('branch')
            )

            if not pull_result.get('success'):
                return pull_result
            cls._record_commit(app, deployment)

            # Run post-deploy scripts
            if deploy_config.get('post_deploy_script'):
                if log_callback:
                    log_callback("Running post-deploy script...")

                script_result = GitService._run_script(
                    deploy_config['post_deploy_script'],
                    app.root_path
                )

                if not script_result.get('success'):
                    return script_result

        # Restart the application service if applicable
        if app.app_type in ['flask', 'django']:
            if log_callback:
                log_callback("Restarting application service...")

            service_name = f"serverkit-{app.name}"
            try:
                ServiceControl.restart(service_name, check=True)
            except subprocess.CalledProcessError as e:
                return {'success': False, 'error': f'Service restart failed: {e.stderr}'}

        return {'success': True}

    @classmethod
    def rollback(cls, app_id: int, target_version: int = None,
                user_id: int = None,
                log_callback: Callable[[str], None] = None) -> Dict:
        """Rollback to a previous deployment.

        If target_version is not specified, rolls back to the previous successful deployment.
        """
        from app.services.deploy_lock import deploy_lock, DeployLockTimeout
        try:
            with deploy_lock(app_id, 'rollback', log=log_callback):
                return cls._rollback_locked(app_id, target_version, user_id, log_callback)
        except DeployLockTimeout as exc:
            return {'success': False, 'error': str(exc)}

    @classmethod
    def _rollback_locked(cls, app_id, target_version, user_id, log_callback) -> Dict:
        # query_active: a rollback re-deploys code and restarts the app.
        app = Application.query_active().filter_by(id=app_id).first()
        if not app:
            return {'success': False, 'error': 'Service not found'}

        current = Deployment.get_current(app_id)
        if not current:
            return {'success': False, 'error': 'No current deployment to rollback from'}

        # Find target deployment
        if target_version:
            target = Deployment.query.filter_by(
                app_id=app_id,
                version=target_version
            ).first()
        else:
            target = Deployment.get_previous(app_id, current.version)

        if not target:
            return {'success': False, 'error': 'No previous deployment found to rollback to'}

        # A compose slot app can roll back to its standby, which needs neither
        # an image tag nor a commit: the release is still there, stopped or warm.
        slot_compose = cls._uses_compose(app) and app.slot_deploys_enabled
        if not target.image_tag and not target.commit_hash and not slot_compose:
            return {
                'success': False,
                'error': 'Target deployment has no artifacts to rollback to'
            }

        if log_callback:
            log_callback(f"Rolling back from v{current.version} to v{target.version}...")

        try:
            app.status = 'deploying'
            db.session.commit()

            # Capture an immutable config snapshot before rolling back, so the
            # timeline records the pre-rollback config. Best-effort.
            try:
                from app.services.configuration_service import ConfigurationService
                ConfigurationService.create_snapshot(app, current)
            except Exception as snap_err:
                logger.warning('Config snapshot capture failed (rollback): %s', snap_err)

            # Create new deployment record for the rollback
            version = Deployment.get_next_version(app_id)
            rollback_deployment = Deployment(
                app_id=app_id,
                version=version,
                version_tag=f"v{version}-rollback-from-v{current.version}",
                status='deploying',
                build_method=target.build_method,
                image_tag=target.image_tag,
                commit_hash=target.commit_hash,
                deployed_by=user_id,
                deploy_trigger='rollback'
            )
            rollback_deployment.update_metadata('rolled_back_to', target.version)
            rollback_deployment.deploy_started_at = datetime.utcnow()
            db.session.add(rollback_deployment)
            db.session.commit()

            # Deploy the previous version
            if cls._uses_compose(app) and app.slot_deploys_enabled:
                from app.services.slot_deploy_service import SlotDeployService
                deploy_result = SlotDeployService.rollback_compose(
                    app, target, rollback_deployment, log_callback)
            elif target.image_tag:
                # Docker rollback
                deploy_result = cls._deploy_docker(app, rollback_deployment, log_callback)
            else:
                # Git rollback
                deploy_result = cls._rollback_git(app, target, log_callback)

            if not deploy_result.get('success'):
                rollback_deployment.status = 'failed'
                rollback_deployment.error_message = deploy_result.get('error')
                app.status = 'running' if deploy_result.get('still_serving') else 'error'
                db.session.commit()
                return {
                    'success': False,
                    'error': deploy_result.get('error'),
                    'deployment': rollback_deployment.to_dict()
                }

            # Update statuses
            current.status = 'rolled_back'
            rollback_deployment.status = 'live'
            rollback_deployment.deploy_completed_at = datetime.utcnow()
            rollback_deployment.container_id = deploy_result.get('container_id')

            app.status = 'running'
            app.last_deployed_at = datetime.utcnow()

            db.session.commit()

            # Same reasoning as deploy: containers were replaced.
            from app.services import container_status_service
            container_status_service.invalidate(app_id)

            if log_callback:
                log_callback(f"Rollback successful! Now running v{target.version} code as v{version}")

            return {
                'success': True,
                'deployment': rollback_deployment.to_dict(),
                'rolled_back_to': target.to_dict()
            }

        except Exception as e:
            app.status = 'error'
            db.session.commit()
            return {'success': False, 'error': str(e)}

    @classmethod
    def _rollback_git(cls, app: Application, target: Deployment,
                     log_callback: Callable[[str], None] = None) -> Dict:
        """Rollback to a specific git commit."""
        if not target.commit_hash:
            return {'success': False, 'error': 'No commit hash to rollback to'}

        app_path = app.root_path

        try:
            result = cls._checkout(app, target.commit_hash, log_callback)
            if not result['success']:
                return result

            # Run post-deploy script if configured
            deploy_config = GitService.get_app_config(app.id)
            if deploy_config and deploy_config.get('post_deploy_script'):
                if log_callback:
                    log_callback("Running post-deploy script...")

                script_result = GitService._run_script(
                    deploy_config['post_deploy_script'],
                    app_path
                )

                if not script_result.get('success'):
                    return script_result

            # A compose app's code lives in its images: checking out the old
            # commit changed files and nothing else, so the "rollback"
            # reported success while the new release kept serving (§A6).
            # Rebuild and recreate from the checked-out tree, validated first.
            if cls._uses_compose(app):
                from app.services import deploy_preflight_service as preflight
                checks = preflight.preflight_compose_project(
                    app.root_path, app.compose_file, log=log_callback)
                if not checks.ok:
                    return {'success': False, 'error': checks.error,
                            'preflight': checks.to_dict()}
                if log_callback:
                    log_callback(f"Starting compose project {app.compose_file}...")
                up = DockerService.compose_up(app.root_path, detach=True, build=True,
                                              compose_file=app.compose_file)
                if not up.get('success'):
                    return {'success': False,
                            'error': up.get('error') or 'docker compose up failed'}

            # Restart service
            if app.app_type in ['flask', 'django']:
                service_name = f"serverkit-{app.name}"
                ServiceControl.restart(service_name, check=True)

            return {'success': True}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def _checkout(app: Application, commit_hash: str,
                  log_callback: Callable[[str], None] = None) -> Dict:
        if log_callback:
            log_callback(f"Checking out commit {commit_hash[:8]}...")
        result = run_checked(['git', '-C', app.root_path, 'checkout', commit_hash], timeout=None)
        if not result['success']:
            return {'success': False, 'error': result['error']}
        return {'success': True}

    @classmethod
    def _generate_diff(cls, deployment: Deployment) -> None:
        """Generate diff between this deployment and the previous one."""
        try:
            previous = Deployment.get_previous(deployment.app_id, deployment.version)
            if not previous or not deployment.commit_hash or not previous.commit_hash:
                return

            # Deployment rows outlive the app; a tombstone's root_path may be
            # gone (purge removes it), so don't shell out to git for one.
            app = Application.query_active().filter_by(id=deployment.app_id).first()
            if not app:
                return
            app_path = app.root_path

            # Get git diff
            result = run_checked(
                ['git', '-C', app_path, 'diff', '--name-status',
                 previous.commit_hash, deployment.commit_hash], timeout=None)

            if not result['success']:
                return

            files_added = []
            files_removed = []
            files_modified = []

            for line in result['output'].strip().split('\n'):
                if not line:
                    continue
                parts = line.split('\t')
                if len(parts) >= 2:
                    status, filepath = parts[0], parts[1]
                    if status == 'A':
                        files_added.append(filepath)
                    elif status == 'D':
                        files_removed.append(filepath)
                    elif status.startswith('M') or status.startswith('R'):
                        files_modified.append(filepath)

            # Get diff stats
            stat_result = run_checked(
                ['git', '-C', app_path, 'diff', '--shortstat',
                 previous.commit_hash, deployment.commit_hash], timeout=None)

            additions = 0
            deletions = 0
            if stat_result['success'] and stat_result['output']:
                import re
                add_match = re.search(r'(\d+) insertion', stat_result['output'])
                del_match = re.search(r'(\d+) deletion', stat_result['output'])
                if add_match:
                    additions = int(add_match.group(1))
                if del_match:
                    deletions = int(del_match.group(1))

            # Create diff record
            diff = DeploymentDiff(
                deployment_id=deployment.id,
                previous_deployment_id=previous.id,
                files_added=json.dumps(files_added),
                files_removed=json.dumps(files_removed),
                files_modified=json.dumps(files_modified),
                additions=additions,
                deletions=deletions
            )
            db.session.add(diff)
            db.session.commit()

        except Exception as e:
            logger.warning('Failed to generate deployment diff: %s', e)

    @classmethod
    def get_deployments(cls, app_id: int, limit: int = 20, offset: int = 0) -> List[Dict]:
        """Get deployment history for an app."""
        deployments = Deployment.query.filter_by(app_id=app_id).order_by(
            Deployment.version.desc()
        ).offset(offset).limit(limit).all()

        return [d.to_dict() for d in deployments]

    @classmethod
    def get_deployment(cls, deployment_id: int, include_logs: bool = False) -> Optional[Dict]:
        """Get a specific deployment."""
        deployment = Deployment.query.get(deployment_id)
        if deployment:
            return deployment.to_dict(include_logs=include_logs)
        return None

    @classmethod
    def get_deployment_diff(cls, deployment_id: int) -> Optional[Dict]:
        """Get diff for a deployment."""
        diff = DeploymentDiff.query.filter_by(deployment_id=deployment_id).first()
        if diff:
            return diff.to_dict()
        return None

    @classmethod
    def get_current_deployment(cls, app_id: int) -> Optional[Dict]:
        """Get the currently live deployment."""
        deployment = Deployment.get_current(app_id)
        if deployment:
            return deployment.to_dict()
        return None

    @classmethod
    def update_deployment_status(cls, deployment_id: int, status: str,
                                error_message: str = None) -> Dict:
        """Update deployment status."""
        deployment = Deployment.query.get(deployment_id)
        if not deployment:
            return {'success': False, 'error': 'Deployment not found'}

        deployment.status = status
        if error_message:
            deployment.error_message = error_message

        db.session.commit()
        return {'success': True, 'deployment': deployment.to_dict()}
