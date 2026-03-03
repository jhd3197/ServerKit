"""Email Server API endpoints for managing mail services, domains, accounts, and DNS."""

from flask import Blueprint, request, jsonify

from ..middleware.rbac import admin_required, viewer_required
from ..services.email_service import EmailService
from ..services.dns_provider_service import DNSProviderService
from ..services.spamassassin_service import SpamAssassinService
from ..services.roundcube_service import RoundcubeService
from ..services.postfix_service import PostfixService

email_bp = Blueprint('email', __name__)


# ── Status & Installation ──

@email_bp.route('/status', methods=['GET'])
@viewer_required
def get_status():
    """Get aggregate email server status."""
    roundcube = RoundcubeService.get_status()
    status = EmailService.get_status()
    status['roundcube'] = roundcube
    return jsonify(status), 200


@email_bp.route('/install', methods=['POST'])
@admin_required
def install():
    """Install and configure all email components."""
    data = request.get_json() or {}
    hostname = data.get('hostname')
    result = EmailService.install_all(hostname)
    return jsonify(result), 200 if result.get('success') else 500


@email_bp.route('/service/<component>/<action>', methods=['POST'])
@admin_required
def control_service(component, action):
    """Start/stop/restart an email component."""
    result = EmailService.control_service(component, action)
    return jsonify(result), 200 if result.get('success') else 400


# ── Domains ──

@email_bp.route('/domains', methods=['GET'])
@viewer_required
def list_domains():
    """List all email domains."""
    domains = EmailService.get_domains()
    return jsonify({'domains': domains}), 200


@email_bp.route('/domains', methods=['POST'])
@admin_required
def add_domain():
    """Add an email domain."""
    data = request.get_json()
    if not data or not data.get('name'):
        return jsonify({'success': False, 'error': 'Domain name is required'}), 400

    result = EmailService.add_domain(
        data['name'],
        dns_provider_id=data.get('dns_provider_id'),
        dns_zone_id=data.get('dns_zone_id'),
    )
    return jsonify(result), 201 if result.get('success') else 400


@email_bp.route('/domains/<int:domain_id>', methods=['GET'])
@viewer_required
def get_domain(domain_id):
    """Get domain details."""
    result = EmailService.get_domain(domain_id)
    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 404


@email_bp.route('/domains/<int:domain_id>', methods=['DELETE'])
@admin_required
def remove_domain(domain_id):
    """Remove an email domain."""
    result = EmailService.remove_domain(domain_id)
    return jsonify(result), 200 if result.get('success') else 400


@email_bp.route('/domains/<int:domain_id>/verify-dns', methods=['POST'])
@viewer_required
def verify_dns(domain_id):
    """Verify DNS records for a domain."""
    result = EmailService.verify_dns(domain_id)
    return jsonify(result), 200


@email_bp.route('/domains/<int:domain_id>/deploy-dns', methods=['POST'])
@admin_required
def deploy_dns(domain_id):
    """Deploy DNS records via provider API."""
    from app.models.email import EmailDomain
    domain = EmailDomain.query.get(domain_id)
    if not domain:
        return jsonify({'success': False, 'error': 'Domain not found'}), 404
    if not domain.dns_provider_id or not domain.dns_zone_id:
        return jsonify({'success': False, 'error': 'No DNS provider configured for this domain'}), 400

    result = DNSProviderService.deploy_email_records(
        domain.dns_provider_id,
        domain.dns_zone_id,
        domain.name,
        domain.dkim_selector or 'default',
        domain.dkim_public_key or '',
    )
    return jsonify(result), 200 if result.get('success') else 400


# ── Accounts ──

@email_bp.route('/domains/<int:domain_id>/accounts', methods=['GET'])
@viewer_required
def list_accounts(domain_id):
    """List email accounts for a domain."""
    accounts = EmailService.get_accounts(domain_id)
    return jsonify({'accounts': accounts}), 200


@email_bp.route('/domains/<int:domain_id>/accounts', methods=['POST'])
@admin_required
def create_account(domain_id):
    """Create an email account."""
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Request body required'}), 400

    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'success': False, 'error': 'Username and password are required'}), 400

    result = EmailService.add_account(
        domain_id,
        username,
        password,
        quota_mb=data.get('quota_mb', 1024),
    )
    return jsonify(result), 201 if result.get('success') else 400


@email_bp.route('/accounts/<int:account_id>', methods=['GET'])
@viewer_required
def get_account(account_id):
    """Get account details."""
    from app.models.email import EmailAccount
    account = EmailAccount.query.get(account_id)
    if not account:
        return jsonify({'success': False, 'error': 'Account not found'}), 404
    return jsonify({'success': True, 'account': account.to_dict()}), 200


