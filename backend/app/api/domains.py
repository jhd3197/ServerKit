from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Domain, Application, User
from app.services.nginx_service import NginxService
from app.services.ssl_service import SSLService

domains_bp = Blueprint('domains', __name__)


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


@domains_bp.route('', methods=['GET'])
@jwt_required()
def get_domains():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role == 'admin':
        domains = Domain.query.all()
    else:
        # Get domains for user's applications
        user_app_ids = [app.id for app in Application.query.filter_by(user_id=current_user_id).all()]
        domains = Domain.query.filter(Domain.application_id.in_(user_app_ids)).all()

    return jsonify({
        'domains': [domain.to_dict() for domain in domains]
    }), 200


@domains_bp.route('/<int:domain_id>', methods=['GET'])
@jwt_required()
def get_domain(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    return jsonify({'domain': domain.to_dict()}), 200


@domains_bp.route('', methods=['POST'])
@jwt_required()
def create_domain():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    name = data.get('name')
    application_id = data.get('application_id')

    if not all([name, application_id]):
        return jsonify({'error': 'Missing required fields: name, application_id'}), 400

    # Check if domain already exists
    if Domain.query.filter_by(name=name).first():
        return jsonify({'error': 'Domain already exists'}), 409

    # Check if application exists and user has access
    app = Application.query.get(application_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    # Check if this should be the primary domain
    is_primary = data.get('is_primary', False)
    if is_primary:
        # Unset any existing primary domain for this app
        Domain.query.filter_by(application_id=application_id, is_primary=True).update({'is_primary': False})

    domain = Domain(
        name=name,
        is_primary=is_primary,
        ssl_enabled=data.get('ssl_enabled', False),
        ssl_auto_renew=data.get('ssl_auto_renew', True),
        application_id=application_id
    )

    db.session.add(domain)
    db.session.commit()

    # Auto-create nginx config for Docker apps
    nginx_result = None
    if app.app_type == 'docker' and app.port:
        # Get all domains for this app to include in nginx config
        all_domains = [d.name for d in Domain.query.filter_by(application_id=application_id).all()]

        # Create nginx site config
        nginx_result = NginxService.create_site(
            name=app.name,
            app_type='docker',
            domains=all_domains,
            root_path=app.root_path or '',
            port=app.port
        )

        # Enable the site if creation was successful
        if nginx_result.get('success'):
            enable_result = NginxService.enable_site(app.name)
            if not enable_result.get('success'):
                nginx_result['warning'] = f"Site created but not enabled: {enable_result.get('error')}"

    return jsonify({
        'message': 'Domain created successfully',
        'domain': domain.to_dict(),
        'nginx': nginx_result
    }), 201


@domains_bp.route('/<int:domain_id>', methods=['PUT'])
@jwt_required()
def update_domain(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()

    if 'is_primary' in data and data['is_primary']:
        # Unset any existing primary domain for this app
        Domain.query.filter_by(application_id=domain.application_id, is_primary=True).update({'is_primary': False})
        domain.is_primary = True

    if 'ssl_enabled' in data:
        domain.ssl_enabled = data['ssl_enabled']
    if 'ssl_auto_renew' in data:
        domain.ssl_auto_renew = data['ssl_auto_renew']

    db.session.commit()

    return jsonify({
        'message': 'Domain updated successfully',
        'domain': domain.to_dict()
    }), 200


@domains_bp.route('/<int:domain_id>', methods=['DELETE'])
@jwt_required()
def delete_domain(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    application_id = domain.application_id
    db.session.delete(domain)
    db.session.commit()

    # Update nginx config for Docker apps
    nginx_result = None
    if app.app_type == 'docker' and app.port:
        remaining_domains = [d.name for d in Domain.query.filter_by(application_id=application_id).all()]

        if remaining_domains:
            # Update nginx config with remaining domains
            nginx_result = NginxService.create_site(
                name=app.name,
                app_type='docker',
                domains=remaining_domains,
                root_path=app.root_path or '',
                port=app.port
            )
            if nginx_result.get('success'):
                NginxService.reload()
        else:
            # No domains left, disable and delete the site
            NginxService.disable_site(app.name)
            nginx_result = NginxService.delete_site(app.name)

    return jsonify({
        'message': 'Domain deleted successfully',
        'nginx': nginx_result
    }), 200


@domains_bp.route('/<int:domain_id>/ssl/enable', methods=['POST'])
@jwt_required()
def enable_ssl(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json() or {}
    email = data.get('email')

    if not email:
        return jsonify({'error': 'Email is required for SSL certificate'}), 400

    # Request Let's Encrypt certificate
    result = SSLService.obtain_certificate(
        domains=[domain.name],
        email=email,
        use_nginx=True
    )

    if not result['success']:
        return jsonify({'error': result.get('error', 'Failed to obtain certificate')}), 400

    # Add SSL to Nginx site
    nginx_result = NginxService.add_ssl_to_site(
        app.name,
        result['certificate_path'],
        result['private_key_path']
    )

    if not nginx_result['success']:
        return jsonify({'error': nginx_result.get('error', 'Failed to configure Nginx')}), 400

    domain.ssl_enabled = True
    domain.ssl_certificate_path = result['certificate_path']
    domain.ssl_private_key_path = result['private_key_path']
    db.session.commit()

    return jsonify({
        'message': 'SSL enabled for domain',
        'domain': domain.to_dict(),
        'certificate': result
    }), 200


@domains_bp.route('/<int:domain_id>/ssl/disable', methods=['POST'])
@jwt_required()
def disable_ssl(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    domain.ssl_enabled = False
    db.session.commit()

    return jsonify({
        'message': 'SSL disabled for domain',
        'domain': domain.to_dict()
    }), 200


@domains_bp.route('/<int:domain_id>/ssl/renew', methods=['POST'])
@jwt_required()
def renew_ssl(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query.get(domain_id)

    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    app = Application.query.get(domain.application_id)
    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    if not domain.ssl_enabled:
        return jsonify({'error': 'SSL is not enabled for this domain'}), 400

    result = SSLService.renew_certificate(domain.name)

    if result['success']:
        return jsonify({
            'message': 'SSL certificate renewed',
            'domain': domain.to_dict()
        }), 200

    return jsonify({'error': result.get('error', 'Failed to renew certificate')}), 400


@domains_bp.route('/<int:domain_id>/verify', methods=['GET'])
@jwt_required()
def verify_domain(domain_id):
    """Verify domain DNS configuration."""
    import socket

    domain = Domain.query.get(domain_id)
    if not domain:
        return jsonify({'error': 'Domain not found'}), 404

    try:
        # Try to resolve the domain
        ip_address = socket.gethostbyname(domain.name)
        return jsonify({
            'verified': True,
            'domain': domain.name,
            'ip_address': ip_address
        }), 200
    except socket.gaierror:
        return jsonify({
            'verified': False,
            'domain': domain.name,
            'error': 'Domain could not be resolved'
        }), 200


@domains_bp.route('/nginx/sites', methods=['GET'])
@jwt_required()
@admin_required
def list_nginx_sites():
    """List all Nginx site configurations."""
    sites = NginxService.list_sites()
    return jsonify({'sites': sites}), 200


@domains_bp.route('/ssl/status', methods=['GET'])
@jwt_required()
@admin_required
def get_ssl_status():
    """Get overall SSL status."""
    is_installed = SSLService.is_certbot_installed()
    certificates = SSLService.list_certificates()

    return jsonify({
        'certbot_installed': is_installed,
        'total_certificates': len(certificates),
        'certificates': certificates
    }), 200


@domains_bp.route('/nginx/regenerate/<int:app_id>', methods=['POST'])
@jwt_required()
@admin_required
def regenerate_nginx_config(app_id):
    """Regenerate nginx config for a Docker app."""
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if app.app_type != 'docker':
        return jsonify({'error': 'This endpoint is only for Docker apps'}), 400

    if not app.port:
        return jsonify({'error': 'Application does not have a port configured'}), 400

    # Get all domains for this app
    domains = [d.name for d in Domain.query.filter_by(application_id=app_id).all()]

    if not domains:
        return jsonify({'error': 'No domains configured for this application'}), 400

    # Create nginx site config
    result = NginxService.create_site(
        name=app.name,
        app_type='docker',
        domains=domains,
        root_path=app.root_path or '',
        port=app.port
    )

    if not result.get('success'):
        return jsonify({'error': result.get('error', 'Failed to create nginx config')}), 400

    # Enable the site
    enable_result = NginxService.enable_site(app.name)
    if not enable_result.get('success'):
        return jsonify({
            'warning': 'Config created but not enabled',
            'error': enable_result.get('error'),
            'config': result
        }), 200

    return jsonify({
        'message': f'Nginx config regenerated for {app.name}',
        'domains': domains,
        'port': app.port,
        'config': result
    }), 200


@domains_bp.route('/debug/diagnose/<int:app_id>', methods=['GET'])
@jwt_required()
@admin_required
def diagnose_app_routing(app_id):
    """Diagnose routing issues for an application.

    Returns comprehensive diagnostic information including:
    - Application configuration
    - Domain mappings
    - Nginx configuration status
    - Docker container status and port bindings
    - Health assessment with recommendations
    """
    from app.services.docker_service import DockerService

    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404

    diagnosis = {
        'app': {
            'id': app.id,
            'name': app.name,
            'type': app.app_type,
            'port': app.port,
            'root_path': app.root_path,
            'status': app.status
        },
        'domains': [],
        'nginx': None,
        'docker': None,
        'health': {
            'overall': False,
            'issues': []
        }
    }

    # Get domains
    domains = Domain.query.filter_by(application_id=app_id).all()
    diagnosis['domains'] = [d.to_dict() for d in domains]

    # Nginx diagnosis
    diagnosis['nginx'] = NginxService.diagnose_site(app.name, app.port)

    # Docker diagnosis (if docker app)
    if app.app_type == 'docker':
        diagnosis['docker'] = {
            'port_check': None,
            'containers': [],
            'compose_status': None
        }

        # Check port accessibility
        if app.port:
            diagnosis['docker']['port_check'] = DockerService.check_port_accessible(app.port)
        else:
            diagnosis['health']['issues'].append('No port configured for Docker app')

        # Get container info
        if app.root_path:
            containers = DockerService.compose_ps(app.root_path)
            diagnosis['docker']['containers'] = containers

            if not containers:
                diagnosis['health']['issues'].append('No containers found - app may not be running')
            else:
                # Get port bindings for each container
                for container in containers:
                    container_name = container.get('Name') or container.get('name')
                    if container_name:
                        bindings = DockerService.get_container_port_bindings(container_name)
                        container['port_bindings'] = bindings

                        network_info = DockerService.get_container_network_info(container_name)
                        container['network_info'] = network_info

                # Check if any container is running
                running = [c for c in containers if 'running' in str(c.get('State', '')).lower() or 'up' in str(c.get('Status', '')).lower()]
                if not running:
                    diagnosis['health']['issues'].append('No containers are currently running')
        else:
            diagnosis['health']['issues'].append('No root_path configured - cannot check Docker Compose')

    # Assess overall health
    nginx_health = diagnosis['nginx'].get('health', {})
    if not nginx_health.get('config_exists'):
        diagnosis['health']['issues'].append('Nginx config does not exist')
    if not nginx_health.get('config_enabled'):
        diagnosis['health']['issues'].append('Nginx config is not enabled')
    if not nginx_health.get('nginx_running'):
        diagnosis['health']['issues'].append('Nginx service is not running')
    if not nginx_health.get('syntax_valid'):
        diagnosis['health']['issues'].append('Nginx config has syntax errors')
    if app.port and not nginx_health.get('port_accessible'):
        diagnosis['health']['issues'].append(f'Port {app.port} is not accessible')

    diagnosis['health']['overall'] = len(diagnosis['health']['issues']) == 0
    diagnosis['health']['recommendations'] = diagnosis['nginx'].get('recommendations', [])

    return jsonify(diagnosis), 200


@domains_bp.route('/debug/test-routing/<int:app_id>', methods=['POST'])
@jwt_required()
@admin_required
def test_app_routing(app_id):
    """Test the routing chain for an application.

    Performs active tests to verify traffic can flow from domain to container.
    """
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if not app.port:
        return jsonify({'error': 'Application has no port configured'}), 400

    # Get primary domain or first domain
    domain = Domain.query.filter_by(application_id=app_id, is_primary=True).first()
    if not domain:
        domain = Domain.query.filter_by(application_id=app_id).first()

    domain_name = domain.name if domain else None

    # Run routing tests
    results = NginxService.check_site_routing(
        name=app.name,
        domain=domain_name or 'localhost',
        port=app.port
    )

    return jsonify(results), 200
