"""Admin API endpoints for user management, settings, and audit logs."""
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional
from flask import Blueprint, request, jsonify

from app.api._query import PageQuery
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func
from app import db
from app.models import User, AuditLog
from app.middleware.rbac import admin_required, get_current_user
from app.services.audit_service import AuditService
from app.services.settings_service import SettingsService
from app.services.permission_service import PermissionService
from app.utils.domain import detect_request_domain, canonical_origin, is_valid_canonical_domain
from app.exceptions import not_found

admin_bp = Blueprint('admin', __name__)


# ============================================
# User Management Endpoints
# ============================================

@admin_bp.route('/users', methods=['GET'])
@admin_required
def list_users():
    """List all users."""
    users = User.query.order_by(User.created_at.desc()).all()
    return jsonify({
        'users': [user.to_dict() for user in users]
    }), 200


@admin_bp.route('/users', methods=['POST'])
@admin_required
def create_user():
    """Create a new user."""
    data = request.get_json()
    current_user_id = get_jwt_identity()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    email = data.get('email')
    username = data.get('username')
    password = data.get('password')
    role = data.get('role', User.ROLE_DEVELOPER)

    if not all([email, username, password]):
        return jsonify({'error': 'Missing required fields: email, username, password'}), 400

    if role not in User.VALID_ROLES:
        return jsonify({'error': f'Invalid role. Must be one of: {", ".join(User.VALID_ROLES)}'}), 400

    if User.query.filter(func.lower(User.email) == func.lower(email)).first():
        return jsonify({'error': 'Email already registered'}), 409

    if User.query.filter_by(username=username).first():
        return jsonify({'error': 'Username already taken'}), 409

    if len(password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400

    user = User(
        email=email,
        username=username,
        role=role,
        created_by=current_user_id,
        is_active=data.get('is_active', True)
    )
    user.set_password(password)

    db.session.add(user)
    db.session.commit()

    # Log the action
    AuditService.log_user_action(
        action=AuditLog.ACTION_USER_CREATE,
        user_id=current_user_id,
        target_user_id=user.id,
        details={'username': username, 'role': role}
    )
    db.session.commit()

    return jsonify({
        'message': 'User created successfully',
        'user': user.to_dict()
    }), 201


@admin_bp.route('/users/<int:user_id>', methods=['GET'])
@admin_required
def get_user(user_id):
    """Get a specific user."""
    user = User.query.get(user_id)
    if not user:
        raise not_found('user')

    return jsonify({'user': user.to_dict()}), 200


@admin_bp.route('/users/<int:user_id>', methods=['PUT'])
@admin_required
def update_user(user_id):
    """Update a user."""
    data = request.get_json()
    current_user_id = get_jwt_identity()

    user = User.query.get(user_id)
    if not user:
        raise not_found('user')

    changes = {}

    # Update email
    if 'email' in data and data['email'].lower() != user.email.lower():
        existing = User.query.filter(
            func.lower(User.email) == func.lower(data['email'])
        ).first()
        if existing and existing.id != user.id:
            return jsonify({'error': 'Email already registered'}), 409
        changes['email'] = {'old': user.email, 'new': data['email']}
        user.email = data['email']

    # Update username
    if 'username' in data and data['username'] != user.username:
        existing = User.query.filter_by(username=data['username']).first()
        if existing and existing.id != user.id:
            return jsonify({'error': 'Username already taken'}), 409
        changes['username'] = {'old': user.username, 'new': data['username']}
        user.username = data['username']

    # Update role
    if 'role' in data and data['role'] != user.role:
        if data['role'] not in User.VALID_ROLES:
            return jsonify({'error': f'Invalid role. Must be one of: {", ".join(User.VALID_ROLES)}'}), 400

        # Prevent demoting the last admin
        if user.role == User.ROLE_ADMIN and data['role'] != User.ROLE_ADMIN:
            admin_count = User.query.filter_by(role=User.ROLE_ADMIN).count()
            if admin_count <= 1:
                return jsonify({'error': 'Cannot demote the last admin'}), 400

        changes['role'] = {'old': user.role, 'new': data['role']}
        user.role = data['role']

    # Update password
    if 'password' in data and data['password']:
        if len(data['password']) < 8:
            return jsonify({'error': 'Password must be at least 8 characters'}), 400
        user.set_password(data['password'])
        changes['password'] = 'changed'

    # Update custom permissions (inline with user update)
    if 'permissions' in data and user.role != User.ROLE_ADMIN:
        from app.services.permission_service import PermissionService
        perm_error = PermissionService.validate_permissions(data['permissions'])
        if perm_error:
            return jsonify({'error': perm_error}), 400
        user.set_permissions(data['permissions'])
        changes['permissions'] = 'updated'

    # Update active status
    if 'is_active' in data and data['is_active'] != user.is_active:
        # Prevent deactivating self
        if user.id == current_user_id and not data['is_active']:
            return jsonify({'error': 'Cannot deactivate your own account'}), 400

        changes['is_active'] = {'old': user.is_active, 'new': data['is_active']}
        user.is_active = data['is_active']

        # Log enable/disable separately
        action = AuditLog.ACTION_USER_ENABLE if data['is_active'] else AuditLog.ACTION_USER_DISABLE
        AuditService.log_user_action(
            action=action,
            user_id=current_user_id,
            target_user_id=user.id,
            details={'username': user.username}
        )

    db.session.commit()

    # Log the update
    if changes:
        AuditService.log_user_action(
            action=AuditLog.ACTION_USER_UPDATE,
            user_id=current_user_id,
            target_user_id=user.id,
            details={'changes': changes}
        )
        db.session.commit()

    return jsonify({
        'message': 'User updated successfully',
        'user': user.to_dict()
    }), 200


@admin_bp.route('/users/<int:user_id>', methods=['DELETE'])
@admin_required
def delete_user(user_id):
    """Delete a user."""
    current_user_id = get_jwt_identity()

    user = User.query.get(user_id)
    if not user:
        raise not_found('user')

    # Prevent self-deletion
    if user.id == current_user_id:
        return jsonify({'error': 'Cannot delete your own account'}), 400

    # Prevent deleting the last admin
    if user.role == User.ROLE_ADMIN:
        admin_count = User.query.filter_by(role=User.ROLE_ADMIN).count()
        if admin_count <= 1:
            return jsonify({'error': 'Cannot delete the last admin'}), 400

    # Applications never ride a user delete — see applications_owned_by for
    # why tombstoned rows block too.
    from app.services.application_restore import applications_owned_by
    owned = applications_owned_by(user.id)
    if owned:
        return jsonify({'error': f'This user still owns {owned} service(s), '
                                 'including any in the recycle bin. Delete or '
                                 'purge them first.'}), 409

    username = user.username
    user_id_deleted = user.id

    db.session.delete(user)
    db.session.commit()

    # Log the action
    AuditService.log_user_action(
        action=AuditLog.ACTION_USER_DELETE,
        user_id=current_user_id,
        target_user_id=user_id_deleted,
        details={'username': username}
    )
    db.session.commit()

    return jsonify({'message': 'User deleted successfully'}), 200


# ============================================
# Audit Log Endpoints
# ============================================

@admin_bp.route('/audit-logs', methods=['GET'])
@admin_required
def get_audit_logs():
    """Get audit logs with pagination and filtering."""
    paging = PageQuery.from_request(request)
    action = request.args.get('action')
    user_id = request.args.get('user_id', type=int)
    target_type = request.args.get('target_type')

    pagination = AuditService.get_logs(
        page=paging.page,
        per_page=paging.per_page,
        action=action,
        user_id=user_id,
        target_type=target_type
    )

    return jsonify({
        'logs': [log.to_dict() for log in pagination.items],
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev
        }
    }), 200


