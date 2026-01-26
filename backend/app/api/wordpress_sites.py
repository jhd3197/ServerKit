"""
WordPress Sites API

API endpoints for WordPress site management including:
- Site listing and creation
- Environment management (dev/staging)
- Database operations (snapshots, sync, clone)
- Git integration
"""

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
import json

from app import db
from app.models.application import Application
from app.models.wordpress_site import WordPressSite, DatabaseSnapshot, SyncJob
from app.services.wordpress_service import WordPressService
from app.services.wordpress_env_service import WordPressEnvService
from app.services.db_sync_service import DatabaseSyncService
from app.services.git_wordpress_service import GitWordPressService
from app.services.resource_tier_service import ResourceTierService

wordpress_sites_bp = Blueprint('wordpress_sites', __name__)


# =============================================================================
# Site Management
# =============================================================================

@wordpress_sites_bp.route('/sites', methods=['GET'])
@jwt_required()
def list_sites():
    """List all WordPress sites."""
    user_id = get_jwt_identity()
    include_envs = request.args.get('include_environments', 'false').lower() == 'true'

    # Get all WordPress applications for this user
    sites = WordPressSite.query.join(Application).filter(
        Application.user_id == user_id,
        Application.app_type == 'wordpress'
    ).all()

    # Separate production and environment sites
    production_sites = [s for s in sites if s.is_production]

    return jsonify({
        'sites': [s.to_dict(include_environments=include_envs) for s in production_sites],
        'total': len(production_sites)
    })


@wordpress_sites_bp.route('/sites', methods=['POST'])
@jwt_required()
def create_site():
    """Create a new WordPress site."""
    user_id = get_jwt_identity()
    data = request.get_json()

    # Check resource tier - block creation on lite tier servers
    tier_info = ResourceTierService.get_tier_info()
    if not tier_info['features']['wordpress_create']:
        min_req = ResourceTierService.get_minimum_requirements()
        return jsonify({
            'error': 'Server resources insufficient for WordPress',
            'reason': 'wordpress_blocked',
            'specs': tier_info['specs'],
            'tier': tier_info['tier'],
            'minimum_requirements': min_req,
            'message': (
                f"WordPress site creation requires at least {min_req['cpu_cores']} CPU cores "
                f"and {min_req['ram_gb']}GB RAM. Your server has {tier_info['specs']['cpu_cores']} core(s) "
                f"and {tier_info['specs']['ram_gb']}GB RAM. Consider upgrading your server."
            )
        }), 403

    # Validate required fields
    required = ['name', 'domain', 'db_name', 'db_user', 'db_password', 'admin_email']
    missing = [f for f in required if not data.get(f)]
    if missing:
        return jsonify({'error': f'Missing required fields: {", ".join(missing)}'}), 400

    try:
        # Create Application record
        app = Application(
            name=data['name'],
            app_type='wordpress',
            status='deploying',
            php_version=data.get('php_version', '8.2'),
            port=data.get('port'),
            root_path=data.get('root_path', f"/var/www/{data['name'].lower().replace(' ', '_')}"),
            environment_type='production',
            user_id=user_id
        )
        db.session.add(app)
        db.session.flush()

        # Create WordPressSite record
        site = WordPressSite(
            application_id=app.id,
            admin_email=data['admin_email'],
            admin_user=data.get('admin_user', 'admin'),
            db_name=data['db_name'],
            db_user=data['db_user'],
            db_host=data.get('db_host', 'localhost'),
            db_prefix=data.get('db_prefix', 'wp_'),
            is_production=True
        )
        db.session.add(site)

        # Install WordPress
        install_result = WordPressService.install_wordpress(
            path=app.root_path,
            config={
                'site_url': f"https://{data['domain']}",
                'site_title': data['name'],
                'admin_user': data.get('admin_user', 'admin'),
                'admin_password': data.get('admin_password'),
                'admin_email': data['admin_email'],
                'db_name': data['db_name'],
                'db_user': data['db_user'],
                'db_password': data['db_password'],
                'db_host': data.get('db_host', 'localhost'),
                'db_prefix': data.get('db_prefix', 'wp_')
            }
        )

        if not install_result['success']:
            db.session.rollback()
            return jsonify({'error': install_result.get('error', 'Installation failed')}), 500

        # Get WordPress version
        wp_info = WordPressService.get_wordpress_info(app.root_path)
        if wp_info:
            site.wp_version = wp_info.get('version')

        app.status = 'running'
        db.session.commit()

        return jsonify({
            'success': True,
            'site': site.to_dict(),
            'admin_password': install_result.get('admin_password')
        }), 201

    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@wordpress_sites_bp.route('/sites/<int:site_id>', methods=['GET'])
