"""Service for system settings operations."""
from app import db
from app.models import SystemSettings, User


class SettingsService:
    """Service for managing system settings."""

    # Default settings with their types and descriptions
    DEFAULT_SETTINGS = {
        'setup_completed': {
            'value': False,
            'type': 'boolean',
            'description': 'Whether initial setup has been completed'
        },
        'registration_enabled': {
            'value': False,
            'type': 'boolean',
            'description': 'Allow public user registration'
        },
        'instance_name': {
            'value': 'ServerKit',
            'type': 'string',
            'description': 'Name of this ServerKit instance'
        },
        'audit_log_retention_days': {
            'value': 90,
            'type': 'integer',
            'description': 'Number of days to retain audit logs'
        },
        'onboarding_use_cases': {
            'value': [],
            'type': 'json',
            'description': 'Use cases selected during onboarding wizard'
        },
        'dev_mode': {
            'value': False,
            'type': 'boolean',
            'description': 'Enable developer mode for debugging tools and icon reference'
        }
    }

    @staticmethod
    def get(key, default=None):
        """Get a setting value by key."""
        return SystemSettings.get(key, default)

    @staticmethod
    def set(key, value, user_id=None):
        """Set a setting value by key."""
        # Get the expected type from defaults
        default_config = SettingsService.DEFAULT_SETTINGS.get(key, {})
        value_type = default_config.get('type', 'string')
        description = default_config.get('description')

        setting = SystemSettings.set(
            key=key,
            value=value,
            value_type=value_type,
            description=description,
            user_id=user_id
        )
        db.session.commit()
        return setting

    @staticmethod
    def get_all():
        """Get all settings as a dictionary."""
        settings = SystemSettings.query.all()
        result = {}
        for setting in settings:
            result[setting.key] = setting.get_typed_value()
        return result

    @staticmethod
    def get_all_with_metadata():
        """Get all settings with full metadata."""
        settings = SystemSettings.query.all()
        return [setting.to_dict() for setting in settings]

    @staticmethod
    def initialize_defaults():
        """Initialize default settings if they don't exist."""
        for key, config in SettingsService.DEFAULT_SETTINGS.items():
            existing = SystemSettings.query.filter_by(key=key).first()
            if not existing:
                SystemSettings.set(
                    key=key,
                    value=config['value'],
                    value_type=config['type'],
                    description=config['description']
                )
        db.session.commit()

    @staticmethod
    def needs_setup():
        """Check if initial setup is required."""
        # If no users exist, setup is needed
        user_count = User.query.count()
        if user_count == 0:
            return True

        # Check setup_completed setting
        setup_completed = SettingsService.get('setup_completed', False)
        return not setup_completed

    @staticmethod
    def complete_setup(user_id=None):
        """Mark the initial setup as completed."""
        SettingsService.set('setup_completed', True, user_id=user_id)

    @staticmethod
    def is_registration_enabled():
        """Check if public registration is enabled."""
        # If no users exist, always allow registration (for first user)
        user_count = User.query.count()
        if user_count == 0:
            return True
        return SettingsService.get('registration_enabled', False)

    @staticmethod
    def set_registration_enabled(enabled, user_id=None):
        """Enable or disable public registration."""
        SettingsService.set('registration_enabled', enabled, user_id=user_id)

    @staticmethod
    def migrate_legacy_roles():
        """Migrate users with 'user' role to 'developer' role."""
        users_to_migrate = User.query.filter_by(role='user').all()
        count = 0
        for user in users_to_migrate:
            user.role = User.ROLE_DEVELOPER
            count += 1
        if count > 0:
            db.session.commit()
        return count

    @staticmethod
    def ensure_admin_exists():
        """
        Check if at least one admin exists.
        If users exist but no admins, something is wrong.
        """
        admin_count = User.query.filter_by(role=User.ROLE_ADMIN).count()
        user_count = User.query.count()
        return admin_count > 0 or user_count == 0