@admin_bp.route('/audit-logs/actions', methods=['GET'])
@admin_required
def get_audit_log_actions():
    """Get list of unique action types in audit logs."""
    actions = db.session.query(AuditLog.action).distinct().all()
    return jsonify({
        'actions': [a[0] for a in actions]
    }), 200


# ============================================
# System Settings Endpoints
# ============================================

@admin_bp.route('/settings', methods=['GET'])
@admin_required
def get_settings():
    """Get all system settings."""
    settings = SettingsService.get_all_with_metadata()
    return jsonify({'settings': settings}), 200


@admin_bp.route('/settings', methods=['PUT'])
@admin_required
def update_settings():
    """Update system settings."""
    data = request.get_json()
    current_user_id = get_jwt_identity()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    updated = []
    for key, value in data.items():
        old_value = SettingsService.get(key)
        SettingsService.set(key, value, user_id=current_user_id)
        updated.append(key)

        # Log the change
        AuditService.log_settings_change(
            user_id=current_user_id,
            key=key,
            old_value=old_value,
            new_value=value
        )

    db.session.commit()

    return jsonify({
        'message': 'Settings updated successfully',
        'updated': updated
    }), 200


@admin_bp.route('/settings/<key>', methods=['GET'])
@admin_required
def get_setting(key):
    """Get a specific setting."""
    value = SettingsService.get(key)
    if value is None:
        return jsonify({'error': 'Setting not found'}), 404
    return jsonify({'key': key, 'value': value}), 200


