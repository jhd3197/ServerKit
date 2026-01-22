"""Git Deployment Service - Handles automatic deployments from git webhooks."""

import os
import json
import shutil
import subprocess
from datetime import datetime
from typing import Dict, Optional


class GitDeployService:
    """Service for managing git-based deployments."""

    @classmethod
    def deploy(cls, app_id: int, webhook_id: int = None, commit_sha: str = None,
               commit_message: str = None, branch: str = None,
               triggered_by: str = 'webhook') -> Dict:
        """
        Deploy an application by pulling latest code and restarting.

        Args:
            app_id: Application ID to deploy
            webhook_id: Optional webhook that triggered this deployment
            commit_sha: Git commit SHA
            commit_message: Git commit message
            branch: Git branch name
            triggered_by: How deployment was triggered ('webhook', 'manual', 'rollback')

        Returns:
            Dict with deployment result
        """
        from app import db
        from app.models import Application, GitWebhook, GitDeployment
        from app.services.docker_service import DockerService

        app = Application.query.get(app_id)
        if not app:
            return {'success': False, 'error': 'Application not found'}

        webhook = GitWebhook.query.get(webhook_id) if webhook_id else None

        # Get next version number
        last_deployment = GitDeployment.query.filter_by(app_id=app_id)\
            .order_by(GitDeployment.version.desc()).first()
        next_version = (last_deployment.version + 1) if last_deployment else 1

        # Create deployment record
        deployment = GitDeployment(
            app_id=app_id,
            webhook_id=webhook_id,
            version=next_version,
            commit_sha=commit_sha,
            commit_message=commit_message,
            branch=branch or (webhook.source_branch if webhook else 'main'),
            triggered_by=triggered_by,
            status='running',
            started_at=datetime.utcnow()
        )

        db.session.add(deployment)
        db.session.commit()

        try:
            # Create snapshot for rollback
            snapshot = cls._create_snapshot(app)
            deployment.snapshot_data = json.dumps(snapshot)

            logs = []

            # Step 1: Pre-deployment script
            if webhook and webhook.pre_deploy_script:
                logs.append("=== Running pre-deployment script ===")
                pre_result = cls._run_script(webhook.pre_deploy_script, app.root_path)
                deployment.pre_script_output = pre_result.get('output', '')
                logs.append(pre_result.get('output', ''))

                if not pre_result.get('success'):
                    raise Exception(f"Pre-deployment script failed: {pre_result.get('error')}")

            # Step 2: Git pull
            logs.append("\n=== Pulling latest code ===")
            pull_result = cls._git_pull(app.root_path, branch or (webhook.source_branch if webhook else 'main'))
            logs.append(pull_result.get('output', ''))

            if not pull_result.get('success'):
                raise Exception(f"Git pull failed: {pull_result.get('error')}")

            # Step 3: Restart application
            logs.append("\n=== Restarting application ===")

            if webhook and webhook.zero_downtime:
                restart_result = cls._zero_downtime_restart(app)
            else:
                restart_result = cls._standard_restart(app)

            deployment.deploy_output = '\n'.join(logs) + '\n' + restart_result.get('output', '')

            if not restart_result.get('success'):
                raise Exception(f"Restart failed: {restart_result.get('error')}")

            # Step 4: Post-deployment script
            if webhook and webhook.post_deploy_script:
                logs.append("\n=== Running post-deployment script ===")
                post_result = cls._run_script(webhook.post_deploy_script, app.root_path)
                deployment.post_script_output = post_result.get('output', '')

                if not post_result.get('success'):
                    # Post-script failure is logged but doesn't fail deployment
                    logs.append(f"Warning: Post-deployment script failed: {post_result.get('error')}")

            # Success
            deployment.status = 'success'
            deployment.completed_at = datetime.utcnow()
            deployment.duration_seconds = int(
                (deployment.completed_at - deployment.started_at).total_seconds()
            )

            # Update app status
            app.status = 'running'
            app.last_deployed_at = datetime.utcnow()

            db.session.commit()

            return {
                'success': True,
                'deployment_id': deployment.id,
                'version': deployment.version,
                'duration': deployment.duration_seconds,
                'message': f'Deployed version {deployment.version} successfully'
            }

        except Exception as e:
            deployment.status = 'failed'
            deployment.error_message = str(e)
            deployment.completed_at = datetime.utcnow()
            deployment.duration_seconds = int(
                (deployment.completed_at - deployment.started_at).total_seconds()
            )
            db.session.commit()

            return {
                'success': False,
                'deployment_id': deployment.id,
                'version': deployment.version,
                'error': str(e)
            }

    @classmethod
    def rollback(cls, app_id: int, target_version: int = None) -> Dict:
        """
        Rollback to a previous deployment version.

        Args:
            app_id: Application ID
            target_version: Version to rollback to (default: previous version)

        Returns:
            Dict with rollback result
        """
        from app import db
        from app.models import Application, GitDeployment
        from app.services.docker_service import DockerService

        app = Application.query.get(app_id)
        if not app:
            return {'success': False, 'error': 'Application not found'}

        # Get current deployment
        current = GitDeployment.query.filter_by(app_id=app_id, status='success')\
            .order_by(GitDeployment.version.desc()).first()

        if not current:
            return {'success': False, 'error': 'No successful deployment to rollback from'}

        # Get target deployment
        if target_version:
            target = GitDeployment.query.filter_by(
                app_id=app_id,
                version=target_version,
                status='success'
            ).first()
        else:
            # Get previous successful deployment
            target = GitDeployment.query.filter_by(app_id=app_id, status='success')\
                .filter(GitDeployment.version < current.version)\
                .order_by(GitDeployment.version.desc()).first()

        if not target:
            return {'success': False, 'error': 'No previous version to rollback to'}

        if not target.snapshot_data:
            return {'success': False, 'error': 'Target deployment has no snapshot data'}

        # Create rollback deployment
        next_version = current.version + 1
        deployment = GitDeployment(
            app_id=app_id,
            version=next_version,
            commit_sha=target.commit_sha,
            commit_message=f'Rollback to v{target.version}',
            branch=target.branch,
            triggered_by='rollback',
            is_rollback=True,
            rollback_from_version=current.version,
            status='running',
            started_at=datetime.utcnow()
        )

        db.session.add(deployment)
        db.session.commit()

        try:
            # Restore snapshot
            snapshot = json.loads(target.snapshot_data)
            restore_result = cls._restore_snapshot(app, snapshot)

            deployment.deploy_output = restore_result.get('output', '')

            if not restore_result.get('success'):
                raise Exception(f"Snapshot restore failed: {restore_result.get('error')}")

            # Restart with restored config
            restart_result = cls._standard_restart(app)
            deployment.deploy_output += '\n' + restart_result.get('output', '')

            if not restart_result.get('success'):
                raise Exception(f"Restart failed: {restart_result.get('error')}")

            # Success
            deployment.status = 'success'
            deployment.completed_at = datetime.utcnow()
            deployment.duration_seconds = int(
                (deployment.completed_at - deployment.started_at).total_seconds()
            )
            deployment.rolled_back_to_id = target.id

            # Mark current as rolled back
            current.rolled_back_at = datetime.utcnow()

            # Update app
            app.status = 'running'
            app.last_deployed_at = datetime.utcnow()

            db.session.commit()

            return {
                'success': True,
                'deployment_id': deployment.id,
                'version': deployment.version,
                'rolled_back_from': current.version,
                'rolled_back_to': target.version,
                'message': f'Rolled back from v{current.version} to v{target.version}'
            }

        except Exception as e:
            deployment.status = 'failed'
            deployment.error_message = str(e)
            deployment.completed_at = datetime.utcnow()
            db.session.commit()

            return {
                'success': False,
                'deployment_id': deployment.id,
                'error': str(e)
            }

    @classmethod
    def get_deployments(cls, app_id: int, limit: int = 20) -> Dict:
        """Get deployment history for an application."""
        from app.models import GitDeployment

        deployments = GitDeployment.query.filter_by(app_id=app_id)\
            .order_by(GitDeployment.created_at.desc())\
            .limit(limit).all()

        return {
            'success': True,
            'deployments': [d.to_dict() for d in deployments],
            'count': len(deployments)
        }

    @classmethod
    def get_deployment(cls, deployment_id: int, include_logs: bool = False) -> Dict:
        """Get a specific deployment."""
        from app.models import GitDeployment

        deployment = GitDeployment.query.get(deployment_id)
        if not deployment:
            return {'success': False, 'error': 'Deployment not found'}

        return {
            'success': True,
            'deployment': deployment.to_dict_full() if include_logs else deployment.to_dict()
        }

    @classmethod
    def manual_deploy(cls, app_id: int, branch: str = None) -> Dict:
        """Trigger a manual deployment."""
        from app.models import Application, GitWebhook

        app = Application.query.get(app_id)
        if not app:
            return {'success': False, 'error': 'Application not found'}

        # Find webhook for this app to get settings
        webhook = GitWebhook.query.filter_by(app_id=app_id, is_active=True).first()

        return cls.deploy(
            app_id=app_id,
            webhook_id=webhook.id if webhook else None,
            branch=branch or (webhook.source_branch if webhook else 'main'),
            triggered_by='manual'
        )

    # ==================== INTERNAL HELPERS ====================

    @classmethod
    def _git_pull(cls, path: str, branch: str = 'main') -> Dict:
        """Pull latest code from git."""
        if not os.path.exists(path):
            return {'success': False, 'error': f'Path does not exist: {path}'}

        git_dir = os.path.join(path, '.git')
        if not os.path.exists(git_dir):
            return {'success': False, 'error': 'Not a git repository'}

        try:
            # Fetch and reset to remote branch
            commands = [
                ['git', 'fetch', 'origin', branch],
                ['git', 'reset', '--hard', f'origin/{branch}']
            ]

            output = []
            for cmd in commands:
                result = subprocess.run(
                    cmd,
                    cwd=path,
                    capture_output=True,
                    text=True,
                    timeout=120
                )
                output.append(f"$ {' '.join(cmd)}")
                output.append(result.stdout)
                if result.stderr:
                    output.append(result.stderr)

                if result.returncode != 0:
                    return {
                        'success': False,
                        'error': result.stderr,
                        'output': '\n'.join(output)
                    }

            return {
                'success': True,
                'output': '\n'.join(output)
            }

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Git pull timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _standard_restart(cls, app) -> Dict:
        """Standard restart - stop then start."""
        from app.services.docker_service import DockerService

        output = []

        # Stop
        stop_result = DockerService.compose_down(app.root_path)
        output.append(f"Stop: {stop_result.get('message', stop_result.get('error', 'Unknown'))}")

        # Build and start
        up_result = DockerService.compose_up(app.root_path, detach=True, build=True)
        output.append(f"Start: {up_result.get('message', up_result.get('error', 'Unknown'))}")

        return {
            'success': up_result.get('success', False),
            'output': '\n'.join(output),
            'error': up_result.get('error')
        }

    @classmethod
    def _zero_downtime_restart(cls, app) -> Dict:
        """Zero-downtime restart using rolling update."""
        from app.services.docker_service import DockerService

        output = []

        try:
            # Build new images first
            build_result = subprocess.run(
                ['docker', 'compose', 'build'],
                cwd=app.root_path,
                capture_output=True,
                text=True,
                timeout=300
            )
            output.append(f"Build: {build_result.stdout}")

            if build_result.returncode != 0:
                return {
                    'success': False,
                    'error': build_result.stderr,
                    'output': '\n'.join(output)
                }

            # Rolling update - start new containers before stopping old
            up_result = subprocess.run(
                ['docker', 'compose', 'up', '-d', '--no-deps', '--scale', 'web=2'],
                cwd=app.root_path,
                capture_output=True,
                text=True,
                timeout=120
            )

            # Wait for new container to be healthy
            import time
            time.sleep(5)

            # Scale back down
            scale_result = subprocess.run(
                ['docker', 'compose', 'up', '-d', '--no-deps', '--scale', 'web=1'],
                cwd=app.root_path,
                capture_output=True,
                text=True,
                timeout=60
            )

            output.append(f"Rolling update completed")

            return {
                'success': True,
                'output': '\n'.join(output)
            }

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Restart timed out', 'output': '\n'.join(output)}
        except Exception as e:
            return {'success': False, 'error': str(e), 'output': '\n'.join(output)}

    @classmethod
    def _run_script(cls, script: str, cwd: str) -> Dict:
        """Run a deployment script."""
        try:
            result = subprocess.run(
                script,
                shell=True,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=300,
                env={**os.environ, 'DEPLOY_DIR': cwd}
            )

            return {
                'success': result.returncode == 0,
                'output': result.stdout + result.stderr,
                'error': result.stderr if result.returncode != 0 else None
            }

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Script timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _create_snapshot(cls, app) -> Dict:
        """Create a snapshot of current state for rollback."""
        snapshot = {
            'created_at': datetime.utcnow().isoformat(),
            'app_id': app.id,
            'files': {}
        }

        # Capture docker-compose.yml
        compose_path = os.path.join(app.root_path, 'docker-compose.yml')
        if os.path.exists(compose_path):
            with open(compose_path, 'r') as f:
                snapshot['files']['docker-compose.yml'] = f.read()

        # Capture .env
        env_path = os.path.join(app.root_path, '.env')
        if os.path.exists(env_path):
            with open(env_path, 'r') as f:
                snapshot['files']['.env'] = f.read()

        # Capture current git commit
        try:
            result = subprocess.run(
                ['git', 'rev-parse', 'HEAD'],
                cwd=app.root_path,
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                snapshot['commit_sha'] = result.stdout.strip()
        except Exception:
            pass

        return snapshot

    @classmethod
    def _restore_snapshot(cls, app, snapshot: Dict) -> Dict:
        """Restore application state from snapshot."""
        output = []

        try:
            # Restore files
            for filename, content in snapshot.get('files', {}).items():
                filepath = os.path.join(app.root_path, filename)
                with open(filepath, 'w') as f:
                    f.write(content)
                output.append(f"Restored {filename}")

            # Checkout specific commit if available
            if snapshot.get('commit_sha'):
                result = subprocess.run(
                    ['git', 'checkout', snapshot['commit_sha']],
                    cwd=app.root_path,
                    capture_output=True,
                    text=True,
                    timeout=60
                )
                if result.returncode == 0:
                    output.append(f"Checked out commit {snapshot['commit_sha'][:7]}")
                else:
                    output.append(f"Warning: Could not checkout commit: {result.stderr}")

            return {
                'success': True,
                'output': '\n'.join(output)
            }

        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'output': '\n'.join(output)
            }
