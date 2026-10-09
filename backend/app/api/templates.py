# Bucket: PER-APP (plan 29 #9). The per-app template routes gate on the shared
# app-access seam; catalog browsing/installation stays panel-authed.
"""
Template API Endpoints

Provides REST endpoints for:
- Listing and browsing templates
- Template installation
- App updates from templates
- Template repository management
"""

from flask import Blueprint, current_app, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.middleware.rbac import admin_required, developer_required
from app.models import User, Application
from app.services.deployment_job_service import DeploymentJobService
from app.services.template_service import TemplateService
from app.services.repository_manifest_service import RepositoryManifestService
from app.services.resource_grant_service import ResourceGrantService
from app.utils.slug import app_name_clash_error, validate_app_name
from app.error_reporting import unexpected_response
from app.exceptions import not_found, permission_denied

templates_bp = Blueprint('templates', __name__)


# ==================== TEMPLATE BROWSING ====================

@templates_bp.route('/', methods=['GET'])
@jwt_required()
def list_templates():
    """List all available templates."""
    category = request.args.get('category')
    search = request.args.get('search')

    templates = TemplateService.list_all_templates(category=category, search=search)

    return jsonify({
        'templates': templates,
        'count': len(templates)
    }), 200


@templates_bp.route('/categories', methods=['GET'])
@jwt_required()
def get_categories():
    """Get all template categories."""
    categories = TemplateService.get_categories()
    return jsonify({'categories': categories}), 200


@templates_bp.route('/<template_id>', methods=['GET'])
@jwt_required()
def get_template(template_id):
    """Get detailed template information."""
    result = TemplateService.get_template(template_id)

    if not result.get('success'):
        return jsonify(result), 404

    template = result['template']

    # Add processed variable info - handle both list and dict formats
    # Auto-generated types that users don't need to fill in
    auto_generated_types = ['port', 'password', 'random', 'uuid']

    variables = []
    raw_vars = template.get('variables', [])

    if isinstance(raw_vars, list):
        # New list format: [{name: 'PORT', type: 'port', ...}, ...]
        for var in raw_vars:
            if isinstance(var, dict):
                var_type = var.get('type', 'string')
                variables.append({
                    'name': var.get('name', ''),
                    'description': var.get('description', ''),
                    'type': var_type,
                    'default': var.get('default', ''),
                    'required': var.get('required', False),
                    'options': var.get('options', None),
                    'auto_generated': var_type in auto_generated_types,
                    # Ports are hidden by default, but a template may say
                    # otherwise -- a database engine's port is the operator's
                    # decision, so its templates declare `hidden: false`.
                    'hidden': bool(var.get('hidden', var_type == 'port')),
                })
    elif isinstance(raw_vars, dict):
        # Old dict format: {PORT: {type: 'port', ...}, ...}
        for var_name, var_config in raw_vars.items():
            if isinstance(var_config, dict):
                var_type = var_config.get('type', 'string')
                variables.append({
                    'name': var_name,
                    'description': var_config.get('description', ''),
                    'type': var_type,
                    'default': var_config.get('default', ''),
                    'required': var_config.get('required', False),
                    'options': var_config.get('options', None),
                    'auto_generated': var_type in auto_generated_types,
                    'hidden': bool(var_config.get('hidden', var_type == 'port')),
                })

    return jsonify({
        'template': {
            'id': template_id,
            'name': template.get('name'),
            'version': template.get('version'),
            'description': template.get('description'),
            'icon': template.get('icon'),
            'categories': template.get('categories', []),
            'kind': template.get('kind', 'compose'),
            'repo': template.get('repo') if template.get('kind') == 'repo' else None,
            'source': template.get('source'),
            'documentation': template.get('documentation'),
            'website': template.get('website'),
            'variables': variables,
            # Present only for database-engine templates; the Databases install
            # drawer reads it to know which variable is the port / password.
            'engine': TemplateService.engine_metadata(template),
            'has_compose': 'compose' in template,
            'has_dockerfile': 'dockerfile' in template,
            'scripts': list(template.get('scripts', {}).keys()),
            'requirements': template.get('requirements', {}),
            'ports': template.get('ports', [])
        }
    }), 200