@admin_bp.route('/settings/<key>', methods=['PUT'])
@admin_required
def update_setting(key):
    """Update a specific setting."""
    data = request.get_json()
    current_user_id = get_jwt_identity()

    if 'value' not in data:
        return jsonify({'error': 'No value provided'}), 400

    old_value = SettingsService.get(key)
    SettingsService.set(key, data['value'], user_id=current_user_id)

    # Log the change
    AuditService.log_settings_change(
        user_id=current_user_id,
        key=key,
        old_value=old_value,
        new_value=data['value']
    )
    db.session.commit()

    return jsonify({
        'message': 'Setting updated successfully',
        'key': key,
        'value': data['value']
    }), 200


@admin_bp.route('/settings/domain-detection', methods=['GET'])
@admin_required
def get_domain_detection():
    """Return the domain detected from the current request and current canonical setting."""
    detected_domain, is_https = detect_request_domain(request)
    current_domain = SettingsService.get('canonical_domain', '') or ''
    current_https = bool(SettingsService.get('canonical_https_enabled', False))
    return jsonify({
        'detected_domain': detected_domain,
        'is_https': is_https,
        'current_canonical_domain': current_domain,
        'current_canonical_https_enabled': current_https,
        'current_canonical_origin': canonical_origin(current_domain, current_https) if current_domain else None,
    }), 200


@admin_bp.route('/settings/canonical-domain', methods=['PUT'])
@admin_required
def set_canonical_domain():
    """Persist the canonical panel domain and HTTPS flag."""
    data = request.get_json() or {}
    domain = (data.get('domain') or '').strip().lower()
    https_enabled = bool(data.get('https_enabled', False))
    current_user_id = get_jwt_identity()

    if not domain:
        return jsonify({'error': 'domain is required'}), 400
    if not is_valid_canonical_domain(domain):
        return jsonify({'error': 'domain does not look like a valid canonical domain'}), 400

    old_domain = SettingsService.get('canonical_domain', '') or ''
    SettingsService.set('canonical_domain', domain, user_id=current_user_id)
    SettingsService.set('canonical_https_enabled', https_enabled, user_id=current_user_id)
    db.session.commit()

    AuditService.log_settings_change(
        user_id=current_user_id,
        key='canonical_domain',
        old_value=old_domain,
        new_value=domain
    )
    db.session.commit()

    return jsonify({
        'message': 'Canonical domain updated',
        'domain': domain,
        'https_enabled': https_enabled,
        'origin': canonical_origin(domain, https_enabled),
        'restart_required': True,
    }), 200


