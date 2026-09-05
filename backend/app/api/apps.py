# Bucket: PER-APP (plan 29 #9). Per-app routes gate on the shared app-access
# seam via the file-local _can_access_app (reads) / _can_edit_app (writes)
# helpers, or the hand-rolled owner-or-admin idiom; host/system ops stay admin.
import os
import json
import re
import shutil
from datetime import datetime
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy.orm import joinedload
from app import db
from app.api._query import apply_query, QueryParseError
from app.models import Application, User
from app.utils.slug import app_name_clash_error, slugify
from app.services.build_service import BuildService
from app.services.docker_service import DockerService
from app.services.git_service import GitService
from app.services.repository_manifest_service import RepositoryManifestService
from app.services.source_connection_service import SourceConnectionService
from app.services.remote_docker_service import RemoteDockerService
from app.services.container_registry_service import ContainerRegistryService
from app.services.image_update_service import ImageUpdateService
from app.services import container_status_service
from app.services.container_sleep_service import ContainerSleepService
from app.services.container_scale_service import ContainerScaleService
from app.services.unit_compose_service import UnitComposeService
from app.services.app_port_service import AppPortService
from app.services.log_service import LogService
from app.services.process_service import ProcessService
from app.services.backup_policy_service import BackupPolicyService, BackupPolicyError
from app.services.upload_service import (
    ensure_app_dirs,
    validate_zip,
    extract_version,
    preserve_existing_env,
    switch_current_version,
    backup_current,
    save_upload_zip,
    detect_app_type,
    get_app_storage_dir,
    list_versions,
    get_current_version,
)
from app import paths
from app.middleware.rbac import get_current_user, require_admin_user

apps_bp = Blueprint('apps', __name__)


def _compose_target(app):
    """Return the effective compose file path for remote agent deployments."""
    if app.server_id and app.root_path:
        return os.path.join(app.root_path, app.compose_file or 'docker-compose.yml')
    return os.path.join(app.root_path, app.compose_file or 'docker-compose.yml') if app.root_path else None


def _local_compose_file(app):
    """Return the compose file to pass to DockerService for local deployments."""
    return app.compose_file if app.compose_file else None


def _remove_data_flag(app):
    """Should ``DELETE /apps/<id>`` take the data volumes down with the app?

    Explicit wins: ``?remove_data=`` (alias ``?volumes=``) is honored as given.
    With neither present, database engines default to PRESERVING their volumes
    -- the data is the whole point of the engine and its loss is the only
    irreversible part of an uninstall -- while every other app keeps the
    historic "remove volumes too" behavior.
    """
    raw = request.args.get('remove_data')
    if raw is None:
        raw = request.args.get('volumes')
    if raw is not None:
        return str(raw).strip().lower() in ('1', 'true', 'yes', 'on')
    try:
        from app.services.database_engine_service import is_engine_app
        return not is_engine_app(app)
    except Exception:
        return True


def _sync_manual_app_status(app):
    """Update app.status from the real runtime for manual/local apps."""
    if app.source != 'manual':
        return
    if app.managed_by == 'systemd' and app.systemd_unit:
        status = ProcessService.get_systemd_unit_status(app.systemd_unit)
        actual = 'running' if status.get('active') else 'stopped'
    elif app.managed_by == 'docker_compose' and app.root_path:
        status = ProcessService.get_compose_project_status(app.root_path, compose_file=app.compose_file)
        actual = status.get('status', 'stopped')
    else:
        return

    if actual in ('running', 'stopped') and app.status != actual:
        app.status = actual
        db.session.commit()


def _agent_result_failed(result):
    data = result.get('data') if isinstance(result, dict) else None
    return isinstance(data, dict) and data.get('success') is False


def _agent_result_error(result, fallback):
    data = result.get('data') if isinstance(result, dict) else None
    if isinstance(data, dict):
        return data.get('error') or result.get('error') or fallback
    return result.get('error') or fallback


def _service_slug(value):
    return slugify(value)


def _derive_repo_app_type(detection):
    if detection.get('has_dockerfile') or detection.get('has_docker_compose'):
        return 'docker'
    framework = detection.get('framework')
    language = detection.get('language')
    if framework == 'django':
        return 'django'
    if framework in ['flask', 'fastapi'] or language == 'python':
        return 'flask'
    if framework == 'laravel' or language == 'php':
        return 'php'
    return 'static'


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
    if not app.buildpack_type:
        return False
    return not any(
        os.path.isfile(os.path.join(app.root_path, name))
        for name in ('docker-compose.yml', 'docker-compose.yaml',
                     'compose.yml', 'compose.yaml')
    )


def _app_container_name(app):
    """The single container a build-pack deploy creates for this app.

    Must match ``DeploymentService._deploy_docker``, which names it
    ``serverkit-app-<id>``.
    """
    return f'serverkit-app-{app.id}'


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


def _safe_repo_url(repo_url):
    return re.sub(r'^(https?://)[^@]+@', r'\1', repo_url or '')


def _attach_deploy_config(payload, deploy_configs=None):
    deploy_configs = deploy_configs or GitService.get_config().get('apps', {})
    deploy_config = deploy_configs.get(str(payload.get('id')))

    payload['last_deploy_at'] = payload.get('last_deployed_at')
    payload['deploy_configured'] = deploy_config is not None
    if deploy_config:
        payload['deploy_repo_url'] = _safe_repo_url(deploy_config.get('repo_url'))
        payload['deploy_branch'] = deploy_config.get('branch')
        payload['auto_deploy'] = deploy_config.get('auto_deploy', False)
        payload['last_deploy_at'] = deploy_config.get('last_deploy')
    return payload


# ==================== ENVIRONMENT LINKING ====================

@apps_bp.route('/<int:app_id>/link', methods=['POST'])
@jwt_required()
def link_apps(app_id):
    """Link two apps as prod/dev pair sharing database resources."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    target_app_id = data.get('target_app_id')
    as_environment = data.get('as_environment', 'development')

    if not target_app_id:
        return jsonify({'error': 'target_app_id is required'}), 400

    valid_environments = ['production', 'development', 'staging']
    if as_environment not in valid_environments:
        return jsonify({'error': f'Invalid environment. Must be one of: {", ".join(valid_environments)}'}), 400

    target_app = Application.query_active().filter_by(id=target_app_id).first()
    if not target_app:
        return jsonify({'error': 'Target application not found'}), 404

    if not _can_edit_app(user, target_app):
        return jsonify({'error': 'Access denied to target application'}), 403

    if app.app_type != target_app.app_type:
        return jsonify({'error': 'Apps must be of the same type to link'}), 400

    if app_id == target_app_id:
        return jsonify({'error': 'Cannot link an app to itself'}), 400

    # Set environment types based on as_environment
    if as_environment == 'development':
        app.environment_type = 'development'
        target_app.environment_type = 'production'
    elif as_environment == 'production':
        app.environment_type = 'production'
        target_app.environment_type = 'development'
    else:  # staging
        app.environment_type = 'staging'
        target_app.environment_type = 'production'

    # Link bidirectionally
    app.linked_app_id = target_app_id
    target_app.linked_app_id = app_id

    # Store shared config
    from datetime import datetime
    shared_config = {
        'linked_at': datetime.now().isoformat(),
        'link_type': 'environment_pair'
    }

    # Propagate DB credentials for Docker/WordPress apps
    propagation_result = None
    if app.app_type == 'docker' and data.get('propagate_credentials', True):
        from app.services.template_service import TemplateService
        # Determine which app is the source (prod) and which is target (dev)
        if as_environment == 'development':
            # Current app is dev, target is prod - propagate from target to current
            propagation_result = TemplateService.propagate_db_credentials(
                target_app_id, app_id, data.get('table_prefix')
            )
        else:
            # Current app is prod, target is dev - propagate from current to target
            propagation_result = TemplateService.propagate_db_credentials(
                app_id, target_app_id, data.get('table_prefix')
            )

        if propagation_result and propagation_result.get('success'):
            shared_config['db_credentials_propagated'] = True
            shared_config['shared_db'] = propagation_result.get('shared_config', {})

    app.shared_config = json.dumps(shared_config)
    target_app.shared_config = json.dumps(shared_config)

    db.session.commit()

    response = {
        'message': 'Apps linked successfully',
        'app': app.to_dict(include_linked=True),
        'target_app': target_app.to_dict(include_linked=True)
    }
    if propagation_result:
        response['credential_propagation'] = propagation_result

    return jsonify(response), 200


@apps_bp.route('/<int:app_id>/linked', methods=['GET'])
@jwt_required()
def get_linked_apps(app_id):
    """Get apps linked to this app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    linked_apps = []

    # Get directly linked app
    if app.linked_app:
        linked_apps.append({
            'id': app.linked_app.id,
            'name': app.linked_app.name,
            'app_type': app.linked_app.app_type,
            'environment_type': app.linked_app.environment_type,
            'status': app.linked_app.status,
            'port': app.linked_app.port
        })

    # Get apps that link to this one
    for linked_from in app.linked_from:
        if linked_from.id != app.linked_app_id:  # Avoid duplicates
            linked_apps.append({
                'id': linked_from.id,
                'name': linked_from.name,
                'app_type': linked_from.app_type,
                'environment_type': linked_from.environment_type,
                'status': linked_from.status,
                'port': linked_from.port
            })

    return jsonify({
        'app_id': app_id,
        'environment_type': app.environment_type,
        'linked_apps': linked_apps,
        'shared_config': json.loads(app.shared_config) if app.shared_config else None
    }), 200


