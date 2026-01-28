"""
Environment Docker Service

Manages per-environment Docker Compose stacks for WordPress multidev.
Each environment (production, staging, dev, multidev branches) gets its own
isolated Docker Compose project with unique containers, networks, and volumes.
"""

import os
import json
import shutil
import subprocess
from typing import Dict
from app.services.template_service import TemplateService


class EnvironmentDockerService:
    """Service for managing per-environment Docker Compose stacks."""

    APPS_DIR = '/var/serverkit/apps'

    # Docker Compose template for a WordPress environment
    COMPOSE_TEMPLATE = """services:
  wordpress:
    image: wordpress:latest
    container_name: {project}-{env_type}-wp
    restart: unless-stopped
    ports:
      - "127.0.0.1:{wp_port}:80"
    environment:
      WORDPRESS_DB_HOST: {project}-{env_type}-db:3306
      WORDPRESS_DB_USER: ${{DB_USER}}
      WORDPRESS_DB_PASSWORD: ${{DB_PASSWORD}}
      WORDPRESS_DB_NAME: ${{DB_NAME}}
      WORDPRESS_TABLE_PREFIX: ${{TABLE_PREFIX}}
    volumes:
      - ./wordpress:/var/www/html
    networks:
      - {network_name}
    deploy:
      resources:
        limits:
          memory: {memory_limit}
          cpus: '{cpu_limit}'

  db:
    image: mysql:8.0
    container_name: {project}-{env_type}-db
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: ${{DB_NAME}}
      MYSQL_USER: ${{DB_USER}}
      MYSQL_PASSWORD: ${{DB_PASSWORD}}
      MYSQL_ROOT_PASSWORD: ${{DB_ROOT_PASSWORD}}
    volumes:
      - ./mysql-data:/var/lib/mysql
    networks:
      - {network_name}
    deploy:
      resources:
        limits:
          memory: {db_memory_limit}
          cpus: '{db_cpu_limit}'

networks:
  {network_name}:
    driver: bridge
"""

    # Resource limits by environment type
    RESOURCE_LIMITS = {
        'production': {'memory': '512M', 'cpus': '1.0', 'db_memory': '512M', 'db_cpus': '0.5'},
        'staging': {'memory': '384M', 'cpus': '0.5', 'db_memory': '384M', 'db_cpus': '0.25'},
        'development': {'memory': '256M', 'cpus': '0.5', 'db_memory': '256M', 'db_cpus': '0.25'},
        'multidev': {'memory': '256M', 'cpus': '0.25', 'db_memory': '256M', 'db_cpus': '0.25'},
    }

    @classmethod
    def get_env_directory(cls, project_name: str, env_type: str) -> str:
        """Get the directory path for an environment.

        Returns:
            Path like /var/serverkit/apps/wp-{project}/{env_type}/
        """
        return os.path.join(cls.APPS_DIR, f'wp-{project_name}', env_type)

    @classmethod
    def generate_compose_file(cls, project_name: str, env_type: str, config: Dict) -> Dict:
        """Generate a docker-compose.yml for a single environment.

        Args:
            project_name: The project identifier (slug)
            env_type: Environment type (production, staging, development, multidev)
            config: Configuration dict with optional overrides for ports, resources, etc.

        Returns:
            Dict with success status, compose_path, and env_path
        """
        try:
            env_dir = cls.get_env_directory(project_name, env_type)
            os.makedirs(env_dir, exist_ok=True)

            # Find available port for WordPress
            wp_port = config.get('wp_port') or cls._find_available_port()

            # Get resource limits for this environment type
            limits = cls.RESOURCE_LIMITS.get(env_type, cls.RESOURCE_LIMITS['development'])

            # Network name (unique per environment)
            network_name = f'{project_name}-{env_type}-net'

            # Generate compose content from template
            compose_content = cls.COMPOSE_TEMPLATE.format(
                project=project_name,
                env_type=env_type,
                wp_port=wp_port,
                network_name=network_name,
                memory_limit=config.get('memory_limit', limits['memory']),
                cpu_limit=config.get('cpu_limit', limits['cpus']),
                db_memory_limit=config.get('db_memory_limit', limits['db_memory']),
                db_cpu_limit=config.get('db_cpu_limit', limits['db_cpus']),
            )

            # Write docker-compose.yml
            compose_path = os.path.join(env_dir, 'docker-compose.yml')
            with open(compose_path, 'w') as f:
                f.write(compose_content)

            # Generate .env file with variables
            env_vars = {
                'DB_NAME': config.get('db_name', f'wp_{project_name}_{env_type}'),
                'DB_USER': config.get('db_user', f'wp_{project_name}'),
                'DB_PASSWORD': config.get('db_password', cls._generate_password()),
                'DB_ROOT_PASSWORD': config.get('db_root_password', cls._generate_password()),
                'TABLE_PREFIX': config.get('table_prefix', 'wp_'),
            }

            env_path = os.path.join(env_dir, '.env')
            with open(env_path, 'w') as f:
                for key, value in env_vars.items():
                    f.write(f'{key}={value}\n')

            return {
                'success': True,
                'compose_path': compose_path,
                'env_path': env_path,
                'env_dir': env_dir,
                'wp_port': wp_port,
                'env_vars': env_vars,
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def start_environment(cls, compose_path: str) -> Dict:
        """Start a Docker Compose environment.

        Args:
            compose_path: Path to docker-compose.yml

        Returns:
            Dict with success status
        """
        try:
            result = subprocess.run(
                ['docker', 'compose', '-f', compose_path, 'up', '-d'],
                capture_output=True,
                text=True,
                timeout=120
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            return {'success': True, 'output': result.stdout}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Docker compose up timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def stop_environment(cls, compose_path: str) -> Dict:
        """Stop a Docker Compose environment.

        Args:
            compose_path: Path to docker-compose.yml

        Returns:
            Dict with success status
        """
        try:
            result = subprocess.run(
                ['docker', 'compose', '-f', compose_path, 'down'],
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            return {'success': True, 'output': result.stdout}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Docker compose down timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def restart_environment(cls, compose_path: str) -> Dict:
        """Restart a Docker Compose environment (stop + start).

        Args:
            compose_path: Path to docker-compose.yml

        Returns:
            Dict with success status
        """
        stop_result = cls.stop_environment(compose_path)
        if not stop_result.get('success'):
            return stop_result

        return cls.start_environment(compose_path)

    @classmethod
    def destroy_environment(cls, compose_path: str, remove_volumes: bool = False) -> Dict:
        """Destroy a Docker Compose environment and optionally remove data.

        Args:
            compose_path: Path to docker-compose.yml
            remove_volumes: If True, also remove Docker volumes

        Returns:
            Dict with success status
        """
        try:
            cmd = ['docker', 'compose', '-f', compose_path, 'down']
            if remove_volumes:
                cmd.append('-v')

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            # Remove the environment directory
            env_dir = os.path.dirname(compose_path)
            if os.path.exists(env_dir):
                shutil.rmtree(env_dir)

            return {'success': True, 'output': result.stdout}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Docker compose down timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_environment_status(cls, compose_path: str) -> Dict:
        """Get the status of a Docker Compose environment.

        Args:
            compose_path: Path to docker-compose.yml

        Returns:
            Dict with running status and container details
        """
        try:
            result = subprocess.run(
                ['docker', 'compose', '-f', compose_path, 'ps', '--format', 'json'],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode != 0:
                return {'success': False, 'running': False, 'error': result.stderr}

            containers = []
            if result.stdout.strip():
                # docker compose ps --format json outputs one JSON object per line
                for line in result.stdout.strip().split('\n'):
                    line = line.strip()
                    if line:
                        try:
                            containers.append(json.loads(line))
                        except json.JSONDecodeError:
                            continue

            running = all(
                c.get('State') == 'running'
                for c in containers
            ) if containers else False

            return {
                'success': True,
                'running': running,
                'containers': containers,
            }

        except subprocess.TimeoutExpired:
            return {'success': False, 'running': False, 'error': 'Status check timed out'}
        except Exception as e:
            return {'success': False, 'running': False, 'error': str(e)}

    @classmethod
    def get_container_logs(cls, compose_path: str, service: str = 'wordpress', lines: int = 100) -> Dict:
        """Get logs from a container in the environment.

        Args:
            compose_path: Path to docker-compose.yml
            service: Service name (wordpress or db)
            lines: Number of tail lines

        Returns:
            Dict with success status and logs
        """
        try:
            result = subprocess.run(
                ['docker', 'compose', '-f', compose_path, 'logs', '--tail', str(lines), service],
                capture_output=True,
                text=True,
                timeout=30
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            return {'success': True, 'logs': result.stdout}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Log retrieval timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def exec_in_container(cls, compose_path: str, service: str, command: str) -> Dict:
        """Execute a command inside a container.

        Args:
            compose_path: Path to docker-compose.yml
            service: Service name (wordpress or db)
            command: Command to execute

        Returns:
            Dict with success status and output
        """
        try:
            result = subprocess.run(
                ['docker', 'compose', '-f', compose_path, 'exec', '-T', service] + command.split(),
                capture_output=True,
                text=True,
                timeout=120
            )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr, 'output': result.stdout}

            return {'success': True, 'output': result.stdout}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Command execution timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def update_resource_limits(cls, compose_path: str, limits: Dict) -> Dict:
        """Update resource limits in a docker-compose.yml and restart containers.

        Args:
            compose_path: Path to docker-compose.yml
            limits: Dict with optional keys: memory, cpus, db_memory, db_cpus

        Returns:
            Dict with success status
        """
        try:
            import yaml

            with open(compose_path, 'r') as f:
                compose_content = f.read()

            compose_data = yaml.safe_load(compose_content)

            # Update WordPress service limits
            wp_service = compose_data.get('services', {}).get('wordpress', {})
            if wp_service:
                deploy = wp_service.setdefault('deploy', {})
                resources = deploy.setdefault('resources', {})
                resource_limits = resources.setdefault('limits', {})

                if 'memory' in limits:
                    resource_limits['memory'] = limits['memory']
                if 'cpus' in limits:
                    resource_limits['cpus'] = str(limits['cpus'])

            # Update DB service limits
            db_service = compose_data.get('services', {}).get('db', {})
            if db_service:
                deploy = db_service.setdefault('deploy', {})
                resources = deploy.setdefault('resources', {})
                resource_limits = resources.setdefault('limits', {})

                if 'db_memory' in limits:
                    resource_limits['memory'] = limits['db_memory']
                if 'db_cpus' in limits:
                    resource_limits['cpus'] = str(limits['db_cpus'])

            # Write updated compose file
            with open(compose_path, 'w') as f:
                yaml.dump(compose_data, f, default_flow_style=False, sort_keys=False)

            # Restart containers to apply new limits
            return cls.restart_environment(compose_path)

        except ImportError:
            # Fallback: regex-based replacement if PyYAML not available
            return cls._update_limits_regex(compose_path, limits)
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _update_limits_regex(cls, compose_path: str, limits: Dict) -> Dict:
        """Fallback resource limits update using regex when PyYAML is unavailable."""
        import re
        try:
            with open(compose_path, 'r') as f:
                content = f.read()

            if 'memory' in limits:
                content = re.sub(
                    r'(wordpress:.*?limits:.*?memory:\s*)\S+',
                    r'\g<1>' + limits['memory'],
                    content, count=1, flags=re.DOTALL
                )
            if 'cpus' in limits:
                content = re.sub(
                    r'(wordpress:.*?limits:.*?cpus:\s*)[\'"]?\S+[\'"]?',
                    r"\g<1>'" + str(limits['cpus']) + "'",
                    content, count=1, flags=re.DOTALL
                )
            if 'db_memory' in limits:
                content = re.sub(
                    r'(db:.*?limits:.*?memory:\s*)\S+',
                    r'\g<1>' + limits['db_memory'],
                    content, count=1, flags=re.DOTALL
                )
            if 'db_cpus' in limits:
                content = re.sub(
                    r'(db:.*?limits:.*?cpus:\s*)[\'"]?\S+[\'"]?',
                    r"\g<1>'" + str(limits['db_cpus']) + "'",
                    content, count=1, flags=re.DOTALL
                )

            with open(compose_path, 'w') as f:
                f.write(content)

            return cls.restart_environment(compose_path)

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _find_available_port(cls) -> int:
        """Find an available port. Delegates to TemplateService."""
        return TemplateService._find_available_port()

    @classmethod
    def _generate_password(cls, length: int = 32) -> str:
        """Generate a random password."""
        import secrets
        import string
        chars = string.ascii_letters + string.digits
        return ''.join(secrets.choice(chars) for _ in range(length))
