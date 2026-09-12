"""Metrics publisher: a dead sampler or a broken build must be visible.

Both failure modes used to log at debug level, so ServerKit Cloud showing no
telemetry had no matching local evidence. Each streak warns once and recovers
loudly; the healthy path stays quiet.
"""
import logging
from datetime import datetime, timezone

from app.services import connect_metrics
from app.services.connect_metrics import MetricsPublisher

MODULE = 'app.services.connect_metrics'


def _sample():
    return {'ts': datetime.now(timezone.utc).isoformat(), 'cpu_avg': 1.0}


def _boom():
    raise RuntimeError('db gone')


def test_build_failure_warns_once_per_streak_and_recovers(monkeypatch, caplog):
    pub = MetricsPublisher()
    monkeypatch.setattr(pub, '_build', _boom)
    with caplog.at_level(logging.DEBUG, logger=MODULE):
        pub.collect()
        pub.collect()
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1 and '1 consecutive' in warnings[0].getMessage()

    monkeypatch.setattr(pub, '_build', lambda: [_sample()])
    with caplog.at_level(logging.INFO, logger=MODULE):
        caplog.clear()
        added = pub.collect()
    assert added == 1 and pub.pending()
    infos = [r for r in caplog.records if r.levelno == logging.INFO]
    assert any('recovered after 2 failure(s)' in r.getMessage() for r in infos)


def test_empty_streak_warns_at_threshold_and_resets(monkeypatch, caplog):
    pub = MetricsPublisher()
    monkeypatch.setattr(pub, '_build', lambda: [])
    with caplog.at_level(logging.WARNING, logger=MODULE):
        for _ in range(connect_metrics.EMPTY_COLLECT_WARN_AFTER * 2):
            pub.collect()
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1 and 'sampler may not be running' in warnings[0].getMessage()

    monkeypatch.setattr(pub, '_build', lambda: [_sample()])
    pub.collect()
    monkeypatch.setattr(pub, '_build', lambda: [])
    with caplog.at_level(logging.WARNING, logger=MODULE):
        caplog.clear()
        for _ in range(connect_metrics.EMPTY_COLLECT_WARN_AFTER):
            pub.collect()
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1


def test_healthy_collect_buffers_and_frames_quietly(monkeypatch, caplog):
    pub = MetricsPublisher()
    monkeypatch.setattr(pub, '_build', lambda: [_sample()])
    with caplog.at_level(logging.WARNING, logger=MODULE):
        added = pub.collect()
    assert added == 1 and not [r for r in caplog.records if r.levelno >= logging.WARNING]
    frame = pub.frame('met1', pub.take())
    assert frame['t'] == 'open' and frame['k'] == 'metrics'
    assert frame['p']['interval_s'] == connect_metrics.DEFAULT_INTERVAL_S