@apps_bp.route('/<int:app_id>/link', methods=['DELETE'])
@jwt_required()
def unlink_apps(app_id):
    """Unlink apps and reset environment types."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    if not app.linked_app_id:
        return jsonify({'error': 'App is not linked to any other app'}), 400

    # Deliberately NOT query_active: this is the reciprocal half of a link the
    # caller is severing, not "an app to operate on". If the partner is already
    # in the recycle bin its back-pointer still has to be cleared, or it would
    # restore holding a link to an app that no longer links back.
    target_app = Application.query.get(app.linked_app_id)

    # Reset both apps
    app.linked_app_id = None
    app.environment_type = 'standalone'
    app.shared_config = None

    if target_app:
        target_app.linked_app_id = None
        target_app.environment_type = 'standalone'
        target_app.shared_config = None

    db.session.commit()

    return jsonify({
        'message': 'Apps unlinked successfully',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/environment', methods=['PUT'])
@jwt_required()
def update_environment(app_id):
    """Update environment type for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    environment_type = data.get('environment_type')
    valid_types = ['production', 'development', 'staging', 'standalone']

    if environment_type not in valid_types:
        return jsonify({'error': f'Invalid environment_type. Must be one of: {", ".join(valid_types)}'}), 400

    app.environment_type = environment_type
    db.session.commit()

    return jsonify({
        'message': 'Environment type updated',
        'app': app.to_dict()
    }), 200


# ==================== APP CRUD ====================


@apps_bp.route('', methods=['GET'])
@jwt_required()
def get_apps():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    # Optional filter by environment type
    environment_filter = request.args.get('environment')
    include_linked = request.args.get('include_linked', 'false').lower() == 'true'

    # Workspace-aware scoping (#33). With no workspace context this is exactly the
    # prior behavior (admin -> all, else -> own); with ?workspace_id / X-Workspace-Id
    # it filters to that workspace (membership-checked).
    from app.services.workspace_service import WorkspaceService
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    # query_active() is the base the whole chain narrows: scope_query and
    # apply_query only ever add filters, so scoping here keeps deleted apps out
    # of the list (and out of $filter/$top/total) without touching either.
    query = WorkspaceService.scope_query(Application.query_active(), Application, user,
                                         workspace_id=ws_id, owner_attr='user_id',
                                         grant_resource_type='application')

    if environment_filter:
        query = query.filter_by(environment_type=environment_filter)

    # $select / $filter / $orderby / $skip / $top. All optional: with none of
    # them present this is a no-op and the response is byte-identical to before.
    try:
        narrowed = apply_query(query, Application, request,
                               select_extra=Application.DERIVED_FIELDS)
    except QueryParseError as exc:
        return jsonify({'error': str(exc)}), 400
    query = narrowed.query
    fields = narrowed.fields

    # Eager-load the scalar relationships to_dict resolves names through, but
    # ONLY when this request actually asked for those names — a joinedload for a
    # field nobody selected is a wider row for nothing. `image_scans` and
    # `image_update_checks` are deliberately absent: they are lazy='dynamic',
    # so the attribute IS a Query and no loader option can hoist it. Declining
    # them via $select is the only way to avoid their per-row cost.
    eager = []
    if fields is None or 'server_name' in fields:
        eager.append(joinedload(Application.server))
    if fields is None or 'project_name' in fields:
        eager.append(joinedload(Application.project))
    if fields is None or 'environment_name' in fields:
        eager.append(joinedload(Application.environment))
    if include_linked and (fields is None or 'linked_app' in fields):
        eager.append(joinedload(Application.linked_app))
    if eager:
        query = query.options(*eager)

    apps = query.all()
    deploy_configs = GitService.get_config().get('apps', {})

    payload = {
        'apps': [
            _attach_deploy_config(
                app.to_dict(include_linked=include_linked, fields=fields), deploy_configs)
            for app in apps
        ]
    }
    # Paging metadata only appears once a caller pages, so the existing
    # response shape is untouched for everyone who does not.
    if narrowed.total is not None:
        payload['meta'] = narrowed.as_meta()
    return jsonify(payload), 200


@apps_bp.route('/<int:app_id>/workspace', methods=['PUT'])
@jwt_required()
def set_app_workspace(app_id):
    """Reassign an application to a workspace (#33). Owner-or-admin on the app;
    the target must be a workspace the caller can access (member or admin). A
    null/'default' target moves it back to the default workspace."""
    from app.models.workspace import Workspace
    from app.services.workspace_service import WorkspaceService
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    # Use user.id (int) for comparisons — get_jwt_identity() is the stringified token id.
    if not user.is_admin and app.user_id != user.id:
        return jsonify({'error': 'Access denied'}), 403

    target = (request.get_json() or {}).get('workspace_id')
    if target in (None, '', 'default'):
        ws_id = WorkspaceService.ensure_default_workspace().id
    else:
        ws = Workspace.query.get(target)
        if not ws:
            return jsonify({'error': 'Workspace not found'}), 404
        if not user.is_admin and WorkspaceService.get_user_role(ws.id, user.id) is None:
            return jsonify({'error': 'Not a member of the target workspace'}), 403
        # Role reconciliation (#33): a 'viewer' member can't move resources into it.
        if not WorkspaceService.can_write_in_workspace(user, ws.id):
            return jsonify({'error': 'You have read-only access to the target workspace'}), 403
        ws_id = ws.id

    app.workspace_id = ws_id
    db.session.commit()
    return jsonify({'message': 'Workspace updated', 'app': app.to_dict()}), 200


@apps_bp.route('/move-to-project', methods=['POST'])
@jwt_required()
def move_apps_to_project():
    """Bulk-assign apps to a project/environment (or unassign them).

    Body: ``{app_ids: [...], project_id, environment_id}``.

    Mirrors the per-create ``_resolve_project_env`` validation, but PER APP so a
    mixed-workspace selection is handled safely:

      - The project must belong to the app's own workspace.
      - The environment must belong to that project.

    Invalid pairings are silently dropped to None (the app is unassigned rather
    than mis-assigned) — never an error. ``project_id: null`` unassigns. Only
    apps the caller can edit are touched; the rest are skipped. Returns the
    updated rows.
    """
    from app.models.project import Project
    from app.models.environment import Environment

    user = get_current_user()
    data = request.get_json() or {}

    raw_ids = data.get('app_ids')
    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({'error': 'app_ids must be a non-empty list'}), 400

    def _as_int(v):
        if v in (None, '', 'null'):
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    app_ids = [i for i in (_as_int(x) for x in raw_ids) if i is not None]
    req_project_id = _as_int(data.get('project_id'))
    req_environment_id = _as_int(data.get('environment_id'))

    updated = []
    skipped = []
    for app_id in app_ids:
        app = Application.query_active().filter_by(id=app_id).first()
        if not app:
            skipped.append(app_id)
            continue
        if not _can_edit_app(user, app):
            skipped.append(app_id)
            continue

        if req_project_id is None:
            # Explicit unassign.
            app.project_id = None
            app.environment_id = None
            updated.append(app)
            continue

        # Validate the project belongs to THIS app's workspace.
        project = Project.query.get(req_project_id)
        if project is None or project.workspace_id != app.workspace_id:
            # Invalid for this app → drop the assignment (unassign), never error.
            app.project_id = None
            app.environment_id = None
            updated.append(app)
            continue

        # Validate the environment belongs to the resolved project.
        environment_id = req_environment_id
        if environment_id is not None:
            env = Environment.query.get(environment_id)
            if env is None or env.project_id != project.id:
                environment_id = None

        app.project_id = project.id
        app.environment_id = environment_id
        updated.append(app)

    db.session.commit()

    return jsonify({
        'message': f'Updated {len(updated)} application(s)',
        'apps': [a.to_dict() for a in updated],
        'skipped': skipped,
    }), 200


def _resolve_project_env(data, workspace_id):
    """Validate optional project_id/environment_id from a create payload against
    the app's workspace. Returns (project_id, environment_id) with invalid values
    silently ignored (set to None), so a bad/foreign id can never break a create.

    - project must belong to `workspace_id`.
    - environment must belong to that project; if an environment is supplied
      without a project, its parent project is used (still workspace-checked).
    """
    from app.models.project import Project
    from app.models.environment import Environment

    def _as_int(v):
        if v in (None, '', 'null'):
            return None
        try:
            return int(v)
        except (TypeError, ValueError):
            return None

    project_id = _as_int(data.get('project_id'))
    environment_id = _as_int(data.get('environment_id'))
    if project_id is None and environment_id is None:
        return None, None

    env = None
    if environment_id is not None:
        env = Environment.query.get(environment_id)
        if env is None:
            environment_id = None
        elif project_id is None:
            project_id = env.project_id

    project = Project.query.get(project_id) if project_id is not None else None
    if project is None or project.workspace_id != workspace_id:
        # No valid project in this workspace -> drop both.
        return None, None

    # Environment must belong to the resolved project.
    if env is not None and env.project_id != project.id:
        environment_id = None
    return project.id, environment_id


def _resolve_ingress_plane(data, app_type, managed_by=None):
    """Resolve the ingress plane ('nginx' | 'proxy_stack') for a new app.

    Defaults to host Nginx. A requested 'proxy_stack' is only honored for
    container-based services; for every other type it falls back to nginx, so
    the boundary between the two reverse proxies stays explicit and a PHP/
    WordPress/static/Python app can never be tagged for a Dockerized proxy.
    """
    from app.utils.ingress import normalize_ingress_plane
    return normalize_ingress_plane(data.get('ingress_plane'), app_type, managed_by)


def _can_access_app(user, app):
    """Read access (#33 ACL) — delegates to the shared seam."""
    from app.services.resource_grant_service import ResourceGrantService
    return ResourceGrantService.can_access_app(user, app)


def _can_edit_app(user, app):
    """Write/operate access (#33 ACL) — delegates to the shared seam."""
    from app.services.resource_grant_service import ResourceGrantService
    return ResourceGrantService.can_edit_app(user, app)


@apps_bp.route('/<int:app_id>', methods=['GET'])
@jwt_required()
def get_app(app_id):
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Single app requests include linked app info by default
    return jsonify({'app': _attach_deploy_config(app.to_dict(include_linked=True))}), 200


