import os
import subprocess
import json
import hmac
import hashlib
import secrets
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path

from app import paths


class GitService:
    """Service for Git deployment and webhooks."""

    CONFIG_DIR = paths.SERVERKIT_CONFIG_DIR
    DEPLOY_CONFIG = os.path.join(CONFIG_DIR, 'deployments.json')
    DEPLOY_LOG = os.path.join(paths.SERVERKIT_LOG_DIR, 'deployments.log')

    @classmethod
    def get_config(cls) -> Dict:
        """Get deployment configuration."""
        if os.path.exists(cls.DEPLOY_CONFIG):
            try:
                with open(cls.DEPLOY_CONFIG, 'r') as f:
                    return json.load(f)
            except Exception:
                pass

        return {
            'apps': {},  # app_id -> deployment config
            'webhook_secret': cls._generate_secret()
        }

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save deployment configuration."""
        try:
            os.makedirs(cls.CONFIG_DIR, exist_ok=True)
            with open(cls.DEPLOY_CONFIG, 'w') as f:
                json.dump(config, f, indent=2)
            return {'success': True, 'message': 'Configuration saved'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def _generate_secret() -> str:
        """Generate a random webhook secret."""
        import secrets
        return secrets.token_hex(32)

    @classmethod
    def get_app_config(cls, app_id: int) -> Optional[Dict]:
        """Get deployment config for an app."""
        config = cls.get_config()
        return config.get('apps', {}).get(str(app_id))

    @classmethod
    def configure_deployment(cls, app_id: int, app_path: str,
                            repo_url: str, branch: str = 'main',
                            auto_deploy: bool = True,
                            pre_deploy_script: str = None,
                            post_deploy_script: str = None) -> Dict:
        """Configure Git deployment for an application."""
        config = cls.get_config()

        app_config = {
            'app_id': app_id,
            'app_path': app_path,
            'repo_url': repo_url,
            'branch': branch,
            'auto_deploy': auto_deploy,
            'pre_deploy_script': pre_deploy_script,
            'post_deploy_script': post_deploy_script,
            'webhook_token': cls._generate_secret()[:16],
            'created_at': datetime.now().isoformat(),
            'last_deploy': None,
            'deploy_count': 0
        }

        config.setdefault('apps', {})[str(app_id)] = app_config
        result = cls.save_config(config)

        if result.get('success'):
            return {
                'success': True,
                'config': app_config,
                'webhook_url': f'/api/v1/deploy/webhook/{app_id}/{app_config["webhook_token"]}'
            }
        return result

    @classmethod
    def remove_deployment(cls, app_id: int) -> Dict:
        """Remove deployment configuration for an app."""
        config = cls.get_config()

        if str(app_id) not in config.get('apps', {}):
            return {'success': False, 'error': 'Deployment not configured'}

        del config['apps'][str(app_id)]
        return cls.save_config(config)

    @classmethod
    def clone_repository(cls, app_path: str, repo_url: str, branch: str = 'main') -> Dict:
        """Clone a Git repository."""
        try:
            # Remove existing directory if exists
            if os.path.exists(app_path):
                return {'success': False, 'error': 'Directory already exists'}

            cmd = ['git', 'clone', '--branch', branch, '--single-branch', repo_url, app_path]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

            if result.returncode == 0:
                return {
                    'success': True,
                    'message': f'Repository cloned to {app_path}',
                    'path': app_path
                }
            return {'success': False, 'error': result.stderr}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Clone operation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def pull_changes(cls, app_path: str, branch: str = None) -> Dict:
        """Pull latest changes from remote."""
        if not os.path.exists(os.path.join(app_path, '.git')):
            return {'success': False, 'error': 'Not a Git repository'}

        try:
            # Fetch first
            fetch_cmd = ['git', '-C', app_path, 'fetch', '--all']
            subprocess.run(fetch_cmd, capture_output=True, text=True, timeout=60)

            # Get current branch if not specified
            if not branch:
                branch_cmd = ['git', '-C', app_path, 'rev-parse', '--abbrev-ref', 'HEAD']
                result = subprocess.run(branch_cmd, capture_output=True, text=True)
                branch = result.stdout.strip() if result.returncode == 0 else 'main'

            # Reset to remote branch (force pull)
            reset_cmd = ['git', '-C', app_path, 'reset', '--hard', f'origin/{branch}']
            result = subprocess.run(reset_cmd, capture_output=True, text=True, timeout=60)

            if result.returncode == 0:
                # Get new commit info
                commit_info = cls.get_commit_info(app_path)
                return {
                    'success': True,
                    'message': 'Changes pulled successfully',
                    'commit': commit_info
                }
            return {'success': False, 'error': result.stderr}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Pull operation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_commit_info(cls, app_path: str) -> Optional[Dict]:
        """Get current commit information."""
        if not os.path.exists(os.path.join(app_path, '.git')):
            return None

        try:
            # Get commit hash
            cmd = ['git', '-C', app_path, 'rev-parse', 'HEAD']
            result = subprocess.run(cmd, capture_output=True, text=True)
            commit_hash = result.stdout.strip() if result.returncode == 0 else None

            # Get commit message
            cmd = ['git', '-C', app_path, 'log', '-1', '--pretty=%B']
            result = subprocess.run(cmd, capture_output=True, text=True)
            commit_message = result.stdout.strip() if result.returncode == 0 else None

            # Get author
            cmd = ['git', '-C', app_path, 'log', '-1', '--pretty=%an <%ae>']
            result = subprocess.run(cmd, capture_output=True, text=True)
            author = result.stdout.strip() if result.returncode == 0 else None

            # Get timestamp
            cmd = ['git', '-C', app_path, 'log', '-1', '--pretty=%ci']
            result = subprocess.run(cmd, capture_output=True, text=True)
            timestamp = result.stdout.strip() if result.returncode == 0 else None

            # Get branch
            cmd = ['git', '-C', app_path, 'rev-parse', '--abbrev-ref', 'HEAD']
            result = subprocess.run(cmd, capture_output=True, text=True)
            branch = result.stdout.strip() if result.returncode == 0 else None

            return {
                'hash': commit_hash,
                'short_hash': commit_hash[:7] if commit_hash else None,
                'message': commit_message,
                'author': author,
                'timestamp': timestamp,
                'branch': branch
            }

        except Exception:
            return None

    @classmethod
    def deploy(cls, app_id: int, force: bool = False) -> Dict:
        """Deploy an application from Git."""
        app_config = cls.get_app_config(app_id)
        if not app_config:
            return {'success': False, 'error': 'Deployment not configured'}

        app_path = app_config['app_path']
        branch = app_config.get('branch', 'main')

        deploy_log = {
            'app_id': app_id,
            'started_at': datetime.now().isoformat(),
            'status': 'in_progress',
            'steps': []
        }

        try:
            # Pre-deploy script
            if app_config.get('pre_deploy_script'):
                deploy_log['steps'].append({'step': 'pre_deploy', 'status': 'running'})
                result = cls._run_script(app_config['pre_deploy_script'], app_path)
                deploy_log['steps'][-1].update({
                    'status': 'success' if result['success'] else 'failed',
                    'output': result.get('output', result.get('error'))
                })
                if not result['success']:
                    raise Exception(f"Pre-deploy script failed: {result['error']}")

            # Pull changes
            deploy_log['steps'].append({'step': 'pull', 'status': 'running'})
            pull_result = cls.pull_changes(app_path, branch)
            deploy_log['steps'][-1].update({
                'status': 'success' if pull_result['success'] else 'failed',
                'commit': pull_result.get('commit')
            })
            if not pull_result['success']:
                raise Exception(f"Pull failed: {pull_result['error']}")

            # Post-deploy script
            if app_config.get('post_deploy_script'):
                deploy_log['steps'].append({'step': 'post_deploy', 'status': 'running'})
                result = cls._run_script(app_config['post_deploy_script'], app_path)
                deploy_log['steps'][-1].update({
                    'status': 'success' if result['success'] else 'failed',
                    'output': result.get('output', result.get('error'))
                })
                if not result['success']:
                    raise Exception(f"Post-deploy script failed: {result['error']}")

            # Update config
            config = cls.get_config()
            config['apps'][str(app_id)]['last_deploy'] = datetime.now().isoformat()
            config['apps'][str(app_id)]['deploy_count'] = config['apps'][str(app_id)].get('deploy_count', 0) + 1
            cls.save_config(config)

            deploy_log['status'] = 'success'
            deploy_log['completed_at'] = datetime.now().isoformat()

            cls._log_deployment(deploy_log)

            return {
                'success': True,
                'message': 'Deployment completed successfully',
                'deploy_log': deploy_log
            }

        except Exception as e:
            deploy_log['status'] = 'failed'
            deploy_log['error'] = str(e)
            deploy_log['completed_at'] = datetime.now().isoformat()

            cls._log_deployment(deploy_log)

            return {'success': False, 'error': str(e), 'deploy_log': deploy_log}

    @classmethod
    def _run_script(cls, script: str, working_dir: str) -> Dict:
        """Run a deployment script."""
        try:
            result = subprocess.run(
                script,
                shell=True,
                cwd=working_dir,
                capture_output=True,
                text=True,
                timeout=300
            )

            return {
                'success': result.returncode == 0,
                'output': result.stdout,
                'error': result.stderr if result.returncode != 0 else None
            }

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Script timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def verify_webhook(cls, app_id: int, token: str,
                      signature: str = None, payload: bytes = None,
                      provider: str = 'github') -> bool:
        """Verify webhook authenticity.

        Supports GitHub, GitLab, and Bitbucket signature verification.
        """
        app_config = cls.get_app_config(app_id)
        if not app_config:
            return False

        # Simple token verification
        if token != app_config.get('webhook_token'):
            return False

        # If signature provided, verify based on provider
        if signature and payload:
            config = cls.get_config()
            secret = config.get('webhook_secret', '').encode()

            if provider == 'github':
                # GitHub: X-Hub-Signature-256 header with sha256=<hex>
                expected = 'sha256=' + hmac.new(secret, payload, hashlib.sha256).hexdigest()
                return hmac.compare_digest(signature, expected)

            elif provider == 'gitlab':
                # GitLab: X-Gitlab-Token header contains the secret directly
                return hmac.compare_digest(signature, config.get('webhook_secret', ''))

            elif provider == 'bitbucket':
                # Bitbucket: X-Hub-Signature header with sha256=<hex> (similar to GitHub)
                expected = 'sha256=' + hmac.new(secret, payload, hashlib.sha256).hexdigest()
                return hmac.compare_digest(signature, expected)

        return True

    @classmethod
    def get_remote_branches(cls, app_path: str) -> Dict:
        """Get list of remote branches for a repository."""
        if not os.path.exists(os.path.join(app_path, '.git')):
            return {'success': False, 'error': 'Not a Git repository'}

        try:
            # Fetch latest from remote
            fetch_cmd = ['git', '-C', app_path, 'fetch', '--all', '--prune']
            subprocess.run(fetch_cmd, capture_output=True, text=True, timeout=60)

            # Get remote branches
            cmd = ['git', '-C', app_path, 'branch', '-r', '--format=%(refname:short)']
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            branches = []
            for line in result.stdout.strip().split('\n'):
                branch = line.strip()
                if branch and not branch.endswith('/HEAD'):
                    # Remove origin/ prefix
                    if branch.startswith('origin/'):
                        branch = branch[7:]
                    branches.append(branch)

            # Get current branch
            cmd = ['git', '-C', app_path, 'rev-parse', '--abbrev-ref', 'HEAD']
            result = subprocess.run(cmd, capture_output=True, text=True)
            current_branch = result.stdout.strip() if result.returncode == 0 else None

            return {
                'success': True,
                'branches': sorted(set(branches)),
                'current_branch': current_branch
            }

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Operation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_remote_branches_from_url(cls, repo_url: str) -> Dict:
        """Get list of branches from a remote repository URL without cloning."""
        try:
            cmd = ['git', 'ls-remote', '--heads', repo_url]
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr or 'Failed to fetch branches'}

            branches = []
            for line in result.stdout.strip().split('\n'):
                if line:
                    # Format: <hash>\trefs/heads/<branch>
                    parts = line.split('\t')
                    if len(parts) == 2 and parts[1].startswith('refs/heads/'):
                        branch = parts[1].replace('refs/heads/', '')
                        branches.append(branch)

            return {
                'success': True,
                'branches': sorted(branches)
            }

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Operation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def handle_webhook(cls, app_id: int, payload: Dict) -> Dict:
        """Handle incoming webhook."""
        app_config = cls.get_app_config(app_id)
        if not app_config:
            return {'success': False, 'error': 'App not configured'}

        if not app_config.get('auto_deploy', True):
            return {'success': False, 'error': 'Auto-deploy disabled'}

        # Check if push is to configured branch
        ref = payload.get('ref', '')
        branch = app_config.get('branch', 'main')

        if ref != f'refs/heads/{branch}':
            return {
                'success': True,
                'message': f'Ignoring push to {ref}, configured branch is {branch}'
            }

        # Trigger deployment
        return cls.deploy(app_id)

    @classmethod
    def _log_deployment(cls, deploy_log: Dict) -> None:
        """Log deployment to file."""
        try:
            log_dir = os.path.dirname(cls.DEPLOY_LOG)
            os.makedirs(log_dir, exist_ok=True)

            with open(cls.DEPLOY_LOG, 'a') as f:
                f.write(json.dumps(deploy_log) + '\n')
        except Exception:
            pass

    @classmethod
    def get_deployment_history(cls, app_id: int = None, limit: int = 50) -> List[Dict]:
        """Get deployment history."""
        history = []

        if not os.path.exists(cls.DEPLOY_LOG):
            return history

        try:
            with open(cls.DEPLOY_LOG, 'r') as f:
                lines = f.readlines()

            for line in reversed(lines[-limit * 2:]):  # Read more than needed for filtering
                try:
                    entry = json.loads(line.strip())
                    if app_id is None or entry.get('app_id') == app_id:
                        history.append(entry)
                        if len(history) >= limit:
                            break
                except json.JSONDecodeError:
                    pass

        except Exception:
            pass

        return history

    @classmethod
    def get_git_status(cls, app_path: str) -> Dict:
        """Get Git status for a repository."""
        if not os.path.exists(os.path.join(app_path, '.git')):
            return {'error': 'Not a Git repository'}

        try:
            # Status
            cmd = ['git', '-C', app_path, 'status', '--porcelain']
            result = subprocess.run(cmd, capture_output=True, text=True)
            changes = result.stdout.strip().split('\n') if result.stdout.strip() else []

            # Remote URL
            cmd = ['git', '-C', app_path, 'remote', 'get-url', 'origin']
            result = subprocess.run(cmd, capture_output=True, text=True)
            remote_url = result.stdout.strip() if result.returncode == 0 else None

            # Behind/ahead of remote
            cmd = ['git', '-C', app_path, 'rev-list', '--left-right', '--count', 'HEAD...@{u}']
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                parts = result.stdout.strip().split()
                ahead = int(parts[0]) if len(parts) > 0 else 0
                behind = int(parts[1]) if len(parts) > 1 else 0
            else:
                ahead = behind = 0

            commit_info = cls.get_commit_info(app_path)

            return {
                'is_git_repo': True,
                'remote_url': remote_url,
                'branch': commit_info.get('branch') if commit_info else None,
                'commit': commit_info,
                'changes': len(changes),
                'has_uncommitted': len(changes) > 0,
                'ahead': ahead,
                'behind': behind
            }

        except Exception as e:
            return {'error': str(e)}

    WEBHOOK_LOG = os.path.join(paths.SERVERKIT_LOG_DIR, 'webhooks.log')

    @classmethod
    def log_webhook(cls, app_id: int, provider: str, headers: List, payload: bytes) -> None:
        """Log incoming webhook for debugging."""
        try:
            log_dir = os.path.dirname(cls.WEBHOOK_LOG)
            os.makedirs(log_dir, exist_ok=True)

            # Sanitize headers (remove sensitive tokens)
            safe_headers = {}
            for key, value in headers:
                if 'token' in key.lower() or 'signature' in key.lower() or 'secret' in key.lower():
                    safe_headers[key] = value[:10] + '...' if len(value) > 10 else '***'
                else:
                    safe_headers[key] = value

            log_entry = {
                'timestamp': datetime.now().isoformat(),
                'app_id': app_id,
                'provider': provider,
                'headers': safe_headers,
                'payload_size': len(payload),
                'payload_preview': payload[:500].decode('utf-8', errors='replace') if payload else None
            }

            with open(cls.WEBHOOK_LOG, 'a') as f:
                f.write(json.dumps(log_entry) + '\n')

        except Exception:
            pass

    @classmethod
    def get_webhook_logs(cls, app_id: int = None, limit: int = 50) -> List[Dict]:
        """Get webhook logs for debugging."""
        logs = []

        if not os.path.exists(cls.WEBHOOK_LOG):
            return logs

        try:
            with open(cls.WEBHOOK_LOG, 'r') as f:
                lines = f.readlines()

            for line in reversed(lines[-limit * 2:]):
                try:
                    entry = json.loads(line.strip())
                    if app_id is None or entry.get('app_id') == app_id:
                        logs.append(entry)
                        if len(logs) >= limit:
                            break
                except json.JSONDecodeError:
                    pass

        except Exception:
            pass

        return logs

    # ========================================
    # GITEA SERVER MANAGEMENT
    # ========================================

    GITEA_APP_NAME = 'serverkit-gitea'
    GITEA_CONFIG_FILE = os.path.join(CONFIG_DIR, 'gitea.json')

    @classmethod
    def get_gitea_status(cls) -> Dict:
        """Check if Gitea is installed and running."""
        from app.models import Application

        app = Application.query.filter_by(name=cls.GITEA_APP_NAME).first()

        if not app:
            return {
                'installed': False,
                'running': False,
                'http_port': None,
                'ssh_port': None,
                'url': None,
                'url_path': None
            }

        # Check container status
        running = cls._is_gitea_running()

        # Load config for ports
        config = cls._load_gitea_config()

        return {
            'installed': True,
            'running': running,
            'http_port': app.port or config.get('http_port'),
            'ssh_port': config.get('ssh_port'),
            'url_path': '/gitea',  # Slug-based URL path
            'url': f"http://localhost:{app.port}" if app.port else None,  # Legacy port-based URL
            'app_id': app.id,
            'version': config.get('version', '1.21')
        }

    @classmethod
    def _is_gitea_running(cls) -> bool:
        """Check if Gitea container is running."""
        try:
            result = subprocess.run(
                ['docker', 'ps', '--filter', f'name={cls.GITEA_APP_NAME}', '--format', '{{.Names}}'],
                capture_output=True,
                text=True,
                timeout=10
            )
            return cls.GITEA_APP_NAME in result.stdout
        except Exception:
            return False

    @classmethod
    def _load_gitea_config(cls) -> Dict:
        """Load Gitea configuration."""
        if os.path.exists(cls.GITEA_CONFIG_FILE):
            try:
                with open(cls.GITEA_CONFIG_FILE, 'r') as f:
                    return json.load(f)
            except Exception:
                pass
        return {}

    @classmethod
    def _save_gitea_config(cls, config: Dict) -> bool:
        """Save Gitea configuration."""
        try:
            os.makedirs(cls.CONFIG_DIR, exist_ok=True)
            with open(cls.GITEA_CONFIG_FILE, 'w') as f:
                json.dump(config, f, indent=2)
            return True
        except Exception:
            return False

    @classmethod
    def get_gitea_resource_requirements(cls) -> Dict:
        """Get resource requirements for Gitea installation."""
        return {
            'memory_min': '512MB',
            'memory_recommended': '1GB',
            'storage_min': '5GB',
            'storage_recommended': '20GB',
            'components': [
                {'name': 'Gitea', 'memory': '~300MB', 'storage': '~100MB + repos'},
                {'name': 'PostgreSQL', 'memory': '~200MB', 'storage': '~1GB'}
            ],
            'warning': 'Installation will spin up a PostgreSQL database container'
        }

    @classmethod
    def install_gitea(cls, admin_user: str = 'admin',
                      admin_email: str = None,
                      admin_password: str = None) -> Dict:
        """Install Gitea as integrated ServerKit service."""
        from app.services.template_service import TemplateService
        from app.services.nginx_service import NginxService

        # Check if already installed
        status = cls.get_gitea_status()
        if status['installed']:
            return {'success': False, 'error': 'Gitea is already installed'}

        # Generate secure password if not provided
        generated_password = False
        if not admin_password:
            admin_password = secrets.token_urlsafe(16)
            generated_password = True

        try:
            # Install using template service
            result = TemplateService.install_template(
                template_id='gitea',
                app_name=cls.GITEA_APP_NAME,
                user_variables={},
                user_id=1  # System user
            )

            if not result.get('success'):
                return result

            # Get the variables that were generated
            variables = result.get('variables', {})
            http_port = variables.get('HTTP_PORT')
            ssh_port = variables.get('SSH_PORT')

            # Create nginx config for /gitea path
            nginx_result = NginxService.create_gitea_config(int(http_port))
            if not nginx_result.get('success'):
                # Log warning but don't fail - Gitea still works via port
                print(f"Warning: Failed to create Gitea nginx config: {nginx_result.get('error')}")

            # Save config with admin credentials and ports
            config = {
                'admin_user': admin_user,
                'admin_email': admin_email,
                'http_port': http_port,
                'ssh_port': ssh_port,
                'db_password': variables.get('DB_PASSWORD'),
                'installed_at': datetime.now().isoformat(),
                'version': '1.21',
                'url_path': '/gitea'
            }
            cls._save_gitea_config(config)

            response = {
                'success': True,
                'message': 'Gitea installed successfully',
                'http_port': http_port,
                'ssh_port': ssh_port,
                'url_path': '/gitea',
                'admin_user': admin_user
            }

            # Only include password in response if it was generated
            if generated_password:
                response['admin_password'] = admin_password
                response['warning'] = 'Save these credentials - password shown only once!'

            return response

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def uninstall_gitea(cls, remove_data: bool = False) -> Dict:
        """Uninstall Gitea."""
        from app import db
        from app.models import Application
        from app.services.docker_service import DockerService
        from app.services.nginx_service import NginxService

        app = Application.query.filter_by(name=cls.GITEA_APP_NAME).first()
        if not app:
            return {'success': False, 'error': 'Gitea is not installed'}

        try:
            # Remove nginx config
            NginxService.remove_gitea_config()

            # Stop and remove containers
            if app.root_path and os.path.exists(app.root_path):
                DockerService.compose_down(app.root_path, remove_volumes=remove_data)

                if remove_data:
                    import shutil
                    shutil.rmtree(app.root_path, ignore_errors=True)

            # Remove from database
            db.session.delete(app)
            db.session.commit()

            # Remove config
            if os.path.exists(cls.GITEA_CONFIG_FILE):
                os.remove(cls.GITEA_CONFIG_FILE)

            return {
                'success': True,
                'message': 'Gitea uninstalled successfully',
                'data_removed': remove_data
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def start_gitea(cls) -> Dict:
        """Start Gitea containers."""
        from app import db
        from app.models import Application
        from app.services.docker_service import DockerService

        app = Application.query.filter_by(name=cls.GITEA_APP_NAME).first()
        if not app:
            return {'success': False, 'error': 'Gitea is not installed'}

        if not app.root_path or not os.path.exists(app.root_path):
            return {'success': False, 'error': 'Gitea installation path not found'}

        try:
            result = DockerService.compose_up(app.root_path, detach=True)
            if result.get('success'):
                app.status = 'running'
                db.session.commit()
                return {'success': True, 'message': 'Gitea started'}
            return result
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def stop_gitea(cls) -> Dict:
        """Stop Gitea containers."""
        from app import db
        from app.models import Application
        from app.services.docker_service import DockerService

        app = Application.query.filter_by(name=cls.GITEA_APP_NAME).first()
        if not app:
            return {'success': False, 'error': 'Gitea is not installed'}

        if not app.root_path or not os.path.exists(app.root_path):
            return {'success': False, 'error': 'Gitea installation path not found'}

        try:
            result = DockerService.compose_stop(app.root_path)
            if result.get('success'):
                app.status = 'stopped'
                db.session.commit()
                return {'success': True, 'message': 'Gitea stopped'}
            return result
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def restart_gitea(cls) -> Dict:
        """Restart Gitea containers."""
        stop_result = cls.stop_gitea()
        if not stop_result.get('success'):
            return stop_result
        return cls.start_gitea()
