"""
Template API Endpoints

Provides REST endpoints for:
- Listing and browsing templates
- Template installation
- App updates from templates
- Template repository management
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, Application
from app.services.template_service import TemplateService

templates_bp = Blueprint('templates', __name__)


def admin_required(fn):
    """Decorator to require admin role."""
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        if not user or user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return fn(*args, **kwargs)
    return wrapper


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
    variables = []
    raw_vars = template.get('variables', [])

    if isinstance(raw_vars, list):
        # New list format: [{name: 'PORT', type: 'port', ...}, ...]
        for var in raw_vars:
            if isinstance(var, dict):
                variables.append({
                    'name': var.get('name', ''),
                    'description': var.get('description', ''),
                    'type': var.get('type', 'string'),
                    'default': var.get('default', ''),
                    'required': var.get('required', False),
                    'options': var.get('options', None)
                })
    elif isinstance(raw_vars, dict):
        # Old dict format: {PORT: {type: 'port', ...}, ...}
        for var_name, var_config in raw_vars.items():
            if isinstance(var_config, dict):
                variables.append({
                    'name': var_name,
                    'description': var_config.get('description', ''),
                    'type': var_config.get('type', 'string'),
                    'default': var_config.get('default', ''),
                    'required': var_config.get('required', False),
                    'options': var_config.get('options', None)
                })

    return jsonify({
        'template': {
            'id': template_id,
            'name': template.get('name'),
            'version': template.get('version'),
            'description': template.get('description'),
            'icon': template.get('icon'),
            'categories': template.get('categories', []),
            'source': template.get('source'),
            'documentation': template.get('documentation'),
            'website': template.get('website'),
            'variables': variables,
            'has_compose': 'compose' in template,
            'has_dockerfile': 'dockerfile' in template,
            'scripts': list(template.get('scripts', {}).keys()),
            'requirements': template.get('requirements', {}),
            'ports': template.get('ports', [])
        }
    }), 200


# ==================== TEMPLATE INSTALLATION ====================

@templates_bp.route('/<template_id>/install', methods=['POST'])
@jwt_required()
@admin_required
def install_template(template_id):
    """Install a template as a new application."""
    current_user_id = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    app_name = data.get('app_name')
    if not app_name:
        return jsonify({'error': 'app_name is required'}), 400

    # Validate app name
    import re
    if not re.match(r'^[a-z0-9][a-z0-9-]*[a-z0-9]$', app_name) or len(app_name) < 3:
        return jsonify({
            'error': 'App name must be lowercase alphanumeric with hyphens, at least 3 characters'
        }), 400

    user_variables = data.get('variables', {})

    result = TemplateService.install_template(
        template_id=template_id,
        app_name=app_name,
        user_variables=user_variables,
        user_id=current_user_id
    )

    return jsonify(result), 201 if result.get('success') else 400


@templates_bp.route('/validate-install', methods=['POST'])
@jwt_required()
def validate_installation():
    """Validate template installation parameters before installing."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    template_id = data.get('template_id')
    app_name = data.get('app_name')
    user_variables = data.get('variables', {})

    errors = []

    # Validate app name
    import re
    if not app_name:
        errors.append('App name is required')
    elif not re.match(r'^[a-z0-9][a-z0-9-]*[a-z0-9]$', app_name) or len(app_name) < 3:
        errors.append('App name must be lowercase alphanumeric with hyphens, at least 3 characters')

    # Check if app name is taken
    existing = Application.query.filter_by(name=app_name).first()
    if existing:
        errors.append(f'An application named "{app_name}" already exists')

    # Validate template exists and check required variables
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

    if errors:
        return jsonify({'valid': False, 'errors': errors}), 400

    return jsonify({'valid': True}), 200


# ==================== APP UPDATES ====================

@templates_bp.route('/apps/<int:app_id>/check-update', methods=['GET'])
@jwt_required()
def check_app_update(app_id):
    """Check if an installed app has updates available."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    result = TemplateService.check_updates(app_id)
    return jsonify(result), 200 if result.get('success') else 400


@templates_bp.route('/apps/<int:app_id>/update', methods=['POST'])
@jwt_required()
@admin_required
def update_app(app_id):
    """Update an app to the latest template version."""
    current_user_id = get_jwt_identity()
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = TemplateService.update_app(app_id, user_id=current_user_id)
    return jsonify(result), 200 if result.get('success') else 400


@templates_bp.route('/apps/<int:app_id>/template-info', methods=['GET'])
@jwt_required()
def get_app_template_info(app_id):
    """Get template installation info for an app."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

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
@jwt_required()
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
@jwt_required()
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
@jwt_required()
@admin_required
def sync_templates():
    """Sync templates from all repositories."""
    result = TemplateService.sync_templates()
    return jsonify(result), 200


# ==================== LOCAL TEMPLATE MANAGEMENT ====================

@templates_bp.route('/local', methods=['POST'])
@jwt_required()
@admin_required
def create_local_template():
    """Create a local template."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    result = TemplateService.create_local_template(data)
    return jsonify(result), 201 if result.get('success') else 400


@templates_bp.route('/local/<template_id>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_local_template(template_id):
    """Delete a local template."""
    result = TemplateService.delete_local_template(template_id)
    return jsonify(result), 200 if result.get('success') else 404
