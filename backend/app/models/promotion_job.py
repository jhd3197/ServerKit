"""
Promotion Job Model

Tracks code/data promotions between WordPress environments
(e.g., staging -> production, dev -> staging).
"""

from datetime import datetime
from app import db
import json


class PromotionJob(db.Model):
    """Track code/data promotions between environments."""

    __tablename__ = 'promotion_jobs'

    id = db.Column(db.Integer, primary_key=True)

    # Source and target sites
    source_site_id = db.Column(db.Integer, db.ForeignKey('wordpress_sites.id'), nullable=False)
    target_site_id = db.Column(db.Integer, db.ForeignKey('wordpress_sites.id'), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)

    # Promotion details
    promotion_type = db.Column(db.String(20), nullable=False)  # code, database, files, full
    config = db.Column(db.Text)  # JSON: search_replace, exclude_tables, etc.

    # Status tracking
    status = db.Column(db.String(20), default='pending')  # pending, running, completed, failed, rolled_back
    pre_promotion_snapshot_id = db.Column(db.Integer, db.ForeignKey('database_snapshots.id'), nullable=True)
    error_message = db.Column(db.Text)

    # Timing
    started_at = db.Column(db.DateTime)
    completed_at = db.Column(db.DateTime)
    duration_seconds = db.Column(db.Float)

    # Timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    source_site = db.relationship('WordPressSite', foreign_keys=[source_site_id],
                                  backref=db.backref('promotions_as_source', lazy='dynamic'))
    target_site = db.relationship('WordPressSite', foreign_keys=[target_site_id],
                                  backref=db.backref('promotions_as_target', lazy='dynamic'))
    user = db.relationship('User', backref=db.backref('promotion_jobs', lazy='dynamic'))
    pre_promotion_snapshot = db.relationship('DatabaseSnapshot', foreign_keys=[pre_promotion_snapshot_id])

    def to_dict(self):
        return {
            'id': self.id,
            'source_site_id': self.source_site_id,
            'target_site_id': self.target_site_id,
            'user_id': self.user_id,
            'promotion_type': self.promotion_type,
            'config': json.loads(self.config) if self.config else None,
            'status': self.status,
            'pre_promotion_snapshot_id': self.pre_promotion_snapshot_id,
            'error_message': self.error_message,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'duration_seconds': self.duration_seconds,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'source_site': self.source_site.to_dict() if self.source_site else None,
            'target_site': self.target_site.to_dict() if self.target_site else None,
        }

    def __repr__(self):
        return f'<PromotionJob {self.id} {self.promotion_type} {self.source_site_id}->{self.target_site_id}>'
