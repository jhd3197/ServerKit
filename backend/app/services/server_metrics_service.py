"""Service for managing historical metrics from remote servers.

Provides:
- Retention policies for ServerMetrics data
- Aggregation (hourly, daily summaries)
- Historical queries with different time periods
- Cleanup of old data
"""

import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from sqlalchemy import func, and_

from app import db
from app.models.server import Server, ServerMetrics

logger = logging.getLogger(__name__)


class ServerMetricsService:
    """Service for managing remote server metrics with retention and aggregation."""

    # Retention periods (in days)
    RAW_RETENTION_DAYS = 7       # Keep raw metrics for 7 days
    HOURLY_RETENTION_DAYS = 30   # Keep hourly aggregates for 30 days
    DAILY_RETENTION_DAYS = 365   # Keep daily aggregates for 1 year

    # Period configurations: period -> (interval_minutes, hours_back)
    PERIOD_CONFIG = {
        '1h': (1, 1),           # 1 minute intervals, 1 hour back
        '6h': (5, 6),           # 5 minute intervals, 6 hours back
        '24h': (15, 24),        # 15 minute intervals, 24 hours back
        '7d': (60, 24 * 7),     # 1 hour intervals, 7 days back
        '30d': (360, 24 * 30),  # 6 hour intervals, 30 days back
    }

    @classmethod
    def record_metrics(cls, server_id: str, metrics: Dict[str, Any]) -> Optional[ServerMetrics]:
        """Record metrics from a server heartbeat.

        Args:
            server_id: The server UUID
            metrics: Metrics dict from agent heartbeat

        Returns:
            The created ServerMetrics record, or None if failed
        """
        try:
            record = ServerMetrics(
                server_id=server_id,
                timestamp=datetime.utcnow(),
                cpu_percent=metrics.get('cpu_percent'),
                memory_percent=metrics.get('memory_percent'),
                memory_used=metrics.get('memory_used'),
                disk_percent=metrics.get('disk_percent'),
                disk_used=metrics.get('disk_used'),
                network_rx=metrics.get('network_rx'),
                network_tx=metrics.get('network_tx'),
                network_rx_rate=metrics.get('network_rx_rate'),
                network_tx_rate=metrics.get('network_tx_rate'),
                container_count=metrics.get('container_count'),
                container_running=metrics.get('container_running'),
                extra=metrics.get('extra')
            )

            db.session.add(record)
            db.session.commit()

            return record

        except Exception as e:
            logger.error(f"Failed to record metrics for server {server_id}: {e}")
            db.session.rollback()
            return None

    @classmethod
    def get_server_history(cls, server_id: str, period: str = '1h') -> Dict[str, Any]:
        """Get historical metrics for a specific server.

        Args:
            server_id: The server UUID
            period: One of '1h', '6h', '24h', '7d', '30d'

        Returns:
            Dict with period info, data points, and summary statistics
        """
        if period not in cls.PERIOD_CONFIG:
            period = '1h'

        interval_minutes, hours_back = cls.PERIOD_CONFIG[period]
        cutoff = datetime.utcnow() - timedelta(hours=hours_back)

        # Get raw data points
        records = ServerMetrics.query.filter(
            ServerMetrics.server_id == server_id,
            ServerMetrics.timestamp >= cutoff
        ).order_by(ServerMetrics.timestamp.asc()).all()

        # Downsample if needed (for longer periods)
        if interval_minutes > 1 and records:
            records = cls._downsample(records, interval_minutes)

        # Convert to list of dicts
        data = [r.to_dict() for r in records]

        # Calculate summary statistics
        summary = cls._calculate_summary(records)

        return {
            'server_id': server_id,
            'period': period,
            'interval_minutes': interval_minutes,
            'points': len(data),
            'data': data,
            'summary': summary
        }

    @classmethod
    def get_aggregated_metrics(cls, server_id: str, period: str = '24h',
                                aggregation: str = 'hourly') -> Dict[str, Any]:
        """Get aggregated metrics for a server.

        Args:
            server_id: The server UUID
            period: Time period ('24h', '7d', '30d')
            aggregation: 'hourly' or 'daily'

        Returns:
            Dict with aggregated data points
        """
        hours_back = {
            '24h': 24,
            '7d': 24 * 7,
            '30d': 24 * 30,
        }.get(period, 24)

        cutoff = datetime.utcnow() - timedelta(hours=hours_back)

        if aggregation == 'daily':
            # Group by day
            trunc_expr = func.date_trunc('day', ServerMetrics.timestamp)
        else:
            # Group by hour
            trunc_expr = func.date_trunc('hour', ServerMetrics.timestamp)

        # Query with aggregation
        query = db.session.query(
            trunc_expr.label('period'),
            func.avg(ServerMetrics.cpu_percent).label('cpu_avg'),
            func.min(ServerMetrics.cpu_percent).label('cpu_min'),
            func.max(ServerMetrics.cpu_percent).label('cpu_max'),
            func.avg(ServerMetrics.memory_percent).label('memory_avg'),
            func.min(ServerMetrics.memory_percent).label('memory_min'),
            func.max(ServerMetrics.memory_percent).label('memory_max'),
            func.avg(ServerMetrics.disk_percent).label('disk_avg'),
            func.avg(ServerMetrics.network_rx_rate).label('network_rx_avg'),
            func.avg(ServerMetrics.network_tx_rate).label('network_tx_avg'),
            func.avg(ServerMetrics.container_running).label('containers_avg'),
            func.count().label('sample_count')
        ).filter(
            ServerMetrics.server_id == server_id,
            ServerMetrics.timestamp >= cutoff
        ).group_by(trunc_expr).order_by(trunc_expr)

        results = query.all()

        data = []
        for row in results:
            data.append({
                'timestamp': row.period.isoformat() if row.period else None,
                'cpu': {
                    'avg': round(row.cpu_avg, 1) if row.cpu_avg else None,
                    'min': round(row.cpu_min, 1) if row.cpu_min else None,
                    'max': round(row.cpu_max, 1) if row.cpu_max else None,
                },
                'memory': {
                    'avg': round(row.memory_avg, 1) if row.memory_avg else None,
                    'min': round(row.memory_min, 1) if row.memory_min else None,
                    'max': round(row.memory_max, 1) if row.memory_max else None,
                },
                'disk_avg': round(row.disk_avg, 1) if row.disk_avg else None,
                'network': {
                    'rx_avg': round(row.network_rx_avg, 2) if row.network_rx_avg else None,
                    'tx_avg': round(row.network_tx_avg, 2) if row.network_tx_avg else None,
                },
                'containers_avg': round(row.containers_avg, 1) if row.containers_avg else None,
                'sample_count': row.sample_count
            })

        return {
            'server_id': server_id,
            'period': period,
            'aggregation': aggregation,
            'points': len(data),
            'data': data
        }

    @classmethod
    def get_multi_server_comparison(cls, server_ids: List[str], metric: str = 'cpu',
                                     period: str = '24h') -> Dict[str, Any]:
        """Get metrics comparison across multiple servers.

        Args:
            server_ids: List of server UUIDs
            metric: 'cpu', 'memory', 'disk', or 'network'
            period: Time period

        Returns:
            Dict with comparison data for each server
        """
        hours_back = {
            '1h': 1,
            '6h': 6,
            '24h': 24,
            '7d': 24 * 7,
        }.get(period, 24)

        cutoff = datetime.utcnow() - timedelta(hours=hours_back)

        result = {
            'metric': metric,
            'period': period,
            'servers': {}
        }

        metric_column = {
            'cpu': ServerMetrics.cpu_percent,
            'memory': ServerMetrics.memory_percent,
            'disk': ServerMetrics.disk_percent,
        }.get(metric, ServerMetrics.cpu_percent)

        for server_id in server_ids:
            # Get server info
            server = Server.query.get(server_id)
            if not server:
                continue

            # Query metrics
            records = ServerMetrics.query.filter(
                ServerMetrics.server_id == server_id,
                ServerMetrics.timestamp >= cutoff
            ).order_by(ServerMetrics.timestamp.asc()).all()

            # Calculate statistics
            values = [getattr(r, metric_column.key) for r in records if getattr(r, metric_column.key) is not None]

            result['servers'][server_id] = {
                'name': server.name,
                'current': values[-1] if values else None,
                'avg': round(sum(values) / len(values), 1) if values else None,
                'min': round(min(values), 1) if values else None,
                'max': round(max(values), 1) if values else None,
                'points': len(values)
            }

        return result

    @classmethod
    def cleanup_old_metrics(cls) -> Dict[str, int]:
        """Remove metrics older than retention period.

        Returns:
            Dict with count of deleted records per category
        """
        deleted = {'raw': 0}

        try:
            now = datetime.utcnow()

            # Delete raw metrics older than retention period
            raw_cutoff = now - timedelta(days=cls.RAW_RETENTION_DAYS)

            result = ServerMetrics.query.filter(
                ServerMetrics.timestamp < raw_cutoff
            ).delete(synchronize_session=False)

            deleted['raw'] = result

            db.session.commit()

            if result > 0:
                logger.info(f"Cleaned up {result} old server metrics records")

            return deleted

        except Exception as e:
            logger.error(f"Failed to cleanup old server metrics: {e}")
            db.session.rollback()
            return deleted

    @classmethod
    def get_retention_stats(cls) -> Dict[str, Any]:
        """Get statistics about metrics retention.

        Returns:
            Dict with record counts, date ranges, and storage info
        """
        try:
            # Total count
            total_count = ServerMetrics.query.count()

            # Count per server
            server_counts = db.session.query(
                ServerMetrics.server_id,
                func.count().label('count')
            ).group_by(ServerMetrics.server_id).all()

            # Date range
            oldest = ServerMetrics.query.order_by(
                ServerMetrics.timestamp.asc()
            ).first()

            newest = ServerMetrics.query.order_by(
                ServerMetrics.timestamp.desc()
            ).first()

            # Estimate storage (rough: ~200 bytes per record)
            estimated_size_mb = (total_count * 200) / (1024 * 1024)

            return {
                'total_records': total_count,
                'servers': len(server_counts),
                'records_per_server': {
                    sc.server_id: sc.count for sc in server_counts
                },
                'oldest_record': oldest.timestamp.isoformat() if oldest else None,
                'newest_record': newest.timestamp.isoformat() if newest else None,
                'estimated_size_mb': round(estimated_size_mb, 2),
                'retention_days': cls.RAW_RETENTION_DAYS
            }

        except Exception as e:
            logger.error(f"Failed to get retention stats: {e}")
            return {'error': str(e)}

    @classmethod
    def _downsample(cls, records: List[ServerMetrics], interval_minutes: int) -> List[ServerMetrics]:
        """Downsample records to the given interval.

        Groups records into buckets and returns one averaged record per bucket.
        """
        if not records:
            return []

        interval = timedelta(minutes=interval_minutes)
        result = []
        bucket_start = records[0].timestamp
        bucket_records = []

        for record in records:
            # Check if record belongs to current bucket
            if record.timestamp < bucket_start + interval:
                bucket_records.append(record)
            else:
                # Emit averaged record for current bucket
                if bucket_records:
                    result.append(cls._average_records(bucket_records))

                # Start new bucket
                bucket_start = record.timestamp
                bucket_records = [record]

        # Don't forget the last bucket
        if bucket_records:
            result.append(cls._average_records(bucket_records))

        return result

    @classmethod
    def _average_records(cls, records: List[ServerMetrics]) -> ServerMetrics:
        """Create an averaged record from a list of records."""
        if len(records) == 1:
            return records[0]

        # Use the middle timestamp
        avg_record = ServerMetrics()
        avg_record.server_id = records[0].server_id
        avg_record.timestamp = records[len(records) // 2].timestamp

        # Average numeric fields
        def safe_avg(values):
            filtered = [v for v in values if v is not None]
            return sum(filtered) / len(filtered) if filtered else None

        avg_record.cpu_percent = safe_avg([r.cpu_percent for r in records])
        avg_record.memory_percent = safe_avg([r.memory_percent for r in records])
        avg_record.memory_used = int(safe_avg([r.memory_used for r in records]) or 0) or None
        avg_record.disk_percent = safe_avg([r.disk_percent for r in records])
        avg_record.disk_used = int(safe_avg([r.disk_used for r in records]) or 0) or None
        avg_record.network_rx_rate = safe_avg([r.network_rx_rate for r in records])
        avg_record.network_tx_rate = safe_avg([r.network_tx_rate for r in records])
        avg_record.container_count = int(safe_avg([r.container_count for r in records]) or 0) or None
        avg_record.container_running = int(safe_avg([r.container_running for r in records]) or 0) or None

        return avg_record

    @classmethod
    def _calculate_summary(cls, records: List[ServerMetrics]) -> Dict[str, Any]:
        """Calculate summary statistics from a list of records."""
        if not records:
            return {
                'cpu_avg': None,
                'cpu_max': None,
                'memory_avg': None,
                'memory_max': None,
                'disk_avg': None,
            }

        cpu_values = [r.cpu_percent for r in records if r.cpu_percent is not None]
        memory_values = [r.memory_percent for r in records if r.memory_percent is not None]
        disk_values = [r.disk_percent for r in records if r.disk_percent is not None]

        return {
            'cpu_avg': round(sum(cpu_values) / len(cpu_values), 1) if cpu_values else None,
            'cpu_max': round(max(cpu_values), 1) if cpu_values else None,
            'memory_avg': round(sum(memory_values) / len(memory_values), 1) if memory_values else None,
            'memory_max': round(max(memory_values), 1) if memory_values else None,
            'disk_avg': round(sum(disk_values) / len(disk_values), 1) if disk_values else None,
        }
