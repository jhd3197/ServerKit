"""Gitea API Service - Communicates with the local Gitea instance."""

import requests
from typing import Dict, List, Optional
from datetime import datetime


class GiteaAPIService:
    """Service for interacting with the Gitea API."""

    @classmethod
    def _get_base_url(cls) -> Optional[str]:
        """Get the Gitea base URL from config."""
        from app.services.git_service import GitService

        status = GitService.get_gitea_status()
        if not status.get('installed') or not status.get('running'):
            return None

        port = status.get('http_port')
        if not port:
            return None

        return f"http://127.0.0.1:{port}/api/v1"

    @classmethod
    def _get_headers(cls, token: str = None) -> Dict:
        """Get request headers."""
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        if token:
            headers['Authorization'] = f'token {token}'
        return headers

    @classmethod
    def get_server_version(cls) -> Dict:
        """Get Gitea server version."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            response = requests.get(f"{base_url}/version", timeout=5)
            if response.status_code == 200:
                return {'success': True, 'version': response.json()}
            return {'success': False, 'error': f'Status {response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_users(cls, token: str = None) -> Dict:
        """List all users (requires admin token)."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            response = requests.get(
                f"{base_url}/admin/users",
                headers=cls._get_headers(token),
                timeout=10
            )
            if response.status_code == 200:
                return {'success': True, 'users': response.json()}
            elif response.status_code == 401:
                return {'success': False, 'error': 'Authentication required'}
            elif response.status_code == 403:
                return {'success': False, 'error': 'Admin access required'}
            return {'success': False, 'error': f'Status {response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_repositories(cls, token: str = None, limit: int = 50) -> Dict:
        """List all repositories."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            # Try to get all repos (requires token for private repos)
            params = {'limit': limit}
            response = requests.get(
                f"{base_url}/repos/search",
                headers=cls._get_headers(token),
                params=params,
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                repos = data.get('data', [])
                return {
                    'success': True,
                    'repositories': [cls._format_repo(r) for r in repos],
                    'count': len(repos)
                }
            return {'success': False, 'error': f'Status {response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_repository(cls, owner: str, repo: str, token: str = None) -> Dict:
        """Get repository details."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            response = requests.get(
                f"{base_url}/repos/{owner}/{repo}",
                headers=cls._get_headers(token),
                timeout=10
            )

            if response.status_code == 200:
                return {
                    'success': True,
                    'repository': cls._format_repo(response.json())
                }
            elif response.status_code == 404:
                return {'success': False, 'error': 'Repository not found'}
            return {'success': False, 'error': f'Status {response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_branches(cls, owner: str, repo: str, token: str = None) -> Dict:
        """List repository branches."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            response = requests.get(
                f"{base_url}/repos/{owner}/{repo}/branches",
                headers=cls._get_headers(token),
                timeout=10
            )

            if response.status_code == 200:
                branches = response.json()
                return {
                    'success': True,
                    'branches': [cls._format_branch(b) for b in branches],
                    'count': len(branches)
                }
            elif response.status_code == 404:
                return {'success': False, 'error': 'Repository not found'}
            return {'success': False, 'error': f'Status {response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_branch(cls, owner: str, repo: str, branch: str, token: str = None) -> Dict:
        """Get branch details."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            response = requests.get(
                f"{base_url}/repos/{owner}/{repo}/branches/{branch}",
                headers=cls._get_headers(token),
                timeout=10
            )

            if response.status_code == 200:
                return {
                    'success': True,
                    'branch': cls._format_branch(response.json())
                }
            elif response.status_code == 404:
                return {'success': False, 'error': 'Branch not found'}
            return {'success': False, 'error': f'Status {response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_commits(cls, owner: str, repo: str, branch: str = None,
                     page: int = 1, limit: int = 30, token: str = None) -> Dict:
        """List repository commits."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            params = {'page': page, 'limit': limit}
            if branch:
                params['sha'] = branch

            response = requests.get(
                f"{base_url}/repos/{owner}/{repo}/commits",
                headers=cls._get_headers(token),
                params=params,
                timeout=10
            )

            if response.status_code == 200:
                commits = response.json()
                return {
                    'success': True,
                    'commits': [cls._format_commit(c) for c in commits],
                    'count': len(commits),
                    'page': page
                }
            elif response.status_code == 404:
                return {'success': False, 'error': 'Repository not found'}
            return {'success': False, 'error': f'Status {response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_commit(cls, owner: str, repo: str, sha: str, token: str = None) -> Dict:
        """Get commit details."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            response = requests.get(
                f"{base_url}/repos/{owner}/{repo}/git/commits/{sha}",
                headers=cls._get_headers(token),
                timeout=10
            )

            if response.status_code == 200:
                return {
                    'success': True,
                    'commit': cls._format_commit(response.json())
                }
            elif response.status_code == 404:
                return {'success': False, 'error': 'Commit not found'}
            return {'success': False, 'error': f'Status {response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_files(cls, owner: str, repo: str, ref: str = 'main',
                   path: str = '', token: str = None) -> Dict:
        """List files in a repository directory."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            url = f"{base_url}/repos/{owner}/{repo}/contents"
            if path:
                url += f"/{path}"

            params = {'ref': ref}
            response = requests.get(
                url,
                headers=cls._get_headers(token),
                params=params,
                timeout=10
            )

            if response.status_code == 200:
                contents = response.json()
                # Handle both file and directory responses
                if isinstance(contents, list):
                    files = [cls._format_file(f) for f in contents]
                else:
                    files = [cls._format_file(contents)]
                return {
                    'success': True,
                    'files': files,
                    'path': path,
                    'ref': ref
                }
            elif response.status_code == 404:
                return {'success': False, 'error': 'Path not found'}
            return {'success': False, 'error': f'Status {response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_file_content(cls, owner: str, repo: str, filepath: str,
                         ref: str = 'main', token: str = None) -> Dict:
        """Get file content."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            params = {'ref': ref}
            response = requests.get(
                f"{base_url}/repos/{owner}/{repo}/contents/{filepath}",
                headers=cls._get_headers(token),
                params=params,
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                return {
                    'success': True,
                    'file': cls._format_file(data),
                    'content': data.get('content'),
                    'encoding': data.get('encoding', 'base64')
                }
            elif response.status_code == 404:
                return {'success': False, 'error': 'File not found'}
            return {'success': False, 'error': f'Status {response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_readme(cls, owner: str, repo: str, ref: str = None, token: str = None) -> Dict:
        """Get repository README."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            url = f"{base_url}/repos/{owner}/{repo}/readme"
            params = {}
            if ref:
                params['ref'] = ref

            response = requests.get(
                url,
                headers=cls._get_headers(token),
                params=params,
                timeout=10
            )

            if response.status_code == 200:
                data = response.json()
                return {
                    'success': True,
                    'readme': {
                        'name': data.get('name'),
                        'path': data.get('path'),
                        'content': data.get('content'),
                        'encoding': data.get('encoding', 'base64')
                    }
                }
            elif response.status_code == 404:
                return {'success': False, 'error': 'README not found'}
            return {'success': False, 'error': f'Status {response.status_code}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_repo_stats(cls, owner: str, repo: str, token: str = None) -> Dict:
        """Get repository statistics."""
        base_url = cls._get_base_url()
        if not base_url:
            return {'success': False, 'error': 'Gitea is not running'}

        try:
            # Get repo info
            repo_response = requests.get(
                f"{base_url}/repos/{owner}/{repo}",
                headers=cls._get_headers(token),
                timeout=10
            )

            if repo_response.status_code != 200:
                return {'success': False, 'error': 'Repository not found'}

            repo_data = repo_response.json()

            # Get branch count
            branches_response = requests.get(
                f"{base_url}/repos/{owner}/{repo}/branches",
                headers=cls._get_headers(token),
                timeout=10
            )
            branch_count = len(branches_response.json()) if branches_response.status_code == 200 else 0

            # Get recent commits count
            commits_response = requests.get(
                f"{base_url}/repos/{owner}/{repo}/commits",
                headers=cls._get_headers(token),
                params={'limit': 1},
                timeout=10
            )

            return {
                'success': True,
                'stats': {
                    'stars': repo_data.get('stars_count', 0),
                    'forks': repo_data.get('forks_count', 0),
                    'watchers': repo_data.get('watchers_count', 0),
                    'branches': branch_count,
                    'size': repo_data.get('size', 0),
                    'open_issues': repo_data.get('open_issues_count', 0),
                    'default_branch': repo_data.get('default_branch', 'main'),
                    'has_wiki': repo_data.get('has_wiki', False),
                    'has_issues': repo_data.get('has_issues', False)
                }
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== FORMATTING HELPERS ====================

    @classmethod
    def _format_repo(cls, repo: Dict) -> Dict:
        """Format repository data."""
        return {
            'id': repo.get('id'),
            'name': repo.get('name'),
            'full_name': repo.get('full_name'),
            'description': repo.get('description'),
            'private': repo.get('private', False),
            'fork': repo.get('fork', False),
            'empty': repo.get('empty', False),
            'mirror': repo.get('mirror', False),
            'size': repo.get('size', 0),
            'default_branch': repo.get('default_branch', 'main'),
            'stars': repo.get('stars_count', 0),
            'forks': repo.get('forks_count', 0),
            'watchers': repo.get('watchers_count', 0),
            'open_issues': repo.get('open_issues_count', 0),
            'owner': {
                'login': repo.get('owner', {}).get('login'),
                'avatar_url': repo.get('owner', {}).get('avatar_url')
            },
            'html_url': repo.get('html_url'),
            'clone_url': repo.get('clone_url'),
            'ssh_url': repo.get('ssh_url'),
            'created_at': repo.get('created_at'),
            'updated_at': repo.get('updated_at'),
            'pushed_at': repo.get('pushed_at')
        }

    @classmethod
    def _format_branch(cls, branch: Dict) -> Dict:
        """Format branch data."""
        commit = branch.get('commit', {})
        return {
            'name': branch.get('name'),
            'protected': branch.get('protected', False),
            'commit': {
                'sha': commit.get('id') or commit.get('sha'),
                'message': commit.get('message'),
                'author': commit.get('author', {}).get('name') if commit.get('author') else None,
                'date': commit.get('timestamp') or commit.get('committer', {}).get('date')
            }
        }

    @classmethod
    def _format_commit(cls, commit: Dict) -> Dict:
        """Format commit data."""
        commit_data = commit.get('commit', commit)
        author = commit_data.get('author', {})
        committer = commit_data.get('committer', {})

        return {
            'sha': commit.get('sha') or commit.get('id'),
            'short_sha': (commit.get('sha') or commit.get('id', ''))[:7],
            'message': commit_data.get('message', ''),
            'author': {
                'name': author.get('name'),
                'email': author.get('email'),
                'date': author.get('date')
            },
            'committer': {
                'name': committer.get('name'),
                'email': committer.get('email'),
                'date': committer.get('date')
            },
            'html_url': commit.get('html_url'),
            'parents': [p.get('sha') for p in commit.get('parents', [])]
        }

    @classmethod
    def _format_file(cls, file: Dict) -> Dict:
        """Format file data."""
        return {
            'name': file.get('name'),
            'path': file.get('path'),
            'type': file.get('type'),  # 'file' or 'dir'
            'size': file.get('size', 0),
            'sha': file.get('sha'),
            'html_url': file.get('html_url'),
            'download_url': file.get('download_url')
        }