@apps_bp.route('/<int:app_id>/compose-services', methods=['GET'])
@jwt_required()
def get_compose_services(app_id):
    """List the compose service names for an app.

    Lets the env-var editor offer a per-service targeting choice. Empty for
    non-compose apps or when the base compose can't be read.
    """
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    from app.services.compose_env_service import ComposeEnvService
    return jsonify({'services': ComposeEnvService.list_services(app)}), 200


# ---- Per-resource access grants (#33 per-site ACL): share an app with a user ----

@apps_bp.route('/<int:app_id>/grants', methods=['GET'])
@jwt_required()
def list_app_grants(app_id):
    """List who has been granted access to this app (owner-or-admin)."""
    from app.services.resource_grant_service import ResourceGrantService
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not user.is_admin and app.user_id != user.id:
        return jsonify({'error': 'Access denied'}), 403
    grants = ResourceGrantService.list_for_resource('application', app.id)
    return jsonify({'grants': [g.to_dict() for g in grants]}), 200


@apps_bp.route('/<int:app_id>/grants', methods=['POST'])
@jwt_required()
def grant_app_access(app_id):
    """Grant a user access to this app (owner-or-admin). Body: {user_id, role?}."""
    from app.services.resource_grant_service import ResourceGrantService
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not user.is_admin and app.user_id != user.id:
        return jsonify({'error': 'Access denied'}), 403
    data = request.get_json() or {}
    grantee_id = data.get('user_id')
    if not grantee_id:
        return jsonify({'error': 'user_id is required'}), 400
    grantee = User.query.get(grantee_id)
    if not grantee:
        return jsonify({'error': 'User not found'}), 404
    if grantee.id == app.user_id:
        return jsonify({'error': 'The owner already has access'}), 400
    role = data.get('role') or 'editor'
    if role not in ('viewer', 'editor'):
        return jsonify({'error': "role must be 'viewer' or 'editor'"}), 400
    grant = ResourceGrantService.grant(user_id=grantee.id, resource_type='application',
                                       resource_id=app.id, granted_by=user.id, role=role)
    return jsonify({'grant': grant.to_dict()}), 201


@apps_bp.route('/<int:app_id>/grants/<int:grant_id>', methods=['DELETE'])
@jwt_required()
def revoke_app_access(app_id, grant_id):
    """Revoke a grant on this app (owner-or-admin)."""
    from app.services.resource_grant_service import ResourceGrantService
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not user.is_admin and app.user_id != user.id:
        return jsonify({'error': 'Access denied'}), 403
    ok = ResourceGrantService.revoke(grant_id, resource_type='application', resource_id=app.id)
    return jsonify({'success': ok}), (200 if ok else 404)


@apps_bp.route('/from-repository', methods=['POST'])
@jwt_required()
def create_app_from_repository():
    """Create a new application by cloning a Git repository."""
    user = require_admin_user()

    data = request.get_json() or {}
    name = _service_slug(data.get('name'))
    repo_url = (data.get('repo_url') or '').strip()
    source_connection_id = data.get('source_connection_id')
    repository_full_name = (data.get('repository_full_name') or '').strip()
    branch = (data.get('branch') or 'main').strip()
    app_type = (data.get('app_type') or 'auto').strip().lower()
    build_method = (data.get('build_method') or 'auto').strip().lower()
    auto_deploy = bool(data.get('auto_deploy', True))
    port = data.get('port')
    dockerfile_path = (data.get('dockerfile_path') or '').strip() or None
    custom_build_cmd = (data.get('custom_build_cmd') or '').strip() or None
    custom_start_cmd = (data.get('custom_start_cmd') or '').strip() or None
    # Build-pack plan/overrides (optional). Provided by the detection step in the
    # New Service wizard. Persisted on the Application so the generated Dockerfile
    # is reproducible and the Build tab can render the plan.
    buildpack_plan = data.get('buildpack_plan') if isinstance(data.get('buildpack_plan'), dict) else None
    buildpack_overrides = data.get('buildpack_overrides') if isinstance(data.get('buildpack_overrides'), dict) else None

    if not name or len(name) < 2:
        return jsonify({'error': 'Service name must be at least 2 characters'}), 400
    if source_connection_id:
        try:
            source_repo = SourceConnectionService.get_authenticated_clone_url(
                user_id=user.id,
                connection_id=int(source_connection_id),
                full_name=repository_full_name,
            )
            clone_repo_url = source_repo['clone_url']
            deploy_repo_url = source_repo['public_url']
        except (TypeError, ValueError) as exc:
            return jsonify({'error': str(exc)}), 400
    else:
        clone_repo_url = repo_url
        deploy_repo_url = repo_url

    if not clone_repo_url:
        return jsonify({'error': 'repo_url is required'}), 400

    valid_app_types = ['auto', 'docker', 'flask', 'django', 'php', 'static']
    if app_type not in valid_app_types:
        return jsonify({'error': f'Invalid app_type. Must be one of: {", ".join(valid_app_types)}'}), 400

    valid_build_methods = ['auto', 'dockerfile', 'nixpacks', 'custom']
    if build_method not in valid_build_methods:
        return jsonify({'error': f'Invalid build_method. Must be one of: {", ".join(valid_build_methods)}'}), 400

    if port in ['', None]:
        port = None
    elif isinstance(port, int) or (isinstance(port, str) and port.isdigit()):
        port = int(port)
    else:
        return jsonify({'error': 'port must be a number'}), 400

    # NOT query_active: a tombstone keeps reserving its name (and, below, its
    # directory under APPS_DIR). Letting a new app take the name of one sitting
    # in the recycle bin would make the restore collide.
    clash = app_name_clash_error(
        Application.query.filter_by(name=name, server_id=None).first(), name)
    if clash:
        return jsonify({'error': clash}), 400

    try:
        app_path = _assert_managed_app_path(name)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    if os.path.exists(app_path):
        return jsonify({'error': f'App directory already exists: {app_path}'}), 400

    clone_result = GitService.clone_repository(app_path, clone_repo_url, branch or None)
    if not clone_result.get('success'):
        if clone_repo_url != deploy_repo_url and clone_result.get('error'):
            clone_result['error'] = clone_result['error'].replace(clone_repo_url, deploy_repo_url)
        return jsonify(clone_result), 400

    manifest = RepositoryManifestService.analyze_path(app_path)
    recommended = manifest.get('recommended') or {}
    manifest_strategy = manifest.get('strategy')
    detection = BuildService.detect_build_method(app_path)
    manifest_app_type_strategies = {
        'serverkit',
        'docker_compose',
        'render',
        'railway',
        'dockerfile',
        'app_json',
    }
    resolved_app_type = (
        (recommended.get('app_type') if manifest_strategy in manifest_app_type_strategies else None)
        or _derive_repo_app_type(detection)
    ) if app_type == 'auto' else app_type
    resolved_build_method = build_method
    if build_method == 'auto':
        resolved_build_method = (
            recommended.get('build_method') if manifest_strategy else None
        ) or detection.get('build_method') or 'auto'
        if resolved_build_method == 'custom' and not (custom_build_cmd or recommended.get('custom_build_cmd')):
            resolved_build_method = 'auto'
    if not port:
        port = recommended.get('port')
    dockerfile_path = dockerfile_path or recommended.get('dockerfile_path') or 'Dockerfile'
    custom_build_cmd = custom_build_cmd or recommended.get('custom_build_cmd')
    custom_start_cmd = custom_start_cmd or recommended.get('custom_start_cmd')

    # When the build method routes through the build-pack layer, persist the
    # (possibly overridden) plan on the Application so the generated Dockerfile is
    # reproducible. Detect from the freshly-cloned source if no plan was supplied.
    buildpack_type = None
    if resolved_build_method in ('nixpacks', 'auto'):
        from app.services.buildpack_service import BuildpackService
        effective_plan = buildpack_plan or BuildpackService.detect(app_path)
        if buildpack_overrides:
            effective_plan = BuildpackService.apply_overrides(effective_plan, buildpack_overrides)
        buildpack_plan = effective_plan
        buildpack_type = (effective_plan or {}).get('builder')

    # Optional Project / Environment assignment. Validated against the resolved
    # workspace; invalid/foreign ids are silently dropped (non-breaking).
    from app.services.workspace_service import WorkspaceService
    _ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    if _ws_id is None:
        _ws_id = WorkspaceService.ensure_default_workspace().id
    project_id, environment_id = _resolve_project_env(data, _ws_id)

    app = Application(
        name=name,
        app_type=resolved_app_type,
        status='stopped',
        root_path=app_path,
        user_id=user.id,
        port=port,
        buildpack_type=buildpack_type,
        buildpack_plan=json.dumps(buildpack_plan) if buildpack_plan else None,
        buildpack_overrides=json.dumps(buildpack_overrides) if buildpack_overrides else None,
        ingress_plane=_resolve_ingress_plane(data, resolved_app_type),
        project_id=project_id,
        environment_id=environment_id,
    )

    try:
        db.session.add(app)
        db.session.commit()

        deploy_result = GitService.configure_deployment(
            app_id=app.id,
            app_path=app.root_path,
            repo_url=deploy_repo_url,
            branch=branch or 'main',
            auto_deploy=auto_deploy,
        )
        if not deploy_result.get('success'):
            raise RuntimeError(deploy_result.get('error', 'Failed to configure deployment'))

        build_result = BuildService.configure_build(
            app_id=app.id,
            app_path=app.root_path,
            build_method=resolved_build_method,
            dockerfile_path=dockerfile_path,
            custom_build_cmd=custom_build_cmd,
            custom_start_cmd=custom_start_cmd,
            buildpack_plan=buildpack_plan,
            buildpack_overrides=buildpack_overrides,
        )
        if not build_result.get('success'):
            raise RuntimeError(build_result.get('error', 'Failed to configure build'))

        # Stop dropping what we detect: persist the manifest, seed non-secret
        # env values, and record the health-check path (plan 17, Phase 1).
        manifest_summary = None
        try:
            from app.services.manifest_persistence_service import ManifestPersistenceService
            manifest_summary = ManifestPersistenceService.apply_import(
                app, manifest, user_id=user.id,
                source_repo=deploy_repo_url, source_ref=branch or 'main',
            )
        except Exception:
            manifest_summary = None

        # Actually deploy + start the service: hand it to the same observable
        # DeploymentJob pipeline template installs use (kind 'app_deploy' →
        # unified job 'deploy.app' → DeploymentService.deploy). A queue failure
        # must NOT fail app creation — the service stays 'stopped' and the user
        # can deploy manually from the Builds tab.
        deploy_job_id = None
        try:
            from app.services.deployment_job_service import DeploymentJobService
            enqueue_result = DeploymentJobService.enqueue_app_deploy(
                app, user_id=user.id, trigger='install')
            if enqueue_result.get('success'):
                deploy_job_id = enqueue_result.get('job_id')
            else:
                current_app.logger.warning(
                    'app deploy enqueue failed for app %s: %s',
                    app.id, enqueue_result.get('error'))
        except Exception as exc:
            current_app.logger.warning(
                'app deploy enqueue failed for app %s: %s', app.id, exc)

        return jsonify({
            'message': 'Repository service created',
            'app': _attach_deploy_config(app.to_dict(include_linked=True)),
            'deploy_job_id': deploy_job_id,
            'manifest_import': manifest_summary,
            'deploy_config': {
                'repo_url': _safe_repo_url(deploy_repo_url),
                'branch': branch or 'main',
                'auto_deploy': auto_deploy,
                'webhook_url': deploy_result.get('webhook_url'),
            },
            'build_config': build_result.get('config'),
            'detection': detection,
            'manifest': manifest,
        }), 201
    except Exception as exc:
        db.session.rollback()
        if app.id:
            GitService.remove_deployment(app.id)
            # Unwinding a create that failed, not deleting an app someone made:
            # a hard delete (no query_active, no tombstone) is what belongs
            # here — a half-created service must not land in the recycle bin.
            existing_app = Application.query.get(app.id)
            if existing_app:
                db.session.delete(existing_app)
                db.session.commit()
        if os.path.abspath(app_path).startswith(os.path.abspath(paths.APPS_DIR) + os.sep):
            shutil.rmtree(app_path, ignore_errors=True)
        return jsonify({'error': str(exc)}), 400


