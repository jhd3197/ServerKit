"""Service for system settings operations."""
from app import db
from app.models import SystemSettings, User
from app.utils.crypto import encrypt_secret, decrypt_secret_safe, is_encrypted


class SettingsService:
    """Service for managing system settings."""

    # Default settings with their types and descriptions
    DEFAULT_SETTINGS = {
        'setup_completed': {
            'value': False,
            'type': 'boolean',
            'description': 'Whether initial setup has been completed'
        },
        'registration_enabled': {
            'value': False,
            'type': 'boolean',
            'description': 'Allow public user registration'
        },
        'instance_name': {
            'value': 'ServerKit',
            'type': 'string',
            'description': 'Name of this ServerKit instance'
        },
        'panel_title': {
            'value': 'ServerKit',
            'type': 'string',
            'description': 'Display name shown in the browser tab once signed in'
        },
        'public_title': {
            'value': 'Control Panel',
            'type': 'string',
            'description': 'Generic name shown on the public sign-in/register pages (kept brand-neutral on purpose)'
        },
        'default_language': {
            'value': 'en',
            'type': 'string',
            'description': 'Panel-default UI language (BCP-47 code) for the sign-in/setup screens and for users who have not chosen one'
        },
        'login_layout': {
            'value': 'centered',
            'type': 'string',
            'description': 'Login page layout variant: centered | split | minimal'
        },
        'audit_log_retention_days': {
            'value': 90,
            'type': 'integer',
            'description': 'Number of days to retain audit logs'
        },
        'restore_point_retention_days': {
            'value': 30,
            'type': 'integer',
            'description': 'Number of days to retain untagged restore points'
        },
        'jobs.retention_days': {
            'value': 14,
            'type': 'integer',
            'description': 'Days to retain succeeded/cancelled background jobs before pruning (failed jobs are kept 3x as long). 0 disables pruning.'
        },
        'telemetry.retention_days': {
            'value': 30,
            'type': 'integer',
            'description': 'Days to retain telemetry rows (queue messages, system events, API usage logs) before pruning. Without this the database grows ~11 MB/day forever. 0 disables pruning.'
        },
        'history.retention_days': {
            'value': 90,
            'type': 'integer',
            'description': 'Days to retain finished history (error logs, notifications, deployment jobs, cron runs, webhook and event deliveries, sandbox runs) before pruning. 0 disables pruning.'
        },
        'storage.docker_log_max_size': {
            'value': '50m',
            'type': 'string',
            'description': 'Default size cap for each container log file (Docker json-file max-size, 3 files kept). Takes effect for containers created after Docker restarts.'
        },
        'storage.previous_slot_hours': {
            'value': 24,
            'type': 'integer',
            'description': 'Hours after a healthy update before the previous version\'s install is removed. Rollback within that window stays instant. 0 keeps it until the next update.'
        },
        'storage.disk_alert_percent': {
            'value': 85,
            'type': 'integer',
            'description': 'Notify admins when the panel host disk is this full (percent); again at 95%. 0 disables.'
        },
        'storage.disk_alert_level': {
            'value': '',
            'type': 'string',
            'description': 'Last disk alert level sent (warning/critical), so each crossing notifies once.'
        },
        'storage.size_profile_applied': {
            'value': False,
            'type': 'boolean',
            'description': 'Set once the disk-size defaults have been applied to this install.'
        },
        'onboarding_use_cases': {
            'value': [],
            'type': 'json',
            'description': 'Use cases selected during onboarding wizard'
        },
        'onboarding_installed_extensions': {
            'value': [],
            'type': 'json',
            'description': 'Extension slugs installed by the setup wizard'
        },
        'dev_mode': {
            'value': False,
            'type': 'boolean',
            'description': 'Enable developer mode: debugging tools, icon reference, and unreviewed community extensions in the Marketplace'
        },
        'managed_app_base_port': {
            'value': 0,
            'type': 'integer',
            'description': 'Starting host port when auto-assigning ports to managed apps/sites (0 = use each template\'s own default). The scanner still skips ports already in use.'
        },
        # Managed-site routing & HTTPS (Phases 1/3/5). Base domain + server IP
        # drive subdomain publishing and auto-DNS; sites_https_enabled is set by
        # the wildcard-HTTPS setup, after which managed subdomains serve TLS.
        'sites_base_domain': {
            'value': '',
            'type': 'string',
            'description': 'Base domain for managed sites — each is published at <slug>.<base_domain>. Point a wildcard DNS record (*.<base_domain>) at this server.'
        },
        'server_public_ip': {
            'value': '',
            'type': 'string',
            'description': 'Public IP of this server, used to auto-create DNS A records for managed domains.'
        },
        'sites_https_enabled': {
            'value': False,
            'type': 'boolean',
            'description': 'Whether the wildcard certificate for the sites base domain is set up; managed subdomains serve HTTPS when true.'
        },
        # Panel-wide ACME contact. Every certificate ServerKit requests
        # registers this address with Let's Encrypt, which is where expiry and
        # revocation notices go — so it is worth storing once rather than
        # retyping per certificate (or guessing admin@<domain>, which usually
        # does not exist).
        'ssl.acme_email': {
            'value': '',
            'type': 'string',
            'description': "Contact email registered with Let's Encrypt for certificate expiry notices. Used when a certificate request does not carry its own address."
        },
        # Canonical panel domain. When set, the panel uses this domain for
        # agent install commands, CORS origins, and optional IP redirects.
        'canonical_domain': {
            'value': '',
            'type': 'string',
            'description': 'Canonical domain for this ServerKit panel (e.g., serverkit.example.com). Used for agent URLs and CORS.'
        },
        'canonical_https_enabled': {
            'value': False,
            'type': 'boolean',
            'description': 'Whether the canonical domain is served over HTTPS. Controls CORS origins and agent install instructions.'
        },
        # SSO / OAuth settings
        'sso_google_enabled': {'value': False, 'type': 'boolean', 'description': 'Enable Google OAuth login'},
        'sso_google_client_id': {'value': '', 'type': 'string', 'description': 'Google OAuth client ID'},
        'sso_google_client_secret': {'value': '', 'type': 'string', 'description': 'Google OAuth client secret'},
        'sso_github_enabled': {'value': False, 'type': 'boolean', 'description': 'Enable GitHub OAuth login'},
        'sso_github_client_id': {'value': '', 'type': 'string', 'description': 'GitHub OAuth client ID'},
        'sso_github_client_secret': {'value': '', 'type': 'string', 'description': 'GitHub OAuth client secret'},
        'sso_oidc_enabled': {'value': False, 'type': 'boolean', 'description': 'Enable generic OIDC login'},
        'sso_oidc_provider_name': {'value': '', 'type': 'string', 'description': 'OIDC provider display name'},
        'sso_oidc_client_id': {'value': '', 'type': 'string', 'description': 'OIDC client ID'},
        'sso_oidc_client_secret': {'value': '', 'type': 'string', 'description': 'OIDC client secret'},
        'sso_oidc_discovery_url': {'value': '', 'type': 'string', 'description': 'OIDC discovery URL'},
        'sso_saml_enabled': {'value': False, 'type': 'boolean', 'description': 'Enable SAML 2.0 login'},
        'sso_saml_entity_id': {'value': '', 'type': 'string', 'description': 'SAML SP entity ID'},
        'sso_saml_idp_metadata_url': {'value': '', 'type': 'string', 'description': 'SAML IdP metadata URL'},
        'sso_saml_idp_sso_url': {'value': '', 'type': 'string', 'description': 'SAML IdP SSO URL'},
        'sso_saml_idp_cert': {'value': '', 'type': 'string', 'description': 'SAML IdP certificate (PEM)'},
        # Off by default: enabling a provider for yourself must not let every
        # account at that provider sign up. Registration is closed by default too.
        'sso_auto_provision': {'value': False, 'type': 'boolean', 'description': 'Auto-create users on first SSO login'},
        'sso_default_role': {'value': 'viewer', 'type': 'string', 'description': 'Default role for SSO-provisioned users'},
        'sso_force_sso': {'value': False, 'type': 'boolean', 'description': 'Disable password login (SSO only)'},
        'sso_allowed_domains': {'value': [], 'type': 'json', 'description': 'Restrict SSO to these email domains'},
        # Source provider connections
        'source_github_client_id': {
            'value': '',
            'type': 'string',
            'description': 'GitHub OAuth client ID for repository connections'
        },
        'source_github_client_secret': {
            'value': '',
            'type': 'string',
            'description': 'GitHub OAuth client secret for repository connections'
        },
        # Rate limiting settings
        'rate_limit_standard': {'value': '100 per minute', 'type': 'string', 'description': 'Rate limit for standard API keys'},
        'rate_limit_elevated': {'value': '500 per minute', 'type': 'string', 'description': 'Rate limit for elevated API keys'},
        'rate_limit_unlimited': {'value': '5000 per minute', 'type': 'string', 'description': 'Rate limit for unlimited API keys'},
        'rate_limit_unauthenticated': {'value': '30 per minute', 'type': 'string', 'description': 'Rate limit for unauthenticated requests'},
        # AI assistant (core primitive — powered by Prompture). The API key is
        # stored encrypted and is NEVER returned by the settings API (see SECRET_AI_KEYS).
        'ai_enabled': {'value': False, 'type': 'boolean', 'description': 'Enable the AI assistant'},
        'ai_provider': {'value': '', 'type': 'string', 'description': 'Prompture provider (prompture-hub/openai/claude/google/groq/openrouter/ollama/lmstudio)'},
        'ai_model': {'value': '', 'type': 'string', 'description': 'Model id for the selected provider'},
        'ai_api_key_encrypted': {'value': '', 'type': 'string', 'description': 'Encrypted provider API key (never returned by the API)'},
        'ai_endpoint': {'value': '', 'type': 'string', 'description': 'Custom endpoint (ollama/lmstudio/prompture-hub OpenAI-compatible gateway, e.g. http://localhost:1984/v1)'},
        'ai_max_cost_usd': {'value': 0.5, 'type': 'string', 'description': 'Per-conversation cost ceiling in USD (budget_policy=degrade)'},
        'ai_fallback_models': {'value': [], 'type': 'json', 'description': 'Ordered fallback model ids when the primary is over budget/unavailable'},
        'ai_pii_redaction': {'value': True, 'type': 'boolean', 'description': 'Redact PII from AI input and tool output'},
        'ai_injection_detection': {'value': True, 'type': 'boolean', 'description': 'Refuse prompts flagged as prompt-injection'},
        'ai_pending_action_ttl_s': {'value': 300, 'type': 'integer', 'description': 'Seconds a write-tool confirmation stays valid'},
        # Module toggles — hide heavy verticals that haven't been extracted into
        # extensions yet (Email, WordPress). Disabling hides the nav + routes and
        # 503s the module's API (same mechanism as the plugin status guard). The
        # toggle state later becomes the extraction auto-install signal (#34).
        'module_wordpress_enabled': {'value': True, 'type': 'boolean', 'description': 'Show the WordPress module (nav, routes, and /api/v1/wordpress).'},
        # Runtime-frontend delivery kill switch (core-slim #39). When on, the
        # /plugins/contributions envelope advertises a `frontends` descriptor map
        # so a production panel can blob-import an installed extension's prebuilt
        # ESM bundle without a rebuild. Off removes the map and the client loader
        # is inert (baked builtins still render via the build-time glob).
        'extensions.runtime_frontend': {'value': True, 'type': 'boolean', 'description': 'Deliver installed extensions\' prebuilt ESM frontends to production panels at runtime (no rebuild).'},
    }

    # Settings that must never be returned through the API (only "is it set?").
    SECRET_AI_KEYS = {'ai_api_key_encrypted'}

    # Settings stored encrypted at rest (auto-encrypt on write, decrypt on read).
    # The API only exposes a boolean "is_set" / masked placeholder for these.
    SECRET_KEYS = {
        'sso_google_client_secret',
        'sso_github_client_secret',
        'sso_oidc_client_secret',
        'source_github_client_secret',
        'ai_api_key_encrypted',
    }

    @staticmethod
    def _is_secret_key(key: str) -> bool:
        return key in SettingsService.SECRET_KEYS

    @staticmethod
    def _mask_secret(value) -> str:
        """Return a masked placeholder for any non-empty secret."""
        if value:
            return '••••••••'
        return ''

    @staticmethod
    def get(key, default=None):
        """Get a setting value by key. Secret values are decrypted."""
        value = SystemSettings.get(key, default)
        if SettingsService._is_secret_key(key) and value:
            return decrypt_secret_safe(value)
        return value

    @staticmethod
    def set(key, value, user_id=None):
        """Set a setting value by key. Secret values are encrypted at rest."""
        # Get the expected type from defaults
        default_config = SettingsService.DEFAULT_SETTINGS.get(key, {})
        value_type = default_config.get('type', 'string')
        description = default_config.get('description')

        # Encrypt secret values before storage. Treat an unchanged masked
        # placeholder as a no-op so the UI doesn't overwrite the real secret.
        if SettingsService._is_secret_key(key):
            if value == SettingsService._mask_secret(value) or value == '••••••••':
                existing = SystemSettings.get(key)
                if existing is not None:
                    return SystemSettings.query.filter_by(key=key).first()
                value = ''
            elif value:
                value = encrypt_secret(value)

        setting = SystemSettings.set(
            key=key,
            value=value,
            value_type=value_type,
            description=description,
            user_id=user_id
        )
        db.session.commit()
        return setting

    @staticmethod
    def get_all(mask_secrets=True):
        """Get all settings as a dictionary. Secrets are masked unless requested."""
        settings = SystemSettings.query.all()
        result = {}
        for setting in settings:
            value = setting.get_typed_value()
            if mask_secrets and SettingsService._is_secret_key(setting.key):
                result[setting.key] = SettingsService._mask_secret(value)
            else:
                result[setting.key] = value
        return result

    @staticmethod
    def get_all_with_metadata(mask_secrets=True):
        """Get all settings with full metadata. Secrets are masked unless requested."""
        settings = SystemSettings.query.all()
        result = []
        for setting in settings:
            data = setting.to_dict()
            if mask_secrets and SettingsService._is_secret_key(setting.key):
                data['value'] = SettingsService._mask_secret(data['value'])
            result.append(data)
        return result

    @staticmethod
    def migrate_legacy_secrets() -> int:
        """One-time, idempotent: encrypt system-setting secrets still stored in plaintext."""
        changed = 0
        for key in SettingsService.SECRET_KEYS:
            setting = SystemSettings.query.filter_by(key=key).first()
            if not setting or not setting.value:
                continue
            if not is_encrypted(setting.value):
                setting.value = encrypt_secret(setting.value)
                changed += 1
        if changed:
            db.session.commit()
        return changed

    @staticmethod
    def initialize_defaults():
        """Initialize default settings if they don't exist."""
        for key, config in SettingsService.DEFAULT_SETTINGS.items():
            existing = SystemSettings.query.filter_by(key=key).first()
            if not existing:
                SystemSettings.set(
                    key=key,
                    value=config['value'],
                    value_type=config['type'],
                    description=config['description']
                )
        db.session.commit()

    @staticmethod
    def needs_setup():
        """Check if initial setup is needed."""
        from app.models.user import User
        user_count = User.query.count()
        if user_count == 0:
            return True
        setup_completed = SettingsService.get('setup_completed', False)
        if setup_completed:
            return False  # Once completed, never re-enable without admin action
        return True

    @staticmethod
    def complete_setup(user_id=None):
        """Mark the initial setup as completed."""
        SettingsService.set('setup_completed', True, user_id=user_id)

    @staticmethod
    def is_registration_enabled():
        """Check if public registration is enabled."""
        # If no users exist, always allow registration (for first user)
        user_count = User.query.count()
        if user_count == 0:
            return True
        return SettingsService.get('registration_enabled', False)

    @staticmethod
    def set_registration_enabled(enabled, user_id=None):
        """Enable or disable public registration."""
        SettingsService.set('registration_enabled', enabled, user_id=user_id)

    @staticmethod
    def migrate_legacy_roles():
        """Migrate users with 'user' role to 'developer' role."""
        try:
            users_to_migrate = User.query.filter_by(role='user').all()
            count = 0
            for user in users_to_migrate:
                user.role = User.ROLE_DEVELOPER
                count += 1
            if count > 0:
                db.session.commit()
            return count
        except Exception:
            db.session.rollback()
            return 0

    @staticmethod
    def ensure_admin_exists():
        """
        Check if at least one admin exists.
        If users exist but no admins, something is wrong.
        """
        admin_count = User.query.filter_by(role=User.ROLE_ADMIN).count()
        user_count = User.query.count()
        return admin_count > 0 or user_count == 0