@jwt_required()
def get_site(site_id):
    """Get a WordPress site by ID."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    include_envs = request.args.get('include_environments', 'true').lower() == 'true'
    include_snaps = request.args.get('include_snapshots', 'false').lower() == 'true'

    result = site.to_dict(include_environments=include_envs, include_snapshots=include_snaps)

    # Add WordPress info from WP-CLI
    if site.application and site.application.root_path:
        wp_info = WordPressService.get_wordpress_info(site.application.root_path)
        if wp_info:
            result['wp_info'] = wp_info

    return jsonify(result)


@wordpress_sites_bp.route('/sites/<int:site_id>', methods=['DELETE'])
@jwt_required()
def delete_site(site_id):
    """Delete a WordPress site."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    # Check if this is a production site with environments
    if site.is_production and site.environments:
        return jsonify({
            'error': 'Cannot delete production site with active environments. Delete environments first.'
        }), 400

    try:
        # Use environment service to clean up (handles files, database, etc.)
        result = WordPressEnvService.delete_environment(
            site_id,
            delete_files=True,
            delete_database=True
        )

        if not result['success']:
            return jsonify(result), 500

        return jsonify({'success': True, 'message': 'Site deleted'})

    except Exception as e:
        return jsonify({'error': str(e)}), 500


# =============================================================================
# Environment Management
# =============================================================================

@wordpress_sites_bp.route('/sites/<int:site_id>/environments', methods=['GET'])
@jwt_required()
def list_environments(site_id):
    """List all environments for a production site."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    result = WordPressEnvService.get_environment_status(site_id)
    return jsonify(result)


@wordpress_sites_bp.route('/sites/<int:site_id>/environments', methods=['POST'])
@jwt_required()
def create_environment(site_id):
    """Create a new environment (dev/staging) for a production site."""
    user_id = get_jwt_identity()
    data = request.get_json()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    env_type = data.get('type', 'development')
    if env_type not in ['development', 'staging']:
        return jsonify({'error': 'Invalid environment type'}), 400

    result = WordPressEnvService.create_environment(
        production_site_id=site_id,
        env_type=env_type,
        config=data,
        user_id=user_id
    )

    if result['success']:
        return jsonify(result), 201
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/environments/<int:env_id>', methods=['DELETE'])
@jwt_required()
def delete_environment(site_id, env_id):
    """Delete an environment."""
    user_id = get_jwt_identity()

    # Verify ownership
    env_site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == env_id,
        Application.user_id == user_id
    ).first()

    if not env_site:
        return jsonify({'error': 'Environment not found'}), 404

    if env_site.production_site_id != site_id:
        return jsonify({'error': 'Environment does not belong to this site'}), 400

    result = WordPressEnvService.delete_environment(env_id)
    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/sync', methods=['POST'])
@jwt_required()
def sync_environment(site_id):
    """Sync an environment from its production source."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    if site.is_production:
        return jsonify({'error': 'Cannot sync a production site'}), 400

    result = WordPressEnvService.sync_environment(site_id, options=data)
    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Database Operations
# =============================================================================