@templates_bp.route('/<template_id>/manifest', methods=['GET'])
@jwt_required()
def get_template_manifest(template_id):
    """Inspect a repo template's public repository for deploy manifests.

    Fetches the supported manifest files from the repo's raw host (no clone, no
    OAuth) and analyzes them. When live inspection turns up nothing (private
    repo, host down, no manifests), falls back to the template's declared
    ``repo`` hints and tags ``source: 'template-hints'`` so the wizard can label
    the confidence honestly.
    """
    result = TemplateService.get_template(template_id)
    if not result.get('success'):
        return jsonify(result), 404

    template = result['template']
    if template.get('kind') != 'repo':
        return jsonify({'error': 'Manifest inspection is only available for repo templates'}), 400

    repo = template.get('repo') or {}
    repo_url = repo.get('url')
    branch = request.args.get('branch') or repo.get('branch') or 'main'

    manifest = None
    if repo_url:
        try:
            manifest = RepositoryManifestService.analyze_public_repo(repo_url, branch)
        except Exception:
            manifest = None

    # A real inspection detected an actual strategy or at least one manifest file.
    if manifest and (manifest.get('strategy') or manifest.get('manifests')):
        manifest['source'] = 'repo'
        return jsonify({'manifest': manifest, 'source': 'repo'}), 200

    # Honest fallback: the declared hints, clearly labeled.
    hints = TemplateService.build_template_hints(template)
    hints['source'] = 'template-hints'
    return jsonify({'manifest': hints, 'source': 'template-hints'}), 200


# ==================== CATALOG SCHEMA ====================

