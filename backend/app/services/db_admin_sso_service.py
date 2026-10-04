"""One-click DB admin SSO via a disposable Adminer container.

``launch()`` mints a short-lived, single-database shadow credential
(``ManagedDatabaseUser`` with ``is_shadow=True``), makes sure a containerized
Adminer is running (labelled ``serverkit.role=adminer-sso``, random high host
port, on the ``serverkit`` network), and returns a launch descriptor the
frontend POSTs straight into Adminer's login form. The password crosses exactly
once in that response and is never persisted.

``reap()`` (job kind ``databases.sso.reap``) drops expired shadow users
engine-side + their rows, and stops the Adminer container after 15 idle
minutes. All docker interaction funnels through the single choke-point
``_docker`` so tests can stub it. Linux/docker-only by design.
"""
import logging
import os
import secrets
from datetime import datetime, timedelta

from app.services.docker_service import DockerService

logger = logging.getLogger(__name__)

SHADOW_TTL_MINUTES = 5
ADMINER_IDLE_MINUTES = 15

ADMINER_IMAGE = 'adminer:latest'
ADMINER_CONTAINER = 'serverkit-adminer-sso'
ADMINER_LABEL = 'serverkit.role=adminer-sso'
NETWORK_NAME = 'serverkit'  # same network the proxy stacks use

REAP_JOB_KIND = 'databases.sso.reap'
REAP_SCHEDULE_NAME = 'db-sso-reap'

# Adminer login-form driver values per engine.
_ADMINER_DRIVERS = {'mysql': 'server', 'postgresql': 'pgsql'}


