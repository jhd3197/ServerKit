"""Metrics publisher for ServerKit Cloud — panel side.

The panel already samples the host every 60 s into ``MetricsHistory`` for its
own charts. This module turns the newest of those samples into the one-a-minute
summary Cloud expects, adds the counts Cloud alerts on (containers, unhealthy
apps, certificates near expiry, backup age), and hands it to
``connect_client``'s relay socket on a ``metrics`` stream.

Rules this file keeps:

- Nothing new is collected. If ``MetricsHistory`` has no row for a minute, no
  sample is sent for it; the panel's own monitoring is the source of record.
- The buffer holds five minutes. Older samples are dropped here rather than
  sent late, because a chart drawn from stale points is worse than a gap.
- Every count source is optional. A panel without Docker, without domains or
  without a backup policy sends ``None`` for those fields instead of failing
  the whole summary.
- Cloud answers each message with the interval it wants; the caller applies
  it, so a noisy panel can be backed off without a panel release.
"""
import logging
import time
from collections import deque
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL_S = 60
MIN_INTERVAL_S = 30
MAX_INTERVAL_S = 900
# Five minutes of samples ride out a relay outage; anything older is dropped.
BUFFER_MINUTES = 5
MAX_SAMPLES_PER_MESSAGE = 10
MAX_DISK_MOUNTS = 8
# The panel's own sampler writes a row every minute, so this many consecutive
# empty collects mean the sampler is not running — until then an empty build
# is just the normal race against the sampler's next row.
EMPTY_COLLECT_WARN_AFTER = 5


def _utc(dt):
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


# ==================== counts (all best-effort) ====================


def _container_counts():
    try:
        from app.services.docker_service import DockerService
        containers = DockerService.list_containers(all_containers=True) or []
    except Exception:
        return None, None
    running = stopped = 0
    for c in containers:
        state = str((c or {}).get('status') or (c or {}).get('state') or '').lower()
        if 'running' in state or 'up' in state:
            running += 1
        else:
            stopped += 1
    return running, stopped


def _apps_unhealthy():
    try:
        from app.models.application import Application
        return Application.query.filter(Application.status == 'error').count()
    except Exception:
        return None


def _certs_expiring(within_days: int = 14):
    try:
        from app.models.domain import Domain
        deadline = datetime.utcnow() + timedelta(days=within_days)
        return (Domain.query
                .filter(Domain.ssl_enabled.is_(True),
                        Domain.ssl_expires_at.isnot(None),
                        Domain.ssl_expires_at <= deadline)
                .count())
    except Exception:
        return None


def _backup_age_seconds():
    try:
        from app.models.backup_run import BackupRun
        row = (BackupRun.query
               .filter(BackupRun.status == 'success', BackupRun.finished_at.isnot(None))
               .order_by(BackupRun.finished_at.desc())
               .first())
    except Exception:
        return None
    if row is None or row.finished_at is None:
        return None
    return max(int((datetime.utcnow() - row.finished_at).total_seconds()), 0)


def _net_rates(previous):
    """Bytes per second since the last call. `previous` is the tuple this
    function returned last time, or None on the first sample."""
    try:
        import psutil
        counters = psutil.net_io_counters()
    except Exception:
        return None, None, previous
    now = time.monotonic()
    current = (now, counters.bytes_recv, counters.bytes_sent)
    if not previous:
        return None, None, current
    elapsed = now - previous[0]
    if elapsed <= 0:
        return None, None, current
    rate_in = max(counters.bytes_recv - previous[1], 0) / elapsed
    rate_out = max(counters.bytes_sent - previous[2], 0) / elapsed
    return rate_in, rate_out, current


def _disk_mounts(row):
    """The fullest mounts, capped. Falls back to the single root reading the
    panel's own history keeps."""
    try:
        import psutil
        mounts = []
        for part in psutil.disk_partitions(all=False):
            try:
                usage = psutil.disk_usage(part.mountpoint)
            except (PermissionError, OSError):
                continue
            mounts.append({'mount': part.mountpoint, 'used_pct': round(usage.percent, 2)})
        if mounts:
            mounts.sort(key=lambda m: m['used_pct'], reverse=True)
            return mounts[:MAX_DISK_MOUNTS]
    except Exception:
        pass
    if row is not None and row.disk_percent is not None:
        return [{'mount': '/', 'used_pct': round(row.disk_percent, 2)}]
    return None


# ==================== the publisher ====================


