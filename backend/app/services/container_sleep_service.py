"""Container auto-sleep: stop idle apps to free resources and wake them on
demand. Idle is measured from `last_activity_at` (bumped on wake and via
record_activity); wiring real traffic into record_activity — e.g. from the
nginx access log — and request-triggered wake-on-demand are follow-ups."""
import logging
from datetime import datetime, timedelta

from app import db
from app.models import Application
from app.models.container_sleep_policy import ContainerSleepPolicy
from app.services.docker_service import DockerService

logger = logging.getLogger(__name__)


class ContainerSleepService:

    @staticmethod
    def get_or_create_policy(application_id):
        policy = ContainerSleepPolicy.query.filter_by(application_id=application_id).first()
        if not policy:
            policy = ContainerSleepPolicy(application_id=application_id)
            db.session.add(policy)
            db.session.commit()
        return policy

    @classmethod
    def set_policy(cls, application_id, enabled=None, idle_timeout_minutes=None):
        policy = cls.get_or_create_policy(application_id)
        if enabled is not None:
            policy.enabled = bool(enabled)
        if idle_timeout_minutes is not None:
            policy.idle_timeout_minutes = max(1, int(idle_timeout_minutes))
        # (Re)configuring the policy resets the idle clock.
        policy.last_activity_at = datetime.utcnow()
        db.session.commit()
        return policy

    @staticmethod
    def record_activity(application_id):
        policy = ContainerSleepPolicy.query.filter_by(application_id=application_id).first()
        if policy:
            policy.last_activity_at = datetime.utcnow()
            db.session.commit()
        return policy

    @classmethod
    def _stop(cls, app):
        if app.server_id:
            return {'success': False, 'error': 'Sleep is not yet available for services on remote servers'}
        from app.services.slot_deploy_service import SlotDeployService
        if SlotDeployService.is_compose_slot_app(app):
            return SlotDeployService.live_action(app, 'stop')
        if app.app_type == 'docker' and app.root_path and app.compose_file:
            return DockerService.compose_down(app.root_path, compose_file=app.compose_file)
        if app.container_id:
            return DockerService.stop_container(app.container_id)
        return {'success': False, 'error': 'No container or compose project to stop'}

    @classmethod
    def _start(cls, app):
        if app.server_id:
            return {'success': False, 'error': 'Wake is not yet available for services on remote servers'}
        from app.services.slot_deploy_service import SlotDeployService
        if SlotDeployService.is_compose_slot_app(app):
            return SlotDeployService.live_action(app, 'start')
        if app.app_type == 'docker' and app.root_path and app.compose_file:
            return DockerService.compose_up(app.root_path, detach=True, compose_file=app.compose_file)
        if app.container_id:
            return DockerService.start_container(app.container_id)
        return {'success': False, 'error': 'No container or compose project to start'}

    @classmethod
    def sleep_app(cls, application_id):
        # query_active: this stops containers — never touch a tombstoned app.
        app = Application.query_active().filter_by(id=application_id).first()
        if not app:
            return {'success': False, 'error': 'Service not found'}
        result = cls._stop(app)
        if not result.get('success'):
            return result
        policy = cls.get_or_create_policy(application_id)
        policy.asleep = True
        app.status = 'stopped'
        db.session.commit()
        logger.info('Container auto-sleep: %s asleep', app.name)
        return {'success': True, 'policy': policy.to_dict()}

    @classmethod
    def wake_app(cls, application_id):
        # query_active: waking a deleted app would restart the very containers
        # the delete tore down.
        app = Application.query_active().filter_by(id=application_id).first()
        if not app:
            return {'success': False, 'error': 'Service not found'}
        result = cls._start(app)
        if not result.get('success'):
            return result
        policy = cls.get_or_create_policy(application_id)
        policy.asleep = False
        policy.last_activity_at = datetime.utcnow()
        app.status = 'running'
        db.session.commit()
        logger.info('Container auto-sleep: %s awake', app.name)
        return {'success': True, 'policy': policy.to_dict()}

    @classmethod
    def sweep_idle(cls):
        """Sleep every enabled, awake app whose recorded activity is older than
        its idle timeout. Meant to run periodically (cron/scheduler)."""
        now = datetime.utcnow()
        slept = []
        policies = ContainerSleepPolicy.query.filter_by(enabled=True, asleep=False).all()
        # Policies outlive a soft-deleted app; without this the scheduler keeps
        # running compose_down against a deleted app forever.
        dead = Application.deleted_ids()
        for policy in policies:
            if policy.application_id in dead:
                continue
            if not policy.last_activity_at:
                continue   # no activity baseline yet — never sleep blind
            if now - policy.last_activity_at < timedelta(minutes=policy.idle_timeout_minutes):
                continue
            if cls.sleep_app(policy.application_id).get('success'):
                slept.append(policy.application_id)
        return {'success': True, 'slept': slept}
