"""
Deployment Service - Orchestrates build and deploy workflows.

Supports:
- Full deployment workflow (build -> deploy)
- Deployment status tracking
- One-click rollback
- Deployment retention policies
- Diff generation between deployments
"""

import os
import subprocess
import json
import shutil
from datetime import datetime
from typing import Dict, List, Optional, Callable

from app import db
from app.models.deployment import Deployment, DeploymentDiff
from app.models.application import Application
from app.services.build_service import BuildService
from app.services.docker_service import DockerService
from app.services.git_service import GitService


class DeploymentService:
    """Service for orchestrating deployments."""

    DEPLOYMENT_DIR = '/var/serverkit/deployments'

    @classmethod
    def create_deployment(cls, app_id: int, user_id: int = None,
                         trigger: str = 'manual', version_tag: str = None) -> Dict:
        """Create a new deployment record."""
        app = Application.query.get(app_id)
        if not app:
            return {'success': False, 'error': 'Application not found'}

        # Get git commit info if available
        commit_hash = None
        commit_message = None
        if app.root_path:
            git_info = GitService.get_commit_info(app.root_path)
            if git_info:
                commit_hash = git_info.get('hash')
                commit_message = git_info.get('message')

        # Get build config
        build_config = BuildService.get_app_build_config(app_id)
        build_method = None
        if build_config:
            build_method = build_config.get('build_method', 'auto')
            if build_method == 'auto':
                detection = BuildService.detect_build_method(app.root_path or app.path)
                build_method = detection.get('build_method')

        # Create deployment record
        version = Deployment.get_next_version(app_id)
        deployment = Deployment(
            app_id=app_id,
            version=version,
            version_tag=version_tag or f"v{version}",
            status='pending',
            build_method=build_method,
            commit_hash=commit_hash,
            commit_message=commit_message,
            deployed_by=user_id,
            deploy_trigger=trigger
        )
        db.session.add(deployment)
        db.session.commit()

        return {
            'success': True,
            'deployment': deployment.to_dict()
        }

    @classmethod
    def deploy(cls, app_id: int, user_id: int = None,
              no_cache: bool = False,
              trigger: str = 'manual',
              version_tag: str = None,
              log_callback: Callable[[str], None] = None) -> Dict:
        """Execute a full deployment (build + deploy).

        This is the main entry point for deployments.
        """
        # Create deployment record
        result = cls.create_deployment(app_id, user_id, trigger, version_tag)
        if not result.get('success'):
            return result

        deployment_id = result['deployment']['id']
        deployment = Deployment.query.get(deployment_id)

        app = Application.query.get(app_id)
        build_config = BuildService.get_app_build_config(app_id)

        try:
            # Update app status
            app.status = 'deploying'
            db.session.commit()

            # Step 1: Build
            deployment.status = 'building'
            deployment.build_started_at = datetime.utcnow()
            db.session.commit()

            if log_callback:
                log_callback(f"Starting build for {app.name}...")

            build_result = BuildService.build(
                app_id,
                no_cache=no_cache,
                log_callback=log_callback
            )

            deployment.build_completed_at = datetime.utcnow()

            if not build_result.get('success'):
                deployment.status = 'failed'
                deployment.error_message = build_result.get('error', 'Build failed')
                app.status = 'error'
                db.session.commit()
                return {
                    'success': False,
                    'error': deployment.error_message,
                    'deployment': deployment.to_dict()
                }

            # Store build artifacts
            if build_result.get('image_tag'):
                deployment.image_tag = build_result['image_tag']

            if build_result.get('build_log'):
                # Store build log path for later retrieval
                log_dir = f"/var/log/serverkit/builds/{app_id}"
                log_file = f"build-{deployment.created_at.isoformat().replace(':', '-')}.json"
                deployment.build_log_path = os.path.join(log_dir, log_file)

            db.session.commit()

            # Step 2: Deploy
            deployment.status = 'deploying'
            deployment.deploy_started_at = datetime.utcnow()
            db.session.commit()

            if log_callback:
                log_callback("Build successful, starting deployment...")

            deploy_result = cls._deploy_application(app, deployment, log_callback)

            if not deploy_result.get('success'):
                deployment.status = 'failed'
                deployment.error_message = deploy_result.get('error', 'Deploy failed')
                app.status = 'error'
                db.session.commit()
                return {
                    'success': False,
                    'error': deployment.error_message,
                    'deployment': deployment.to_dict()
                }

            # Mark previous live deployment as rolled_back
            current = Deployment.get_current(app_id)
            if current and current.id != deployment.id:
                current.status = 'rolled_back'

            # Update deployment status
            deployment.status = 'live'
            deployment.deploy_completed_at = datetime.utcnow()
            deployment.container_id = deploy_result.get('container_id')

            # Update app
            app.status = 'running'
            app.last_deployed_at = datetime.utcnow()
            if deployment.image_tag:
                app.docker_image = deployment.image_tag
            if deploy_result.get('container_id'):
                app.container_id = deploy_result.get('container_id')

            db.session.commit()

            # Generate diff with previous deployment
            cls._generate_diff(deployment)

            # Cleanup old deployments
            if build_config:
                keep_count = build_config.get('keep_deployments', 5)
                Deployment.cleanup_old_deployments(app_id, keep_count)

            if log_callback:
                log_callback(f"Deployment successful! Version {deployment.version} is now live.")

            return {
                'success': True,
                'deployment': deployment.to_dict()
            }

        except Exception as e:
            deployment.status = 'failed'
            deployment.error_message = str(e)
            app.status = 'error'
            db.session.commit()
            return {
                'success': False,
                'error': str(e),
                'deployment': deployment.to_dict()
            }

    @classmethod
    def _deploy_application(cls, app: Application, deployment: Deployment,
                           log_callback: Callable[[str], None] = None) -> Dict:
        """Deploy the application based on app type."""
        try:
            if deployment.image_tag:
                # Docker-based deployment
                return cls._deploy_docker(app, deployment, log_callback)
            else:
                # Non-Docker deployment (use existing deployment mechanisms)
                return cls._deploy_traditional(app, deployment, log_callback)
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _deploy_docker(cls, app: Application, deployment: Deployment,
                      log_callback: Callable[[str], None] = None) -> Dict:
        """Deploy a Docker-based application."""
        image_tag = deployment.image_tag
        container_name = f"serverkit-app-{app.id}"

        if log_callback:
            log_callback(f"Deploying Docker image: {image_tag}")

        # Stop and remove existing container
        existing = DockerService.get_container(container_name)
        if existing:
            if log_callback:
                log_callback("Stopping existing container...")
            DockerService.stop_container(container_name)
            DockerService.remove_container(container_name)

        # Configure container
        ports = []
        if app.port:
            ports.append(f"{app.port}:{app.port}")

        env = {}
        # Get env vars from app config if available
        from app.services.env_service import EnvService
        env_vars = EnvService.get_env_vars(app.id)
        if env_vars.get('success'):
            for var in env_vars.get('variables', []):
                env[var['key']] = var['value']

        # Run new container
        if log_callback:
            log_callback(f"Starting container {container_name}...")

        result = DockerService.run_container(
            image=image_tag,
            name=container_name,
            ports=ports if ports else None,
            env=env if env else None,
            restart_policy='unless-stopped',
            detach=True
        )

        if result.get('success'):
            return {
                'success': True,
                'container_id': result.get('container_id')
            }
        return result

    @classmethod
    def _deploy_traditional(cls, app: Application, deployment: Deployment,
                           log_callback: Callable[[str], None] = None) -> Dict:
        """Deploy using traditional methods (git pull, service restart, etc.)."""
        from app.services.git_service import GitService

        # If git is configured, pull latest
        deploy_config = GitService.get_app_config(app.id)
        if deploy_config:
            if log_callback:
                log_callback("Pulling latest changes...")

            pull_result = GitService.pull_changes(
                app.root_path or app.path,
                deploy_config.get('branch')
            )

            if not pull_result.get('success'):
                return pull_result

            # Run post-deploy scripts
            if deploy_config.get('post_deploy_script'):
                if log_callback:
                    log_callback("Running post-deploy script...")

                script_result = GitService._run_script(
                    deploy_config['post_deploy_script'],
                    app.root_path or app.path
                )

                if not script_result.get('success'):
                    return script_result

        # Restart the application service if applicable
        if app.app_type in ['flask', 'django']:
            if log_callback:
                log_callback("Restarting application service...")

            service_name = f"serverkit-{app.name}"
            try:
                subprocess.run(
                    ['systemctl', 'restart', service_name],
                    capture_output=True,
                    check=True
                )
            except subprocess.CalledProcessError as e:
                return {'success': False, 'error': f'Service restart failed: {e.stderr}'}

        return {'success': True}

    @classmethod
    def rollback(cls, app_id: int, target_version: int = None,
                user_id: int = None,
                log_callback: Callable[[str], None] = None) -> Dict:
        """Rollback to a previous deployment.

        If target_version is not specified, rolls back to the previous successful deployment.
        """
        app = Application.query.get(app_id)
        if not app:
            return {'success': False, 'error': 'Application not found'}

        current = Deployment.get_current(app_id)
        if not current:
            return {'success': False, 'error': 'No current deployment to rollback from'}

        # Find target deployment
        if target_version:
            target = Deployment.query.filter_by(
                app_id=app_id,
                version=target_version
            ).first()
        else:
            target = Deployment.get_previous(app_id, current.version)

        if not target:
            return {'success': False, 'error': 'No previous deployment found to rollback to'}

        if not target.image_tag and not target.commit_hash:
            return {
                'success': False,
                'error': 'Target deployment has no artifacts to rollback to'
            }

        if log_callback:
            log_callback(f"Rolling back from v{current.version} to v{target.version}...")

        try:
            app.status = 'deploying'
            db.session.commit()

            # Create new deployment record for the rollback
            version = Deployment.get_next_version(app_id)
            rollback_deployment = Deployment(
                app_id=app_id,
                version=version,
                version_tag=f"v{version}-rollback-from-v{current.version}",
                status='deploying',
                build_method=target.build_method,
                image_tag=target.image_tag,
                commit_hash=target.commit_hash,
                deployed_by=user_id,
                deploy_trigger='rollback'
            )
            rollback_deployment.update_metadata('rolled_back_to', target.version)
            rollback_deployment.deploy_started_at = datetime.utcnow()
            db.session.add(rollback_deployment)
            db.session.commit()

            # Deploy the previous version
            if target.image_tag:
                # Docker rollback
                deploy_result = cls._deploy_docker(app, rollback_deployment, log_callback)
            else:
                # Git rollback
                deploy_result = cls._rollback_git(app, target, log_callback)

            if not deploy_result.get('success'):
                rollback_deployment.status = 'failed'
                rollback_deployment.error_message = deploy_result.get('error')
                app.status = 'error'
                db.session.commit()
                return {
                    'success': False,
                    'error': deploy_result.get('error'),
                    'deployment': rollback_deployment.to_dict()
                }

            # Update statuses
            current.status = 'rolled_back'
            rollback_deployment.status = 'live'
            rollback_deployment.deploy_completed_at = datetime.utcnow()
            rollback_deployment.container_id = deploy_result.get('container_id')

            app.status = 'running'
            app.last_deployed_at = datetime.utcnow()

            db.session.commit()

            if log_callback:
                log_callback(f"Rollback successful! Now running v{target.version} code as v{version}")

            return {
                'success': True,
                'deployment': rollback_deployment.to_dict(),
                'rolled_back_to': target.to_dict()
            }

        except Exception as e:
            app.status = 'error'
            db.session.commit()
            return {'success': False, 'error': str(e)}

    @classmethod
    def _rollback_git(cls, app: Application, target: Deployment,
                     log_callback: Callable[[str], None] = None) -> Dict:
        """Rollback to a specific git commit."""
        if not target.commit_hash:
            return {'success': False, 'error': 'No commit hash to rollback to'}

        app_path = app.root_path or app.path

        try:
            if log_callback:
                log_callback(f"Checking out commit {target.commit_hash[:8]}...")

            # Checkout the specific commit
            result = subprocess.run(
                ['git', '-C', app_path, 'checkout', target.commit_hash],
                capture_output=True,
                text=True
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            # Run post-deploy script if configured
            deploy_config = GitService.get_app_config(app.id)
            if deploy_config and deploy_config.get('post_deploy_script'):
                if log_callback:
                    log_callback("Running post-deploy script...")

                script_result = GitService._run_script(
                    deploy_config['post_deploy_script'],
                    app_path
                )

                if not script_result.get('success'):
                    return script_result

            # Restart service
            if app.app_type in ['flask', 'django']:
                service_name = f"serverkit-{app.name}"
                subprocess.run(['systemctl', 'restart', service_name], check=True)

            return {'success': True}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _generate_diff(cls, deployment: Deployment) -> None:
        """Generate diff between this deployment and the previous one."""
        try:
            previous = Deployment.get_previous(deployment.app_id, deployment.version)
            if not previous or not deployment.commit_hash or not previous.commit_hash:
                return

            app = Application.query.get(deployment.app_id)
            app_path = app.root_path or app.path

            # Get git diff
            result = subprocess.run(
                ['git', '-C', app_path, 'diff', '--name-status',
                 previous.commit_hash, deployment.commit_hash],
                capture_output=True,
                text=True
            )

            if result.returncode != 0:
                return

            files_added = []
            files_removed = []
            files_modified = []

            for line in result.stdout.strip().split('\n'):
                if not line:
                    continue
                parts = line.split('\t')
                if len(parts) >= 2:
                    status, filepath = parts[0], parts[1]
                    if status == 'A':
                        files_added.append(filepath)
                    elif status == 'D':
                        files_removed.append(filepath)
                    elif status.startswith('M') or status.startswith('R'):
                        files_modified.append(filepath)

            # Get diff stats
            stat_result = subprocess.run(
                ['git', '-C', app_path, 'diff', '--shortstat',
                 previous.commit_hash, deployment.commit_hash],
                capture_output=True,
                text=True
            )

            additions = 0
            deletions = 0
            if stat_result.returncode == 0 and stat_result.stdout:
                import re
                add_match = re.search(r'(\d+) insertion', stat_result.stdout)
                del_match = re.search(r'(\d+) deletion', stat_result.stdout)
                if add_match:
                    additions = int(add_match.group(1))
                if del_match:
                    deletions = int(del_match.group(1))

            # Create diff record
            diff = DeploymentDiff(
                deployment_id=deployment.id,
                previous_deployment_id=previous.id,
                files_added=json.dumps(files_added),
                files_removed=json.dumps(files_removed),
                files_modified=json.dumps(files_modified),
                additions=additions,
                deletions=deletions
            )
            db.session.add(diff)
            db.session.commit()

        except Exception:
            pass

    @classmethod
    def get_deployments(cls, app_id: int, limit: int = 20, offset: int = 0) -> List[Dict]:
        """Get deployment history for an app."""
        deployments = Deployment.query.filter_by(app_id=app_id).order_by(
            Deployment.version.desc()
        ).offset(offset).limit(limit).all()

        return [d.to_dict() for d in deployments]

    @classmethod
    def get_deployment(cls, deployment_id: int, include_logs: bool = False) -> Optional[Dict]:
        """Get a specific deployment."""
        deployment = Deployment.query.get(deployment_id)
        if deployment:
            return deployment.to_dict(include_logs=include_logs)
        return None

    @classmethod
    def get_deployment_diff(cls, deployment_id: int) -> Optional[Dict]:
        """Get diff for a deployment."""
        diff = DeploymentDiff.query.filter_by(deployment_id=deployment_id).first()
        if diff:
            return diff.to_dict()
        return None

    @classmethod
    def get_current_deployment(cls, app_id: int) -> Optional[Dict]:
        """Get the currently live deployment."""
        deployment = Deployment.get_current(app_id)
        if deployment:
            return deployment.to_dict()
        return None

    @classmethod
    def update_deployment_status(cls, deployment_id: int, status: str,
                                error_message: str = None) -> Dict:
        """Update deployment status."""
        deployment = Deployment.query.get(deployment_id)
        if not deployment:
            return {'success': False, 'error': 'Deployment not found'}

        deployment.status = status
        if error_message:
            deployment.error_message = error_message

        db.session.commit()
        return {'success': True, 'deployment': deployment.to_dict()}
