"""
Fleet Monitor Service

Provides fleet-wide monitoring: heatmap, comparison charts, alert thresholds,
anomaly detection, capacity forecasting, fleet search, and metrics export.
"""

import io
import csv
import math
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Any

from sqlalchemy import func, and_
from sqlalchemy.orm import joinedload

from app import db
from app.models.server import Server, ServerMetrics, ServerGroup
from app.models.metric_alert import ServerAlertThreshold, MetricAlert
from app.services.agent_registry import agent_registry
from app.services.server_metrics_service import latest_metrics_by_server
from app.services.workspace_service import WorkspaceService

logger = logging.getLogger(__name__)

METRIC_COLUMNS = {
    'cpu': 'cpu_percent',
    'memory': 'memory_percent',
    'disk': 'disk_percent',
    'network_rx': 'network_rx_rate',
    'network_tx': 'network_tx_rate',
}


def _visible_servers(user, query=None):
    """A Server query narrowed to what *user* may see — the same workspace
    rule as GET /servers. Every read below goes through this or
    `_visible_server`; the unscoped `Server.query` is for the system-level
    passes only (threshold checks, the token-gated Prometheus scrape)."""
    return WorkspaceService.filter_accessible_servers(
        Server.query if query is None else query, user)


def _visible_server(user, server_id):
    """The server if *user* may see it, else None — a foreign id reads
    exactly like an unknown one."""
    return WorkspaceService.get_accessible_server(user, server_id)


def _visible_server_ids(user):
    """Subquery of the server ids *user* may see, for filtering child rows."""
    return WorkspaceService.filter_accessible_servers(
        db.session.query(Server.id), user)


