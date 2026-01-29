import subprocess
import json
import os
import yaml
from datetime import datetime


class DockerService:
    """Service for managing Docker containers, images, and compose stacks."""

    _compose_cmd = None

    @classmethod
    def _get_compose_cmd(cls):
        """Detect whether to use 'docker compose' (v2) or 'docker-compose' (v1)."""
        if cls._compose_cmd is not None:
            return cls._compose_cmd
        try:
            result = subprocess.run(
                ['docker', 'compose', 'version'],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                cls._compose_cmd = ['docker', 'compose']
                return cls._compose_cmd
        except Exception:
            pass
        # Fallback to docker-compose (v1)
        cls._compose_cmd = ['docker-compose']
        return cls._compose_cmd

    @staticmethod
    def is_docker_installed():
        """Check if Docker is installed and running."""
        try:
            result = subprocess.run(
                ['docker', 'version', '--format', 'json'],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'installed': True, 'info': json.loads(result.stdout)}
            return {'installed': False, 'error': result.stderr}
        except FileNotFoundError:
            return {'installed': False, 'error': 'Docker not found'}
        except Exception as e:
            return {'installed': False, 'error': str(e)}

    @staticmethod
    def get_docker_info():
        """Get Docker system information."""
        try:
            result = subprocess.run(
                ['docker', 'info', '--format', '{{json .}}'],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return json.loads(result.stdout)
            return None
        except Exception:
            return None

    # ==================== CONTAINER MANAGEMENT ====================

    @staticmethod
    def list_containers(all_containers=True):
        """List Docker containers."""
        try:
            cmd = ['docker', 'ps', '--format', '{{json .}}']
            if all_containers:
                cmd.insert(2, '-a')

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                return []

            containers = []
            for line in result.stdout.strip().split('\n'):
                if line:
                    container = json.loads(line)
                    containers.append({
                        'id': container.get('ID'),
                        'name': container.get('Names'),
                        'image': container.get('Image'),
                        'status': container.get('Status'),
                        'state': container.get('State'),
                        'ports': container.get('Ports'),
                        'created': container.get('CreatedAt'),
                        'size': container.get('Size'),
                    })
            return containers
        except Exception as e:
            return []

    @staticmethod
    def get_container(container_id):
        """Get detailed container information."""
        try:
            result = subprocess.run(
                ['docker', 'inspect', container_id],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                if data:
                    return data[0]
            return None
        except Exception:
            return None

    @staticmethod
    def create_container(image, name=None, ports=None, volumes=None, env=None,
                         network=None, restart_policy='unless-stopped', command=None):
        """Create a new container."""
        try:
            cmd = ['docker', 'create']

            if name:
                cmd.extend(['--name', name])

            if ports:
                for port in ports:
                    cmd.extend(['-p', port])

            if volumes:
                for volume in volumes:
                    cmd.extend(['-v', volume])

            if env:
                for key, value in env.items():
                    cmd.extend(['-e', f'{key}={value}'])

            if network:
                cmd.extend(['--network', network])

            if restart_policy:
                cmd.extend(['--restart', restart_policy])

            cmd.append(image)

            if command:
                cmd.extend(command.split())

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode == 0:
                container_id = result.stdout.strip()
                return {'success': True, 'container_id': container_id}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def run_container(image, name=None, ports=None, volumes=None, env=None,
                      network=None, restart_policy='unless-stopped', command=None, detach=True):
        """Run a new container (create and start)."""
        try:
            cmd = ['docker', 'run']

            if detach:
                cmd.append('-d')

            if name:
                cmd.extend(['--name', name])

            if ports:
                for port in ports:
                    cmd.extend(['-p', port])

            if volumes:
                for volume in volumes:
                    cmd.extend(['-v', volume])

            if env:
                for key, value in env.items():
                    cmd.extend(['-e', f'{key}={value}'])

            if network:
                cmd.extend(['--network', network])

            if restart_policy:
                cmd.extend(['--restart', restart_policy])

            cmd.append(image)

            if command:
                cmd.extend(command.split())

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode == 0:
                container_id = result.stdout.strip()
                return {'success': True, 'container_id': container_id}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def start_container(container_id):
        """Start a container."""
        try:
            result = subprocess.run(
                ['docker', 'start', container_id],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def stop_container(container_id, timeout=10):
        """Stop a container."""
        try:
            result = subprocess.run(
                ['docker', 'stop', '-t', str(timeout), container_id],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def restart_container(container_id, timeout=10):
        """Restart a container."""
        try:
            result = subprocess.run(
                ['docker', 'restart', '-t', str(timeout), container_id],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def remove_container(container_id, force=False, volumes=False):
        """Remove a container."""
        try:
            cmd = ['docker', 'rm']
            if force:
                cmd.append('-f')
            if volumes:
                cmd.append('-v')
            cmd.append(container_id)

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return {'success': True}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def get_container_logs(container_id, tail=100, since=None, timestamps=True):
        """Get container logs."""
        try:
            cmd = ['docker', 'logs']
            if tail:
                cmd.extend(['--tail', str(tail)])
            if since:
                cmd.extend(['--since', since])
            if timestamps:
                cmd.append('-t')
            cmd.append(container_id)

            result = subprocess.run(cmd, capture_output=True, text=True)
            # Docker logs go to both stdout and stderr
            logs = result.stdout + result.stderr
            return {'success': True, 'logs': logs}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def stream_container_logs(container_id, tail=100, since=None, timestamps=True):
        """Start streaming container logs in real-time.

        Args:
            container_id: Docker container ID or name
            tail: Number of existing lines to fetch first (default: 100)
            since: Only logs since this timestamp or duration (e.g., '10m', '1h')
            timestamps: Include timestamps in output (default: True)

        Returns:
            subprocess.Popen object for the streaming process, or None on error
        """
        try:
            cmd = ['docker', 'logs', '--follow']
            if tail:
                cmd.extend(['--tail', str(tail)])
            if since:
                cmd.extend(['--since', since])
            if timestamps:
                cmd.append('-t')
            cmd.append(container_id)

            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            return process
        except Exception:
            return None

    @staticmethod
    def get_app_container_id(app):
        """Get the main container ID for an application.

        For apps with container_id set, use that directly.
        For compose apps, query docker compose ps to find container.

        Args:
            app: Application model instance (or dict with container_id and root_path)

        Returns:
            str: Container ID or name, or None if not found
        """
        # Handle both model instances and dicts
        container_id = getattr(app, 'container_id', None) or (app.get('container_id') if isinstance(app, dict) else None)
        root_path = getattr(app, 'root_path', None) or (app.get('root_path') if isinstance(app, dict) else None)

        if container_id:
            return container_id

        if root_path:
            # Get containers from docker compose
            containers = DockerService.compose_ps(root_path)
            if containers:
                # Return first container (main service)
                # Docker compose ps returns 'ID' or 'Name' depending on version
                return containers[0].get('ID') or containers[0].get('Name') or containers[0].get('id')

        return None

    @staticmethod
    def get_all_app_containers(app):
        """Get all container IDs for a compose application.

        Args:
            app: Application model instance (or dict with root_path)

        Returns:
            list: List of container info dicts with 'id', 'name', 'service', 'state'
        """
        root_path = getattr(app, 'root_path', None) or (app.get('root_path') if isinstance(app, dict) else None)

        if not root_path:
            container_id = getattr(app, 'container_id', None) or (app.get('container_id') if isinstance(app, dict) else None)
            if container_id:
                return [{'id': container_id, 'name': container_id, 'service': 'main', 'state': 'unknown'}]
            return []

        containers = DockerService.compose_ps(root_path)
        result = []
        for c in containers:
            result.append({
                'id': c.get('ID') or c.get('id'),
                'name': c.get('Name') or c.get('name') or c.get('Names'),
                'service': c.get('Service') or c.get('service'),
                'state': c.get('State') or c.get('state') or c.get('Status', '').split()[0].lower()
            })
        return result

    @staticmethod
    def parse_log_line(line):
        """Parse a Docker log line into structured format.

        Docker logs with timestamps look like:
        2024-01-15T10:30:45.123456789Z Log message here

        Args:
            line: Raw log line string

        Returns:
            dict: {
                'timestamp': '2024-01-15T10:30:45.123456789Z' or None,
                'message': 'Log message here',
                'level': 'info' | 'warn' | 'error' | 'debug'
            }
        """
        import re

        if not line:
            return {'timestamp': None, 'message': '', 'level': 'info'}

        # Docker timestamp pattern: 2024-01-15T10:30:45.123456789Z
        timestamp_pattern = r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+'
        match = re.match(timestamp_pattern, line)

        timestamp = None
        message = line

        if match:
            timestamp = match.group(1)
            message = line[match.end():]

        # Detect log level from message content
        message_lower = message.lower()
        level = 'info'

        if any(x in message_lower for x in ['error', 'err:', 'fatal', 'exception', 'traceback']):
            level = 'error'
        elif any(x in message_lower for x in ['warn', 'warning']):
            level = 'warn'
        elif any(x in message_lower for x in ['debug', 'dbg:']):
            level = 'debug'

        return {
            'timestamp': timestamp,
            'message': message,
            'level': level
        }

    @staticmethod
    def parse_logs_to_lines(logs_text):
        """Parse raw logs text into structured lines.

        Args:
            logs_text: Raw logs string with newlines

        Returns:
            list: List of parsed log line dicts
        """
        if not logs_text:
            return []

        lines = []
        for line in logs_text.split('\n'):
            if line.strip():
                lines.append(DockerService.parse_log_line(line))
        return lines

    @staticmethod
    def get_container_state(container_id):
        """Get the current state of a container.

        Args:
            container_id: Docker container ID or name

        Returns:
            dict: {'running': bool, 'state': str, 'status': str} or None if not found
        """
        info = DockerService.get_container(container_id)
        if not info:
            return None

        state = info.get('State', {})
        return {
            'running': state.get('Running', False),
            'state': state.get('Status', 'unknown'),
            'status': state.get('Status', 'unknown'),
            'started_at': state.get('StartedAt'),
            'finished_at': state.get('FinishedAt')
        }

    @staticmethod
    def get_container_stats(container_id):
        """Get container resource usage stats."""
        try:
            result = subprocess.run(
                ['docker', 'stats', '--no-stream', '--format', '{{json .}}', container_id],
                capture_output=True, text=True
            )
            if result.returncode == 0 and result.stdout.strip():
                return json.loads(result.stdout.strip())
            return None
        except Exception:
            return None

    @staticmethod
    def exec_command(container_id, command, interactive=False, tty=False):
        """Execute a command in a running container."""
        try:
            cmd = ['docker', 'exec']
            if interactive:
                cmd.append('-i')
            if tty:
                cmd.append('-t')
            cmd.append(container_id)
            cmd.extend(command.split())

            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            return {
                'success': result.returncode == 0,
                'stdout': result.stdout,
                'stderr': result.stderr,
                'return_code': result.returncode
            }
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Command timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== IMAGE MANAGEMENT ====================

    @staticmethod
    def list_images():
        """List Docker images."""
        try:
            result = subprocess.run(
                ['docker', 'images', '--format', '{{json .}}'],
                capture_output=True, text=True
            )
            if result.returncode != 0:
                return []

            images = []
            for line in result.stdout.strip().split('\n'):
                if line:
                    image = json.loads(line)
                    images.append({
                        'id': image.get('ID'),
                        'repository': image.get('Repository'),
                        'tag': image.get('Tag'),
                        'size': image.get('Size'),
                        'created': image.get('CreatedAt'),
                    })
            return images
        except Exception:
            return []

    @staticmethod
    def pull_image(image_name, tag='latest'):
        """Pull an image from registry."""
        try:
            full_name = f'{image_name}:{tag}' if tag else image_name
            result = subprocess.run(
                ['docker', 'pull', full_name],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'output': result.stdout}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def remove_image(image_id, force=False):
        """Remove an image."""
        try:
            cmd = ['docker', 'rmi']
            if force:
                cmd.append('-f')
            cmd.append(image_id)

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return {'success': True}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def build_image(path, tag, dockerfile='Dockerfile', no_cache=False):
        """Build an image from Dockerfile."""
        try:
            cmd = ['docker', 'build', '-t', tag]
            if dockerfile != 'Dockerfile':
                cmd.extend(['-f', dockerfile])
            if no_cache:
                cmd.append('--no-cache')
            cmd.append(path)

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return {'success': True, 'output': result.stdout}
            return {'success': False, 'error': result.stderr, 'output': result.stdout}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def tag_image(source, target):
        """Tag an image."""
        try:
            result = subprocess.run(
                ['docker', 'tag', source, target],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== NETWORK MANAGEMENT ====================

    @staticmethod
    def list_networks():
        """List Docker networks."""
        try:
            result = subprocess.run(
                ['docker', 'network', 'ls', '--format', '{{json .}}'],
                capture_output=True, text=True
            )
            if result.returncode != 0:
                return []

            networks = []
            for line in result.stdout.strip().split('\n'):
                if line:
                    network = json.loads(line)
                    networks.append({
                        'id': network.get('ID'),
                        'name': network.get('Name'),
                        'driver': network.get('Driver'),
                        'scope': network.get('Scope'),
                    })
            return networks
        except Exception:
            return []

    @staticmethod
    def create_network(name, driver='bridge'):
        """Create a Docker network."""
        try:
            result = subprocess.run(
                ['docker', 'network', 'create', '--driver', driver, name],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'network_id': result.stdout.strip()}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def remove_network(network_id):
        """Remove a Docker network."""
        try:
            result = subprocess.run(
                ['docker', 'network', 'rm', network_id],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== VOLUME MANAGEMENT ====================

    @staticmethod
    def list_volumes():
        """List Docker volumes."""
        try:
            result = subprocess.run(
                ['docker', 'volume', 'ls', '--format', '{{json .}}'],
                capture_output=True, text=True
            )
            if result.returncode != 0:
                return []

            volumes = []
            for line in result.stdout.strip().split('\n'):
                if line:
                    volume = json.loads(line)
                    volumes.append({
                        'name': volume.get('Name'),
                        'driver': volume.get('Driver'),
                        'mountpoint': volume.get('Mountpoint'),
                    })
            return volumes
        except Exception:
            return []

    @staticmethod
    def create_volume(name, driver='local'):
        """Create a Docker volume."""
        try:
            result = subprocess.run(
                ['docker', 'volume', 'create', '--driver', driver, name],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'volume_name': result.stdout.strip()}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def remove_volume(volume_name, force=False):
        """Remove a Docker volume."""
        try:
            cmd = ['docker', 'volume', 'rm']
            if force:
                cmd.append('-f')
            cmd.append(volume_name)

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return {'success': True}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== DOCKER COMPOSE ====================

    @classmethod
    def compose_up(cls, project_path, detach=True, build=False):
        """Start Docker Compose services."""
        try:
            cmd = cls._get_compose_cmd() + ['up']
            if detach:
                cmd.append('-d')
            if build:
                cmd.append('--build')

            result = subprocess.run(
                cmd, cwd=project_path,
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'output': result.stdout}
            return {'success': False, 'error': result.stderr, 'output': result.stdout}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def compose_down(cls, project_path, volumes=False, remove_orphans=True):
        """Stop Docker Compose services."""
        try:
            cmd = cls._get_compose_cmd() + ['down']
            if volumes:
                cmd.append('-v')
            if remove_orphans:
                cmd.append('--remove-orphans')

            result = subprocess.run(
                cmd, cwd=project_path,
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'output': result.stdout}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def compose_ps(cls, project_path):
        """List Docker Compose services.

        Handles multiple output formats from docker compose ps --format json:
        - NDJSON: One JSON object per line (common in newer versions)
        - JSON Array: Single line with array of objects
        - Mixed: Warning messages (time=...) mixed with JSON

        Returns a list of container dictionaries.
        """
        try:
            result = subprocess.run(
                cls._get_compose_cmd() + ['ps', '--format', 'json'],
                cwd=project_path,
                capture_output=True, text=True
            )
            if result.returncode == 0 and result.stdout.strip():
                containers = []
                for line in result.stdout.strip().split('\n'):
                    line = line.strip()
                    # Skip empty lines and warning messages (e.g., "time=..." from docker)
                    if not line or line.startswith('time=') or line.startswith('WARN'):
                        continue
                    try:
                        parsed = json.loads(line)
                        # Handle both single object and array cases
                        if isinstance(parsed, list):
                            # JSON array on single line
                            containers.extend(parsed)
                        elif isinstance(parsed, dict):
                            # Single JSON object (NDJSON format)
                            containers.append(parsed)
                        # Skip if neither dict nor list (shouldn't happen)
                    except json.JSONDecodeError:
                        continue
                return containers
            return []
        except Exception:
            return []

    @classmethod
    def compose_logs(cls, project_path, service=None, tail=100):
        """Get Docker Compose logs."""
        try:
            cmd = cls._get_compose_cmd() + ['logs', '--tail', str(tail)]
            if service:
                cmd.append(service)

            result = subprocess.run(
                cmd, cwd=project_path,
                capture_output=True, text=True
            )
            return {'success': True, 'logs': result.stdout + result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def compose_restart(cls, project_path, service=None):
        """Restart Docker Compose services."""
        try:
            cmd = cls._get_compose_cmd() + ['restart']
            if service:
                cmd.append(service)

            result = subprocess.run(
                cmd, cwd=project_path,
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def compose_pull(cls, project_path, service=None):
        """Pull Docker Compose images."""
        try:
            cmd = cls._get_compose_cmd() + ['pull']
            if service:
                cmd.append(service)

            result = subprocess.run(
                cmd, cwd=project_path,
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'output': result.stdout}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def validate_compose_file(cls, project_path):
        """Validate a Docker Compose file."""
        try:
            result = subprocess.run(
                cls._get_compose_cmd() + ['config', '--quiet'],
                cwd=project_path,
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'valid': True}
            return {'valid': False, 'error': result.stderr}
        except Exception as e:
            return {'valid': False, 'error': str(e)}

    @classmethod
    def get_compose_config(cls, project_path):
        """Get parsed Docker Compose configuration."""
        try:
            result = subprocess.run(
                cls._get_compose_cmd() + ['config'],
                cwd=project_path,
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'config': yaml.safe_load(result.stdout)}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== UTILITY ====================

    @staticmethod
    def prune_system(all_unused=False, volumes=False):
        """Remove unused Docker resources."""
        try:
            cmd = ['docker', 'system', 'prune', '-f']
            if all_unused:
                cmd.append('-a')
            if volumes:
                cmd.append('--volumes')

            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode == 0:
                return {'success': True, 'output': result.stdout}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def get_disk_usage():
        """Get Docker disk usage."""
        try:
            result = subprocess.run(
                ['docker', 'system', 'df', '--format', '{{json .}}'],
                capture_output=True, text=True
            )
            if result.returncode != 0:
                return []

            usage = []
            for line in result.stdout.strip().split('\n'):
                if line:
                    usage.append(json.loads(line))
            return usage
        except Exception:
            return []

    @staticmethod
    def create_docker_app(app_path, app_name, image, ports=None, volumes=None, env=None):
        """Create a Docker-based application with docker-compose."""
        try:
            os.makedirs(app_path, exist_ok=True)

            # Create docker-compose.yml
            compose = {
                'version': '3.8',
                'services': {
                    app_name: {
                        'image': image,
                        'container_name': app_name,
                        'restart': 'unless-stopped',
                    }
                }
            }

            if ports:
                compose['services'][app_name]['ports'] = ports

            if volumes:
                compose['services'][app_name]['volumes'] = volumes

            if env:
                compose['services'][app_name]['environment'] = env

            compose_path = os.path.join(app_path, 'docker-compose.yml')
            with open(compose_path, 'w') as f:
                yaml.dump(compose, f, default_flow_style=False)

            # Create .env file
            if env:
                env_path = os.path.join(app_path, '.env')
                with open(env_path, 'w') as f:
                    for key, value in env.items():
                        f.write(f'{key}={value}\n')

            return {
                'success': True,
                'app_path': app_path,
                'compose_file': compose_path
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== DIAGNOSTICS ====================

    @staticmethod
    def check_port_accessible(port: int, host: str = '127.0.0.1') -> dict:
        """Check if a port is accessible (something is listening).

        Args:
            port: The port number to check
            host: The host address to check (default: 127.0.0.1)

        Returns:
            Dict with 'accessible' boolean and additional info
        """
        import socket
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(2)
            result = sock.connect_ex((host, port))
            sock.close()
            return {
                'accessible': result == 0,
                'port': port,
                'host': host
            }
        except Exception as e:
            return {'accessible': False, 'port': port, 'host': host, 'error': str(e)}

    @staticmethod
    def get_container_port_bindings(container_name: str) -> dict:
        """Get port bindings for a container.

        Args:
            container_name: Name or ID of the container

        Returns:
            Dict with 'success' boolean and 'ports' mapping
        """
        try:
            result = subprocess.run(
                ['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', container_name],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                ports = json.loads(result.stdout.strip())
                return {'success': True, 'ports': ports}
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def get_container_network_info(container_name: str) -> dict:
        """Get network information for a container.

        Args:
            container_name: Name or ID of the container

        Returns:
            Dict with network settings including IP addresses and ports
        """
        try:
            result = subprocess.run(
                ['docker', 'inspect', '--format', '{{json .NetworkSettings}}', container_name],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                network_settings = json.loads(result.stdout.strip())
                return {
                    'success': True,
                    'ip_address': network_settings.get('IPAddress'),
                    'ports': network_settings.get('Ports'),
                    'networks': network_settings.get('Networks'),
                    'gateway': network_settings.get('Gateway')
                }
            return {'success': False, 'error': result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}