@wordpress_sites_bp.route('/sites/<int:site_id>/snapshots', methods=['GET'])
@jwt_required()
def list_snapshots(site_id):
    """List database snapshots for a site."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    snapshots = DatabaseSnapshot.query.filter_by(site_id=site_id).order_by(
        DatabaseSnapshot.created_at.desc()
    ).all()

    return jsonify({
        'snapshots': [s.to_dict() for s in snapshots],
        'total': len(snapshots)
    })


@wordpress_sites_bp.route('/sites/<int:site_id>/snapshots', methods=['POST'])
@jwt_required()
def create_snapshot(site_id):
    """Create a database snapshot."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    result = DatabaseSyncService.create_snapshot(
        db_name=site.db_name,
        name=data.get('name', f"{site.application.name}_{site.id}"),
        tag=data.get('tag'),
        commit_sha=site.last_deploy_commit,
        host=site.db_host,
        user=site.db_user,
        password=WordPressEnvService._get_db_password(site),
        exclude_tables=data.get('exclude_tables', [])
    )

    if result['success']:
        # Save to database
        snapshot = DatabaseSnapshot(
            site_id=site_id,
            name=result['snapshot']['name'],
            tag=data.get('tag'),
            file_path=result['snapshot']['file_path'],
            size_bytes=result['snapshot']['size_bytes'],
            compressed=result['snapshot']['compressed'],
            commit_sha=site.last_deploy_commit,
            tables_included=json.dumps(result['snapshot'].get('tables', [])),
            row_count=result['snapshot'].get('row_count', 0),
            status='completed'
        )
        db.session.add(snapshot)
        db.session.commit()

        return jsonify({
            'success': True,
            'snapshot': snapshot.to_dict()
        }), 201
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/snapshots/<int:snapshot_id>/restore', methods=['POST'])
@jwt_required()
def restore_snapshot(site_id, snapshot_id):
    """Restore a database snapshot."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    snapshot = DatabaseSnapshot.query.filter_by(id=snapshot_id, site_id=site_id).first()
    if not snapshot:
        return jsonify({'error': 'Snapshot not found'}), 404

    # Create a backup before restoring
    backup_result = DatabaseSyncService.create_snapshot(
        db_name=site.db_name,
        name=f"pre_restore_{snapshot_id}",
        tag='pre-restore',
        host=site.db_host,
        user=site.db_user,
        password=WordPressEnvService._get_db_password(site)
    )

    # Restore the snapshot
    result = DatabaseSyncService.restore_snapshot(
        file_path=snapshot.file_path,
        target_db=site.db_name,
        host=site.db_host,
        user=site.db_user,
        password=WordPressEnvService._get_db_password(site),
        create_db=False
    )

    if result['success']:
        return jsonify({
            'success': True,
            'message': 'Snapshot restored',
            'backup_path': backup_result.get('snapshot', {}).get('file_path') if backup_result.get('success') else None
        })
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/snapshots/<int:snapshot_id>', methods=['DELETE'])
@jwt_required()
def delete_snapshot(site_id, snapshot_id):
    """Delete a database snapshot."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    snapshot = DatabaseSnapshot.query.filter_by(id=snapshot_id, site_id=site_id).first()
    if not snapshot:
        return jsonify({'error': 'Snapshot not found'}), 404

    # Delete file
    DatabaseSyncService.delete_snapshot(snapshot.file_path)

    # Delete record
    db.session.delete(snapshot)
    db.session.commit()

    return jsonify({'success': True, 'message': 'Snapshot deleted'})


@wordpress_sites_bp.route('/sites/<int:site_id>/clone-db', methods=['POST'])
@jwt_required()
def clone_database(site_id):
    """Clone the database to another environment."""
    user_id = get_jwt_identity()
    data = request.get_json()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    target_site_id = data.get('target_site_id')
    if not target_site_id:
        return jsonify({'error': 'target_site_id is required'}), 400

    target_site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == target_site_id,
        Application.user_id == user_id
    ).first()

    if not target_site:
        return jsonify({'error': 'Target site not found'}), 404

    result = DatabaseSyncService.clone_database(
        source_db=site.db_name,
        target_db=target_site.db_name,
        source_host=site.db_host,
        target_host=target_site.db_host,
        source_user=site.db_user,
        target_user=target_site.db_user,
        source_password=WordPressEnvService._get_db_password(site),
        target_password=WordPressEnvService._get_db_password(target_site),
        options=data.get('options', {})
    )

    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


# =============================================================================
# Git Integration
# =============================================================================

@wordpress_sites_bp.route('/sites/<int:site_id>/git', methods=['GET'])
@jwt_required()
def get_git_status(site_id):
    """Get Git integration status for a site."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    result = GitWordPressService.get_git_status(site_id)
    return jsonify(result)


@wordpress_sites_bp.route('/sites/<int:site_id>/git', methods=['POST'])
@jwt_required()
def connect_repo(site_id):
    """Connect a Git repository to a site."""
    user_id = get_jwt_identity()
    data = request.get_json()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    repo_url = data.get('repo_url')
    if not repo_url:
        return jsonify({'error': 'repo_url is required'}), 400

    result = GitWordPressService.connect_repo(
        site_id=site_id,
        repo_url=repo_url,
        branch=data.get('branch', 'main'),
        paths=data.get('paths'),
        auto_deploy=data.get('auto_deploy', False)
    )

    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/git', methods=['DELETE'])
@jwt_required()
def disconnect_repo(site_id):
    """Disconnect Git repository from a site."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    result = GitWordPressService.disconnect_repo(site_id)
    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/git/commits', methods=['GET'])