@apps_bp.route('', methods=['POST'])
@jwt_required()
def create_app():
    current_user_id = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    name = data.get('name')
    app_type = data.get('app_type')

    if not all([name, app_type]):
        return jsonify({'error': 'Missing required fields: name, app_type'}), 400

    valid_types = ['php', 'wordpress', 'flask', 'django', 'docker', 'static']
    if app_type not in valid_types:
        return jsonify({'error': f'Invalid app_type. Must be one of: {", ".join(valid_types)}'}), 400

    # Stamp the workspace (#33): the requested one (membership-checked) or the default.
    from app.services.workspace_service import WorkspaceService
    user = User.query.get(current_user_id)
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    # Role reconciliation (#33): a workspace 'viewer' member has read-only access to
    # the active workspace and may not create resources in it (checked only when a
    # workspace context is explicitly active, so no-context behavior is unchanged).
    if ws_id is not None and not WorkspaceService.can_write_in_workspace(user, ws_id):
        return jsonify({'error': 'You have read-only access to this workspace'}), 403
    if ws_id is None:
        ws_id = WorkspaceService.ensure_default_workspace().id

    project_id, environment_id = _resolve_project_env(data, ws_id)

    app = Application(
        name=name,
        app_type=app_type,
        status='stopped',
        php_version=data.get('php_version'),
        python_version=data.get('python_version'),
        port=data.get('port'),
        root_path=data.get('root_path'),
        docker_image=data.get('docker_image'),
        registry_id=data.get('registry_id'),
        source=data.get('source') or 'github',
        compose_file=data.get('compose_file'),
        systemd_unit=data.get('systemd_unit'),
        managed_by=data.get('managed_by'),
        ingress_plane=_resolve_ingress_plane(data, app_type, data.get('managed_by')),
        user_id=current_user_id,
        workspace_id=ws_id,
        project_id=project_id,
        environment_id=environment_id,
    )

    db.session.add(app)
    db.session.commit()

    return jsonify({
        'message': 'Application created successfully',
        'app': app.to_dict()
    }), 201


@apps_bp.route('/manual', methods=['POST'])
@jwt_required()
def create_manual_app():
    """Register an app that already exists on the server (manual/local)."""
    user = require_admin_user()

    data = request.get_json() or {}
    name = _service_slug(data.get('name'))
    app_type = (data.get('app_type') or 'docker').strip().lower()
    root_path = (data.get('root_path') or '').strip()
    compose_file = (data.get('compose_file') or '').strip() or None
    systemd_unit = (data.get('systemd_unit') or '').strip() or None
    managed_by = (data.get('managed_by') or '').strip().lower() or None

    if not name or len(name) < 2:
        return jsonify({'error': 'Service name must be at least 2 characters'}), 400

    valid_types = ['docker', 'flask', 'django', 'php', 'static', 'wordpress']
    if app_type not in valid_types:
        return jsonify({'error': f'Invalid app_type. Must be one of: {", ".join(valid_types)}'}), 400

    if not root_path:
        return jsonify({'error': 'root_path is required'}), 400

    root_path = os.path.abspath(root_path)
    if not os.path.isdir(root_path):
        return jsonify({'error': f'Path does not exist: {root_path}'}), 400

    # Auto-detect managed_by if not provided
    if not managed_by:
        if compose_file or os.path.exists(os.path.join(root_path, 'docker-compose.yml')):
            managed_by = 'docker_compose'
        elif systemd_unit:
            managed_by = 'systemd'
        else:
            managed_by = 'docker_compose'

    if managed_by not in ('docker_compose', 'systemd'):
        return jsonify({'error': "managed_by must be 'docker_compose' or 'systemd'"}), 400

    if managed_by == 'docker_compose' and not compose_file:
        if not os.path.exists(os.path.join(root_path, 'docker-compose.yml')):
            return jsonify({'error': 'docker-compose.yml not found and no compose_file provided'}), 400
        compose_file = 'docker-compose.yml'

    # NOT query_active: a tombstone keeps reserving its name so a restore can't
    # collide with an app created in the meantime.
    clash = app_name_clash_error(
        Application.query.filter_by(name=name).first(), name)
    if clash:
        return jsonify({'error': clash}), 400

    from app.services.workspace_service import WorkspaceService
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    if ws_id is None:
        ws_id = WorkspaceService.ensure_default_workspace().id

    project_id, environment_id = _resolve_project_env(data, ws_id)

    app = Application(
        name=name,
        app_type=app_type,
        status='stopped',
        source='manual',
        root_path=root_path,
        compose_file=compose_file,
        systemd_unit=systemd_unit,
        managed_by=managed_by,
        ingress_plane=_resolve_ingress_plane(data, app_type, managed_by),
        user_id=user.id,
        workspace_id=ws_id,
        project_id=project_id,
        environment_id=environment_id,
    )

    db.session.add(app)
    db.session.commit()

    # Sync status immediately so the UI reflects reality
    _sync_manual_app_status(app)

    return jsonify({
        'message': 'Manual service registered',
        'app': _attach_deploy_config(app.to_dict(include_linked=True))
    }), 201