@email_bp.route('/accounts/<int:account_id>', methods=['PUT'])
@admin_required
def update_account(account_id):
    """Update account settings."""
    data = request.get_json() or {}
    result = EmailService.update_account(
        account_id,
        quota_mb=data.get('quota_mb'),
        is_active=data.get('is_active'),
    )
    return jsonify(result), 200 if result.get('success') else 400


@email_bp.route('/accounts/<int:account_id>', methods=['DELETE'])
@admin_required
def delete_account(account_id):
    """Delete an email account."""
    result = EmailService.delete_account(account_id)
    return jsonify(result), 200 if result.get('success') else 400


@email_bp.route('/accounts/<int:account_id>/password', methods=['POST'])
@admin_required
def change_password(account_id):
    """Change account password."""
    data = request.get_json()
    if not data or not data.get('password'):
        return jsonify({'success': False, 'error': 'New password is required'}), 400

    result = EmailService.change_password(account_id, data['password'])
    return jsonify(result), 200 if result.get('success') else 400


# ── Aliases ──

@email_bp.route('/domains/<int:domain_id>/aliases', methods=['GET'])
@viewer_required
def list_aliases(domain_id):
    """List email aliases for a domain."""
    aliases = EmailService.get_aliases(domain_id)
    return jsonify({'aliases': aliases}), 200


@email_bp.route('/domains/<int:domain_id>/aliases', methods=['POST'])
@admin_required
def create_alias(domain_id):
    """Create an email alias."""
    data = request.get_json()
    if not data or not data.get('source') or not data.get('destination'):
        return jsonify({'success': False, 'error': 'Source and destination are required'}), 400

    result = EmailService.add_alias(domain_id, data['source'], data['destination'])
    return jsonify(result), 201 if result.get('success') else 400


@email_bp.route('/aliases/<int:alias_id>', methods=['DELETE'])
@admin_required
def delete_alias(alias_id):
    """Delete an email alias."""
    result = EmailService.remove_alias(alias_id)
    return jsonify(result), 200 if result.get('success') else 400


# ── Forwarding Rules ──

@email_bp.route('/accounts/<int:account_id>/forwarding', methods=['GET'])
@viewer_required
def list_forwarding(account_id):
    """List forwarding rules for an account."""
    rules = EmailService.get_forwarding(account_id)
    return jsonify({'rules': rules}), 200


@email_bp.route('/accounts/<int:account_id>/forwarding', methods=['POST'])
@admin_required
def create_forwarding(account_id):
    """Create a forwarding rule."""
    data = request.get_json()
    if not data or not data.get('destination'):
        return jsonify({'success': False, 'error': 'Destination is required'}), 400

    result = EmailService.add_forwarding(
        account_id,
        data['destination'],
        keep_copy=data.get('keep_copy', True),
    )
    return jsonify(result), 201 if result.get('success') else 400


@email_bp.route('/forwarding/<int:rule_id>', methods=['PUT'])
@admin_required
def update_forwarding(rule_id):
    """Update a forwarding rule."""
    data = request.get_json() or {}
    result = EmailService.update_forwarding(
        rule_id,
        destination=data.get('destination'),
        keep_copy=data.get('keep_copy'),
        is_active=data.get('is_active'),
    )
    return jsonify(result), 200 if result.get('success') else 400


@email_bp.route('/forwarding/<int:rule_id>', methods=['DELETE'])
@admin_required
def delete_forwarding(rule_id):
    """Delete a forwarding rule."""
    result = EmailService.remove_forwarding(rule_id)
    return jsonify(result), 200 if result.get('success') else 400


# ── DNS Providers ──

@email_bp.route('/dns-providers', methods=['GET'])
@viewer_required
def list_dns_providers():
    """List configured DNS providers."""
    providers = DNSProviderService.list_providers()
    return jsonify({'providers': providers}), 200


@email_bp.route('/dns-providers', methods=['POST'])
@admin_required
def add_dns_provider():
    """Add a DNS provider."""
    data = request.get_json()
    if not data or not data.get('name') or not data.get('provider') or not data.get('api_key'):
        return jsonify({'success': False, 'error': 'Name, provider, and api_key are required'}), 400

    result = DNSProviderService.add_provider(
        name=data['name'],
        provider=data['provider'],
        api_key=data['api_key'],
        api_secret=data.get('api_secret'),
        api_email=data.get('api_email'),
        is_default=data.get('is_default', False),
    )
    return jsonify(result), 201 if result.get('success') else 400


