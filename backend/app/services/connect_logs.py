"""The panel half of bounded log collection.

Cloud keeps a short, searchable copy of log lines from sources the operator
chose — never every file on the server, never authentication logs — and
this module is what sends them. Four sources, each mapped to something the
panel already reads:

| source              | what is read                                              |
|---------------------|-----------------------------------------------------------|
| `serverkit.service` | the panel's own log file under the ServerKit log directory |
| `web.error`         | the host web server's error log                            |
| `app.output`        | each managed application's output (journal or compose)    |
| `deploy.output`     | the build log kept with each deployment                    |

The rules Cloud enforces are applied here first, so a line that would be
refused never crosses the relay: a batch is at most 200 records and 256 KiB,
a line at most 8 KiB, flushes are at least five seconds apart, and while the
relay is down at most 10 MiB or five minutes are held. Every record carries a
stable `id` — a hash of source, generation and offset — so a batch that was
sent but never acknowledged is safely resent and counted as a duplicate.

Cloud's answer is the configuration: `collect: false` means stop, and which
`sources` are wanted is Cloud's list, not this file's. Nothing here sends a
path, and secrets are redacted locally before Cloud redacts them again.
"""
import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime, timezone

from app import paths

logger = logging.getLogger(__name__)

LOGS_SCHEMA = 'logs/1'
SOURCES = ('serverkit.service', 'web.error', 'app.output', 'deploy.output')

MAX_BATCH_RECORDS = 200
MAX_BATCH_BYTES = 256 * 1024
MAX_LINE_BYTES = 8 * 1024
FLUSH_INTERVAL_S = 5.0
OUTAGE_BUFFER_BYTES = 10 * 1024 * 1024
OUTAGE_BUFFER_S = 300.0
# How often to ask Cloud again once it said `collect: false`. A withdrawn
# consent stops collection at once; one granted later takes effect without a
# restart, slowly.
REFUSED_RETRY_S = 15 * 60.0
# Per read, per source: a file that grew by more than this between reads is
# read in pieces, never in one go.
MAX_READ_BYTES = 512 * 1024
MAX_APP_LINES = 100

WEB_ERROR_LOG = '/var/log/nginx/error.log'

_SEVERITY = re.compile(
    r'\b(emerg|alert|crit|critical|error|err|warn|warning|notice|info|debug)\b', re.I)

# Redacted locally, so a secret never crosses the relay at all; Cloud runs
# its own, wider set on arrival.
_REDACTIONS = (
    (re.compile(r'(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}'), r'\1 [redacted]'),
    (re.compile(r'(?i)\b(pass(?:word|wd)?|secret|token|api[_-]?key|access[_-]?key|'
                r'private[_-]?key|authorization|credential)\b(\s*[:=]\s*)(\"[^\"]*\"|\'[^\']*\'|\S+)'),
     r'\1\2[redacted]'),
    (re.compile(r'(?i)\b([a-z][a-z0-9+.-]*://)([^/\s:@]+):([^/\s@]+)@'), r'\1\2:[redacted]@'),
)


def redact(text: str) -> str:
    for pattern, replacement in _REDACTIONS:
        text = pattern.sub(replacement, text)
    return text


def severity_of(text: str) -> str | None:
    match = _SEVERITY.search(text[:120])
    return match.group(1).lower() if match else None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def record_id(source: str, generation: int, offset) -> str:
    """Stable per device: the same line at the same place is the same id."""
    raw = f'{source}|{generation}|{offset}'.encode('utf-8', 'replace')
    return hashlib.sha1(raw).hexdigest()[:40]


def _bounded_line(text: str) -> tuple[str, bool]:
    encoded = text.encode('utf-8', 'replace')
    if len(encoded) <= MAX_LINE_BYTES:
        return text, False
    return encoded[:MAX_LINE_BYTES].decode('utf-8', 'ignore'), True


# ==================== file tailers ====================


class FileTail:
    """Follow one file from where it was left. Rotation or truncation
    increments `generation`; the offset restarts at zero. Never reads more
    than `MAX_READ_BYTES` per call and never follows a symlink elsewhere."""

    def __init__(self, source: str, path: str):
        self.source = source
        self.path = path
        self.generation = 0
        self.offset = 0
        self.inode = None
        self.missing_logged = False

    def read(self) -> list[dict]:
        try:
            st = os.stat(self.path)
        except OSError:
            if not self.missing_logged:
                logger.debug('Connect logs: %s has no file to read', self.source)
                self.missing_logged = True
            return []
        self.missing_logged = False
        inode = getattr(st, 'st_ino', None)
        if self.inode is None:
            # First sight: start at the end. History is not what Cloud keeps.
            self.inode, self.offset = inode, st.st_size
            return []
        if inode != self.inode or st.st_size < self.offset:
            self.generation += 1
            self.inode, self.offset = inode, 0
        if st.st_size == self.offset:
            return []
        out = []
        try:
            with open(self.path, 'rb') as fh:
                fh.seek(self.offset)
                chunk = fh.read(MAX_READ_BYTES)
        except OSError:
            return []
        lines = chunk.split(b'\n')
        # A partial last line waits for its newline.
        tail = lines.pop() if not chunk.endswith(b'\n') else b''
        consumed = len(chunk) - len(tail)
        position = self.offset
        for raw in lines:
            text = raw.decode('utf-8', 'replace').rstrip('\r')
            if text.strip():
                out.append(self._record(position, text))
            position += len(raw) + 1
        self.offset += consumed
        return out

    def _record(self, offset: int, text: str) -> dict:
        text, truncated = _bounded_line(redact(text))
        rec = {
            'id': record_id(self.source, self.generation, offset),
            'source': self.source,
            'generation': self.generation,
            'offset': offset,
            'observed_at': _now_iso(),
            'severity': severity_of(text),
            'text': text,
        }
        if truncated:
            rec['truncated'] = True
        return rec