@apps_bp.route('/upload', methods=['POST'])
@jwt_required()
def upload_app_archive():
    """Create or update an app by uploading a zip archive."""
    user = require_admin_user()

    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    uploaded = request.files['file']
    if not uploaded or uploaded.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    name = _service_slug(request.form.get('name') or uploaded.filename.rsplit('.', 1)[0])
    app_type = (request.form.get('app_type') or 'auto').strip().lower()
    auto_deploy = request.form.get('auto_deploy', 'true').lower() == 'true'

    if not name or len(name) < 2:
        return jsonify({'error': 'Service name must be at least 2 characters'}), 400

    valid_types = ['auto', 'docker', 'flask', 'django', 'php', 'static', 'node']
    if app_type not in valid_types:
        return jsonify({'error': f'Invalid app_type. Must be one of: {", ".join(valid_types)}'}), 400

    from app.services.workspace_service import WorkspaceService
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    if ws_id is None:
        ws_id = WorkspaceService.ensure_default_workspace().id

    # The name lookup serves two purposes and a tombstone answers them
    # differently. It still RESERVES the name (so the unfiltered fallback), but
    # it is never the row an upload updates in place: that path extracts a new
    # version over the app's storage and compose_up's it, which would resurrect
    # an app the user deleted. Ask for the live row first so a tombstone can
    # never shadow it; a tombstone-only hit falls through to "already exists".
    existing = (Application.query_active().filter_by(name=name).first()
                or Application.query.filter_by(name=name).first())
    is_update = existing is not None and existing.is_active and existing.source == 'upload'

    temp_dir = os.path.join(paths.SERVERKIT_CACHE_DIR, 'uploads')
    os.makedirs(temp_dir, exist_ok=True)
    timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S-%f')
    zippath = os.path.join(temp_dir, f'{name}-{timestamp}.zip')
    uploaded.save(zippath)

    validation = validate_zip(zippath)
    if not validation.get('success'):
        os.remove(zippath)
        return jsonify({'error': validation.get('error', 'Invalid zip')}), 400

    try:
        app_dir = ensure_app_dirs(name)

        if is_update:
            app = existing
            new_version = (app.version or 0) + 1
            backup_path = backup_current(app_dir)
        else:
            if existing:
                os.remove(zippath)
                return jsonify({'error': app_name_clash_error(existing, name)}), 400
            new_version = 1

        version_dir = extract_version(app_dir, zippath, new_version)
        upload_archive_path = save_upload_zip(app_dir, zippath, new_version)

        if is_update:
            preserve_existing_env(os.path.join(app_dir, 'current'), version_dir)

        current_dir = switch_current_version(app_dir, new_version)

        if app_type == 'auto':
            detected = detect_app_type(current_dir)
        else:
            detected = app_type

        if detected == 'node':
            detected = 'docker'

        compose_file = None
        if detected == 'docker':
            if os.path.exists(os.path.join(current_dir, 'docker-compose.yml')):
                compose_file = 'docker-compose.yml'
            elif os.path.exists(os.path.join(current_dir, 'Dockerfile')):
                compose_file = None

        if is_update:
            app.app_type = detected
            app.compose_file = compose_file
            app.version = new_version
            app.upload_path = upload_archive_path
            app.root_path = current_dir
            app.updated_at = datetime.utcnow()
        else:
            project_id, environment_id = _resolve_project_env(request.form, ws_id)
            app = Application(
                name=name,
                app_type=detected,
                status='stopped',
                source='upload',
                root_path=current_dir,
                compose_file=compose_file,
                managed_by='docker_compose' if detected == 'docker' else None,
                ingress_plane=_resolve_ingress_plane(
                    request.form, detected,
                    'docker_compose' if detected == 'docker' else None,
                ),
                version=new_version,
                upload_path=upload_archive_path,
                user_id=user.id,
                workspace_id=ws_id,
                project_id=project_id,
                environment_id=environment_id,
            )
            db.session.add(app)

        db.session.commit()

        deploy_result = None
        if auto_deploy and detected == 'docker' and compose_file:
            deploy_result = DockerService.compose_up(current_dir, detach=True, build=True, compose_file=compose_file)
            if deploy_result.get('success'):
                app.status = 'running'
                app.last_deployed_at = datetime.utcnow()
                db.session.commit()

        os.remove(zippath)

        return jsonify({
            'message': 'Upload service updated' if is_update else 'Upload service created',
            'app': _attach_deploy_config(app.to_dict(include_linked=True)),
            'version': new_version,
            'detected_app_type': detected,
            'deploy_result': deploy_result,
        }), 201 if not is_update else 200

    except Exception as exc:
        try:
            os.remove(zippath)
        except Exception:
            pass
        return jsonify({'error': str(exc)}), 400


@apps_bp.route('/<int:app_id>/versions', methods=['GET'])
@jwt_required()
def get_app_versions(app_id):
    """List versions for an uploaded app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    if app.source != 'upload':
        return jsonify({'versions': [], 'current': None}), 200

    try:
        app_dir = get_app_storage_dir(app.name)
        versions = list_versions(app_dir)
        current = get_current_version(app_dir)
        return jsonify({'versions': versions, 'current': current}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@apps_bp.route('/<int:app_id>/rollback', methods=['POST'])
@jwt_required()
def rollback_app_version(app_id):
    """Roll an uploaded app back to a previous version."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    if app.source != 'upload':
        return jsonify({'error': 'Rollback is only supported for upload-based apps'}), 400

    data = request.get_json() or {}
    target = data.get('version')
    if target is None:
        return jsonify({'error': 'version is required'}), 400

    try:
        target = int(target)
    except (TypeError, ValueError):
        return jsonify({'error': 'version must be an integer'}), 400

    try:
        app_dir = get_app_storage_dir(app.name)
        current_dir = switch_current_version(app_dir, target)
        app.root_path = current_dir
        app.version = target
        app.updated_at = datetime.utcnow()

        if app.app_type == 'docker' and app.compose_file:
            result = DockerService.compose_up(current_dir, detach=True, build=True, compose_file=app.compose_file)
            if result.get('success'):
                app.status = 'running'
                app.last_deployed_at = datetime.utcnow()
            else:
                return jsonify({'error': result.get('error', 'Failed to start service'), 'app': app.to_dict()}), 400

        db.session.commit()
        return jsonify({
            'message': f'Rolled back to version {target}',
            'app': _attach_deploy_config(app.to_dict(include_linked=True))
        }), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 400


