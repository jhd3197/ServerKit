"""
Git WordPress Service

Connect Git repositories to WordPress wp-content for theme/plugin management.
Supports deployment from specific commits and creating dev environments for any revision.
"""

import os
import subprocess
import shutil
import json
from datetime import datetime
from typing import Dict, List, Optional

from app import db
from app.models.wordpress_site import WordPressSite, DatabaseSnapshot
from app.services.db_sync_service import DatabaseSyncService
from app.services.wordpress_env_service import WordPressEnvService


class GitWordPressService:
    """Connect Git repositories to WordPress wp-content."""

    DEFAULT_PATHS = ['wp-content/themes', 'wp-content/plugins']

    @classmethod
    def connect_repo(cls, site_id: int, repo_url: str, branch: str = 'main',
                     paths: List[str] = None, auto_deploy: bool = False) -> Dict:
        """
        Connect a Git repository to a WordPress site.

        Args:
            site_id: ID of the WordPressSite
            repo_url: Git repository URL (HTTPS or SSH)
            branch: Branch to track (default: main)
            paths: What to sync (default: ['wp-content/themes', 'wp-content/plugins'])
            auto_deploy: Enable automatic deployment on push

        Returns:
            Dict with success status
        """
        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        if not site.application or not site.application.root_path:
            return {'success': False, 'error': 'Site application path not found'}

        wp_path = site.application.root_path
        paths = paths or cls.DEFAULT_PATHS

        try:
            # Validate repository URL
            if not cls._validate_repo_url(repo_url):
                return {'success': False, 'error': 'Invalid repository URL'}

            # Test repository access
            test_result = cls._test_repo_access(repo_url)
            if not test_result['success']:
                return test_result

            # Initialize git in wp-content if not exists
            wp_content_path = os.path.join(wp_path, 'wp-content')
            git_result = cls._init_git_tracking(wp_content_path, repo_url, branch)
            if not git_result['success']:
                return git_result

            # Update site record
            site.git_repo_url = repo_url
            site.git_branch = branch
            site.git_paths = json.dumps(paths)
            site.auto_deploy = auto_deploy

            db.session.commit()

            return {
                'success': True,
                'message': f'Repository connected successfully',
                'repo_url': repo_url,
                'branch': branch,
                'paths': paths
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def disconnect_repo(cls, site_id: int) -> Dict:
        """
        Disconnect a Git repository from a WordPress site.

        Args:
            site_id: ID of the WordPressSite

        Returns:
            Dict with success status
        """
        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        try:
            # Remove git tracking from wp-content
            if site.application and site.application.root_path:
                wp_content_path = os.path.join(site.application.root_path, 'wp-content')
                git_dir = os.path.join(wp_content_path, '.git')
                if os.path.exists(git_dir):
                    shutil.rmtree(git_dir)

            # Clear git settings
            site.git_repo_url = None
            site.git_branch = None
            site.git_paths = None
            site.auto_deploy = False
            site.last_deploy_commit = None
            site.last_deploy_at = None

            db.session.commit()

            return {'success': True, 'message': 'Repository disconnected'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def deploy_from_commit(cls, site_id: int, commit_sha: str = None,
                           branch: str = None, create_snapshot: bool = True) -> Dict:
        """
        Deploy a specific commit or branch to the WordPress site.

        Args:
            site_id: ID of the WordPressSite
            commit_sha: Specific commit SHA to deploy (optional)
            branch: Branch name to deploy latest from (optional)
            create_snapshot: Create a database snapshot before deploying

        Returns:
            Dict with success status and deployment info
        """
        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        if not site.git_repo_url:
            return {'success': False, 'error': 'No repository connected'}

        if not site.application or not site.application.root_path:
            return {'success': False, 'error': 'Site application path not found'}

        wp_content_path = os.path.join(site.application.root_path, 'wp-content')

        try:
            # Create pre-deploy snapshot
            if create_snapshot:
                snapshot_result = DatabaseSyncService.create_snapshot(
                    db_name=site.db_name,
                    name=f"pre_deploy_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                    tag='pre-deploy',
                    commit_sha=site.last_deploy_commit,
                    host=site.db_host,
                    user=site.db_user,
                    password=WordPressEnvService._get_db_password(site)
                )

                if snapshot_result['success']:
                    # Save snapshot to database
                    snapshot = DatabaseSnapshot(
                        site_id=site.id,
                        name=snapshot_result['snapshot']['name'],
                        tag='pre-deploy',
                        file_path=snapshot_result['snapshot']['file_path'],
                        size_bytes=snapshot_result['snapshot']['size_bytes'],
                        compressed=snapshot_result['snapshot']['compressed'],
                        commit_sha=site.last_deploy_commit,
                        tables_included=json.dumps(snapshot_result['snapshot'].get('tables', [])),
                        row_count=snapshot_result['snapshot'].get('row_count', 0),
                        status='completed'
                    )
                    db.session.add(snapshot)

            # Fetch latest from remote
            fetch_result = cls._run_git(wp_content_path, ['fetch', 'origin'])
            if not fetch_result['success']:
                return fetch_result

            # Determine what to checkout
            if commit_sha:
                target = commit_sha
            elif branch:
                target = f'origin/{branch}'
            else:
                target = f'origin/{site.git_branch}'

            # Checkout the target
            checkout_result = cls._run_git(wp_content_path, ['checkout', target, '--force'])
            if not checkout_result['success']:
                return checkout_result

            # Get the actual commit SHA we deployed
            rev_result = cls._run_git(wp_content_path, ['rev-parse', 'HEAD'])
            deployed_sha = rev_result['output'].strip() if rev_result['success'] else commit_sha

            # Get commit message
            msg_result = cls._run_git(wp_content_path, ['log', '-1', '--format=%s'])
            commit_message = msg_result['output'].strip() if msg_result['success'] else ''

            # Update site record
            site.last_deploy_commit = deployed_sha
            site.last_deploy_at = datetime.utcnow()

            db.session.commit()

            return {
                'success': True,
                'message': 'Deployment successful',
                'commit_sha': deployed_sha,
                'commit_message': commit_message,
                'pre_deploy_snapshot': snapshot_result.get('snapshot', {}).get('file_path') if create_snapshot else None
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def create_dev_for_commit(cls, production_site_id: int, commit_sha: str,
                              config: Dict, user_id: int) -> Dict:
        """
        Create a development environment for a specific commit.

        This creates a full dev environment with:
        - Database snapshot from nearest point in time (or current)
        - Code checked out at the specified commit
        - URL search-replace applied

        Args:
            production_site_id: ID of the production WordPressSite
            commit_sha: Git commit SHA to create dev for
            config: Environment configuration (name, domain, etc.)
            user_id: User ID creating the environment

        Returns:
            Dict with success status and dev environment info
        """
        prod_site = WordPressSite.query.get(production_site_id)
        if not prod_site:
            return {'success': False, 'error': 'Production site not found'}

        if not prod_site.is_production:
            return {'success': False, 'error': 'Source site is not a production site'}

        if not prod_site.git_repo_url:
            return {'success': False, 'error': 'No repository connected to production site'}

        try:
            # Get short SHA for naming
            short_sha = commit_sha[:7]

            # Set defaults in config
            if not config.get('name'):
                config['name'] = f"{prod_site.application.name} @ {short_sha}"

            if not config.get('domain'):
                # Try to create subdomain from production domain
                if prod_site.application.domains:
                    prod_domain = prod_site.application.domains[0].domain
                    config['domain'] = f"{short_sha}.dev.{prod_domain}"

            # Create the environment using WordPressEnvService
            env_result = WordPressEnvService.create_environment(
                production_site_id=production_site_id,
                env_type='development',
                config=config,
                user_id=user_id
            )

            if not env_result['success']:
                return env_result

            env_site_id = env_result['environment']['id']
            env_site = WordPressSite.query.get(env_site_id)

            # Checkout the specific commit
            if env_site and env_site.application:
                wp_content_path = os.path.join(env_site.application.root_path, 'wp-content')

                # Initialize git in the new environment
                init_result = cls._init_git_tracking(
                    wp_content_path,
                    prod_site.git_repo_url,
                    prod_site.git_branch
                )

                if init_result['success']:
                    # Fetch and checkout specific commit
                    cls._run_git(wp_content_path, ['fetch', 'origin'])
                    checkout_result = cls._run_git(wp_content_path, ['checkout', commit_sha, '--force'])

                    if checkout_result['success']:
                        env_site.last_deploy_commit = commit_sha
                        env_site.last_deploy_at = datetime.utcnow()
                        db.session.commit()

            return {
                'success': True,
                'message': f'Development environment created for commit {short_sha}',
                'environment': env_site.to_dict() if env_site else env_result['environment'],
                'commit_sha': commit_sha,
                'url': f"https://{config.get('domain')}" if config.get('domain') else None
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_recent_commits(cls, site_id: int, limit: int = 20) -> Dict:
        """
        Get recent commits from the repository.

        Args:
            site_id: ID of the WordPressSite
            limit: Maximum number of commits to return

        Returns:
            Dict with list of commits
        """
        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        if not site.git_repo_url:
            return {'success': False, 'error': 'No repository connected'}

        if not site.application or not site.application.root_path:
            return {'success': False, 'error': 'Site application path not found'}

        wp_content_path = os.path.join(site.application.root_path, 'wp-content')

        try:
            # Fetch latest
            cls._run_git(wp_content_path, ['fetch', 'origin'])

            # Get commit log
            log_format = '%H|%h|%s|%an|%ae|%ai'
            log_result = cls._run_git(wp_content_path, [
                'log',
                f'origin/{site.git_branch}',
                f'-{limit}',
                f'--format={log_format}'
            ])

            if not log_result['success']:
                return log_result

            commits = []
            for line in log_result['output'].strip().split('\n'):
                if not line:
                    continue
                parts = line.split('|')
                if len(parts) >= 6:
                    commits.append({
                        'sha': parts[0],
                        'short_sha': parts[1],
                        'message': parts[2],
                        'author_name': parts[3],
                        'author_email': parts[4],
                        'date': parts[5],
                        'is_deployed': parts[0] == site.last_deploy_commit
                    })

            return {
                'success': True,
                'commits': commits,
                'current_deploy': site.last_deploy_commit
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_branches(cls, site_id: int) -> Dict:
        """
        List remote branches for a site's connected repository.

        Args:
            site_id: ID of the WordPressSite

        Returns:
            Dict with list of branches and their latest commit info
        """
        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        if not site.git_repo_url:
            return {'success': False, 'error': 'No repository connected'}

        if not site.application or not site.application.root_path:
            return {'success': False, 'error': 'Site application path not found'}

        wp_content_path = os.path.join(site.application.root_path, 'wp-content')
        git_dir = os.path.join(wp_content_path, '.git')

        try:
            if os.path.exists(git_dir):
                # Fetch latest from remote
                cls._run_git(wp_content_path, ['fetch', '--prune', 'origin'])

                # List remote branches with latest commit info
                log_format = '%(refname:short)|%(objectname:short)|%(subject)|%(authorname)|%(creatordate:iso8601)'
                result = cls._run_git(wp_content_path, [
                    'for-each-ref',
                    '--sort=-creatordate',
                    f'--format={log_format}',
                    'refs/remotes/origin/'
                ])
            else:
                # No local clone — use ls-remote to list branches
                result = subprocess.run(
                    ['git', 'ls-remote', '--heads', site.git_repo_url],
                    capture_output=True, text=True, timeout=30
                )
                if result.returncode != 0:
                    return {'success': False, 'error': f'Failed to list branches: {result.stderr}'}

                branches = []
                for line in result.stdout.strip().split('\n'):
                    if not line:
                        continue
                    sha, ref = line.split('\t')
                    branch_name = ref.replace('refs/heads/', '')
                    branches.append({
                        'name': branch_name,
                        'short_sha': sha[:7],
                        'message': '',
                        'author': '',
                        'date': '',
                        'is_current': branch_name == site.git_branch,
                    })
                return {'success': True, 'branches': branches}

            if not result['success']:
                return result

            branches = []
            existing_multidevs = set()
            for env in site.environments:
                if env.environment_type == 'multidev' and env.multidev_branch:
                    existing_multidevs.add(env.multidev_branch)

            for line in result['output'].strip().split('\n'):
                if not line:
                    continue
                parts = line.split('|')
                if len(parts) < 5:
                    continue

                ref_name = parts[0]
                # Strip 'origin/' prefix
                branch_name = ref_name.replace('origin/', '', 1)

                # Skip HEAD pointer
                if branch_name == 'HEAD':
                    continue

                branches.append({
                    'name': branch_name,
                    'short_sha': parts[1],
                    'message': parts[2],
                    'author': parts[3],
                    'date': parts[4],
                    'is_current': branch_name == site.git_branch,
                    'has_multidev': branch_name in existing_multidevs,
                })

            return {
                'success': True,
                'branches': branches,
                'current_branch': site.git_branch,
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def rollback_to_commit(cls, site_id: int, commit_sha: str) -> Dict:
        """
        Rollback a site to a previous commit.

        Args:
            site_id: ID of the WordPressSite
            commit_sha: Commit SHA to rollback to

        Returns:
            Dict with success status
        """
        # This is essentially the same as deploy_from_commit
        return cls.deploy_from_commit(site_id, commit_sha=commit_sha, create_snapshot=True)

    @classmethod
    def get_git_status(cls, site_id: int) -> Dict:
        """
        Get the Git status for a site.

        Args:
            site_id: ID of the WordPressSite

        Returns:
            Dict with Git status information
        """
        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        result = {
            'success': True,
            'connected': bool(site.git_repo_url),
            'repo_url': site.git_repo_url,
            'branch': site.git_branch,
            'auto_deploy': site.auto_deploy,
            'last_deploy_commit': site.last_deploy_commit,
            'last_deploy_at': site.last_deploy_at.isoformat() if site.last_deploy_at else None,
            'paths': json.loads(site.git_paths) if site.git_paths else None
        }

        if site.git_repo_url and site.application and site.application.root_path:
            wp_content_path = os.path.join(site.application.root_path, 'wp-content')

            # Check if there are uncommitted changes
            status_result = cls._run_git(wp_content_path, ['status', '--porcelain'])
            if status_result['success']:
                result['has_local_changes'] = bool(status_result['output'].strip())

            # Check if behind remote
            cls._run_git(wp_content_path, ['fetch', 'origin'])
            behind_result = cls._run_git(wp_content_path, [
                'rev-list',
                '--count',
                f'HEAD..origin/{site.git_branch}'
            ])
            if behind_result['success']:
                result['commits_behind'] = int(behind_result['output'].strip() or 0)

        return result

    @classmethod
    def _validate_repo_url(cls, url: str) -> bool:
        """Validate a Git repository URL."""
        if not url:
            return False

        # Accept HTTPS URLs
        if url.startswith('https://'):
            return True

        # Accept SSH URLs
        if url.startswith('git@') or url.startswith('ssh://'):
            return True

        return False

    @classmethod
    def _test_repo_access(cls, repo_url: str) -> Dict:
        """Test if we can access the repository."""
        try:
            result = subprocess.run(
                ['git', 'ls-remote', '--exit-code', repo_url],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode == 0:
                return {'success': True}
            else:
                return {
                    'success': False,
                    'error': f'Cannot access repository: {result.stderr or "Authentication failed or repository not found"}'
                }

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Connection to repository timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _init_git_tracking(cls, path: str, repo_url: str, branch: str) -> Dict:
        """Initialize Git tracking in a directory."""
        try:
            git_dir = os.path.join(path, '.git')

            if os.path.exists(git_dir):
                # Already initialized, just update remote
                cls._run_git(path, ['remote', 'set-url', 'origin', repo_url])
            else:
                # Initialize new repo
                init_result = cls._run_git(path, ['init'])
                if not init_result['success']:
                    return init_result

                # Add remote
                remote_result = cls._run_git(path, ['remote', 'add', 'origin', repo_url])
                if not remote_result['success']:
                    return remote_result

            # Fetch from remote
            fetch_result = cls._run_git(path, ['fetch', 'origin'])
            if not fetch_result['success']:
                return fetch_result

            return {'success': True}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _run_git(cls, cwd: str, args: List[str]) -> Dict:
        """Run a Git command."""
        try:
            cmd = ['git'] + args
            result = subprocess.run(
                cmd,
                cwd=cwd,
                capture_output=True,
                text=True,
                timeout=120
            )

            return {
                'success': result.returncode == 0,
                'output': result.stdout,
                'error': result.stderr if result.returncode != 0 else None
            }

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Git command timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
