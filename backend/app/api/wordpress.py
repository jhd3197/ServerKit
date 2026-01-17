from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, Application
from app.services.wordpress_service import WordPressService
from app import db

wordpress_bp = Blueprint('wordpress', __name__)


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


@wordpress_bp.route('/install', methods=['POST'])
@jwt_required()
@admin_required
def install_wordpress():
    """Install a new WordPress site."""
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    required_fields = ['path', 'site_url', 'admin_email', 'db_name', 'db_user', 'db_password']
    missing = [f for f in required_fields if f not in data]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    result = WordPressService.install_wordpress(data['path'], data)

    if result['success']:
        # Create application record
        current_user_id = get_jwt_identity()
        app = Application(
            name=data.get('site_title', 'WordPress Site'),
            app_type='wordpress',
            status='running',
            php_version=data.get('php_version', '8.2'),
            root_path=data['path'],
            user_id=current_user_id
        )
        db.session.add(app)
        db.session.commit()
        result['app_id'] = app.id

    return jsonify(result), 201 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/info', methods=['GET'])
@jwt_required()
def get_wordpress_info(app_id):
    """Get WordPress site info."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    if app.app_type != 'wordpress':
        return jsonify({'error': 'Application is not a WordPress site'}), 400

    info = WordPressService.get_wordpress_info(app.root_path)
    if not info:
        return jsonify({'error': 'Could not get WordPress info'}), 400

    return jsonify({'info': info}), 200


@wordpress_bp.route('/sites/<int:app_id>/update', methods=['POST'])
@jwt_required()
@admin_required
def update_wordpress(app_id):
    """Update WordPress core."""
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if app.app_type != 'wordpress':
        return jsonify({'error': 'Application is not a WordPress site'}), 400

    result = WordPressService.update_wordpress(app.root_path)
    return jsonify(result), 200 if result['success'] else 400


# Plugin management
@wordpress_bp.route('/sites/<int:app_id>/plugins', methods=['GET'])
@jwt_required()
def get_plugins(app_id):
    """Get installed plugins."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    plugins = WordPressService.get_plugins(app.root_path)
    return jsonify({'plugins': plugins}), 200