class DbAdminSsoService:
    """Mint scoped shadow credentials and hand out Adminer launch descriptors."""

    # Last time an SSO launch used the Adminer container (per-process; the
    # panel is single-worker by design so this is authoritative enough).
    _last_used_at = None

    # ── choke-point: ALL docker interaction goes through here (tests stub it) ──
    @classmethod
    def _docker(cls, args, timeout=60):
        """Run ``docker <args>`` — via DockerService.run (§G3).

        The named seam stays because this service's tests stub it; the wrapper
        body does not.
        """
        return DockerService.run(args, timeout=timeout)

    @classmethod
    def _docker_available(cls):
        return DockerService.available()

    # ── Adminer container lifecycle ──
    @classmethod
    def _find_adminer_port(cls):
        """Host port of an already-running labelled Adminer, or None."""
        result = cls._docker(['ps', '--filter', f'label={ADMINER_LABEL}',
                              '--filter', 'status=running',
                              '--format', '{{.Names}}'])
        if not result.get('success') or not (result.get('output') or '').strip():
            return None
        name = result['output'].strip().split('\n')[0].strip()
        port_result = cls._docker(['port', name, '8080/tcp'])
        if not port_result.get('success'):
            return None
        # e.g. "0.0.0.0:31245" (possibly one line per address family)
        for line in (port_result.get('output') or '').strip().split('\n'):
            if ':' in line:
                try:
                    return int(line.rsplit(':', 1)[1])
                except ValueError:
                    continue
        return None

    @classmethod
    def _ensure_adminer(cls):
        """Reuse the running labelled Adminer or start a fresh one.
        Returns ``{'port': int}`` or ``{'error': msg}``."""
        port = cls._find_adminer_port()
        if port:
            return {'port': port}

        # A stopped leftover with our name blocks docker run — clear it first.
        cls._docker(['rm', '-f', ADMINER_CONTAINER])
        # The shared network usually exists (proxy stacks); create is idempotent
        # enough for our purposes — failure just means it's already there.
        cls._docker(['network', 'create', NETWORK_NAME])

        host_port = 20000 + secrets.randbelow(20000)  # random high port
        result = cls._docker([
            'run', '-d',
            '--name', ADMINER_CONTAINER,
            '--label', ADMINER_LABEL,
            '--network', NETWORK_NAME,
            '--add-host', 'host.docker.internal:host-gateway',
            '-p', f'{host_port}:8080',
            '--restart', 'no',
            ADMINER_IMAGE,
        ])
        if not result.get('success'):
            return {'error': result.get('error') or 'Failed to start Adminer'}
        return {'port': host_port}

    @classmethod
    def _server_for(cls, managed):
        """The DB host as reachable FROM the Adminer container."""
        if managed.host_kind == 'docker' and managed.container_ref:
            # Same docker network — the container name resolves directly.
            return managed.container_ref
        host = managed.host or 'localhost'
        if host in ('localhost', '127.0.0.1'):
            host = 'host.docker.internal'
        port = managed.effective_port()
        return f'{host}:{port}' if port else host

    # ── the headline ──
    @classmethod
    def launch(cls, managed, requested_by=None):
        """Mint a scoped shadow credential + return the Adminer launch descriptor.

        The returned password exists only in this response — it is never stored
        or logged. Grants are ALL on this ONE database, nothing else.
        """
        from app.services.managed_db_user_service import ManagedDbUserService

        driver = _ADMINER_DRIVERS.get(managed.engine)
        if not driver:
            return {'error': 'unsupported engine', 'code': 'unsupported_engine'}
        if not cls._docker_available():
            return {'error': 'Docker required', 'code': 'docker_required'}

        expires_at = datetime.utcnow() + timedelta(minutes=SHADOW_TTL_MINUTES)
        username = f'sk_sso_{secrets.token_hex(3)}'
        created = ManagedDbUserService.create_user(
            managed, username=username, grants=['ALL'],
            is_shadow=True, expires_at=expires_at,
        )
        if 'error' in created:
            return created

        adminer = cls._ensure_adminer()
        if 'error' in adminer:
            # Don't leave a live credential behind a failed launch.
            from app.models.managed_database_user import ManagedDatabaseUser
            from app import db
            row = ManagedDatabaseUser.query.get(created['user']['id'])
            if row is not None:
                for sql in ManagedDbUserService._drop_user_sql(managed.engine, username):
                    ManagedDbUserService._exec_sql(managed, sql)
                db.session.delete(row)
                db.session.commit()
            return adminer

        cls._last_used_at = datetime.utcnow()
        logger.info('SSO launch for managed db %s (%s) by user %s as %s',
                    managed.id, managed.name, requested_by, username)
        return {
            'port': adminer['port'],
            'driver': driver,
            'server': cls._server_for(managed),
            'username': username,
            'password': created['password'],  # crosses once, never persisted
            'database': managed.name,
            'expires_at': expires_at.isoformat(),
        }

    # ── reaping ──
    @classmethod
    def reap(cls):
        """Drop expired shadow credentials and stop an idle Adminer.
        Returns ``{'users_removed': int, 'adminer_stopped': bool}``."""
        from app.services.managed_db_user_service import ManagedDbUserService

        removed = ManagedDbUserService.reap_expired_shadow_users()

        stopped = False
        idle_cutoff = datetime.utcnow() - timedelta(minutes=ADMINER_IDLE_MINUTES)
        if (cls._last_used_at is None or cls._last_used_at < idle_cutoff) \
                and os.name != 'nt':
            if cls._find_adminer_port() is not None:
                result = cls._docker(['rm', '-f', ADMINER_CONTAINER])
                stopped = bool(result.get('success'))
                if stopped:
                    logger.info('Stopped idle Adminer SSO container')
        return {'users_removed': removed, 'adminer_stopped': stopped}

    @classmethod
    def register_jobs(cls):
        """Register the reap handler with the unified job system. The schedule
        row is seeded with the other builtins in seed_builtin_schedules().
        Called once at app startup (see app/__init__.py)."""
        from app.jobs import registry
        registry.register(REAP_JOB_KIND, lambda job: cls.reap(), replace=True)
