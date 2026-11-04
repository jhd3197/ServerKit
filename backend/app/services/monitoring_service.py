import os
import json
import logging
import psutil
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from pathlib import Path
import threading
import time

from flask import current_app

logger = logging.getLogger(__name__)

from .notification_service import NotificationService
from app import paths
from app.utils.config_store import load_json_config, save_json_config
from app.services.telemetry_service import TelemetryService


class MonitoringService:
    """Service for system monitoring and alerts."""

    CONFIG_DIR = paths.SERVERKIT_CONFIG_DIR
    ALERTS_CONFIG = os.path.join(CONFIG_DIR, 'alerts.json')
    ALERTS_LOG = os.path.join(paths.SERVERKIT_LOG_DIR, 'alerts.log')

    # Default thresholds
    DEFAULT_THRESHOLDS = {
        'cpu_percent': 80,
        'memory_percent': 85,
        'disk_percent': 90,
        'load_average': 5.0
    }

    # Alert cooldown (don't send same alert within this period)
    ALERT_COOLDOWN = 300  # 5 minutes

    _last_alerts = {}
    _monitoring_thread = None
    _stop_monitoring = False

    @classmethod
    def get_config(cls) -> Dict:
        """Get monitoring configuration."""
        return load_json_config(cls.ALERTS_CONFIG, {
            'enabled': False,
            'thresholds': cls.DEFAULT_THRESHOLDS.copy(),
            'email': {
                'enabled': False,
                'smtp_host': '',
                'smtp_port': 587,
                'smtp_user': '',
                'smtp_password': '',
                'from_email': '',
                'to_emails': []
            },
            'webhook': {
                'enabled': False,
                'url': ''
            },
            'check_interval': 60  # seconds
        })

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save monitoring configuration."""
        return save_json_config(cls.ALERTS_CONFIG, config)

    @classmethod
    def get_thresholds(cls) -> Dict:
        """Get current alert thresholds."""
        config = cls.get_config()
        return config.get('thresholds', cls.DEFAULT_THRESHOLDS)

    @classmethod
    def set_thresholds(cls, thresholds: Dict) -> Dict:
        """Set alert thresholds."""
        config = cls.get_config()
        config['thresholds'] = {**config.get('thresholds', {}), **thresholds}
        return cls.save_config(config)

    @classmethod
    def get_current_metrics(cls) -> Dict:
        """Get current system metrics."""
        cpu_percent = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/')

        try:
            load_avg = os.getloadavg()
        except (OSError, AttributeError):
            # Not determinable on this platform — None, never a fake zero load.
            load_avg = (None, None, None)

        return {
            'timestamp': datetime.now().isoformat(),
            'cpu': {
                'percent': cpu_percent,
                'cores': psutil.cpu_count()
            },
            'memory': {
                'percent': memory.percent,
                'used': memory.used,
                'total': memory.total,
                'available': memory.available
            },
            'disk': {
                'percent': disk.percent,
                'used': disk.used,
                'total': disk.total,
                'free': disk.free
            },
            'load_average': {
                '1min': load_avg[0],
                '5min': load_avg[1],
                '15min': load_avg[2]
            }
        }

    @classmethod
    def check_thresholds(cls) -> List[Dict]:
        """Check if any thresholds are exceeded."""
        metrics = cls.get_current_metrics()
        thresholds = cls.get_thresholds()
        alerts = []

        # CPU check
        if metrics['cpu']['percent'] > thresholds.get('cpu_percent', 80):
            alerts.append({
                'type': 'cpu',
                'severity': 'warning' if metrics['cpu']['percent'] < 95 else 'critical',
                'message': f"CPU usage at {metrics['cpu']['percent']}% (threshold: {thresholds['cpu_percent']}%)",
                'value': metrics['cpu']['percent'],
                'threshold': thresholds['cpu_percent']
            })

        # Memory check
        if metrics['memory']['percent'] > thresholds.get('memory_percent', 85):
            alerts.append({
                'type': 'memory',
                'severity': 'warning' if metrics['memory']['percent'] < 95 else 'critical',
                'message': f"Memory usage at {metrics['memory']['percent']}% (threshold: {thresholds['memory_percent']}%)",
                'value': metrics['memory']['percent'],
                'threshold': thresholds['memory_percent']
            })

        # Disk check
        if metrics['disk']['percent'] > thresholds.get('disk_percent', 90):
            alerts.append({
                'type': 'disk',
                'severity': 'warning' if metrics['disk']['percent'] < 95 else 'critical',
                'message': f"Disk usage at {metrics['disk']['percent']}% (threshold: {thresholds['disk_percent']}%)",
                'value': metrics['disk']['percent'],
                'threshold': thresholds['disk_percent']
            })

        # Load average check — skipped entirely when load could not be
        # determined on this platform (None), not silently compared as 0.
        load_1min = metrics['load_average']['1min']
        if load_1min is not None and load_1min > thresholds.get('load_average', 5.0):
            alerts.append({
                'type': 'load',
                'severity': 'warning',
                'message': f"Load average at {load_1min:.2f} (threshold: {thresholds['load_average']})",
                'value': load_1min,
                'threshold': thresholds['load_average']
            })

        return alerts

    @classmethod
    def send_email_alert(cls, alerts: List[Dict]) -> Dict:
        """Send email alert notification."""
        config = cls.get_config()
        email_config = config.get('email', {})

        if not email_config.get('enabled') or not email_config.get('to_emails'):
            return {'success': False, 'error': 'Email alerts not configured'}

        try:
            # Build email content
            subject = f"[ServerKit Alert] {len(alerts)} alert(s) triggered"

            body = "The following alerts have been triggered:\n\n"
            for alert in alerts:
                body += f"• [{alert['severity'].upper()}] {alert['message']}\n"
            body += f"\nTimestamp: {datetime.now().isoformat()}"
            body += f"\nHostname: {os.uname().nodename if hasattr(os, 'uname') else 'unknown'}"

            # Create message
            msg = MIMEMultipart()
            msg['From'] = email_config['from_email']
            msg['To'] = ', '.join(email_config['to_emails'])
            msg['Subject'] = subject
            msg.attach(MIMEText(body, 'plain'))

            # Send email
            with smtplib.SMTP(email_config['smtp_host'], email_config['smtp_port'],
                              timeout=30) as server:
                server.starttls()
                if email_config.get('smtp_user') and email_config.get('smtp_password'):
                    server.login(email_config['smtp_user'], email_config['smtp_password'])
                server.send_message(msg)

            return {'success': True, 'message': 'Email sent'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def send_webhook_alert(cls, alerts: List[Dict]) -> Dict:
        """Send webhook alert notification."""
        from app.utils import safe_http

        config = cls.get_config()
        webhook_config = config.get('webhook', {})

        if not webhook_config.get('enabled') or not webhook_config.get('url'):
            return {'success': False, 'error': 'Webhook not configured'}

        try:
            payload = {
                'source': 'serverkit',
                'timestamp': datetime.now().isoformat(),
                'alerts': alerts
            }

            response = safe_http.post(
                webhook_config['url'],
                json=payload,
                timeout=10
            )

            if response.ok:
                return {'success': True, 'message': 'Webhook sent'}
            return {'success': False, 'error': f'Webhook returned {response.status_code}'}

        except safe_http.UnsafeURLError as e:
            return {'success': False, 'error': f'Webhook URL refused: {e}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def process_alerts(cls, alerts: List[Dict]) -> None:
        """Process and send alerts (with cooldown)."""
        if not alerts:
            return

        config = cls.get_config()
        now = datetime.now()

        # Filter alerts by cooldown
        alerts_to_send = []
        for alert in alerts:
            alert_key = f"{alert['type']}_{alert['severity']}"
            last_sent = cls._last_alerts.get(alert_key)

            if not last_sent or (now - last_sent).total_seconds() > cls.ALERT_COOLDOWN:
                alerts_to_send.append(alert)
                cls._last_alerts[alert_key] = now

        if not alerts_to_send:
            return

        # Log alerts
        cls.log_alert(alerts_to_send)

        # Send email notifications
        if config.get('email', {}).get('enabled'):
            cls.send_email_alert(alerts_to_send)

        # Send legacy webhook (for backwards compatibility)
        if config.get('webhook', {}).get('enabled'):
            cls.send_webhook_alert(alerts_to_send)

        # Send to all configured notification channels (Discord, Slack, Telegram, etc.)
        NotificationService.send_all(alerts_to_send)

        # Emit unified telemetry events for each alert
        for alert in alerts_to_send:
            alert_key = f"{alert['type']}_{alert['severity']}"
            TelemetryService.emit(
                source='monitoring',
                event_type='monitoring.threshold_breached',
                message=f"{alert['type'].upper()} alert: {alert.get('message', '')}",
                severity=alert.get('severity', 'warning'),
                resource_type='server',
                correlation_id=alert_key,
                payload={
                    'alert_type': alert.get('type'),
                    'value': alert.get('value'),
                    'threshold': alert.get('threshold'),
                    'severity': alert.get('severity'),
                },
                commit=True,
            )

        # Emit panel events so Automations (tramo) workflows can trigger on a
        # high-CPU/memory alert through the events bridge (ported
        # from the retired Workflow Builder's 'high_cpu'/'high_memory').
        try:
            from app.services.event_service import EventService
            for alert in alerts_to_send:
                if alert['type'] == 'cpu':
                    EventService.emit('monitor.high_cpu', {
                        'event': 'monitor.high_cpu',
                        'percent': alert.get('value'),
                        'threshold': alert.get('threshold'),
                        'severity': alert.get('severity'),
                    })
                elif alert['type'] == 'memory':
                    EventService.emit('monitor.high_memory', {
                        'event': 'monitor.high_memory',
                        'percent': alert.get('value'),
                        'threshold': alert.get('threshold'),
                        'severity': alert.get('severity'),
                    })
        except Exception:
            logger.exception("Error emitting monitor events for alerts")

    @classmethod
    def log_alert(cls, alerts: List[Dict]) -> None:
        """Log alerts to file."""
        try:
            log_dir = os.path.dirname(cls.ALERTS_LOG)
            os.makedirs(log_dir, exist_ok=True)

            with open(cls.ALERTS_LOG, 'a') as f:
                for alert in alerts:
                    entry = {
                        'timestamp': datetime.now().isoformat(),
                        **alert
                    }
                    f.write(json.dumps(entry) + '\n')
        except Exception:
            pass

    @classmethod
    def get_alert_history(cls, limit: int = 100) -> List[Dict]:
        """Get recent alert history."""
        alerts = []

        if not os.path.exists(cls.ALERTS_LOG):
            return alerts

        try:
            with open(cls.ALERTS_LOG, 'r') as f:
                lines = f.readlines()

            for line in lines[-limit:]:
                try:
                    alerts.append(json.loads(line.strip()))
                except json.JSONDecodeError:
                    pass

            alerts.reverse()  # Most recent first

        except Exception:
            pass

        return alerts

    @classmethod
    def clear_alert_history(cls) -> Dict:
        """Clear alert history."""
        try:
            if os.path.exists(cls.ALERTS_LOG):
                os.remove(cls.ALERTS_LOG)
            return {'success': True, 'message': 'Alert history cleared'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def start_monitoring(cls, app=None) -> Dict:
        """Start background monitoring."""
        if cls._monitoring_thread and cls._monitoring_thread.is_alive():
            return {'success': False, 'error': 'Monitoring already running'}

        config = cls.get_config()
        config['enabled'] = True
        cls.save_config(config)

        cls._stop_monitoring = False
        cls._monitoring_thread = threading.Thread(
            target=cls._monitor_loop, args=(app or current_app._get_current_object(),),
            daemon=True)
        cls._monitoring_thread.start()

        return {'success': True, 'message': 'Monitoring started'}

    @classmethod
    def resume_if_enabled(cls, app) -> None:
        """Restart the loop at boot when the operator left monitoring on."""
        if cls.get_config().get('enabled'):
            cls.start_monitoring(app)

    @classmethod
    def stop_monitoring(cls) -> Dict:
        """Stop background monitoring."""
        config = cls.get_config()
        config['enabled'] = False
        cls.save_config(config)

        cls._stop_monitoring = True

        return {'success': True, 'message': 'Monitoring stopped'}

    @classmethod
    def _monitor_loop(cls, app) -> None:
        """Background monitoring loop."""
        while not cls._stop_monitoring:
            config = cls.get_config()
            if not config.get('enabled'):
                break

            try:
                with app.app_context():
                    alerts = cls.check_thresholds()
                    cls.process_alerts(alerts)
            except Exception:
                logger.exception('Monitoring check failed')

            time.sleep(config.get('check_interval', 60))

    @classmethod
    def get_status(cls) -> Dict:
        """Get monitoring status."""
        config = cls.get_config()
        metrics = cls.get_current_metrics()
        alerts = cls.check_thresholds()
        notification_status = NotificationService.get_status()

        return {
            'enabled': config.get('enabled', False),
            'thresholds': config.get('thresholds', cls.DEFAULT_THRESHOLDS),
            'check_interval': config.get('check_interval', 60),
            'email_enabled': config.get('email', {}).get('enabled', False),
            'webhook_enabled': config.get('webhook', {}).get('enabled', False),
            'notifications': notification_status,
            'current_metrics': metrics,
            'active_alerts': alerts
        }