@templates_bp.route('/catalog/schema', methods=['GET'])
@jwt_required()
def catalog_schema():
    """Describe the declarative template catalog schema for the UI.

    Returns the supported variable ``type`` values and the auto-resolved
    "magic variable" tokens (``${SERVICE_*}``) so the template editor / docs can
    surface them without hardcoding the list. Mirrors
    ``docs/TEMPLATE_CATALOG_SCHEMA.md``.
    """
    schema = {
        'schema_version': TemplateService.SCHEMA_VERSION,
        'variable_types': [
            {'type': 'string', 'auto_generated': False,
             'description': 'Free-text value; uses default unless required and user-provided.'},
            {'type': 'password', 'auto_generated': True,
             'description': 'Generated strong secret. Honors length and special_chars.'},
            {'type': 'port', 'auto_generated': True,
             'description': 'Always auto-assigned to a free host port; never user-supplied.'},
            {'type': 'uuid', 'auto_generated': True,
             'description': 'Generated UUIDv4.'},
            {'type': 'random', 'auto_generated': True,
             'description': 'Generated random hex token. Honors length.'},
        ],
        'magic_variables': [
            {'token': '${SERVICE_PASSWORD_<NAME>}',
             'description': 'Generated strong password, stable per <NAME> within an install.'},
            {'token': '${SERVICE_USER_<NAME>}',
             'description': 'Generated service username (svc_<name>_<rand>).'},
            {'token': '${SERVICE_FQDN_<NAME>}',
             'description': "Auto-assigned hostname (<slug>.<base_domain>) when auto_domain is set; "
                            "falls back to a localhost placeholder."},
            {'token': '${SERVICE_URL_<NAME>}',
             'description': 'Full URL derived from the FQDN and scheme.'},
            {'token': '${SERVICE_BASE64_<NAME>}',
             'description': 'Base64 of a freshly generated secret.'},
        ],
        # The optional `engine:` block is what makes a template installable from
        # the Databases page. It is described here rather than hardcoded in the
        # UI so a new engine is a YAML file, never a code change.
        'engine_block': {
            'optional': True,
            'description': 'Presence of a top-level `engine:` block marks the template '
                           'as an installable database engine and lists it in Databases.',
            'families': list(TemplateService.ENGINE_FAMILIES),
            'protocols': list(TemplateService.ENGINE_PROTOCOLS),
            'fields': [
                {'field': 'family', 'required': False,
                 'description': 'Grouping used by the catalog family filter.'},
                {'field': 'protocol', 'required': False,
                 'description': "Client adapter that can introspect it. 'none' is valid "
                                'and means the tree offers no browsing for this engine.'},
                {'field': 'default_port', 'required': False,
                 'description': "The engine's conventional port, shown as a hint."},
                {'field': 'admin_user', 'required': False,
                 'description': 'Bootstrap superuser created by the image.'},
                {'field': 'admin_password_var', 'required': False,
                 'description': "Name of the `variables` entry (type: password) holding "
                                'the admin secret, so the UI can surface it once.'},
                {'field': 'database_var', 'required': False,
                 'description': 'Variable that seeds an initial database, if the image supports one.'},
                {'field': 'port_var', 'required': False,
                 'default': TemplateService.ENGINE_DEFAULT_PORT_VAR,
                 'description': 'Variable holding the published host port.'},
                {'field': 'bind_var', 'required': False,
                 'default': TemplateService.ENGINE_DEFAULT_BIND_VAR,
                 'description': f'Variable holding the bind address. Defaults to '
                                f'{TemplateService.ENGINE_PRIVATE_BIND} (private); the installer '
                                f'sets {TemplateService.ENGINE_PUBLIC_BIND} only on an explicit '
                                'expose_public opt-in.'},
                {'field': 'unit', 'required': False,
                 'description': 'What a "table" is called here (collections, keys, buckets, ...).'},
                {'field': 'client', 'required': False,
                 'description': 'CLI client hint shown in the UI.'},
                {'field': 'data_path', 'required': False,
                 'description': 'Container-side data directory the named volume mounts onto.'},
                {'field': 'extensions', 'required': False, 'default': False,
                 'description': 'true when the engine can load database extensions (see '
                                'extension_block). Opt-in, because speaking a protocol is '
                                'not the same as supporting its extensions.'},
                {'field': 'versions', 'required': False,
                 'description': 'Selectable image versions. Defaults to the template version.'},
            ],
        },
        # An extension is NOT an app template: it has no container, so it is not
        # in this directory at all. Documented here because this endpoint is
        # where an author looks for "what can I drop into the catalog".
        'extension_block': {
            'optional': True,
            'location': f'<templates>/{TemplateService.EXTENSIONS_SUBDIR}/<id>.yaml',
            'family': TemplateService.EXTENSION_FAMILY,
            'description': 'An extension installs INTO a running engine by executing one '
                           'statement against it. It declares no compose/dockerfile and '
                           'creates no application; it lives in its own directory so it '
                           'never appears in the app catalog.',
            'protocols': [p for p in TemplateService.ENGINE_PROTOCOLS if p != 'none'],
            'fields': [
                {'field': 'protocol', 'required': True,
                 'description': "Engines that can host it, matched against each engine "
                                "template's own engine.protocol. Never names an engine."},
                {'field': 'statement', 'required': True,
                 'description': 'The statement executed on install, e.g. '
                                'CREATE EXTENSION IF NOT EXISTS vector;'},
                {'field': 'available_query', 'required': False,
                 'description': 'Asked before installing and authoritative: an empty result '
                                'means the running image cannot load the extension, and the '
                                'install is refused with a remedy instead of failing with '
                                '"could not open extension control file".'},
                {'field': 'installed_query', 'required': False,
                 'description': 'Returns the installed version, or nothing when absent.'},
                {'field': 'images', 'required': False,
                 'description': 'Image repositories that SHIP the extension. Stock postgres '
                                'does not ship pgvector, so this is what lets the catalog '
                                'mark an instance incompatible before it is clicked.'},
                {'field': 'image_hint', 'required': False,
                 'description': 'Image reference to suggest; {version} is replaced with the '
                                "installed engine's version."},
                {'field': 'templates', 'required': False,
                 'description': 'Optional narrowing to specific engine template ids. Omit to '
                                'offer it on every engine speaking `protocol`.'},
                {'field': 'versions', 'required': False,
                 'description': 'Selectable extension versions. Defaults to the file version.'},
            ],
        },
        'notes': [
            'Magic tokens need no variables: entry; they are resolved at install '
            'and persisted to .env / surfaced post-install.',
            '<NAME> groups related tokens: the same <NAME> resolves to a consistent value.',
            'Unknown top-level keys are tolerated by the validator; `engine` is now a '
            'known block and is carried through the catalog listing and repo index.',
            f'Database extensions are separate files under '
            f'{TemplateService.EXTENSIONS_SUBDIR}/ and are listed by '
            'GET /api/v1/databases/engines/extensions.',
        ],
    }
    return jsonify(schema), 200


# ==================== TEMPLATE INSTALLATION ====================