@wordpress_bp.route('/sites/<int:app_id>/plugins', methods=['POST'])
@jwt_required()
@admin_required
def install_plugin(app_id):
    """Install a plugin."""
    app = Application.query.get(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not data or 'plugin' not in data:
        return jsonify({'error': 'plugin is required'}), 400

    result = WordPressService.install_plugin(
        app.root_path,
        data['plugin'],
        data.get('activate', True)
    )
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/plugins/<plugin>', methods=['DELETE'])
@jwt_required()
@admin_required
def uninstall_plugin(app_id, plugin):
    """Uninstall a plugin."""
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.uninstall_plugin(app.root_path, plugin)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/plugins/<plugin>/activate', methods=['POST'])
@jwt_required()
@admin_required
def activate_plugin(app_id, plugin):
    """Activate a plugin."""
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.activate_plugin(app.root_path, plugin)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/plugins/<plugin>/deactivate', methods=['POST'])
@jwt_required()
@admin_required
def deactivate_plugin(app_id, plugin):
    """Deactivate a plugin."""
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.deactivate_plugin(app.root_path, plugin)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/plugins/update', methods=['POST'])
@jwt_required()
@admin_required
def update_plugins(app_id):
    """Update plugins."""
    app = Application.query.get(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    plugins = data.get('plugins') if data else None
    result = WordPressService.update_plugins(app.root_path, plugins)
    return jsonify(result), 200 if result['success'] else 400


# Theme management
@wordpress_bp.route('/sites/<int:app_id>/themes', methods=['GET'])
@jwt_required()
def get_themes(app_id):
    """Get installed themes."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    themes = WordPressService.get_themes(app.root_path)
    return jsonify({'themes': themes}), 200


@wordpress_bp.route('/sites/<int:app_id>/themes', methods=['POST'])
@jwt_required()
@admin_required
def install_theme(app_id):
    """Install a theme."""
    app = Application.query.get(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not data or 'theme' not in data:
        return jsonify({'error': 'theme is required'}), 400

    result = WordPressService.install_theme(
        app.root_path,
        data['theme'],
        data.get('activate', False)
    )
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/themes/<theme>/activate', methods=['POST'])
@jwt_required()
@admin_required
def activate_theme(app_id, theme):
    """Activate a theme."""
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.activate_theme(app.root_path, theme)
    return jsonify(result), 200 if result['success'] else 400


# Backup management
@wordpress_bp.route('/sites/<int:app_id>/backup', methods=['POST'])
@jwt_required()
@admin_required
def create_backup(app_id):
    """Create a backup."""
    app = Application.query.get(app_id)
    data = request.get_json() or {}

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.backup_wordpress(
        app.root_path,
        data.get('include_db', True)
    )
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/backups', methods=['GET'])
@jwt_required()
def list_backups(app_id):
    """List backups for a site."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    import os
    site_name = os.path.basename(app.root_path)
    backups = WordPressService.list_backups(site_name)
    return jsonify({'backups': backups}), 200


@wordpress_bp.route('/sites/<int:app_id>/restore', methods=['POST'])
@jwt_required()
@admin_required
def restore_backup(app_id):
    """Restore a backup."""
    app = Application.query.get(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not data or 'backup_name' not in data:
        return jsonify({'error': 'backup_name is required'}), 400

    result = WordPressService.restore_backup(data['backup_name'], app.root_path)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/backups/<backup_name>', methods=['DELETE'])
@jwt_required()
@admin_required
def delete_backup(backup_name):
    """Delete a backup."""
    result = WordPressService.delete_backup(backup_name)
    return jsonify(result), 200 if result['success'] else 400


# Security and maintenance
@wordpress_bp.route('/sites/<int:app_id>/harden', methods=['POST'])
@jwt_required()
@admin_required
def harden_wordpress(app_id):
    """Apply security hardening."""
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.harden_wordpress(app.root_path)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/search-replace', methods=['POST'])
@jwt_required()
@admin_required
def search_replace(app_id):
    """Search and replace in database."""
    app = Application.query.get(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not data or 'search' not in data or 'replace' not in data:
        return jsonify({'error': 'search and replace are required'}), 400

    result = WordPressService.search_replace(
        app.root_path,
        data['search'],
        data['replace'],
        data.get('dry_run', True)
    )
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/optimize', methods=['POST'])
@jwt_required()
@admin_required
def optimize_database(app_id):
    """Optimize WordPress database."""
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.optimize_database(app.root_path)
    return jsonify(result), 200 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/flush-cache', methods=['POST'])
@jwt_required()
@admin_required
def flush_cache(app_id):
    """Flush WordPress cache."""
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.flush_cache(app.root_path)
    return jsonify(result), 200 if result['success'] else 400


# User management
@wordpress_bp.route('/sites/<int:app_id>/users', methods=['POST'])
@jwt_required()
@admin_required
def create_wp_user(app_id):
    """Create a WordPress user."""
    app = Application.query.get(app_id)
    data = request.get_json()

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not data or 'username' not in data or 'email' not in data:
        return jsonify({'error': 'username and email are required'}), 400

    result = WordPressService.create_user(
        app.root_path,
        data['username'],
        data['email'],
        data.get('role', 'subscriber'),
        data.get('password')
    )
    return jsonify(result), 201 if result['success'] else 400


@wordpress_bp.route('/sites/<int:app_id>/users/<user>/reset-password', methods=['POST'])
@jwt_required()
@admin_required
def reset_wp_password(app_id, user):
    """Reset a WordPress user's password."""
    app = Application.query.get(app_id)
    data = request.get_json() or {}

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    result = WordPressService.reset_password(app.root_path, user, data.get('password'))
    return jsonify(result), 200 if result['success'] else 400


# WP-CLI status
@wordpress_bp.route('/wp-cli/status', methods=['GET'])
@jwt_required()
@admin_required
def wp_cli_status():
    """Check WP-CLI installation status."""
    installed = WordPressService.is_wp_cli_installed()
    return jsonify({
        'installed': installed,
        'path': WordPressService.WP_CLI_PATH if installed else None
    }), 200


@wordpress_bp.route('/wp-cli/install', methods=['POST'])
@jwt_required()
@admin_required
def install_wp_cli():
    """Install WP-CLI."""
    result = WordPressService.install_wp_cli()
    return jsonify(result), 200 if result['success'] else 400
