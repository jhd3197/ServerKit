"""ProxyStackService — manage a per-server Dockerized reverse-proxy stack.

Design notes
------------
Host Nginx stays the default reverse proxy and is *superior* for
PHP/WordPress (FastCGI, fine-grained per-site config). This service is the
opt-in path for running a containerized proxy — Traefik or Caddy — as a
Compose stack on a server, with versioned config backups.

The TESTABLE CORE is two pure generators:

  * ``generate_compose`` — returns a valid docker-compose YAML *string* for
    traefik/caddy (or ``None`` for nginx). Deterministic; no I/O.
  * ``generate_config``  — returns a minimal proxy config (Traefik dynamic
    file / Caddyfile) for a list of site dicts. Deterministic; no I/O.

Everything that touches Docker or the filesystem (``deploy_stack``,
``regenerate``, ``status``) is BEST-EFFORT and GUARDED: it imports and runs
without a live Docker daemon, returning a structured result instead of
raising. Remote-server execution (via the agent) is left as future work — for
now provisioning is host-local + best-effort.
"""
import os
import json
import hashlib
import logging
from datetime import datetime

import yaml

logger = logging.getLogger(__name__)


class ProxyStackService:
    """Static service for managed reverse-proxy stacks."""

    # Canonical proxy types. 'nginx' = host nginx (no stack).
    PROXY_TYPES = ('nginx', 'traefik', 'caddy')

    # The shared external docker network managed apps attach to. The proxy
    # joins it so it can reach upstream containers by name.
    NETWORK_NAME = 'serverkit'

    # Pinned images keep generated compose deterministic and testable.
    TRAEFIK_IMAGE = 'traefik:v3.1'
    CADDY_IMAGE = 'caddy:2.8'

    # ------------------------------------------------------------------
    # Pure generators (the testable core)
    # ------------------------------------------------------------------

    @staticmethod
    def generate_compose(server_id, proxy_type, options=None):
        """Return a docker-compose YAML string for the given proxy type.

        Pure & deterministic — no I/O, safe to unit-test. For ``nginx`` it
        returns ``None`` (host nginx needs no Compose stack).

        ``options`` (dict, optional):
          - ``acme_email``: enable ACME/Let's Encrypt with this contact email
          - ``dashboard``:  expose the Traefik dashboard (insecure) — default off
          - ``network``:    override the external network name
        """
        proxy_type = (proxy_type or 'nginx').lower()
        options = options or {}
        network = options.get('network') or ProxyStackService.NETWORK_NAME

        if proxy_type == 'nginx':
            return None

        if proxy_type == 'traefik':
            return ProxyStackService._traefik_compose(server_id, network, options)

        if proxy_type == 'caddy':
            return ProxyStackService._caddy_compose(server_id, network, options)

        raise ValueError(f"Unknown proxy_type: {proxy_type!r}")

    @staticmethod
    def _traefik_compose(server_id, network, options):
        acme_email = options.get('acme_email')
        dashboard = bool(options.get('dashboard'))

        command = [
            '--providers.docker=true',
            '--providers.docker.exposedbydefault=false',
            f'--providers.docker.network={network}',
            '--providers.file.directory=/etc/traefik/dynamic',
            '--providers.file.watch=true',
            '--entrypoints.web.address=:80',
            '--entrypoints.websecure.address=:443',
        ]
        ports = ['80:80', '443:443']
        volumes = [
            '/var/run/docker.sock:/var/run/docker.sock:ro',
            './dynamic:/etc/traefik/dynamic:ro',
        ]

        if acme_email:
            command += [
                '--certificatesresolvers.serverkit.acme.tlschallenge=true',
                f'--certificatesresolvers.serverkit.acme.email={acme_email}',
                '--certificatesresolvers.serverkit.acme.storage=/acme/acme.json',
            ]
            volumes.append('./acme:/acme')

        if dashboard:
            command.append('--api.dashboard=true')
            command.append('--api.insecure=true')
            ports.append('8080:8080')

        compose = {
            'services': {
                'proxy': {
                    'image': ProxyStackService.TRAEFIK_IMAGE,
                    'container_name': f'serverkit-proxy-{server_id[:8]}',
                    'restart': 'unless-stopped',
                    'command': command,
                    'ports': ports,
                    'volumes': volumes,
                    'networks': [network],
                },
            },
            'networks': {
                network: {'external': True},
            },
        }
        return yaml.safe_dump(compose, sort_keys=False, default_flow_style=False)

    @staticmethod
    def _caddy_compose(server_id, network, options):
        acme_email = options.get('acme_email')

        environment = {}
        if acme_email:
            environment['ACME_AGREE'] = 'true'
            environment['CADDY_EMAIL'] = acme_email

        service = {
            'image': ProxyStackService.CADDY_IMAGE,
            'container_name': f'serverkit-proxy-{server_id[:8]}',
            'restart': 'unless-stopped',
            'ports': ['80:80', '443:443'],
            'volumes': [
                './Caddyfile:/etc/caddy/Caddyfile:ro',
                'caddy_data:/data',
                'caddy_config:/config',
            ],
            'networks': [network],
        }
        if environment:
            service['environment'] = environment

        compose = {
            'services': {
                'proxy': service,
            },
            'networks': {
                network: {'external': True},
            },
            'volumes': {
                'caddy_data': {},
                'caddy_config': {},
            },
        }
        return yaml.safe_dump(compose, sort_keys=False, default_flow_style=False)

    @staticmethod
    def generate_config(proxy_type, sites, custom_snippet=None):
        """Return a minimal proxy config for a list of site dicts.

        Pure & deterministic. Each site dict may carry:
          - ``domain``   (required): the public hostname
          - ``upstream`` : host:port or container name the proxy forwards to
          - ``tls``      : truthy → enable HTTPS for that site

        For ``traefik`` this returns a YAML dynamic-config file; for ``caddy``
        a Caddyfile. ``custom_snippet`` is appended verbatim. ``nginx`` returns
        ``None`` (host nginx config is owned elsewhere).
        """
        proxy_type = (proxy_type or 'nginx').lower()
        sites = sites or []

        if proxy_type == 'nginx':
            return None

        if proxy_type == 'traefik':
            return ProxyStackService._traefik_dynamic(sites, custom_snippet)

        if proxy_type == 'caddy':
            return ProxyStackService._caddyfile(sites, custom_snippet)

        raise ValueError(f"Unknown proxy_type: {proxy_type!r}")

    @staticmethod
    def _traefik_dynamic(sites, custom_snippet):
        routers = {}
        services = {}
        for i, site in enumerate(sites):
            domain = site.get('domain')
            if not domain:
                continue
            upstream = site.get('upstream') or 'http://app:80'
            if not upstream.startswith('http'):
                upstream = f'http://{upstream}'
            name = f"site{i}"
            router = {
                'rule': f'Host(`{domain}`)',
                'service': name,
                'entryPoints': ['websecure' if site.get('tls') else 'web'],
            }
            if site.get('tls'):
                router['tls'] = {'certResolver': 'serverkit'}
            routers[name] = router
            services[name] = {
                'loadBalancer': {'servers': [{'url': upstream}]}
            }

        dynamic = {'http': {'routers': routers, 'services': services}}
        out = yaml.safe_dump(dynamic, sort_keys=False, default_flow_style=False)
        if custom_snippet:
            out = out + '\n# --- custom snippet ---\n' + custom_snippet.strip() + '\n'
        return out

    @staticmethod
    def _caddyfile(sites, custom_snippet):
        lines = []
        for site in sites:
            domain = site.get('domain')
            if not domain:
                continue
            upstream = site.get('upstream') or 'app:80'
            lines.append(f'{domain} {{')
            lines.append(f'    reverse_proxy {upstream}')
            if not site.get('tls'):
                # Disable automatic HTTPS for plain-HTTP sites — keeps TLS
                # opt-in, matching the host-nginx "SSL stays optional" stance.
                lines.append('    tls internal')
            lines.append('}')
            lines.append('')

        out = '\n'.join(lines)
        if custom_snippet:
            out = out + '\n# --- custom snippet ---\n' + custom_snippet.strip() + '\n'
        return out

    @staticmethod
    def config_hash(content):
        """Deterministic 8-char hash of a config/compose string.

        Pure — used both to name versioned backups and to detect no-op
        regenerations. SHA-256 truncated to 8 hex chars.
        """
        if content is None:
            content = ''
        return hashlib.sha256(content.encode('utf-8')).hexdigest()[:8]

    # ------------------------------------------------------------------
    # DB / row management
    # ------------------------------------------------------------------

    @staticmethod
    def _stack_dir(server_id):
        """On-disk directory for this server's proxy stack.

        Lives under the apps base so it sits next to managed-app compose
        projects. Pure path computation; does not create anything.
        """
        try:
            from app import paths
            base = paths.APPS_DIR
        except Exception:
            base = os.path.join(os.getcwd(), 'apps')
        return os.path.join(base, 'proxy', server_id)

    @staticmethod
    def get_or_create(server_id):
        """Return the ProxyStack row for a server, creating a default
        (host-nginx) row if none exists."""
        from app import db
        from app.models.proxy_stack import ProxyStack

        stack = ProxyStack.query.filter_by(server_id=server_id).first()
        if stack:
            return stack

        stack = ProxyStack(
            server_id=server_id,
            proxy_type='nginx',
            status='unknown',
            networks=json.dumps([ProxyStackService.NETWORK_NAME]),
        )
        db.session.add(stack)
        db.session.commit()
        return stack

    @staticmethod
    def configure(server_id, proxy_type=None, custom_snippet=None):
        """Update a server's proxy configuration (type and/or snippet).

        Does NOT touch Docker — pure DB mutation. Call ``deploy_stack`` /
        ``regenerate`` afterwards to apply.
        """
        from app import db

        stack = ProxyStackService.get_or_create(server_id)

        if proxy_type is not None:
            pt = proxy_type.lower()
            if pt not in ProxyStackService.PROXY_TYPES:
                raise ValueError(f"Unknown proxy_type: {proxy_type!r}")
            stack.proxy_type = pt
            # The compose_path only makes sense for stack-based proxies.
            if pt == 'nginx':
                stack.compose_path = None
            else:
                stack.compose_path = os.path.join(
                    ProxyStackService._stack_dir(server_id), 'docker-compose.yml'
                )

        if custom_snippet is not None:
            stack.custom_snippet = custom_snippet

        db.session.commit()
        return stack

    @staticmethod
    def switch(server_id, proxy_type):
        """Flip a server to a different proxy type. Thin wrapper over
        ``configure`` that exists for a clear, intention-revealing API."""
        return ProxyStackService.configure(server_id, proxy_type=proxy_type)

    # ------------------------------------------------------------------
    # Best-effort provisioning (guarded — no hard Docker dependency)
    # ------------------------------------------------------------------

    @staticmethod
    def _write_stack_files(stack, options=None):
        """Write compose + config to disk for a stack-based proxy.

        Best-effort: returns the stack dir on success, None on nginx/failure.
        """
        if stack.proxy_type == 'nginx':
            return None
        compose = ProxyStackService.generate_compose(
            stack.server_id, stack.proxy_type, options
        )
        if compose is None:
            return None

        stack_dir = ProxyStackService._stack_dir(stack.server_id)
        try:
            os.makedirs(stack_dir, exist_ok=True)
            compose_path = os.path.join(stack_dir, 'docker-compose.yml')
            with open(compose_path, 'w', encoding='utf-8') as f:
                f.write(compose)

            config = ProxyStackService.generate_config(
                stack.proxy_type, [], stack.custom_snippet
            )
            if config is not None:
                if stack.proxy_type == 'caddy':
                    cfg_path = os.path.join(stack_dir, 'Caddyfile')
                else:
                    dyn_dir = os.path.join(stack_dir, 'dynamic')
                    os.makedirs(dyn_dir, exist_ok=True)
                    cfg_path = os.path.join(dyn_dir, 'serverkit.yml')
                with open(cfg_path, 'w', encoding='utf-8') as f:
                    f.write(config)
            return stack_dir
        except OSError as e:
            logger.warning(f"Failed to write proxy stack files: {e}")
            return None

    @staticmethod
    def deploy_stack(server_id, options=None):
        """Best-effort: write files + `compose up` the proxy stack.

        Guarded so it never raises on a missing Docker daemon — returns a
        structured result. For host-nginx there's nothing to deploy.
        """
        from app import db

        stack = ProxyStackService.get_or_create(server_id)

        if stack.proxy_type == 'nginx':
            stack.status = 'unknown'
            db.session.commit()
            return {'success': True, 'message': 'Host nginx — no stack to deploy.'}

        stack_dir = ProxyStackService._write_stack_files(stack, options)
        if not stack_dir:
            stack.status = 'error'
            db.session.commit()
            return {'success': False, 'error': 'Could not write stack files.'}

        stack.compose_path = os.path.join(stack_dir, 'docker-compose.yml')
        stack.last_regenerated_at = datetime.utcnow()

        result = {'success': False, 'error': 'Docker unavailable'}
        try:
            from app.services.docker_service import DockerService
            result = DockerService.compose_up(stack_dir, detach=True)
        except Exception as e:  # pragma: no cover - depends on live docker
            logger.warning(f"deploy_stack compose_up failed: {e}")
            result = {'success': False, 'error': str(e)}

        stack.status = 'running' if result.get('success') else 'error'
        db.session.commit()
        return result

    @staticmethod
    def regenerate(server_id, sites=None, options=None):
        """Rewrite the proxy config (+ best-effort hot reload).

        Backs up the current config first, regenerates, and tries a reload.
        Guarded — returns a result dict; never hard-depends on Docker.
        """
        from app import db

        stack = ProxyStackService.get_or_create(server_id)

        if stack.proxy_type == 'nginx':
            return {'success': True, 'message': 'Host nginx — managed elsewhere.'}

        # Snapshot the existing config before we overwrite it.
        ProxyStackService.backup_config(server_id)

        stack_dir = ProxyStackService._write_stack_files(stack, options)
        if not stack_dir:
            return {'success': False, 'error': 'Could not write stack files.'}

        stack.last_regenerated_at = datetime.utcnow()

        reload_result = {'success': False, 'error': 'Docker unavailable'}
        try:
            from app.services.docker_service import DockerService
            reload_result = DockerService.compose_restart(stack_dir, service='proxy')
        except Exception as e:  # pragma: no cover - depends on live docker
            logger.warning(f"regenerate reload failed: {e}")
            reload_result = {'success': False, 'error': str(e)}

        db.session.commit()
        return {
            'success': True,
            'reloaded': bool(reload_result.get('success')),
            'reload_error': reload_result.get('error'),
        }

    @staticmethod
    def backup_config(server_id):
        """Keep a versioned copy of the current compose file.

        Names backups ``docker-compose.<timestamp>.<hash8>.yml`` where the
        hash is the pure ``config_hash`` of the file contents — so identical
        configs always produce the same suffix. Best-effort; returns the
        backup path or None.
        """
        stack_dir = ProxyStackService._stack_dir(server_id)
        compose_path = os.path.join(stack_dir, 'docker-compose.yml')
        if not os.path.exists(compose_path):
            return None
        try:
            with open(compose_path, 'r', encoding='utf-8') as f:
                content = f.read()
            digest = ProxyStackService.config_hash(content)
            ts = datetime.utcnow().strftime('%Y%m%d%H%M%S')
            backup_dir = os.path.join(stack_dir, 'backups')
            os.makedirs(backup_dir, exist_ok=True)
            backup_path = os.path.join(
                backup_dir, f'docker-compose.{ts}.{digest}.yml'
            )
            with open(backup_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return backup_path
        except OSError as e:
            logger.warning(f"backup_config failed: {e}")
            return None

    @staticmethod
    def fleet_overview(user):
        """Fleet-wide proxy posture: one row per server *user* can access.

        Best-effort and guarded — never raises. Joins each such ``Server`` with its
        ``ProxyStack`` (if one exists). Servers that never opted into a managed
        stack report the host-nginx default (``proxy_type='nginx'``,
        ``status='host'``) rather than being omitted, so the dashboard shows the
        *whole* fleet, not just the servers with a configured stack.

        Returns a list of flat dicts:
          ``{server_id, server_name, proxy_type, status, last_regenerated_at,
             networks_count}``
        """
        try:
            from app.models.server import Server
            from app.models.proxy_stack import ProxyStack
        except Exception as e:  # pragma: no cover - import guard
            logger.warning(f"fleet_overview imports failed: {e}")
            return []

        try:
            from app.services.workspace_service import WorkspaceService
            servers = WorkspaceService.filter_accessible_servers(
                Server.query, user).order_by(Server.name).all()
        except Exception as e:  # pragma: no cover - DB guard
            logger.warning(f"fleet_overview server query failed: {e}")
            return []

        # One query for all stacks, keyed by server_id, to avoid N+1 lookups.
        stacks_by_server = {}
        try:
            for stack in ProxyStack.query.all():
                stacks_by_server[stack.server_id] = stack
        except Exception as e:  # pragma: no cover - DB guard
            logger.warning(f"fleet_overview stack query failed: {e}")

        # One query for every server-bound app, grouped by server, so each row
        # can report how many of its apps disagree with the server's proxy mode.
        apps_by_server = ProxyStackService._apps_by_server()

        overview = []
        for server in servers:
            stack = stacks_by_server.get(server.id)
            proxy_type = (stack.proxy_type if stack else 'nginx') or 'nginx'
            app_count, mismatch_count = ProxyStackService._ingress_counts(
                proxy_type, apps_by_server.get(server.id, [])
            )
            recommendation = ProxyStackService._recommendation(
                proxy_type, app_count, mismatch_count
            )
            if stack is not None:
                overview.append({
                    'server_id': server.id,
                    'server_name': server.name,
                    'proxy_type': proxy_type,
                    'status': stack.status or 'unknown',
                    'last_regenerated_at': (
                        stack.last_regenerated_at.isoformat()
                        if stack.last_regenerated_at else None
                    ),
                    'networks_count': len(stack.networks_list()),
                    'app_count': app_count,
                    'mismatch_count': mismatch_count,
                    'recommendation': recommendation,
                })
            else:
                # No managed stack → host nginx is in charge. 'host' is a
                # distinct status from the stack states (running/stopped/...) so
                # the UI can render "host default" rather than a runtime state.
                overview.append({
                    'server_id': server.id,
                    'server_name': server.name,
                    'proxy_type': 'nginx',
                    'status': 'host',
                    'last_regenerated_at': None,
                    'networks_count': 0,
                    'app_count': app_count,
                    'mismatch_count': mismatch_count,
                    'recommendation': recommendation,
                })

        return overview

    # ------------------------------------------------------------------
    # Ingress-plane reconciliation (which proxy is expected to serve an app)
    # ------------------------------------------------------------------

    @staticmethod
    def _apps_by_server():
        """Map server_id -> [Application] for every server-bound app. Guarded."""
        grouped = {}
        try:
            from app.models.application import Application
            # query_active(): a tombstoned app is not served by any proxy, so
            # counting it here would report a mismatch nothing can resolve.
            apps = Application.query_active().filter(Application.server_id.isnot(None)).all()
        except Exception as e:  # pragma: no cover - DB guard
            logger.warning(f"_apps_by_server query failed: {e}")
            return grouped
        for app in apps:
            grouped.setdefault(app.server_id, []).append(app)
        return grouped

    @staticmethod
    def _ingress_counts(proxy_type, apps):
        """(app_count, mismatch_count) for a server's apps vs its proxy mode."""
        from app.utils.ingress import expected_plane_for_proxy, default_ingress_plane
        expected = expected_plane_for_proxy(proxy_type)
        mismatches = 0
        for app in apps:
            plane = app.ingress_plane or default_ingress_plane(app.app_type, app.managed_by)
            if plane != expected:
                mismatches += 1
        return len(apps), mismatches

    @staticmethod
    def _recommendation(proxy_type, app_count, mismatch_count):
        """Turn a server's proxy posture into an actionable per-row hint.

        Pure & deterministic (computed from the counts already in scope), so the
        fleet table can tell the operator what to DO, not just what IS.

          - any mismatch          -> warn  (align the apps or switch the proxy)
          - stack proxy, no apps   -> info  (running but unused)
          - host nginx, no apps    -> info  (nothing on this server yet)
          - otherwise              -> ok    (apps aligned with the proxy)
        """
        proxy_type = (proxy_type or 'nginx').lower()
        is_stack = proxy_type in ('traefik', 'caddy')

        if mismatch_count > 0:
            plural = 'app' if mismatch_count == 1 else 'apps'
            return {
                'level': 'warn',
                'text': (
                    f"{mismatch_count} {plural} expect a different ingress plane — "
                    "align them or switch this server's proxy"
                ),
            }
        if is_stack and app_count == 0:
            return {'level': 'info', 'text': 'Proxy stack running with no apps yet'}
        if not is_stack and app_count == 0:
            return {'level': 'info', 'text': 'No apps on this server'}
        return {'level': 'ok', 'text': 'Apps aligned with proxy'}

    @staticmethod
    def ingress_audit(server_id):
        """Per-server ingress reconciliation: which apps disagree with the
        server's configured proxy mode.

        A host can only run one ingress plane on 80/443, so an app tagged for
        the *other* plane than the server's active proxy would either be
        unreachable or collide. This surfaces those so the operator can fix the
        boundary (move the app, or switch the server's proxy). Best-effort.
        """
        from app.utils.ingress import expected_plane_for_proxy, default_ingress_plane

        server = None
        proxy_type = 'nginx'
        apps = []
        try:
            from app.models.server import Server
            from app.models.proxy_stack import ProxyStack
            from app.models.application import Application
            server = Server.query.get(server_id)
            stack = ProxyStack.query.filter_by(server_id=server_id).first()
            proxy_type = (stack.proxy_type if stack else 'nginx') or 'nginx'
            # query_active(): these rows are the repair allowlist — a tombstone
            # would become a phantom mismatch no action can clear.
            apps = Application.query_active().filter_by(server_id=server_id).all()
        except Exception as e:  # pragma: no cover - DB guard
            logger.warning(f"ingress_audit query failed: {e}")

        expected = expected_plane_for_proxy(proxy_type)
        rows = []
        mismatches = 0
        for app in apps:
            plane = app.ingress_plane or default_ingress_plane(app.app_type, app.managed_by)
            mismatch = plane != expected
            if mismatch:
                mismatches += 1
            rows.append({
                'id': app.id,
                'name': app.name,
                'app_type': app.app_type,
                'ingress_plane': plane,
                'mismatch': mismatch,
                'reason': (
                    f"App expects '{plane}' but this server's proxy is "
                    f"'{proxy_type}' (expects '{expected}')."
                ) if mismatch else None,
            })

        return {
            'server_id': server_id,
            'server_name': server.name if server else None,
            'proxy_type': proxy_type,
            'expected_plane': expected,
            'app_count': len(apps),
            'mismatch_count': mismatches,
            'apps': rows,
        }

    @staticmethod
    def status(server_id):
        """Best-effort runtime status of the proxy stack.

        Returns the stored row state plus, when Docker is reachable, the live
        container state from `compose ps`. Never raises.
        """
        from app import db

        stack = ProxyStackService.get_or_create(server_id)
        result = stack.to_dict()
        result['running_containers'] = []

        if stack.proxy_type == 'nginx' or not stack.compose_path:
            return result

        stack_dir = os.path.dirname(stack.compose_path)
        try:
            from app.services.docker_service import DockerService
            containers = DockerService.compose_ps(stack_dir)
            result['running_containers'] = containers or []
            # Reconcile stored status with reality when we can see it.
            if containers:
                running = any(
                    str(c.get('State', '')).lower() == 'running' for c in containers
                )
                new_status = 'running' if running else 'stopped'
                if stack.status != new_status:
                    stack.status = new_status
                    db.session.commit()
                result['status'] = new_status
        except Exception as e:  # pragma: no cover - depends on live docker
            logger.debug(f"status() docker probe failed: {e}")

        return result
