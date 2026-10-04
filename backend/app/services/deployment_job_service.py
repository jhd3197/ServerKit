"""Deployment job orchestration service."""

import logging
import os
import uuid
from datetime import datetime
from typing import Dict, Optional

from app import db
from app.models import Application, Server
from app.models.deployment_job import DeploymentJob
from app.services.deployment_runner import DeploymentPlanRunner
from app.services.run_log_service import append_log, stream_for
from app.services.docker_service import DockerService
from app.services.template_service import TemplateService
from app.services.telemetry_service import generate_correlation_id
from app.utils.slug import app_name_clash_error

# Unified job kinds (see register_jobs()): asynchronous template installs,
# builds/deploys of existing apps (e.g. repo-based services from Flow A), and
# simulated demo deploys (plan 51.5 dev tool).
JOB_KIND = 'deploy.install'
APP_JOB_KIND = 'deploy.app'
DEMO_JOB_KIND = 'deploy.demo'
REGISTERED_JOB_KIND = 'deploy.registered'

logger = logging.getLogger(__name__)


class DeploymentJobService:
    """Creates and runs deployment jobs with persistent logs."""

    @classmethod
    def install_template(
        cls,
        template_id: str,
        app_name: str,
        user_variables: Dict = None,
        user_id: int = None,
        server_id: Optional[str] = None,
        wait: bool = False,
        auto_domain: Optional[bool] = None,
    ) -> Dict:
        """Create a template installation job and optionally run it synchronously."""
        normalized_server_id = cls._normalize_server_id(server_id)

        # Deliberately NOT query_active: a soft-deleted app keeps reserving its
        # name, or a new install takes it and the Recycle Bin restore collides.
        existing = Application.query.filter_by(name=app_name, server_id=normalized_server_id).first()
        if existing:
            return {
                'success': False,
                'error': app_name_clash_error(existing, app_name,
                                              suffix=' on this target server')
            }

        if normalized_server_id:
            server = Server.query.get(normalized_server_id)
            if not server:
                return {'success': False, 'error': 'Target server not found'}

        plan_result = TemplateService.build_install_plan(
            template_id=template_id,
            app_name=app_name,
            user_variables=user_variables or {},
            user_id=user_id,
            server_id=normalized_server_id,
            auto_domain=auto_domain,
        )
        if not plan_result.get('success'):
            return plan_result

        app_path = plan_result['app_path']
        if not normalized_server_id and os.path.exists(app_path):
            if not cls._is_abandoned_install_dir(app_path):
                return {
                    'success': False,
                    'error': (f'A service directory already exists at {app_path}. '
                              'Remove it, or install under a different name.'),
                }
            # An install that failed part-way leaves its directory behind, and
            # refusing it made the obvious next move — try again — impossible
            # without going to a shell. The plan rewrites every file it owns,
            # so reusing the directory is safe.
            logger.info('Reusing abandoned install directory %s', app_path)

        job = DeploymentJob(
            id=str(uuid.uuid4()),
            kind='template_install',
            status='pending',
            target_server_id=normalized_server_id,
            requested_by=user_id,
            trigger='manual',
            correlation_id=generate_correlation_id(),
        )
        job.set_plan(plan_result['plan'])
        db.session.add(job)
        db.session.commit()

        if wait:
            cls.run_job(job.id)
        else:
            try:
                cls._enqueue_install(job)
            except Exception as exc:
                # Enqueue failed after the DeploymentJob commit — without this
                # the row would sit 'pending' forever with no runner.
                db.session.rollback()
                job.mark_failed(f'Failed to queue deployment: {exc}')
                db.session.commit()
                return {'success': False, 'error': job.error_message, 'job_id': job.id}

        return {
            'success': True,
            'job_id': job.id,
            'job': job.to_dict(include_logs=True),
        }

    @classmethod
    def enqueue_app_deploy(cls, app, user_id: int = None, trigger: str = 'install',
                           no_cache: bool = False, version_tag: str = None) -> Dict:
        """Create a deploy job for an existing app and queue it asynchronously.

        Used by the repo-based create flow (POST /apps/from-repository): the
        app row already exists (cloned + build/deploy configured) but nothing
        has been built or started yet. The job runs the existing
        DeploymentService.deploy pipeline with progress persisted to
        deployment_job_logs, so repo apps get the same observable deployment
        UX as template installs. Deploys create containers and are NOT
        idempotent, so max_attempts=1 (no auto-retry), same as installs.
        """
        job = DeploymentJob(
            id=str(uuid.uuid4()),
            kind='app_deploy',
            status='pending',
            app_id=app.id,
            target_server_id=app.server_id,
            requested_by=user_id,
            trigger=trigger,
            correlation_id=generate_correlation_id(),
        )
        # Execution is delegated to DeploymentService.deploy; these steps only
        # drive the progress bar and mirror the milestones _run_app_deploy logs.
        # Deploy options ride in the plan so the async runner can honor them.
        # A slot deploy (plan 87) reports its own stages as it reaches them.
        from app.services.slot_deploy_service import SlotDeployService
        slot_steps = SlotDeployService.plan_steps(app)
        job.set_plan({
            'app_id': app.id,
            'app_name': app.name,
            'no_cache': bool(no_cache),
            'version_tag': version_tag,
            'slot_stages': bool(slot_steps),
            'steps': [{'name': name} for name in (slot_steps or [
                'Prepare deployment', 'Build application', 'Start containers'])],
        })
        db.session.add(job)
        db.session.commit()

        try:
            cls._enqueue_app_deploy(job)
        except Exception as exc:
            # Enqueue failed after the DeploymentJob commit — without this the
            # row would sit 'pending' forever with no runner (same guard as
            # install_template).
            db.session.rollback()
            job.mark_failed(f'Failed to queue deployment: {exc}')
            db.session.commit()
            return {'success': False, 'error': job.error_message, 'job_id': job.id}

        return {
            'success': True,
            'job_id': job.id,
            'job': job.to_dict(include_logs=True),
        }

    @classmethod
    def run_job(cls, job_id: str) -> Dict:
        """Run a job by ID."""
        job = DeploymentJob.query.get(job_id)
        if not job:
            return {'success': False, 'error': 'Deployment job not found'}

        if job.kind == 'app_deploy':
            return cls._run_app_deploy(job)

        if job.kind == 'demo_deploy':
            from app.services.demo_deploy_service import DemoDeployService
            return DemoDeployService.run(job)

        # Kinds contributed by plugins (see deploy_kind_registry). Checked
        # before the unsupported-kind bail so a plugin's deployment runs through
        # the same console, retry and activity feed as a core one.
        if job.kind not in ('app_deploy', 'template_install', 'demo_deploy'):
            from app.services import deploy_kind_registry
            handler = deploy_kind_registry.get(job.kind)
            if handler:
                return cls._run_registered_kind(job, handler)

        if job.kind != 'template_install':
            return {'success': False, 'error': f'Unsupported deployment job kind: {job.kind}'}

        runner = DeploymentPlanRunner(job)
        try:
            run_result = runner.run()
        except Exception as exc:
            # The runner died before/outside its own error handling (schema
            # bug, wedged session, ...). Mark the job failed visibly so the UI
            # never shows a deployment stuck at "running" with no explanation.
            try:
                db.session.rollback()
                job.mark_failed(str(exc))
                db.session.commit()
                # append_log persists immediately: the runner's own stream may
                # never have reached close() on this crash path.
                append_log(job, 'error', f'Deployment crashed: {exc}')
            except Exception:
                db.session.rollback()
            return {'success': False, 'error': str(exc)}

        if not run_result.get('success'):
            return run_result

        try:
            return cls._finalize_template_install(job)
        except Exception as exc:
            job.mark_failed(str(exc))
            db.session.commit()
            # Stream already closed after a successful run(); flush this line now.
            append_log(job, 'error', f'Failed to finalize deployment: {exc}')
            return {'success': False, 'error': str(exc)}

    @classmethod
    def get_job(cls, job_id: str, include_logs: bool = True,
                include_plan: bool = False) -> Optional[Dict]:
        job = DeploymentJob.query.get(job_id)
        return job.to_dict(include_logs=include_logs, include_plan=include_plan) if job else None

    @classmethod
    def retry_job(cls, job_id: str, user_id: int = None) -> Dict:
        """Clone a FAILED deployment job and enqueue a fresh run (plan 51 D8).

        Uniform for both kinds: the queue payload is just {deployment_job_id}
        and template plans are self-contained (compose content lives in
        file.write steps), so cloning the row + re-enqueuing the same unified
        kind re-runs the deploy from scratch on a new console URL.
        """
        job = DeploymentJob.query.get(job_id)
        if not job:
            return {'success': False, 'error': 'Deployment job not found', 'code': 'not_found'}
        if job.status != 'failed':
            return {'success': False,
                    'error': 'Only failed deployments can be retried'}

        # Recipes are explicitly resumable. A clone would discard the
        # completed-step ledger and orphan any still-valid encrypted handoff
        # values under the old run id, turning Retry into "start over". Resume
        # the same run from its first incomplete step instead.
        if job.kind == 'recipe.run':
            job.status = 'pending'
            job.error_message = None
            job.completed_at = None
            job.requested_by = user_id or job.requested_by
            db.session.commit()
            try:
                cls._enqueue_registered(job)
            except Exception as exc:
                db.session.rollback()
                job.mark_failed(f'Failed to queue Recipe resume: {exc}')
                db.session.commit()
                return {'success': False, 'error': job.error_message, 'job_id': job.id}
            return {'success': True, 'job_id': job.id,
                    'job': job.to_dict(include_logs=True), 'resumed': True}

        clone = DeploymentJob(
            id=str(uuid.uuid4()),
            kind=job.kind,
            status='pending',
            target_server_id=job.target_server_id,
            app_id=job.app_id,
            requested_by=user_id or job.requested_by,
            trigger='retry',
            correlation_id=generate_correlation_id(),
        )
        clone.set_plan(job.get_plan())
        db.session.add(clone)
        db.session.commit()

        from app.services import deploy_kind_registry
        enqueue = {
            'app_deploy': cls._enqueue_app_deploy,
            'demo_deploy': cls._enqueue_demo,
        }.get(clone.kind)
        if enqueue is None:
            # A registered (plugin) kind retries through its own runner; only a
            # genuine template_install falls through to the install queue.
            enqueue = (cls._enqueue_registered if deploy_kind_registry.get(clone.kind)
                       else cls._enqueue_install)
        try:
            enqueue(clone)
        except Exception as exc:
            db.session.rollback()
            clone.mark_failed(f'Failed to queue retry: {exc}')
            db.session.commit()
            return {'success': False, 'error': clone.error_message, 'job_id': clone.id}

        return {'success': True, 'job_id': clone.id, 'job': clone.to_dict(include_logs=True)}

    @classmethod
    def list_jobs(cls, status: str = None, target_server_id: str = None,
                  app_id: int = None, limit: int = 50):
        query = DeploymentJob.query.order_by(DeploymentJob.created_at.desc())
        if status:
            query = query.filter_by(status=status)
        if target_server_id:
            query = query.filter_by(target_server_id=cls._normalize_server_id(target_server_id))
        if app_id is not None:
            query = query.filter_by(app_id=app_id)
        return [job.to_dict() for job in query.limit(limit).all()]

    @classmethod
    def _run_app_deploy(cls, job: DeploymentJob) -> Dict:
        """Run an 'app_deploy' job: build + start an existing app via the
        existing DeploymentService.deploy pipeline (no build logic is
        reimplemented here), with milestones logged to deployment_job_logs so
        the UI sees the same progress/log stream as a template install."""
        runner = DeploymentPlanRunner(job)
        try:
            # Jobs outlive the app: a queued/retried deploy must not build and
            # start containers for one that has been deleted.
            app = (Application.query_active().filter_by(id=job.app_id).first()
                   if job.app_id else None)
            if not app:
                raise RuntimeError(f'Application not found for deployment job {job.id}')

            job.mark_running()
            plan = job.get_plan()
            steps = [s.get('name') for s in plan.get('steps') or []]
            slot_stages = bool(plan.get('slot_stages'))
            # set_step handles the current_step/name row update + commit, flushes
            # buffered lines, records per-step timings, and emits a live status.
            runner.stream.set_step(1, steps[0] if slot_stages else 'Prepare deployment')
            runner.log('info', f"Deploying application '{app.name}' (trigger: {job.trigger})")

            if not slot_stages:
                runner.stream.set_step(2, 'Build application')

            from app.services import deploy_stages
            from app.services.deployment_service import DeploymentService
            with deploy_stages.reporting(_stage_advancer(runner, steps) if slot_stages
                                         else (lambda name: None)):
                result = DeploymentService.deploy(
                    app.id,
                    user_id=job.requested_by,
                    trigger=job.trigger or 'manual',
                    no_cache=bool(plan.get('no_cache')),
                    version_tag=plan.get('version_tag'),
                    log_callback=lambda line: runner.log('info', line),
                )
            if not result.get('success'):
                raise RuntimeError(result.get('error') or 'Deployment failed')

            if not slot_stages:
                runner.stream.set_step(3, 'Start containers')
                runner.log('info', 'Containers started')

            deployment = result.get('deployment') or {}
            job.mark_succeeded()
            job.current_step_name = None
            job.deployment_id = deployment.get('id')
            job.set_result({**job.get_result(), 'app_id': app.id,
                            'deployment_id': deployment.get('id')})
            db.session.commit()
            runner.log('info', f"Deployment completed: {app.name} is now live")
            runner.stream.close('succeeded')
            return {'success': True, 'app_id': app.id, 'job': job.to_dict(include_logs=True)}
        except Exception as exc:
            # Never leave the job stuck 'running': mark it failed with a
            # visible error + log line, even if the session needs a rollback
            # first (mirrors the runner's own failure handling).
            try:
                db.session.rollback()
                job.mark_failed(str(exc))
                db.session.commit()
                runner.log('error', f'Deployment failed: {exc}')
            except Exception:
                db.session.rollback()
            # Flush + persist failure tail/hint/timings; terminal status emit.
            runner.stream.close('failed', error_message=str(exc))
            return {'success': False, 'error': str(exc)}

    @classmethod
    def _finalize_template_install(cls, job: DeploymentJob) -> Dict:
        plan = job.get_plan()
        app_name = plan.get('app_name')
        app_path = plan.get('app_path')
        app_port = plan.get('port')
        template_name = plan.get('template_name')

        app = Application(
            name=app_name,
            app_type='docker',
            status='running',
            root_path=app_path,
            docker_image=template_name,
            user_id=job.requested_by or 1,
            port=app_port,
            server_id=job.target_server_id,
        )
        db.session.add(app)
        db.session.commit()

        port_accessible = None
        if not job.target_server_id and app_port:
            port_accessible = DockerService.check_port_accessible(app_port).get('accessible', False)

        config = TemplateService.get_config()
        config.setdefault('installed', {})[str(app.id)] = {
            'template_id': plan.get('template_id'),
            'template_version': plan.get('template_version'),
            'app_id': app.id,
            'app_name': app_name,
            'server_id': job.target_server_id,
            'installed_at': datetime.utcnow().isoformat(),
        }
        TemplateService.save_config(config)

        result = {
            'success': True,
            'app_id': app.id,
            'app_name': app.name,
            'app_path': app_path,
            'server_id': job.target_server_id,
            'port': app_port,
            'port_accessible': port_accessible,
        }

        # Optional auto-domain: when the template opts in (top-level `auto_domain: true`)
        # and a managed-sites base domain is configured, publish the app at
        # <slug>.<base_domain> with an nginx vhost. HTTPS is applied ONLY if the
        # base domain's wildcard cert is already set up (HTTP otherwise) — this never
        # forces SSL. Best-effort and non-fatal; remote-server installs are skipped
        # (the panel's nginx can't proxy a container on another host). See
        # SiteDomainService.give_subdomain.
        auto_domain = bool(plan.get('auto_domain'))
        if not auto_domain:
            try:
                tmpl = TemplateService.get_template(plan.get('template_id'))
                auto_domain = bool(tmpl.get('success') and tmpl['template'].get('auto_domain'))
            except Exception:
                auto_domain = False
        if auto_domain and not job.target_server_id and app.app_type == 'docker' and app.port:
            try:
                from app.services.site_domain_service import SiteDomainService
                dom = SiteDomainService.give_subdomain(app)
                result['auto_domain'] = dom
                if dom.get('success'):
                    append_log(job, 'info', f"Published at {dom.get('url')}", dom)
                else:
                    append_log(job, 'warn', f"Auto-domain skipped: {dom.get('error')}", dom)
            except Exception as exc:
                result['auto_domain'] = {'success': False, 'error': str(exc)}
                append_log(job, 'warn', f"Auto-domain failed: {exc}")

        job.app_id = app.id
        job.set_result({**job.get_result(), **result})
        db.session.commit()

        append_log(job, 'info', f'Application record created: {app.name}', result)

        return {'success': True, 'job': job.to_dict(include_logs=True), **result}

    # ------------------------------------------------------------------
    # Unified job system integration (kind: deploy.install)
    # ------------------------------------------------------------------
    @classmethod
    def _enqueue_install(cls, job: DeploymentJob):
        """Hand the deployment to the unified job system for async execution.

        Replaces the former one-off daemon thread: the work now persists on the
        Queue Bus and is run by the single JobConsumer, so it survives a restart
        and is observable via /api/v1/jobs. Installs create containers/files/an
        app row and are NOT idempotent, so max_attempts=1 (no auto-retry).
        """
        from app.jobs.service import JobService
        return JobService.enqueue(
            JOB_KIND,
            payload={'deployment_job_id': job.id},
            max_attempts=1,
            owner_type='deployment_job',
            owner_id=job.id,
            correlation_id=job.correlation_id,
        )

    @staticmethod
    def _run_install_job(unified_job):
        """Unified-job handler for ``deploy.install``. Drives run_job and surfaces
        a failed deployment as a raised error so the unified job is marked failed
        too (the DeploymentJob row already carries the detailed status/logs)."""
        deployment_job_id = (unified_job.get_payload() or {}).get('deployment_job_id')
        if not deployment_job_id:
            raise ValueError('deploy.install job missing deployment_job_id')
        result = DeploymentJobService.run_job(deployment_job_id)
        if not result.get('success'):
            raise RuntimeError(result.get('error') or 'Deployment failed')
        return {
            'deployment_job_id': deployment_job_id,
            'app_id': result.get('app_id'),
            'app_name': result.get('app_name'),
        }

    @classmethod
    def _enqueue_app_deploy(cls, job: DeploymentJob):
        """Hand an app deploy to the unified job system (same pattern as
        ``_enqueue_install``): persistent on the Queue Bus, run by the single
        JobConsumer, max_attempts=1 because deploys are not idempotent."""
        from app.jobs.service import JobService
        return JobService.enqueue(
            APP_JOB_KIND,
            payload={'deployment_job_id': job.id},
            max_attempts=1,
            owner_type='deployment_job',
            owner_id=job.id,
            correlation_id=job.correlation_id,
        )

    @staticmethod
    def _run_app_deploy_job(unified_job):
        """Unified-job handler for ``deploy.app`` (same shape as
        ``_run_install_job``): a failed deploy raises so the unified job is
        marked failed too."""
        deployment_job_id = (unified_job.get_payload() or {}).get('deployment_job_id')
        if not deployment_job_id:
            raise ValueError('deploy.app job missing deployment_job_id')
        result = DeploymentJobService.run_job(deployment_job_id)
        if not result.get('success'):
            raise RuntimeError(result.get('error') or 'Deployment failed')
        return {
            'deployment_job_id': deployment_job_id,
            'app_id': result.get('app_id'),
        }

    @classmethod
    def _enqueue_demo(cls, job: DeploymentJob):
        """Hand a simulated demo deploy to the unified job system (same
        pattern as ``_enqueue_install``)."""
        from app.jobs.service import JobService
        return JobService.enqueue(
            DEMO_JOB_KIND,
            payload={'deployment_job_id': job.id},
            max_attempts=1,
            owner_type='deployment_job',
            owner_id=job.id,
            correlation_id=job.correlation_id,
        )

    @classmethod
    def start_registered(cls, kind: str, *, steps=None, app_id=None, server_id=None,
                         user_id=None, trigger='manual', plan=None, wait=False) -> Dict:
        """Create and queue a DeploymentJob for a registered (plugin) kind.

        The public entry point behind ``app.plugins_sdk.deploys.start`` — the
        caller supplies the step names its handler will walk, and gets back a
        job id that already addresses the Deploy Console.
        """
        from app.services import deploy_kind_registry
        if not deploy_kind_registry.get(kind):
            return {'success': False, 'error': f'No handler registered for deployment kind "{kind}"'}

        job = DeploymentJob(
            id=str(uuid.uuid4()),
            kind=kind,
            status='pending',
            app_id=app_id,
            target_server_id=cls._normalize_server_id(server_id),
            requested_by=user_id,
            trigger=trigger,
            correlation_id=generate_correlation_id(),
        )
        normalized_steps = [
            dict(step) if isinstance(step, dict) else {'name': step}
            for step in (steps or [])
        ]
        job.set_plan({**(plan or {}), 'steps': normalized_steps})
        job.total_steps = len(steps or [])
        db.session.add(job)
        db.session.commit()

        if wait:
            # Ran inline, so report what actually happened rather than merely
            # that the job was created — a caller passing wait=True is asking
            # for the outcome.
            run_result = cls.run_job(job.id)
            return {**run_result, 'job_id': job.id, 'job': job.to_dict()}

        try:
            cls._enqueue_registered(job)
        except Exception as exc:
            # Same guard as every other producer: never leave a runner-less
            # 'pending' row behind.
            db.session.rollback()
            job.mark_failed(f'Failed to queue deployment: {exc}')
            db.session.commit()
            return {'success': False, 'error': job.error_message, 'job_id': job.id}

        return {'success': True, 'job_id': job.id, 'job': job.to_dict()}

    @classmethod
    def _enqueue_registered(cls, job: DeploymentJob):
        """Hand a plugin-contributed deployment to the unified job system."""
        from app.jobs.service import JobService
        return JobService.enqueue(
            REGISTERED_JOB_KIND,
            payload={'deployment_job_id': job.id},
            max_attempts=1,
            owner_type='deployment_job',
            owner_id=job.id,
            correlation_id=job.correlation_id,
        )

    @staticmethod
    def _run_registered_job(unified_job):
        """Unified-job handler for ``deploy.registered``."""
        deployment_job_id = (unified_job.get_payload() or {}).get('deployment_job_id')
        if not deployment_job_id:
            raise ValueError('deploy.registered job missing deployment_job_id')
        result = DeploymentJobService.run_job(deployment_job_id)
        if not result.get('success'):
            raise RuntimeError(result.get('error') or 'Deployment failed')
        return {'deployment_job_id': deployment_job_id}

    @classmethod
    def _run_registered_kind(cls, job: DeploymentJob, handler) -> Dict:
        """Run a plugin-contributed kind, owning the failure path ourselves.

        A plugin handler is third-party code: if it raises, the job must still
        end up visibly failed rather than stuck at 'running' forever with no
        explanation — the same guarantee _reconcile_interrupted_jobs gives for
        a lost process, applied to a lost handler.
        """
        # Keep the original started_at when re-entering (reconciled handler).
        job.mark_running(when=job.started_at)
        db.session.commit()

        # The same stream the handler logs through (see run_log_service.
        # stream_for), so closing it here persists the step timings the handler
        # recorded rather than an empty second buffer's.
        stream = stream_for(job)
        try:
            result = handler(job) or {}
        except Exception as exc:
            logger.exception('Deployment kind %s raised', job.kind)
            stream.log('error', f'{job.kind} failed: {exc}')
            db.session.rollback()
            job.mark_failed(str(exc))
            db.session.commit()
            stream.close('failed', error_message=str(exc))
            return {'success': False, 'error': str(exc), 'job_id': job.id}

        stream.flush()
        # A handler may finalise or pause the job itself; only fill in what it
        # left. ``waiting`` is the Recipe handoff state: nonterminal, visible in
        # Operations, and resumed by enqueueing this SAME deployment job.
        if job.status not in ('succeeded', 'failed', 'waiting'):
            if result.get('success', True):
                job.mark_succeeded()
            else:
                job.mark_failed(result.get('error') or f'{job.kind} failed')
            db.session.commit()
        if job.status == 'failed' and job.error_message:
            # A handler that reported failure by return value logged nothing;
            # without this the console shows a failed run with no reason in it.
            stream.log('error', job.error_message)
        if job.status == 'waiting':
            stream.flush()
            stream.emit_status()
            return {**result, 'success': True, 'paused': True, 'job_id': job.id}

        # close() persists step timings (and, on failure, the tail + hint) into
        # the job's result and emits the terminal status the console listens for.
        stream.close(job.status, error_message=job.error_message)
        # Handler extras first: the job's own status is the authoritative
        # outcome and must not be overwritten by a handler that finalised the
        # job one way and then returned the other.
        return {**result, 'success': job.status == 'succeeded', 'job_id': job.id}

    @staticmethod
    def _run_demo_job(unified_job):
        """Unified-job handler for ``deploy.demo`` (same shape as
        ``_run_install_job``): a scripted failure raises so the unified job is
        marked failed too."""
        deployment_job_id = (unified_job.get_payload() or {}).get('deployment_job_id')
        if not deployment_job_id:
            raise ValueError('deploy.demo job missing deployment_job_id')
        result = DeploymentJobService.run_job(deployment_job_id)
        if not result.get('success'):
            raise RuntimeError(result.get('error') or 'Demo deployment failed')
        return {'deployment_job_id': deployment_job_id}

    @classmethod
    def register_jobs(cls):
        """Register deployment handlers with the unified job registry. Called once
        at app startup (see app/__init__.py)."""
        from app.jobs import registry
        registry.register(JOB_KIND, cls._run_install_job, replace=True)
        registry.register(APP_JOB_KIND, cls._run_app_deploy_job, replace=True)
        registry.register(DEMO_JOB_KIND, cls._run_demo_job, replace=True)
        registry.register(REGISTERED_JOB_KIND, cls._run_registered_job, replace=True)
        cls._reconcile_interrupted_jobs()

    @classmethod
    def _reconcile_interrupted_jobs(cls):
        """Fail DeploymentJobs left 'running' by a previous process.

        Called once at startup: a job still 'running' at boot has no live
        runner (the process that ran it is gone), so leaving it would show a
        forever-spinning deployment in the UI with no logs and no error.
        """
        try:
            stale = DeploymentJob.query.filter_by(status='running').all()
            for job in stale:
                job.mark_failed(
                    'Interrupted: the server restarted while this deployment was '
                    'running. Please retry the install.'
                )
            if stale:
                db.session.commit()
        except Exception:
            db.session.rollback()

    @staticmethod
    def _is_abandoned_install_dir(app_path: str) -> bool:
        """True if *app_path* is the wreckage of an install that never finished.

        A finished install owns an Application row pointing at the directory,
        and that row is only written once the plan has run — so a directory
        with no owner was left by a failure. Reusing one is safe; overwriting
        somebody's actual files is not, which is why an unowned directory still
        has to look like ours (empty, or carrying the marker the template
        writer drops in) before it can be reused.
        """
        try:
            # Deliberately NOT query_active: a soft-deleted app still owns its
            # directory until purge, so reusing it would break the restore.
            if Application.query.filter_by(root_path=app_path).first():
                return False
            entries = os.listdir(app_path)
            if not entries:
                return True
            return '.serverkit-template.json' in entries
        except OSError:
            # Unreadable — treat it as occupied and let the caller refuse.
            return False

    @staticmethod
    def _normalize_server_id(server_id: Optional[str]) -> Optional[str]:
        if not server_id or server_id == 'local':
            return None
        return server_id


def _stage_advancer(runner, steps):
    """Map a stage the deploy reports onto the job's step list (plan 87 §F).

    Matched by name, or by its first two words ("Boot slot") because which
    slot is idle can change between enqueue and run when deploys queue up.
    Only ever moves forward.
    """
    state = {'index': 1}

    def advance(name):
        prefix = ' '.join(name.split()[:2])
        for index, step in enumerate(steps, start=1):
            if step == name or (step or '').startswith(prefix):
                if index > state['index']:
                    state['index'] = index
                    runner.stream.set_step(index, name)
                return
    return advance
