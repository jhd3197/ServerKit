"""Service for audit logging operations."""
from flask import request
from app import db
from app.models import AuditLog


class AuditService:
    """Service for creating and querying audit logs."""

    @staticmethod
    def get_request_info():
        """Extract IP address and user agent from the current request."""
        ip_address = request.remote_addr
        # Handle proxy headers
        if request.headers.get('X-Forwarded-For'):
            ip_address = request.headers.get('X-Forwarded-For').split(',')[0].strip()
        elif request.headers.get('X-Real-IP'):
            ip_address = request.headers.get('X-Real-IP')

        user_agent = request.headers.get('User-Agent', '')[:500]
        return ip_address, user_agent

    @staticmethod
    def log(action, user_id=None, target_type=None, target_id=None, details=None):
        """
        Create an audit log entry with request context.

        Args:
            action: The action being logged (use AuditLog.ACTION_* constants)
            user_id: ID of the user performing the action
            target_type: Type of the target (e.g., 'user', 'app', 'setting')
            target_id: ID of the target entity
            details: Dictionary with additional details

        Returns:
            The created AuditLog entry
        """
        ip_address, user_agent = AuditService.get_request_info()

        log_entry = AuditLog.log(
            action=action,
            user_id=user_id,
            target_type=target_type,
            target_id=target_id,
            details=details,
            ip_address=ip_address,
            user_agent=user_agent
        )
        return log_entry

    @staticmethod
    def log_login(user_id, success=True, details=None):
        """Log a login attempt."""
        action = AuditLog.ACTION_LOGIN if success else AuditLog.ACTION_LOGIN_FAILED
        return AuditService.log(
            action=action,
            user_id=user_id,
            target_type='user',
            target_id=user_id,
            details=details
        )

    @staticmethod
    def log_user_action(action, user_id, target_user_id, details=None):
        """Log a user management action."""
        return AuditService.log(
            action=action,
            user_id=user_id,
            target_type='user',
            target_id=target_user_id,
            details=details
        )

    @staticmethod
    def log_settings_change(user_id, key, old_value, new_value):
        """Log a settings change."""
        return AuditService.log(
            action=AuditLog.ACTION_SETTINGS_UPDATE,
            user_id=user_id,
            target_type='setting',
            details={'key': key, 'old_value': old_value, 'new_value': new_value}
        )

    @staticmethod
    def log_app_action(action, user_id, app_id, app_name=None, details=None):
        """Log an application action."""
        log_details = details or {}
        if app_name:
            log_details['app_name'] = app_name
        return AuditService.log(
            action=action,
            user_id=user_id,
            target_type='app',
            target_id=app_id,
            details=log_details
        )

    @staticmethod
    def get_logs(page=1, per_page=50, action=None, user_id=None,
                 target_type=None, start_date=None, end_date=None):
        """
        Query audit logs with filtering and pagination.

        Args:
            page: Page number (1-indexed)
            per_page: Number of results per page
            action: Filter by action type
            user_id: Filter by user who performed action
            target_type: Filter by target type
            start_date: Filter logs after this date
            end_date: Filter logs before this date

        Returns:
            Pagination object with logs
        """
        query = AuditLog.query.order_by(AuditLog.created_at.desc())

        if action:
            query = query.filter(AuditLog.action == action)
        if user_id:
            query = query.filter(AuditLog.user_id == user_id)
        if target_type:
            query = query.filter(AuditLog.target_type == target_type)
        if start_date:
            query = query.filter(AuditLog.created_at >= start_date)
        if end_date:
            query = query.filter(AuditLog.created_at <= end_date)

        return query.paginate(page=page, per_page=per_page, error_out=False)

    @staticmethod
    def get_recent_logs(limit=100):
        """Get the most recent audit logs."""
        return AuditLog.query.order_by(
            AuditLog.created_at.desc()
        ).limit(limit).all()

    @staticmethod
    def get_user_activity(user_id, limit=50):
        """Get recent activity for a specific user."""
        return AuditLog.query.filter_by(
            user_id=user_id
        ).order_by(
            AuditLog.created_at.desc()
        ).limit(limit).all()

    @staticmethod
    def cleanup_old_logs(days=90):
        """Delete audit logs older than specified days."""
        from datetime import datetime, timedelta
        cutoff = datetime.utcnow() - timedelta(days=days)
        deleted = AuditLog.query.filter(AuditLog.created_at < cutoff).delete()
        db.session.commit()
        return deleted