@jwt_required()
def get_commits(site_id):
    """Get recent commits from the connected repository."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    limit = request.args.get('limit', 20, type=int)
    result = GitWordPressService.get_recent_commits(site_id, limit=limit)
    return jsonify(result)


@wordpress_sites_bp.route('/sites/<int:site_id>/git/deploy', methods=['POST'])
@jwt_required()
def deploy_commit(site_id):
    """Deploy a specific commit or branch."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    result = GitWordPressService.deploy_from_commit(
        site_id=site_id,
        commit_sha=data.get('commit_sha'),
        branch=data.get('branch'),
        create_snapshot=data.get('create_snapshot', True)
    )

    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/git/dev-from-commit', methods=['POST'])
@jwt_required()
def create_dev_from_commit(site_id):
    """Create a development environment for a specific commit."""
    user_id = get_jwt_identity()
    data = request.get_json()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site:
        return jsonify({'error': 'Site not found'}), 404

    commit_sha = data.get('commit_sha')
    if not commit_sha:
        return jsonify({'error': 'commit_sha is required'}), 400

    result = GitWordPressService.create_dev_for_commit(
        production_site_id=site_id,
        commit_sha=commit_sha,
        config=data.get('config', {}),
        user_id=user_id
    )

    if result['success']:
        return jsonify(result), 201
    else:
        return jsonify(result), 500


# =============================================================================
# WordPress Operations (Plugins, Themes, etc.)
# =============================================================================

@wordpress_sites_bp.route('/sites/<int:site_id>/plugins', methods=['GET'])
@jwt_required()
def get_plugins(site_id):
    """Get installed plugins for a site."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site or not site.application:
        return jsonify({'error': 'Site not found'}), 404

    plugins = WordPressService.get_plugins(site.application.root_path)
    return jsonify({'plugins': plugins})


@wordpress_sites_bp.route('/sites/<int:site_id>/plugins', methods=['POST'])
@jwt_required()
def install_plugin(site_id):
    """Install a plugin."""
    user_id = get_jwt_identity()
    data = request.get_json()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site or not site.application:
        return jsonify({'error': 'Site not found'}), 404

    plugin = data.get('plugin')
    if not plugin:
        return jsonify({'error': 'plugin is required'}), 400

    result = WordPressService.install_plugin(
        site.application.root_path,
        plugin,
        activate=data.get('activate', True)
    )

    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/themes', methods=['GET'])
@jwt_required()
def get_themes(site_id):
    """Get installed themes for a site."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site or not site.application:
        return jsonify({'error': 'Site not found'}), 404

    themes = WordPressService.get_themes(site.application.root_path)
    return jsonify({'themes': themes})


@wordpress_sites_bp.route('/sites/<int:site_id>/themes', methods=['POST'])
@jwt_required()
def install_theme(site_id):
    """Install a theme."""
    user_id = get_jwt_identity()
    data = request.get_json()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site or not site.application:
        return jsonify({'error': 'Site not found'}), 404

    theme = data.get('theme')
    if not theme:
        return jsonify({'error': 'theme is required'}), 400

    result = WordPressService.install_theme(
        site.application.root_path,
        theme,
        activate=data.get('activate', False)
    )

    if result['success']:
        return jsonify(result)
    else:
        return jsonify(result), 500


@wordpress_sites_bp.route('/sites/<int:site_id>/update', methods=['POST'])
@jwt_required()
def update_wordpress(site_id):
    """Update WordPress core."""
    user_id = get_jwt_identity()

    site = WordPressSite.query.join(Application).filter(
        WordPressSite.id == site_id,
        Application.user_id == user_id
    ).first()

    if not site or not site.application:
        return jsonify({'error': 'Site not found'}), 404

    # Create snapshot before update
    snapshot_result = DatabaseSyncService.create_snapshot(
        db_name=site.db_name,
        name=f"pre_update_{site.wp_version}",
        tag='pre-update',
        host=site.db_host,
        user=site.db_user,
        password=WordPressEnvService._get_db_password(site)
    )

    result = WordPressService.update_wordpress(site.application.root_path)

    if result['success']:
        # Update version in database
        wp_info = WordPressService.get_wordpress_info(site.application.root_path)
        if wp_info:
            site.wp_version = wp_info.get('version')
            db.session.commit()

        return jsonify({
            'success': True,
            'message': result.get('message'),
            'new_version': site.wp_version,
            'backup_snapshot': snapshot_result.get('snapshot', {}).get('file_path') if snapshot_result.get('success') else None
        })
    else:
        return jsonify(result), 500
