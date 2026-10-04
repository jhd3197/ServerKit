# Bucket: PER-APP (plan 29 #9). Per-app domain routes gate on the shared
# app-access seam (can_access_app for reads, can_edit_app for mutations);
# host-level DNS/nginx surfaces stay admin-only.
import re
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.middleware.rbac import admin_required
from app.models import Domain, Application, User
from app.services.nginx_service import NginxService
from app.services.ssl_service import SSLService, get_acme_contact, remember_acme_contact
from app.services.resource_grant_service import ResourceGrantService
from app.exceptions import already_exists, not_found, permission_denied

domains_bp = Blueprint('domains', __name__)


def _publish_app_vhost(app):
    """(Re)write and enable an app's vhost from its LIVE domains.

    One seam for both add and remove, so the two can never disagree about what
    the served config should look like. Returns the shape these routes already
    put under the response's ``nginx`` key; never raises.
    """
    from app.services.site_domain_service import SiteDomainService

    result = SiteDomainService.write_app_vhost(app) or {}
    nginx = result.get('nginx')
    warning = result.get('warning')
    if warning:
        nginx = dict(nginx or {}, warning=warning)
    return nginx


def validate_and_sanitize_domain(domain_name: str) -> tuple:
    """Validate and sanitize a domain name for nginx server_name.

    Args:
        domain_name: The domain name to validate

    Returns:
        Tuple of (sanitized_domain, error_message). error_message is None if valid.
    """
    if not domain_name:
        return None, 'Domain name is required'

    # Strip whitespace
    domain = domain_name.strip()

    # Remove protocol if present (common user mistake)
    if domain.startswith('https://'):
        domain = domain[8:]
    if domain.startswith('http://'):
        domain = domain[7:]

    # Remove trailing slashes and paths
    domain = domain.split('/')[0]

    # Remove port if present
    domain = domain.split(':')[0]

    # Strip again after modifications
    domain = domain.strip()

    if not domain:
        return None, 'Domain name is empty after sanitization'

    # Validate domain format
    # Allow: letters, numbers, hyphens, dots
    # Must not start or end with hyphen or dot
    # Must have at least one dot (for TLDs) unless it's localhost
    domain_pattern = r'^(?!-)[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*(?<!-)$'

    if not re.match(domain_pattern, domain):
        return None, f'Invalid domain format: {domain}. Domain must contain only letters, numbers, dots, and hyphens.'

    # Check for consecutive dots
    if '..' in domain:
        return None, 'Domain cannot contain consecutive dots'

    # Check length
    if len(domain) > 253:
        return None, 'Domain name is too long (max 253 characters)'

    # Each label (part between dots) must be <= 63 chars
    labels = domain.split('.')
    for label in labels:
        if len(label) > 63:
            return None, f'Domain label "{label}" is too long (max 63 characters per label)'

    return domain.lower(), None


@domains_bp.route('', methods=['GET'])
@jwt_required()
def get_domains():
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    # Workspace-aware scoping (#33). Domains are app-children with no workspace_id
    # of their own — they inherit their parent Application's. Scope the visible app
    # set (own + granted, workspace-narrowed) and return those apps' domains.
    # With no workspace context this matches prior behavior (admin -> all domains,
    # else -> the user's own apps' domains) and additionally surfaces domains of
    # apps shared via a grant — consistent with the per-domain routes, which
    # already authorize through ResourceGrantService.can_access_app.
    from app.services.workspace_service import WorkspaceService
    ws_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    app_q = WorkspaceService.scope_query(
        Application.query_active(), Application, user,
        workspace_id=ws_id, owner_attr='user_id', grant_resource_type='application')
    app_ids = [row[0] for row in app_q.with_entities(Application.id).all()]
    domains = (Domain.query_active().filter(Domain.application_id.in_(app_ids)).all()
               if app_ids else [])

    return jsonify({
        'domains': [domain.to_dict() for domain in domains]
    }), 200


