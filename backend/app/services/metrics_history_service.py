"""Service for recording and retrieving historical system metrics."""

import os
import psutil
import threading
import time
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from sqlalchemy import func

from app import db
from app.models.metrics_history import MetricsHistory

logger = logging.getLogger(__name__)


class MetricsHistoryService:
    """Service for managing historical metrics collection and retrieval.

    Features:
    - Records metrics every 60 seconds
    - Aggregates minute data to hourly and daily
    - Cleans up old data per retention policy
    - Provides querying by time period
    """

    # Collection interval in seconds
    COLLECTION_INTERVAL = 60

    # Retention periods
    MINUTE_RETENTION_HOURS = 24
    HOUR_RETENTION_DAYS = 7
    DAY_RETENTION_DAYS = 30

    # Period configurations: period -> (level, hours_back)
    PERIOD_CONFIG = {
        '1h': ('minute', 1),
        '6h': ('minute', 6),
        '24h': ('minute', 24),
        '7d': ('hour', 24 * 7),
        '30d': ('day', 24 * 30)
    }

    # Background collection state
    _collection_thread = None
    _stop_collection = False
    _is_running = False

    @classmethod
    def record_current_metrics(cls, app_context=None) -> Optional[MetricsHistory]:
        """Record current system metrics to the database.

        Args:
            app_context: Optional Flask app context for background thread usage

        Returns:
            The created MetricsHistory record, or None if failed
        """
        try:
            # Get current metrics using psutil
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage('/')

            try:
                load_avg = os.getloadavg()
            except (OSError, AttributeError):
                # Windows doesn't have getloadavg
                load_avg = (None, None, None)

            # Create the record
            record = MetricsHistory(
                timestamp=datetime.utcnow(),
                level='minute',
                cpu_percent=cpu_percent,
                memory_percent=memory.percent,
                memory_used_bytes=memory.used,
                memory_total_bytes=memory.total,
                disk_percent=disk.percent,
                disk_used_bytes=disk.used,
                disk_total_bytes=disk.total,
                load_1m=load_avg[0],
                load_5m=load_avg[1],
                load_15m=load_avg[2],
                sample_count=1
            )

            db.session.add(record)
            db.session.commit()

            return record

        except Exception as e:
            logger.error(f"Failed to record metrics: {e}")
            db.session.rollback()
            return None

    @classmethod
    def get_history(cls, period: str = '1h') -> Dict:
        """Get historical metrics for a given time period.

        Args:
            period: One of '1h', '6h', '24h', '7d', '30d'

        Returns:
            Dict with period, points count, data array, and summary
        """
        if period not in cls.PERIOD_CONFIG:
            period = '1h'

        level, hours_back = cls.PERIOD_CONFIG[period]
        cutoff = datetime.utcnow() - timedelta(hours=hours_back)

        # Query data
        records = MetricsHistory.query.filter(
            MetricsHistory.level == level,
            MetricsHistory.timestamp >= cutoff
        ).order_by(MetricsHistory.timestamp.asc()).all()

        # Convert to list of dicts
        data = [r.to_dict() for r in records]

        # Calculate summary
        if records:
            cpu_avg = sum(r.cpu_percent for r in records) / len(records)
            memory_avg = sum(r.memory_percent for r in records) / len(records)
            disk_avg = sum(r.disk_percent for r in records) / len(records)
        else:
            cpu_avg = memory_avg = disk_avg = 0

        return {
            'period': period,
            'level': level,
            'points': len(data),
            'data': data,
            'summary': {
                'cpu_avg': round(cpu_avg, 1),
                'memory_avg': round(memory_avg, 1),
                'disk_avg': round(disk_avg, 1)
            }
        }

    @classmethod
    def aggregate_hourly(cls) -> int:
        """Aggregate minute-level data into hourly records.

        Processes minute data older than 1 hour and creates hourly aggregates.

        Returns:
            Number of hourly records created
        """
        try:
            # Find the hour boundary (1 hour ago, rounded down)
            now = datetime.utcnow()
            hour_boundary = now.replace(minute=0, second=0, microsecond=0) - timedelta(hours=1)

            # Check if we already have an aggregate for this hour
            existing = MetricsHistory.query.filter(
                MetricsHistory.level == 'hour',
                MetricsHistory.timestamp == hour_boundary
            ).first()

            if existing:
                return 0  # Already aggregated

            # Get minute data for that hour
            hour_start = hour_boundary
            hour_end = hour_boundary + timedelta(hours=1)

            records = MetricsHistory.query.filter(
                MetricsHistory.level == 'minute',
                MetricsHistory.timestamp >= hour_start,
                MetricsHistory.timestamp < hour_end
            ).all()

            if not records:
                return 0

            # Calculate aggregates
            count = len(records)
            hourly = MetricsHistory(
                timestamp=hour_boundary,
                level='hour',
                cpu_percent=sum(r.cpu_percent for r in records) / count,
                cpu_percent_min=min(r.cpu_percent for r in records),
                cpu_percent_max=max(r.cpu_percent for r in records),
                memory_percent=sum(r.memory_percent for r in records) / count,
                memory_used_bytes=int(sum(r.memory_used_bytes for r in records) / count),
                memory_total_bytes=records[0].memory_total_bytes,
                disk_percent=sum(r.disk_percent for r in records) / count,
                disk_used_bytes=int(sum(r.disk_used_bytes for r in records) / count),
                disk_total_bytes=records[0].disk_total_bytes,
                load_1m=sum(r.load_1m for r in records if r.load_1m) / count if any(r.load_1m for r in records) else None,
                load_5m=sum(r.load_5m for r in records if r.load_5m) / count if any(r.load_5m for r in records) else None,
                load_15m=sum(r.load_15m for r in records if r.load_15m) / count if any(r.load_15m for r in records) else None,
                sample_count=count
            )

            db.session.add(hourly)
            db.session.commit()

            logger.info(f"Created hourly aggregate for {hour_boundary} from {count} samples")
            return 1

        except Exception as e:
            logger.error(f"Failed to aggregate hourly: {e}")
            db.session.rollback()
            return 0

    @classmethod
    def aggregate_daily(cls) -> int:
        """Aggregate hourly data into daily records.

        Processes hourly data older than 1 day and creates daily aggregates.

        Returns:
            Number of daily records created
        """
        try:
            # Find the day boundary (yesterday, midnight UTC)
            now = datetime.utcnow()
            day_boundary = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)

            # Check if we already have an aggregate for this day
            existing = MetricsHistory.query.filter(
                MetricsHistory.level == 'day',
                MetricsHistory.timestamp == day_boundary
            ).first()

            if existing:
                return 0  # Already aggregated

            # Get hourly data for that day
            day_start = day_boundary
            day_end = day_boundary + timedelta(days=1)

            records = MetricsHistory.query.filter(
                MetricsHistory.level == 'hour',
                MetricsHistory.timestamp >= day_start,
                MetricsHistory.timestamp < day_end
            ).all()

            if not records:
                return 0

            # Calculate aggregates
            count = len(records)
            daily = MetricsHistory(
                timestamp=day_boundary,
                level='day',
                cpu_percent=sum(r.cpu_percent for r in records) / count,
                cpu_percent_min=min(r.cpu_percent_min or r.cpu_percent for r in records),
                cpu_percent_max=max(r.cpu_percent_max or r.cpu_percent for r in records),
                memory_percent=sum(r.memory_percent for r in records) / count,
                memory_used_bytes=int(sum(r.memory_used_bytes for r in records) / count),
                memory_total_bytes=records[0].memory_total_bytes,
                disk_percent=sum(r.disk_percent for r in records) / count,
                disk_used_bytes=int(sum(r.disk_used_bytes for r in records) / count),
                disk_total_bytes=records[0].disk_total_bytes,
                load_1m=sum(r.load_1m for r in records if r.load_1m) / count if any(r.load_1m for r in records) else None,
                load_5m=sum(r.load_5m for r in records if r.load_5m) / count if any(r.load_5m for r in records) else None,
                load_15m=sum(r.load_15m for r in records if r.load_15m) / count if any(r.load_15m for r in records) else None,
                sample_count=sum(r.sample_count for r in records)
            )

            db.session.add(daily)
            db.session.commit()

            logger.info(f"Created daily aggregate for {day_boundary} from {count} hourly records")
            return 1

        except Exception as e:
            logger.error(f"Failed to aggregate daily: {e}")
            db.session.rollback()
            return 0

    @classmethod
    def cleanup_old_data(cls) -> Dict[str, int]:
        """Remove data older than retention period.

        Returns:
            Dict with counts of deleted records per level
        """
        deleted = {'minute': 0, 'hour': 0, 'day': 0}

        try:
            now = datetime.utcnow()

            # Delete old minute data (older than 24 hours)
            minute_cutoff = now - timedelta(hours=cls.MINUTE_RETENTION_HOURS)
            result = MetricsHistory.query.filter(
                MetricsHistory.level == 'minute',
                MetricsHistory.timestamp < minute_cutoff
            ).delete()
            deleted['minute'] = result

            # Delete old hourly data (older than 7 days)
            hour_cutoff = now - timedelta(days=cls.HOUR_RETENTION_DAYS)
            result = MetricsHistory.query.filter(
                MetricsHistory.level == 'hour',
                MetricsHistory.timestamp < hour_cutoff
            ).delete()
            deleted['hour'] = result

            # Delete old daily data (older than 30 days)
            day_cutoff = now - timedelta(days=cls.DAY_RETENTION_DAYS)
            result = MetricsHistory.query.filter(
                MetricsHistory.level == 'day',
                MetricsHistory.timestamp < day_cutoff
            ).delete()
            deleted['day'] = result

            db.session.commit()

            total = sum(deleted.values())
            if total > 0:
                logger.info(f"Cleaned up {total} old metrics records: {deleted}")

            return deleted

        except Exception as e:
            logger.error(f"Failed to cleanup old data: {e}")
            db.session.rollback()
            return deleted

    @classmethod
    def get_stats(cls) -> Dict:
        """Get statistics about stored metrics data.

        Returns:
            Dict with record counts per level and date ranges
        """
        stats = {}

        for level in ['minute', 'hour', 'day']:
            count = MetricsHistory.query.filter(MetricsHistory.level == level).count()
            oldest = MetricsHistory.query.filter(MetricsHistory.level == level).order_by(
                MetricsHistory.timestamp.asc()
            ).first()
            newest = MetricsHistory.query.filter(MetricsHistory.level == level).order_by(
                MetricsHistory.timestamp.desc()
            ).first()

            stats[level] = {
                'count': count,
                'oldest': oldest.timestamp.isoformat() if oldest else None,
                'newest': newest.timestamp.isoformat() if newest else None
            }

        return stats

    @classmethod
    def start_collection(cls, app):
        """Start background metrics collection thread.

        Args:
            app: Flask application instance for context
        """
        if cls._is_running:
            logger.warning("Metrics collection already running")
            return

        cls._stop_collection = False
        cls._is_running = True

        def collection_loop():
            with app.app_context():
                logger.info("Metrics history collection started")
                last_hour_check = datetime.utcnow()
                last_day_check = datetime.utcnow()

                while not cls._stop_collection:
                    try:
                        # Record current metrics
                        cls.record_current_metrics()

                        # Check if we need to run hourly aggregation
                        now = datetime.utcnow()
                        if (now - last_hour_check).total_seconds() >= 3600:
                            cls.aggregate_hourly()
                            cls.cleanup_old_data()
                            last_hour_check = now

                        # Check if we need to run daily aggregation
                        if (now - last_day_check).total_seconds() >= 86400:
                            cls.aggregate_daily()
                            last_day_check = now

                    except Exception as e:
                        logger.error(f"Error in metrics collection loop: {e}")

                    # Wait for next collection interval
                    time.sleep(cls.COLLECTION_INTERVAL)

                logger.info("Metrics history collection stopped")

        cls._collection_thread = threading.Thread(target=collection_loop, daemon=True)
        cls._collection_thread.start()

    @classmethod
    def stop_collection(cls):
        """Stop background metrics collection."""
        cls._stop_collection = True
        cls._is_running = False
        if cls._collection_thread:
            cls._collection_thread.join(timeout=5)
            cls._collection_thread = None

    @classmethod
    def is_running(cls) -> bool:
        """Check if collection is running."""
        return cls._is_running
