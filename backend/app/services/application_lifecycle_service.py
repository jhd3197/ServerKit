"""Application start/stop/restart operations for HTTP, jobs and automation.

Callers authorize access before entering this service. Successful operations
commit their status then invalidate container aggregates; a rejected runtime
operation leaves both untouched. Image materialization retains its separate
commit so a failed first start can be retried using the saved compose project.
"""

import os

from app import db, paths
from app.services.docker_service import DockerService
from app.services.remote_docker_service import RemoteDockerService
from app.services.container_registry_service import ContainerRegistryService
from app.services.unit_compose_service import UnitComposeService
from app.services.worker_process_service import WorkerProcessService
from app.services.app_port_service import AppPortService
from app.services import container_status_service
from app.services.slot_deploy_service import SlotDeployService


class ApplicationLifecycleError(Exception):
    """An operation rejected by the runtime, safe to present to the caller."""


def _compose_target(app):
    """Return the effective compose file path for remote agent deployments."""
    return os.path.join(app.root_path, app.compose_file or 'docker-compose.yml') if app.root_path else None


def _local_compose_file(app):
    """Return the compose file to pass to DockerService for local deployments."""
    return app.compose_file if app.compose_file else None


def _agent_result_failed(result):
    data = result.get('data') if isinstance(result, dict) else None
    return isinstance(data, dict) and data.get('success') is False


def _agent_result_error(result, fallback):
    data = result.get('data') if isinstance(result, dict) else None
    if isinstance(data, dict):
        return data.get('error') or result.get('error') or fallback
    return result.get('error') or fallback


def _assert_managed_app_path(app_name):
    base_dir = os.path.abspath(paths.APPS_DIR)
    app_path = os.path.abspath(os.path.join(base_dir, app_name))
    if app_path != base_dir and app_path.startswith(base_dir + os.sep):
        return app_path
    raise ValueError('Invalid application path')


def _is_single_container_app(app):
    """True when this app's deploy produced one container, not a compose project.

    ``app_type == 'docker'`` is not the same as "compose-managed". The build
    pack deploys by building an image and running a single container
    (``DeploymentService._deploy_docker``, named ``serverkit-app-<id>``) and
    nothing in that path ever writes a compose file, so ``compose_file`` stays
    NULL. Handing that directory to ``docker compose`` fails with "no
    configuration file provided: not found" -- which is what start, stop and
    restart did for every build-pack app.

    Deliberately narrow, and phrased as a positive test rather than "has no
    compose file": compose stays the default for everything, including an app
    whose compose file has not been rendered yet. Only a local build-pack app
    with no compose file recorded and none on disk takes the container path.
    """
    if app.server_id or app.compose_file or not app.root_path:
        return False
    if getattr(app, 'slot_deploys_enabled', False) and app.active_slot:
        return True     # a slot app runs one live container
    if not app.buildpack_type:
        return False
    return not any(
        os.path.isfile(os.path.join(app.root_path, name))
        for name in ('docker-compose.yml', 'docker-compose.yaml',
                     'compose.yml', 'compose.yaml')
    )


def _is_slot_compose_app(app):
    """A compose app on A/B slots: its live release is the slot
    project, not the project the app's own compose file would name."""
    from app.services.slot_deploy_service import SlotDeployService
    return SlotDeployService.is_compose_slot_app(app)


def _app_container_name(app):
    """The single container serving this app.

    ``serverkit-app-<id>`` for an in-place deploy (``DeploymentService.
    _deploy_docker``); the live slot's container for a slot app.
    """
    from app.services.slot_deploy_service import live_container_name
    return live_container_name(app)


def _ensure_local_image_compose(app):
    """Materialize a compose project for a local docker app that carries a
    ``docker_image`` but has no source on disk yet.

    A BYO-image app (e.g. an ``image:`` manifest service with no repository)
    is created with ``docker_image`` set but ``root_path``/``compose_file``
    NULL, so it has nothing to launch. Render a one-service compose from the
    image and its typed ports, write it under APPS_DIR, and persist the paths;
    the normal ``compose_up`` overlay then injects the app's effective env
    (including resolved vault secrets), so nothing sensitive is written here.

    No-op when a source already exists, the app has no image, or it targets a
    remote server (the file must live where the deploy actually runs).
    """
    if app.root_path or not app.docker_image or app.server_id:
        return
    app_path = _assert_managed_app_path(app.name)
    os.makedirs(app_path, exist_ok=True)

    container = {'name': 'app', 'image': app.docker_image}
    ports = AppPortService.get_ports(app)
    if not ports and app.port:
        # Bind the legacy scalar port to loopback — nginx fronts it; publishing
        # 0.0.0.0 (AppPortService._clean's default) would expose it past nginx.
        ports = [{'host_port': app.port, 'container_port': app.port, 'expose': 'local'}]
    if ports:
        container['ports'] = ports
    if app.healthcheck_path:
        container['health_check'] = {'http_path': app.healthcheck_path}

    compose_yaml = UnitComposeService.render_yaml(app.name, [container])
    with open(os.path.join(app_path, 'docker-compose.yml'), 'w') as f:
        f.write(compose_yaml)

    app.root_path = app_path
    app.compose_file = 'docker-compose.yml'
    if not app.managed_by:
        app.managed_by = 'docker_compose'
    db.session.commit()