class MetricsPublisher:
    """Builds and buffers summaries. One instance per RelayClient.

    ``collect(app)`` is called on the interval; ``take()`` hands the caller
    everything buffered so it can be sent in one message. A message that is
    not acknowledged is put back with ``requeue`` and ages out of the buffer
    on its own.
    """

    def __init__(self):
        self.interval_s = DEFAULT_INTERVAL_S
        self._buffer = deque(maxlen=BUFFER_MINUTES * 4)
        self._net_prev = None
        self._last_ts = None
        self._collect_failures = 0
        self._empty_collects = 0

    # -- collection ---------------------------------------------------

    def collect(self, app=None) -> int:
        """Take every minute row the panel recorded since the last collect.
        Returns how many samples were added."""
        try:
            if app is not None:
                with app.app_context():
                    samples = self._build()
            else:
                samples = self._build()
        except Exception:
            # A build that keeps failing means nothing is ever sent, so the
            # first failure of a streak is a warning, not another debug line.
            self._collect_failures += 1
            (logger.warning if self._collect_failures == 1 else logger.debug)(
                'Connect metrics: could not build a summary (%d consecutive)', self._collect_failures,
                exc_info=True)
            return 0
        if self._collect_failures:
            logger.info('Connect metrics: summary build recovered after %d failure(s)',
                        self._collect_failures)
            self._collect_failures = 0
        if samples:
            self._empty_collects = 0
        else:
            self._empty_collects += 1
            # Without this line the only symptom of a dead sampler is ServerKit
            # Cloud showing no telemetry, with nothing to act on locally.
            if self._empty_collects == EMPTY_COLLECT_WARN_AFTER:
                logger.warning('Connect metrics: no local samples for %d consecutive collects; '
                               'the panel sampler may not be running', self._empty_collects)
        for sample in samples:
            self._buffer.append(sample)
        self._prune()
        return len(samples)

    def _build(self):
        from app.models.metrics_history import MetricsHistory

        since = self._last_ts or (datetime.utcnow() - timedelta(minutes=BUFFER_MINUTES))
        rows = (MetricsHistory.query
                .filter(MetricsHistory.level == 'minute',
                        MetricsHistory.timestamp > since)
                .order_by(MetricsHistory.timestamp.asc())
                .limit(BUFFER_MINUTES * 2)
                .all())
        if not rows:
            return []
        self._last_ts = rows[-1].timestamp

        rate_in, rate_out, self._net_prev = _net_rates(self._net_prev)
        running, stopped = _container_counts()
        counts = {
            'containers_running': running,
            'containers_stopped': stopped,
            'apps_unhealthy': _apps_unhealthy(),
            'certs_expiring': _certs_expiring(),
            'backup_age_s': _backup_age_seconds(),
        }

        samples = []
        for i, row in enumerate(rows):
            newest = i == len(rows) - 1
            sample = {
                'ts': _utc(row.timestamp).isoformat(),
                'cpu_avg': row.cpu_percent,
                'cpu_max': row.cpu_percent,
                'mem_avg': row.memory_percent,
                'mem_max': row.memory_percent,
                'disk': _disk_mounts(row) if newest else (
                    [{'mount': '/', 'used_pct': round(row.disk_percent, 2)}]
                    if row.disk_percent is not None else None),
                'load1': row.load_1m,
                'net_in': rate_in if newest else None,
                'net_out': rate_out if newest else None,
            }
            # Counts describe now, not the minute being replayed, so they ride
            # only on the newest sample.
            sample.update(counts if newest else {k: None for k in counts})
            samples.append(sample)
        return samples

    def _prune(self):
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=BUFFER_MINUTES)
        dropped = 0
        while self._buffer:
            try:
                ts = datetime.fromisoformat(self._buffer[0]['ts'])
            except (ValueError, KeyError):
                self._buffer.popleft()
                continue
            if _utc(ts) < cutoff:
                self._buffer.popleft()
                dropped += 1
            else:
                break
        if dropped:
            logger.info('Connect metrics: dropped %d buffered samples older than %d minutes',
                        dropped, BUFFER_MINUTES)

    # -- sending ------------------------------------------------------

    def pending(self) -> bool:
        return bool(self._buffer)

    def take(self) -> list:
        out = []
        while self._buffer and len(out) < MAX_SAMPLES_PER_MESSAGE:
            out.append(self._buffer.popleft())
        return out

    def requeue(self, samples: list) -> None:
        """A send that never landed goes back to the front of the buffer and
        ages out normally."""
        for sample in reversed(samples):
            self._buffer.appendleft(sample)
        self._prune()

    def frame(self, stream_id: str, samples: list) -> dict:
        return {
            's': stream_id,
            't': 'open',
            'k': 'metrics',
            'p': {'samples': samples, 'interval_s': self.interval_s},
        }

    def apply_ack(self, payload: dict) -> None:
        """Cloud's answer carries the interval it wants us to send at."""
        try:
            wanted = int((payload or {}).get('interval_s') or 0)
        except (TypeError, ValueError):
            return
        if not wanted:
            return
        wanted = max(MIN_INTERVAL_S, min(wanted, MAX_INTERVAL_S))
        if wanted != self.interval_s:
            logger.info('Connect metrics: interval changed to %d s by ServerKit Cloud', wanted)
            self.interval_s = wanted
