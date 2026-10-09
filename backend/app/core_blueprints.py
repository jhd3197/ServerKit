"""Explicit registry for ServerKit's core API blueprints.

Core routes are deliberately curated here rather than discovered from the
filesystem.  Besides making the app factory readable, the ordered manifest
keeps compatibility aliases visible and gives structural tests one stable
surface to guard.

Installed extension blueprints are not part of this registry.  They continue
to be registered by :mod:`app.services.plugin_service` after migrations have
prepared the plugin tables.
"""

from dataclasses import dataclass
from importlib import import_module

from flask import Blueprint, Flask


@dataclass(frozen=True, slots=True)
class BlueprintSpec:
    """One ordered core blueprint mount."""

    module: str
    attribute: str
    url_prefix: str
    name: str | None = None

    def load(self) -> Blueprint:
        """Import and return the configured blueprint."""
        blueprint = getattr(import_module(self.module), self.attribute)
        if not isinstance(blueprint, Blueprint):
            raise TypeError(
                f'{self.module}.{self.attribute} is not a Flask Blueprint'
            )
        return blueprint

    @property
    def manifest_entry(self) -> tuple[str, str, str, str | None]:
        """Return the stable, serializable representation used by tests."""
        return self.module, self.attribute, self.url_prefix, self.name


