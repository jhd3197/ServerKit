"""The panel half of the Cloud inventory.

Two documents, both read from things the panel already knows, both sent up
the existing `facts` stream, neither of them deciding anything:

**`inventory/1`** — the host, the applications, their domains and their
deployment history, and the managed databases. Cloud keys every application
on `key`, which is this panel's own row id: a name is a label and a rename
must not create a second application in Cloud.

**`diagnostics/1`** — the busiest processes and the mounted filesystems.
That is a separate disclosure with its own consent on the Cloud side, and
Cloud says so in its answer: `collect: false` means stop asking, and this
module's caller backs off until the answer changes.

Neither builder raises. A collector that fails leaves its section out of
`capabilities`, names the reason in `sections`, and the other sections are
still sent. What this never sends, because Cloud drops it on arrival and a
reader should not wonder where it went: environment values, command lines,
connection strings, credentials, repository URLs (a slug, a branch and a
commit instead — a URL can carry a token), and arbitrary filesystem paths.
"""
import logging
import platform
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

INVENTORY_SCHEMA = 'inventory/1'
DIAGNOSTICS_SCHEMA = 'diagnostics/1'

# Cloud's own bounds (backend/inventory.py there). Kept here so a valid but
# very large inventory is capped with `complete: false` rather than sent
# whole and refused whole.
MAX_APPLICATIONS = 500
MAX_DATABASES = 500
MAX_DEPLOYMENTS = 500
MAX_DEPLOYMENTS_PER_APP = 20
MAX_DOMAINS_PER_APP = 32
MAX_PORTS_PER_APP = 32
MAX_PROCESSES = 20
MAX_MOUNTS = 64

# The panel's application states, in Cloud's vocabulary. Anything else is
# passed through as reported rather than guessed at.
_APP_STATE = {
    'running': 'running',
    'stopped': 'stopped',
    'error': 'failed',
    'deploying': 'restarting',
}

# Deployment statuses likewise.
_DEPLOY_STATUS = {
    'live': 'succeeded',
    'failed': 'failed',
    'rolled_back': 'cancelled',
    'pending': 'queued',
    'building': 'building',
    'deploying': 'running',
}


def _utc(dt):
    if dt is None:
        return None
    dt = dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    return dt.isoformat()


def _now():
    return datetime.now(timezone.utc).isoformat()


def _in_app(app, fn):
    """Run `fn` inside the Flask app context when one was given."""
    if app is None:
        return fn()
    with app.app_context():
        return fn()


# ==================== inventory ====================


def build_inventory(app=None, generation: int = 0) -> dict:
    """One inventory document. Never raises.

    `generation` is the caller's counter — it increments per publish for
    the life of this process, and Cloud treats a value that goes backwards
    (a panel restart) as a reset it names rather than ignores.
    """
    doc = {
        'schema': INVENTORY_SCHEMA,
        'generation': int(generation or 0),
        'observed_at': _now(),
        'capabilities': [],
        'sections': {},
    }

    host = _host()
    if host:
        doc['host'] = host
        doc['capabilities'].append('host')

    for name, collect in (('applications', lambda: _in_app(app, _applications)),
                          ('databases', lambda: _in_app(app, _databases)),
                          ('deployments', lambda: _in_app(app, _deployments))):
        try:
            rows, complete = collect()
        except Exception as exc:  # noqa: BLE001 - a collector must not take the document down
            logger.debug('Connect inventory: could not list %s', name, exc_info=True)
            doc['sections'][name] = {'complete': False, 'error': _reason(exc)}
            continue
        doc[name] = rows
        doc['sections'][name] = {'complete': bool(complete)}
        doc['capabilities'].append(name)

    return doc


def _reason(exc) -> str:
    # Driver exceptions can contain SQL parameters or connection credentials.
    # The full exception is logged locally by the collector.
    return type(exc).__name__


