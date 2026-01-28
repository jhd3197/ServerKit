"""
Sanitization Profile Model

Reusable database sanitization presets for WordPress environment sync/promote operations.
Profiles define which data to anonymize, truncate, or strip when copying databases
between environments.
"""

from datetime import datetime
from app import db
import json


class SanitizationProfile(db.Model):
    """Reusable database sanitization preset."""

    __tablename__ = 'sanitization_profiles'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)

    # JSON config with sanitization rules
    config = db.Column(db.Text, nullable=False)
    # Expected structure:
    # {
    #   "anonymize_emails": true,
    #   "anonymize_names": true,
    #   "reset_passwords": true,
    #   "truncate_tables": ["wp_actionscheduler_actions", "wp_actionscheduler_logs"],
    #   "exclude_tables": [],
    #   "strip_payment_data": false,
    #   "remove_transients": true,
    #   "custom_search_replace": {}
    # }

    is_default = db.Column(db.Boolean, default=False)
    is_builtin = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, onupdate=datetime.utcnow)

    # Relationships
    user = db.relationship('User', backref=db.backref('sanitization_profiles', lazy='dynamic'))

    def get_config(self):
        """Parse and return the config dict."""
        try:
            return json.loads(self.config) if self.config else {}
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_config(self, config_dict):
        """Set config from a dict."""
        self.config = json.dumps(config_dict)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'name': self.name,
            'description': self.description,
            'config': self.get_config(),
            'is_default': self.is_default,
            'is_builtin': self.is_builtin,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f'<SanitizationProfile {self.id} "{self.name}">'

    # ==================== BUILT-IN PROFILES ====================

    BUILTIN_PROFILES = [
        {
            'name': 'Basic',
            'description': 'Anonymize email addresses and reset user passwords. Suitable for most development environments.',
            'config': {
                'anonymize_emails': True,
                'anonymize_names': False,
                'reset_passwords': True,
                'truncate_tables': [
                    'actionscheduler_actions',
                    'actionscheduler_logs',
                ],
                'exclude_tables': [],
                'strip_payment_data': False,
                'remove_transients': True,
                'custom_search_replace': {},
            }
        },
        {
            'name': 'Full',
            'description': 'Full sanitization: anonymize emails, names, reset passwords, and clear analytics/session data.',
            'config': {
                'anonymize_emails': True,
                'anonymize_names': True,
                'reset_passwords': True,
                'truncate_tables': [
                    'actionscheduler_actions',
                    'actionscheduler_logs',
                    'statistics_visits',
                    'statistics_pages',
                    'slim_stats',
                    'redirection_logs',
                    'redirection_404',
                ],
                'exclude_tables': [],
                'strip_payment_data': False,
                'remove_transients': True,
                'custom_search_replace': {},
            }
        },
        {
            'name': 'WooCommerce',
            'description': 'Strip WooCommerce order/payment data, anonymize customers, and clear session data.',
            'config': {
                'anonymize_emails': True,
                'anonymize_names': True,
                'reset_passwords': True,
                'truncate_tables': [
                    'actionscheduler_actions',
                    'actionscheduler_logs',
                    'wc_orders',
                    'wc_order_addresses',
                    'wc_order_operational_data',
                    'wc_order_stats',
                    'woocommerce_sessions',
                    'woocommerce_log',
                ],
                'exclude_tables': [],
                'strip_payment_data': True,
                'remove_transients': True,
                'custom_search_replace': {},
            }
        },
    ]

    @classmethod
    def seed_builtins(cls, user_id):
        """Create built-in profiles for a user if they don't exist."""
        created = []
        for profile_data in cls.BUILTIN_PROFILES:
            existing = cls.query.filter_by(
                user_id=user_id,
                name=profile_data['name'],
                is_builtin=True
            ).first()

            if not existing:
                profile = cls(
                    user_id=user_id,
                    name=profile_data['name'],
                    description=profile_data['description'],
                    config=json.dumps(profile_data['config']),
                    is_builtin=True,
                    is_default=(profile_data['name'] == 'Basic'),
                )
                db.session.add(profile)
                created.append(profile_data['name'])

        if created:
            db.session.commit()

        return created