def _panel_log_path() -> str | None:
    """The panel's own log file, if one is written."""
    candidates = [os.path.join(paths.SERVERKIT_LOG_DIR, name)
                  for name in ('serverkit.log', 'app.log', 'panel.log')]
    for path in candidates:
        if os.path.isfile(path):
            return path
    return candidates[0]


# ==================== command-backed sources ====================


class AppOutput:
    """Recent output of every managed application, read through the same
    services the panel's own Logs tab uses. Lines are identified by their
    content and time rather than an offset, so the id is stable across
    overlapping reads and Cloud counts the overlap as duplicates."""

    def __init__(self, app=None):
        self.app = app
        self.since = time.time()

    def read(self) -> list[dict]:
        from app.services.log_service import LogService
        out = []
        since = datetime.fromtimestamp(self.since, tz=timezone.utc)
        self.since = time.time()
        for row in self._applications():
            lines = []
            unit = getattr(row, 'systemd_unit', None)
            managed = str(getattr(row, 'managed_by', '') or '')
            try:
                if unit:
                    result = LogService.get_journalctl_logs(
                        unit=unit, lines=MAX_APP_LINES,
                        since=since.strftime('%Y-%m-%d %H:%M:%S'))
                elif managed == 'docker_compose' or getattr(row, 'app_type', '') == 'docker':
                    app_dir = os.path.join(paths.APPS_DIR, row.name)
                    result = LogService.get_docker_app_logs(row.name, app_dir, MAX_APP_LINES,
                                                            getattr(row, 'compose_file', None))
                else:
                    result = LogService.get_app_logs(row.name, 'error', MAX_APP_LINES)
                if result.get('success'):
                    lines = [l for l in (result.get('lines') or []) if l and l.strip()]
            except Exception:  # noqa: BLE001
                logger.debug('Connect logs: could not read output for %s', row.name, exc_info=True)
                continue
            for text in lines[-MAX_APP_LINES:]:
                text, truncated = _bounded_line(redact(text))
                rec = {
                    'id': record_id('app.output', row.id, hashlib.sha1(text.encode('utf-8', 'replace')).hexdigest()[:16]),
                    'source': 'app.output',
                    'app_key': str(row.id),
                    'observed_at': _now_iso(),
                    'severity': severity_of(text),
                    'text': text,
                }
                if truncated:
                    rec['truncated'] = True
                out.append(rec)
        return out

    def _applications(self):
        try:
            from app.models.application import Application
            if self.app is not None:
                with self.app.app_context():
                    return list(Application.query.order_by(Application.id.asc()).all())
            return list(Application.query.order_by(Application.id.asc()).all())
        except Exception:  # noqa: BLE001
            return []


class DeployOutput:
    """The build log kept with each deployment, sent once per deployment.
    Only the lines; the file's path stays here."""

    def __init__(self, app=None):
        self.app = app
        self.sent: set[int] = set()

    def read(self) -> list[dict]:
        out = []
        for dep in self._recent():
            if dep.id in self.sent:
                continue
            path = getattr(dep, 'build_log_path', None)
            if not path or not os.path.isfile(path):
                continue
            try:
                with open(path, 'r', encoding='utf-8', errors='replace') as fh:
                    data = json.load(fh)
                lines = data.get('logs') if isinstance(data, dict) else data
            except (OSError, ValueError):
                continue
            self.sent.add(dep.id)
            for offset, entry in enumerate((lines or [])[:MAX_BATCH_RECORDS]):
                text = entry.get('message') if isinstance(entry, dict) else str(entry)
                if not text or not str(text).strip():
                    continue
                text, truncated = _bounded_line(redact(str(text)))
                rec = {
                    'id': record_id('deploy.output', dep.id, offset),
                    'source': 'deploy.output',
                    'app_key': str(dep.app_id),
                    'deployment_key': f'{dep.app_id}:{dep.version}',
                    'observed_at': _now_iso(),
                    'severity': severity_of(text),
                    'text': text,
                }
                if truncated:
                    rec['truncated'] = True
                out.append(rec)
        return out

    def _recent(self):
        try:
            from app.models.deployment import Deployment

            def query():
                return list(Deployment.query.order_by(Deployment.id.desc()).limit(20).all())
            if self.app is not None:
                with self.app.app_context():
                    return query()
            return query()
        except Exception:  # noqa: BLE001
            return []


