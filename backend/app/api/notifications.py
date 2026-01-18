from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app.models import User, NotificationPreferences
from app import db
from app.services.notification_service import NotificationService

notifications_bp = Blueprint('notifications', __name__)


def admin_required(fn):
    """Decorator to require admin role."""
    from functools import wraps

    @wraps(fn)
    def wrapper(*args, **kwargs):
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        if not user or user.role != 'admin':
            return jsonify({'error': 'Admin access required'}), 403
        return fn(*args, **kwargs)
    return wrapper


@notifications_bp.route('/status', methods=['GET'])
@jwt_required()
def get_status():
    """Get notification channels status."""
    status = NotificationService.get_status()
    return jsonify(status), 200


@notifications_bp.route('/config', methods=['GET'])
@jwt_required()
@admin_required
def get_config():
    """Get notification configuration."""
    config = NotificationService.get_config()

    # Mask sensitive data
    if 'discord' in config and config['discord'].get('webhook_url'):
        url = config['discord']['webhook_url']
        config['discord']['webhook_url'] = url[:30] + '...' if len(url) > 30 else url

    if 'slack' in config and config['slack'].get('webhook_url'):
        url = config['slack']['webhook_url']
        config['slack']['webhook_url'] = url[:30] + '...' if len(url) > 30 else url

    if 'telegram' in config and config['telegram'].get('bot_token'):
        config['telegram']['bot_token'] = '***'

    if 'generic_webhook' in config and config['generic_webhook'].get('url'):
        url = config['generic_webhook']['url']
        config['generic_webhook']['url'] = url[:30] + '...' if len(url) > 30 else url

    if 'email' in config:
        if config['email'].get('smtp_password'):
            config['email']['smtp_password'] = '***'

    return jsonify(config), 200


@notifications_bp.route('/config/<channel>', methods=['PUT'])
@jwt_required()
@admin_required
def update_channel_config(channel):
    """Update configuration for a specific notification channel."""
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    valid_channels = ['discord', 'slack', 'telegram', 'email', 'generic_webhook']
    if channel not in valid_channels:
        return jsonify({'error': f'Invalid channel. Valid options: {valid_channels}'}), 400

    # Get current config to preserve masked values
    current_config = NotificationService.get_config()

    # Handle masked sensitive values
    if channel == 'discord':
        if data.get('webhook_url') and '...' in data.get('webhook_url', ''):
            data['webhook_url'] = current_config.get('discord', {}).get('webhook_url', '')

    elif channel == 'slack':
        if data.get('webhook_url') and '...' in data.get('webhook_url', ''):
            data['webhook_url'] = current_config.get('slack', {}).get('webhook_url', '')

    elif channel == 'telegram':
        if data.get('bot_token') == '***':
            data['bot_token'] = current_config.get('telegram', {}).get('bot_token', '')

    elif channel == 'email':
        if data.get('smtp_password') == '***':
            data['smtp_password'] = current_config.get('email', {}).get('smtp_password', '')

    elif channel == 'generic_webhook':
        if data.get('url') and '...' in data.get('url', ''):
            data['url'] = current_config.get('generic_webhook', {}).get('url', '')

    result = NotificationService.update_channel_config(channel, data)
    return jsonify(result), 200 if result['success'] else 400


@notifications_bp.route('/test/<channel>', methods=['POST'])
@jwt_required()
@admin_required
def test_channel(channel):
    """Send a test notification to a specific channel."""
    valid_channels = ['discord', 'slack', 'telegram', 'email', 'generic_webhook']
    if channel not in valid_channels:
        return jsonify({'error': f'Invalid channel. Valid options: {valid_channels}'}), 400

    result = NotificationService.send_test(channel)
    return jsonify(result), 200 if result['success'] else 400


@notifications_bp.route('/test', methods=['POST'])
@jwt_required()
@admin_required
def test_all_channels():
    """Send a test notification to all enabled channels."""
    test_alerts = [{
        'type': 'test',
        'severity': 'test',
        'message': 'This is a test notification from ServerKit. All channels are working correctly!',
        'value': 'N/A',
        'threshold': 'N/A'
    }]

    # Temporarily enable test severity for all channels
    config = NotificationService.get_config()
    results = {}

    for channel in ['discord', 'slack', 'telegram', 'email', 'generic_webhook']:
        channel_config = config.get(channel, {})
        if channel_config.get('enabled'):
            test_config = {**channel_config, 'notify_on': ['test']}

            if channel == 'discord':
                results[channel] = NotificationService.send_discord(test_alerts, test_config)
            elif channel == 'slack':
                results[channel] = NotificationService.send_slack(test_alerts, test_config)
            elif channel == 'telegram':
                results[channel] = NotificationService.send_telegram(test_alerts, test_config)
            elif channel == 'email':
                results[channel] = NotificationService.send_email(test_alerts, test_config)
            elif channel == 'generic_webhook':
                results[channel] = NotificationService.send_generic_webhook(test_alerts, test_config)

    if not results:
        return jsonify({'success': False, 'error': 'No channels enabled'}), 400

    all_success = all(r.get('success', False) for r in results.values())
    return jsonify({
        'success': all_success,
        'results': results
    }), 200 if all_success else 207  # 207 Multi-Status for partial success


