"""
Template Service - Manages application templates for one-click deployment.

Supports:
- YAML-based template schema
- Docker Compose compatibility
- Variable substitution
- Post-install scripts
- Template repositories (local + remote)
- Update mechanism
"""

import os
import re
import yaml
import json
import shutil
import secrets
import string
import hashlib
import subprocess
from datetime import datetime
from typing import Dict, List, Optional, Any
from pathlib import Path
import requests


class TemplateService:
    """Service for managing and deploying application templates."""

    CONFIG_DIR = '/etc/serverkit'
    TEMPLATES_DIR = '/etc/serverkit/templates'
    INSTALLED_DIR = '/var/serverkit/apps'
    TEMPLATE_CONFIG = os.path.join(CONFIG_DIR, 'templates.json')

    # Default template repository
    DEFAULT_REPOS = [
        {
            'name': 'serverkit-official',
            'url': 'https://raw.githubusercontent.com/serverkit/templates/main',
            'enabled': True
        }
    ]

    # Template schema version
    SCHEMA_VERSION = '1.0'

    @classmethod
    def get_config(cls) -> Dict:
        """Get template configuration."""
        if os.path.exists(cls.TEMPLATE_CONFIG):
            try:
                with open(cls.TEMPLATE_CONFIG, 'r') as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            'repos': cls.DEFAULT_REPOS,
            'installed': {},
            'last_sync': None
        }

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save template configuration."""
        try:
            os.makedirs(cls.CONFIG_DIR, exist_ok=True)
            with open(cls.TEMPLATE_CONFIG, 'w') as f:
                json.dump(config, f, indent=2)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def validate_template(cls, template: Dict) -> Dict:
        """Validate a template against the schema."""
        errors = []

        # Required fields
        required = ['name', 'version', 'description']
        for field in required:
            if field not in template:
                errors.append(f"Missing required field: {field}")

        # Must have either compose or dockerfile
        if 'compose' not in template and 'dockerfile' not in template:
            errors.append("Template must have either 'compose' or 'dockerfile'")

        # Validate compose structure
        if 'compose' in template:
            compose = template['compose']
            if 'services' not in compose:
                errors.append("Compose section must have 'services'")

        # Validate variables (support both list and dict formats)
        if 'variables' in template:
            variables = template['variables']
            if isinstance(variables, list):
                # List format: [{name: 'PORT', type: 'port', ...}, ...]
                for var in variables:
                    if not isinstance(var, dict):
                        errors.append("Each variable in list must be a dictionary")
                    elif 'name' not in var:
                        errors.append("Each variable must have a 'name' field")
            elif isinstance(variables, dict):
                # Dict format: {PORT: {type: 'port', ...}, ...}
                for var_name, var_config in variables.items():
                    if not isinstance(var_config, dict):
                        errors.append(f"Variable {var_name} must be a dictionary")

        if errors:
            return {'valid': False, 'errors': errors}
        return {'valid': True}

    @classmethod
    def parse_template(cls, template_path: str) -> Dict:
        """Parse a template file."""
        try:
            with open(template_path, 'r') as f:
                template = yaml.safe_load(f)

            validation = cls.validate_template(template)
            if not validation['valid']:
                return {'success': False, 'errors': validation['errors']}

            return {'success': True, 'template': template}
        except yaml.YAMLError as e:
            return {'success': False, 'error': f"YAML parse error: {e}"}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def generate_value(cls, var_config: Dict) -> str:
        """Generate a value for a variable based on its configuration."""
        var_type = var_config.get('type', 'string')
        default = var_config.get('default', '')

        if var_type == 'password':
            length = var_config.get('length', 32)
            chars = string.ascii_letters + string.digits
            if var_config.get('special_chars', False):
                chars += '!@#$%^&*'
            return ''.join(secrets.choice(chars) for _ in range(length))

        elif var_type == 'port':
            # Find available port starting from default
            import socket
            start_port = int(default) if default else 8000
            for port in range(start_port, start_port + 100):
                try:
                    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                    sock.bind(('', port))
                    sock.close()
                    return str(port)
                except OSError:
                    continue
            return str(start_port)

        elif var_type == 'uuid':
            import uuid
            return str(uuid.uuid4())

        elif var_type == 'random':
            length = var_config.get('length', 16)
            return secrets.token_hex(length // 2)

        return str(default)

    @classmethod
    def substitute_variables(cls, content: str, variables: Dict) -> str:
        """Substitute variables in content using ${VAR} syntax."""
        def replace_var(match):
            var_name = match.group(1)
            return str(variables.get(var_name, match.group(0)))

        # Replace ${VAR} patterns
        pattern = r'\$\{([A-Z_][A-Z0-9_]*)\}'
        return re.sub(pattern, replace_var, content)

    @classmethod
    def substitute_in_dict(cls, data: Any, variables: Dict) -> Any:
        """Recursively substitute variables in a dictionary."""
        if isinstance(data, str):
            return cls.substitute_variables(data, variables)
        elif isinstance(data, dict):
            return {k: cls.substitute_in_dict(v, variables) for k, v in data.items()}
        elif isinstance(data, list):
            return [cls.substitute_in_dict(item, variables) for item in data]
        return data

    @classmethod
    def generate_compose(cls, template: Dict, variables: Dict) -> str:
        """Generate docker-compose.yml from template."""
        compose = template.get('compose', {})

        # Substitute variables
        compose = cls.substitute_in_dict(compose, variables)

        # Add version if not present
        if 'version' not in compose:
            compose = {'version': '3.8', **compose}

        return yaml.dump(compose, default_flow_style=False, sort_keys=False)

    @classmethod
    def list_local_templates(cls) -> List[Dict]:
        """List locally available templates."""
        templates = []

        if not os.path.exists(cls.TEMPLATES_DIR):
            return templates

        for filename in os.listdir(cls.TEMPLATES_DIR):
            if filename.endswith('.yaml') or filename.endswith('.yml'):
                filepath = os.path.join(cls.TEMPLATES_DIR, filename)
                result = cls.parse_template(filepath)
                if result.get('success'):
                    template = result['template']
                    templates.append({
                        'id': filename.rsplit('.', 1)[0],
                        'name': template.get('name'),
                        'version': template.get('version'),
                        'description': template.get('description'),
                        'icon': template.get('icon'),
                        'categories': template.get('categories', []),
                        'source': 'local',
                        'filepath': filepath
                    })

        return templates

    @classmethod
    def fetch_remote_templates(cls, repo_url: str) -> List[Dict]:
        """Fetch templates from a remote repository."""
        templates = []

        try:
            # Fetch index.json from repo
            index_url = f"{repo_url}/index.json"
            response = requests.get(index_url, timeout=30)
            response.raise_for_status()

            index = response.json()
            for template_info in index.get('templates', []):
                template_info['source'] = 'remote'
                template_info['repo_url'] = repo_url
                templates.append(template_info)

        except Exception as e:
            print(f"Failed to fetch templates from {repo_url}: {e}")

        return templates

    @classmethod
    def list_all_templates(cls, category: str = None, search: str = None) -> List[Dict]:
        """List all available templates from all sources."""
        templates = []

        # Local templates
        templates.extend(cls.list_local_templates())

        # Remote templates
        config = cls.get_config()
        for repo in config.get('repos', []):
            if repo.get('enabled', True):
                templates.extend(cls.fetch_remote_templates(repo['url']))

        # Filter by category
        if category:
            templates = [t for t in templates if category in t.get('categories', [])]

        # Search filter
        if search:
            search_lower = search.lower()
            templates = [
                t for t in templates
                if search_lower in t.get('name', '').lower()
                or search_lower in t.get('description', '').lower()
            ]

        return templates

    @classmethod
    def get_template(cls, template_id: str) -> Dict:
        """Get full template details."""
        # Check local first
        for ext in ['.yaml', '.yml']:
            filepath = os.path.join(cls.TEMPLATES_DIR, f"{template_id}{ext}")
            if os.path.exists(filepath):
                result = cls.parse_template(filepath)
                if result.get('success'):
                    template = result['template']
                    template['source'] = 'local'
                    template['filepath'] = filepath
                    return {'success': True, 'template': template}
                return result

        # Check remote repos
        config = cls.get_config()
        for repo in config.get('repos', []):
            if not repo.get('enabled', True):
                continue

            try:
                url = f"{repo['url']}/templates/{template_id}.yaml"
                response = requests.get(url, timeout=30)
                if response.status_code == 200:
                    template = yaml.safe_load(response.text)
                    validation = cls.validate_template(template)
                    if validation['valid']:
                        template['source'] = 'remote'
                        template['repo_url'] = repo['url']
                        return {'success': True, 'template': template}
            except Exception:
                continue

        return {'success': False, 'error': 'Template not found'}

    @classmethod
    def install_template(cls, template_id: str, app_name: str,
                        user_variables: Dict = None, user_id: int = None) -> Dict:
        """Install a template as a new application."""
        from app.models import Application, db
        from app.services.docker_service import DockerService

        # Get template
        result = cls.get_template(template_id)
        if not result.get('success'):
            return result

        template = result['template']

        # Prepare variables - start with automatic variables
        variables = {
            'APP_NAME': app_name,
        }
        template_vars = template.get('variables', {})

        # Handle both dict format (new) and list format (old)
        if isinstance(template_vars, list):
            # Convert list format to dict
            template_vars = {v['name']: v for v in template_vars if 'name' in v}

        for var_name, var_config in template_vars.items():
            if user_variables and var_name in user_variables:
                variables[var_name] = user_variables[var_name]
            elif var_config.get('required', False) and var_name not in (user_variables or {}):
                return {'success': False, 'error': f"Required variable not provided: {var_name}"}
            else:
                variables[var_name] = cls.generate_value(var_config)

        # Create app directory
        app_path = os.path.join(cls.INSTALLED_DIR, app_name)
        if os.path.exists(app_path):
            return {'success': False, 'error': f"App directory already exists: {app_path}"}

        try:
            os.makedirs(app_path, exist_ok=True)

            # Generate docker-compose.yml
            compose_content = cls.generate_compose(template, variables)
            compose_path = os.path.join(app_path, 'docker-compose.yml')
            with open(compose_path, 'w') as f:
                f.write(compose_content)

            # Save installation info
            install_info = {
                'template_id': template_id,
                'template_version': template.get('version'),
                'template_name': template.get('name'),
                'installed_at': datetime.now().isoformat(),
                'variables': variables,
                'user_id': user_id
            }
            info_path = os.path.join(app_path, '.serverkit-template.json')
            with open(info_path, 'w') as f:
                json.dump(install_info, f, indent=2)

            # Save .env file with variables
            env_path = os.path.join(app_path, '.env')
            with open(env_path, 'w') as f:
                for key, value in variables.items():
                    f.write(f"{key}={value}\n")

            # Run pre-install script if exists
            if 'scripts' in template and 'pre_install' in template['scripts']:
                script_result = cls._run_script(
                    template['scripts']['pre_install'],
                    app_path,
                    variables
                )
                if not script_result.get('success'):
                    shutil.rmtree(app_path)
                    return script_result

            # Start the app with docker compose
            compose_result = DockerService.compose_up(app_path, detach=True, build=True)
            if not compose_result.get('success'):
                shutil.rmtree(app_path)
                return compose_result

            # Run post-install script if exists
            if 'scripts' in template and 'post_install' in template['scripts']:
                cls._run_script(
                    template['scripts']['post_install'],
                    app_path,
                    variables
                )

            # Create application record
            app = Application(
                name=app_name,
                app_type='docker',
                status='running',
                root_path=app_path,
                docker_image=template.get('name'),
                user_id=user_id or 1,
                port=int(variables.get('PORT', 0)) if 'PORT' in variables else None
            )
            db.session.add(app)
            db.session.commit()

            # Update installed config
            config = cls.get_config()
            config.setdefault('installed', {})[str(app.id)] = {
                'template_id': template_id,
                'template_version': template.get('version'),
                'app_id': app.id,
                'app_name': app_name,
                'installed_at': datetime.now().isoformat()
            }
            cls.save_config(config)

            return {
                'success': True,
                'app_id': app.id,
                'app_name': app_name,
                'app_path': app_path,
                'variables': variables
            }

        except Exception as e:
            if os.path.exists(app_path):
                shutil.rmtree(app_path)
            return {'success': False, 'error': str(e)}

    @classmethod
    def _run_script(cls, script: str, cwd: str, variables: Dict) -> Dict:
        """Run a script with variable substitution."""
        try:
            script = cls.substitute_variables(script, variables)

            env = os.environ.copy()
            env.update(variables)

            result = subprocess.run(
                script,
                shell=True,
                cwd=cwd,
                env=env,
                capture_output=True,
                text=True,
                timeout=300
            )

            if result.returncode != 0:
                return {
                    'success': False,
                    'error': f"Script failed: {result.stderr}",
                    'output': result.stdout
                }

            return {'success': True, 'output': result.stdout}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Script timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def check_updates(cls, app_id: int) -> Dict:
        """Check if an installed app has template updates available."""
        config = cls.get_config()
        installed = config.get('installed', {}).get(str(app_id))

        if not installed:
            return {'success': False, 'error': 'App not installed from template'}

        template_id = installed['template_id']
        installed_version = installed['template_version']

        # Get latest template
        result = cls.get_template(template_id)
        if not result.get('success'):
            return result

        latest_version = result['template'].get('version')

        return {
            'success': True,
            'installed_version': installed_version,
            'latest_version': latest_version,
            'update_available': latest_version != installed_version
        }

    @classmethod
    def update_app(cls, app_id: int, user_id: int = None) -> Dict:
        """Update an installed app to the latest template version."""
        from app.models import Application, db
        from app.services.docker_service import DockerService

        config = cls.get_config()
        installed = config.get('installed', {}).get(str(app_id))

        if not installed:
            return {'success': False, 'error': 'App not installed from template'}

        app = Application.query.get(app_id)
        if not app:
            return {'success': False, 'error': 'Application not found'}

        template_id = installed['template_id']
        app_path = app.root_path

        # Get latest template
        result = cls.get_template(template_id)
        if not result.get('success'):
            return result

        template = result['template']

        # Load existing variables
        info_path = os.path.join(app_path, '.serverkit-template.json')
        try:
            with open(info_path, 'r') as f:
                install_info = json.load(f)
            variables = install_info.get('variables', {})
        except Exception:
            variables = {}

        # Add any new variables with defaults
        for var_name, var_config in template.get('variables', {}).items():
            if var_name not in variables:
                variables[var_name] = cls.generate_value(var_config)

        try:
            # Backup current compose
            compose_path = os.path.join(app_path, 'docker-compose.yml')
            backup_path = os.path.join(app_path, 'docker-compose.yml.bak')
            if os.path.exists(compose_path):
                shutil.copy(compose_path, backup_path)

            # Run pre-update script
            if 'scripts' in template and 'pre_update' in template['scripts']:
                script_result = cls._run_script(
                    template['scripts']['pre_update'],
                    app_path,
                    variables
                )
                if not script_result.get('success'):
                    return script_result

            # Stop current containers
            DockerService.compose_down(app_path)

            # Generate new docker-compose.yml
            compose_content = cls.generate_compose(template, variables)
            with open(compose_path, 'w') as f:
                f.write(compose_content)

            # Update installation info
            install_info['template_version'] = template.get('version')
            install_info['updated_at'] = datetime.now().isoformat()
            install_info['variables'] = variables
            with open(info_path, 'w') as f:
                json.dump(install_info, f, indent=2)

            # Pull new images and start
            DockerService.compose_pull(app_path)
            compose_result = DockerService.compose_up(app_path, detach=True, build=True)

            if not compose_result.get('success'):
                # Rollback
                if os.path.exists(backup_path):
                    shutil.copy(backup_path, compose_path)
                    DockerService.compose_up(app_path, detach=True)
                return compose_result

            # Run post-update script
            if 'scripts' in template and 'post_update' in template['scripts']:
                cls._run_script(
                    template['scripts']['post_update'],
                    app_path,
                    variables
                )

            # Update config
            config['installed'][str(app_id)]['template_version'] = template.get('version')
            config['installed'][str(app_id)]['updated_at'] = datetime.now().isoformat()
            cls.save_config(config)

            # Remove backup
            if os.path.exists(backup_path):
                os.remove(backup_path)

            return {
                'success': True,
                'version': template.get('version'),
                'app_id': app_id
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_installed_info(cls, app_id: int) -> Optional[Dict]:
        """Get template installation info for an app."""
        config = cls.get_config()
        return config.get('installed', {}).get(str(app_id))

    @classmethod
    def add_repository(cls, name: str, url: str) -> Dict:
        """Add a template repository."""
        config = cls.get_config()

        # Check if already exists
        for repo in config.get('repos', []):
            if repo['url'] == url:
                return {'success': False, 'error': 'Repository already exists'}

        config.setdefault('repos', []).append({
            'name': name,
            'url': url.rstrip('/'),
            'enabled': True,
            'added_at': datetime.now().isoformat()
        })

        return cls.save_config(config)

    @classmethod
    def remove_repository(cls, url: str) -> Dict:
        """Remove a template repository."""
        config = cls.get_config()
        config['repos'] = [r for r in config.get('repos', []) if r['url'] != url]
        return cls.save_config(config)

    @classmethod
    def list_repositories(cls) -> List[Dict]:
        """List configured template repositories."""
        config = cls.get_config()
        return config.get('repos', cls.DEFAULT_REPOS)

    @classmethod
    def sync_templates(cls) -> Dict:
        """Sync templates from all repositories."""
        os.makedirs(cls.TEMPLATES_DIR, exist_ok=True)

        config = cls.get_config()
        synced = 0
        errors = []

        for repo in config.get('repos', []):
            if not repo.get('enabled', True):
                continue

            try:
                # Fetch index
                index_url = f"{repo['url']}/index.json"
                response = requests.get(index_url, timeout=30)
                response.raise_for_status()

                index = response.json()

                # Download each template
                for template_info in index.get('templates', []):
                    template_id = template_info.get('id')
                    if not template_id:
                        continue

                    try:
                        template_url = f"{repo['url']}/templates/{template_id}.yaml"
                        response = requests.get(template_url, timeout=30)
                        response.raise_for_status()

                        # Save locally
                        filepath = os.path.join(cls.TEMPLATES_DIR, f"{template_id}.yaml")
                        with open(filepath, 'w') as f:
                            f.write(response.text)

                        synced += 1
                    except Exception as e:
                        errors.append(f"Failed to sync {template_id}: {e}")

            except Exception as e:
                errors.append(f"Failed to sync from {repo['name']}: {e}")

        config['last_sync'] = datetime.now().isoformat()
        cls.save_config(config)

        return {
            'success': True,
            'synced': synced,
            'errors': errors if errors else None
        }

    @classmethod
    def get_categories(cls) -> List[str]:
        """Get all available template categories."""
        templates = cls.list_all_templates()
        categories = set()
        for template in templates:
            categories.update(template.get('categories', []))
        return sorted(categories)

    @classmethod
    def create_local_template(cls, template_data: Dict) -> Dict:
        """Create a local template."""
        validation = cls.validate_template(template_data)
        if not validation['valid']:
            return {'success': False, 'errors': validation['errors']}

        os.makedirs(cls.TEMPLATES_DIR, exist_ok=True)

        template_id = template_data['name'].lower().replace(' ', '-')
        filepath = os.path.join(cls.TEMPLATES_DIR, f"{template_id}.yaml")

        if os.path.exists(filepath):
            return {'success': False, 'error': 'Template with this name already exists'}

        try:
            with open(filepath, 'w') as f:
                yaml.dump(template_data, f, default_flow_style=False, sort_keys=False)

            return {'success': True, 'template_id': template_id, 'filepath': filepath}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_local_template(cls, template_id: str) -> Dict:
        """Delete a local template."""
        for ext in ['.yaml', '.yml']:
            filepath = os.path.join(cls.TEMPLATES_DIR, f"{template_id}{ext}")
            if os.path.exists(filepath):
                os.remove(filepath)
                return {'success': True}

        return {'success': False, 'error': 'Template not found'}