# ============================================
# Managed-sites domain & HTTPS (Phase 5)
# ============================================

@admin_bp.route('/sites-https/status', methods=['GET'])
@admin_required
def sites_https_status():
    """Report managed-sites base domain, server IP, providers, and HTTPS state."""
    from app.services.sites_https_service import SitesHttpsService
    return jsonify(SitesHttpsService.status()), 200


@admin_bp.route('/sites-https/setup', methods=['POST'])
@admin_required
def sites_https_setup():
    """Create the wildcard DNS record + issue the wildcard cert for a base domain
    (the default base when ``base`` is omitted)."""
    from app.services.sites_https_service import SitesHttpsService
    data = request.get_json() or {}
    result = SitesHttpsService.setup(data.get('provider_id'), email=data.get('email'),
                                     base=data.get('base') or data.get('domain'))
    return jsonify(result), 200 if result.get('success') else 400


@admin_bp.route('/sites-https/base-domains', methods=['POST'])
@admin_required
def sites_base_domain_add():
    """Register a base domain managed sites can publish under."""
    from app.services.site_base_domain_service import SiteBaseDomainService
    data = request.get_json() or {}
    result = SiteBaseDomainService.add(
        data.get('domain'),
        dns_provider_config_id=data.get('provider_id') or data.get('dns_provider_config_id'),
        dns_mode=data.get('dns_mode') or 'wildcard',
        make_default=bool(data.get('make_default')),
    )
    return jsonify(result), 201 if result.get('success') else 400


@admin_bp.route('/sites-https/base-domains/<path:domain>', methods=['DELETE'])
@admin_required
def sites_base_domain_remove(domain):
    """Unregister a base domain (promotes another to default if it was default)."""
    from app.services.site_base_domain_service import SiteBaseDomainService
    result = SiteBaseDomainService.remove(domain)
    return jsonify(result), 200 if result.get('success') else 404


@admin_bp.route('/sites-https/base-domains/<path:domain>/default', methods=['POST'])
@admin_required
def sites_base_domain_set_default(domain):
    """Make a registered base domain the default for new sites."""
    from app.services.site_base_domain_service import SiteBaseDomainService
    result = SiteBaseDomainService.set_default(domain)
    return jsonify(result), 200 if result.get('success') else 404


@admin_bp.route('/sites-https/base-domains/<path:domain>', methods=['PATCH'])
@admin_required
def sites_base_domain_update(domain):
    """Update a base domain's DNS mode (wildcard | per-site)."""
    from app.services.site_base_domain_service import SiteBaseDomainService
    data = request.get_json() or {}
    result = SiteBaseDomainService.update(domain, dns_mode=data.get('dns_mode'))
    return jsonify(result), 200 if result.get('success') else 404


# ============================================
# Admin Statistics Endpoints
# ============================================

@admin_bp.route('/stats', methods=['GET'])
@admin_required
def get_admin_stats():
    """Get admin statistics."""
    user_count = User.query.count()
    active_users = User.query.filter_by(is_active=True).count()
    admin_count = User.query.filter_by(role=User.ROLE_ADMIN).count()
    developer_count = User.query.filter_by(role=User.ROLE_DEVELOPER).count()
    viewer_count = User.query.filter_by(role=User.ROLE_VIEWER).count()

    # Recent logins
    recent_logins = AuditLog.query.filter_by(
        action=AuditLog.ACTION_LOGIN
    ).order_by(AuditLog.created_at.desc()).limit(10).all()

    return jsonify({
        'users': {
            'total': user_count,
            'active': active_users,
            'by_role': {
                'admin': admin_count,
                'developer': developer_count,
                'viewer': viewer_count
            }
        },
        'recent_logins': [log.to_dict() for log in recent_logins]
    }), 200


# ============================================
# Permission Endpoints
# ============================================

