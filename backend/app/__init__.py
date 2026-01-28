import os
from flask import Flask, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from config import config

db = SQLAlchemy()
jwt = JWTManager()
limiter = Limiter(key_func=get_remote_address, default_limits=["100 per minute"])
socketio = None

# Path to frontend dist folder (relative to backend folder)
FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'frontend', 'dist')


def create_app(config_name=None):
    global socketio

    if config_name is None:
        config_name = os.environ.get('FLASK_ENV', 'development')

    # Configure Flask to serve static files from frontend dist
    app = Flask(
        __name__,
        static_folder=FRONTEND_DIST,
        static_url_path=''
    )
    app.config.from_object(config[config_name])

    # Initialize extensions
    db.init_app(app)
    jwt.init_app(app)
    limiter.init_app(app)
    CORS(
        app,
        origins=app.config['CORS_ORIGINS'],
        supports_credentials=True,
        allow_headers=['Content-Type', 'Authorization', 'X-Requested-With'],
        methods=['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
    )

    # Register security headers middleware
    from app.middleware.security import register_security_headers
    register_security_headers(app)

    # Initialize SocketIO
    from app.sockets import init_socketio
    socketio = init_socketio(app)

    # Initialize Agent Gateway
    from app.agent_gateway import init_agent_gateway
    init_agent_gateway(socketio)

    # Register blueprints - Auth
    from app.api.auth import auth_bp
    app.register_blueprint(auth_bp, url_prefix='/api/v1/auth')

    # Register blueprints - Core
    from app.api.apps import apps_bp
    from app.api.domains import domains_bp
    from app.api.private_urls import private_urls_bp
    app.register_blueprint(apps_bp, url_prefix='/api/v1/apps')
    app.register_blueprint(domains_bp, url_prefix='/api/v1/domains')
    app.register_blueprint(private_urls_bp, url_prefix='/api/v1/apps')

    # Register blueprints - System
    from app.api.system import system_bp
    from app.api.processes import processes_bp
    from app.api.logs import logs_bp
    app.register_blueprint(system_bp, url_prefix='/api/v1/system')
    app.register_blueprint(processes_bp, url_prefix='/api/v1/processes')
    app.register_blueprint(logs_bp, url_prefix='/api/v1/logs')

    # Register blueprints - Infrastructure
    from app.api.nginx import nginx_bp
    from app.api.ssl import ssl_bp
    app.register_blueprint(nginx_bp, url_prefix='/api/v1/nginx')
    app.register_blueprint(ssl_bp, url_prefix='/api/v1/ssl')

    # Register blueprints - PHP & WordPress
    from app.api.php import php_bp
    from app.api.wordpress import wordpress_bp
    from app.api.wordpress_sites import wordpress_sites_bp
    from app.api.environment_pipeline import environment_pipeline_bp
    app.register_blueprint(php_bp, url_prefix='/api/v1/php')
    app.register_blueprint(wordpress_bp, url_prefix='/api/v1/wordpress')
    app.register_blueprint(wordpress_sites_bp, url_prefix='/api/v1/wordpress')
    app.register_blueprint(environment_pipeline_bp, url_prefix='/api/v1/wordpress/projects')

    # Register blueprints - Python
    from app.api.python import python_bp
    app.register_blueprint(python_bp, url_prefix='/api/v1/python')

    # Register blueprints - Docker
    from app.api.docker import docker_bp
    app.register_blueprint(docker_bp, url_prefix='/api/v1/docker')

    # Register blueprints - Databases
    from app.api.databases import databases_bp
    app.register_blueprint(databases_bp, url_prefix='/api/v1/databases')

    # Register blueprints - Monitoring & Alerts
    from app.api.monitoring import monitoring_bp
    app.register_blueprint(monitoring_bp, url_prefix='/api/v1/monitoring')

    # Register blueprints - Notifications
    from app.api.notifications import notifications_bp
    app.register_blueprint(notifications_bp, url_prefix='/api/v1/notifications')

    # Register blueprints - Backups
    from app.api.backups import backups_bp
    app.register_blueprint(backups_bp, url_prefix='/api/v1/backups')

    # Register blueprints - Git Deployment
    from app.api.deploy import deploy_bp
    app.register_blueprint(deploy_bp, url_prefix='/api/v1/deploy')

    # Register blueprints - Builds & Deployments
    from app.api.builds import builds_bp
    app.register_blueprint(builds_bp, url_prefix='/api/v1/builds')

    # Register blueprints - Templates
    from app.api.templates import templates_bp
    app.register_blueprint(templates_bp, url_prefix='/api/v1/templates')

    # Register blueprints - File Manager
    from app.api.files import files_bp
    app.register_blueprint(files_bp, url_prefix='/api/v1/files')

    # Register blueprints - FTP Server
    from app.api.ftp import ftp_bp
    app.register_blueprint(ftp_bp, url_prefix='/api/v1/ftp')

    # Register blueprints - Firewall
    from app.api.firewall import firewall_bp
    app.register_blueprint(firewall_bp, url_prefix='/api/v1/firewall')

    # Register blueprints - Git Server
    from app.api.git import git_bp
    app.register_blueprint(git_bp, url_prefix='/api/v1/git')

    # Register blueprints - Security (ClamAV, File Integrity, etc.)
    from app.api.security import security_bp
    app.register_blueprint(security_bp, url_prefix='/api/v1/security')

    # Register blueprints - Cron Jobs
    from app.api.cron import cron_bp
    app.register_blueprint(cron_bp, url_prefix='/api/v1/cron')

    # Register blueprints - Uptime Tracking
    from app.api.uptime import uptime_bp
    app.register_blueprint(uptime_bp, url_prefix='/api/v1/uptime')

    # Register blueprints - Environment Variables
    from app.api.env_vars import env_vars_bp
    app.register_blueprint(env_vars_bp, url_prefix='/api/v1/apps')

    # Register blueprints - Two-Factor Authentication
    from app.api.two_factor import two_factor_bp
    app.register_blueprint(two_factor_bp, url_prefix='/api/v1/auth/2fa')

    # Register blueprints - Admin (User Management, Settings, Audit Logs)
    from app.api.admin import admin_bp
    app.register_blueprint(admin_bp, url_prefix='/api/v1/admin')

    # Register blueprints - Historical Metrics
    from app.api.metrics import metrics_bp
    app.register_blueprint(metrics_bp, url_prefix='/api/v1/metrics')

    # Register blueprints - Workflows
    from app.api.workflows import workflows_bp
    app.register_blueprint(workflows_bp, url_prefix='/api/v1/workflows')

    # Register blueprints - Servers (Multi-server management)
    from app.api.servers import servers_bp
    app.register_blueprint(servers_bp, url_prefix='/api/v1/servers')

    # Create database tables
    with app.app_context():
        db.create_all()

        # Auto-migrate missing columns on existing tables
        _auto_migrate_columns(app)

        # Initialize default settings and migrate legacy roles
        from app.services.settings_service import SettingsService
        SettingsService.initialize_defaults()
        SettingsService.migrate_legacy_roles()

        # Start metrics history collection in background
        from app.services.metrics_history_service import MetricsHistoryService
        if not MetricsHistoryService.is_running():
            MetricsHistoryService.start_collection(app)

        # Start auto-sync scheduler for WordPress environments
        _start_auto_sync_scheduler(app)

    # Serve frontend for root path
    @app.route('/')
    def serve_index():
        return send_from_directory(app.static_folder, 'index.html')

    # Catch-all route for SPA - must be after all other routes
    @app.errorhandler(404)
    def not_found(e):
        # If it's an API request, return JSON 404
        from flask import request
        if request.path.startswith('/api/'):
            return {'error': 'Not found'}, 404
        # Otherwise serve the SPA index.html for client-side routing
        return send_from_directory(app.static_folder, 'index.html')

    return app


def get_socketio():
    """Get the SocketIO instance."""
    return socketio


def _auto_migrate_columns(app):
    """Add missing columns to existing tables (lightweight auto-migration)."""
    import logging
    from sqlalchemy import text, inspect as sa_inspect

    logger = logging.getLogger(__name__)

    # Define expected columns per table: (table, column, sql_type)
    expected_columns = [
        # wordpress_sites table
        ('wordpress_sites', 'environment_type', "VARCHAR(20) DEFAULT 'standalone'"),
        ('wordpress_sites', 'multidev_branch', 'VARCHAR(200)'),
        ('wordpress_sites', 'is_locked', 'BOOLEAN DEFAULT 0'),
        ('wordpress_sites', 'locked_by', 'VARCHAR(100)'),
        ('wordpress_sites', 'locked_reason', 'VARCHAR(200)'),
        ('wordpress_sites', 'lock_expires_at', 'DATETIME'),
        ('wordpress_sites', 'compose_project_name', 'VARCHAR(100)'),
        ('wordpress_sites', 'container_prefix', 'VARCHAR(100)'),
        ('wordpress_sites', 'resource_limits', 'TEXT'),
        ('wordpress_sites', 'basic_auth_enabled', 'BOOLEAN DEFAULT 0'),
        ('wordpress_sites', 'basic_auth_user', 'VARCHAR(100)'),
        ('wordpress_sites', 'basic_auth_password_hash', 'VARCHAR(200)'),
        ('wordpress_sites', 'health_status', "VARCHAR(20) DEFAULT 'unknown'"),
        ('wordpress_sites', 'last_health_check', 'DATETIME'),
        ('wordpress_sites', 'disk_usage_bytes', 'BIGINT DEFAULT 0'),
        ('wordpress_sites', 'disk_usage_updated_at', 'DATETIME'),
        ('wordpress_sites', 'auto_sync_schedule', 'VARCHAR(100)'),
        ('wordpress_sites', 'auto_sync_enabled', 'BOOLEAN DEFAULT 0'),
        # applications table
        ('applications', 'private_slug', 'VARCHAR(50)'),
        ('applications', 'private_url_enabled', 'BOOLEAN DEFAULT 0'),
        ('applications', 'environment_type', "VARCHAR(20) DEFAULT 'standalone'"),
        ('applications', 'linked_app_id', 'INTEGER'),
        ('applications', 'shared_config', 'TEXT'),
    ]

    try:
        inspector = sa_inspect(db.engine)
        existing_tables = inspector.get_table_names()

        # Group by table for efficient inspection
        tables_checked = {}
        applied = 0

        for table, column, col_type in expected_columns:
            if table not in existing_tables:
                continue

            if table not in tables_checked:
                tables_checked[table] = [col['name'] for col in inspector.get_columns(table)]

            if column not in tables_checked[table]:
                try:
                    db.session.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {col_type}'))
                    applied += 1
                    logger.info(f'Auto-migrated: added {table}.{column}')
                except Exception as e:
                    logger.warning(f'Auto-migrate failed for {table}.{column}: {e}')

        if applied > 0:
            db.session.commit()
            logger.info(f'Auto-migration: applied {applied} column(s)')
    except Exception as e:
        logger.warning(f'Auto-migration check failed: {e}')


_auto_sync_thread = None


def _start_auto_sync_scheduler(app):
    """Start a background thread that checks for auto-sync schedules."""
    global _auto_sync_thread
    if _auto_sync_thread is not None:
        return

    import threading
    import time
    import logging

    logger = logging.getLogger(__name__)

    def auto_sync_loop():
        while True:
            try:
                time.sleep(60)  # Check every 60 seconds
                with app.app_context():
                    _check_auto_sync_schedules(logger)
            except Exception as e:
                logger.error(f'Auto-sync scheduler error: {e}')

    _auto_sync_thread = threading.Thread(
        target=auto_sync_loop,
        daemon=True,
        name='auto-sync-scheduler'
    )
    _auto_sync_thread.start()


def _check_auto_sync_schedules(logger):
    """Check all auto-sync enabled sites and run syncs that are due."""
    from app.models.wordpress_site import WordPressSite
    from datetime import datetime

    sites = WordPressSite.query.filter_by(auto_sync_enabled=True).all()
    if not sites:
        return

    try:
        from croniter import croniter
    except ImportError:
        logger.debug('croniter not installed, skipping auto-sync check')
        return

    now = datetime.utcnow()

    for site in sites:
        if not site.auto_sync_schedule:
            continue

        try:
            if not croniter.is_valid(site.auto_sync_schedule):
                continue

            cron = croniter(site.auto_sync_schedule, now)
            prev_run = cron.get_prev(datetime)

            # Check if a run was due in the last 90 seconds (to account for check interval)
            seconds_since_due = (now - prev_run).total_seconds()
            if seconds_since_due <= 90:
                logger.info(f'Auto-sync triggered for site {site.id} ({site.name})')
                from app.services.environment_pipeline_service import EnvironmentPipelineService
                EnvironmentPipelineService.sync_from_production(
                    env_site_id=site.id,
                    sync_type='full',
                    user_id=None
                )
        except Exception as e:
            logger.error(f'Auto-sync check failed for site {site.id}: {e}')
