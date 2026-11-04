"""Agent-reported health: permission level, service checks, silence, alerts.

Everything here consumes what the agent REPORTS (registration, auth, heartbeat,
or the monitor-mode ``/agent/report`` POST). Alerts reuse ``MetricAlert`` and the
fleet notification path; one active row per (server, metric) de-duplicates.
"""
import hashlib
import hmac
import logging
import time
from datetime import datetime, timedelta

from app import db
from app.models.audit_log import AuditLog
from app.models.metric_alert import MetricAlert
from app.models.server import Server
from app.services import permission_levels
from app.services.nonce_service import nonce_service

logger = logging.getLogger(__name__)

MIN_SILENCE_SECONDS = 180      # monitor agents: offline after max(3 min, 3x interval)
DEFAULT_INTERVAL_SECONDS = 60
DEFAULT_INTERVAL = DEFAULT_INTERVAL_SECONDS
OFFLINE_METRIC = 'offline'
OPEN = ('active', 'acknowledged')
BAD = ('down',)


def _notify(opened=(), resolved=()):
    if not opened and not resolved:
        return
    try:
        from app.jobs.builtin_handlers import _notify_fleet_alerts
        _notify_fleet_alerts(list(opened), list(resolved))
    except Exception:
        logger.exception('Could not notify agent health alerts')


def _open_alert(server, metric, detail):
    """Open an alert unless one is already open. Returns it if newly opened."""
    if MetricAlert.query.filter(MetricAlert.server_id == server.id,
                                MetricAlert.metric == metric,
                                MetricAlert.status.in_(OPEN)).first():
        return None
    alert = MetricAlert(server_id=server.id, metric=metric, severity='critical',
                        detail=detail, status='active')
    db.session.add(alert)
    return alert


def _resolve_alerts(server, metric):
    rows = MetricAlert.query.filter(MetricAlert.server_id == server.id,
                                    MetricAlert.metric == metric,
                                    MetricAlert.status.in_(OPEN)).all()
    for row in rows:
        row.status = 'resolved'
        row.resolved_at = datetime.utcnow()
    return rows


def record_level(server, reported):
    """Persist a level reported by the agent; audit when it changes.

    Invalid/missing values are ignored. Escalations (monitor->protect->full) are
    logged like any change but flagged, since they mean someone re-ran the
    local confirmation on the box.
    """
    level = permission_levels.normalize(reported)
    if level is None:
        return
    old = server.permission_level
    if old == level:
        return
    server.permission_level = level
    server.permission_level_updated_at = datetime.utcnow()
    AuditLog.log(
        'server.permission_level_changed', target_type='server', target_id=server.id,
        details={'server_id': server.id, 'from': old, 'to': level,
                 'escalation': permission_levels.is_escalation(old, level),
                 'source': 'agent_report'})
    logger.warning('Server %s reported permission level %s -> %s', server.id, old, level)


def record_service_checks(server, checks):
    """Store the latest per-check state and open/resolve alerts on transitions."""
    if not isinstance(checks, list):
        return
    previous = {c.get('name'): c.get('status') for c in (server.service_checks or [])}
    clean, opened, resolved = [], [], []
    for raw in checks[:50]:
        if not isinstance(raw, dict) or not isinstance(raw.get('name'), str):
            continue
        item = {k: (str(raw.get(k))[:200] if raw.get(k) is not None else None)
                for k in ('name', 'kind', 'status', 'detail', 'checked_at')}
        item['name'] = item['name'][:60]
        if item['status'] not in ('up', 'down', 'degraded', 'unknown'):
            item['status'] = 'unknown'
        clean.append(item)
        metric = f"svc:{item['name']}"[:20]
        if item['status'] == 'down':
            alert = _open_alert(
                server, metric,
                f"{server.name}: service '{item['name']}' is down since "
                f"{datetime.utcnow():%Y-%m-%d %H:%M} UTC"
                + (f" ({item['detail']})" if item['detail'] else ''))
            if alert:
                opened.append(alert)
        elif item['status'] == 'up' or (item['status'] == 'degraded'
                                         and previous.get(item['name']) == 'down'):
            resolved += _resolve_alerts(server, metric)
    server.service_checks = clean
    db.session.flush()
    _notify(opened, resolved)