@admin_bp.route('/users/<int:user_id>/permissions', methods=['GET'])
@admin_required
def get_user_permissions(user_id):
    """Get a user's resolved permissions."""
    perms = PermissionService.get_user_permissions(user_id)
    if perms is None:
        raise not_found('user')
    return jsonify({'permissions': perms}), 200


@admin_bp.route('/users/<int:user_id>/permissions', methods=['PUT'])
@admin_required
def update_user_permissions(user_id):
    """Update a user's custom permissions."""
    data = request.get_json()
    current_user_id = get_jwt_identity()

    if not data or 'permissions' not in data:
        return jsonify({'error': 'No permissions provided'}), 400

    result = PermissionService.update_user_permissions(user_id, data['permissions'])
    if not result['success']:
        return jsonify({'error': result['error']}), 400

    AuditService.log_user_action(
        action=AuditLog.ACTION_USER_PERMISSIONS_UPDATE,
        user_id=current_user_id,
        target_user_id=user_id,
        details={'permissions': data['permissions']}
    )
    db.session.commit()

    return jsonify({
        'message': 'Permissions updated',
        'permissions': result['permissions']
    }), 200


@admin_bp.route('/users/<int:user_id>/permissions/reset', methods=['POST'])
@admin_required
def reset_user_permissions(user_id):
    """Reset user permissions to role defaults."""
    current_user_id = get_jwt_identity()

    result = PermissionService.reset_to_role_defaults(user_id)
    if not result['success']:
        return jsonify({'error': result['error']}), 400

    AuditService.log_user_action(
        action=AuditLog.ACTION_USER_PERMISSIONS_RESET,
        user_id=current_user_id,
        target_user_id=user_id,
    )
    db.session.commit()

    return jsonify({
        'message': 'Permissions reset to role defaults',
        'permissions': result['permissions']
    }), 200


@admin_bp.route('/permissions/templates', methods=['GET'])
@admin_required
def get_permission_templates():
    """Get role template definitions and feature list."""
    return jsonify({
        'features': User.PERMISSION_FEATURES,
        'templates': User.ROLE_PERMISSION_TEMPLATES,
    }), 200


# ============================================
# Activity Dashboard Endpoints
# ============================================

def _day_key(value) -> Optional[str]:
    """Normalize whatever the DB returned for a day bucket to 'YYYY-MM-DD'.

    ``func.date()`` is the portable day-bucket expression here, but the two
    supported backends disagree on the Python type that comes back: SQLite
    returns the string 'YYYY-MM-DD', PostgreSQL returns a ``datetime.date``
    (``date(ts)`` is accepted there as function-style cast syntax). Both are
    reduced to the same string so the zero-fill below can key on it.
    """
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.strftime('%Y-%m-%d')
    return str(value)[:10]


def _daily_action_counts(window_start: datetime, days: int,
                         *extra_filters) -> List[Dict]:
    """Per-day audit-log counts over ``days`` days starting at ``window_start``.

    ONE grouped query, then the gaps are filled with zeroes in Python. The
    previous shape issued a separate COUNT per day (90 sequential round-trips
    per series, 180 for the two series this endpoint returns) purely to learn
    that most of those days were empty.

    The zero-fill is what keeps the response byte-identical: the series must
    always have exactly ``days`` entries, in ascending date order, including
    days with no rows at all.
    """
    window_end = window_start + timedelta(days=days)

    # Bucket on the DB side. The range filter is applied once for the whole
    # window instead of once per day.
    day_bucket = func.date(AuditLog.created_at)
    rows = db.session.query(
        day_bucket.label('day'),
        func.count(AuditLog.id),
    ).filter(
        AuditLog.created_at >= window_start,
        AuditLog.created_at < window_end,
        *extra_filters
    ).group_by(day_bucket).all()

    counts: Dict[str, int] = {}
    for day, count in rows:
        key = _day_key(day)
        if key:
            # Accumulate rather than assign: defensive against a backend that
            # could hand back two spellings of the same calendar day.
            counts[key] = counts.get(key, 0) + (count or 0)

    series = []
    for offset in range(days):
        key = (window_start + timedelta(days=offset)).strftime('%Y-%m-%d')
        series.append({'date': key, 'count': counts.get(key, 0)})
    return series