def _refuse_host_managed(app, action):
    """An adopted host site is served by the host's own nginx and PHP-FPM,
    shared with every other site on the box. There is no per-site runtime to
    start or stop, and flipping the status column would only make the panel
    lie about a site that is still serving."""
    if app.is_host_managed:
        raise ApplicationLifecycleError(
            f'Cannot {action} a host-managed site: it is served by this server\'s '
            'nginx and PHP-FPM, which ServerKit does not control per site.')


def start_application(app, *, user_id=None):
    """Start the configured runtime, materializing local image apps if needed."""
    _refuse_host_managed(app, 'start')
    # A local BYO-image docker app (image set, no source yet) has no compose to
    # launch — materialize one on first start so it can actually run.
    if app.app_type == 'docker' and not app.root_path and app.docker_image and not app.server_id:
        try:
            _ensure_local_image_compose(app)
        except ValueError as e:
            raise ApplicationLifecycleError(str(e)) from e

    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        if app.server_id:
            result = RemoteDockerService.compose_up(
                app.server_id,
                _compose_target(app),
                detach=True,
                user_id=user_id
            )
        elif _is_slot_compose_app(app):
            result = SlotDeployService.live_action(app, 'start')
        elif _is_single_container_app(app):
            # Build-pack app: one container, created by the deploy.
            container = _app_container_name(app)
            if not DockerService.get_container(container):
                raise ApplicationLifecycleError(
                    'This application has not been deployed yet. '
                    'Run a deploy to build its image and create the container.'
                )
            result = DockerService.start_container(container)
            WorkerProcessService.each(app, 'start')
        else:
            # Authenticate a bound private registry before compose pulls the
            # image; best-effort, always logs back out. No-op without registry_id.
            _registry = ContainerRegistryService.login_for_app(app)
            try:
                result = DockerService.compose_up(
                    app.root_path,
                    detach=True,
                    compose_file=_local_compose_file(app)
                )
            finally:
                ContainerRegistryService.logout_for_app(_registry)
        if not result.get('success') or _agent_result_failed(result):
            raise ApplicationLifecycleError(
                _agent_result_error(result, 'Failed to start containers')
            )

    app.status = 'running'
    db.session.commit()
    # The cached aggregate now describes the pre-start world. Drop it: a status
    # pill that survives the action that changed it reads as a broken panel.
    container_status_service.invalidate(app.id)


def stop_application(app, *, user_id=None):
    """Stop the configured runtime; a vanished single container is stopped."""
    _refuse_host_managed(app, 'stop')
    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        if app.server_id:
            result = RemoteDockerService.compose_down(
                app.server_id,
                _compose_target(app),
                user_id=user_id
            )
        elif _is_slot_compose_app(app):
            result = SlotDeployService.live_action(app, 'stop')
        elif _is_single_container_app(app):
            # A container that no longer exists is already stopped -- reporting
            # that as a failure would strand the app in `running` forever.
            container = _app_container_name(app)
            result = ({'success': True} if not DockerService.get_container(container)
                      else DockerService.stop_container(container))
            WorkerProcessService.each(app, 'stop')
            # A stopped app keeps no warm standby running behind it.
            if getattr(app, 'slot_deploys_enabled', False):
                SlotDeployService.stop_standby(app)
        else:
            result = DockerService.compose_down(
                app.root_path,
                compose_file=_local_compose_file(app)
            )
        if not result.get('success') or _agent_result_failed(result):
            raise ApplicationLifecycleError(
                _agent_result_error(result, 'Failed to stop containers')
            )

    app.status = 'stopped'
    db.session.commit()
    container_status_service.invalidate(app.id)


def restart_application(app, *, user_id=None):
    """Restart the configured runtime, requiring a deployed single container."""
    _refuse_host_managed(app, 'restart')
    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        if app.server_id:
            result = RemoteDockerService.compose_restart(
                app.server_id,
                _compose_target(app),
                user_id=user_id
            )
        elif _is_slot_compose_app(app):
            result = SlotDeployService.live_action(app, 'restart')
        elif _is_single_container_app(app):
            container = _app_container_name(app)
            if not DockerService.get_container(container):
                raise ApplicationLifecycleError(
                    'This application has not been deployed yet. '
                    'Run a deploy to build its image and create the container.'
                )
            result = DockerService.restart_container(container)
            WorkerProcessService.each(app, 'restart')
        else:
            result = DockerService.compose_restart(
                app.root_path,
                compose_file=_local_compose_file(app)
            )
        if not result.get('success') or _agent_result_failed(result):
            raise ApplicationLifecycleError(
                _agent_result_error(result, 'Failed to restart containers')
            )

    app.status = 'running'
    db.session.commit()
    container_status_service.invalidate(app.id)
