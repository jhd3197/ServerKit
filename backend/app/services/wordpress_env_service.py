"""
WordPress Environment Service

Manage WordPress production/development/staging environments.
Handles environment creation, database cloning, and synchronization.
"""

import os
import json
import secrets
import string
import shutil
from datetime import datetime
from typing import Dict, List, Optional

from app import db
from app.models.application import Application
from app.models.wordpress_site import WordPressSite, DatabaseSnapshot, SyncJob
from app.services.db_sync_service import DatabaseSyncService
from app.services.wordpress_service import WordPressService
from app.services.database_service import DatabaseService


class WordPressEnvService:
    """Manage WordPress production/development/staging environments."""

    @classmethod
    def create_environment(cls, production_site_id: int, env_type: str,
                           config: Dict, user_id: int) -> Dict:
        """
        Create a new environment linked to production.

        Args:
            production_site_id: ID of the production WordPressSite
            env_type: 'development' or 'staging'
            config: Dict with:
                - name: Environment name (e.g., 'My Site Dev')
                - domain: Domain for the environment (e.g., 'dev.mysite.com')
                - port: Optional custom port
                - clone_db: Whether to clone the production database
                - sync_schedule: Optional cron schedule for auto-sync
            user_id: User ID creating the environment

        Returns:
            Dict with success status and environment info
        """
        # Validate environment type
        if env_type not in ['development', 'staging']:
            return {'success': False, 'error': 'Invalid environment type. Must be development or staging.'}

        # Get production site
        prod_site = WordPressSite.query.get(production_site_id)
        if not prod_site:
            return {'success': False, 'error': 'Production site not found'}

        if not prod_site.is_production:
            return {'success': False, 'error': 'Source site is not a production site'}

        prod_app = prod_site.application
        if not prod_app:
            return {'success': False, 'error': 'Production application not found'}

        try:
            # Generate names
            env_name = config.get('name', f"{prod_app.name} ({env_type.title()})")
            env_domain = config.get('domain')

            # Generate unique database name and prefix
            short_id = secrets.token_hex(4)
            env_db_name = f"{prod_site.db_name}_{env_type[:3]}_{short_id}"
            env_db_prefix = f"wp_{env_type[:3]}_"

            # Determine root path for new environment
            prod_path = prod_app.root_path
            base_path = os.path.dirname(prod_path)
            env_path = os.path.join(base_path, f"{os.path.basename(prod_path)}_{env_type}")

            # Step 1: Clone the database if requested
            if config.get('clone_db', True):
                # First create a snapshot
                snapshot_result = DatabaseSyncService.create_snapshot(
                    db_name=prod_site.db_name,
                    name=f"pre_env_create_{env_type}",
                    tag=f"env-create-{env_type}",
                    host=prod_site.db_host,
                    user=prod_site.db_user,
                    password=cls._get_db_password(prod_site)
                )

                if not snapshot_result['success']:
                    return {'success': False, 'error': f"Failed to create snapshot: {snapshot_result.get('error')}"}

                # Clone with transformations
                clone_options = {
                    'table_prefix': env_db_prefix,
                    'truncate_tables': config.get('truncate_tables', [
                        'actionscheduler_actions',
                        'actionscheduler_logs',
                    ])
                }

                # Add search-replace for domain if provided
                if env_domain and prod_app.domains:
                    prod_domain = prod_app.domains[0].domain if prod_app.domains else None
                    if prod_domain:
                        clone_options['search_replace'] = {
                            f'https://{prod_domain}': f'https://{env_domain}',
                            f'http://{prod_domain}': f'http://{env_domain}',
                            prod_domain: env_domain
                        }

                clone_result = DatabaseSyncService.clone_database(
                    source_db=prod_site.db_name,
                    target_db=env_db_name,
                    source_host=prod_site.db_host,
                    target_host=prod_site.db_host,
                    source_user=prod_site.db_user,
                    target_user=prod_site.db_user,
                    source_password=cls._get_db_password(prod_site),
                    target_password=cls._get_db_password(prod_site),
                    options=clone_options
                )

                if not clone_result['success']:
                    return {'success': False, 'error': f"Failed to clone database: {clone_result.get('error')}"}

            # Step 2: Create the Application record
            env_app = Application(
                name=env_name,
                app_type='wordpress',
                status='deploying',
                php_version=prod_app.php_version,
                port=config.get('port'),
                root_path=env_path,
                environment_type=env_type,
                linked_app_id=prod_app.id,
                user_id=user_id
            )
            db.session.add(env_app)
            db.session.flush()  # Get the ID

            # Step 3: Create the WordPressSite record
            env_site = WordPressSite(
                application_id=env_app.id,
                wp_version=prod_site.wp_version,
                multisite=prod_site.multisite,
                admin_user=prod_site.admin_user,
                admin_email=prod_site.admin_email,
                db_name=env_db_name,
                db_user=prod_site.db_user,
                db_host=prod_site.db_host,
                db_prefix=env_db_prefix,
                git_repo_url=prod_site.git_repo_url,
                git_branch=config.get('git_branch', prod_site.git_branch),
                git_paths=prod_site.git_paths,
                auto_deploy=config.get('auto_deploy', False),
                is_production=False,
                production_site_id=production_site_id
            )
            db.session.add(env_site)

            # Step 4: Copy WordPress files
            copy_result = cls._copy_wordpress_files(prod_path, env_path)
            if not copy_result['success']:
                db.session.rollback()
                return copy_result

            # Step 5: Update wp-config.php for new environment
            config_result = cls._update_wp_config(
                env_path,
                db_name=env_db_name,
                db_prefix=env_db_prefix,
                site_url=f"https://{env_domain}" if env_domain else None
            )

            if not config_result['success']:
                db.session.rollback()
                return config_result

            # Step 6: Create sync job if schedule provided
            if config.get('sync_schedule'):
                sync_job = SyncJob(
                    source_site_id=production_site_id,
                    target_site_id=env_site.id,
                    name=f"Auto-sync {prod_app.name} to {env_name}",
                    schedule=config['sync_schedule'],
                    enabled=True,
                    config=json.dumps({
                        'search_replace': clone_options.get('search_replace', {}),
                        'truncate_tables': clone_options.get('truncate_tables', [])
                    })
                )
                db.session.add(sync_job)

            # Update application status
            env_app.status = 'running'

            db.session.commit()

            return {
                'success': True,
                'message': f'{env_type.title()} environment created successfully',
                'environment': env_site.to_dict(),
                'application': env_app.to_dict()
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def sync_environment(cls, env_site_id: int, options: Dict = None) -> Dict:
        """
        Sync an environment from its production source.

        Args:
            env_site_id: ID of the environment WordPressSite to sync
            options: Optional override options for sync

        Returns:
            Dict with success status
        """
        options = options or {}

        env_site = WordPressSite.query.get(env_site_id)
        if not env_site:
            return {'success': False, 'error': 'Environment not found'}

        if env_site.is_production:
            return {'success': False, 'error': 'Cannot sync a production site'}

        prod_site = env_site.production_site
        if not prod_site:
            return {'success': False, 'error': 'Production site not found'}

        try:
            # Get sync config
            sync_config = json.loads(env_site.sync_config) if env_site.sync_config else {}
            sync_config.update(options)

            # Create snapshot before sync
            snapshot_result = DatabaseSyncService.create_snapshot(
                db_name=env_site.db_name,
                name=f"pre_sync_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                tag='pre-sync',
                host=env_site.db_host,
                user=env_site.db_user,
                password=cls._get_db_password(env_site)
            )

            # Clone production to environment
            clone_options = {
                'table_prefix': env_site.db_prefix,
                'search_replace': sync_config.get('search_replace', {}),
                'truncate_tables': sync_config.get('truncate_tables', []),
                'anonymize': sync_config.get('anonymize', False)
            }

            clone_result = DatabaseSyncService.clone_database(
                source_db=prod_site.db_name,
                target_db=env_site.db_name,
                source_host=prod_site.db_host,
                target_host=env_site.db_host,
                source_user=prod_site.db_user,
                target_user=env_site.db_user,
                source_password=cls._get_db_password(prod_site),
                target_password=cls._get_db_password(env_site),
                options=clone_options
            )

            if not clone_result['success']:
                return clone_result

            # Update sync timestamp
            env_site.updated_at = datetime.utcnow()
            db.session.commit()

            return {
                'success': True,
                'message': 'Environment synced successfully',
                'pre_sync_snapshot': snapshot_result.get('snapshot', {}).get('file_path')
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_environment_status(cls, production_site_id: int) -> Dict:
        """
        Get status of all environments for a production site.

        Args:
            production_site_id: ID of the production WordPressSite

        Returns:
            Dict with production site and all environments
        """
        prod_site = WordPressSite.query.get(production_site_id)
        if not prod_site:
            return {'success': False, 'error': 'Production site not found'}

        environments = []
        for env in prod_site.environments:
            env_data = env.to_dict()

            # Get last sync info
            last_sync_job = SyncJob.query.filter_by(
                target_site_id=env.id
            ).order_by(SyncJob.last_run.desc()).first()

            if last_sync_job:
                env_data['last_sync'] = {
                    'time': last_sync_job.last_run.isoformat() if last_sync_job.last_run else None,
                    'status': last_sync_job.last_run_status,
                    'next_scheduled': last_sync_job.next_run.isoformat() if last_sync_job.next_run else None
                }

            environments.append(env_data)

        return {
            'success': True,
            'production': prod_site.to_dict(),
            'environments': environments
        }

    @classmethod
    def delete_environment(cls, env_site_id: int, delete_files: bool = True,
                           delete_database: bool = True) -> Dict:
        """
        Delete an environment.

        Args:
            env_site_id: ID of the environment WordPressSite
            delete_files: Whether to delete WordPress files
            delete_database: Whether to drop the database

        Returns:
            Dict with success status
        """
        env_site = WordPressSite.query.get(env_site_id)
        if not env_site:
            return {'success': False, 'error': 'Environment not found'}

        if env_site.is_production:
            return {'success': False, 'error': 'Cannot delete a production site this way'}

        env_app = env_site.application

        try:
            # Delete database
            if delete_database and env_site.db_name:
                DatabaseService.mysql_execute(
                    f"DROP DATABASE IF EXISTS `{env_site.db_name}`"
                )

            # Delete files
            if delete_files and env_app and env_app.root_path:
                if os.path.exists(env_app.root_path):
                    shutil.rmtree(env_app.root_path)

            # Delete related sync jobs
            SyncJob.query.filter(
                (SyncJob.source_site_id == env_site_id) |
                (SyncJob.target_site_id == env_site_id)
            ).delete()

            # Delete snapshots
            for snapshot in env_site.snapshots:
                if os.path.exists(snapshot.file_path):
                    os.remove(snapshot.file_path)

            # Delete records
            db.session.delete(env_site)
            if env_app:
                db.session.delete(env_app)

            db.session.commit()

            return {'success': True, 'message': 'Environment deleted successfully'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def _copy_wordpress_files(cls, source_path: str, target_path: str) -> Dict:
        """Copy WordPress files from source to target."""
        try:
            if os.path.exists(target_path):
                shutil.rmtree(target_path)

            shutil.copytree(source_path, target_path)

            # Set permissions
            import subprocess
            subprocess.run(['sudo', 'chown', '-R', 'www-data:www-data', target_path], capture_output=True)

            return {'success': True}

        except Exception as e:
            return {'success': False, 'error': f'Failed to copy files: {str(e)}'}

    @classmethod
    def _update_wp_config(cls, wp_path: str, db_name: str = None,
                          db_prefix: str = None, site_url: str = None) -> Dict:
        """Update wp-config.php for the new environment."""
        config_path = os.path.join(wp_path, 'wp-config.php')

        if not os.path.exists(config_path):
            return {'success': False, 'error': 'wp-config.php not found'}

        try:
            with open(config_path, 'r') as f:
                content = f.read()

            # Update database name
            if db_name:
                content = cls._replace_define(content, 'DB_NAME', db_name)

            # Update table prefix
            if db_prefix:
                content = cls._replace_table_prefix(content, db_prefix)

            # Update site URL if provided
            if site_url:
                content = cls._replace_define(content, 'WP_HOME', site_url)
                content = cls._replace_define(content, 'WP_SITEURL', site_url)

            # Add debug mode for non-production
            if "define( 'WP_DEBUG'" not in content and "define('WP_DEBUG'" not in content:
                content = content.replace(
                    "/* That's all",
                    "define('WP_DEBUG', true);\ndefine('WP_DEBUG_LOG', true);\n\n/* That's all"
                )

            with open(config_path, 'w') as f:
                f.write(content)

            return {'success': True}

        except Exception as e:
            return {'success': False, 'error': f'Failed to update wp-config.php: {str(e)}'}

    @staticmethod
    def _replace_define(content: str, constant: str, value: str) -> str:
        """Replace a define() statement in wp-config.php."""
        import re
        # Match both styles: define('CONST', 'value') and define( 'CONST', 'value' )
        pattern = rf"define\s*\(\s*['\"]({constant})['\"]\s*,\s*['\"]([^'\"]*)['\"]"
        replacement = f"define('{constant}', '{value}'"
        return re.sub(pattern, replacement, content)

    @staticmethod
    def _replace_table_prefix(content: str, prefix: str) -> str:
        """Replace the table prefix in wp-config.php."""
        import re
        pattern = r"\$table_prefix\s*=\s*['\"]([^'\"]*)['\"]"
        replacement = f"$table_prefix = '{prefix}'"
        return re.sub(pattern, replacement, content)

    @staticmethod
    def _get_db_password(site: WordPressSite) -> Optional[str]:
        """Get database password for a site from wp-config.php."""
        if not site.application or not site.application.root_path:
            return None

        config_path = os.path.join(site.application.root_path, 'wp-config.php')
        if not os.path.exists(config_path):
            return None

        try:
            with open(config_path, 'r') as f:
                content = f.read()

            import re
            match = re.search(r"define\s*\(\s*['\"]DB_PASSWORD['\"]\s*,\s*['\"]([^'\"]*)['\"]", content)
            return match.group(1) if match else None

        except Exception:
            return None

    @staticmethod
    def _generate_password(length: int = 16) -> str:
        """Generate a secure random password."""
        alphabet = string.ascii_letters + string.digits + '!@#$%^&*'
        return ''.join(secrets.choice(alphabet) for _ in range(length))
