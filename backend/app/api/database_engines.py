# Bucket: PER-APP (plan 29 #9). The per-app extension routes
# (/<app_id>/extensions) address one installed engine, so they gate on
# can_access_app; the catalog reads above them are system-level and carry no
# app linkage, and every mutation is admin-only.
"""Database engine catalog + install, prefix ``/api/v1/databases/engines``.

Deliberately thin. There is no engine model and no engine install mechanism
here: the catalog is composed from templates carrying an ``engine:`` block, and
an install delegates to the same deployment-job pipeline every other template
install uses -- so the UI can navigate straight to the deploy console.

Lifecycle (start / stop / uninstall) is app lifecycle. Use
``POST /api/v1/apps/<id>/start``, ``/stop`` and ``DELETE /api/v1/apps/<id>``
(which preserves an engine's data volumes unless ``?remove_data=true``).

Extensions live under the same prefix but are a different shape: they get no
container, so installing one executes a statement against an engine that is
already running rather than creating a deployment job. See
``app/services/database_engine_extension_service.py``.
"""
import logging

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.middleware.rbac import admin_required, get_current_user
from app.models import Application
from app.services.resource_grant_service import ResourceGrantService
from app.services import database_engine_extension_service as extensions
from app.services import database_engine_service as engines
from app.services.deployment_job_service import DeploymentJobService
from app.services.template_service import TemplateService
from app.exceptions import not_found, permission_denied

logger = logging.getLogger(__name__)

database_engines_bp = Blueprint('database_engines', __name__)


@database_engines_bp.route('', methods=['GET'])
@jwt_required()
def list_database_engines():
    """The installable engine catalog plus every engine already installed.

    ``catalog`` is every available template declaring an ``engine:`` block --
    bundled, operator-authored, or pulled in by a synced template repository.
    Nothing here is hardcoded: dropping a new engine YAML into the templates
    directory is enough to make it appear.
    """
    live = request.args.get('live', 'true').lower() != 'false'
    catalog = engines.engine_catalog()
    extension_catalog = extensions.extension_catalog()
    return jsonify({
        'catalog': catalog,
        'installed': engines.installed_engines(live_status=live),
        # The drawer renders engines and extensions together; one round trip.
        # Every entry carries family 'Extension' -- deliberately NOT merged into
        # `families`, which stays the engine-family filter it has always been.
        'extensions': extension_catalog,
        'extension_family': TemplateService.EXTENSION_FAMILY if extension_catalog else None,
        # Derived from the catalog so the UI never carries its own family list.
        'families': engines.catalog_families(catalog),
    }), 200


@database_engines_bp.route('', methods=['POST'])
@admin_required
def install_database_engine():
    """Install an engine by installing its template.

    Answers with whatever the template pipeline returns (``job_id`` + the job),
    so the caller navigates to the deploy console exactly as it would for any
    other template install.
    """
    data = request.get_json(silent=True) or {}

    plan = engines.plan_install(
        template_id=data.get('template_id'),
        version=data.get('version'),
        instance_name=data.get('instance_name'),
        port=data.get('port'),
        expose_public=bool(data.get('expose_public', False)),
        initial_database=data.get('initial_database'),
        variables=data.get('variables') or {},
    )
    if 'error' in plan:
        status = plan.pop('status_code', 400)
        return jsonify(plan), status

    result = DeploymentJobService.install_template(
        template_id=data.get('template_id'),
        app_name=plan['app_name'],
        user_variables=plan['variables'],
        user_id=get_jwt_identity(),
        server_id=data.get('server_id') or data.get('target_server_id'),
        wait=bool(data.get('wait', False)),
    )
    if not result.get('success'):
        return jsonify(result), 400

    result['engine'] = plan['engine']
    result['app_name'] = plan['app_name']
    if plan.get('warning'):
        result['warning'] = plan['warning']

    status = (result.get('job') or {}).get('status')
    return jsonify(result), 201 if status == 'succeeded' else 202


# ── extensions ───────────────────────────────────────────────────────────────
# An extension has no container: it is a statement run against an engine that
# is already up. These routes sit under the engines prefix because that is where
# the catalog is entered from, but nothing here creates a deployment job.

@database_engines_bp.route('/extensions', methods=['GET'])
@jwt_required()
def list_engine_extensions():
    """Every declared extension, with who can host it.

    Composed from ``<templates>/extensions/*.yaml``: dropping one in is enough
    to make it appear, exactly as for an engine. Each entry carries ``hosts``
    (engine templates that speak its protocol), ``provided_by`` (those whose
    image actually ships it) and the installed instance ids split into
    ``compatible_instances`` / ``incompatible_instances``.
    """
    return jsonify({'extensions': extensions.extension_catalog(),
                    'family': TemplateService.EXTENSION_FAMILY}), 200


def _require_app_access(app_id):
    """Ensure the caller may see this app, mirroring the per-app docker DB read.

    Returns an (error_body, status) tuple to return, or None when allowed. The
    extension listing names an instance's image, its databases and what it can
    load — all facts about someone's application, so a bare `@jwt_required()`
    would have let any signed-in user enumerate them across the whole panel.
    """
    user = get_current_user()
    if not user:
        return {'error': 'Unauthorized'}, 401
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        raise not_found('service')
    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()
    return None


@database_engines_bp.route('/<int:app_id>/extensions', methods=['GET'])
@jwt_required()
def list_instance_extensions(app_id):
    """Every extension judged against ONE installed engine.

    ``?probe=true`` asks the engine itself what it can load instead of
    inferring it from the image name -- slower (a docker exec per extension),
    authoritative, and the only way to see what is already installed.
    """
    denied = _require_app_access(app_id)
    if denied:
        return jsonify(denied[0]), denied[1]

    probe = request.args.get('probe', 'false').lower() == 'true'
    result = extensions.instance_extensions(app_id, probe=probe)
    if 'error' in result:
        # Popped BEFORE serializing: the transport code is not part of the body.
        status = result.pop('status_code', 400)
        return jsonify(result), status
    return jsonify(result), 200


@database_engines_bp.route('/<int:app_id>/extensions', methods=['POST'])
@admin_required
def install_engine_extension(app_id):
    """Install an extension into a database on this engine.

    Answers 409 with a ``remedy`` when the engine's image cannot ship the
    extension -- the statement is never attempted in that case, so the operator
    gets "your image does not carry this, install X instead" rather than a raw
    ``could not open extension control file``.
    """
    data = request.get_json(silent=True) or {}
    result = extensions.install_extension(
        app_id,
        extension_id=data.get('extension_id') or data.get('id'),
        database=data.get('database'),
    )
    if 'error' in result:
        status = result.pop('status_code', 400)
        return jsonify(result), status
    return jsonify(result), 201
