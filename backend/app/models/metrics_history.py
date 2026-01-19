"""Historical metrics storage model."""

from datetime import datetime
from app import db


class MetricsHistory(db.Model):
    """Historical metrics storage with automatic aggregation levels.

    Stores system metrics at different aggregation levels:
    - minute: Raw data points (retained 24 hours)
    - hour: Hourly aggregates (retained 7 days)
    - day: Daily aggregates (retained 30 days)
    """
    __tablename__ = 'metrics_history'

    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, nullable=False, index=True)

    # Aggregation level: 'minute', 'hour', 'day'
    level = db.Column(db.String(10), nullable=False, default='minute', index=True)

    # CPU metrics
    cpu_percent = db.Column(db.Float, nullable=False)
    cpu_percent_min = db.Column(db.Float, nullable=True)  # For aggregated records
    cpu_percent_max = db.Column(db.Float, nullable=True)

    # Memory metrics
    memory_percent = db.Column(db.Float, nullable=False)
    memory_used_bytes = db.Column(db.BigInteger, nullable=False)
    memory_total_bytes = db.Column(db.BigInteger, nullable=False)

    # Disk metrics (root partition)
    disk_percent = db.Column(db.Float, nullable=False)
    disk_used_bytes = db.Column(db.BigInteger, nullable=False)
    disk_total_bytes = db.Column(db.BigInteger, nullable=False)

    # Load average (Unix only, may be null on Windows)
    load_1m = db.Column(db.Float, nullable=True)
    load_5m = db.Column(db.Float, nullable=True)
    load_15m = db.Column(db.Float, nullable=True)

    # Sample count (for aggregated records)
    sample_count = db.Column(db.Integer, default=1)

    # Composite index for efficient queries
    __table_args__ = (
        db.Index('idx_metrics_level_timestamp', 'level', 'timestamp'),
    )

    def to_dict(self):
        """Convert to dictionary for API response."""
        return {
            'timestamp': self.timestamp.isoformat(),
            'level': self.level,
            'cpu': {
                'percent': round(self.cpu_percent, 1),
                'min': round(self.cpu_percent_min, 1) if self.cpu_percent_min else None,
                'max': round(self.cpu_percent_max, 1) if self.cpu_percent_max else None
            },
            'memory': {
                'percent': round(self.memory_percent, 1),
                'used_bytes': self.memory_used_bytes,
                'total_bytes': self.memory_total_bytes,
                'used_gb': round(self.memory_used_bytes / (1024**3), 2),
                'total_gb': round(self.memory_total_bytes / (1024**3), 2)
            },
            'disk': {
                'percent': round(self.disk_percent, 1),
                'used_bytes': self.disk_used_bytes,
                'total_bytes': self.disk_total_bytes,
                'used_gb': round(self.disk_used_bytes / (1024**3), 2),
                'total_gb': round(self.disk_total_bytes / (1024**3), 2)
            },
            'load': {
                '1m': round(self.load_1m, 2) if self.load_1m else None,
                '5m': round(self.load_5m, 2) if self.load_5m else None,
                '15m': round(self.load_15m, 2) if self.load_15m else None
            },
            'sample_count': self.sample_count
        }

    def __repr__(self):
        return f'<MetricsHistory {self.timestamp} [{self.level}]>'
