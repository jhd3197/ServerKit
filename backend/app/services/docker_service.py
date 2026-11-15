import logging
import re
import subprocess
import json
import os
import shlex
import yaml
from collections import deque
from datetime import datetime

from app.exceptions import DependencyUnavailableError
from app.utils.system import run_checked

logger = logging.getLogger(__name__)

# Metadata reads (ps, inspect, info, version) answer in well under a second
# on a healthy daemon. Unbounded, a wedged dockerd held each request thread
# forever; the panel runs one worker process, so they add up.
QUICK_TIMEOUT = 30

# Docker-style memory limit: a number plus a one-letter unit (bytes/kilo/mega/giga).
_MEMORY_LIMIT_RE = re.compile(r'^\d+(\.\d+)?(b|k|m|g)$', re.IGNORECASE)


class DockerService:
    """Service for managing Docker containers, images, and compose stacks."""

    _compose_cmd = None

    @classmethod
    def _get_compose_cmd(cls):
        """Detect whether to use 'docker compose' (v2) or 'docker-compose' (v1)."""
        if cls._compose_cmd is not None:
            return cls._compose_cmd
        # run_checked, not cls.run: this probe decides what `run_compose` will
        # invoke, so it must not depend on anything compose-shaped itself.
        #
        # Still wrapped: run_checked converts the exec failures it knows about
        # into a result, but this probe runs before anything else in the
        # compose path and must not be able to raise into its caller at all —
        # dropping the guard here made a broken Popen surface as
        # `compose up` exit_code -1 instead of falling back to v1.
        try:
            if run_checked(['docker', 'compose', 'version'], timeout=QUICK_TIMEOUT)['success']:
                cls._compose_cmd = ['docker', 'compose']
                return cls._compose_cmd
        except Exception as e:  # noqa: BLE001
            logger.error(f"Failed to detect docker compose v2: {e}")
        # Fallback to docker-compose (v1)
        cls._compose_cmd = ['docker-compose']
        return cls._compose_cmd

    @classmethod
    def _is_compose_v2(cls):
        """True when compose is the v2 plugin (``docker compose``).

        v1 and v2 do not share a global flag set, and v1 answers an unknown
        flag by printing its whole usage text and exiting 1 — which reads like
        a broken deployment rather than a bad argument. Anything v2-only has to
        be gated on this.
        """
        return cls._get_compose_cmd() == ['docker', 'compose']

    # Long docker operations (pull, build, compose up) are unbounded today.
    # `None` is passed explicitly at those call sites so the 60s default here
    # cannot silently cap a build; see COMPOSE/LONG notes below.
    @staticmethod
    def run(args, timeout=60, **kwargs):
        """Run ``docker <args>`` through ``run_checked``.

        Returns ``{'success', 'output', 'stderr', 'error', 'returncode'}``;
        ``error`` tells "docker missing" and "timed out" apart from the
        command saying no, so a slow probe is never reported as "not
        installed".
        """
        return run_checked(['docker', *args], timeout=timeout, **kwargs)

    @classmethod
    def available(cls):
        """True when the docker daemon answers. Never raises.

        Asks the daemon, not just the binary: ``docker version --format
        {{.Server.Version}}`` fails when the CLI is installed but the daemon is
        down, which is the state a "docker is available" check actually cares
        about.
        """
        if os.name == 'nt':
            return False
        return cls.run(['version', '--format', '{{.Server.Version}}'],
                       timeout=10)['success']

    @staticmethod
    def is_docker_installed():
        """Check if Docker is installed and running."""
        result = DockerService.run(['version', '--format', 'json'], timeout=QUICK_TIMEOUT)
        if not result['success']:
            return {'installed': False, 'error': result['error']}
        try:
            return {'installed': True, 'info': json.loads(result['output'])}
        except ValueError as e:
            return {'installed': False, 'error': f'unreadable docker version output: {e}'}

    @staticmethod
    def get_docker_info():
        """Get Docker system information."""
        result = DockerService.run(['info', '--format', '{{json .}}'], timeout=QUICK_TIMEOUT)
        if not result['success']:
            logger.error('Failed to get Docker info: %s', result['error'])
            return None
        try:
            return json.loads(result['output'])
        except ValueError as e:
            logger.error(f"Failed to get Docker info: {e}")
            return None

    # ==================== CONTAINER MANAGEMENT ====================

    # ServerKit's own infrastructure containers run the panel itself, so their
    # lifecycle must never be controllable from the Docker page — stopping,
    # restarting or removing one would take ServerKit offline. Matched as a
    # substring (case-insensitive) so both compose project names and the bare
    # service names ('serverkit-backend', 'serverkit_frontend', ...) are caught.
    PROTECTED_CONTAINER_NAMES = (
        'serverkit-frontend', 'serverkit_frontend',
        'serverkit-backend', 'serverkit_backend',
        'serverkit',
    )

    @staticmethod
    def is_protected_name(name):
        """True if a container name belongs to ServerKit's own infrastructure."""
        if not name:
            return False
        normalized = str(name).lower().replace('/', '')
        return any(p in normalized for p in DockerService.PROTECTED_CONTAINER_NAMES)

    @staticmethod
    def is_protected_container(container_id):
        """Resolve a container id/name to its real name and check protection.

        Accepts either an id or a name. Uses `docker inspect`, whose top-level
        ``Name`` key is the canonical name (e.g. ``/serverkit-backend``).
        """
        container = DockerService.get_container(container_id)
        name = (container or {}).get('Name', '') if container else ''
        # Fall back to the id itself when the user passed a name directly.
        return DockerService.is_protected_name(name) or DockerService.is_protected_name(container_id)

    @staticmethod
    def list_containers(all_containers=True):
        """List Docker containers.

        Raises DependencyUnavailableError when docker does not answer: an
        empty list would tell the UI "no containers" on a box running many.
        """
        args = ['ps', '--format', '{{json .}}']
        if all_containers:
            args.insert(1, '-a')

        result = DockerService.run(args, timeout=QUICK_TIMEOUT)
        if not result['success']:
            raise DependencyUnavailableError(
                'Docker is not reachable: '
                + (result.get('stderr') or result.get('error') or 'docker ps failed'))

        containers = []
        for line in result['output'].strip().split('\n'):
            if not line:
                continue
            try:
                container = json.loads(line)
            except ValueError:
                logger.warning('Unparseable docker ps line: %r', line)
                continue
            name = container.get('Names')
            containers.append({
                'id': container.get('ID'),
                'name': name,
                'image': container.get('Image'),
                'status': container.get('Status'),
                'state': container.get('State'),
                'ports': container.get('Ports'),
                'created': container.get('CreatedAt'),
                'size': container.get('Size'),
                # Flag ServerKit's own containers so the UI can hide
                # lifecycle controls; the API rejects them regardless.
                'protected': DockerService.is_protected_name(name),
            })
        return containers

    # One `docker ps` row, tab-delimited. Tabs are used instead of
    # `--format '{{json .}}'` because the JSON form flattens every label into a
    # single comma-joined `Labels` string — and compose's
    # `project.config_files` label is itself comma-separated, so that string
    # cannot be parsed back unambiguously. `{{.Label "k"}}` pulls each label
    # out on its own; none of these values can contain a tab.
    _PS_LABEL_FIELDS = (
        ('id', '{{.ID}}'),
        ('name', '{{.Names}}'),
        ('state', '{{.State}}'),
        ('status', '{{.Status}}'),
        ('project', '{{.Label "com.docker.compose.project"}}'),
        ('service', '{{.Label "com.docker.compose.service"}}'),
        ('working_dir', '{{.Label "com.docker.compose.project.working_dir"}}'),
        ('config_files', '{{.Label "com.docker.compose.project.config_files"}}'),
    )

    @classmethod
    def list_compose_containers(cls, all_containers=False):
        """Every container on this host in ONE `docker ps`, with compose labels.

        This exists so a caller that needs the state of N compose projects can
        pay for a single process spawn instead of one `docker compose ps` per
        project (plus one `docker inspect` per container). ``status`` carries
        the health suffix docker prints — ``Up 2 minutes (healthy)`` — which is
        the same information ``docker inspect`` would give under
        ``State.Health.Status``, so the inspect calls are not needed either.

        Args:
            all_containers: include stopped containers. Defaults to False so the
                result matches what ``docker compose ps`` (no ``--all``) would
                have listed.

        Returns:
            list[dict]: {id, name, state, status, project, service,
                         working_dir, config_files}. Empty on any failure —
                         callers treat that as "Docker unavailable".
        """
        keys = [k for k, _ in cls._PS_LABEL_FIELDS]
        fmt = '\t'.join(tpl for _, tpl in cls._PS_LABEL_FIELDS)
        args = ['ps', '--no-trunc', '--format', fmt]
        if all_containers:
            args.insert(1, '-a')

        result = cls.run(args, timeout=QUICK_TIMEOUT)
        if not result['success']:
            logger.warning('docker ps (bulk) failed: %s', result['error'])
            return []

        containers = []
        for line in result['output'].splitlines():
            if not line.strip():
                continue
            parts = line.split('\t')
            # Trailing empty labels can be dropped by the template engine; pad
            # rather than skip so a container with no compose labels still
            # contributes its id/name/state.
            parts += [''] * (len(keys) - len(parts))
            row = dict(zip(keys, (p.strip() for p in parts[:len(keys)])))
            # docker renders a missing label as '<no value>' in some versions.
            for k in ('project', 'service', 'working_dir', 'config_files'):
                if row.get(k) == '<no value>':
                    row[k] = ''
            containers.append(row)
        return containers

    @staticmethod
    def get_container(container_id):
        """Get detailed container information."""
        result = DockerService.run(['inspect', container_id], timeout=QUICK_TIMEOUT)
        if not result['success']:
            return None
        try:
            data = json.loads(result['output'])
        except ValueError as e:
            logger.error(f"Failed to inspect container {container_id}: {e}")
            return None
        return data[0] if data else None

    @staticmethod
    def create_container(image, name=None, ports=None, volumes=None, env=None,
                         network=None, restart_policy='unless-stopped', command=None):
        """Create a new container."""
        try:
            cmd = ['create']

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
                cmd.extend(shlex.split(command))

            # LONG: `docker create`/`run` pulls the image when it is absent.
            result = DockerService.run(cmd, timeout=None)
            if result['success']:
                return {'success': True, 'container_id': result['output'].strip()}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def run_container(image, name=None, ports=None, volumes=None, env=None,
                      network=None, restart_policy='unless-stopped', command=None, detach=True, labels=None):
        """Run a new container (create and start)."""
        try:
            cmd = ['run']

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

            for key, value in (labels or {}).items():
                cmd.extend(['--label', f'{key}={value}'])

            if network:
                cmd.extend(['--network', network])

            if restart_policy:
                cmd.extend(['--restart', restart_policy])

            cmd.append(image)

            if command:
                cmd.extend(shlex.split(command))

            # LONG: `docker create`/`run` pulls the image when it is absent.
            result = DockerService.run(cmd, timeout=None)
            if result['success']:
                return {'success': True, 'container_id': result['output'].strip()}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def start_container(container_id):
        """Start a container."""
        try:
            result = DockerService.run(['start', container_id], timeout=None)
            if result['success']:
                return {'success': True}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def stop_container(container_id, timeout=10):
        """Stop a container."""
        try:
            result = DockerService.run(['stop', '-t', str(timeout), container_id],
                                       timeout=None)
            if result['success']:
                # The panel emits the `app.stopped` event via the audit trail
                # (AuditService.log('app.stop') -> EventService.emit_for_audit),
                # so this low-level helper no longer emits its own event -- doing
                # so would double-fire it for Automations triggers.
                return {'success': True}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def restart_container(container_id, timeout=10):
        """Restart a container."""
        try:
            result = DockerService.run(['restart', '-t', str(timeout), container_id],
                                       timeout=None)
            if result['success']:
                return {'success': True}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def remove_container(container_id, force=False, volumes=False):
        """Remove a container."""
        try:
            cmd = ['rm']
            if force:
                cmd.append('-f')
            if volumes:
                cmd.append('-v')
            cmd.append(container_id)

            result = DockerService.run(cmd, timeout=None)
            if result['success']:
                return {'success': True}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def get_container_logs(container_id, tail=100, since=None, timestamps=True):
        """Get container logs."""
        try:
            cmd = ['logs']
            if tail:
                cmd.extend(['--tail', str(tail)])
            if since:
                cmd.extend(['--since', since])
            if timestamps:
                cmd.append('-t')
            cmd.append(container_id)

            # merge_stderr, not stdout + stderr: a container writes its log to
            # both streams and concatenating them loses the interleaving, so
            # the tail of a crash landed above the lines that led to it.
            result = DockerService.run(cmd, timeout=None, merge_stderr=True)
            return {'success': True, 'logs': result['output']}
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
        except Exception as e:
            logger.error(f"Failed to start log stream for container {container_id}: {e}")
            return None

    @staticmethod
    def _app_attr(app, name):
        """Read an attribute from a model instance or dict."""
        if isinstance(app, dict):
            return app.get(name)
        return getattr(app, name, None)

    @classmethod
    def get_app_container_id(cls, app):
        """Get the main container ID for an application.

        For apps with container_id set, use that directly.
        For compose apps, query docker compose ps to find container.

        Args:
            app: Application model instance (or dict with container_id, root_path, compose_file)

        Returns:
            str: Container ID or name, or None if not found
        """
        container_id = cls._app_attr(app, 'container_id')
        root_path = cls._app_attr(app, 'root_path')
        compose_file = cls._app_attr(app, 'compose_file')

        if container_id:
            return container_id

        if root_path:
            containers = cls.compose_ps(root_path, compose_file=compose_file)
            if containers:
                return containers[0].get('ID') or containers[0].get('Name') or containers[0].get('id')

        return None

    @classmethod
    def get_all_app_containers(cls, app):
        """Get all container IDs for a compose application.

        Args:
            app: Application model instance (or dict with root_path, compose_file)

        Returns:
            list: List of container info dicts with 'id', 'name', 'service', 'state'
        """
        root_path = cls._app_attr(app, 'root_path')
        compose_file = cls._app_attr(app, 'compose_file')

        if not root_path:
            container_id = cls._app_attr(app, 'container_id')
            if container_id:
                return [{'id': container_id, 'name': container_id, 'service': 'main', 'state': 'unknown'}]
            return []

        app_id = cls._app_attr(app, 'id')
        if (app_id and not isinstance(app, dict)
                and cls._app_attr(app, 'slot_deploys_enabled') and cls._app_attr(app, 'active_slot')):
            # A slot app: the live slot, its standby, its workers
            # (for compose, the live and standby projects).
            from app.services.slot_deploy_service import SlotDeployService
            return SlotDeployService.containers(app)
        containers = cls.compose_ps(root_path, compose_file=compose_file)
        if not containers and app_id and cls._app_attr(app, 'buildpack_type'):
            # A build-pack app is not a compose project: its deploy runs
            # `serverkit-app-<id>` plus one `serverkit-app-<id>-<process>` per
            # Procfile worker. Anchored so app 5 never lists 50.
            listed = cls.run(['ps', '-a', '--filter', f'name=^serverkit-app-{app_id}$',
                              '--filter', f'name=^serverkit-app-{app_id}-',
                              '--format', '{{json .}}'], timeout=30)
            prefix = f'serverkit-app-{app_id}-'
            result = []
            for line in (listed.get('output') or '').splitlines() if listed.get('success') else []:
                try:
                    c = json.loads(line)
                except ValueError:
                    continue
                name = c.get('Names') or ''
                result.append({
                    'id': c.get('ID'),
                    'name': name,
                    'service': name[len(prefix):] if name.startswith(prefix) else 'web',
                    'state': (c.get('State') or '').lower(),
                })
            return sorted(result, key=lambda c: (c['service'] != 'web', c['service']))
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

    # ==================== RESOURCE LIMITS (task #23) ====================

    @staticmethod
    def validate_cpu_limit(value):
        """Normalize a CPU-cores limit ('1.5' → '1.5'). Empty/None clears it.

        Returns the normalized string or None; raises ValueError when invalid.
        """
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        try:
            cores = float(text)
        except ValueError:
            raise ValueError('CPU limit must be a number of cores, e.g. "1.5"')
        if cores <= 0:
            raise ValueError('CPU limit must be a positive number of cores')
        return text

    @staticmethod
    def validate_memory_limit(value):
        """Normalize a memory limit ('512m', '2g'). Empty/None clears it.

        Returns the normalized (lowercased) string or None; raises ValueError
        when invalid.
        """
        if value is None:
            return None
        text = str(value).strip().lower()
        if not text:
            return None
        if not _MEMORY_LIMIT_RE.match(text):
            raise ValueError('Memory limit must be a number with a unit, e.g. "512m" or "2g"')
        return text

    @staticmethod
    def get_container_stats(container_id):
        """Get container resource usage stats."""
        try:
            result = DockerService.run(
                ['stats', '--no-stream', '--format', '{{json .}}', container_id],
                timeout=None)
            if result['success'] and result['output'].strip():
                return json.loads(result['output'].strip())
            return None
        except Exception as e:
            logger.error(f"Failed to get stats for container {container_id}: {e}")
            return None

    @staticmethod
    def get_containers_stats(container_ids):
        """Get resource usage stats for multiple containers in one Docker call."""
        if not container_ids:
            return {}

        try:
            cleaned_ids = [str(container_id) for container_id in container_ids if container_id]
            if not cleaned_ids:
                return {}

            result = DockerService.run(
                ['stats', '--no-stream', '--format', '{{json .}}', *cleaned_ids],
                timeout=None)
            if not result['success']:
                logger.error(f"Failed to get container stats: {result['error']}")
                return {}

            stats_map = {}
            for line in result['output'].splitlines():
                if not line.strip():
                    continue
                stats = json.loads(line)
                for key in (stats.get('ID'), stats.get('Container'), stats.get('Name')):
                    if key:
                        stats_map[key] = stats
            return stats_map
        except Exception as e:
            logger.error(f"Failed to get bulk container stats: {e}")
            return {}

    @staticmethod
    def exec_command(container_id, command, interactive=False, tty=False):
        """Execute a command in a running container."""
        try:
            cmd = ['exec']
            if interactive:
                cmd.append('-i')
            if tty:
                cmd.append('-t')
            cmd.append(container_id)
            cmd.extend(shlex.split(command))

            result = DockerService.run(cmd, timeout=60)
            if result['returncode'] is None:
                # The command never ran (no docker, timed out). Reporting a
                # return_code here would claim the container answered.
                return {'success': False, 'error': result['error']}
            return {
                'success': result['success'],
                'stdout': result['output'],
                'stderr': result['stderr'],
                'return_code': result['returncode'],
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== IMAGE MANAGEMENT ====================

    @staticmethod
    def list_images():
        """List Docker images."""
        try:
            result = DockerService.run(['images', '--format', '{{json .}}'],
                                       timeout=None)
            if not result['success']:
                return []

            images = []
            for line in result['output'].strip().split('\n'):
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
        except Exception as e:
            logger.error(f"Failed to list images: {e}")
            return []

    @staticmethod
    def pull_image(image_name, tag='latest', registry=None):
        """Pull an image from a registry.

        When ``registry`` (a ``ContainerRegistry``) is provided, ``docker login``
        runs first and ``docker logout`` after, so private images pull with the
        stored credentials. Login/pull/logout is wrapped in ``try/finally`` so we
        always log out — even when the pull fails. The signature stays
        backward-compatible: ``registry=None`` is an anonymous pull (today's
        behavior).
        """
        full_name = f'{image_name}:{tag}' if tag else image_name
        logged_in = False
        try:
            if registry is not None:
                from app.services.container_registry_service import ContainerRegistryService
                login = ContainerRegistryService.login(registry)
                if not login.get('success'):
                    return {'success': False,
                            'error': f"Registry login failed: {login.get('error')}"}
                logged_in = True

            # LONG: a pull is unbounded today and can legitimately run for
            # many minutes on a slow link.
            result = DockerService.run(['pull', full_name], timeout=None)
            if result['success']:
                return {'success': True, 'output': result['output']}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}
        finally:
            if logged_in and registry is not None:
                from app.services.container_registry_service import ContainerRegistryService
                ContainerRegistryService.logout(registry.login_host())

    @staticmethod
    def remove_image(image_id, force=False):
        """Remove an image."""
        try:
            cmd = ['rmi']
            if force:
                cmd.append('-f')
            cmd.append(image_id)

            result = DockerService.run(cmd, timeout=None)
            if result['success']:
                return {'success': True}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def build_image(path, tag, dockerfile='Dockerfile', no_cache=False):
        """Build an image from Dockerfile."""
        try:
            cmd = ['build', '-t', tag]
            if dockerfile != 'Dockerfile':
                cmd.extend(['-f', dockerfile])
            if no_cache:
                cmd.append('--no-cache')
            cmd.append(path)

            # LONG: a build is unbounded today.
            result = DockerService.run(cmd, timeout=None)
            if result['success']:
                return {'success': True, 'output': result['output']}
            return {'success': False, 'error': result['error'], 'output': result['output']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def tag_image(source, target):
        """Tag an image."""
        try:
            result = DockerService.run(['tag', source, target], timeout=QUICK_TIMEOUT)
            if result['success']:
                return {'success': True}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== NETWORK MANAGEMENT ====================

    @staticmethod
    def list_networks():
        """List Docker networks."""
        try:
            result = DockerService.run(['network', 'ls', '--format', '{{json .}}'],
                                       timeout=None)
            if not result['success']:
                return []

            networks = []
            for line in result['output'].strip().split('\n'):
                if line:
                    network = json.loads(line)
                    networks.append({
                        'id': network.get('ID'),
                        'name': network.get('Name'),
                        'driver': network.get('Driver'),
                        'scope': network.get('Scope'),
                    })
            return networks
        except Exception as e:
            logger.error(f"Failed to list networks: {e}")
            return []

    @staticmethod
    def create_network(name, driver='bridge'):
        """Create a Docker network."""
        try:
            result = DockerService.run(['network', 'create', '--driver', driver, name],
                                       timeout=None)
            if result['success']:
                return {'success': True, 'network_id': result['output'].strip()}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def ensure_network(name, driver='bridge'):
        """Idempotently ensure a Docker network exists (appliance tier).

        The shared external ``serverkit`` network lets manifest-generated app
        projects resolve each other by container name (fromService.host)."""
        if DockerService.run(['network', 'inspect', name], timeout=QUICK_TIMEOUT)['success']:
            return {'success': True, 'existed': True}
        created = DockerService.create_network(name, driver=driver)
        created['existed'] = False
        return created

    @staticmethod
    def remove_network(network_id):
        """Remove a Docker network."""
        try:
            result = DockerService.run(['network', 'rm', network_id], timeout=None)
            if result['success']:
                return {'success': True}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== VOLUME MANAGEMENT ====================

    @staticmethod
    def list_volumes():
        """List Docker volumes."""
        try:
            result = DockerService.run(['volume', 'ls', '--format', '{{json .}}'],
                                       timeout=None)
            if not result['success']:
                return []

            volumes = []
            for line in result['output'].strip().split('\n'):
                if line:
                    volume = json.loads(line)
                    volumes.append({
                        'name': volume.get('Name'),
                        'driver': volume.get('Driver'),
                        'mountpoint': volume.get('Mountpoint'),
                    })
            return volumes
        except Exception as e:
            logger.error(f"Failed to list volumes: {e}")
            return []

    @staticmethod
    def create_volume(name, driver='local'):
        """Create a Docker volume."""
        try:
            result = DockerService.run(['volume', 'create', '--driver', driver, name],
                                       timeout=None)
            if result['success']:
                return {'success': True, 'volume_name': result['output'].strip()}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def remove_volume(volume_name, force=False):
        """Remove a Docker volume."""
        try:
            cmd = ['volume', 'rm']
            if force:
                cmd.append('-f')
            cmd.append(volume_name)

            result = DockerService.run(cmd, timeout=None)
            if result['success']:
                return {'success': True}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def inspect_volume(name):
        """Live state of a named volume: {'present', 'mountpoint', 'driver'}."""
        try:
            result = DockerService.run(['volume', 'inspect', name], timeout=QUICK_TIMEOUT)
            if not result['success']:
                return {'present': False, 'mountpoint': None, 'driver': None}
            data = json.loads(result['output'] or '[]')
            info = data[0] if data else {}
            return {'present': True, 'mountpoint': info.get('Mountpoint'),
                    'driver': info.get('Driver')}
        except Exception:
            return {'present': False, 'mountpoint': None, 'driver': None}

    @staticmethod
    def containers_using_volume(name, running_only=False):
        """Names of containers referencing a volume. ``running_only`` limits it to
        currently-running containers (the guard for a safe wipe)."""
        try:
            cmd = ['ps']
            if not running_only:
                cmd.append('-a')
            cmd += ['--filter', f'volume={name}', '--format', '{{.Names}}']
            result = DockerService.run(cmd, timeout=None)
            if not result['success']:
                return []
            return [n for n in result['output'].strip().split('\n') if n]
        except Exception:
            return []

    # ==================== DOCKER COMPOSE ====================

    @classmethod
    def _compose_base_cmd(cls, compose_file=None):
        """Build the base docker compose command, optionally targeting a
        specific compose file. The file path may be absolute or relative to
        the project directory."""
        cmd = cls._get_compose_cmd()
        if compose_file:
            cmd = cmd + ['-f', compose_file]
        return cmd

    @classmethod
    def _compose_cmd_with_overlay(cls, project_path, compose_file=None):
        """Base compose command, including the ServerKit env override when one
        applies.

        For a managed compose app this regenerates ``docker-compose.serverkit.yml``
        (the app's effective env: shared variable groups under its own local env
        vars) and adds it as a second ``-f`` so those values reach the containers.
        For non-app dirs (e.g. a proxy stack) or apps with no effective env it
        falls back to the plain base command unchanged. Best-effort — never raises.
        """
        try:
            from app.services.compose_env_service import ComposeEnvService
            override = ComposeEnvService.refresh_for_project(project_path, compose_file)
            if override:
                base = ComposeEnvService.find_base_compose(project_path, compose_file)
                if base:
                    return cls._get_compose_cmd() + ['-f', base, '-f', override]
        except Exception as e:  # pragma: no cover - defensive
            logger.debug('compose overlay command build failed for %s: %s', project_path, e)
        return cls._compose_base_cmd(compose_file)

    @classmethod
    def run_compose(cls, cmd, *, cwd=None, timeout=None):
        """Run an already-built compose argv; the shared result shape.

        Separate from :meth:`run` because the argv head is whatever
        ``_get_compose_cmd()`` resolved — ``docker compose`` (v2) or
        ``docker-compose`` (v1) — not a literal ``docker``.

        ``timeout=None`` by default, unlike :meth:`run`. Every compose call in
        this file is unbounded today, and ``compose up --build`` on a small VPS
        routinely runs longer than a minute; inheriting a 60s default here
        would turn working deploys into timeouts. Bounding them is a real
        improvement and a deliberate behaviour change, not a side effect of
        this collapse.
        """
        return run_checked(cmd, cwd=cwd, timeout=timeout)

    @classmethod
    def compose_list(cls):
        """List Docker Compose projects known to the Docker CLI."""
        try:
            result = cls.run_compose(cls._get_compose_cmd() + ['ls', '--format', 'json'])
            if result['success'] and result['output'].strip():
                output = result['output'].strip()
                try:
                    parsed = json.loads(output)
                    if isinstance(parsed, list):
                        return parsed
                    if isinstance(parsed, dict):
                        return [parsed]
                except json.JSONDecodeError:
                    projects = []
                    for line in output.split('\n'):
                        line = line.strip()
                        if not line or line.startswith('time=') or line.startswith('WARN'):
                            continue
                        try:
                            parsed = json.loads(line)
                            if isinstance(parsed, list):
                                projects.extend(parsed)
                            elif isinstance(parsed, dict):
                                projects.append(parsed)
                        except json.JSONDecodeError:
                            continue
                    return projects

            return DockerService._compose_list_from_container_labels()
        except Exception as e:
            logger.error(f"Failed to list compose projects: {e}")
            return []

    @staticmethod
    def _compose_list_from_container_labels():
        """Fallback for older compose binaries without `compose ls --format json`."""
        try:
            result = DockerService.run(['ps', '-a', '--format', '{{json .}}'],
                                       timeout=None)
            if not result['success']:
                return []

            projects = {}
            for line in result['output'].strip().split('\n'):
                if not line:
                    continue
                container = json.loads(line)
                labels = {}
                for label in (container.get('Labels') or '').split(','):
                    if '=' in label:
                        key, value = label.split('=', 1)
                        labels[key] = value

                project = labels.get('com.docker.compose.project')
                if not project:
                    continue

                entry = projects.setdefault(project, {
                    'Name': project,
                    'Status': '',
                    'ConfigFiles': labels.get('com.docker.compose.project.config_files', ''),
                    'Running': 0,
                    'Containers': 0
                })
                entry['Containers'] += 1
                if (container.get('State') or '').lower() == 'running':
                    entry['Running'] += 1

            for project in projects.values():
                running = project.pop('Running', 0)
                total = project.pop('Containers', 0)
                stopped = max(total - running, 0)
                status_parts = []
                if running:
                    status_parts.append(f'running({running})')
                if stopped:
                    status_parts.append(f'exited({stopped})')
                project['Status'] = ', '.join(status_parts) or 'unknown'

            return list(projects.values())
        except Exception as e:
            logger.error(f"Failed to build compose project fallback list: {e}")
            return []

    @classmethod
    def compose_up(cls, project_path, detach=True, build=False, compose_file=None):
        """Start Docker Compose services.

        Injects the managed env override (shared variable groups + the app's own
        local env vars) for managed compose apps via ``_compose_cmd_with_overlay``.
        ``up -d`` recreates containers whose merged config changed, so updated env
        takes effect on the next deploy.
        """
        try:
            cmd = cls._compose_cmd_with_overlay(project_path, compose_file) + ['up']
            if detach:
                cmd.append('-d')
            if build:
                cmd.append('--build')

            result = cls.run_compose(cmd, cwd=project_path)
            if not result['success'] and cls._pin_subnets_on_pool_error(
                    project_path, compose_file,
                    ' '.join(str(result.get(k) or '') for k in ('error', 'stderr', 'output'))):
                result = cls.run_compose(cmd, cwd=project_path)
            if result['success']:
                return {'success': True, 'output': result['output']}
            return {'success': False, 'error': result['error'], 'output': result['output']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def _pin_subnets_on_pool_error(project_path, compose_file, text, on_line=None):
        """Pin the project's networks when ``compose up`` failed because
        Docker's default address pools are full. True means "retry the up".

        A stock daemon has room for about thirty compose networks; past that
        every new stack fails at network creation however idle the host is.
        """
        from app.services import compose_network_service
        if not compose_network_service.needs_pinned_subnet(text):
            return False
        result = compose_network_service.pin_project_subnets(
            project_path, compose_file, error_text=text)
        if result['success']:
            pins = ', '.join(f'{name} -> {subnet}' for name, subnet in result['pinned'].items())
            note = ("ServerKit: Docker's default address pools are full; "
                    f'pinned a dedicated subnet ({pins}) and retrying.')
        else:
            note = ("ServerKit: Docker's default address pools are full and no "
                    f"subnet could be pinned: {result['error']}")
        logger.warning('%s (%s)', note, project_path)
        if on_line:
            try:
                on_line(note)
            except Exception:
                pass
        return result['success']

    @classmethod
    def compose_up_streaming(cls, project_path, on_line, detach=True, build=False,
                             compose_file=None):
        """Start Docker Compose services, streaming each output line to on_line.

        Same overlay/command construction as ``compose_up``, but runs via Popen
        with plain, ANSI-free progress and delivers output
        line-by-line so the Deploy Console shows the real pull/build/start
        transcript live (the biggest reason template-install errors used to be
        unreadable). Returns ``{success, exit_code}``; the actual failure output
        lands in the stream (and thus the persisted failure tail), so no separate
        stderr blob is returned. Never raises — the buffered ``compose_up``
        remains for callers without a callback.
        """
        try:
            cmd = cls._compose_cmd_with_overlay(project_path, compose_file)
            # Global compose flags before the subcommand: no ANSI colors, plain
            # (non-TTY) progress so the transcript greps/reads cleanly. The
            # stream also strips residual ANSI/\r as a backstop.
            #
            # `--progress` is v2-only. Passing it to compose v1 made it print
            # its usage and exit 1, so every template install on a v1 host
            # failed at "Start Docker Compose stack" with a wall of help text
            # and no hint that the argument was the problem. `--ansi` is
            # understood by both.
            cmd = cmd + ['--ansi', 'never']
            if cls._is_compose_v2():
                cmd += ['--progress', 'plain']
            cmd.append('up')
            if detach:
                cmd.append('-d')
            if build:
                cmd.append('--build')

            def _run():
                proc = subprocess.Popen(
                    cmd, cwd=project_path,
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    text=True, bufsize=1,
                )
                # The tail is enough to recognise a network failure, and a
                # build can print megabytes before it gets there.
                transcript = deque(maxlen=200)
                for line in iter(proc.stdout.readline, ''):
                    transcript.append(line)
                    try:
                        on_line(line.rstrip('\n'))
                    except Exception:
                        pass
                proc.stdout.close()
                return proc.wait(), ''.join(transcript)

            exit_code, transcript = _run()
            if exit_code != 0 and cls._pin_subnets_on_pool_error(
                    project_path, compose_file, transcript, on_line=on_line):
                exit_code, _ = _run()
            return {'success': exit_code == 0, 'exit_code': exit_code}
        except Exception as e:
            try:
                on_line(f'docker compose up failed to start: {e}')
            except Exception:
                pass
            return {'success': False, 'exit_code': -1, 'error': str(e)}

    @classmethod
    def compose_down(cls, project_path, volumes=False, remove_orphans=True, compose_file=None):
        """Stop Docker Compose services."""
        try:
            cmd = cls._compose_base_cmd(compose_file) + ['down']
            if volumes:
                cmd.append('-v')
            if remove_orphans:
                cmd.append('--remove-orphans')

            result = cls.run_compose(cmd, cwd=project_path)
            if result['success']:
                return {'success': True, 'output': result['output']}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def compose_ps(cls, project_path, compose_file=None, strict=False):
        """List Docker Compose services.

        Handles multiple output formats from docker compose ps --format json:
        - NDJSON: One JSON object per line (common in newer versions)
        - JSON Array: Single line with array of objects
        - Mixed: Warning messages (time=...) mixed with JSON

        Returns a list of container dictionaries. A failed listing (e.g. the
        legacy docker-compose v1, which has no ``--format json``) is also an
        empty list unless ``strict``, which returns None instead — for callers
        that must not mistake "could not tell" for "no containers".
        """
        try:
            result = cls.run_compose(
                cls._compose_base_cmd(compose_file) + ['ps', '--format', 'json'],
                cwd=project_path)
            if result['success'] and result['output'].strip():
                containers = []
                for line in result['output'].strip().split('\n'):
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
            # docker-compose v1 answers `--format json` with its usage text on
            # stderr and exit code 0: "success" with nothing listed.
            unsupported = 'usage:' in (result.get('stderr') or '').lower()
            if strict and (not result['success'] or unsupported):
                return None
            return []
        except Exception as e:
            logger.error(f"Failed to list compose services: {e}")
            return None if strict else []

    @classmethod
    def compose_logs(cls, project_path, service=None, tail=100, compose_file=None):
        """Get Docker Compose logs."""
        try:
            cmd = cls._compose_base_cmd(compose_file) + ['logs', '--tail', str(tail)]
            if service:
                cmd.append(service)

            result = run_checked(cmd, cwd=project_path, timeout=None,
                                 merge_stderr=True)
            return {'success': True, 'logs': result['output']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def compose_restart(cls, project_path, service=None, compose_file=None):
        """Restart Docker Compose services."""
        try:
            cmd = cls._compose_base_cmd(compose_file) + ['restart']
            if service:
                cmd.append(service)

            result = cls.run_compose(cmd, cwd=project_path)
            if result['success']:
                return {'success': True}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def compose_pull(cls, project_path, service=None, compose_file=None):
        """Pull Docker Compose images."""
        try:
            cmd = cls._compose_base_cmd(compose_file) + ['pull']
            if service:
                cmd.append(service)

            result = cls.run_compose(cmd, cwd=project_path)
            if result['success']:
                return {'success': True, 'output': result['output']}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def compose_build(cls, project_path, service=None, compose_file=None, no_cache=False):
        """Build the project's images without starting anything.

        The deploy preflight runs this *before* the live
        containers are stopped, so a build failure can no longer take a site
        down: the subsequent ``up --build`` re-uses the layer cache.
        """
        try:
            cmd = cls._compose_base_cmd(compose_file) + ['build']
            if no_cache:
                cmd.append('--no-cache')
            if service:
                cmd.append(service)

            result = cls.run_compose(cmd, cwd=project_path)
            if result['success']:
                return {'success': True, 'output': result['output']}
            return {'success': False, 'error': result['error'], 'output': result['output']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def image_exists(image_ref):
        """True when the image is already in the local image store."""
        try:
            return DockerService.run(['image', 'inspect', image_ref],
                                     timeout=None)['success']
        except Exception:
            return False

    @classmethod
    def validate_compose_file(cls, project_path, compose_file=None):
        """Validate a Docker Compose file."""
        try:
            result = cls.run_compose(
                cls._compose_base_cmd(compose_file) + ['config', '--quiet'],
                cwd=project_path)
            if result['success']:
                return {'valid': True}
            return {'valid': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_compose_config(cls, project_path, compose_file=None):
        """Get parsed Docker Compose configuration."""
        try:
            result = cls.run_compose(
                cls._compose_base_cmd(compose_file) + ['config'],
                cwd=project_path)
            if result['success']:
                return {'success': True, 'config': yaml.safe_load(result['output'])}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==================== UTILITY ====================

    @staticmethod
    def prune_system(all_unused=False, volumes=False):
        """Remove unused Docker resources."""
        try:
            cmd = ['system', 'prune', '-f']
            if all_unused:
                cmd.append('-a')
            if volumes:
                cmd.append('--volumes')

            # LONG: reclaiming a large layer cache is unbounded today.
            result = DockerService.run(cmd, timeout=None)
            if result['success']:
                return {'success': True, 'output': result['output']}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def get_disk_usage():
        """Get Docker disk usage."""
        try:
            result = DockerService.run(['system', 'df', '--format', '{{json .}}'],
                                       timeout=None)
            if not result['success']:
                return []

            usage = []
            for line in result['output'].strip().split('\n'):
                if line:
                    usage.append(json.loads(line))
            return usage
        except Exception as e:
            logger.error(f"Failed to get Docker disk usage: {e}")
            return []

    @staticmethod
    def create_docker_app(app_path, app_name, image, ports=None, volumes=None, env=None,
                          named_volumes=None, cpu_limit=None, memory_limit=None,
                          host_requirements=None, networks=None):
        """Create a Docker-based application with docker-compose.

        ``named_volumes`` is a list of managed Docker volume names to declare as
        top-level (``external: false``) volumes — Compose requires the top-level
        declaration for any named volume referenced by a service. Callers pass the
        matching ``name:/mount`` specs in ``volumes`` (see AppVolume.mount_spec).

        ``cpu_limit`` / ``memory_limit`` (task #23) emit ``cpus`` / ``mem_limit``
        on the app's service block so Docker enforces the caps.

        ``host_requirements`` (appliance tier) emits
        ``privileged`` / ``cap_add`` / ``sysctls`` / ``devices`` — exactly the
        fields catalog templates already pass through.
        """
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

            if cpu_limit:
                compose['services'][app_name]['cpus'] = float(cpu_limit)

            if memory_limit:
                compose['services'][app_name]['mem_limit'] = str(memory_limit)

            if named_volumes:
                # Top-level named volumes so a redeploy reuses the same volume
                # instead of a fresh anonymous one.
                compose['volumes'] = {name: {} for name in named_volumes}

            if host_requirements:
                hr = host_requirements
                svc = compose['services'][app_name]
                if hr.get('privileged'):
                    svc['privileged'] = True
                if hr.get('cap_add'):
                    svc['cap_add'] = list(hr['cap_add'])
                if hr.get('sysctls'):
                    svc['sysctls'] = dict(hr['sysctls'])
                if hr.get('devices'):
                    svc['devices'] = list(hr['devices'])

            if networks:
                # Attach to shared external network(s) so manifest apps resolve
                # each other by container name (fromService.host).
                for net in networks:
                    DockerService.ensure_network(net)
                compose['services'][app_name]['networks'] = list(networks)
                compose['networks'] = {net: {'external': True} for net in networks}

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
            result = DockerService.run(
                ['inspect', '--format', '{{json .NetworkSettings.Ports}}', container_name],
                timeout=None)
            if result['success']:
                return {'success': True, 'ports': json.loads(result['output'].strip())}
            return {'success': False, 'error': result['error']}
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
            result = DockerService.run(
                ['inspect', '--format', '{{json .NetworkSettings}}', container_name],
                timeout=None)
            if result['success']:
                network_settings = json.loads(result['output'].strip())
                return {
                    'success': True,
                    'ip_address': network_settings.get('IPAddress'),
                    'ports': network_settings.get('Ports'),
                    'networks': network_settings.get('Networks'),
                    'gateway': network_settings.get('Gateway')
                }
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}
