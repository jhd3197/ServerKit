"""
Notification Service

Handles sending notifications to various channels:
- Discord webhooks
- Slack webhooks
- Telegram bots
- Generic webhooks
- Email (via existing SMTP config)
"""

import os
import json
import requests
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path


class NotificationService:
    """Service for sending notifications to various channels."""

    CONFIG_DIR = '/etc/serverkit'
    NOTIFICATIONS_CONFIG = os.path.join(CONFIG_DIR, 'notifications.json')

    # Severity colors (hex for Discord, named for Slack)
    SEVERITY_COLORS = {
        'critical': {'hex': 0xFF0000, 'slack': 'danger', 'emoji': '🔴'},
        'warning': {'hex': 0xFFA500, 'slack': 'warning', 'emoji': '🟠'},
        'info': {'hex': 0x00BFFF, 'slack': '#00BFFF', 'emoji': '🔵'},
        'success': {'hex': 0x00FF00, 'slack': 'good', 'emoji': '🟢'},
        'test': {'hex': 0x808080, 'slack': '#808080', 'emoji': '⚪'}
    }

    @classmethod
    def get_config(cls) -> Dict:
        """Get notification configuration."""
        if os.path.exists(cls.NOTIFICATIONS_CONFIG):
            try:
                with open(cls.NOTIFICATIONS_CONFIG, 'r') as f:
                    return json.load(f)
            except Exception:
                pass

        return {
            'discord': {
                'enabled': False,
                'webhook_url': '',
                'username': 'ServerKit',
                'avatar_url': '',
                'notify_on': ['critical', 'warning']
            },
            'slack': {
                'enabled': False,
                'webhook_url': '',
                'channel': '',  # Optional override
                'username': 'ServerKit',
                'icon_emoji': ':robot_face:',
                'notify_on': ['critical', 'warning']
            },
            'telegram': {
                'enabled': False,
                'bot_token': '',
                'chat_id': '',
                'notify_on': ['critical', 'warning']
            },
            'generic_webhook': {
                'enabled': False,
                'url': '',
                'headers': {},
                'notify_on': ['critical', 'warning']
            }
        }

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save notification configuration."""
        try:
            os.makedirs(cls.CONFIG_DIR, exist_ok=True)
            with open(cls.NOTIFICATIONS_CONFIG, 'w') as f:
                json.dump(config, f, indent=2)
            return {'success': True, 'message': 'Configuration saved'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def update_channel_config(cls, channel: str, settings: Dict) -> Dict:
        """Update configuration for a specific channel."""
        config = cls.get_config()

        if channel not in config:
            return {'success': False, 'error': f'Unknown channel: {channel}'}

        # Merge settings
        config[channel] = {**config[channel], **settings}

        return cls.save_config(config)

    @classmethod
    def get_hostname(cls) -> str:
        """Get the server hostname."""
        try:
            if hasattr(os, 'uname'):
                return os.uname().nodename
            import socket
            return socket.gethostname()
        except Exception:
            return 'unknown'

    # ==========================================
    # DISCORD
    # ==========================================
    @classmethod
    def send_discord(cls, alerts: List[Dict], config: Dict = None) -> Dict:
        """
        Send notification to Discord webhook.

        Discord webhook format uses embeds for rich formatting.
        """
        if config is None:
            config = cls.get_config().get('discord', {})

        if not config.get('enabled') or not config.get('webhook_url'):
            return {'success': False, 'error': 'Discord not configured'}

        webhook_url = config['webhook_url']

        # Filter alerts by severity
        notify_on = config.get('notify_on', ['critical', 'warning'])
        alerts = [a for a in alerts if a.get('severity', 'info') in notify_on]

        if not alerts:
            return {'success': True, 'message': 'No alerts to send'}

        try:
            # Build embeds for each alert
            embeds = []
            for alert in alerts[:10]:  # Discord limit: 10 embeds per message
                severity = alert.get('severity', 'info')
                color_info = cls.SEVERITY_COLORS.get(severity, cls.SEVERITY_COLORS['info'])

                embed = {
                    'title': f"{color_info['emoji']} {severity.upper()}: {alert.get('type', 'Alert').upper()}",
                    'description': alert.get('message', 'No message'),
                    'color': color_info['hex'],
                    'timestamp': datetime.utcnow().isoformat() + 'Z',
                    'footer': {
                        'text': f"ServerKit • {cls.get_hostname()}"
                    }
                }

                # Add fields if available
                fields = []
                if 'value' in alert:
                    fields.append({
                        'name': 'Current Value',
                        'value': str(alert['value']),
                        'inline': True
                    })
                if 'threshold' in alert:
                    fields.append({
                        'name': 'Threshold',
                        'value': str(alert['threshold']),
                        'inline': True
                    })

                if fields:
                    embed['fields'] = fields

                embeds.append(embed)

            payload = {
                'username': config.get('username', 'ServerKit'),
                'embeds': embeds
            }

            if config.get('avatar_url'):
                payload['avatar_url'] = config['avatar_url']

            response = requests.post(
                webhook_url,
                json=payload,
                timeout=10
            )

            if response.status_code in [200, 204]:
                return {'success': True, 'message': 'Discord notification sent'}

            return {
                'success': False,
                'error': f'Discord returned {response.status_code}: {response.text[:200]}'
            }

        except requests.exceptions.Timeout:
            return {'success': False, 'error': 'Discord webhook timeout'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==========================================
    # SLACK
    # ==========================================
    @classmethod
    def send_slack(cls, alerts: List[Dict], config: Dict = None) -> Dict:
        """
        Send notification to Slack webhook.

        Slack uses Block Kit for rich formatting.
        """
        if config is None:
            config = cls.get_config().get('slack', {})

        if not config.get('enabled') or not config.get('webhook_url'):
            return {'success': False, 'error': 'Slack not configured'}

        webhook_url = config['webhook_url']

        # Filter alerts by severity
        notify_on = config.get('notify_on', ['critical', 'warning'])
        alerts = [a for a in alerts if a.get('severity', 'info') in notify_on]

        if not alerts:
            return {'success': True, 'message': 'No alerts to send'}

        try:
            # Build attachments for each alert
            attachments = []
            for alert in alerts[:20]:  # Slack limit
                severity = alert.get('severity', 'info')
                color_info = cls.SEVERITY_COLORS.get(severity, cls.SEVERITY_COLORS['info'])

                attachment = {
                    'color': color_info['slack'],
                    'blocks': [
                        {
                            'type': 'section',
                            'text': {
                                'type': 'mrkdwn',
                                'text': f"*{color_info['emoji']} {severity.upper()}: {alert.get('type', 'Alert').upper()}*\n{alert.get('message', 'No message')}"
                            }
                        }
                    ]
                }

                # Add fields if available
                fields = []
                if 'value' in alert:
                    fields.append({
                        'type': 'mrkdwn',
                        'text': f"*Current:* {alert['value']}"
                    })
                if 'threshold' in alert:
                    fields.append({
                        'type': 'mrkdwn',
                        'text': f"*Threshold:* {alert['threshold']}"
                    })

                if fields:
                    attachment['blocks'].append({
                        'type': 'section',
                        'fields': fields
                    })

                # Add timestamp
                attachment['blocks'].append({
                    'type': 'context',
                    'elements': [
                        {
                            'type': 'mrkdwn',
                            'text': f"ServerKit • {cls.get_hostname()} • <!date^{int(datetime.now().timestamp())}^{{date_short}} {{time}}|{datetime.now().isoformat()}>"
                        }
                    ]
                })

                attachments.append(attachment)

            payload = {
                'username': config.get('username', 'ServerKit'),
                'icon_emoji': config.get('icon_emoji', ':robot_face:'),
                'attachments': attachments
            }

            if config.get('channel'):
                payload['channel'] = config['channel']

            response = requests.post(
                webhook_url,
                json=payload,
                timeout=10
            )

            if response.status_code == 200 and response.text == 'ok':
                return {'success': True, 'message': 'Slack notification sent'}

            return {
                'success': False,
                'error': f'Slack returned: {response.text[:200]}'
            }

        except requests.exceptions.Timeout:
            return {'success': False, 'error': 'Slack webhook timeout'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==========================================
    # TELEGRAM
    # ==========================================
    @classmethod
    def send_telegram(cls, alerts: List[Dict], config: Dict = None) -> Dict:
        """
        Send notification to Telegram bot.

        Uses Telegram Bot API with HTML formatting.
        """
        if config is None:
            config = cls.get_config().get('telegram', {})

        if not config.get('enabled') or not config.get('bot_token') or not config.get('chat_id'):
            return {'success': False, 'error': 'Telegram not configured'}

        bot_token = config['bot_token']
        chat_id = config['chat_id']

        # Filter alerts by severity
        notify_on = config.get('notify_on', ['critical', 'warning'])
        alerts = [a for a in alerts if a.get('severity', 'info') in notify_on]

        if not alerts:
            return {'success': True, 'message': 'No alerts to send'}

        try:
            # Build message
            lines = [f"<b>🔔 ServerKit Alert</b>", f"<i>Host: {cls.get_hostname()}</i>", ""]

            for alert in alerts:
                severity = alert.get('severity', 'info')
                color_info = cls.SEVERITY_COLORS.get(severity, cls.SEVERITY_COLORS['info'])

                lines.append(f"{color_info['emoji']} <b>{severity.upper()}: {alert.get('type', 'Alert').upper()}</b>")
                lines.append(alert.get('message', 'No message'))

                if 'value' in alert or 'threshold' in alert:
                    details = []
                    if 'value' in alert:
                        details.append(f"Current: {alert['value']}")
                    if 'threshold' in alert:
                        details.append(f"Threshold: {alert['threshold']}")
                    lines.append(f"<code>{' | '.join(details)}</code>")

                lines.append("")

            lines.append(f"<i>{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</i>")

            message = "\n".join(lines)

            url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
            payload = {
                'chat_id': chat_id,
                'text': message,
                'parse_mode': 'HTML',
                'disable_web_page_preview': True
            }

            response = requests.post(url, json=payload, timeout=10)
            result = response.json()

            if result.get('ok'):
                return {'success': True, 'message': 'Telegram notification sent'}

            return {
                'success': False,
                'error': result.get('description', 'Unknown error')
            }

        except requests.exceptions.Timeout:
            return {'success': False, 'error': 'Telegram API timeout'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==========================================
    # GENERIC WEBHOOK
    # ==========================================
    @classmethod
    def send_generic_webhook(cls, alerts: List[Dict], config: Dict = None) -> Dict:
        """
        Send notification to a generic webhook URL.

        Sends a JSON payload with alert data.
        """
        if config is None:
            config = cls.get_config().get('generic_webhook', {})

        if not config.get('enabled') or not config.get('url'):
            return {'success': False, 'error': 'Generic webhook not configured'}

        webhook_url = config['url']

        # Filter alerts by severity
        notify_on = config.get('notify_on', ['critical', 'warning'])
        alerts = [a for a in alerts if a.get('severity', 'info') in notify_on]

        if not alerts:
            return {'success': True, 'message': 'No alerts to send'}

        try:
            payload = {
                'source': 'serverkit',
                'hostname': cls.get_hostname(),
                'timestamp': datetime.utcnow().isoformat() + 'Z',
                'alerts': alerts
            }

            headers = {'Content-Type': 'application/json'}
            headers.update(config.get('headers', {}))

            response = requests.post(
                webhook_url,
                json=payload,
                headers=headers,
                timeout=10
            )

            if response.ok:
                return {'success': True, 'message': 'Webhook notification sent'}

            return {
                'success': False,
                'error': f'Webhook returned {response.status_code}'
            }

        except requests.exceptions.Timeout:
            return {'success': False, 'error': 'Webhook timeout'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ==========================================
    # SEND TO ALL CONFIGURED CHANNELS
    # ==========================================
    @classmethod
    def send_all(cls, alerts: List[Dict]) -> Dict:
        """
        Send alerts to all configured notification channels.

        Returns results for each channel.
        """
        config = cls.get_config()
        results = {}

        if config.get('discord', {}).get('enabled'):
            results['discord'] = cls.send_discord(alerts, config['discord'])

        if config.get('slack', {}).get('enabled'):
            results['slack'] = cls.send_slack(alerts, config['slack'])

        if config.get('telegram', {}).get('enabled'):
            results['telegram'] = cls.send_telegram(alerts, config['telegram'])

        if config.get('generic_webhook', {}).get('enabled'):
            results['generic_webhook'] = cls.send_generic_webhook(alerts, config['generic_webhook'])

        return {
            'success': all(r.get('success', False) for r in results.values()) if results else True,
            'results': results
        }

    # ==========================================
    # TEST NOTIFICATIONS
    # ==========================================
    @classmethod
    def send_test(cls, channel: str) -> Dict:
        """Send a test notification to a specific channel."""
        test_alerts = [{
            'type': 'test',
            'severity': 'test',
            'message': 'This is a test notification from ServerKit. If you received this, your notifications are working correctly!',
            'value': 'N/A',
            'threshold': 'N/A'
        }]

        # For tests, include all severities temporarily
        config = cls.get_config()

        if channel == 'discord':
            test_config = {**config.get('discord', {}), 'notify_on': ['test']}
            return cls.send_discord(test_alerts, test_config)
        elif channel == 'slack':
            test_config = {**config.get('slack', {}), 'notify_on': ['test']}
            return cls.send_slack(test_alerts, test_config)
        elif channel == 'telegram':
            test_config = {**config.get('telegram', {}), 'notify_on': ['test']}
            return cls.send_telegram(test_alerts, test_config)
        elif channel == 'generic_webhook':
            test_config = {**config.get('generic_webhook', {}), 'notify_on': ['test']}
            return cls.send_generic_webhook(test_alerts, test_config)
        else:
            return {'success': False, 'error': f'Unknown channel: {channel}'}

    # ==========================================
    # STATUS
    # ==========================================
    @classmethod
    def get_status(cls) -> Dict:
        """Get notification configuration status."""
        config = cls.get_config()

        return {
            'discord': {
                'enabled': config.get('discord', {}).get('enabled', False),
                'configured': bool(config.get('discord', {}).get('webhook_url')),
                'notify_on': config.get('discord', {}).get('notify_on', [])
            },
            'slack': {
                'enabled': config.get('slack', {}).get('enabled', False),
                'configured': bool(config.get('slack', {}).get('webhook_url')),
                'notify_on': config.get('slack', {}).get('notify_on', [])
            },
            'telegram': {
                'enabled': config.get('telegram', {}).get('enabled', False),
                'configured': bool(config.get('telegram', {}).get('bot_token') and config.get('telegram', {}).get('chat_id')),
                'notify_on': config.get('telegram', {}).get('notify_on', [])
            },
            'generic_webhook': {
                'enabled': config.get('generic_webhook', {}).get('enabled', False),
                'configured': bool(config.get('generic_webhook', {}).get('url')),
                'notify_on': config.get('generic_webhook', {}).get('notify_on', [])
            }
        }