@admin_bp.route('/activity/summary', methods=['GET'])
@admin_required
def get_activity_summary():
    """Get activity summary: active users today, actions this week, top users."""
    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)

    # Active users today (distinct users with audit log entries)
    active_today = db.session.query(
        func.count(func.distinct(AuditLog.user_id))
    ).filter(
        AuditLog.created_at >= today_start,
        AuditLog.user_id.isnot(None)
    ).scalar() or 0

    # Actions this week
    actions_this_week = db.session.query(
        func.count(AuditLog.id)
    ).filter(
        AuditLog.created_at >= week_start
    ).scalar() or 0

    # Total users
    total_users = User.query.filter_by(is_active=True).count()

    # Top 5 most active users this week
    top_users_query = db.session.query(
        AuditLog.user_id,
        func.count(AuditLog.id).label('action_count')
    ).filter(
        AuditLog.created_at >= week_start,
        AuditLog.user_id.isnot(None)
    ).group_by(AuditLog.user_id).order_by(
        func.count(AuditLog.id).desc()
    ).limit(5).all()

    # Resolve the five usernames in one query instead of one SELECT per user.
    ranked_ids = [user_id for user_id, _ in top_users_query]
    usernames = {}
    if ranked_ids:
        usernames = {
            u.id: u.username
            for u in User.query.filter(User.id.in_(ranked_ids)).all()
        }

    top_users = []
    for user_id, count in top_users_query:
        # Preserve the ranked order and the "skip users that no longer exist"
        # behaviour of the previous per-user lookup.
        if user_id in usernames:
            top_users.append({
                'user_id': user_id,
                'username': usernames[user_id],
                'action_count': count
            })

    # Daily action counts for the past 90 days. The window is the 90 days
    # ENDING today (inclusive), so it starts 89 days back.
    days_to_fetch = 90
    window_start = today_start - timedelta(days=days_to_fetch - 1)

    daily_counts = _daily_action_counts(window_start, days_to_fetch)

    # Top user activity (past 90 days)
    top_user_daily = []
    if top_users:
        top_user_id = top_users[0]['user_id']
        top_user_daily = _daily_action_counts(
            window_start, days_to_fetch, AuditLog.user_id == top_user_id
        )

    return jsonify({
        'active_users_today': active_today,
        'actions_this_week': actions_this_week,
        'total_users': total_users,
        'top_users': top_users,
        'daily_counts': daily_counts,
        'top_user_daily': top_user_daily,
    }), 200


@admin_bp.route('/activity/feed', methods=['GET'])
@admin_required
def get_activity_feed():
    """Get paginated activity feed with filters."""
    paging = PageQuery.from_request(request)
    user_id = request.args.get('user_id', type=int)
    action = request.args.get('action')
    target_type = request.args.get('target_type')
    target_id = request.args.get('target_id', type=int)
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    kwargs = {
        'page': paging.page,
        'per_page': paging.per_page,
        'user_id': user_id,
        'action': action,
        'target_type': target_type,
        'target_id': target_id,
    }

    if start_date:
        try:
            kwargs['start_date'] = datetime.fromisoformat(start_date)
        except ValueError:
            pass

    if end_date:
        try:
            kwargs['end_date'] = datetime.fromisoformat(end_date)
        except ValueError:
            pass

    pagination = AuditService.get_logs(**kwargs)

    return jsonify({
        'logs': [log.to_dict() for log in pagination.items],
        'pagination': {
            'page': pagination.page,
            'per_page': pagination.per_page,
            'total': pagination.total,
            'pages': pagination.pages,
            'has_next': pagination.has_next,
            'has_prev': pagination.has_prev
        }
    }), 200