# Registration order intentionally matches the historical create_app order.
# Several blueprints are mounted more than once to preserve compatibility
# aliases; each alias must use a distinct Flask registration name.
CORE_BLUEPRINTS: tuple[BlueprintSpec, ...] = (
    BlueprintSpec('app.api.auth', 'auth_bp', '/api/v1/auth'),
    BlueprintSpec('app.api.agent_poll', 'agent_poll_bp', '/api/v1/agent'),
    BlueprintSpec('app.api.linked_panel', 'linked_panel_bp', '/api/v1/linked-panel'),
    BlueprintSpec('app.api.apps', 'apps_bp', '/api/v1/apps'),
    BlueprintSpec('app.api.apps', 'apps_bp', '/api/v1/services', name='services'),
    BlueprintSpec('app.api.domains', 'domains_bp', '/api/v1/domains'),
    BlueprintSpec('app.api.private_urls', 'private_urls_bp', '/api/v1/apps'),
    BlueprintSpec('app.api.app_volumes', 'app_volumes_bp', '/api/v1/apps'),
    BlueprintSpec('app.api.app_attachments', 'app_attachments_bp', '/api/v1/apps'),
    BlueprintSpec('app.api.app_slots', 'app_slots_bp', '/api/v1/apps'),
    BlueprintSpec('app.api.ports', 'ports_bp', '/api/v1/ports'),
    BlueprintSpec(
        'app.api.app_volumes',
        'app_volumes_bp',
        '/api/v1/services',
        name='app_volumes_services',
    ),
    BlueprintSpec('app.api.system', 'system_bp', '/api/v1/system'),
    BlueprintSpec('app.api.processes', 'processes_bp', '/api/v1/processes'),
    BlueprintSpec('app.api.logs', 'logs_bp', '/api/v1/logs'),
    BlueprintSpec('app.api.nginx', 'nginx_bp', '/api/v1/nginx'),
    BlueprintSpec('app.api.ssl', 'ssl_bp', '/api/v1/ssl'),
    BlueprintSpec('app.api.php', 'php_bp', '/api/v1/php'),
    BlueprintSpec('app.api.python', 'python_bp', '/api/v1/python'),
    BlueprintSpec('app.api.docker', 'docker_bp', '/api/v1/docker'),
    BlueprintSpec('app.api.databases', 'databases_bp', '/api/v1/databases'),
    BlueprintSpec(
        'app.api.database_engines',
        'database_engines_bp',
        '/api/v1/databases/engines',
    ),
    BlueprintSpec(
        'app.api.managed_db_users',
        'managed_db_users_bp',
        '/api/v1/managed-databases',
    ),
    BlueprintSpec('app.api.db_tuner', 'db_tuner_bp', '/api/v1/db-tuner'),
    BlueprintSpec('app.api.monitoring', 'monitoring_bp', '/api/v1/monitoring'),
    BlueprintSpec(
        'app.api.container_status',
        'container_status_bp',
        '/api/v1/status',
    ),
    BlueprintSpec('app.api.buildpacks', 'buildpacks_bp', '/api/v1/buildpacks'),
    BlueprintSpec('app.api.snapshots', 'snapshots_bp', '/api/v1/apps'),
    BlueprintSpec(
        'app.api.restore_points',
        'restore_points_bp',
        '/api/v1/restore-points',
    ),
    BlueprintSpec('app.api.manifests', 'manifests_bp', '/api/v1/manifests'),
    BlueprintSpec('app.api.recipes', 'recipes_bp', '/api/v1/recipes'),
    BlueprintSpec(
        'app.api.walkthroughs',
        'walkthroughs_bp',
        '/api/v1/walkthroughs',
    ),
    BlueprintSpec('app.api.projects', 'projects_bp', '/api/v1/projects'),
    BlueprintSpec('app.api.environments', 'environments_bp', '/api/v1/environments'),
    BlueprintSpec(
        'app.api.shared_resources',
        'shared_resources_bp',
        '/api/v1/shared',
    ),
    BlueprintSpec('app.api.previews', 'previews_bp', '/api/v1/apps'),
    BlueprintSpec('app.api.webhooks', 'webhooks_bp', '/api/v1/webhooks'),
    BlueprintSpec('app.api.proxy', 'proxy_bp', '/api/v1/servers'),
    BlueprintSpec(
        'app.api.notifications',
        'notifications_bp',
        '/api/v1/notifications',
    ),
    BlueprintSpec('app.api.backups', 'backups_bp', '/api/v1/backups'),
    BlueprintSpec('app.api.deploy', 'deploy_bp', '/api/v1/deploy'),
    BlueprintSpec('app.api.builds', 'builds_bp', '/api/v1/builds'),
    BlueprintSpec(
        'app.api.deployment_jobs',
        'deployment_jobs_bp',
        '/api/v1/deployment-jobs',
    ),
    BlueprintSpec('app.api.deployments', 'deployments_bp', '/api/v1/deployments'),
    BlueprintSpec(
        'app.api.deployment_jobs',
        'deployment_jobs_bp',
        '/api/v1/deployments/jobs',
        name='deployment_jobs_unified',
    ),
    BlueprintSpec('app.api.runs', 'runs_bp', '/api/v1/runs'),
    BlueprintSpec('app.api.templates', 'templates_bp', '/api/v1/templates'),
    BlueprintSpec('app.api.files', 'files_bp', '/api/v1/files'),
    BlueprintSpec('app.api.firewall', 'firewall_bp', '/api/v1/firewall'),
    BlueprintSpec('app.api.git', 'git_bp', '/api/v1/git'),
    BlueprintSpec('app.api.security', 'security_bp', '/api/v1/security'),
    BlueprintSpec('app.api.secrets_webhooks', 'bp', '/api/v1'),
    BlueprintSpec('app.api.cron', 'cron_bp', '/api/v1/cron'),
    BlueprintSpec('app.api.uptime', 'uptime_bp', '/api/v1/uptime'),
    BlueprintSpec('app.api.monitors', 'monitors_bp', '/api/v1/monitors'),
    BlueprintSpec('app.api.env_vars', 'env_vars_bp', '/api/v1/apps'),
    BlueprintSpec('app.api.two_factor', 'two_factor_bp', '/api/v1/auth/2fa'),
    BlueprintSpec('app.api.sso', 'sso_bp', '/api/v1/sso'),
    BlueprintSpec(
        'app.api.source_connections',
        'source_connections_bp',
        '/api/v1/source-connections',
    ),
    BlueprintSpec('app.api.registrars', 'registrars_bp', '/api/v1/registrars'),
    BlueprintSpec('app.api.connections', 'connections_bp', '/api/v1/connections'),
    BlueprintSpec('app.api.migrations', 'migrations_bp', '/api/v1/migrations'),
    BlueprintSpec('app.api.api_keys', 'api_keys_bp', '/api/v1/api-keys'),
    BlueprintSpec(
        'app.api.api_analytics',
        'api_analytics_bp',
        '/api/v1/api-analytics',
    ),
    BlueprintSpec(
        'app.api.event_subscriptions',
        'event_subscriptions_bp',
        '/api/v1/event-subscriptions',
    ),
    BlueprintSpec('app.api.docs', 'docs_bp', '/api/v1/docs'),
    BlueprintSpec('app.api.admin', 'admin_bp', '/api/v1/admin'),
    BlueprintSpec(
        'app.api.invitations',
        'invitations_bp',
        '/api/v1/admin/invitations',
    ),
    BlueprintSpec('app.api.metrics', 'metrics_bp', '/api/v1/metrics'),
    BlueprintSpec('app.api.servers', 'servers_bp', '/api/v1/servers'),
    BlueprintSpec('app.api.survey', 'survey_bp', '/api/v1/servers'),
    BlueprintSpec(
        'app.api.fleet_monitor',
        'fleet_monitor_bp',
        '/api/v1/fleet-monitor',
    ),
    BlueprintSpec('app.api.fleet', 'fleet_bp', '/api/v1/fleet'),
    BlueprintSpec(
        'app.api.agent_plugins',
        'agent_plugins_bp',
        '/api/v1/agent-plugins',
    ),
    BlueprintSpec(
        'app.api.server_templates',
        'server_templates_bp',
        '/api/v1/server-templates',
    ),
    BlueprintSpec('app.api.workspaces', 'workspaces_bp', '/api/v1/workspaces'),
    BlueprintSpec(
        'app.api.advanced_ssl',
        'advanced_ssl_bp',
        '/api/v1/ssl/advanced',
    ),
    BlueprintSpec(
        'app.api.advanced_ssl',
        'advanced_ssl_bp',
        '/api/v1/ssl',
        name='advanced_ssl_unified',
    ),
    BlueprintSpec('app.api.dns_zones', 'dns_zones_bp', '/api/v1/dns'),
    BlueprintSpec('app.api.dns_cutover', 'dns_cutover_bp', '/api/v1/dns-cutover'),
    BlueprintSpec('app.api.setup_health', 'setup_health_bp', '/api/v1/setup-health'),
    BlueprintSpec('app.api.dns_providers', 'dns_providers_bp', '/api/v1/email'),
    BlueprintSpec('app.api.ddns', 'ddns_bp', '/api/v1/ddns'),
    BlueprintSpec(
        'app.api.image_updates',
        'image_updates_bp',
        '/api/v1/image-updates',
    ),
    BlueprintSpec('app.api.waf', 'waf_bp', '/api/v1/waf'),
    BlueprintSpec(
        'app.api.nginx_advanced',
        'nginx_advanced_bp',
        '/api/v1/nginx/advanced',
    ),
    BlueprintSpec('app.api.performance', 'performance_bp', '/api/v1/performance'),
    BlueprintSpec('app.api.mobile', 'mobile_bp', '/api/v1/mobile'),
    BlueprintSpec('app.api.marketplace', 'marketplace_bp', '/api/v1/marketplace'),
    BlueprintSpec('app.api.themes', 'themes_bp', '/api/v1/themes'),
    BlueprintSpec('app.api.views', 'views_bp', '/api/v1/views'),
    BlueprintSpec(
        'app.api.recycle_bin',
        'recycle_bin_bp',
        '/api/v1/recycle-bin',
    ),
    BlueprintSpec('app.api.error_logs', 'error_logs_bp', '/api/v1/error-logs'),
    BlueprintSpec('app.api.dashboards', 'dashboards_bp', '/api/v1/dashboards'),
    BlueprintSpec('app.api.plugins', 'plugins_bp', '/api/v1/plugins'),
    BlueprintSpec('app.api.search', 'search_bp', '/api/v1/search'),
    BlueprintSpec('app.api.modules', 'modules_bp', '/api/v1/modules'),
    BlueprintSpec('app.api.queue_bus', 'queue_bus_bp', '/api/v1/queue'),
    BlueprintSpec('app.api.jobs', 'jobs_bp', '/api/v1/jobs'),
    BlueprintSpec('app.api.telemetry', 'telemetry_bp', '/api/v1/telemetry'),
    BlueprintSpec(
        'app.api.monitoring',
        'monitoring_bp',
        '/api/v1/observability/monitoring',
        name='obs_monitoring',
    ),
    BlueprintSpec(
        'app.api.metrics',
        'metrics_bp',
        '/api/v1/observability/metrics',
        name='obs_metrics',
    ),
    BlueprintSpec(
        'app.api.telemetry',
        'telemetry_bp',
        '/api/v1/observability/events',
        name='obs_events',
    ),
    BlueprintSpec(
        'app.api.uptime',
        'uptime_bp',
        '/api/v1/observability/uptime',
        name='obs_uptime',
    ),
    BlueprintSpec(
        'app.api.fleet_monitor',
        'fleet_monitor_bp',
        '/api/v1/observability/fleet',
        name='obs_fleet',
    ),
    BlueprintSpec('app.api.pairing', 'pairing_bp', '/api/v1/pairing'),
    BlueprintSpec('app.api.connect', 'connect_bp', '/api/v1/connect'),
    BlueprintSpec('app.api.ai', 'ai_bp', '/api/v1/ai'),
    BlueprintSpec('app.api.speed_test', 'speedtest_bp', '/api/v1/speedtest'),
    BlueprintSpec('app.api.site_imports', 'site_imports_bp', '/api/v1/imports'),
    BlueprintSpec('app.api.doctor', 'doctor_bp', '/api/v1/doctor'),
    BlueprintSpec(
        'app.api.fleet_doctor',
        'fleet_doctor_bp',
        '/api/v1/doctor/fleet',
    ),
    BlueprintSpec(
        'app.api.support_bundle',
        'support_bundle_bp',
        '/api/v1/support-bundle',
    ),
    BlueprintSpec('app.api.bandwidth', 'bandwidth_bp', '/api/v1/bandwidth'),
    BlueprintSpec('app.api.htaccess_tools', 'htaccess_tools_bp', '/api/v1/apps'),
    BlueprintSpec(
        'app.api.test_sandbox',
        'test_sandbox_bp',
        '/api/v1/test-sandbox',
    ),
)


def register_core_blueprints(app: Flask) -> None:
    """Register every curated core API blueprint on ``app`` in order."""
    for spec in CORE_BLUEPRINTS:
        options = {'url_prefix': spec.url_prefix}
        if spec.name is not None:
            options['name'] = spec.name
        app.register_blueprint(spec.load(), **options)
