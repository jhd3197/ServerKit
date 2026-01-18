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

    # Register blueprints - Auth
    from app.api.auth import auth_bp
    app.register_blueprint(auth_bp, url_prefix='/api/v1/auth')

    # Register blueprints - Core
    from app.api.apps import apps_bp
    from app.api.domains import domains_bp
    app.register_blueprint(apps_bp, url_prefix='/api/v1/apps')
    app.register_blueprint(domains_bp, url_prefix='/api/v1/domains')

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
    app.register_blueprint(php_bp, url_prefix='/api/v1/php')
    app.register_blueprint(wordpress_bp, url_prefix='/api/v1/wordpress')

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

    # Register blueprints - Backups
    from app.api.backups import backups_bp
    app.register_blueprint(backups_bp, url_prefix='/api/v1/backups')

    # Register blueprints - Git Deployment
    from app.api.deploy import deploy_bp
    app.register_blueprint(deploy_bp, url_prefix='/api/v1/deploy')

    # Register blueprints - File Manager
    from app.api.files import files_bp
    app.register_blueprint(files_bp, url_prefix='/api/v1/files')

    # Register blueprints - FTP Server
    from app.api.ftp import ftp_bp
    app.register_blueprint(ftp_bp, url_prefix='/api/v1/ftp')

    # Register blueprints - Firewall
    from app.api.firewall import firewall_bp
    app.register_blueprint(firewall_bp, url_prefix='/api/v1/firewall')

    # Register blueprints - Cron Jobs
    from app.api.cron import cron_bp
    app.register_blueprint(cron_bp, url_prefix='/api/v1/cron')

    # Register blueprints - Uptime Tracking
    from app.api.uptime import uptime_bp
    app.register_blueprint(uptime_bp, url_prefix='/api/v1/uptime')

    # Register blueprints - Environment Variables
    from app.api.env_vars import env_vars_bp
    app.register_blueprint(env_vars_bp, url_prefix='/api/v1/apps')

    # Create database tables
    with app.app_context():
        db.create_all()

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