class FleetMonitorService:
    """Service for fleet-wide monitoring and alerting.

    The read methods take the calling ``user`` and answer only for servers that
    user can access (GHSA-qcjj-hf95-6rgw).
    """

    # ==================== Fleet Heatmap ====================

    @staticmethod
    def get_fleet_heatmap(user, group_id: str = None) -> List[Dict]:
        """Latest metrics for the servers *user* can access, shaped for heatmap display."""
        query = _visible_servers(user)
        if group_id:
            query = query.filter_by(group_id=group_id)

        servers = query.options(joinedload(Server.group)).all()
        metrics_by_server = latest_metrics_by_server(server.id for server in servers)
        result = []

        for server in servers:
            latest = metrics_by_server.get(server.id)

            result.append({
                'id': server.id,
                'name': server.name,
                'status': server.status,
                'group_id': server.group_id,
                'group_name': server.group.name if server.group else None,
                'cpu': round(latest.cpu_percent, 1) if latest and latest.cpu_percent is not None else None,
                'memory': round(latest.memory_percent, 1) if latest and latest.memory_percent is not None else None,
                'disk': round(latest.disk_percent, 1) if latest and latest.disk_percent is not None else None,
                'containers': latest.container_running if latest else None,
                'last_update': latest.timestamp.isoformat() if latest else None,
            })

        return result

    # ==================== Comparison Timeseries ====================

    @staticmethod
    def get_comparison_timeseries(
        user, server_ids: List[str], metric: str = 'cpu', period: str = '24h'
    ) -> Dict:
        """Get time-series data for multiple servers for overlay charting.

        Ids *user* cannot access are skipped, like ids that do not exist."""
        hours_back = {'1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720}.get(period, 24)
        interval = {'1h': 1, '6h': 5, '24h': 15, '7d': 60, '30d': 360}.get(period, 15)
        cutoff = datetime.utcnow() - timedelta(hours=hours_back)
        col_name = METRIC_COLUMNS.get(metric, 'cpu_percent')

        series = []
        for server_id in server_ids:
            server = _visible_server(user, server_id)
            if not server:
                continue

            records = ServerMetrics.query.filter(
                ServerMetrics.server_id == server_id,
                ServerMetrics.timestamp >= cutoff
            ).order_by(ServerMetrics.timestamp.asc()).all()

            # Downsample for longer periods
            if interval > 1 and len(records) > 0:
                records = _downsample_simple(records, interval)

            data = []
            for r in records:
                val = getattr(r, col_name, None)
                if val is not None:
                    data.append({
                        'timestamp': r.timestamp.isoformat(),
                        'value': round(val, 2)
                    })

            series.append({
                'server_id': server_id,
                'name': server.name,
                'data': data
            })

        return {'metric': metric, 'period': period, 'series': series}

    # ==================== Alert Thresholds ====================

    @staticmethod
    def get_thresholds(user, server_id: str = None) -> List[Dict]:
        """Get alert thresholds, optionally filtered by server.

        Global defaults (no server) are fleet policy and visible to everyone;
        per-server overrides only for servers *user* can access."""
        query = ServerAlertThreshold.query
        if not user.is_admin:
            query = query.filter(
                (ServerAlertThreshold.server_id == None) |  # noqa: E711
                ServerAlertThreshold.server_id.in_(_visible_server_ids(user))
            )
        if server_id:
            query = query.filter(
                (ServerAlertThreshold.server_id == server_id) |
                (ServerAlertThreshold.server_id == None)
            )
        return [t.to_dict() for t in query.all()]

    @staticmethod
    def upsert_threshold(data: Dict) -> Dict:
        """Create or update an alert threshold."""
        threshold_id = data.get('id')
        if threshold_id:
            threshold = ServerAlertThreshold.query.get(threshold_id)
            if not threshold:
                return {'error': 'Threshold not found'}
        else:
            threshold = ServerAlertThreshold()
            db.session.add(threshold)

        threshold.server_id = data.get('server_id')
        threshold.metric = data.get('metric', 'cpu')
        threshold.warning_threshold = data.get('warning_threshold', 80.0)
        threshold.critical_threshold = data.get('critical_threshold', 95.0)
        threshold.duration_seconds = data.get('duration_seconds', 300)
        threshold.enabled = data.get('enabled', True)

        db.session.commit()
        return threshold.to_dict()

    @staticmethod
    def delete_threshold(threshold_id: str) -> bool:
        """Delete an alert threshold."""
        threshold = ServerAlertThreshold.query.get(threshold_id)
        if not threshold:
            return False
        db.session.delete(threshold)
        db.session.commit()
        return True

    # ==================== Alert Checking ====================

    @staticmethod
    def check_fleet_thresholds():
        """Check all online servers against their thresholds.

        Returns what changed on this pass:

            {'opened': [...], 'resolved': [...], 'superseded': [...],
             'servers': int, 'evaluated': int}

        so the caller can notify about it. Evaluating a breach and telling
        nobody is most of the way to no monitoring at all; before this the
        method also had no caller anywhere in the backend, so neither happened.
        The schedule lives in ``app/jobs/builtin_handlers.py`` with every other
        recurring task, and the notification goes through the Notification Bus.

        ``resolved`` is recovery — the metric came back under its threshold.
        ``superseded`` is a row closed because the *severity changed*, which is
        a different event wearing the same status: a warning replaced by a
        critical is an escalation, and announcing it as "recovered" would be
        the opposite of what happened.
        """
        opened = []
        resolved = []
        superseded = []
        evaluated = 0

        thresholds = ServerAlertThreshold.query.filter_by(enabled=True).all()
        if not thresholds:
            return {'opened': [], 'resolved': [], 'superseded': [],
                    'servers': 0, 'evaluated': 0}

        # Group thresholds: per-server overrides + global defaults
        global_thresholds = {}
        server_thresholds = {}
        for t in thresholds:
            if t.server_id:
                server_thresholds.setdefault(t.server_id, {})[t.metric] = t
            else:
                global_thresholds[t.metric] = t

        servers = Server.query.filter_by(status='online').all()

        for server in servers:
            for metric_name, col_name in METRIC_COLUMNS.items():
                # Find applicable threshold (server-specific > global)
                threshold = server_thresholds.get(server.id, {}).get(metric_name)
                if not threshold:
                    threshold = global_thresholds.get(metric_name)
                if not threshold:
                    continue

                # Get recent metrics for the duration window
                cutoff = datetime.utcnow() - timedelta(seconds=threshold.duration_seconds)
                recent = ServerMetrics.query.filter(
                    ServerMetrics.server_id == server.id,
                    ServerMetrics.timestamp >= cutoff
                ).all()

                if not recent:
                    # No samples in the window. That is "we do not know", not
                    # "it is fine": an existing alert stays open rather than
                    # being resolved by a server that stopped reporting.
                    continue

                values = [getattr(r, col_name) for r in recent if getattr(r, col_name) is not None]
                if not values:
                    continue

                evaluated += 1
                avg_val = sum(values) / len(values)

                # Check if there's already an active alert for this server+metric
                existing = MetricAlert.query.filter_by(
                    server_id=server.id, metric=metric_name, status='active'
                ).first()

                if avg_val >= threshold.critical_threshold:
                    if not existing or existing.severity != 'critical':
                        if existing:
                            existing.resolved_at = datetime.utcnow()
                            existing.status = 'resolved'
                            superseded.append(existing)
                        alert = MetricAlert(
                            server_id=server.id,
                            metric=metric_name,
                            severity='critical',
                            value=round(avg_val, 1),
                            threshold=threshold.critical_threshold,
                            duration_seconds=threshold.duration_seconds
                        )
                        db.session.add(alert)
                        opened.append(alert)
                elif avg_val >= threshold.warning_threshold:
                    if not existing or existing.severity == 'critical':
                        if existing and existing.severity == 'critical':
                            existing.resolved_at = datetime.utcnow()
                            existing.status = 'resolved'
                            superseded.append(existing)
                        if not existing or existing.severity == 'critical':
                            alert = MetricAlert(
                                server_id=server.id,
                                metric=metric_name,
                                severity='warning',
                                value=round(avg_val, 1),
                                threshold=threshold.warning_threshold,
                                duration_seconds=threshold.duration_seconds
                            )
                            db.session.add(alert)
                            opened.append(alert)
                else:
                    # Below thresholds - resolve any active alert
                    if existing:
                        existing.resolved_at = datetime.utcnow()
                        existing.status = 'resolved'
                        resolved.append(existing)

        try:
            db.session.commit()
        except Exception as e:
            logger.error(f"Error checking fleet thresholds: {e}")
            db.session.rollback()
            return {'opened': [], 'resolved': [], 'superseded': [],
                    'servers': len(servers), 'evaluated': evaluated}

        return {'opened': opened, 'resolved': resolved, 'superseded': superseded,
                'servers': len(servers), 'evaluated': evaluated}

    @staticmethod
    def get_alerts(
        user, status: str = None, severity: str = None,
        server_id: str = None, limit: int = 50
    ) -> List[Dict]:
        """Get metric alerts for the servers *user* can access, with filters."""
        query = MetricAlert.query.order_by(MetricAlert.created_at.desc())
        if not user.is_admin:
            query = query.filter(MetricAlert.server_id.in_(_visible_server_ids(user)))
        if status:
            query = query.filter_by(status=status)
        if severity:
            query = query.filter_by(severity=severity)
        if server_id:
            query = query.filter_by(server_id=server_id)
        return [a.to_dict() for a in query.limit(limit).all()]

    @staticmethod
    def acknowledge_alert(alert_id: str, user_id: int) -> bool:
        alert = MetricAlert.query.get(alert_id)
        if not alert or alert.status != 'active':
            return False
        alert.status = 'acknowledged'
        alert.acknowledged_by = user_id
        db.session.commit()
        return True

    @staticmethod
    def resolve_alert(alert_id: str) -> bool:
        alert = MetricAlert.query.get(alert_id)
        if not alert or alert.status == 'resolved':
            return False
        alert.status = 'resolved'
        alert.resolved_at = datetime.utcnow()
        db.session.commit()
        return True

    # ==================== Anomaly Detection ====================

    @staticmethod
    def detect_anomalies(user, server_id: str = None) -> List[Dict]:
        """Simple z-score anomaly detection on 7-day hourly averages."""
        if server_id:
            servers = [_visible_server(user, server_id)]
        else:
            servers = _visible_servers(user).filter_by(status='online').all()
        cutoff = datetime.utcnow() - timedelta(days=7)
        anomalies = []

        for server in servers:
            if not server:
                continue

            records = ServerMetrics.query.filter(
                ServerMetrics.server_id == server.id,
                ServerMetrics.timestamp >= cutoff
            ).all()

            if len(records) < 20:
                continue

            latest = records[-1] if records else None
            if not latest:
                continue

            for metric_name, col_name in [('cpu', 'cpu_percent'), ('memory', 'memory_percent'), ('disk', 'disk_percent')]:
                values = [getattr(r, col_name) for r in records if getattr(r, col_name) is not None]
                if len(values) < 10:
                    continue

                mean = sum(values) / len(values)
                variance = sum((v - mean) ** 2 for v in values) / len(values)
                stddev = math.sqrt(variance) if variance > 0 else 0

                current = getattr(latest, col_name)
                if current is None or stddev == 0:
                    continue

                z_score = (current - mean) / stddev

                if abs(z_score) > 2.5:
                    anomalies.append({
                        'server_id': server.id,
                        'server_name': server.name,
                        'metric': metric_name,
                        'current_value': round(current, 1),
                        'mean': round(mean, 1),
                        'stddev': round(stddev, 1),
                        'z_score': round(z_score, 2),
                        'direction': 'high' if z_score > 0 else 'low',
                    })

        return anomalies

    # ==================== Capacity Forecasting ====================

    @staticmethod
    def forecast_capacity(server_id: str, metric: str = 'disk') -> Dict:
        """Linear regression forecast for when a metric will hit 90% and 100%."""
        col_name = METRIC_COLUMNS.get(metric, 'disk_percent')
        cutoff = datetime.utcnow() - timedelta(days=30)

        records = ServerMetrics.query.filter(
            ServerMetrics.server_id == server_id,
            ServerMetrics.timestamp >= cutoff
        ).order_by(ServerMetrics.timestamp.asc()).all()

        values = []
        for r in records:
            val = getattr(r, col_name)
            if val is not None:
                # Convert timestamp to days from first record
                values.append((r.timestamp, val))

        if len(values) < 48:  # Need at least 2 days of data
            return {
                'server_id': server_id,
                'metric': metric,
                'error': 'Insufficient data (need at least 2 days of metrics)',
                'data_points': len(values)
            }

        # Aggregate to daily averages for regression
        daily = {}
        for ts, val in values:
            day_key = ts.strftime('%Y-%m-%d')
            daily.setdefault(day_key, []).append(val)
        daily_avgs = [(k, sum(v) / len(v)) for k, v in sorted(daily.items())]

        if len(daily_avgs) < 2:
            return {
                'server_id': server_id,
                'metric': metric,
                'error': 'Insufficient daily data points',
                'data_points': len(daily_avgs)
            }

        # Simple linear regression: y = mx + b
        n = len(daily_avgs)
        x_vals = list(range(n))
        y_vals = [v for _, v in daily_avgs]

        x_mean = sum(x_vals) / n
        y_mean = sum(y_vals) / n

        numerator = sum((x - x_mean) * (y - y_mean) for x, y in zip(x_vals, y_vals))
        denominator = sum((x - x_mean) ** 2 for x in x_vals)

        if denominator == 0:
            return {'server_id': server_id, 'metric': metric, 'trend': 'flat', 'growth_rate_per_day': 0}

        slope = numerator / denominator  # % per day
        intercept = y_mean - slope * x_mean

        current = y_vals[-1]

        # Predict when metric reaches 90% and 100%
        predictions = {}
        for target in [90, 100]:
            if current >= target:
                predictions[f'days_to_{target}pct'] = 0
                predictions[f'date_{target}pct'] = 'already exceeded'
            elif slope <= 0:
                predictions[f'days_to_{target}pct'] = None
                predictions[f'date_{target}pct'] = 'never (decreasing trend)'
            else:
                days_needed = (target - current) / slope
                target_date = datetime.utcnow() + timedelta(days=days_needed)
                predictions[f'days_to_{target}pct'] = round(days_needed, 1)
                predictions[f'date_{target}pct'] = target_date.strftime('%Y-%m-%d')

        # Generate trend line data for charting
        trend_data = []
        for i, (day, avg) in enumerate(daily_avgs):
            trend_data.append({
                'date': day,
                'actual': round(avg, 1),
                'trend': round(intercept + slope * i, 1)
            })

        # Extend trend 14 days into the future
        for i in range(1, 15):
            future_day = (datetime.utcnow() + timedelta(days=i)).strftime('%Y-%m-%d')
            predicted = intercept + slope * (n - 1 + i)
            trend_data.append({
                'date': future_day,
                'actual': None,
                'trend': round(min(predicted, 100), 1)
            })

        return {
            'server_id': server_id,
            'metric': metric,
            'current_value': round(current, 1),
            'growth_rate_per_day': round(slope, 3),
            'trend': 'increasing' if slope > 0.1 else ('decreasing' if slope < -0.1 else 'stable'),
            'predictions': predictions,
            'trend_data': trend_data,
            'data_points': len(values),
            'daily_samples': len(daily_avgs),
        }

    # ==================== Fleet Search ====================

    @staticmethod
    def search_fleet(user, query: str, search_type: str = 'any') -> List[Dict]:
        """Search the servers *user* can access for containers, services, or ports."""
        query_lower = query.lower()
        results = []

        # Search server names and hostnames
        if search_type in ('any', 'server'):
            servers = _visible_servers(user).filter(
                (Server.name.ilike(f'%{query}%')) |
                (Server.hostname.ilike(f'%{query}%')) |
                (Server.ip_address.ilike(f'%{query}%'))
            ).all()
            for s in servers:
                results.append({
                    'server_id': s.id,
                    'server_name': s.name,
                    'match_type': 'server',
                    'match_name': s.name,
                    'match_detail': f'{s.hostname} ({s.ip_address})',
                    'status': s.status,
                })

        # Search containers via connected agents
        if search_type in ('any', 'container'):
            connected = agent_registry.get_connected_servers()
            for server_id in connected:
                server = _visible_server(user, server_id)
                if not server:
                    continue

                # Check cached metrics extra data for container info
                latest = ServerMetrics.query.filter_by(
                    server_id=server_id
                ).order_by(ServerMetrics.timestamp.desc()).first()

                if latest and latest.extra:
                    containers = latest.extra.get('containers', [])
                    for container in containers:
                        name = container.get('name', '')
                        image = container.get('image', '')
                        if query_lower in name.lower() or query_lower in image.lower():
                            results.append({
                                'server_id': server_id,
                                'server_name': server.name,
                                'match_type': 'container',
                                'match_name': name,
                                'match_detail': image,
                                'status': container.get('status', 'unknown'),
                            })

        # Search tags
        if search_type in ('any', 'tag'):
            all_servers = _visible_servers(user).all()
            for s in all_servers:
                if s.tags:
                    for tag in s.tags:
                        if query_lower in tag.lower():
                            results.append({
                                'server_id': s.id,
                                'server_name': s.name,
                                'match_type': 'tag',
                                'match_name': tag,
                                'match_detail': f'Tag on {s.name}',
                                'status': s.status,
                            })

        return results

    # ==================== Prometheus Export ====================

    @staticmethod
    def get_prometheus_metrics() -> str:
        """Generate Prometheus exposition format metrics for all servers."""
        lines = []
        servers = Server.query.all()
        metrics_by_server = latest_metrics_by_server(server.id for server in servers)

        metrics_defs = [
            ('serverkit_cpu_percent', 'CPU usage percentage', 'cpu_percent'),
            ('serverkit_memory_percent', 'Memory usage percentage', 'memory_percent'),
            ('serverkit_disk_percent', 'Disk usage percentage', 'disk_percent'),
            ('serverkit_containers_running', 'Number of running containers', 'container_running'),
        ]

        for metric_name, help_text, col_name in metrics_defs:
            lines.append(f'# HELP {metric_name} {help_text}')
            lines.append(f'# TYPE {metric_name} gauge')

            for server in servers:
                latest = metrics_by_server.get(server.id)

                if latest:
                    val = getattr(latest, col_name)
                    if val is not None:
                        safe_name = server.name.replace('"', '\\"')
                        lines.append(
                            f'{metric_name}{{server="{safe_name}",server_id="{server.id}"}} {val}'
                        )
            lines.append('')

        # Server status (1 = online, 0 = offline)
        lines.append('# HELP serverkit_server_up Server online status')
        lines.append('# TYPE serverkit_server_up gauge')
        for server in servers:
            # Honesty rule: the up-series is exported only for
            # servers whose connectivity was actually determined. A server
            # that was never probed — status pending/connecting, or never
            # seen (last_seen NULL) — emits NO series: exporting 0 would page
            # external alertmanagers on a box we never checked. 0 is kept
            # only for determined-not-online states (offline, error,
            # maintenance).
            if server.status in ('pending', 'connecting') or server.last_seen is None:
                continue
            val = 1 if server.status == 'online' else 0
            safe_name = server.name.replace('"', '\\"')
            lines.append(
                f'serverkit_server_up{{server="{safe_name}",server_id="{server.id}"}} {val}'
            )

        return '\n'.join(lines) + '\n'

    # ==================== CSV Export ====================

    @staticmethod
    def export_metrics_csv(user, server_ids: List[str], metric: str = 'cpu', period: str = '24h') -> str:
        """Export metrics as CSV string, for the ids *user* can access."""
        hours_back = {'1h': 1, '6h': 6, '24h': 24, '7d': 168, '30d': 720}.get(period, 24)
        cutoff = datetime.utcnow() - timedelta(hours=hours_back)
        col_name = METRIC_COLUMNS.get(metric, 'cpu_percent')

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(['timestamp', 'server_id', 'server_name', metric])

        for server_id in server_ids:
            server = _visible_server(user, server_id)
            if not server:
                continue

            records = ServerMetrics.query.filter(
                ServerMetrics.server_id == server_id,
                ServerMetrics.timestamp >= cutoff
            ).order_by(ServerMetrics.timestamp.asc()).all()

            for r in records:
                val = getattr(r, col_name)
                if val is not None:
                    writer.writerow([
                        r.timestamp.isoformat(),
                        server_id,
                        server.name,
                        round(val, 2)
                    ])

        return output.getvalue()


def _downsample_simple(records, interval_minutes):
    """Simple downsampling by picking one record per interval."""
    if not records:
        return []

    result = [records[0]]
    last_ts = records[0].timestamp

    for r in records[1:]:
        if (r.timestamp - last_ts).total_seconds() >= interval_minutes * 60:
            result.append(r)
            last_ts = r.timestamp

    return result


fleet_monitor_service = FleetMonitorService()