def _host() -> dict | None:
    """OS, kernel, CPU, memory, Docker and boot time. Provider and region are
    not guessed from a hostname; they are omitted until something reports
    them."""
    out = {}
    try:
        out['os'] = platform.system() or None
        out['os_version'] = _os_version()
        out['kernel'] = platform.release() or None
        out['arch'] = platform.machine() or None
    except Exception:  # noqa: BLE001
        logger.debug('Connect inventory: platform probe failed', exc_info=True)
    try:
        import psutil
        out['cpu_count'] = psutil.cpu_count(logical=True) or None
        out['memory_bytes'] = int(psutil.virtual_memory().total)
        out['boot_at'] = datetime.fromtimestamp(psutil.boot_time(), tz=timezone.utc).isoformat()
    except Exception:  # noqa: BLE001
        logger.debug('Connect inventory: psutil probe failed', exc_info=True)
    try:
        from app.services.system_service import SystemService
        info = SystemService.get_system_info() or {}
        model = (info.get('cpu') or {}).get('model')
        if model and model != 'Unknown':
            out['cpu_model'] = model
    except Exception:  # noqa: BLE001
        logger.debug('Connect inventory: cpu model probe failed', exc_info=True)
    try:
        from app.utils.version import get_panel_version
        out['panel_version'] = get_panel_version()
    except Exception:  # noqa: BLE001
        pass
    docker = _docker_version()
    if docker:
        out['docker_version'] = docker
    out = {k: v for k, v in out.items() if v not in (None, '')}
    return out or None


def _os_version() -> str | None:
    try:
        import os
        release = {}
        with open('/etc/os-release', encoding='utf-8') as fh:  # noqa: PTH123
            for line in fh:
                if '=' in line:
                    key, _, value = line.strip().partition('=')
                    release[key] = value.strip('"')
        return release.get('PRETTY_NAME') or release.get('VERSION_ID') or None
    except Exception:  # noqa: BLE001
        return platform.version()[:60] or None


def _docker_version() -> str | None:
    try:
        from app.services.docker_service import DockerService
        version = DockerService.get_version() if hasattr(DockerService, 'get_version') else None
        if isinstance(version, dict):
            return version.get('Version') or version.get('version')
        return version or None
    except Exception:  # noqa: BLE001
        return None


def _applications():
    from app.models.application import Application

    rows = (Application.query_active()
            .order_by(Application.id.asc())
            .limit(MAX_APPLICATIONS + 1)
            .all())
    complete = len(rows) <= MAX_APPLICATIONS
    out = []
    for row in rows[:MAX_APPLICATIONS]:
        out.append(_application(row))
    return out, complete


def _application(row) -> dict:
    """One application as Cloud's contract wants it. The key is the row id."""
    item = {
        'key': str(row.id),
        'name': row.name,
        'runtime': _runtime(row),
        'state': _APP_STATE.get(str(row.status or '').lower(), row.status),
    }
    source = _source(row)
    if source:
        item['source'] = source
    domains = _app_domains(row)
    if domains:
        item['domains'] = domains
    ports = _app_ports(row)
    if ports:
        item['ports'] = ports
    admin = _admin_url(row, domains)
    if admin:
        item['admin_url'] = admin
    current = _current_deployment(row)
    if current:
        item['deployment'] = current
    return item


def _runtime(row) -> str:
    managed = str(getattr(row, 'managed_by', '') or '').lower()
    app_type = str(getattr(row, 'app_type', '') or '').lower()
    if managed == 'docker_compose' or getattr(row, 'compose_file', None):
        return 'compose'
    if managed == 'systemd' or getattr(row, 'systemd_unit', None):
        return 'systemd'
    if app_type == 'docker' or getattr(row, 'docker_image', None):
        return 'docker'
    if app_type == 'static':
        return 'static'
    return 'native'


def _source(row) -> dict | None:
    """Slug, branch and commit only. A repository URL is reduced to its
    `owner/name` path; the host and any token in it never leave."""
    out = {}
    try:
        from app.models.webhook import GitWebhook
        hook = (GitWebhook.query.filter_by(app_id=row.id)
                .order_by(GitWebhook.id.desc()).first())
    except Exception:  # noqa: BLE001
        hook = None
    if hook is not None:
        slug = _repo_slug(getattr(hook, 'source_repo_url', None))
        if slug:
            out['slug'] = slug
        if getattr(hook, 'source_branch', None):
            out['branch'] = hook.source_branch
    latest = _latest_deployment_row(row)
    if latest is not None and getattr(latest, 'commit_hash', None):
        out['commit'] = latest.commit_hash
    return out or None


def _repo_slug(url) -> str | None:
    if not url:
        return None
    text = str(url).strip().split('?', 1)[0].split('#', 1)[0]
    # git@host:owner/name.git or https://host/owner/name(.git)
    if ':' in text and '://' not in text:
        text = text.split(':', 1)[1]
    else:
        text = text.split('://', 1)[-1]
        text = text.split('/', 1)[1] if '/' in text else ''
    text = text.rstrip('/')
    if text.endswith('.git'):
        text = text[:-4]
    parts = [p for p in text.split('/') if p]
    return '/'.join(parts[-2:]) if len(parts) >= 2 else None