# ==========================================
# USER NOTIFICATION PREFERENCES
# ==========================================

@notifications_bp.route('/preferences', methods=['GET'])
@jwt_required()
def get_user_preferences():
    """Get current user's notification preferences."""
    current_user_id = get_jwt_identity()
    prefs = NotificationPreferences.get_or_create(current_user_id)
    return jsonify(prefs.to_dict()), 200


@notifications_bp.route('/preferences', methods=['PUT'])
@jwt_required()
def update_user_preferences():
    """Update current user's notification preferences."""
    current_user_id = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    prefs = NotificationPreferences.get_or_create(current_user_id)

    # Update fields
    if 'enabled' in data:
        prefs.enabled = data['enabled']

    if 'channels' in data:
        valid_channels = ['email', 'discord', 'slack', 'telegram']
        channels = [c for c in data['channels'] if c in valid_channels]
        prefs.set_channels(channels)

    if 'severities' in data:
        valid_severities = ['critical', 'warning', 'info', 'success']
        severities = [s for s in data['severities'] if s in valid_severities]
        prefs.set_severities(severities)

    if 'email' in data:
        prefs.email = data['email'] if data['email'] else None

    if 'discord_webhook' in data:
        # Don't update if it's the masked version
        if data['discord_webhook'] and '...' not in data['discord_webhook']:
            prefs.discord_webhook = data['discord_webhook']
        elif not data['discord_webhook']:
            prefs.discord_webhook = None

    if 'telegram_chat_id' in data:
        prefs.telegram_chat_id = data['telegram_chat_id'] if data['telegram_chat_id'] else None

    if 'categories' in data:
        prefs.set_categories(data['categories'])

    if 'quiet_hours' in data:
        qh = data['quiet_hours']
        if 'enabled' in qh:
            prefs.quiet_hours_enabled = qh['enabled']
        if 'start' in qh:
            prefs.quiet_hours_start = qh['start']
        if 'end' in qh:
            prefs.quiet_hours_end = qh['end']

    try:
        db.session.commit()
        return jsonify({'success': True, 'preferences': prefs.to_dict()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@notifications_bp.route('/preferences/test', methods=['POST'])
@jwt_required()
def test_user_notification():
    """Send a test notification to the current user's configured channels."""
    current_user_id = get_jwt_identity()
    prefs = NotificationPreferences.get_or_create(current_user_id)
    user = User.query.get(current_user_id)

    if not prefs.enabled:
        return jsonify({'error': 'Notifications are disabled for your account'}), 400

    test_alert = {
        'type': 'test',
        'severity': 'test',
        'message': f'This is a test notification for {user.username}. Your personal notification settings are working correctly!',
        'value': 'N/A',
        'threshold': 'N/A'
    }

    results = {}
    channels = prefs.get_channels()
    config = NotificationService.get_config()

    # Send to each enabled channel
    if 'email' in channels:
        email_to_use = prefs.email or user.email
        if email_to_use:
            email_config = {
                **config.get('email', {}),
                'to_emails': [email_to_use],
                'notify_on': ['test']
            }
            results['email'] = NotificationService.send_email([test_alert], email_config)

    if 'discord' in channels and prefs.discord_webhook:
        discord_config = {
            'enabled': True,
            'webhook_url': prefs.discord_webhook,
            'username': 'ServerKit',
            'notify_on': ['test']
        }
        results['discord'] = NotificationService.send_discord([test_alert], discord_config)

    if 'telegram' in channels and prefs.telegram_chat_id:
        telegram_config = {
            **config.get('telegram', {}),
            'chat_id': prefs.telegram_chat_id,
            'notify_on': ['test']
        }
        results['telegram'] = NotificationService.send_telegram([test_alert], telegram_config)

    if 'slack' in channels:
        # Use global slack config for user notifications
        slack_config = {**config.get('slack', {}), 'notify_on': ['test']}
        if slack_config.get('enabled') and slack_config.get('webhook_url'):
            results['slack'] = NotificationService.send_slack([test_alert], slack_config)

    if not results:
        return jsonify({'error': 'No channels configured for notifications'}), 400

    all_success = all(r.get('success', False) for r in results.values())
    return jsonify({
        'success': all_success,
        'results': results
    }), 200 if all_success else 207
