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
    def generate_value(cls, var_config: Dict, force_generate: bool = False) -> str:
        """Generate a value for a variable based on its configuration.

        Args:
            var_config: Variable configuration dict
            force_generate: If True, always generate new value even for ports
        """
        var_type = var_config.get('type', 'string')
        default = var_config.get('default', '')

        if var_type == 'password':
            length = var_config.get('length', 32)
            chars = string.ascii_letters + string.digits
            if var_config.get('special_chars', False):
                chars += '!@#$%^&*'
            return ''.join(secrets.choice(chars) for _ in range(length))

        elif var_type == 'port':
            # ALWAYS find an available port - never trust defaults
            start_port = int(default) if default else 8000
            return str(cls._find_available_port(start_port))

        elif var_type == 'uuid':
            import uuid
            return str(uuid.uuid4())

        elif var_type == 'random':
            length = var_config.get('length', 16)
            return secrets.token_hex(length // 2)

        return str(default)

    @classmethod
    def validate_mysql_connection(cls, host: str, port: int, user: str,
                                   password: str, database: str) -> Dict:
        """Validate MySQL database connection.

        Args:
            host: Database host
            port: Database port
            user: Database username
            password: Database password
            database: Database name

        Returns:
            Dict with 'success' and optional 'error' or 'warning' message
        """
        import socket

        try:
            # First check if host:port is reachable
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5)
            result = sock.connect_ex((host, int(port)))
            sock.close()

            if result != 0:
                return {
                    'success': False,
                    'error': f'Cannot connect to {host}:{port} - host unreachable'
                }

            # Try MySQL connection if pymysql available
            try:
                import pymysql
                conn = pymysql.connect(
                    host=host,
                    port=int(port),
                    user=user,
                    password=password,
                    database=database,
                    connect_timeout=5
                )
                conn.close()
                return {'success': True}
            except ImportError:
                # pymysql not available, just check port was reachable
                return {
                    'success': True,
                    'warning': 'MySQL library not available, only port check performed'
                }
            except Exception as e:
                return {
                    'success': False,
                    'error': f'Database connection failed: {str(e)}'
                }

        except Exception as e:
            return {
                'success': False,
                'error': f'Connection check failed: {str(e)}'
            }

    @classmethod
    def _find_available_port(cls, start_port: int = 8000, max_attempts: int = 1000) -> int:
        """Find an available port that's not in use by the system, Docker, or database.

        Checks:
        1. Ports assigned to existing applications in the database
        2. Docker container port mappings
        3. Socket binding test
        """
        import socket

        # Get ports from database (assigned to apps)
        db_ports = cls._get_database_used_ports()

        # Get ports currently used by Docker containers
        docker_ports = cls._get_docker_used_ports()

        # Combine all used ports
        used_ports = db_ports | docker_ports

        for port in range(start_port, start_port + max_attempts):
            # Skip reserved/common ports
            if port < 1024:
                continue

            # Skip if already assigned in DB or Docker
            if port in used_ports:
                continue

            # Check if port is available on localhost (where Docker binds)
            try:
                # Try to bind - most reliable check
                test_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                test_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                test_sock.bind(('127.0.0.1', port))
                test_sock.close()
                return port
            except OSError:
                continue
            except Exception:
                continue

        # Fallback: return a random high port
        import random
        return random.randint(10000, 60000)

    @classmethod
    def _get_database_used_ports(cls) -> set:
        """Get all ports assigned to applications in the database."""
        used_ports = set()
        try:
            from app.models import Application
            apps = Application.query.filter(Application.port.isnot(None)).all()
            for app in apps:
                if app.port:
                    used_ports.add(app.port)
        except Exception:
            pass
        return used_ports

    @classmethod
    def _get_docker_used_ports(cls) -> set:
        """Get all ports currently mapped by Docker containers."""
        used_ports = set()
        try:
            result = subprocess.run(
                ['docker', 'ps', '--format', '{{.Ports}}'],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                # Parse port mappings like "0.0.0.0:8080->80/tcp, 127.0.0.1:3306->3306/tcp"
                import re
                for line in result.stdout.strip().split('\n'):
                    if line:
                        # Find all host ports in the format "host:port->container"
                        matches = re.findall(r'(?:[\d.]+:)?(\d+)->', line)
                        for port_str in matches:
                            try:
                                used_ports.add(int(port_str))
                            except ValueError:
                                pass
        except Exception:
            pass
        return used_ports

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

        # Remove obsolete version field (not needed in modern Docker Compose)
        if 'version' in compose:
            del compose['version']

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
        from app import db
        from app.models import Application
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
            var_type = var_config.get('type', 'string')

            # ALWAYS auto-generate ports - never use user values for ports
            if var_type == 'port':
                variables[var_name] = cls.generate_value(var_config)
            elif user_variables and var_name in user_variables and user_variables[var_name]:
                variables[var_name] = user_variables[var_name]
            elif var_config.get('required', False) and var_name not in (user_variables or {}):
                return {'success': False, 'error': f"Required variable not provided: {var_name}"}
            else:
                variables[var_name] = cls.generate_value(var_config)

        # Validate external database connection for external-db templates
        if template_id == 'wordpress-external-db':
            db_check = cls.validate_mysql_connection(
                host=variables.get('DB_HOST'),
                port=variables.get('DB_PORT', '3306'),
                user=variables.get('DB_USER'),
                password=variables.get('DB_PASSWORD'),
                database=variables.get('DB_NAME')
            )
            if not db_check.get('success'):
                return {
                    'success': False,
                    'error': f"Database connection failed: {db_check.get('error')}"
                }

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

            # Process template files section - create files and update compose for bind mounts
            if 'files' in template:
                files_result = cls._process_template_files(
                    template['files'],
                    app_path,
                    compose_path,
                    variables
                )
                if not files_result.get('success'):
                    shutil.rmtree(app_path)
                    return files_result

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

            # Verify container started and port is accessible
            import time
            time.sleep(3)  # Give containers time to fully start

            # Run post-install script if exists
            if 'scripts' in template and 'post_install' in template['scripts']:
                cls._run_script(
                    template['scripts']['post_install'],
                    app_path,
                    variables
                )

            # Create application record
            # Look for port in variables - templates may use PORT or HTTP_PORT
            app_port = None
            for port_var in ['PORT', 'HTTP_PORT', 'WEB_PORT']:
                if port_var in variables:
                    try:
                        app_port = int(variables[port_var])
                        break
                    except (ValueError, TypeError):
                        pass

            # Verify port is accessible after startup
            port_accessible = False
            port_warning = None
            if app_port:
                port_check = DockerService.check_port_accessible(app_port)
                port_accessible = port_check.get('accessible', False)
                if not port_accessible:
                    port_warning = f"Port {app_port} is not accessible after container start. Container may still be initializing or port mapping may be incorrect."
                    print(f"Warning: {port_warning}")

            app = Application(
                name=app_name,
                app_type='docker',
                status='running',
                root_path=app_path,
                docker_image=template.get('name'),
                user_id=user_id or 1,
                port=app_port
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

            result = {
                'success': True,
                'app_id': app.id,
                'app_name': app_name,
                'app_path': app_path,
                'variables': variables,
                'port': app_port,
                'port_accessible': port_accessible
            }

            if port_warning:
                result['port_warning'] = port_warning

            return result

        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            print(f"Template install service error: {error_trace}")
            if os.path.exists(app_path):
                shutil.rmtree(app_path)
            return {'success': False, 'error': str(e), 'trace': error_trace}

    @classmethod
    def _process_template_files(cls, files: List[Dict], app_path: str,
                                 compose_path: str, variables: Dict) -> Dict:
        """Process template files section - create files and update compose for bind mounts.

        This method:
        1. Creates files defined in the template's 'files' section
        2. Updates docker-compose.yml to bind mount these files into containers

        Args:
            files: List of file definitions from template (path, content)
            app_path: Path to the app directory
            compose_path: Path to the docker-compose.yml file
            variables: Variables dict for substitution

        Returns:
            Dict with success status
        """
        try:
            created_files = []
            bind_mounts = []  # Track files that need to be bind mounted

            for file_def in files:
                container_path = file_def.get('path')
                content = file_def.get('content', '')

                if not container_path:
                    continue

                # Substitute variables in content
                content = cls.substitute_variables(content, variables)

                # Determine local filename (use basename of container path)
                filename = os.path.basename(container_path)
                local_path = os.path.join(app_path, filename)

                # Write file locally
                with open(local_path, 'w') as f:
                    f.write(content)

                created_files.append(filename)

                # Track for bind mount: local file -> container path
                # Get the container directory from the path
                container_dir = os.path.dirname(container_path)
                bind_mounts.append({
                    'local': f'./{filename}',
                    'container': container_path,
                    'container_dir': container_dir
                })

            # Update docker-compose.yml to use bind mounts instead of named volumes
            if bind_mounts:
                cls._update_compose_with_bind_mounts(compose_path, bind_mounts)

            return {
                'success': True,
                'files_created': created_files,
                'bind_mounts': len(bind_mounts)
            }

        except Exception as e:
            return {'success': False, 'error': f'Failed to process template files: {str(e)}'}

    @classmethod
    def _update_compose_with_bind_mounts(cls, compose_path: str, bind_mounts: List[Dict]) -> None:
        """Update docker-compose.yml to use bind mounts for template files.

        Replaces named volume mounts with bind mounts for specific container paths.

        Args:
            compose_path: Path to docker-compose.yml
            bind_mounts: List of bind mount definitions
        """
        with open(compose_path, 'r') as f:
            compose = yaml.safe_load(f)

        # Group bind mounts by container directory
        dir_to_files = {}
        for mount in bind_mounts:
            dir_to_files.setdefault(mount['container_dir'], []).append(mount)

        # Process each service
        for service_name, service in compose.get('services', {}).items():
            volumes = service.get('volumes', [])
            new_volumes = []
            volumes_to_remove = set()

            for vol in volumes:
                if isinstance(vol, str):
                    # Parse volume string: "name:/path" or "./local:/path"
                    parts = vol.split(':')
                    if len(parts) >= 2:
                        mount_target = parts[1].rstrip('/')

                        # Check if this volume's target directory matches any of our file paths
                        should_replace = False
                        for mount in bind_mounts:
                            container_dir = mount['container_dir'].rstrip('/')
                            if mount_target == container_dir:
                                # This named volume covers a directory where we need to place files
                                should_replace = True
                                volumes_to_remove.add(parts[0])  # Track volume name to remove
                                break

                        if not should_replace:
                            new_volumes.append(vol)
                    else:
                        new_volumes.append(vol)
                else:
                    new_volumes.append(vol)

            # Add bind mounts for our files
            for mount in bind_mounts:
                bind_mount_str = f"{mount['local']}:{mount['container']}"
                if bind_mount_str not in new_volumes:
                    new_volumes.append(bind_mount_str)

            service['volumes'] = new_volumes

        # Remove unused named volumes from top-level volumes section
        if 'volumes' in compose and volumes_to_remove:
            for vol_name in volumes_to_remove:
                if vol_name in compose['volumes']:
                    del compose['volumes'][vol_name]
            # Remove volumes section if empty
            if not compose['volumes']:
                del compose['volumes']

        # Write updated compose file
        with open(compose_path, 'w') as f:
            yaml.dump(compose, f, default_flow_style=False, sort_keys=False)

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
        from app import db
        from app.models import Application
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
    def propagate_db_credentials(cls, source_app_id: int, target_app_id: int,
                                  target_prefix: str = None) -> Dict:
        """Propagate database credentials from source app to target app.

        Reads source app's .env file for DB credentials, updates target app's
        .env with same credentials but different table prefix.

        Args:
            source_app_id: ID of the app with existing DB credentials
            target_app_id: ID of the app to receive credentials
            target_prefix: Table prefix for target app (default: wp_dev_)

        Returns:
            Dict with success status and propagated config
        """
        from app.models import Application

        source_app = Application.query.get(source_app_id)
        target_app = Application.query.get(target_app_id)

        if not source_app or not target_app:
            return {'success': False, 'error': 'App not found'}

        if not source_app.root_path or not target_app.root_path:
            return {'success': False, 'error': 'Apps must have root_path set'}

        # Read source app's .env file
        source_env_path = os.path.join(source_app.root_path, '.env')
        if not os.path.exists(source_env_path):
            return {'success': False, 'error': 'Source app .env file not found'}

        try:
            env_vars = {}
            with open(source_env_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        env_vars[key.strip()] = value.strip()

            # Extract DB credentials
            db_config = {}
            db_keys = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
                       'WORDPRESS_DB_HOST', 'WORDPRESS_DB_NAME', 'WORDPRESS_DB_USER',
                       'WORDPRESS_DB_PASSWORD', 'MYSQL_HOST', 'MYSQL_DATABASE',
                       'MYSQL_USER', 'MYSQL_PASSWORD']

            for key in db_keys:
                if key in env_vars:
                    db_config[key] = env_vars[key]

            if not db_config:
                return {'success': False, 'error': 'No database credentials found in source app'}

            # Set target table prefix (default different from source)
            source_prefix = env_vars.get('TABLE_PREFIX', env_vars.get('WORDPRESS_TABLE_PREFIX', 'wp_'))
            if target_prefix is None:
                if source_prefix == 'wp_':
                    target_prefix = 'wp_dev_'
                else:
                    target_prefix = 'wp_'

            # Update target app's .env file
            target_env_path = os.path.join(target_app.root_path, '.env')

            # Read existing target .env or create new
            target_env = {}
            if os.path.exists(target_env_path):
                with open(target_env_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#') and '=' in line:
                            key, value = line.split('=', 1)
                            target_env[key.strip()] = value.strip()

            # Update with source DB credentials
            for key, value in db_config.items():
                target_env[key] = value

            # Set different table prefix
            target_env['TABLE_PREFIX'] = target_prefix
            target_env['WORDPRESS_TABLE_PREFIX'] = target_prefix

            # Write updated .env
            with open(target_env_path, 'w') as f:
                for key, value in target_env.items():
                    f.write(f"{key}={value}\n")

            # Also update docker-compose.yml if it exists
            compose_path = os.path.join(target_app.root_path, 'docker-compose.yml')
            if os.path.exists(compose_path):
                try:
                    with open(compose_path, 'r') as f:
                        compose = yaml.safe_load(f)

                    # Update environment variables in services
                    for service_name, service in compose.get('services', {}).items():
                        env_list = service.get('environment', [])
                        if isinstance(env_list, list):
                            new_env = []
                            for env_item in env_list:
                                if isinstance(env_item, str) and '=' in env_item:
                                    key = env_item.split('=')[0]
                                    if key in target_env:
                                        new_env.append(f"{key}={target_env[key]}")
                                    else:
                                        new_env.append(env_item)
                                else:
                                    new_env.append(env_item)
                            service['environment'] = new_env

                    with open(compose_path, 'w') as f:
                        yaml.dump(compose, f, default_flow_style=False)
                except Exception as e:
                    # Non-fatal, continue
                    pass

            # Store shared config in both apps
            shared_config = {
                'db_host': db_config.get('DB_HOST', db_config.get('WORDPRESS_DB_HOST', '')),
                'db_name': db_config.get('DB_NAME', db_config.get('WORDPRESS_DB_NAME', '')),
                'source_prefix': source_prefix,
                'target_prefix': target_prefix,
                'propagated_at': datetime.now().isoformat()
            }

            return {
                'success': True,
                'shared_config': shared_config,
                'source_prefix': source_prefix,
                'target_prefix': target_prefix
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

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
