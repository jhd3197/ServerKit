import subprocess
import json
import os
import yaml
from datetime import datetime


class DockerService:
    """Service for managing Docker containers, images, and compose stacks."""

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

    @staticmethod
    def compose_up(project_path, detach=True, build=False):
        """Start Docker Compose services."""
        try:
            cmd = ['docker', 'compose', 'up']
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

    @staticmethod
    def compose_down(project_path, volumes=False, remove_orphans=True):
        """Stop Docker Compose services."""
        try:
            cmd = ['docker', 'compose', 'down']
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

    @staticmethod
    def compose_ps(project_path):
        """List Docker Compose services."""
        try:
            result = subprocess.run(
                ['docker', 'compose', 'ps', '--format', 'json'],
                cwd=project_path,
                capture_output=True, text=True
            )
            if result.returncode == 0 and result.stdout.strip():
                return json.loads(result.stdout)
            return []
        except Exception:
            return []

    @staticmethod
    def compose_logs(project_path, service=None, tail=100):
        """Get Docker Compose logs."""
        try:
            cmd = ['docker', 'compose', 'logs', '--tail', str(tail)]
            if service:
                cmd.append(service)

            result = subprocess.run(
                cmd, cwd=project_path,
                capture_output=True, text=True
            )
            return {'success': True, 'logs': result.stdout + result.stderr}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def compose_restart(project_path, service=None):
        """Restart Docker Compose services."""
        try:
            cmd = ['docker', 'compose', 'restart']
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

    @staticmethod
    def compose_pull(project_path, service=None):
        """Pull Docker Compose images."""
        try:
            cmd = ['docker', 'compose', 'pull']
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

    @staticmethod
    def validate_compose_file(project_path):
        """Validate a Docker Compose file."""
        try:
            result = subprocess.run(
                ['docker', 'compose', 'config', '--quiet'],
                cwd=project_path,
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'valid': True}
            return {'valid': False, 'error': result.stderr}
        except Exception as e:
            return {'valid': False, 'error': str(e)}

    @staticmethod
    def get_compose_config(project_path):
        """Get parsed Docker Compose configuration."""
        try:
            result = subprocess.run(
                ['docker', 'compose', 'config'],
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
