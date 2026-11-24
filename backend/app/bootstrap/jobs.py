"""Register core job handlers before the consumer starts."""

def register_job_handlers(app):
    from app.jobs.builtin_handlers import register_builtin_handlers, seed_builtin_schedules
    register_builtin_handlers()
    # Register event-driven job handlers (deployment installs, workflow runs,
    # scheduled backups).
    from app.services.deployment_job_service import DeploymentJobService
    DeploymentJobService.register_jobs()
    from app.services.recipe_execution_service import RecipeExecutionService
    RecipeExecutionService.register_jobs()
    from app.services.framework_scaffold_service import FrameworkScaffoldService
    FrameworkScaffoldService.register_jobs()
    # WorkflowEngine.register_jobs() removed (engine retired).
    from app.services.backup_service import BackupService
    BackupService.register_jobs()
    from app.services.backup_policy_service import BackupPolicyService
    BackupPolicyService.register_jobs()
    from app.services.server_onboarding_service import ServerOnboardingService
    ServerOnboardingService.register_jobs()
    from app.services.preview_service import PreviewService
    PreviewService.register_jobs()
    from app.services.metadata_guard_service import MetadataGuardService
    MetadataGuardService.register_jobs()
    if not app.config.get('TESTING'):
        MetadataGuardService.ensure()  # converge the metadata egress rule (no-op when unsupported)
        # Bound the log files the panel writes or causes.
        from app.services import log_limits_service
        log_limits_service.converge()
    from app.services.speed_test_service import SpeedTestService
    SpeedTestService.register_jobs()
    from app.services import login_link_service
    login_link_service.register_jobs()
    from app.services.db_admin_sso_service import DbAdminSsoService
    DbAdminSsoService.register_jobs()
    from app.services.site_import_service import SiteImportService
    SiteImportService.register_jobs()
    from app.services.drift_service import DriftService
    DriftService.register_jobs()
    from app.services import disk_reclaim_service
    disk_reclaim_service.register_jobs()
    from app.services.doctor_service import DoctorService
    DoctorService.register_jobs()
    from app.services.fleet_doctor_service import FleetDoctorService
    FleetDoctorService.register_jobs()
    from app.services.file_integrity_service import FileIntegrityService
    FileIntegrityService.register_jobs()
    # security.malware_scan / security.lynis_scan / security.image_scan
    # handlers register via their extensions' manifest `jobs` key
    # (serverkit-clamav / serverkit-lynis / serverkit-image-scan).
    from app.services.bandwidth_service import BandwidthService
    BandwidthService.register_jobs()
    return seed_builtin_schedules