@templates_bp.route('/<template_id>/install', methods=['POST'])
@admin_required
def install_template(template_id):
    """Install a template as a new application."""
    try:
        current_user_id = get_jwt_identity()
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No data provided'}), 400

        app_name = data.get('app_name')
        if not app_name:
            return jsonify({'error': 'app_name is required'}), 400

        # Validate app name
        valid, error = validate_app_name(app_name, min_length=3)
        if not valid:
            return jsonify({'error': error}), 400

        user_variables = data.get('variables', {})
        server_id = data.get('server_id') or data.get('target_server_id')
        wait = bool(data.get('wait', False))
        # The deploy drawer sends true when it showed the operator a
        # <name>.<base> hostname — that promise must not depend on the
        # template YAML having opted in. Absent means the template decides.
        auto_domain = data.get('auto_domain')

        result = DeploymentJobService.install_template(
            template_id=template_id,
            app_name=app_name,
            user_variables=user_variables,
            user_id=current_user_id,
            server_id=server_id,
            wait=wait,
            auto_domain=None if auto_domain is None else bool(auto_domain),
        )

        if not result.get('success'):
            return jsonify(result), 400

        status = result.get('job', {}).get('status')
        return jsonify(result), 201 if status == 'succeeded' else 202

    except Exception as exc:  # noqa: BLE001 - reported, not swallowed
        # Was returning the full traceback to the caller and print()ing it.
        # The door logs it and files it under a request id instead.
        return unexpected_response(exc)


@templates_bp.route('/<template_id>/capacity', methods=['GET'])
@jwt_required()
def template_capacity(template_id):
    """Will this template fit on a given server?

    Read-only counterpart to the capacity block on /validate-install, so the
    deploy drawer can show the answer while the operator is still choosing a
    target — and update it when they switch servers — without POSTing a
    half-filled form. `server_id` omitted (or 'local') means this host.
    """
    result = TemplateService.get_template(template_id)
    if not result.get('success'):
        raise not_found('template')

    from app.services.capacity_service import check_fit
    return jsonify(check_fit(result['template'], request.args.get('server_id'))), 200


@templates_bp.route('/validate-install', methods=['POST'])
@jwt_required()
def validate_installation():
    """Validate template installation parameters before installing."""
    try:
        data = request.get_json()

        if not data:
            return jsonify({'error': 'No data provided'}), 400

        template_id = data.get('template_id')
        app_name = data.get('app_name')
        user_variables = data.get('variables', {})
        server_id = data.get('server_id') or data.get('target_server_id')

        errors = []
        capacity = None

        # Validate app name
        if not app_name:
            errors.append('App name is required')
        else:
            valid, error = validate_app_name(app_name, min_length=2)
            if not valid:
                errors.append(error)

        # Check if app name is taken
        # Deliberately unfiltered: a tombstone keeps RESERVING its name, or a
        # new app takes it and the restore is refused (_live_name_clash).
        if app_name:
            existing = Application.query.filter_by(name=app_name).first()
            if existing:
                errors.append(app_name_clash_error(existing, app_name))

        # Validate template exists and check required variables
        if template_id:
            result = TemplateService.get_template(template_id)
            if not result.get('success'):
                errors.append('Template not found')
            else:
                template = result['template']
                raw_vars = template.get('variables', [])

                # Handle both list and dict formats
                if isinstance(raw_vars, list):
                    for var in raw_vars:
                        if isinstance(var, dict) and var.get('required', False):
                            var_name = var.get('name', '')
                            if var_name and var_name not in user_variables:
                                errors.append(f'Required variable "{var_name}" is not provided')
                elif isinstance(raw_vars, dict):
                    for var_name, var_config in raw_vars.items():
                        if var_config.get('required', False) and var_name not in user_variables:
                            errors.append(f'Required variable "{var_name}" is not provided')

                # Does the target have room? Advisory: it rides alongside
                # `errors` rather than in it, so a tight server informs the
                # operator without refusing the install. Never fatal — a
                # capacity probe that throws must not block a deploy.
                try:
                    from app.services.capacity_service import check_fit
                    capacity = check_fit(template, server_id)
                except Exception:  # noqa: BLE001
                    current_app.logger.warning('capacity check failed', exc_info=True)
        else:
            errors.append('Template ID is required')

        if errors:
            return jsonify({'valid': False, 'errors': errors,
                            'capacity': capacity}), 400

        return jsonify({'valid': True, 'capacity': capacity}), 200

    except Exception as exc:  # noqa: BLE001 - reported, not swallowed
        return unexpected_response(exc)