@apps_bp.route('/<int:app_id>', methods=['PUT'])
@jwt_required()
def update_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()

    if 'name' in data:
        app.name = data['name']
    if 'status' in data:
        app.status = data['status']
    if 'php_version' in data:
        app.php_version = data['php_version']
    if 'python_version' in data:
        app.python_version = data['python_version']
    if 'port' in data:
        app.port = data['port']
    if 'healthcheck_path' in data:
        hc = (data['healthcheck_path'] or '').strip()
        app.healthcheck_path = hc or None
    if 'root_path' in data:
        app.root_path = data['root_path']
    if 'docker_image' in data:
        app.docker_image = data['docker_image']
    if 'registry_id' in data:
        # Accept null to unbind; otherwise a valid registry id.
        app.registry_id = data['registry_id'] or None
    if 'source' in data:
        app.source = data['source']
    if 'compose_file' in data:
        app.compose_file = data['compose_file']
    if 'systemd_unit' in data:
        app.systemd_unit = data['systemd_unit']
    if 'managed_by' in data:
        app.managed_by = data['managed_by']

    db.session.commit()

    return jsonify({
        'message': 'Application updated successfully',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>', methods=['DELETE'])
@jwt_required()
def delete_app(app_id):
    """Soft-delete an app: stop it serving, keep the record and the data.

    What used to happen here — compose_down(volumes=True) and rmtree of the
    uploaded source — has moved to the PURGE hook. Doing it here while keeping
    a tombstone would put a Restore button next to a row whose data had already
    been destroyed. The reversible half (containers down, vhost removed,
    firewall closed, cron suspended) still happens now; see
    services/application_restore.py.

    `?purge=true` is the escape hatch for "I do not want this in the bin",
    and it runs the irreversible half immediately.
    """
    from app.services import application_restore, recycle_bin_service

    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    # query_active: deleting something already in the bin is a 404, not a
    # second delete that would re-stamp deleted_at and restart the retention
    # clock on a row the user cannot even see on this page.
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not user.is_admin and app.user_id != user.id:
        return jsonify({'error': 'Access denied'}), 403

    purge_now = str(request.args.get('purge', '')).lower() in ('1', 'true', 'yes')

    cleanup_results = application_restore.suspend_application(app, user_id=current_user_id)

    if purge_now:
        # Carry the caller's data intent into the purge hook. Without this a
        # `?purge=true&remove_data=false` -- and every database-engine uninstall,
        # which defaults to preserving its volumes -- would lose the data the
        # flag exists to protect.
        app._purge_remove_data = _remove_data_flag(app)
        ok, warning = recycle_bin_service.purge('application', app.id)
        return jsonify({
            'message': 'Application deleted permanently',
            'purged': ok,
            'cleanup': cleanup_results,
            'warning': warning,
        }), 200

    return jsonify({
        'message': 'Application moved to the recycle bin',
        'recycle_bin': True,
        'cleanup': cleanup_results,
    }), 200


@apps_bp.route('/<int:app_id>/start', methods=['POST'])
@jwt_required()
def start_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # A local BYO-image docker app (image set, no source yet) has no compose to
    # launch — materialize one on first start so it can actually run.
    if app.app_type == 'docker' and not app.root_path and app.docker_image and not app.server_id:
        try:
            _ensure_local_image_compose(app)
        except ValueError as e:
            return jsonify({'error': str(e)}), 400

    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        if app.server_id:
            result = RemoteDockerService.compose_up(
                app.server_id,
                _compose_target(app),
                detach=True,
                user_id=current_user_id
            )
        elif _is_single_container_app(app):
            # Build-pack app: one container, created by the deploy.
            container = _app_container_name(app)
            if not DockerService.get_container(container):
                return jsonify({'error': 'This application has not been deployed yet. '
                                         'Run a deploy to build its image and create '
                                         'the container.'}), 400
            result = DockerService.start_container(container)
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
            return jsonify({'error': _agent_result_error(result, 'Failed to start containers')}), 400

    app.status = 'running'
    db.session.commit()
    # The cached aggregate now describes the pre-start world. Drop it: a status
    # pill that survives the action that changed it reads as a broken panel.
    container_status_service.invalidate(app_id)

    return jsonify({
        'message': 'Application started',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/image-update/apply', methods=['POST'])
@jwt_required()
def apply_image_update(app_id):
    """Pull the newest image for a compose-managed app and recreate it."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Auto-apply is only safe for compose-managed apps; recreating a standalone
    # container would need its full run spec, which we don't store.
    if app.app_type != 'docker' or not app.root_path or not app.compose_file:
        return jsonify({'error': 'Automatic update is only supported for docker-compose apps. '
                                 'Pull and recreate this container manually.'}), 400

    # Pull the newest images for the project, then recreate changed containers.
    if app.server_id:
        pull = RemoteDockerService.compose_pull(app.server_id, _compose_target(app), user_id=current_user_id)
        if not pull.get('success') or _agent_result_failed(pull):
            return jsonify({'error': _agent_result_error(pull, 'Failed to pull image')}), 400
        up = RemoteDockerService.compose_up(app.server_id, _compose_target(app), detach=True, user_id=current_user_id)
    else:
        # Authenticate a bound private registry for the pull; always log out after.
        _registry = ContainerRegistryService.login_for_app(app)
        try:
            pull = DockerService.compose_pull(app.root_path, compose_file=_local_compose_file(app))
            if not pull.get('success'):
                return jsonify({'error': pull.get('error', 'Failed to pull image')}), 400
            up = DockerService.compose_up(app.root_path, detach=True, compose_file=_local_compose_file(app))
        finally:
            ContainerRegistryService.logout_for_app(_registry)

    if not up.get('success') or _agent_result_failed(up):
        return jsonify({'error': _agent_result_error(up, 'Failed to recreate containers')}), 400

    app.status = 'running'
    app.last_deployed_at = datetime.utcnow()
    db.session.commit()
    # Containers were recreated — their ids changed, so any cached aggregate is
    # describing containers that no longer exist.
    container_status_service.invalidate(app_id)

    # Refresh the update badge now that we're on the new image.
    ImageUpdateService.check_application(app_id)

    return jsonify({
        'message': 'Image updated and containers recreated',
        'app': app.to_dict(),
    }), 200


@apps_bp.route('/<int:app_id>/sleep-policy', methods=['GET'])
@jwt_required()
def get_sleep_policy(app_id):
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    return jsonify(ContainerSleepService.get_or_create_policy(app_id).to_dict())


@apps_bp.route('/<int:app_id>/sleep-policy', methods=['PUT'])
@jwt_required()
def update_sleep_policy(app_id):
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    data = request.get_json() or {}
    policy = ContainerSleepService.set_policy(
        app_id, enabled=data.get('enabled'), idle_timeout_minutes=data.get('idle_timeout_minutes'))
    return jsonify(policy.to_dict())


@apps_bp.route('/<int:app_id>/sleep', methods=['POST'])
@jwt_required()
def sleep_app(app_id):
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    result = ContainerSleepService.sleep_app(app_id)
    if not result.get('success'):
        return jsonify({'error': result['error']}), 400
    return jsonify({'message': 'Application asleep', 'policy': result['policy'], 'app': app.to_dict()})


@apps_bp.route('/<int:app_id>/wake', methods=['POST'])
@jwt_required()
def wake_app(app_id):
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    result = ContainerSleepService.wake_app(app_id)
    if not result.get('success'):
        return jsonify({'error': result['error']}), 400
    return jsonify({'message': 'Application awake', 'policy': result['policy'], 'app': app.to_dict()})


@apps_bp.route('/sweep-idle', methods=['POST'])
@jwt_required()
def sweep_idle_apps():
    """Sleep all enabled apps that have been idle past their timeout. Intended
    to be hit periodically (cron or a scheduler)."""
    user = get_current_user()
    if not (user and user.is_admin):
        return jsonify({'error': 'Admin access required'}), 403
    return jsonify(ContainerSleepService.sweep_idle())


# ==================== RESOURCE LIMITS (task #23) ====================

def _parse_docker_stats(stats):
    """Normalize a `docker stats --format json` row to a small usage dict.

    Returns None when stats are unavailable (stopped app, no Docker on the
    host — e.g. Windows dev).
    """
    if not stats:
        return None

    def _pct(value):
        try:
            return float(str(value).rstrip('%'))
        except (TypeError, ValueError):
            return None

    usage = {
        'cpu_percent': _pct(stats.get('CPUPerc')),
        'memory_percent': _pct(stats.get('MemPerc')),
        'memory_usage': None,
        'memory_limit': None,
    }
    mem = stats.get('MemUsage') or ''
    if '/' in mem:
        used, limit = mem.split('/', 1)
        usage['memory_usage'] = used.strip()
        usage['memory_limit'] = limit.strip()
    return usage


@apps_bp.route('/<int:app_id>/resources', methods=['GET'])
@jwt_required()
def get_app_resources(app_id):
    """The app's configured CPU/memory limits plus best-effort live usage."""
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    usage = None
    if app.status == 'running' and not app.server_id:
        try:
            container_id = DockerService.get_app_container_id(app)
            if container_id:
                usage = _parse_docker_stats(DockerService.get_container_stats(container_id))
        except Exception:
            usage = None  # live stats are best-effort

    return jsonify({
        'cpu_limit': app.cpu_limit,
        'memory_limit': app.memory_limit,
        'usage': usage,
    }), 200


@apps_bp.route('/<int:app_id>/resources', methods=['PUT'])
@jwt_required()
def update_app_resources(app_id):
    """Set the app's CPU/memory limits; re-apply live when possible.

    Empty/null clears a limit. For a locally managed compose app that is
    running, `compose up -d` regenerates the ServerKit override (which carries
    the limits) and recreates changed containers; otherwise the limits are
    saved and take effect on the next restart/redeploy.
    """
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json() or {}
    try:
        if 'cpu_limit' in data:
            app.cpu_limit = DockerService.validate_cpu_limit(data['cpu_limit'])
        if 'memory_limit' in data:
            app.memory_limit = DockerService.validate_memory_limit(data['memory_limit'])
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    db.session.commit()

    applied = False
    note = None
    is_local_compose = (
        not app.server_id and app.root_path
        and (app.app_type == 'docker' or app.managed_by == 'docker_compose')
    )
    if app.status == 'running':
        if is_local_compose:
            result = DockerService.compose_up(app.root_path, compose_file=_local_compose_file(app))
            applied = bool(result.get('success'))
            if not applied:
                note = 'restart required'
        else:
            note = 'restart required'

    response = {
        'message': 'Resource limits saved',
        'cpu_limit': app.cpu_limit,
        'memory_limit': app.memory_limit,
        'applied': applied,
    }
    if note:
        response['note'] = note
    return jsonify(response), 200


# ==================== MICRO-CACHE (task #21) ====================

@apps_bp.route('/<int:app_id>/micro-cache', methods=['PUT'])
@jwt_required()
def set_micro_cache(app_id):
    """Toggle the per-site nginx micro-cache and republish the vhost.

    The flag flows through the same kwargs pipeline drift detection uses
    (SiteDomainService.app_vhost_kwargs -> NginxService.render_site_config),
    so an enabled cache is part of the expected vhost and never reads as
    config drift. When the app has no domains yet, the flag is save-only and
    takes effect on first publish.
    """
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json() or {}
    if 'enabled' not in data:
        return jsonify({'error': "'enabled' is required"}), 400

    app.micro_cache_enabled = bool(data['enabled'])
    db.session.commit()

    applied = False
    note = None
    warning = None
    if app.domains:
        # Reuse the exact publish path (render + write + enable + reload).
        from app.services.site_domain_service import SiteDomainService
        result = SiteDomainService.write_app_vhost(app)
        warning = result.get('warning')
        applied = result.get('nginx') is not None and not warning
    else:
        note = ('Saved. The micro-cache takes effect when this service is '
                'published at a domain.')

    response = {
        'message': f"Micro-cache {'enabled' if app.micro_cache_enabled else 'disabled'}",
        'micro_cache_enabled': bool(app.micro_cache_enabled),
        'applied': applied,
    }
    if note:
        response['note'] = note
    if warning:
        response['warning'] = warning
    return jsonify(response), 200


@apps_bp.route('/<int:app_id>/micro-cache/purge', methods=['POST'])
@jwt_required()
def purge_micro_cache(app_id):
    """Manually clear the micro-cache.

    The cache is ONE shared nginx zone for all opted-in sites (zones must be
    declared statically, so per-site zones don't scale) — purging therefore
    wipes cached entries for every opted-in site. With the 10-second TTL this
    is near-harmless, and no nginx reload is needed.
    """
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    from app.services.nginx_service import NginxService
    result = NginxService.purge_micro_cache()
    if not result.get('success'):
        return jsonify({'error': result.get('error', 'Purge failed')}), 500

    response = {'message': result.get('message', 'Micro-cache cleared')}
    if result.get('note'):
        response['note'] = result['note']
    return jsonify(response), 200


@apps_bp.route('/<int:app_id>/scale-policy', methods=['GET'])
@jwt_required()
def get_scale_policy(app_id):
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    return jsonify(ContainerScaleService.get_or_create_policy(app_id).to_dict())


@apps_bp.route('/<int:app_id>/scale-policy', methods=['PUT'])
@jwt_required()
def update_scale_policy(app_id):
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    data = request.get_json() or {}
    try:
        policy = ContainerScaleService.set_policy(app_id, **data)
    except ValueError as exc:
        # The service rolls back its own dirty session before raising.
        return jsonify({'error': str(exc)}), 400
    return jsonify(policy.to_dict())


@apps_bp.route('/<int:app_id>/scale', methods=['POST'])
@jwt_required()
def scale_app(app_id):
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    data = request.get_json() or {}
    if data.get('replicas') is None:
        return jsonify({'error': 'replicas is required'}), 400
    result = ContainerScaleService.scale_to(app_id, data['replicas'])
    if not result.get('success'):
        return jsonify({'error': result['error']}), 400
    return jsonify(result)


@apps_bp.route('/<int:app_id>/scale/evaluate', methods=['POST'])
@jwt_required()
def evaluate_scale(app_id):
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403
    result = ContainerScaleService.evaluate(app_id)
    if not result.get('success'):
        return jsonify({'error': result.get('error', 'Evaluation failed')}), 400
    return jsonify(result)


@apps_bp.route('/scale-sweep', methods=['POST'])
@jwt_required()
def scale_sweep():
    """Evaluate every enabled auto-scaling policy. Intended for cron/scheduler."""
    user = get_current_user()
    if not (user and user.is_admin):
        return jsonify({'error': 'Admin access required'}), 403
    return jsonify(ContainerScaleService.sweep())


@apps_bp.route('/<int:app_id>/stop', methods=['POST'])
@jwt_required()
def stop_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        if app.server_id:
            result = RemoteDockerService.compose_down(
                app.server_id,
                _compose_target(app),
                user_id=current_user_id
            )
        elif _is_single_container_app(app):
            # A container that no longer exists is already stopped -- reporting
            # that as a failure would strand the app in `running` forever.
            container = _app_container_name(app)
            result = ({'success': True} if not DockerService.get_container(container)
                      else DockerService.stop_container(container))
        else:
            result = DockerService.compose_down(
                app.root_path,
                compose_file=_local_compose_file(app)
            )
        if not result.get('success') or _agent_result_failed(result):
            return jsonify({'error': _agent_result_error(result, 'Failed to stop containers')}), 400

    app.status = 'stopped'
    db.session.commit()
    container_status_service.invalidate(app_id)

    return jsonify({
        'message': 'Application stopped',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/restart', methods=['POST'])
@jwt_required()
def restart_app(app_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_edit_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Handle Docker apps
    if app.app_type == 'docker' and app.root_path:
        if app.server_id:
            result = RemoteDockerService.compose_restart(
                app.server_id,
                _compose_target(app),
                user_id=current_user_id
            )
        elif _is_single_container_app(app):
            container = _app_container_name(app)
            if not DockerService.get_container(container):
                return jsonify({'error': 'This application has not been deployed yet. '
                                         'Run a deploy to build its image and create '
                                         'the container.'}), 400
            result = DockerService.restart_container(container)
        else:
            result = DockerService.compose_restart(
                app.root_path,
                compose_file=_local_compose_file(app)
            )
        if not result.get('success') or _agent_result_failed(result):
            return jsonify({'error': _agent_result_error(result, 'Failed to restart containers')}), 400

    app.status = 'running'
    db.session.commit()
    container_status_service.invalidate(app_id)

    return jsonify({
        'message': 'Application restarted',
        'app': app.to_dict()
    }), 200


@apps_bp.route('/<int:app_id>/related', methods=['GET'])
@jwt_required()
def get_app_related(app_id):
    """Domains, databases, backup status and deploy count for one app.

    The Overview tab has always called this; it was never implemented, so the
    request 404'd, the client swallowed it, and the card sat on "Loading…"
    forever. Each section is gathered independently — a missing table or a
    disabled feature degrades that section to empty rather than failing the
    whole card.
    """
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    related = {'domains': [], 'databases': [], 'backup': None, 'deployments': {'count': 0}}

    try:
        from app.models.domain import Domain
        related['domains'] = [
            {'id': d.id, 'name': d.name, 'ssl_enabled': bool(getattr(d, 'ssl_enabled', False))}
            for d in Domain.query_active().filter_by(application_id=app.id).all()
        ]
    except Exception:
        current_app.logger.warning('related: domains failed', exc_info=True)

    try:
        from app.models.managed_database import ManagedDatabase
        related['databases'] = [
            {'id': m.id, 'name': m.name, 'engine': getattr(m, 'engine', '')}
            for m in ManagedDatabase.query_active().filter_by(owner_application_id=app.id).all()
        ]
    except Exception:
        current_app.logger.warning('related: databases failed', exc_info=True)

    try:
        from app.models.backup_policy import BackupPolicy
        policy = BackupPolicy.query.filter_by(target_type='application', target_id=app.id).first()
        if policy:
            related['backup'] = {
                'enabled': bool(policy.enabled),
                'frequency': policy.schedule_cron,
                'last_status': policy.last_status,
            }
    except Exception:
        current_app.logger.warning('related: backup failed', exc_info=True)

    try:
        from app.models.deployment import Deployment
        related['deployments'] = {'count': Deployment.query.filter_by(app_id=app.id).count()}
    except Exception:
        current_app.logger.warning('related: deployments failed', exc_info=True)

    return jsonify(related), 200


@apps_bp.route('/<int:app_id>/logs', methods=['GET'])
@jwt_required()
def get_app_logs(app_id):
    """Get logs for a specific application."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    lines = request.args.get('lines', 100, type=int)
    log_type = request.args.get('type', 'all')

    # A recorded container is the authoritative runtime for single-container
    # deployments. Repositories may still contain an unrelated compose file,
    # so file presence alone must not redirect their logs through compose.
    if app.app_type == 'docker' and app.container_id:
        if DockerService.get_container(app.container_id):
            result = DockerService.get_container_logs(
                app.container_id, tail=lines, timestamps=False
            )
            if result.get('success'):
                return jsonify(result), 200

    # Preserve the legacy Docker Compose path when there is no live recorded
    # container (including old records that predate container_id tracking).
    if app.app_type == 'docker' and app.root_path:
        if app.server_id:
            result = RemoteDockerService.compose_logs(
                app.server_id,
                _compose_target(app),
                tail=lines,
                user_id=current_user_id
            )
            return jsonify(result.get('data') if result.get('success') else result), 200 if result.get('success') else 400

        result = LogService.get_docker_app_logs(
            app.name, app.root_path, lines, compose_file=_local_compose_file(app)
        )
        return jsonify(result), 200 if result.get('success') else 400

    # For other apps, get nginx logs
    result = LogService.get_app_logs(app.name, log_type, lines)
    return jsonify(result), 200 if result.get('success') else 400


@apps_bp.route('/<int:app_id>/container-logs', methods=['GET'])
@jwt_required()
def get_container_logs(app_id):
    """Get container logs for a Docker application.

    Query params:
        - tail: Number of lines from end (default: 100, max: 10000)
        - since: ISO timestamp or duration (e.g., '10m', '1h', '2024-01-01T00:00:00Z')
        - timestamps: Include timestamps (default: true)
        - format: Output format - 'raw' or 'json' (default: 'raw')
        - service: Specific service/container name for compose apps (optional)

    Returns:
        {
            "success": true,
            "logs": "...",  // Raw format
            "lines": [...]  // JSON format with parsed lines
            "container_id": "...",
            "container_name": "...",
            "app_id": 1,
            "containers": [...] // Available containers for compose apps
        }
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Parse query parameters
    tail = request.args.get('tail', 100, type=int)
    tail = min(tail, 10000)  # Cap at 10000 lines
    since = request.args.get('since')
    timestamps = request.args.get('timestamps', 'true').lower() == 'true'
    output_format = request.args.get('format', 'raw')
    service = request.args.get('service')

    # Get all available containers for this app
    all_containers = DockerService.get_all_app_containers(app)

    # Determine which container to get logs from
    container_id = None
    container_name = None

    if service:
        # Find specific service container
        for c in all_containers:
            if c.get('service') == service or c.get('name') == service:
                container_id = c.get('id') or c.get('name')
                container_name = c.get('name')
                break
        if not container_id:
            return jsonify({
                'error': f'Service "{service}" not found',
                'available_services': [c.get('service') or c.get('name') for c in all_containers]
            }), 404
    else:
        # Get main container
        container_id = DockerService.get_app_container_id(app)
        if all_containers:
            container_name = all_containers[0].get('name')

    if not container_id:
        return jsonify({
            'error': 'No container found for this application',
            'hint': 'The application may not have been started yet'
        }), 404

    # Check container state
    container_state = DockerService.get_container_state(container_id)
    if not container_state:
        return jsonify({
            'error': 'Container not found or no longer exists'
        }), 404

    # Get logs
    result = DockerService.get_container_logs(
        container_id,
        tail=tail,
        since=since,
        timestamps=timestamps
    )

    if not result.get('success'):
        return jsonify({
            'error': result.get('error', 'Failed to fetch logs')
        }), 400

    logs = result.get('logs', '')

    response = {
        'success': True,
        'app_id': app_id,
        'container_id': container_id,
        'container_name': container_name,
        'container_state': container_state,
        'containers': all_containers
    }

    if output_format == 'json':
        response['lines'] = DockerService.parse_logs_to_lines(logs)
    else:
        response['logs'] = logs

    return jsonify(response), 200


@apps_bp.route('/<int:app_id>/containers', methods=['GET'])
@jwt_required()
def get_app_containers(app_id):
    """Get list of containers for a Docker application.

    Useful for compose apps with multiple services.

    Returns:
        {
            "success": true,
            "app_id": 1,
            "containers": [
                {"id": "abc123", "name": "app-web", "service": "web", "state": "running"},
                {"id": "def456", "name": "app-db", "service": "db", "state": "running"}
            ]
        }
    """
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    containers = DockerService.get_all_app_containers(app)

    return jsonify({
        'success': True,
        'app_id': app_id,
        'containers': containers
    }), 200


@apps_bp.route('/<int:app_id>/status', methods=['GET'])
@jwt_required()
def get_app_status(app_id):
    """Get real-time status for a Docker application."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not _can_access_app(user, app):
        return jsonify({'error': 'Access denied'}), 403

    # Manual / local apps: ask the real runtime
    if app.source == 'manual':
        _sync_manual_app_status(app)
        if app.managed_by == 'systemd' and app.systemd_unit:
            unit_status = ProcessService.get_systemd_unit_status(app.systemd_unit)
            return jsonify({
                'status': app.status,
                'unit_status': unit_status.get('status'),
                'active': unit_status.get('active'),
                'containers': [],
                'running': 1 if app.status == 'running' else 0,
                'total': 1,
                'port': app.port,
                'port_accessible': None,
            }), 200

    if app.app_type == 'docker' and app.root_path:
        # Get container status from Docker
        if app.server_id:
            result = RemoteDockerService.compose_ps(
                app.server_id,
                _compose_target(app),
                user_id=current_user_id
            )
            if not result.get('success'):
                return jsonify(result), 503 if result.get('code') == 'AGENT_OFFLINE' else 400
            containers = result.get('data', [])
        else:
            containers = DockerService.compose_ps(
                app.root_path,
                compose_file=_local_compose_file(app)
            )

        # Determine overall status
        running_count = sum(1 for c in containers if c.get('Status', c.get('status', '')).startswith('Up'))
        total_count = len(containers)

        if total_count == 0:
            actual_status = 'stopped'
        elif running_count == total_count:
            actual_status = 'running'
        elif running_count > 0:
            actual_status = 'partial'
        else:
            actual_status = 'stopped'

        # Update DB if status changed
        if app.status != actual_status and actual_status in ['running', 'stopped']:
            app.status = actual_status
            db.session.commit()

        # Check port accessibility
        port_status = None
        if app.port and not app.server_id:
            port_status = DockerService.check_port_accessible(app.port)

        return jsonify({
            'status': actual_status,
            'containers': containers,
            'running': running_count,
            'total': total_count,
            'port': app.port,
            'port_accessible': port_status.get('accessible') if port_status else None
        }), 200

    # Non-Docker apps
    port_status = None
    if app.port:
        port_status = DockerService.check_port_accessible(app.port)

    return jsonify({
        'status': app.status,
        'containers': [],
        'running': 1 if app.status == 'running' else 0,
        'total': 1,
        'port': app.port,
        'port_accessible': port_status.get('accessible') if port_status else None
    }), 200


# ==================== BACKUP PROTECTION (policy + runs) ====================

def _load_app_for_backup(app_id, edit=False):
    """Load an app the current user may access (or edit). Returns (app, error)."""
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        return None, (jsonify({'error': 'Application not found'}), 404)
    allowed = _can_edit_app(user, app) if edit else _can_access_app(user, app)
    if not allowed:
        return None, (jsonify({'error': 'Access denied'}), 403)
    return app, None


@apps_bp.route('/<int:app_id>/backup-policy', methods=['GET'])
@jwt_required()
def get_app_backup_policy(app_id):
    """Return the protection policy + status for an app (creating a default)."""
    app, err = _load_app_for_backup(app_id)
    if err:
        return err
    policy = BackupPolicyService.get_or_create_policy('application', app_id)
    return jsonify(BackupPolicyService.serialize_policy_view(policy))


@apps_bp.route('/<int:app_id>/backup-policy', methods=['PUT'])
@jwt_required()
def update_app_backup_policy(app_id):
    """Update the protection policy and re-sync its schedule."""
    app, err = _load_app_for_backup(app_id, edit=True)
    if err:
        return err
    policy = BackupPolicyService.get_or_create_policy('application', app_id)
    try:
        BackupPolicyService.update_policy(policy, request.get_json() or {})
    except BackupPolicyError as e:
        return jsonify({'error': str(e)}), 400
    return jsonify(BackupPolicyService.serialize_policy_view(policy))


@apps_bp.route('/<int:app_id>/backups', methods=['POST'])
@jwt_required()
def trigger_app_backup(app_id):
    """Enqueue a one-off backup for the app."""
    app, err = _load_app_for_backup(app_id, edit=True)
    if err:
        return err
    policy = BackupPolicyService.get_or_create_policy('application', app_id)
    try:
        job = BackupPolicyService.run_policy_now(policy, manual=True)
    except BackupPolicyError as e:
        return jsonify({'error': str(e)}), 409
    return jsonify({'success': True, 'job_id': job.id}), 202


@apps_bp.route('/<int:app_id>/backups', methods=['GET'])
@jwt_required()
def list_app_backups(app_id):
    """List backup runs for the app."""
    app, err = _load_app_for_backup(app_id)
    if err:
        return err
    policy = BackupPolicyService.get_or_create_policy('application', app_id)
    return jsonify({'runs': BackupPolicyService.list_runs(policy)})


@apps_bp.route('/<int:app_id>/backups/<int:run_id>/restore', methods=['POST'])
@jwt_required()
def restore_app_backup(app_id, run_id):
    """Enqueue a restore from a specific backup run."""
    app, err = _load_app_for_backup(app_id, edit=True)
    if err:
        return err
    policy = BackupPolicyService.get_or_create_policy('application', app_id)
    try:
        job = BackupPolicyService.request_restore(policy, run_id, request.get_json() or {})
    except BackupPolicyError as e:
        return jsonify({'error': str(e)}), 400
    return jsonify({'success': True, 'job_id': job.id}), 202


@apps_bp.route('/<int:app_id>/backups/<int:run_id>/verify', methods=['POST'])
@jwt_required()
def verify_app_backup(app_id, run_id):
    """Verify the remote copy of a backup run."""
    app, err = _load_app_for_backup(app_id, edit=True)
    if err:
        return err
    policy = BackupPolicyService.get_or_create_policy('application', app_id)
    try:
        result = BackupPolicyService.verify_run(policy, run_id)
    except BackupPolicyError as e:
        return jsonify({'error': str(e)}), 400
    return jsonify(result)


@apps_bp.route('/<int:app_id>/backups/<int:run_id>', methods=['DELETE'])
@jwt_required()
def delete_app_backup(app_id, run_id):
    """Delete a backup run (local + remote + record)."""
    app, err = _load_app_for_backup(app_id, edit=True)
    if err:
        return err
    policy = BackupPolicyService.get_or_create_policy('application', app_id)
    try:
        BackupPolicyService.delete_run(policy, run_id)
    except BackupPolicyError as e:
        return jsonify({'error': str(e)}), 400
    return jsonify({'success': True})


# --------------------------------------------------------------------------- #
# WordPress reachable through the generic application surface (§7 unification).
# A WordPress site is a 1:1 extension of an Application (WordPressSite.
# application_id); the WordPressSite record — not app_type — is the source of
# truth (see wordpress.py:_is_wp_app). These additive routes expose the WP
# linkage and its DB snapshots under /apps/:id without changing app_type, so the
# docker-compose code paths that key on app_type=='docker' keep working.
# --------------------------------------------------------------------------- #

def _wp_site_for_app(app):
    from app.models.wordpress_site import WordPressSite
    return WordPressSite.query.filter_by(application_id=app.id).first()


@apps_bp.route('/<int:app_id>/wordpress', methods=['GET'])
@jwt_required()
def app_wordpress_info(app_id):
    """Whether this app is a WordPress site, and the linked site id. Lets the
    generic Services surface discover the WordPress extension."""
    app, err = _load_app_for_backup(app_id)
    if err:
        return err
    site = _wp_site_for_app(app)
    if not site:
        return jsonify({'is_wordpress': False, 'site_id': None}), 200
    return jsonify({
        'is_wordpress': True,
        'site_id': site.id,
        'environment_type': site.environment_type,
        'is_production': site.is_production,
        'wp_version': site.wp_version,
    }), 200


@apps_bp.route('/<int:app_id>/db-snapshots', methods=['GET'])
@jwt_required()
def list_app_db_snapshots(app_id):
    """List the WordPress DB snapshots for an app (unified app-id surface)."""
    app, err = _load_app_for_backup(app_id)
    if err:
        return err
    from app.models.wordpress_site import DatabaseSnapshot
    site = _wp_site_for_app(app)
    if not site:
        return jsonify({'error': 'This application is not a WordPress site'}), 400
    snaps = (DatabaseSnapshot.query.filter_by(site_id=site.id)
             .order_by(DatabaseSnapshot.created_at.desc()).all())
    return jsonify({'snapshots': [s.to_dict() for s in snaps], 'total': len(snaps)}), 200


@apps_bp.route('/<int:app_id>/db-snapshots', methods=['POST'])
@jwt_required()
def create_app_db_snapshot(app_id):
    """Create a WordPress DB snapshot for an app."""
    app, err = _load_app_for_backup(app_id, edit=True)
    if err:
        return err
    from app.models.wordpress_site import DatabaseSnapshot
    from app.services.db_sync_service import DatabaseSyncService
    site = _wp_site_for_app(app)
    if not site:
        return jsonify({'error': 'This application is not a WordPress site'}), 400
    # Resolve the extension only once we know this IS a WordPress site — with
    # serverkit-wordpress uninstalled a non-WP app must get the 400, not an
    # import error (plan 52 Phase 5 graceful absence). A WP SITE with the
    # extension missing/disabled gets a clean 503, not an uncaught
    # WordPressExtensionMissingError → 500 (audit F3).
    from app.services.wordpress_bridge import (
        WordPressExtensionMissingError, wordpress_env_service,
    )
    try:
        WordPressEnvService = wordpress_env_service()
    except WordPressExtensionMissingError as e:
        return jsonify({'error': str(e)}), 503
    data = request.get_json() or {}
    result = DatabaseSyncService.create_snapshot(
        db_name=site.db_name,
        name=data.get('name', f'{app.name}_{site.id}'),
        tag=data.get('tag'),
        commit_sha=site.last_deploy_commit,
        host=site.db_host, user=site.db_user,
        password=WordPressEnvService._get_db_password(site),
        exclude_tables=data.get('exclude_tables', []),
    )
    if not result.get('success'):
        return jsonify(result), 500
    snap_meta = result['snapshot']
    snapshot = DatabaseSnapshot(
        site_id=site.id, name=snap_meta['name'], tag=data.get('tag'),
        file_path=snap_meta['file_path'], size_bytes=snap_meta['size_bytes'],
        compressed=snap_meta['compressed'], commit_sha=site.last_deploy_commit,
        tables_included=json.dumps(snap_meta.get('tables', [])),
        row_count=snap_meta.get('row_count', 0), status='completed',
    )
    db.session.add(snapshot)
    db.session.commit()
    DatabaseSyncService.upload_snapshot_offsite(snapshot.file_path)
    return jsonify({'success': True, 'snapshot': snapshot.to_dict()}), 201


@apps_bp.route('/<int:app_id>/db-snapshots/<int:snapshot_id>', methods=['DELETE'])
@jwt_required()
def delete_app_db_snapshot(app_id, snapshot_id):
    """Delete a WordPress DB snapshot for an app."""
    app, err = _load_app_for_backup(app_id, edit=True)
    if err:
        return err
    from app.models.wordpress_site import DatabaseSnapshot
    from app.services.db_sync_service import DatabaseSyncService
    site = _wp_site_for_app(app)
    if not site:
        return jsonify({'error': 'This application is not a WordPress site'}), 400
    snapshot = DatabaseSnapshot.query.filter_by(id=snapshot_id, site_id=site.id).first()
    if not snapshot:
        return jsonify({'error': 'Snapshot not found'}), 404
    DatabaseSyncService.delete_snapshot(snapshot.file_path)
    db.session.delete(snapshot)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Snapshot deleted'}), 200