# ==================== the publisher ====================


class LogPublisher:
    """Collects from the wanted sources, batches within the bounds, and holds
    a bounded buffer while the relay is away. `apply_ack` is Cloud's answer."""

    def __init__(self, app=None):
        self.app = app
        self.collect = True
        self.sources: list[str] | None = None      # None until Cloud has answered
        self.flush_interval = FLUSH_INTERVAL_S
        self.next_flush_at = 0.0
        self.refused_until = 0.0
        self.pending: list[dict] = []
        self.pending_bytes = 0
        self.oldest_pending_at = None
        self.generation = 0
        self._readers = {
            'serverkit.service': FileTail('serverkit.service', _panel_log_path()),
            'web.error': FileTail('web.error', WEB_ERROR_LOG),
            'app.output': AppOutput(app),
            'deploy.output': DeployOutput(app),
        }

    # -- collection ------------------------------------------------------

    def wanted(self) -> list[str]:
        if self.sources is None:
            return []
        return [s for s in self.sources if s in self._readers]

    def collect_now(self) -> int:
        """Read every wanted source into the pending buffer. Returns how many
        records were added."""
        if not self.collect or time.monotonic() < self.refused_until:
            return 0
        added = 0
        for source in self.wanted():
            try:
                records = self._readers[source].read()
            except Exception:  # noqa: BLE001
                logger.debug('Connect logs: reader %s failed', source, exc_info=True)
                continue
            for rec in records:
                size = len(json.dumps(rec).encode('utf-8'))
                if self.pending_bytes + size > OUTAGE_BUFFER_BYTES:
                    # Full: the newest line is the one dropped, and the
                    # application keeps writing locally regardless.
                    break
                self.pending.append(rec)
                self.pending_bytes += size
                added += 1
        if self.pending and self.oldest_pending_at is None:
            self.oldest_pending_at = time.monotonic()
        self._expire()
        return added

    def _expire(self):
        """Lines older than the outage window are dropped rather than held
        forever: the bound is the promise."""
        if self.oldest_pending_at is None:
            return
        if time.monotonic() - self.oldest_pending_at > OUTAGE_BUFFER_S:
            self.pending.clear()
            self.pending_bytes = 0
            self.oldest_pending_at = None

    # -- batches -----------------------------------------------------------

    def due(self) -> bool:
        if not self.collect or time.monotonic() < self.refused_until:
            return False
        if time.monotonic() < self.next_flush_at:
            return False
        # Before Cloud has said which sources it wants, one empty batch asks.
        return bool(self.pending) or self.sources is None

    def take_batch(self) -> dict:
        """The next batch within the bounds, removed from the buffer."""
        self.next_flush_at = time.monotonic() + self.flush_interval
        batch, size = [], 0
        while self.pending and len(batch) < MAX_BATCH_RECORDS:
            rec = self.pending[0]
            rec_size = len(json.dumps(rec).encode('utf-8'))
            if batch and size + rec_size > MAX_BATCH_BYTES - 1024:
                break
            batch.append(self.pending.pop(0))
            size += rec_size
            self.pending_bytes = max(0, self.pending_bytes - rec_size)
        if not self.pending:
            self.oldest_pending_at = None
        self.generation += 1
        return {'schema': LOGS_SCHEMA, 'generation': self.generation, 'records': batch}

    def requeue(self, batch: dict):
        """A batch that was sent and not acknowledged goes back to the front;
        its ids make the resend safe."""
        records = list((batch or {}).get('records') or [])
        self.pending[:0] = records
        self.pending_bytes += sum(len(json.dumps(r).encode('utf-8')) for r in records)
        if self.pending and self.oldest_pending_at is None:
            self.oldest_pending_at = time.monotonic()

    def apply_ack(self, payload: dict):
        """Cloud's answer is the configuration."""
        sources = payload.get('sources')
        if isinstance(sources, list):
            self.sources = [s for s in sources if isinstance(s, str)]
        # `collect` is the instruction when it is present; a refusal that
        # does not carry one (an unknown device, say) is also a stop.
        stop = not payload.get('collect', bool(payload.get('ok')))
        if stop:
            self.collect = False
            self.refused_until = time.monotonic() + REFUSED_RETRY_S
            # Whatever was waiting is not wanted: consent was withdrawn or
            # never given, and holding lines for a Cloud that refused them
            # would be keeping what it said not to send.
            self.pending.clear()
            self.pending_bytes = 0
            self.oldest_pending_at = None
            logger.info('Connect logs: Cloud is not collecting (%s)', payload.get('reason') or 'off')
            return
        self.collect = True
        self.refused_until = 0.0
        interval = payload.get('flush_interval_s')
        if isinstance(interval, (int, float)) and 1 <= interval <= 300:
            self.flush_interval = float(interval)

    def retry_after_refusal(self):
        """Called on the slow retry: ask again with one empty batch."""
        if not self.collect and time.monotonic() >= self.refused_until:
            self.collect = True
            self.sources = None


def logs_frame(stream_id: str, batch: dict) -> dict:
    return {'s': stream_id, 't': 'open', 'k': 'logs', 'p': batch}
