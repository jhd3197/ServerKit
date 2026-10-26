"""Plan 77 G1/G2 ratchet — new test files seed through tests/factories.py.

Two frozen populations (2026-08-19). Files in them predate the one-door seed
helpers; new test files must use ``headers_for``/``make_user`` instead of
minting JWTs with create_access_token, and ``make_application`` instead of
constructing Application(...) by hand. Shrinking a list is progress — delete
the entry when you migrate a file.
"""
import re
from pathlib import Path

TESTS = Path(__file__).resolve().parent

JWT_BASELINE = {
    'test_activity_summary_rollup.py',
    'test_agent_update_authz.py',
    'test_ai_assistant.py',
    'test_api_authz_hardening.py',
    'test_audit_log.py',
    'test_container_registry.py',
    'test_dashboards.py',
    'test_database_engine_extensions.py',
    'test_database_engines.py',
    'test_db_admin_sso.py',
    'test_db_processes.py',
    'test_dns_aaaa_conflict.py',
    'test_dns_cutover_api.py',
    'test_dns_cutover_providers.py',
    'test_drift_doctor.py',
    'test_enhancements_integration.py',
    'test_error_logs.py',
    'test_event_subscriptions.py',
    'test_extension_pending_requirements.py',
    'test_extension_permission_observation.py',
    'test_files_rbac.py',
    'test_fleet_doctor_api.py',
    'test_login_links.py',
    'test_managed_database.py',
    'test_managed_db_users.py',
    'test_metadata_guard.py',
    'test_pairing_authz.py',
    'test_plugin_search_sdk.py',
    'test_resource_grants.py',
    'test_search.py',
    'test_secrets_webhooks_authz.py',
    'test_server_capacity.py',
    'test_serverkit_gui_agent_gate.py',
    'test_setup_nag.py',
    'test_setup_security.py',
    'test_shared_resources.py',
    'test_site_import.py',
    'test_ssl_acme_contact.py',
    'test_status_extraction.py',
    'test_support_bundle.py',
    'test_theme_registry.py',
    'test_themes.py',
    'test_views.py',
    'test_workspace_scope.py',
}

APPLICATION_BASELINE = {
    'test_api_authz_hardening.py',
    'test_api_key_identity.py',
    'test_app_deploy_jobs.py',
    'test_app_resource_limits.py',
    'test_app_volumes.py',
    'test_application_soft_delete.py',
    'test_attach_domain.py',
    'test_backup_drill_scheduling.py',
    'test_bandwidth.py',
    'test_compose_env_overlay.py',
    'test_config_snapshots.py',
    'test_container_registry.py',
    'test_container_status_bulk.py',
    'test_database_engine_extensions.py',
    'test_database_engines.py',
    'test_deploy_console.py',
    'test_deploy_preflight.py',
    'test_deployments_unified.py',
    'test_dns_aaaa_conflict.py',
    'test_dns_give_subdomain.py',
    'test_doctor_dns.py',
    'test_domain_attach_service.py',
    'test_domain_vhost_ssl.py',
    'test_drift_doctor.py',
    'test_effective_env.py',
    'test_enhancements_integration.py',
    'test_file_integrity.py',
    'test_fleet_proxy.py',
    'test_image_update.py',
    'test_ingress_plane.py',
    'test_install_retry_after_failure.py',
    'test_manifest_appliance_hardening.py',
    'test_manifest_appliance_volumes_bootstrap.py',
    'test_manifest_network_identity.py',
    'test_manifest_persistence.py',
    'test_manifest_references.py',
    'test_manifest_spec.py',
    'test_manifest_sync.py',
    'test_member_actions.py',
    'test_micro_cache.py',
    'test_monitor_service.py',
    'test_per_app_read_scoping.py',
    'test_plugin_search_sdk.py',
    'test_previews.py',
    'test_probe_honesty_doctor.py',
    'test_probe_honesty_ssl.py',
    'test_projects.py',
    'test_query_layer.py',
    'test_recycle_bin.py',
    'test_resource_grants.py',
    'test_search.py',
    'test_setup_preflight.py',
    'test_setup_reconcile.py',
    'test_shared_queue_authz.py',
    'test_site_base_domains.py',
    'test_site_routing.py',
    'test_sites_https.py',
    'test_ssl_acme_contact.py',
    'test_url_swap.py',
    'test_workspace_scope.py',
    'test_wp_hook_inversions.py',
}


def _files_matching(pattern):
    found = set()
    for f in sorted(TESTS.glob('test_*.py')):
        if f.name == Path(__file__).name:
            continue
        if re.search(pattern, f.read_text(encoding='utf-8', errors='replace')):
            found.add(f.name)
    return found


def test_no_new_hand_minted_jwt_headers():
    found = _files_matching(r'create_access_token\(')
    new = found - JWT_BASELINE
    assert not new, (
        f"New test files minting their own JWTs: {sorted(new)}. "
        "Use headers_for(make_user(db, ...)) from tests/factories.py "
        "or the viewer_headers/developer_headers/auth_headers fixtures."
    )


def test_no_new_hand_rolled_application_seeds():
    found = _files_matching(r'\bApplication\(')
    new = found - APPLICATION_BASELINE
    assert not new, (
        f"New test files constructing Application(...) directly: {sorted(new)}. "
        "Use make_application(db, ...) from tests/factories.py."
    )


def test_baselines_do_not_go_stale():
    stale = (JWT_BASELINE - _files_matching(r'create_access_token\(')) | (
        APPLICATION_BASELINE - _files_matching(r'\bApplication\('))
    assert not stale, f"Migrated files still listed in a baseline: {sorted(stale)} — delete them."