@domains_bp.route('/<int:domain_id>', methods=['GET'])
@jwt_required()
def get_domain(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query_active().filter_by(id=domain_id).first()

    if not domain:
        raise not_found('domain')

    # A soft-deleted app keeps its Domain rows (only the vhost is torn down), so
    # every route here has to resolve the parent live or a deleted app's domains
    # stay reachable — and operable, up to a real ACME order in enable_ssl.
    app = Application.query_active().filter_by(id=domain.application_id).first()
    if not app:
        raise not_found('domain')
    if not ResourceGrantService.can_access_app(user, app):
        raise permission_denied()

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

    # Validate and sanitize domain name
    sanitized_name, validation_error = validate_and_sanitize_domain(name)
    if validation_error:
        return jsonify({'error': validation_error}), 400

    # Use sanitized name
    name = sanitized_name

    # Check if domain already exists
    if Domain.query_active().filter_by(name=name).first():
        raise already_exists('domain')

    # Check if application exists and user has access
    app = Application.query_active().filter_by(id=application_id).first()
    if not app:
        raise not_found('service')

    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

    # For Docker apps, validate port configuration
    port_warning = None
    if app.app_type == 'docker':
        if not app.port:
            return jsonify({
                'error': 'Set a port on this service before adding domains',
                'hint': 'Open the service settings and set its port, then add the domain'
            }), 400

        # Check if port is accessible (warning only, don't block)
        from app.services.docker_service import DockerService
        port_check = DockerService.check_port_accessible(app.port)
        if not port_check.get('accessible'):
            port_warning = f"Warning: Port {app.port} is not currently accessible. Make sure the container is running and the port is exposed."

    # Check if this should be the primary domain
    is_primary = data.get('is_primary', False)
    if is_primary:
        # Unset any existing primary domain for this app
        Domain.query_active().filter_by(application_id=application_id, is_primary=True).update({'is_primary': False}, synchronize_session=False)

    domain = Domain(
        name=name,
        is_primary=is_primary,
        ssl_enabled=data.get('ssl_enabled', False),
        ssl_auto_renew=data.get('ssl_auto_renew', True),
        application_id=application_id
    )

    db.session.add(domain)
    db.session.commit()

    # Publish through SiteDomainService rather than a bare create_site.
    #
    # create_site takes ssl_cert/ssl_key/micro_cache as arguments and this call
    # passed none of them, so the regenerated vhost came out HTTP-only and
    # cache-less: adding a domain to a site covered by a base wildcard cert
    # silently knocked the WHOLE site back to plain HTTP, and dropped its
    # micro-cache directives. app_vhost_kwargs re-resolves both, picks the right
    # template for the app type (php/static/flask/django too, not just docker),
    # and enables the site.
    nginx_result = _publish_app_vhost(app)

    response = {
        'message': 'Domain created successfully',
        'domain': domain.to_dict(),
        'nginx': nginx_result
    }

    if port_warning:
        response['warning'] = port_warning

    return jsonify(response), 201


@domains_bp.route('/base-domains', methods=['GET'])
@jwt_required()
def list_base_domains():
    """The base domains a new site can be published under, for the create-flow
    picker. Returns the registry (default first) or, on a legacy single-base
    install, the one configured base. ``default`` names the pre-selected base."""
    from app.services.site_domain_service import SiteDomainService
    from app.services.site_base_domain_service import SiteBaseDomainService
    rows = SiteBaseDomainService.list_rows()
    if rows:
        bases = [{'domain': r.domain, 'is_default': r.is_default,
                  'https_enabled': r.https_enabled, 'dns_mode': r.dns_mode} for r in rows]
    else:
        base = SiteDomainService.base_domain()
        bases = ([{'domain': base, 'is_default': True,
                   'https_enabled': SiteDomainService.https_enabled(),
                   'dns_mode': SiteDomainService.dns_mode()}] if base else [])
    default = next((b['domain'] for b in bases if b['is_default']), None)
    return jsonify({'base_domains': bases, 'default': default}), 200


@domains_bp.route('/suggest-subdomain', methods=['GET'])
@jwt_required()
def suggest_subdomain():
    """Suggest a managed-sites subdomain (<slug>.<base>) for an app, so the UI can
    prefill the 'give this a subdomain' action. Honours an optional ``base``."""
    from app.services.site_domain_service import SiteDomainService
    app_id = request.args.get('application_id', type=int)
    app = Application.query_active().filter_by(id=app_id).first() if app_id else None
    base = SiteDomainService.resolve_base(request.args.get('base'))
    if not base:
        return jsonify({'base_domain': None, 'suggestion': None,
                        'dns_mode': SiteDomainService.dns_mode()}), 200
    slug = SiteDomainService.slugify(app.name) if app else 'site'
    return jsonify({'base_domain': base, 'suggestion': f'{slug}.{base}',
                    'dns_mode': SiteDomainService.dns_mode(base)}), 200


@domains_bp.route('/give-subdomain', methods=['POST'])
@jwt_required()
def give_subdomain():
    """Publish an app at <label>.<base> in one click — Domain row + nginx vhost +
    (per-site mode) an auto-created A record. Accepts an optional ``base`` to
    publish under a specific registered base domain."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    data = request.get_json() or {}
    app = (Application.query_active().filter_by(id=data.get('application_id')).first()
           if data.get('application_id') else None)
    if not app:
        raise not_found('service')
    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

    from app.services.site_domain_service import SiteDomainService
    result = SiteDomainService.give_subdomain(app, label=data.get('label'), base=data.get('base'))
    return jsonify(result), 200 if result.get('success') else 400


@domains_bp.route('/<int:domain_id>', methods=['PUT'])
@jwt_required()
def update_domain(domain_id):
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    domain = Domain.query_active().filter_by(id=domain_id).first()

    if not domain:
        raise not_found('domain')

    app = Application.query_active().filter_by(id=domain.application_id).first()
    if not app:
        raise not_found('domain')
    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

    data = request.get_json()

    if 'is_primary' in data and data['is_primary']:
        # Unset any existing primary domain for this app
        Domain.query_active().filter_by(application_id=domain.application_id, is_primary=True).update({'is_primary': False}, synchronize_session=False)
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
    domain = Domain.query_active().filter_by(id=domain_id).first()

    if not domain:
        raise not_found('domain')

    app = Application.query_active().filter_by(id=domain.application_id).first()
    if not app:
        raise not_found('domain')
    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

    application_id = domain.application_id
    # Soft delete: the vhost teardown below still happens, but the record keeps
    # a tombstone so the Recycle Bin can hand it back. Purging for real is a
    # separate, admin-only action.
    domain.soft_delete(user_id=current_user_id)
    db.session.commit()

    # Re-publish without the removed domain. Same seam as create_domain, for the
    # same reason: the old bare create_site here dropped the wildcard cert and
    # the micro-cache from the vhost, so removing ONE domain quietly took the
    # site's other domains off HTTPS. It also only ran for docker apps, leaving
    # php/static/flask vhosts still advertising the deleted name.
    nginx_result = None
    remaining = Domain.query_active().filter_by(application_id=application_id).count()
    if remaining:
        nginx_result = _publish_app_vhost(app)
    elif app.app_type == 'docker' and app.port:
        # Nothing left to serve: take the site down entirely.
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
    domain = Domain.query_active().filter_by(id=domain_id).first()

    if not domain:
        raise not_found('domain')

    app = Application.query_active().filter_by(id=domain.application_id).first()
    if not app:
        raise not_found('domain')
    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

    data = request.get_json() or {}
    # An address on the request wins; otherwise the panel-wide ACME contact,
    # so the modal stops asking for the same address on every certificate.
    email = get_acme_contact(data.get('email'))

    if not email:
        return jsonify({'error': 'Email is required for SSL certificate. Set a '
                                 'default contact in Settings to stop being '
                                 'asked for it per certificate.'}), 400

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

    # Only after issuance actually worked — remembering an address that
    # Let's Encrypt rejected would be worse than not remembering one.
    remember_acme_contact(data.get('email'), user_id=current_user_id)

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
    domain = Domain.query_active().filter_by(id=domain_id).first()

    if not domain:
        raise not_found('domain')

    app = Application.query_active().filter_by(id=domain.application_id).first()
    if not app:
        raise not_found('domain')
    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

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
    domain = Domain.query_active().filter_by(id=domain_id).first()

    if not domain:
        raise not_found('domain')

    app = Application.query_active().filter_by(id=domain.application_id).first()
    if not app:
        raise not_found('domain')
    if not ResourceGrantService.can_edit_app(user, app):
        raise permission_denied()

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
    """Verify domain DNS configuration (A *and* AAAA).

    This used to be a bare IPv4 ``socket.gethostbyname``, which made a stray
    AAAA record invisible — and that is the case worth catching. Let's Encrypt
    prefers IPv6 whenever a AAAA record exists, so a domain whose A record
    points here perfectly still fails HTTP-01 issuance when its AAAA points
    somewhere else. The old check called that domain verified and the operator
    was left with a certificate error that named nothing.
    """
    from app.services.doctor_service import (
        _aaaa_conflicts, _local_host_ips, _resolve_host_ips,
    )
    from app.services.site_domain_service import SiteDomainService

    domain = Domain.query_active().filter_by(id=domain_id).first()
    if not domain:
        raise not_found('domain')

    try:
        ips = _resolve_host_ips(domain.name)
    except OSError:  # gaierror and friends — any resolver failure
        ips = []

    if not ips:
        return jsonify({
            'verified': False,
            'domain': domain.name,
            'error': 'Domain could not be resolved'
        }), 200

    try:
        server_ip = SiteDomainService.server_ip()
    except Exception:  # noqa: BLE001 — an unset public IP is not an error here
        server_ip = None

    ipv4 = [ip for ip in ips if ':' not in ip]
    conflicts = _aaaa_conflicts(ips, server_ip, _local_host_ips())

    payload = {
        'verified': True,
        'domain': domain.name,
        # Single address kept for callers that predate ip_addresses; prefer an
        # IPv4 one so the value means what it always did.
        'ip_address': (ipv4 or ips)[0],
        'ip_addresses': ips,
    }
    if conflicts:
        payload['aaaa_conflict'] = conflicts
        payload['warning'] = (
            f"{domain.name} has an AAAA record pointing to "
            f"{', '.join(conflicts)}, which is not this server. Let's Encrypt "
            f"prefers IPv6, so certificate issuance will be attempted against "
            f"that address and fail even though the A record is correct. "
            f"Remove the AAAA record, or point it at this server's IPv6 address."
        )
    return jsonify(payload), 200


@domains_bp.route('/nginx/sites', methods=['GET'])
@admin_required
def list_nginx_sites():
    """List all Nginx site configurations."""
    sites = NginxService.list_sites()
    return jsonify({'sites': sites}), 200


@domains_bp.route('/ssl/status', methods=['GET'])
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
@admin_required
def regenerate_nginx_config(app_id):
    """Regenerate nginx config for a Docker app."""
    app = Application.query_active().filter_by(id=app_id).first()

    if not app:
        raise not_found('service')

    if app.app_type != 'docker':
        return jsonify({'error': 'This only works for Docker services'}), 400

    if not app.port:
        return jsonify({'error': 'This service has no port. Set one in the service settings.'}), 400

    # Get all domains for this app
    # query_active: a tombstone here would be written back into server_name,
    # undoing the teardown that DELETE /domains/<id> just performed.
    domains = [d.name for d in Domain.query_active().filter_by(application_id=app_id).all()]

    if not domains:
        return jsonify({'error': 'This service has no domains. Add one first.'}), 400

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

    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        raise not_found('service')

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
    domains = Domain.query_active().filter_by(application_id=app_id).all()
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
@admin_required
def test_app_routing(app_id):
    """Test the routing chain for an application.

    Performs active tests to verify traffic can flow from domain to container.
    """
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        raise not_found('service')

    if not app.port:
        return jsonify({'error': 'This service has no port. Set one in the service settings.'}), 400

    # Get primary domain or first domain
    domain = Domain.query_active().filter_by(application_id=app_id, is_primary=True).first()
    if not domain:
        domain = Domain.query_active().filter_by(application_id=app_id).first()

    domain_name = domain.name if domain else None

    # Run routing tests
    results = NginxService.check_site_routing(
        name=app.name,
        domain=domain_name or 'localhost',
        port=app.port
    )

    return jsonify(results), 200