@email_bp.route('/dns-providers/<int:provider_id>', methods=['DELETE'])
@admin_required
def remove_dns_provider(provider_id):
    """Remove a DNS provider."""
    result = DNSProviderService.remove_provider(provider_id)
    return jsonify(result), 200 if result.get('success') else 400


@email_bp.route('/dns-providers/<int:provider_id>/test', methods=['POST'])
@admin_required
def test_dns_provider(provider_id):
    """Test DNS provider connection."""
    result = DNSProviderService.test_connection(provider_id)
    return jsonify(result), 200 if result.get('success') else 400


@email_bp.route('/dns-providers/<int:provider_id>/zones', methods=['GET'])
@viewer_required
def list_dns_zones(provider_id):
    """List DNS zones from a provider."""
    result = DNSProviderService.list_zones(provider_id)
    return jsonify(result), 200 if result.get('success') else 400


# ── SpamAssassin Config ──

@email_bp.route('/spam/config', methods=['GET'])
@viewer_required
def get_spam_config():
    """Get SpamAssassin configuration."""
    result = SpamAssassinService.get_config()
    return jsonify(result), 200


@email_bp.route('/spam/config', methods=['PUT'])
@admin_required
def update_spam_config():
    """Update SpamAssassin configuration."""
    data = request.get_json()
    if not data:
        return jsonify({'success': False, 'error': 'Request body required'}), 400

    result = SpamAssassinService.configure(data)
    if result.get('success'):
        SpamAssassinService.reload()
    return jsonify(result), 200 if result.get('success') else 400


@email_bp.route('/spam/update-rules', methods=['POST'])
@admin_required
def update_spam_rules():
    """Update SpamAssassin rules."""
    result = SpamAssassinService.update_rules()
    return jsonify(result), 200 if result.get('success') else 400


# ── Roundcube Webmail ──

@email_bp.route('/webmail/status', methods=['GET'])
@viewer_required
def webmail_status():
    """Get Roundcube webmail status."""
    result = RoundcubeService.get_status()
    return jsonify(result), 200


@email_bp.route('/webmail/install', methods=['POST'])
@admin_required
def webmail_install():
    """Install Roundcube webmail."""
    data = request.get_json() or {}
    result = RoundcubeService.install(
        imap_host=data.get('imap_host', 'host.docker.internal'),
        smtp_host=data.get('smtp_host', 'host.docker.internal'),
    )
    return jsonify(result), 200 if result.get('success') else 400


@email_bp.route('/webmail/service/<action>', methods=['POST'])
@admin_required
def webmail_control(action):
    """Start/stop/restart Roundcube."""
    actions = {
        'start': RoundcubeService.start,
        'stop': RoundcubeService.stop,
        'restart': RoundcubeService.restart,
    }
    if action not in actions:
        return jsonify({'success': False, 'error': 'Invalid action'}), 400

    result = actions[action]()
    return jsonify(result), 200 if result.get('success') else 400


@email_bp.route('/webmail/configure-proxy', methods=['POST'])
@admin_required
def webmail_configure_proxy():
    """Configure Nginx reverse proxy for Roundcube."""
    data = request.get_json()
    if not data or not data.get('domain'):
        return jsonify({'success': False, 'error': 'Domain is required'}), 400

    result = RoundcubeService.configure_nginx_proxy(data['domain'])
    return jsonify(result), 200 if result.get('success') else 400


# ── Mail Queue & Logs ──

@email_bp.route('/queue', methods=['GET'])
@viewer_required
def get_queue():
    """Get Postfix mail queue."""
    result = PostfixService.get_queue()
    return jsonify(result), 200


@email_bp.route('/queue/flush', methods=['POST'])
@admin_required
def flush_queue():
    """Flush the mail queue."""
    result = PostfixService.flush_queue()
    return jsonify(result), 200 if result.get('success') else 400


@email_bp.route('/queue/<queue_id>', methods=['DELETE'])
@admin_required
def delete_queue_item(queue_id):
    """Delete a message from the queue."""
    result = PostfixService.delete_from_queue(queue_id)
    return jsonify(result), 200 if result.get('success') else 400


@email_bp.route('/logs', methods=['GET'])
@viewer_required
def get_logs():
    """Get mail logs."""
    lines = request.args.get('lines', 100, type=int)
    result = PostfixService.get_logs(lines)
    return jsonify(result), 200
