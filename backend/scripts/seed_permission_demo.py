"""Seed five demo servers showing every permission-level / health state.

Dev sandbox only; never run automatically. Idempotent: demo rows are keyed by
agent_id 'demo-perm-*' and are rebuilt on each run.

    cd backend && python scripts/seed_permission_demo.py
"""
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app import create_app, db  # noqa: E402
from app.models.metric_alert import MetricAlert  # noqa: E402
from app.models.server import Server, ServerMetrics  # noqa: E402

UP, DOWN, DEG = 'up', 'down', 'degraded'


def checks(now, web=UP, php=UP, database=UP, disk=UP):
    stamp = now.isoformat() + 'Z'
    rows = [('nginx', 'web', web, ''), ('php8.2-fpm', 'php_fpm', php, 'slow pool' if php == DEG else ''),
            ('mysql', 'database', database, 'connection refused on 3306' if database == DOWN else ''),
            ('disk /', 'disk', disk, ''), ('cpu', 'cpu', UP, ''), ('memory', 'memory', UP, '')]
    return [{'name': n, 'kind': k, 'status': s, 'detail': d, 'checked_at': stamp} for n, k, s, d in rows]


# (name, level, status, minutes since last report, check overrides, cpu)
DEMOS = [
    ('demo-monitor-healthy', 'monitor', 'online', 1, {}, 14.0),
    ('demo-monitor-degraded', 'monitor', 'online', 1, {'database': DOWN, 'php': DEG}, 71.0),
    ('demo-protect-healthy', 'protect', 'online', 0, {}, 22.0),
    ('demo-full-healthy', 'full', 'online', 0, {}, 35.0),
    ('demo-monitor-offline', 'monitor', 'offline', 20, {'database': DOWN}, 9.0),
]


def seed():
    now = datetime.utcnow()
    for name, level, status, age, overrides, cpu in DEMOS:
        agent_id = f'demo-perm-{name}'
        old = Server.query.filter_by(agent_id=agent_id).first()
        if old:
            MetricAlert.query.filter_by(server_id=old.id).delete()
            ServerMetrics.query.filter_by(server_id=old.id).delete()
            db.session.delete(old)
            db.session.flush()
        reported = now - timedelta(minutes=age)
        srv = Server(name=name, agent_id=agent_id, hostname=name, status=status,
                     os_type='linux', permission_level=level, requested_permission_level=level,
                     permission_level_updated_at=reported, last_seen=reported,
                     last_report_at=reported, report_interval_seconds=60,
                     service_checks=checks(reported, **overrides))
        db.session.add(srv)
        db.session.flush()
        for i in range(12):
            db.session.add(ServerMetrics(
                server_id=srv.id, timestamp=reported - timedelta(minutes=i),
                cpu_percent=cpu + i % 3, memory_percent=48.0, disk_percent=61.0))
        for check in srv.service_checks:
            if check['status'] == DOWN:
                db.session.add(MetricAlert(
                    server_id=srv.id, metric=f"svc:{check['name']}"[:20], severity='critical',
                    status='active', created_at=reported,
                    detail=f"{name}: service '{check['name']}' is down since "
                           f"{reported:%Y-%m-%d %H:%M} UTC ({check['detail']})"))
        if status == 'offline':
            db.session.add(MetricAlert(
                server_id=srv.id, metric='offline', severity='critical', status='active',
                created_at=now, detail=f"{name} is offline since {reported:%Y-%m-%d %H:%M} UTC: "
                                       "no report received"))
    db.session.commit()
    print(f'Seeded {len(DEMOS)} demo servers.')


if __name__ == '__main__':
    app = create_app(os.environ.get('FLASK_ENV') or 'development')
    with app.app_context():
        seed()