@templates_bp.route('/test-db-connection', methods=['POST'])
@developer_required
def test_db_connection():
    """Test database connection before template installation.

    Used to validate external database connections for templates
    like wordpress-external-db before attempting installation.

    Request body:
        host: Database host (required)
        port: Database port (default: 3306)
        user: Database username (required)
        password: Database password (required)
        database: Database name (required)

    Returns:
        200: Connection successful
        400: Connection failed or missing parameters
    """
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required = ['host', 'user', 'password', 'database']
    for field in required:
        if field not in data:
            return jsonify({'error': f'Missing required field: {field}'}), 400

    result = TemplateService.validate_mysql_connection(
        host=data.get('host'),
        port=data.get('port', 3306),
        user=data.get('user'),
        password=data.get('password'),
        database=data.get('database')
    )

    if result.get('success'):
        response = {'success': True, 'message': 'Connection successful'}
        if result.get('warning'):
            response['warning'] = result.get('warning')
        return jsonify(response), 200
    else:
        return jsonify({
            'success': False,
            'error': result.get('error')
        }), 400


# ==================== APP UPDATES ====================

@templates_bp.route('/apps/<int:app_id>/check-update', methods=['GET'])
@jwt_required()
def check_app_update(app_id):
    """Check if an installed app has updates available."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

    result = TemplateService.check_updates(app_id)
    return jsonify(result), 200 if result.get('success') else 400


@templates_bp.route('/apps/<int:app_id>/update', methods=['POST'])
@admin_required
def update_app(app_id):
    """Update an app to the latest template version."""
    current_user_id = get_jwt_identity()
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    result = TemplateService.update_app(app_id, user_id=current_user_id)
    return jsonify(result), 200 if result.get('success') else 400


@templates_bp.route('/apps/<int:app_id>/template-info', methods=['GET'])
@jwt_required()
def get_app_template_info(app_id):
    """Get template installation info for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

    info = TemplateService.get_installed_info(app_id)
    if info:
        return jsonify({'installed_from_template': True, 'info': info}), 200

    return jsonify({'installed_from_template': False}), 200


# ==================== REPOSITORY MANAGEMENT ====================

@templates_bp.route('/repos', methods=['GET'])
@jwt_required()
def list_repositories():
    """List configured template repositories."""
    repos = TemplateService.list_repositories()
    return jsonify({'repositories': repos}), 200


@templates_bp.route('/repos', methods=['POST'])
@admin_required
def add_repository():
    """Add a template repository."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    name = data.get('name')
    url = data.get('url')

    if not name or not url:
        return jsonify({'error': 'name and url are required'}), 400

    result = TemplateService.add_repository(name, url)
    return jsonify(result), 201 if result.get('success') else 400


@templates_bp.route('/repos', methods=['DELETE'])
@admin_required
def remove_repository():
    """Remove a template repository."""
    data = request.get_json()
    url = data.get('url') if data else None

    if not url:
        return jsonify({'error': 'url is required'}), 400

    result = TemplateService.remove_repository(url)
    return jsonify(result), 200 if result.get('success') else 400


@templates_bp.route('/sync', methods=['POST'])
@admin_required
def sync_templates():
    """Sync templates from all repositories."""
    result = TemplateService.sync_templates()
    return jsonify(result), 200


@templates_bp.route('/repos/index', methods=['GET'])
@jwt_required()
def repo_index():
    """Return the index.json describing the locally-bundled templates.

    This is the document a template repository serves at ``<repo>/index.json``;
    exposing it lets this instance act as (or seed) a community template repo.
    """
    return jsonify(TemplateService.build_repo_index()), 200


@templates_bp.route('/repos/index/export', methods=['POST'])
@admin_required
def export_repo_index():
    """Write index.json next to the bundled templates so the directory can be
    published as a repository."""
    result = TemplateService.export_repo_index()
    return jsonify(result), 200 if result.get('success') else 400


# ==================== LOCAL TEMPLATE MANAGEMENT ====================

@templates_bp.route('/local', methods=['POST'])
@admin_required
def create_local_template():
    """Create a local template."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    result = TemplateService.create_local_template(data)
    return jsonify(result), 201 if result.get('success') else 400


@templates_bp.route('/local/<template_id>', methods=['DELETE'])
@admin_required
def delete_local_template(template_id):
    """Delete a local template."""
    result = TemplateService.delete_local_template(template_id)
    return jsonify(result), 200 if result.get('success') else 404
