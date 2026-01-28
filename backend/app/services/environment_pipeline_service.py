"""
Environment Pipeline Service

Orchestrates the full WordPress environment lifecycle:
- Create isolated environments (dev, staging, multidev)
- Promote code/database between environments
- Sync environments from production
- Lock/unlock environments during operations
- Compare environments (plugins, themes, versions)
- Activity tracking and audit trail

This is the "conductor" that coordinates EnvironmentDockerService,
DatabaseSyncService, EnvironmentDomainService, and the WordPress models.
"""

import os
import json
import shutil
import secrets
import string
import subprocess
import time
from datetime import datetime, timedelta
from typing import Dict, Optional

from app import db
from app.models.application import Application
from app.models.wordpress_site import WordPressSite, DatabaseSnapshot
from app.models.environment_activity import EnvironmentActivity
from app.models.promotion_job import PromotionJob
from app.services.environment_docker_service import EnvironmentDockerService
from app.services.environment_domain_service import EnvironmentDomainService
from app.services.db_sync_service import DatabaseSyncService


class EnvironmentPipelineService:
    """Orchestrate WordPress environment creation, sync, and promotion."""

    # ==================== ENVIRONMENT CREATION ====================

    @classmethod
    def _emit_progress(cls, callback, step: int, total: int, message: str):
        """Emit a progress callback if provided."""
        if callback:
            try:
                callback({
                    'step': step,
                    'total': total,
                    'message': message,
                    'percent': int((step / total) * 100) if total > 0 else 0,
                })
            except Exception:
                pass

    @classmethod
    def _send_notification(cls, action: str, details: Dict, user_id: int = None):
        """Send a notification about a pipeline operation via configured channels."""
        try:
            from app.services.notification_service import NotificationService
            message = details.get('message', f'WordPress Pipeline: {action}')

            alerts = [{
                'title': f'Pipeline: {action}',
                'message': message,
                'severity': 'info',
                'source': 'wordpress_pipeline',
            }]
            NotificationService.send_all(alerts)
        except Exception:
            pass  # Notifications are best-effort

    @classmethod
    def create_project_environment(cls, production_site_id: int, env_type: str,
                                    config: Dict, user_id: int,
                                    progress_callback=None) -> Dict:
        """
        Create a fully isolated Docker environment for a WordPress project.

        Creates a new docker-compose stack, clones the production database,
        copies WordPress files, generates Nginx config, and wires everything up.

        Args:
            production_site_id: ID of the production WordPressSite
            env_type: 'development', 'staging', or 'multidev'
            config: Configuration dict:
                - name: Environment display name
                - domain: Custom domain (auto-generated if None)
                - branch: Git branch for multidev envs
                - clone_db: Whether to clone production DB (default True)
                - resource_limits: Optional {memory, cpus, db_memory, db_cpus}
            user_id: ID of the user creating the environment

        Returns:
            Dict with success status and environment details
        """
        if env_type not in ['development', 'staging', 'multidev']:
            return {'success': False, 'error': 'Invalid environment type. Must be development, staging, or multidev.'}

        prod_site = WordPressSite.query.get(production_site_id)
        if not prod_site:
            return {'success': False, 'error': 'Production site not found'}

        if not prod_site.is_production and prod_site.environment_type != 'production':
            return {'success': False, 'error': 'Source site is not a production environment'}

        prod_app = prod_site.application
        if not prod_app:
            return {'success': False, 'error': 'Production application not found'}

        # Check for existing environment of same type (except multidev)
        if env_type != 'multidev':
            existing = WordPressSite.query.filter_by(
                production_site_id=production_site_id,
                environment_type=env_type
            ).first()
            if existing:
                return {'success': False, 'error': f'A {env_type} environment already exists for this project'}

        # Start activity tracking
        start_time = time.time()
        activity = cls._create_activity(
            site_id=production_site_id,
            user_id=user_id,
            action='environment_created',
            description=f'Creating {env_type} environment',
            status='running'
        )

        try:
            # Generate project name slug
            project_name = cls._slugify(prod_app.name)

            # Handle multidev naming
            branch_name = config.get('branch')
            if env_type == 'multidev':
                if not branch_name:
                    return {'success': False, 'error': 'Branch name required for multidev environments'}
                env_type_dir = f'multidev-{EnvironmentDomainService.slugify(branch_name)}'
            else:
                env_type_dir = env_type

            cls._emit_progress(progress_callback, 1, 10, 'Generating Docker Compose configuration...')

            # Step 1: Generate Docker Compose stack
            compose_config = {
                'db_name': f'wp_{project_name}_{env_type_dir}'.replace('-', '_')[:64],
                'db_user': f'wp_{project_name}'[:32],
                'db_password': cls._generate_password(),
                'db_root_password': cls._generate_password(),
                'table_prefix': 'wp_',
            }
            if config.get('resource_limits'):
                compose_config.update(config['resource_limits'])

            compose_result = EnvironmentDockerService.generate_compose_file(
                project_name=project_name,
                env_type=env_type_dir,
                config=compose_config
            )

            if not compose_result['success']:
                cls._finish_activity(activity, 'failed', compose_result.get('error'), start_time)
                return compose_result

            compose_path = compose_result['compose_path']
            env_dir = compose_result['env_dir']
            wp_port = compose_result['wp_port']
            env_vars = compose_result['env_vars']

            cls._emit_progress(progress_callback, 2, 10, 'Generating domain...')

            # Step 2: Generate domain
            prod_domain = None
            if prod_app.domains:
                prod_domains = list(prod_app.domains)
                if prod_domains:
                    prod_domain = prod_domains[0].domain

            domain = config.get('domain') or EnvironmentDomainService.generate_domain(
                production_domain=prod_domain or '',
                env_type=env_type,
                branch_name=branch_name
            )

            # Step 3: Create Application record
            env_name = config.get('name', f"{prod_app.name} ({env_type.title()})")
            if env_type == 'multidev':
                env_name = f"{prod_app.name} ({branch_name})"

            env_app = Application(
                name=env_name,
                app_type='wordpress',
                status='deploying',
                php_version=prod_app.php_version,
                port=wp_port,
                root_path=env_dir,
                environment_type=env_type,
                linked_app_id=prod_app.id,
                user_id=user_id
            )
            db.session.add(env_app)
            db.session.flush()

            # Step 4: Create WordPressSite record
            env_site = WordPressSite(
                application_id=env_app.id,
                wp_version=prod_site.wp_version,
                multisite=prod_site.multisite,
                admin_user=prod_site.admin_user,
                admin_email=prod_site.admin_email,
                db_name=env_vars['DB_NAME'],
                db_user=env_vars['DB_USER'],
                db_host='localhost',
                db_prefix=env_vars['TABLE_PREFIX'],
                git_repo_url=prod_site.git_repo_url,
                git_branch=branch_name or prod_site.git_branch,
                git_paths=prod_site.git_paths,
                auto_deploy=False,
                is_production=False,
                production_site_id=production_site_id,
                environment_type=env_type,
                multidev_branch=branch_name,
                compose_project_name=project_name,
                container_prefix=f'{project_name}-{env_type_dir}',
            )
            db.session.add(env_site)
            db.session.flush()

            cls._emit_progress(progress_callback, 5, 10, 'Starting Docker containers...')

            # Step 5: Start Docker containers
            start_result = EnvironmentDockerService.start_environment(compose_path)
            if not start_result['success']:
                db.session.rollback()
                cls._finish_activity(activity, 'failed', f"Docker start failed: {start_result.get('error')}", start_time)
                # Cleanup compose files
                EnvironmentDockerService.destroy_environment(compose_path, remove_volumes=True)
                return {'success': False, 'error': f"Failed to start containers: {start_result.get('error')}"}

            cls._emit_progress(progress_callback, 6, 10, 'Waiting for MySQL to be ready...')

            # Step 6: Wait for MySQL to be ready
            cls._wait_for_mysql(compose_path, env_vars['DB_USER'], env_vars['DB_PASSWORD'])

            cls._emit_progress(progress_callback, 7, 10, 'Cloning production database...')

            # Step 7: Clone production database if requested
            if config.get('clone_db', True):
                prod_compose_path = cls._get_compose_path(prod_site)

                if prod_compose_path:
                    # Container-to-container clone
                    clone_options = {
                        'exclude_tables': config.get('exclude_tables', []),
                        'truncate_tables': config.get('truncate_tables', [
                            'actionscheduler_actions',
                            'actionscheduler_logs',
                        ]),
                    }

                    # Add search-replace for domain
                    if prod_domain and domain:
                        clone_options['search_replace'] = {
                            f'https://{prod_domain}': f'https://{domain}',
                            f'http://{prod_domain}': f'http://{domain}',
                            prod_domain: domain,
                        }

                    clone_result = DatabaseSyncService.clone_between_containers(
                        source_compose_path=prod_compose_path,
                        target_compose_path=compose_path,
                        source_db=prod_site.db_name,
                        target_db=env_vars['DB_NAME'],
                        source_user=prod_site.db_user,
                        target_user=env_vars['DB_USER'],
                        source_password=cls._get_env_password(prod_site),
                        target_password=env_vars['DB_PASSWORD'],
                        options=clone_options
                    )
                else:
                    # Production runs on host MySQL — export from host, import to container
                    clone_options = {
                        'exclude_tables': config.get('exclude_tables', []),
                        'truncate_tables': config.get('truncate_tables', [
                            'actionscheduler_actions',
                            'actionscheduler_logs',
                        ]),
                    }

                    if prod_domain and domain:
                        clone_options['search_replace'] = {
                            f'https://{prod_domain}': f'https://{domain}',
                            f'http://{prod_domain}': f'http://{domain}',
                            prod_domain: domain,
                        }

                    # Export from host MySQL
                    export_result = DatabaseSyncService.create_snapshot(
                        db_name=prod_site.db_name,
                        name=f'env_clone_{env_type_dir}',
                        host=prod_site.db_host or 'localhost',
                        user=prod_site.db_user,
                        password=cls._get_db_password_from_config(prod_site),
                        compress=False,
                        exclude_tables=clone_options.get('exclude_tables', [])
                    )

                    if not export_result['success']:
                        clone_result = export_result
                    else:
                        dump_file = export_result['snapshot']['file_path']
                        transformed_file = dump_file.replace('.sql', '_transformed.sql')

                        try:
                            # Transform if needed
                            needs_transform = any([
                                clone_options.get('search_replace'),
                                clone_options.get('truncate_tables')
                            ])

                            import_file = dump_file
                            clone_result = None

                            if needs_transform:
                                transform_result = DatabaseSyncService._transform_dump(
                                    dump_file, transformed_file, clone_options
                                )
                                if not transform_result['success']:
                                    clone_result = transform_result
                                else:
                                    import_file = transformed_file

                            # Import into container if transform didn't fail
                            if clone_result is None:
                                clone_result = DatabaseSyncService.import_to_container(
                                    compose_path=compose_path,
                                    snapshot_path=import_file,
                                    db_name=env_vars['DB_NAME'],
                                    db_user=env_vars['DB_USER'],
                                    db_password=env_vars['DB_PASSWORD']
                                )
                        finally:
                            for f in [dump_file, transformed_file]:
                                if os.path.exists(f):
                                    os.remove(f)

                if not clone_result.get('success'):
                    # DB clone failed — log warning but don't fail entire creation
                    activity_meta = {'warning': f"DB clone failed: {clone_result.get('error')}"}
                else:
                    activity_meta = {'db_cloned': True}
            else:
                activity_meta = {'db_cloned': False}

            cls._emit_progress(progress_callback, 8, 10, 'Copying WordPress files...')

            # Step 8: Copy WordPress files from production if they exist
            prod_wp_dir = prod_app.root_path
            env_wp_dir = os.path.join(env_dir, 'wordpress')
            if prod_wp_dir and os.path.exists(prod_wp_dir):
                cls._copy_wordpress_files(prod_wp_dir, env_wp_dir)

            cls._emit_progress(progress_callback, 9, 10, 'Creating Nginx configuration...')

            # Step 9: Create Nginx config
            site_name = f'wp-{project_name}-{env_type_dir}'
            nginx_result = EnvironmentDomainService.create_nginx_config(
                site_name=site_name,
                domain=domain,
                upstream_port=wp_port,
                env_type=env_type
            )
            if not nginx_result['success']:
                activity_meta['nginx_warning'] = nginx_result.get('error')

            cls._emit_progress(progress_callback, 10, 10, 'Finalizing environment...')

            # Step 10: Update application status
            env_app.status = 'running'
            db.session.commit()

            # Finish activity
            activity_meta.update({
                'env_type': env_type,
                'domain': domain,
                'port': wp_port,
                'project_name': project_name,
                'site_id': env_site.id,
            })
            cls._finish_activity(activity, 'completed', None, start_time, activity_meta)

            return {
                'success': True,
                'message': f'{env_type.title()} environment created successfully',
                'environment': env_site.to_dict(),
                'application': env_app.to_dict(),
                'domain': domain,
                'compose_path': compose_path,
            }

        except Exception as e:
            db.session.rollback()
            cls._finish_activity(activity, 'failed', str(e), start_time)
            return {'success': False, 'error': str(e)}

    # ==================== SYNC FROM PRODUCTION ====================

    @classmethod
    def sync_from_production(cls, env_site_id: int, sync_type: str = 'full',
                              options: Dict = None, user_id: int = None,
                              progress_callback=None) -> Dict:
        """
        Pull production data (database and/or files) into a lower environment.

        Args:
            env_site_id: ID of the target environment's WordPressSite
            sync_type: 'database', 'files', or 'full' (both)
            options: Sync options:
                - sanitize: Whether to apply sanitization
                - search_replace: Additional search/replace pairs
                - truncate_tables: Tables to empty
                - exclude_tables: Tables to skip
            user_id: ID of the user performing the sync

        Returns:
            Dict with success status
        """
        options = options or {}

        env_site = WordPressSite.query.get(env_site_id)
        if not env_site:
            return {'success': False, 'error': 'Environment not found'}

        if env_site.is_production or env_site.environment_type == 'production':
            return {'success': False, 'error': 'Cannot sync into a production environment'}

        prod_site = env_site.production_site
        if not prod_site:
            return {'success': False, 'error': 'Production site not found'}

        # Check lock
        if env_site.is_locked:
            return {'success': False, 'error': f'Environment is locked: {env_site.locked_reason}'}

        start_time = time.time()
        activity = cls._create_activity(
            site_id=env_site_id,
            user_id=user_id,
            action='synced_from_production',
            description=f'Syncing {sync_type} from production',
            status='running'
        )

        # Lock during sync
        cls._lock_environment(env_site, 'Sync from production in progress', user_id)
        cls._emit_progress(progress_callback, 1, 5, 'Locking environment...')

        try:
            env_compose_path = cls._get_compose_path(env_site)
            prod_compose_path = cls._get_compose_path(prod_site)
            pre_sync_snapshot_path = None

            # Sync database
            if sync_type in ('database', 'full'):
                cls._emit_progress(progress_callback, 2, 5, 'Creating pre-sync snapshot...')
                # Create pre-sync snapshot for rollback safety
                if env_compose_path:
                    env_vars = cls._read_env_vars(env_site)
                    snapshot_result = DatabaseSyncService.export_from_container(
                        compose_path=env_compose_path,
                        db_name=env_site.db_name,
                        db_user=env_vars.get('DB_USER', env_site.db_user),
                        db_password=env_vars.get('DB_PASSWORD'),
                    )
                    if snapshot_result['success']:
                        pre_sync_snapshot_path = snapshot_result['file_path']

                # Build clone options
                clone_options = {
                    'search_replace': options.get('search_replace', {}),
                    'truncate_tables': options.get('truncate_tables', []),
                    'exclude_tables': options.get('exclude_tables', []),
                    'anonymize': options.get('sanitize', False),
                }

                # Auto-add domain search-replace
                prod_domain = cls._get_primary_domain(prod_site)
                env_domain = cls._get_primary_domain(env_site)
                if prod_domain and env_domain and prod_domain != env_domain:
                    clone_options['search_replace'].update({
                        f'https://{prod_domain}': f'https://{env_domain}',
                        f'http://{prod_domain}': f'http://{env_domain}',
                        prod_domain: env_domain,
                    })

                cls._emit_progress(progress_callback, 3, 5, 'Syncing database...')

                # Clone DB
                if prod_compose_path and env_compose_path:
                    clone_result = DatabaseSyncService.clone_between_containers(
                        source_compose_path=prod_compose_path,
                        target_compose_path=env_compose_path,
                        source_db=prod_site.db_name,
                        target_db=env_site.db_name,
                        source_user=prod_site.db_user,
                        target_user=env_site.db_user,
                        source_password=cls._get_env_password(prod_site),
                        target_password=cls._get_env_password(env_site),
                        options=clone_options,
                    )
                else:
                    # Fallback: host-to-host clone
                    clone_result = DatabaseSyncService.clone_database(
                        source_db=prod_site.db_name,
                        target_db=env_site.db_name,
                        source_host=prod_site.db_host or 'localhost',
                        target_host=env_site.db_host or 'localhost',
                        source_user=prod_site.db_user,
                        target_user=env_site.db_user,
                        source_password=cls._get_db_password_from_config(prod_site),
                        target_password=cls._get_db_password_from_config(env_site),
                        options=clone_options,
                    )

                if not clone_result['success']:
                    cls._unlock_environment(env_site)
                    cls._finish_activity(activity, 'failed', clone_result.get('error'), start_time)
                    return clone_result

            cls._emit_progress(progress_callback, 4, 5, 'Syncing files...')

            # Sync files
            if sync_type in ('files', 'full'):
                prod_app = prod_site.application
                env_app = env_site.application

                if prod_app and env_app and prod_app.root_path and env_app.root_path:
                    prod_wp_dir = prod_app.root_path
                    env_wp_dir = os.path.join(env_app.root_path, 'wordpress') if env_compose_path else env_app.root_path

                    files_result = cls._sync_wordpress_files(prod_wp_dir, env_wp_dir)
                    if not files_result['success']:
                        cls._unlock_environment(env_site)
                        cls._finish_activity(activity, 'failed', files_result.get('error'), start_time)
                        return files_result

            cls._emit_progress(progress_callback, 5, 5, 'Complete')

            # Update timestamp
            env_site.updated_at = datetime.utcnow()
            db.session.commit()

            cls._unlock_environment(env_site)
            cls._finish_activity(activity, 'completed', None, start_time, {
                'sync_type': sync_type,
                'pre_sync_snapshot': pre_sync_snapshot_path,
            })

            cls._send_notification('Sync Completed', {
                'message': f'Environment synced from production ({sync_type})',
                'sync_type': sync_type,
            }, user_id)

            return {
                'success': True,
                'message': f'Environment synced from production ({sync_type})',
                'pre_sync_snapshot': pre_sync_snapshot_path,
            }

        except Exception as e:
            cls._unlock_environment(env_site)
            cls._finish_activity(activity, 'failed', str(e), start_time)
            return {'success': False, 'error': str(e)}

    # ==================== CODE PROMOTION ====================

    @classmethod
    def promote_code(cls, source_site_id: int, target_site_id: int,
                      config: Dict = None, user_id: int = None,
                      progress_callback=None) -> Dict:
        """
        Promote code (wp-content: themes, plugins, mu-plugins) from source to target.

        Uses rsync to selectively copy WordPress code files upstream.

        Args:
            source_site_id: ID of the source WordPressSite
            target_site_id: ID of the target WordPressSite
            config: Promotion config:
                - include_plugins: bool (default True)
                - include_themes: bool (default True)
                - include_mu_plugins: bool (default True)
                - include_uploads: bool (default False)
                - backup_target_first: bool (default True)
            user_id: ID of the user performing the promotion

        Returns:
            Dict with success status and promotion job details
        """
        config = config or {}

        source_site = WordPressSite.query.get(source_site_id)
        target_site = WordPressSite.query.get(target_site_id)

        if not source_site or not target_site:
            return {'success': False, 'error': 'Source or target site not found'}

        # Check locks
        for site, label in [(source_site, 'Source'), (target_site, 'Target')]:
            if site.is_locked:
                return {'success': False, 'error': f'{label} environment is locked: {site.locked_reason}'}

        start_time = time.time()

        # Create PromotionJob
        job = PromotionJob(
            source_site_id=source_site_id,
            target_site_id=target_site_id,
            user_id=user_id,
            promotion_type='code',
            config=json.dumps(config),
            status='running',
            started_at=datetime.utcnow(),
        )
        db.session.add(job)
        db.session.flush()

        activity = cls._create_activity(
            site_id=target_site_id,
            user_id=user_id,
            action='promoted_code',
            description=f'Code promotion from {source_site.environment_type} to {target_site.environment_type}',
            status='running'
        )

        # Lock both environments
        cls._lock_environment(source_site, 'Code promotion in progress (source)', user_id)
        cls._lock_environment(target_site, 'Code promotion in progress (target)', user_id)

        try:
            source_app = source_site.application
            target_app = target_site.application

            if not source_app or not target_app:
                raise ValueError('Source or target application record not found')

            source_compose = cls._get_compose_path(source_site)
            target_compose = cls._get_compose_path(target_site)

            # Determine WordPress file paths
            source_wp_dir = os.path.join(source_app.root_path, 'wordpress') if source_compose else source_app.root_path
            target_wp_dir = os.path.join(target_app.root_path, 'wordpress') if target_compose else target_app.root_path

            if not os.path.exists(source_wp_dir):
                raise ValueError(f'Source WordPress directory not found: {source_wp_dir}')

            cls._emit_progress(progress_callback, 1, 5, 'Locking environments...')

            # Step 1: Backup target wp-content if requested
            pre_snapshot_id = None
            if config.get('backup_target_first', True) and target_compose:
                cls._emit_progress(progress_callback, 2, 5, 'Creating pre-promotion snapshot...')
                target_vars = cls._read_env_vars(target_site)
                snapshot_result = DatabaseSyncService.export_from_container(
                    compose_path=target_compose,
                    db_name=target_site.db_name,
                    db_user=target_vars.get('DB_USER', target_site.db_user),
                    db_password=target_vars.get('DB_PASSWORD'),
                )
                if snapshot_result['success']:
                    # Save snapshot record
                    snapshot_record = DatabaseSnapshot(
                        site_id=target_site_id,
                        name=f'pre-promotion-{datetime.now().strftime("%Y%m%d_%H%M%S")}',
                        tag='pre-promotion',
                        file_path=snapshot_result['file_path'],
                        size_bytes=snapshot_result['size_bytes'],
                        compressed=snapshot_result['compressed'],
                        status='completed',
                    )
                    db.session.add(snapshot_record)
                    db.session.flush()
                    pre_snapshot_id = snapshot_record.id
                    job.pre_promotion_snapshot_id = pre_snapshot_id

            cls._emit_progress(progress_callback, 3, 5, 'Syncing code files...')

            # Step 2: Rsync wp-content directories
            sync_paths = []
            if config.get('include_plugins', True):
                sync_paths.append('wp-content/plugins/')
            if config.get('include_themes', True):
                sync_paths.append('wp-content/themes/')
            if config.get('include_mu_plugins', True):
                sync_paths.append('wp-content/mu-plugins/')
            if config.get('include_uploads', False):
                sync_paths.append('wp-content/uploads/')

            for rel_path in sync_paths:
                source_path = os.path.join(source_wp_dir, rel_path)
                target_path = os.path.join(target_wp_dir, rel_path)

                if not os.path.exists(source_path):
                    continue

                os.makedirs(target_path, exist_ok=True)

                rsync_result = cls._rsync_directory(source_path, target_path)
                if not rsync_result['success']:
                    raise ValueError(f'rsync failed for {rel_path}: {rsync_result.get("error")}')

            cls._emit_progress(progress_callback, 4, 5, 'Flushing caches...')

            # Step 3: Flush caches on target (if containers are running)
            if target_compose:
                EnvironmentDockerService.exec_in_container(
                    target_compose, 'wordpress',
                    'wp cache flush --allow-root'
                )

            # Step 4: Search-replace for domain differences
            target_domain = cls._get_primary_domain(target_site)
            source_domain = cls._get_primary_domain(source_site)
            if source_domain and target_domain and source_domain != target_domain:
                # Domain replacement only needed if wp-config has hardcoded URLs
                pass  # wp-config handles this via WP_HOME/WP_SITEURL

            # Complete promotion job
            job.status = 'completed'
            job.completed_at = datetime.utcnow()
            job.duration_seconds = time.time() - start_time
            db.session.commit()

            cls._emit_progress(progress_callback, 5, 5, 'Complete')

            cls._unlock_environment(source_site)
            cls._unlock_environment(target_site)
            cls._finish_activity(activity, 'completed', None, start_time, {
                'promotion_job_id': job.id,
                'paths_synced': sync_paths,
                'pre_promotion_snapshot_id': pre_snapshot_id,
            })

            cls._send_notification('Code Promoted', {
                'message': f'Code promoted from {source_site.environment_type} to {target_site.environment_type}',
                'source': source_site.environment_type,
                'target': target_site.environment_type,
            }, user_id)

            return {
                'success': True,
                'message': f'Code promoted from {source_site.environment_type} to {target_site.environment_type}',
                'promotion_job': job.to_dict(),
            }

        except Exception as e:
            job.status = 'failed'
            job.error_message = str(e)
            job.completed_at = datetime.utcnow()
            job.duration_seconds = time.time() - start_time
            db.session.commit()

            cls._unlock_environment(source_site)
            cls._unlock_environment(target_site)
            cls._finish_activity(activity, 'failed', str(e), start_time)
            return {'success': False, 'error': str(e)}

    # ==================== DATABASE PROMOTION ====================

    @classmethod
    def promote_database(cls, source_site_id: int, target_site_id: int,
                          config: Dict = None, user_id: int = None,
                          progress_callback=None) -> Dict:
        """
        Promote database from source environment to target.

        Exports source DB, applies transformations (search-replace, sanitization),
        and imports into target. Creates a pre-promotion snapshot of target for safety.

        Args:
            source_site_id: ID of the source WordPressSite
            target_site_id: ID of the target WordPressSite
            config: Promotion config:
                - search_replace: Additional search/replace pairs
                - sanitize: Whether to anonymize user data
                - truncate_tables: Tables to empty
                - exclude_tables: Tables to skip
                - backup_target_first: bool (default True)
            user_id: ID of the user performing the promotion

        Returns:
            Dict with success status and promotion job details
        """
        config = config or {}

        source_site = WordPressSite.query.get(source_site_id)
        target_site = WordPressSite.query.get(target_site_id)

        if not source_site or not target_site:
            return {'success': False, 'error': 'Source or target site not found'}

        # Check locks
        for site, label in [(source_site, 'Source'), (target_site, 'Target')]:
            if site.is_locked:
                return {'success': False, 'error': f'{label} environment is locked: {site.locked_reason}'}

        start_time = time.time()

        job = PromotionJob(
            source_site_id=source_site_id,
            target_site_id=target_site_id,
            user_id=user_id,
            promotion_type='database',
            config=json.dumps(config),
            status='running',
            started_at=datetime.utcnow(),
        )
        db.session.add(job)
        db.session.flush()

        activity = cls._create_activity(
            site_id=target_site_id,
            user_id=user_id,
            action='promoted_database',
            description=f'Database promotion from {source_site.environment_type} to {target_site.environment_type}',
            status='running'
        )

        # Lock target
        cls._lock_environment(target_site, 'Database promotion in progress', user_id)
        cls._emit_progress(progress_callback, 1, 5, 'Locking environments...')

        try:
            source_compose = cls._get_compose_path(source_site)
            target_compose = cls._get_compose_path(target_site)

            cls._emit_progress(progress_callback, 2, 5, 'Creating pre-promotion snapshot...')

            # Step 1: Backup target DB
            pre_snapshot_id = None
            if config.get('backup_target_first', True):
                if target_compose:
                    target_vars = cls._read_env_vars(target_site)
                    snapshot_result = DatabaseSyncService.export_from_container(
                        compose_path=target_compose,
                        db_name=target_site.db_name,
                        db_user=target_vars.get('DB_USER', target_site.db_user),
                        db_password=target_vars.get('DB_PASSWORD'),
                    )
                else:
                    snapshot_result = DatabaseSyncService.create_snapshot(
                        db_name=target_site.db_name,
                        name=f'pre-promotion-{datetime.now().strftime("%Y%m%d_%H%M%S")}',
                        tag='pre-promotion',
                        host=target_site.db_host or 'localhost',
                        user=target_site.db_user,
                        password=cls._get_db_password_from_config(target_site),
                    )

                if snapshot_result['success']:
                    file_path = snapshot_result.get('file_path') or snapshot_result.get('snapshot', {}).get('file_path')
                    size_bytes = snapshot_result.get('size_bytes') or snapshot_result.get('snapshot', {}).get('size_bytes', 0)

                    snapshot_record = DatabaseSnapshot(
                        site_id=target_site_id,
                        name=f'pre-promotion-{datetime.now().strftime("%Y%m%d_%H%M%S")}',
                        tag='pre-promotion',
                        file_path=file_path,
                        size_bytes=size_bytes,
                        compressed=snapshot_result.get('compressed', True),
                        status='completed',
                    )
                    db.session.add(snapshot_record)
                    db.session.flush()
                    pre_snapshot_id = snapshot_record.id
                    job.pre_promotion_snapshot_id = pre_snapshot_id

            cls._emit_progress(progress_callback, 3, 5, 'Cloning database with transformations...')

            # Step 2: Clone DB with transformations
            clone_options = {
                'search_replace': config.get('search_replace', {}),
                'truncate_tables': config.get('truncate_tables', []),
                'exclude_tables': config.get('exclude_tables', []),
                'anonymize': config.get('sanitize', False),
            }

            # Auto-add domain search-replace
            source_domain = cls._get_primary_domain(source_site)
            target_domain = cls._get_primary_domain(target_site)
            if source_domain and target_domain and source_domain != target_domain:
                clone_options['search_replace'].update({
                    f'https://{source_domain}': f'https://{target_domain}',
                    f'http://{source_domain}': f'http://{target_domain}',
                    source_domain: target_domain,
                })

            if source_compose and target_compose:
                clone_result = DatabaseSyncService.clone_between_containers(
                    source_compose_path=source_compose,
                    target_compose_path=target_compose,
                    source_db=source_site.db_name,
                    target_db=target_site.db_name,
                    source_user=source_site.db_user,
                    target_user=target_site.db_user,
                    source_password=cls._get_env_password(source_site),
                    target_password=cls._get_env_password(target_site),
                    options=clone_options,
                )
            else:
                clone_result = DatabaseSyncService.clone_database(
                    source_db=source_site.db_name,
                    target_db=target_site.db_name,
                    source_host=source_site.db_host or 'localhost',
                    target_host=target_site.db_host or 'localhost',
                    source_user=source_site.db_user,
                    target_user=target_site.db_user,
                    source_password=cls._get_db_password_from_config(source_site),
                    target_password=cls._get_db_password_from_config(target_site),
                    options=clone_options,
                )

            if not clone_result['success']:
                raise ValueError(f"Database clone failed: {clone_result.get('error')}")

            cls._emit_progress(progress_callback, 4, 5, 'Flushing caches...')

            # Step 3: Flush caches
            if target_compose:
                EnvironmentDockerService.exec_in_container(
                    target_compose, 'wordpress',
                    'wp cache flush --allow-root'
                )

            cls._emit_progress(progress_callback, 5, 5, 'Complete')

            # Complete
            job.status = 'completed'
            job.completed_at = datetime.utcnow()
            job.duration_seconds = time.time() - start_time
            db.session.commit()

            cls._unlock_environment(target_site)
            cls._finish_activity(activity, 'completed', None, start_time, {
                'promotion_job_id': job.id,
                'pre_promotion_snapshot_id': pre_snapshot_id,
            })

            cls._send_notification('Database Promoted', {
                'message': f'Database promoted from {source_site.environment_type} to {target_site.environment_type}',
                'source': source_site.environment_type,
                'target': target_site.environment_type,
            }, user_id)

            return {
                'success': True,
                'message': f'Database promoted from {source_site.environment_type} to {target_site.environment_type}',
                'promotion_job': job.to_dict(),
            }

        except Exception as e:
            job.status = 'failed'
            job.error_message = str(e)
            job.completed_at = datetime.utcnow()
            job.duration_seconds = time.time() - start_time
            db.session.commit()

            cls._unlock_environment(target_site)
            cls._finish_activity(activity, 'failed', str(e), start_time)
            return {'success': False, 'error': str(e)}

    # ==================== FULL PROMOTION ====================

    @classmethod
    def promote_full(cls, source_site_id: int, target_site_id: int,
                      config: Dict = None, user_id: int = None,
                      progress_callback=None) -> Dict:
        """
        Promote both code and database from source to target.

        Runs promote_code followed by promote_database sequentially.

        Args:
            source_site_id: ID of the source WordPressSite
            target_site_id: ID of the target WordPressSite
            config: Combined promotion config
            user_id: ID of the user performing the promotion

        Returns:
            Dict with success status and both promotion results
        """
        config = config or {}

        # Promote code first
        code_result = cls.promote_code(
            source_site_id=source_site_id,
            target_site_id=target_site_id,
            config=config,
            user_id=user_id,
            progress_callback=progress_callback
        )

        if not code_result['success']:
            return {
                'success': False,
                'error': f"Code promotion failed: {code_result.get('error')}",
                'code_result': code_result,
                'db_result': None,
            }

        # Then promote database
        db_result = cls.promote_database(
            source_site_id=source_site_id,
            target_site_id=target_site_id,
            config=config,
            user_id=user_id,
            progress_callback=progress_callback
        )

        if not db_result['success']:
            return {
                'success': False,
                'error': f"Database promotion failed (code was promoted): {db_result.get('error')}",
                'code_result': code_result,
                'db_result': db_result,
            }

        cls._send_notification('Full Promotion Completed', {
            'message': 'Full promotion completed (code + database)',
        }, user_id)

        return {
            'success': True,
            'message': 'Full promotion completed (code + database)',
            'code_result': code_result,
            'db_result': db_result,
        }

    # ==================== ENVIRONMENT LOCKING ====================

    @classmethod
    def lock_environment(cls, site_id: int, reason: str,
                          user_id: int = None, duration_minutes: int = 30) -> Dict:
        """
        Lock an environment to prevent concurrent operations.

        Args:
            site_id: WordPressSite ID
            reason: Why it's being locked
            user_id: Who is locking it
            duration_minutes: Auto-unlock after this many minutes

        Returns:
            Dict with success status
        """
        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        if site.is_locked:
            return {'success': False, 'error': f'Already locked: {site.locked_reason}'}

        cls._lock_environment(site, reason, user_id, duration_minutes)

        cls._create_activity(
            site_id=site_id,
            user_id=user_id,
            action='locked',
            description=f'Environment locked: {reason}',
            status='completed',
            metadata={'reason': reason, 'duration_minutes': duration_minutes}
        )

        return {'success': True, 'message': f'Environment locked: {reason}'}

    @classmethod
    def unlock_environment(cls, site_id: int, user_id: int = None) -> Dict:
        """
        Unlock an environment.

        Args:
            site_id: WordPressSite ID
            user_id: Who is unlocking it

        Returns:
            Dict with success status
        """
        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        if not site.is_locked:
            return {'success': True, 'message': 'Environment was not locked'}

        cls._unlock_environment(site)

        cls._create_activity(
            site_id=site_id,
            user_id=user_id,
            action='unlocked',
            description='Environment unlocked',
            status='completed'
        )

        return {'success': True, 'message': 'Environment unlocked'}

    # ==================== PIPELINE STATUS ====================

    @classmethod
    def get_pipeline_status(cls, production_site_id: int) -> Dict:
        """
        Get full pipeline status for a WordPress project.

        Returns all environments with their status, last sync, last promotion,
        container health, and activity counts.

        Args:
            production_site_id: ID of the production WordPressSite

        Returns:
            Dict with production info and all environment statuses
        """
        prod_site = WordPressSite.query.get(production_site_id)
        if not prod_site:
            return {'success': False, 'error': 'Production site not found'}

        prod_data = prod_site.to_dict()

        # Get container status for production
        prod_compose = cls._get_compose_path(prod_site)
        if prod_compose:
            prod_data['container_status'] = EnvironmentDockerService.get_environment_status(prod_compose)

        # Get all child environments
        environments = []
        for env in prod_site.environments:
            env_data = env.to_dict()

            # Container status
            env_compose = cls._get_compose_path(env)
            if env_compose:
                env_data['container_status'] = EnvironmentDockerService.get_environment_status(env_compose)

            # Last promotion (as target)
            last_promotion = PromotionJob.query.filter_by(
                target_site_id=env.id
            ).order_by(PromotionJob.created_at.desc()).first()
            if last_promotion:
                env_data['last_promotion'] = {
                    'id': last_promotion.id,
                    'type': last_promotion.promotion_type,
                    'status': last_promotion.status,
                    'created_at': last_promotion.created_at.isoformat() if last_promotion.created_at else None,
                }

            # Recent activity count
            recent_cutoff = datetime.utcnow() - timedelta(days=7)
            env_data['recent_activity_count'] = EnvironmentActivity.query.filter(
                EnvironmentActivity.site_id == env.id,
                EnvironmentActivity.created_at >= recent_cutoff
            ).count()

            environments.append(env_data)

        # Sort: staging first, then development, then multidevs
        type_order = {'staging': 0, 'development': 1, 'multidev': 2}
        environments.sort(key=lambda e: type_order.get(e.get('environment_type', ''), 3))

        return {
            'success': True,
            'production': prod_data,
            'environments': environments,
            'total_environments': len(environments),
        }

    # ==================== ENVIRONMENT COMPARISON ====================

    @classmethod
    def compare_environments(cls, site_id_a: int, site_id_b: int) -> Dict:
        """
        Compare two environments (plugins, themes, WP version, PHP version).

        Args:
            site_id_a: First WordPressSite ID
            site_id_b: Second WordPressSite ID

        Returns:
            Dict with comparison data (differences and matches)
        """
        site_a = WordPressSite.query.get(site_id_a)
        site_b = WordPressSite.query.get(site_id_b)

        if not site_a or not site_b:
            return {'success': False, 'error': 'One or both sites not found'}

        comparison = {
            'site_a': {'id': site_a.id, 'type': site_a.environment_type},
            'site_b': {'id': site_b.id, 'type': site_b.environment_type},
            'differences': [],
            'matches': [],
        }

        # Compare basic fields
        for field, label in [
            ('wp_version', 'WordPress Version'),
            ('db_prefix', 'Table Prefix'),
            ('multisite', 'Multisite'),
        ]:
            val_a = getattr(site_a, field)
            val_b = getattr(site_b, field)
            entry = {'field': label, 'a': str(val_a), 'b': str(val_b)}
            if val_a != val_b:
                comparison['differences'].append(entry)
            else:
                comparison['matches'].append(entry)

        # Compare PHP versions
        app_a = site_a.application
        app_b = site_b.application
        if app_a and app_b:
            if app_a.php_version != app_b.php_version:
                comparison['differences'].append({
                    'field': 'PHP Version',
                    'a': app_a.php_version or 'default',
                    'b': app_b.php_version or 'default',
                })
            else:
                comparison['matches'].append({
                    'field': 'PHP Version',
                    'a': app_a.php_version or 'default',
                    'b': app_b.php_version or 'default',
                })

        # Compare plugins via WP-CLI (if containers are running)
        compose_a = cls._get_compose_path(site_a)
        compose_b = cls._get_compose_path(site_b)

        if compose_a and compose_b:
            plugins_a = cls._get_wp_plugins(compose_a)
            plugins_b = cls._get_wp_plugins(compose_b)

            if plugins_a is not None and plugins_b is not None:
                all_plugins = set(list(plugins_a.keys()) + list(plugins_b.keys()))
                plugin_diffs = []
                plugin_matches = []

                for plugin in sorted(all_plugins):
                    ver_a = plugins_a.get(plugin, 'not installed')
                    ver_b = plugins_b.get(plugin, 'not installed')
                    entry = {'plugin': plugin, 'a': ver_a, 'b': ver_b}
                    if ver_a != ver_b:
                        plugin_diffs.append(entry)
                    else:
                        plugin_matches.append(entry)

                comparison['plugin_differences'] = plugin_diffs
                comparison['plugin_matches'] = plugin_matches

        comparison['success'] = True
        return comparison

    # ==================== DELETE ENVIRONMENT ====================

    @classmethod
    def delete_environment(cls, env_site_id: int, user_id: int = None) -> Dict:
        """
        Delete an environment and all its resources.

        Stops containers, removes Docker stack, deletes files, Nginx config,
        and database records.

        Args:
            env_site_id: ID of the environment's WordPressSite
            user_id: ID of the user deleting the environment

        Returns:
            Dict with success status
        """
        env_site = WordPressSite.query.get(env_site_id)
        if not env_site:
            return {'success': False, 'error': 'Environment not found'}

        if env_site.is_production or env_site.environment_type == 'production':
            return {'success': False, 'error': 'Cannot delete a production environment'}

        if env_site.is_locked:
            return {'success': False, 'error': f'Environment is locked: {env_site.locked_reason}'}

        start_time = time.time()
        activity = cls._create_activity(
            site_id=env_site.production_site_id or env_site_id,
            user_id=user_id,
            action='environment_deleted',
            description=f'Deleting {env_site.environment_type} environment',
            status='running'
        )

        try:
            env_app = env_site.application

            # Step 1: Stop and destroy Docker containers
            compose_path = cls._get_compose_path(env_site)
            if compose_path and os.path.exists(compose_path):
                EnvironmentDockerService.destroy_environment(compose_path, remove_volumes=True)

            # Step 2: Remove Nginx config
            if env_site.compose_project_name and env_site.container_prefix:
                site_name = f'wp-{env_site.container_prefix}'
                EnvironmentDomainService.remove_nginx_config(site_name)

            # Step 3: Delete related records
            # Delete promotions involving this site
            PromotionJob.query.filter(
                (PromotionJob.source_site_id == env_site_id) |
                (PromotionJob.target_site_id == env_site_id)
            ).delete(synchronize_session='fetch')

            # Delete activities for this site
            EnvironmentActivity.query.filter_by(site_id=env_site_id).delete(synchronize_session='fetch')

            # Delete snapshots
            for snapshot in env_site.snapshots:
                if snapshot.file_path and os.path.exists(snapshot.file_path):
                    os.remove(snapshot.file_path)

            # Step 4: Delete WordPressSite and Application records
            db.session.delete(env_site)
            if env_app:
                db.session.delete(env_app)

            db.session.commit()

            cls._finish_activity(activity, 'completed', None, start_time, {
                'deleted_site_id': env_site_id,
            })

            return {'success': True, 'message': 'Environment deleted successfully'}

        except Exception as e:
            db.session.rollback()
            cls._finish_activity(activity, 'failed', str(e), start_time)
            return {'success': False, 'error': str(e)}

    # ==================== MULTIDEV CLEANUP ====================

    @classmethod
    def cleanup_stale_multidevs(cls, production_site_id: int,
                                 dry_run: bool = True,
                                 user_id: int = None) -> Dict:
        """
        Find and optionally delete multidev environments whose branches
        no longer exist on the remote.

        Args:
            production_site_id: ID of the production WordPressSite
            dry_run: If True, only report stale envs without deleting
            user_id: ID of the user performing the cleanup

        Returns:
            Dict with list of stale environments and cleanup results
        """
        from app.services.git_wordpress_service import GitWordPressService

        prod_site = WordPressSite.query.get(production_site_id)
        if not prod_site:
            return {'success': False, 'error': 'Production site not found'}

        if not prod_site.git_repo_url:
            return {'success': False, 'error': 'No repository connected to production site'}

        # Get current remote branches
        branches_result = GitWordPressService.list_branches(production_site_id)
        if not branches_result.get('success'):
            return {'success': False, 'error': f"Failed to list branches: {branches_result.get('error')}"}

        remote_branches = {b['name'] for b in branches_result.get('branches', [])}

        # Find multidev environments with missing branches
        multidev_envs = WordPressSite.query.filter_by(
            production_site_id=production_site_id,
            environment_type='multidev'
        ).all()

        stale = []
        cleaned = []
        errors = []

        for env in multidev_envs:
            if env.multidev_branch and env.multidev_branch not in remote_branches:
                stale.append({
                    'id': env.id,
                    'name': env.application.name if env.application else f'env-{env.id}',
                    'branch': env.multidev_branch,
                    'created_at': env.created_at.isoformat() if env.created_at else None,
                })

                if not dry_run:
                    result = cls.delete_environment(env.id, user_id=user_id)
                    if result.get('success'):
                        cleaned.append(env.id)
                    else:
                        errors.append({
                            'id': env.id,
                            'error': result.get('error')
                        })

        return {
            'success': True,
            'dry_run': dry_run,
            'stale_environments': stale,
            'stale_count': len(stale),
            'cleaned_count': len(cleaned),
            'errors': errors,
        }

    # ==================== PRIVATE HELPERS ====================

    @classmethod
    def _get_compose_path(cls, site: WordPressSite) -> Optional[str]:
        """Get the docker-compose.yml path for a site's environment."""
        if not site.compose_project_name or not site.container_prefix:
            return None

        # Determine env type directory from container_prefix
        project_name = site.compose_project_name
        prefix = site.container_prefix
        env_type_dir = prefix.replace(f'{project_name}-', '', 1) if prefix.startswith(project_name) else prefix

        compose_path = os.path.join(
            EnvironmentDockerService.get_env_directory(project_name, env_type_dir),
            'docker-compose.yml'
        )

        if os.path.exists(compose_path):
            return compose_path
        return None

    @classmethod
    def _get_env_password(cls, site: WordPressSite) -> Optional[str]:
        """Get the DB password from a site's Docker .env file."""
        compose_path = cls._get_compose_path(site)
        if not compose_path:
            return cls._get_db_password_from_config(site)

        env_file = os.path.join(os.path.dirname(compose_path), '.env')
        if os.path.exists(env_file):
            try:
                with open(env_file, 'r') as f:
                    for line in f:
                        if line.startswith('DB_PASSWORD='):
                            return line.strip().split('=', 1)[1]
            except Exception:
                pass

        return cls._get_db_password_from_config(site)

    @classmethod
    def _read_env_vars(cls, site: WordPressSite) -> Dict:
        """Read all env vars from a site's Docker .env file."""
        compose_path = cls._get_compose_path(site)
        if not compose_path:
            return {}

        env_file = os.path.join(os.path.dirname(compose_path), '.env')
        env_vars = {}
        if os.path.exists(env_file):
            try:
                with open(env_file, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if '=' in line and not line.startswith('#'):
                            key, value = line.split('=', 1)
                            env_vars[key] = value
            except Exception:
                pass
        return env_vars

    @classmethod
    def _get_db_password_from_config(cls, site: WordPressSite) -> Optional[str]:
        """Get database password from wp-config.php."""
        if not site.application or not site.application.root_path:
            return None

        config_path = os.path.join(site.application.root_path, 'wp-config.php')
        if not os.path.exists(config_path):
            return None

        try:
            import re
            with open(config_path, 'r') as f:
                content = f.read()
            match = re.search(r"define\s*\(\s*['\"]DB_PASSWORD['\"]\s*,\s*['\"]([^'\"]*)['\"]", content)
            return match.group(1) if match else None
        except Exception:
            return None

    @classmethod
    def _get_primary_domain(cls, site: WordPressSite) -> Optional[str]:
        """Get the primary domain for a site."""
        if not site.application:
            return None
        domains = list(site.application.domains)
        if domains:
            return domains[0].domain
        return None

    @classmethod
    def _lock_environment(cls, site: WordPressSite, reason: str,
                           user_id: int = None, duration_minutes: int = 30):
        """Lock an environment (internal helper, no activity log)."""
        site.is_locked = True
        site.locked_by = str(user_id) if user_id else 'system'
        site.locked_reason = reason
        site.lock_expires_at = datetime.utcnow() + timedelta(minutes=duration_minutes)
        db.session.commit()

    @classmethod
    def _unlock_environment(cls, site: WordPressSite):
        """Unlock an environment (internal helper, no activity log)."""
        site.is_locked = False
        site.locked_by = None
        site.locked_reason = None
        site.lock_expires_at = None
        db.session.commit()

    @classmethod
    def _create_activity(cls, site_id: int, user_id: int, action: str,
                          description: str, status: str = 'completed',
                          metadata: Dict = None) -> EnvironmentActivity:
        """Create an activity log entry."""
        activity = EnvironmentActivity(
            site_id=site_id,
            user_id=user_id,
            action=action,
            description=description,
            status=status,
            activity_metadata=json.dumps(metadata) if metadata else None,
            created_at=datetime.utcnow(),
        )
        db.session.add(activity)
        db.session.flush()
        return activity

    @classmethod
    def _finish_activity(cls, activity: EnvironmentActivity, status: str,
                          error: str = None, start_time: float = None,
                          metadata: Dict = None):
        """Finish an activity log entry."""
        activity.status = status
        activity.error_message = error
        if start_time:
            activity.duration_seconds = time.time() - start_time
        if metadata:
            existing = json.loads(activity.activity_metadata) if activity.activity_metadata else {}
            existing.update(metadata)
            activity.activity_metadata = json.dumps(existing)
        db.session.commit()

    @classmethod
    def _copy_wordpress_files(cls, source_dir: str, target_dir: str) -> Dict:
        """Copy WordPress files from source to target directory."""
        try:
            if os.path.exists(target_dir):
                shutil.rmtree(target_dir)

            shutil.copytree(source_dir, target_dir)

            # Set permissions
            subprocess.run(
                ['sudo', 'chown', '-R', 'www-data:www-data', target_dir],
                capture_output=True, timeout=60
            )

            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': f'Failed to copy files: {str(e)}'}

    @classmethod
    def _sync_wordpress_files(cls, source_dir: str, target_dir: str) -> Dict:
        """Sync WordPress files using rsync (more efficient than full copy)."""
        try:
            result = subprocess.run(
                [
                    'rsync', '-a', '--delete',
                    '--exclude', '.git',
                    '--exclude', 'wp-config.php',
                    '--exclude', '.env',
                    f'{source_dir}/',
                    f'{target_dir}/'
                ],
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode != 0:
                return {'success': False, 'error': f'rsync failed: {result.stderr}'}

            return {'success': True}
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'File sync timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _rsync_directory(cls, source: str, target: str) -> Dict:
        """Rsync a single directory from source to target."""
        try:
            os.makedirs(target, exist_ok=True)

            result = subprocess.run(
                [
                    'rsync', '-a', '--delete',
                    '--exclude', '.git',
                    f'{source}',
                    f'{target}'
                ],
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            return {'success': True}
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'rsync timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _wait_for_mysql(cls, compose_path: str, db_user: str, db_password: str,
                         max_attempts: int = 30, interval: int = 2):
        """Wait for MySQL to be ready inside the container."""
        for attempt in range(max_attempts):
            result = EnvironmentDockerService.exec_in_container(
                compose_path, 'db',
                f'mysqladmin -u {db_user} -p{db_password} ping'
            )
            if result.get('success'):
                return True
            time.sleep(interval)

        return False

    @classmethod
    def _get_wp_plugins(cls, compose_path: str) -> Optional[Dict]:
        """Get installed plugins and versions via WP-CLI."""
        result = EnvironmentDockerService.exec_in_container(
            compose_path, 'wordpress',
            'wp plugin list --format=json --allow-root'
        )

        if not result.get('success'):
            return None

        try:
            plugins_list = json.loads(result['output'])
            return {p['name']: p.get('version', 'unknown') for p in plugins_list}
        except (json.JSONDecodeError, KeyError):
            return None

    @staticmethod
    def _slugify(text: str) -> str:
        """Convert text to a URL/filesystem-safe slug."""
        import re
        text = text.lower()
        text = re.sub(r'[^a-z0-9]+', '-', text)
        text = text.strip('-')
        return text or 'site'

    @staticmethod
    def _generate_password(length: int = 32) -> str:
        """Generate a secure random password."""
        chars = string.ascii_letters + string.digits
        return ''.join(secrets.choice(chars) for _ in range(length))