def mark_offline(server, reason):
    """Open the (de-duplicated) offline alert. Caller commits."""
    since = server.last_report_at or server.last_seen or datetime.utcnow()
    alert = _open_alert(
        server, OFFLINE_METRIC,
        f"{server.name} is offline since {since:%Y-%m-%d %H:%M} UTC: {reason}")
    db.session.flush()
    _notify([alert] if alert else [])


def mark_online(server):
    resolved = _resolve_alerts(server, OFFLINE_METRIC)
    db.session.flush()
    _notify(resolved=resolved)


def silence_limit(server):
    interval = server.report_interval_seconds or DEFAULT_INTERVAL_SECONDS
    return timedelta(seconds=max(MIN_SILENCE_SECONDS, 3 * interval))


def sweep_silent_reporters(now=None):
    """Flip report-only (monitor) servers offline once their reports stop.

    Reports are not a socket, so the registry's heartbeat reaper never sees
    them. Only servers that have ever reported are considered.
    """
    now = now or datetime.utcnow()
    flipped = []
    for server in Server.query.filter(Server.permission_level == 'monitor',
                                      Server.last_report_at.isnot(None),
                                      Server.status != 'offline').all():
        if now - server.last_report_at > silence_limit(server):
            server.status = 'offline'
            server.last_error = 'Agent stopped reporting'
            mark_offline(server, 'no report received')
            flipped.append(server.id)
    if flipped:
        db.session.commit()
    return flipped


def authenticate_report(raw, headers, max_skew):
    """Return the Server for a validly signed report request, else None."""
    key = headers.get('X-Agent-Key') or ''
    ts = headers.get('X-Timestamp') or ''
    nonce = headers.get('X-Nonce') or ''
    signature = headers.get('X-Signature') or ''
    if not (key and ts and signature) or len(nonce) < 32:
        return None
    try:
        if abs(time.time() - int(ts)) > max_skew:
            return None
    except ValueError:
        return None

    prefix = key[:12]
    server = Server.query.filter(
        (Server.api_key_prefix == prefix) | (Server.api_key_pending_prefix == prefix)
    ).first()
    if not server:
        return None
    pending = (server.api_key_pending_prefix == prefix and server.api_key_prefix != prefix
               and server.api_key_rotation_expires
               and datetime.utcnow() <= server.api_key_rotation_expires)
    secret = server.get_pending_api_secret() if pending else server.get_api_secret()
    if not secret:
        return None

    message = f"{ts}.{nonce}.{hashlib.sha256(raw).hexdigest()}"
    expected = hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    # Consume the nonce only after the signature proves valid.
    if not nonce_service.check_and_record(server.id, nonce):
        return None
    return server


def ingest_report(server, level, body):
    """Apply a verified report to the server row; returns the interval in use."""
    interval = body.get('interval_seconds')
    interval = interval if isinstance(interval, int) and 5 <= interval <= 3600 else DEFAULT_INTERVAL

    now = datetime.utcnow()
    was_offline = server.status != 'online'
    server.status = 'online'
    server.last_error = None
    server.last_seen = now
    server.last_report_at = now
    server.report_interval_seconds = interval
    if isinstance(body.get('agent_version'), str):
        server.agent_version = body['agent_version'][:20]
    record_level(server, level)
    record_service_checks(server, body.get('service_checks'))
    if was_offline:
        mark_online(server)
    db.session.commit()

    metrics = body.get('metrics')
    if isinstance(metrics, dict):
        from app.services.server_metrics_service import ServerMetricsService
        ServerMetricsService.record_metrics(server.id, {
            **{k: metrics.get(k) for k in ('cpu_percent', 'memory_percent', 'disk_percent')},
            'extra': {k: metrics.get(k) for k in ('uptime_seconds', 'load1')},
        })
    return interval