def _app_domains(row) -> list:
    out = []
    try:
        domains = row.live_domains
    except Exception:  # noqa: BLE001
        domains = []
    domains = sorted(domains, key=lambda d: not getattr(d, 'is_primary', False))
    for d in domains[:MAX_DOMAINS_PER_APP]:
        entry = {'host': d.name}
        if getattr(d, 'ssl_enabled', False) and getattr(d, 'ssl_expires_at', None):
            entry['tls_expires_at'] = _utc(d.ssl_expires_at)
        entry['state'] = 'active' if getattr(d, 'ssl_enabled', False) else 'no-tls'
        out.append(entry)
    return out


def _app_ports(row) -> list:
    ports = []
    if getattr(row, 'port', None):
        ports.append(int(row.port))
    raw = getattr(row, 'ports', None)
    if raw:
        try:
            import json
            declared = json.loads(raw) if isinstance(raw, str) else raw
            for item in declared or []:
                value = item.get('host') if isinstance(item, dict) else item
                if isinstance(value, int) and value not in ports:
                    ports.append(value)
        except Exception:  # noqa: BLE001
            pass
    return ports[:MAX_PORTS_PER_APP]


def _admin_url(row, domains) -> str | None:
    """Only where this panel itself knows the application's admin page.

    WordPress is the one type the panel installs and configures, so its
    dashboard path is a fact about what the panel set up rather than a guess
    about what might be there. Every other type reports nothing.
    """
    if str(getattr(row, 'app_type', '') or '').lower() != 'wordpress':
        return None
    primary = None
    for d in domains or []:
        primary = d['host']
        break
    if not primary:
        return None
    scheme = 'https' if domains[0].get('state') == 'active' else 'http'
    return f'{scheme}://{primary}/wp-admin/'


def _latest_deployment_row(row):
    try:
        from app.models.deployment import Deployment
        return (Deployment.query.filter_by(app_id=row.id)
                .order_by(Deployment.version.desc()).first())
    except Exception:  # noqa: BLE001
        return None


def _current_deployment(row) -> dict | None:
    latest = _latest_deployment_row(row)
    if latest is None:
        return None
    return {
        'key': f'{row.id}:{latest.version}',
        'status': _DEPLOY_STATUS.get(str(latest.status or '').lower(), latest.status),
        'at': _utc(latest.deploy_completed_at or latest.build_started_at or latest.created_at),
    }


def _deployments():
    """Recent deployments per application, newest first, bounded per app and
    overall. Stage times come from the panel's own build/deploy timestamps."""
    from app.models.application import Application
    from app.models.deployment import Deployment

    out = []
    complete = True
    app_ids = [r.id for r in Application.query_active().with_entities(Application.id)
               .order_by(Application.id.asc()).limit(MAX_APPLICATIONS).all()]
    for app_id in app_ids:
        rows = (Deployment.query.filter_by(app_id=app_id)
                .order_by(Deployment.version.desc())
                .limit(MAX_DEPLOYMENTS_PER_APP + 1).all())
        if len(rows) > MAX_DEPLOYMENTS_PER_APP:
            complete = False
        for d in rows[:MAX_DEPLOYMENTS_PER_APP]:
            out.append(_deployment(app_id, d))
            if len(out) >= MAX_DEPLOYMENTS:
                return out, False
    return out, complete


def _deployment(app_id, d) -> dict:
    started = d.build_started_at or d.created_at
    finished = d.deploy_completed_at
    item = {
        'key': f'{app_id}:{d.version}',
        'app_key': str(app_id),
        'status': _DEPLOY_STATUS.get(str(d.status or '').lower(), d.status),
        'started_at': _utc(started),
        'finished_at': _utc(finished),
    }
    if d.duration is not None:
        item['duration_s'] = float(d.duration)
    artifact = {}
    if getattr(d, 'image_tag', None):
        artifact['image'] = d.image_tag
    if getattr(d, 'commit_hash', None):
        artifact['commit'] = d.commit_hash
    if artifact:
        item['artifact'] = artifact
    stages = []
    if d.build_started_at and d.build_completed_at:
        stages.append({'name': 'build', 'status': 'succeeded' if d.status != 'failed' or d.deploy_started_at else 'failed',
                       'duration_s': float(d.build_duration or 0)})
    if d.deploy_started_at and d.deploy_completed_at:
        stages.append({'name': 'deploy',
                       'status': 'failed' if d.status == 'failed' else 'succeeded',
                       'duration_s': (d.deploy_completed_at - d.deploy_started_at).total_seconds()})
    if stages:
        item['stages'] = stages
    return item


