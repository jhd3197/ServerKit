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
from app.utils.config_store import load_json_config, save_json_config
from app.utils.system import run_checked
from app.utils.git_security import (
    git_argv,
    git_env,
    validate_clone_path,
    validate_ref_name,
    validate_repo_url,
)


class GitService:
    """Service for Git deployment and webhooks."""

    CONFIG_DIR = paths.SERVERKIT_CONFIG_DIR
    DEPLOY_CONFIG = os.path.join(CONFIG_DIR, 'deployments.json')
    DEPLOY_LOG = os.path.join(paths.SERVERKIT_LOG_DIR, 'deployments.log')

    @classmethod
    def get_config(cls) -> Dict:
        """Get deployment configuration."""
        return load_json_config(cls.DEPLOY_CONFIG, {
            'apps': {},  # app_id -> deployment config
            'webhook_secret': cls._generate_secret()
        })

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save deployment configuration."""
        return save_json_config(cls.DEPLOY_CONFIG, config)

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

    @staticmethod
    def _git_out(app_path, *args, timeout=None):
        """stdout of a read-only ``git -C <app_path> <args>``, or ``None``.

        ``None`` means the command did not succeed — not "empty output" (§A).
        ``get_commit_info`` alone had five copies of
        ``subprocess.run(...); x = result.stdout.strip() if result.returncode
        == 0 else None``, which is this function written out by hand each time.
        """
        result = run_checked(['git', '-C', app_path, *args], timeout=timeout)
        return result['output'].strip() if result['success'] else None

    @classmethod
    def clone_repository(cls, app_path: str, repo_url: str, branch: str = 'main') -> Dict:
        """Clone a Git repository."""
        # GHSA-8vx6-432p-h62q: repo_url and app_path are user-controlled on
        # several routes. Validate both and terminate options with '--' — the
        # terminator is load-bearing: protocol pinning alone does not stop
        # option injection such as app_path='--upload-pack=<cmd>'.
        url_error = validate_repo_url(repo_url)
        if url_error:
            return {'success': False, 'error': url_error}
        path_error = validate_clone_path(app_path)
        if path_error:
            return {'success': False, 'error': path_error}
        ref_error = validate_ref_name(branch, 'branch')
        if ref_error:
            return {'success': False, 'error': ref_error}

        try:
            # Remove existing directory if exists
            if os.path.exists(app_path):
                return {'success': False, 'error': 'Directory already exists'}

            cmd = git_argv('clone')
            if branch:
                cmd.extend(['--branch', branch, '--single-branch'])
            cmd.extend(['--', repo_url, app_path])
            result = run_checked(cmd, timeout=300, env=git_env())

            if result['success']:
                return {
                    'success': True,
                    'message': f'Repository cloned to {app_path}',
                    'path': app_path
                }
            return {'success': False, 'error': result['error']}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Clone operation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def pull_changes(cls, app_path: str, branch: str = None) -> Dict:
        """Pull latest changes from remote."""
        if not os.path.exists(os.path.join(app_path, '.git')):
            return {'success': False, 'error': 'Not a Git repository'}

        ref_error = validate_ref_name(branch, 'branch')
        if ref_error:
            return {'success': False, 'error': ref_error}

        try:
            # Get current branch if not specified
            if not branch:
                branch = cls._git_out(app_path, 'rev-parse', '--abbrev-ref', 'HEAD') or 'main'

            # Fetch that branch by explicit refspec: imports clone with
            # --single-branch, so `fetch --all` never brought in a branch the
            # app was switched to later, and the reset below failed.
            fetch_cmd = git_argv('-C', app_path, 'fetch', 'origin',
                                 f'+refs/heads/{branch}:refs/remotes/origin/{branch}')
            fetched = run_checked(fetch_cmd, timeout=60, env=git_env())
            if not fetched['success']:
                return {'success': False, 'error': fetched['error'] or f'Could not fetch {branch}'}

            # Reset to remote branch (force pull)
            reset_cmd = git_argv('-C', app_path, 'reset', '--hard', f'origin/{branch}')
            result = run_checked(reset_cmd, timeout=60, env=git_env())

            if result['success']:
                # Get new commit info
                commit_info = cls.get_commit_info(app_path)
                return {
                    'success': True,
                    'message': 'Changes pulled successfully',
                    'commit': commit_info
                }
            return {'success': False, 'error': result['error']}

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
            commit_hash = cls._git_out(app_path, 'rev-parse', 'HEAD')
            commit_message = cls._git_out(app_path, 'log', '-1', '--pretty=%B')
            author = cls._git_out(app_path, 'log', '-1', '--pretty=%an <%ae>')
            timestamp = cls._git_out(app_path, 'log', '-1', '--pretty=%ci')
            branch = cls._git_out(app_path, 'rev-parse', '--abbrev-ref', 'HEAD')

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
    def deploy(cls, app_id: int, force: bool = False, trigger: str = 'manual') -> Dict:
        """Deploy an application from Git."""
        app_config = cls.get_app_config(app_id)
        if not app_config:
            return {'success': False, 'error': 'Deployment not configured'}

        # A Docker app's code only reaches users once its containers are
        # rebuilt, so it deploys through the same job as "Deploy latest"
        # (which pulls the configured branch itself). Pulling alone — what a
        # push webhook used to do — left the old containers serving.
        from app.models.application import Application
        app = Application.query_active().filter_by(id=app_id).first()
        if app and app.app_type == 'docker':
            # Pull now as well: a webhook re-reads serverkit.yaml right after
            # this returns and must see the new commit. The job's own pull is
            # then a no-op.
            pulled = cls.pull_changes(app_config['app_path'], app_config.get('branch', 'main'))
            if not pulled['success']:
                return {'success': False, 'error': f"Pull failed: {pulled['error']}"}
            from app.services.deployment_job_service import DeploymentJobService
            queued = DeploymentJobService.enqueue_app_deploy(app, trigger=trigger)
            if not queued.get('success'):
                return {'success': False, 'error': queued.get('error') or 'Failed to queue deployment'}
            return {'success': True, 'message': 'Deployment queued', 'deploy_job_id': queued.get('job_id')}

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
            result = run_checked(['bash', '-c', script], cwd=working_dir, timeout=300)

            return {
                'success': result['success'],
                'output': result['output'],
                'error': result['error'],
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
            run_checked(['git', '-C', app_path, 'fetch', '--all', '--prune'], timeout=60)

            # Get remote branches
            result = run_checked(
                ['git', '-C', app_path, 'branch', '-r', '--format=%(refname:short)'],
                timeout=30)

            if not result['success']:
                return {'success': False, 'error': result['error']}

            branches = []
            for line in result['output'].strip().split('\n'):
                branch = line.strip()
                if branch and not branch.endswith('/HEAD'):
                    # Remove origin/ prefix
                    if branch.startswith('origin/'):
                        branch = branch[7:]
                    branches.append(branch)

            current_branch = cls._git_out(app_path, 'rev-parse', '--abbrev-ref', 'HEAD')

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
        # GHSA-8vx6-432p-h62q: reachable by any authenticated role via
        # POST /deploy/branches. Validate the URL (blocks ext::/file:// and
        # option injection) and pin protocols regardless of host git version.
        url_error = validate_repo_url(repo_url)
        if url_error:
            return {'success': False, 'error': url_error}

        try:
            cmd = git_argv('ls-remote', '--heads', '--', repo_url)
            result = run_checked(cmd, timeout=30, env=git_env())

            if not result['success']:
                return {'success': False, 'error': result['error']}

            branches = []
            for line in result['output'].strip().split('\n'):
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
            return {'success': False, 'error': 'This service has no Git deployment set up'}

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

        # Emit a panel event so Automations (tramo) workflows can trigger on a
        # git push through the events bridge (plan 45 Ph4, ported from the
        # retired Workflow Builder's 'git_push').
        try:
            from app.services.event_service import EventService
            EventService.emit('git.push', {
                'event': 'git.push',
                'app_id': app_id,
                'branch': branch,
                'ref': ref,
            })
        except Exception:
            pass

        # Trigger deployment
        result = cls.deploy(app_id, trigger='webhook')

        # Push-to-reconfigure: re-read serverkit.yaml at the new commit and
        # reconcile (plan 17 #17). Best-effort — never affects the deploy result.
        try:
            from app.services.manifest_sync_service import ManifestSyncService
            commit = (payload.get('after')
                      or (payload.get('head_commit') or {}).get('id'))
            manifest_sync = ManifestSyncService.resync_for_app(app_id, commit=commit,
                                                               trigger='webhook')
            if isinstance(result, dict):
                result['manifest_sync'] = manifest_sync
        except Exception:
            pass

        return result

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
            porcelain = cls._git_out(app_path, 'status', '--porcelain') or ''
            changes = porcelain.split('\n') if porcelain else []

            # Remote URL
            remote_url = cls._git_out(app_path, 'remote', 'get-url', 'origin')

            # Behind/ahead of remote
            counts = cls._git_out(app_path, 'rev-list', '--left-right', '--count',
                                  'HEAD...@{u}')
            if counts is not None:
                parts = counts.split()
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

    # ------------------------------------------------------------------
    # The Gitea self-host half (install/lifecycle/config + repo browsing
    # via GiteaAPIService) moved to the serverkit-git extension (plan 52
    # Phase 6). Everything above IS the deploy pipeline and stays core:
    # apps.py / buildpacks.py / deploy.py / deployment_service.py /
    # manifest_apply_service.py import it, extension installed or not.
    # NginxService.create/remove/get_gitea_config remain core helpers the
    # extension calls (the WP two-speed seam shape).
    # ------------------------------------------------------------------
