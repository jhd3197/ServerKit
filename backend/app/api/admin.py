"""Admin API endpoints for user management, settings, and audit logs."""
from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_jwt_extended import get_jwt_identity
from app import db
from app.models import User, AuditLog
from app.middleware.rbac import admin_required, get_current_user
from app.services.audit_service import AuditService
from app.services.settings_service import SettingsService

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

    if User.query.filter_by(email=email).first():
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
        return jsonify({'error': 'User not found'}), 404

    return jsonify({'user': user.to_dict()}), 200


@admin_bp.route('/users/<int:user_id>', methods=['PUT'])
@admin_required
def update_user(user_id):
    """Update a user."""
    data = request.get_json()
    current_user_id = get_jwt_identity()

    user = User.query.get(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    changes = {}

    # Update email
    if 'email' in data and data['email'] != user.email:
        existing = User.query.filter_by(email=data['email']).first()
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
        return jsonify({'error': 'User not found'}), 404

    # Prevent self-deletion
    if user.id == current_user_id:
        return jsonify({'error': 'Cannot delete your own account'}), 400

    # Prevent deleting the last admin
    if user.role == User.ROLE_ADMIN:
        admin_count = User.query.filter_by(role=User.ROLE_ADMIN).count()
        if admin_count <= 1:
            return jsonify({'error': 'Cannot delete the last admin'}), 400

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
    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    action = request.args.get('action')
    user_id = request.args.get('user_id', type=int)
    target_type = request.args.get('target_type')

    # Limit per_page to reasonable values
    per_page = min(per_page, 100)

    pagination = AuditService.get_logs(
        page=page,
        per_page=per_page,
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