def _databases():
    """Names, engines and states only. The row also holds an admin secret
    and a host; neither is read here."""
    from app.models.managed_database import ManagedDatabase

    rows = (ManagedDatabase.query_active()
            .order_by(ManagedDatabase.id.asc())
            .limit(MAX_DATABASES + 1).all())
    complete = len(rows) <= MAX_DATABASES
    out = []
    for row in rows[:MAX_DATABASES]:
        out.append({
            'key': str(row.id),
            'name': row.name,
            'engine': _engine(row.engine),
            'state': 'running' if getattr(row, 'host_kind', 'host') == 'host'
            else _container_state(getattr(row, 'container_ref', None)),
        })
    return out, complete


def _engine(value) -> str | None:
    text = str(value or '').lower()
    return {'postgresql': 'postgres'}.get(text, text) or None


def _container_state(ref) -> str | None:
    if not ref:
        return None
    try:
        from app.services.docker_service import DockerService
        info = DockerService.get_container(ref) if hasattr(DockerService, 'get_container') else None
        state = str((info or {}).get('status') or (info or {}).get('state') or '').lower()
        if 'running' in state or 'up' in state:
            return 'running'
        return 'stopped' if state else None
    except Exception:  # noqa: BLE001
        return None


# ==================== diagnostics ====================


def build_diagnostics(interval_s: int = 60) -> dict:
    """The busiest processes and every mount. Executable name, pid, user
    and resource use — never a command line, never an environment."""
    doc = {
        'schema': DIAGNOSTICS_SCHEMA,
        'observed_at': _now(),
        'interval_s': int(interval_s),
        'completeness': {},
    }
    try:
        processes, total = _processes()
        doc['processes'] = processes
        doc['completeness']['processes'] = {'complete': total <= MAX_PROCESSES,
                                            'truncated': total > MAX_PROCESSES,
                                            'total': total}
    except Exception as exc:  # noqa: BLE001
        doc['processes'] = []
        doc['completeness']['processes'] = {'complete': False, 'error': _reason(exc)}
    try:
        mounts, total = _mounts()
        doc['mounts'] = mounts
        doc['completeness']['mounts'] = {'complete': total <= MAX_MOUNTS,
                                         'truncated': total > MAX_MOUNTS, 'total': total}
    except Exception as exc:  # noqa: BLE001
        doc['mounts'] = []
        doc['completeness']['mounts'] = {'complete': False, 'error': _reason(exc)}
    return doc


def _processes():
    import psutil
    rows = []
    for proc in psutil.process_iter(['pid', 'name', 'username', 'cpu_percent',
                                     'memory_info', 'create_time']):
        try:
            info = proc.info
            mem = info.get('memory_info')
            rows.append({
                'pid': info.get('pid'),
                'name': info.get('name'),
                'user': info.get('username'),
                'cpu_pct': float(info.get('cpu_percent') or 0.0),
                'rss_bytes': int(mem.rss) if mem else None,
                'started_at': datetime.fromtimestamp(info['create_time'], tz=timezone.utc).isoformat()
                if info.get('create_time') else None,
            })
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    total = len(rows)
    rows.sort(key=lambda r: (r['cpu_pct'], r['rss_bytes'] or 0), reverse=True)
    return rows[:MAX_PROCESSES], total


def _mounts():
    import psutil
    rows = []
    for part in psutil.disk_partitions(all=False):
        try:
            usage = psutil.disk_usage(part.mountpoint)
        except (PermissionError, OSError):
            continue
        rows.append({
            'mount': part.mountpoint,
            'device': part.device,
            'fstype': part.fstype,
            'total_bytes': int(usage.total),
            'used_bytes': int(usage.used),
            'used_pct': round(float(usage.percent), 2),
        })
    total = len(rows)
    rows.sort(key=lambda r: r['used_pct'], reverse=True)
    return rows[:MAX_MOUNTS], total


# ==================== frames ====================


def inventory_frame(stream_id: str, doc: dict) -> dict:
    """Same `facts` stream kind the older shapeless document used; Cloud keys
    on `schema` and an older Cloud answers exactly as it always did."""
    return {'s': stream_id, 't': 'open', 'k': 'facts', 'p': doc}
