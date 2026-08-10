"""Organization-level chat / webhook connections (plan 24 Phase 4).

The write + delivery half of :class:`app.models.chat_webhook.ChatWebhookConnection`
— a shared Discord/Slack/Telegram room or a generic signed webhook that receives
every notification matching its category filter. This replaces the legacy global
``notifications.json`` chat config (which a one-time :meth:`import_legacy` folds
into connections).

Credentials are Fernet-encrypted per field before they touch the DB and only
decrypted at send/test time. The Notification Bus fans a preference-driven
notification out to every active, category-matched connection as a
``recipient_user_id IS NULL`` (org-level) NotificationDelivery whose target is
``conn:<id>``; the chat channel adapter routes those back here for delivery.
"""
import hashlib
import hmac
import json
import logging
from datetime import datetime

import requests

from app import db
from app.models.chat_webhook import ChatWebhookConnection
from app.utils.crypto import encrypt_secret

logger = logging.getLogger(__name__)

# The single header the generic webhook signs its body with (HMAC-SHA256).
SIGNATURE_HEADER = 'X-ServerKit-Signature'
_REQUEST_TIMEOUT = 15

# Legacy notifications.json section -> (connection kind, destination key in the
# saved config). telegram maps to chat_id; the chat flavors carry a webhook_url.
_LEGACY_MAP = [
    ('discord', 'discord', 'webhook_url'),
    ('slack', 'slack', 'webhook_url'),
    ('generic_webhook', 'webhook', 'url'),
    ('telegram', 'telegram', 'chat_id'),
]


class ChatWebhookService:
    """Stateless CRUD + routing + delivery for chat/webhook connections."""

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------
    @classmethod
    def add(cls, data):
        """Create a connection, encrypting its destination + secret at rest.

        Requires a destination (url for discord/slack/webhook, chat_id for
        telegram) — raises ValueError otherwise. The first connection of a kind
        becomes that kind's default. Commits and returns the row.
        """
        kind = (data.get('kind') or '').strip().lower()
        if kind not in ChatWebhookConnection.KINDS:
            raise ValueError(f'Unknown chat connection kind: {kind!r}')

        name = (data.get('name') or '').strip()
        if not name:
            raise ValueError('name is required')

        credentials = cls._build_credentials(kind, data)  # raises if no destination

        categories = data.get('categories') or []
        if not isinstance(categories, list):
            raise ValueError('categories must be a list')
        categories = [c for c in categories if c]

        is_first = ChatWebhookConnection.query.filter_by(kind=kind).count() == 0
        conn = ChatWebhookConnection(
            kind=kind,
            name=name,
            credentials_json=json.dumps(credentials),
            categories_json=json.dumps(categories) if categories else None,
            is_active=data.get('is_active', True),
            is_default=bool(is_first),
            imported=bool(data.get('imported', False)),
            created_by=data.get('created_by'),
        )
        db.session.add(conn)
        db.session.commit()
        return conn

    @classmethod
    def update(cls, conn_id, data):
        """Update mutable connection fields without exposing stored secrets.

        Credential fields are patch-like: omitted values are preserved, empty
        optional values clear the credential, and required destinations cannot
        be cleared. The connection kind and default flag have dedicated
        lifecycle semantics and cannot be changed here.
        """
        if not isinstance(data, dict):
            raise ValueError('request body must be an object')

        conn = db.session.get(ChatWebhookConnection, conn_id)
        if conn is None:
            return None

        if 'kind' in data:
            kind = (data.get('kind') or '').strip().lower()
            if kind != conn.kind:
                raise ValueError('connection kind cannot be changed')
        if 'is_default' in data:
            raise ValueError('use the default endpoint to change is_default')

        new_name = conn.name
        new_categories_json = conn.categories_json
        new_is_active = conn.is_active
        new_credentials_json = conn.credentials_json

        if 'name' in data:
            new_name = str(data.get('name') or '').strip()
            if not new_name:
                raise ValueError('name is required')

        if 'categories' in data:
            categories = data.get('categories')
            if not isinstance(categories, list):
                raise ValueError('categories must be a list')
            categories = [category for category in categories if category]
            new_categories_json = json.dumps(categories) if categories else None

        if 'is_active' in data:
            new_is_active = bool(data.get('is_active'))

        url_supplied = 'url' in data or 'webhook_url' in data
        credential_supplied = url_supplied or any(
            field in data for field in ('secret', 'chat_id', 'bot_token')
        )
        if credential_supplied:
            credentials = conn.credentials()
            if conn.kind == 'telegram':
                if 'chat_id' in data:
                    chat_id = str(data.get('chat_id') or '').strip()
                    if not chat_id:
                        raise ValueError('telegram connection requires a chat_id')
                    credentials['chat_id'] = chat_id
                if 'bot_token' in data:
                    bot_token = data.get('bot_token')
                    if bot_token in (None, ''):
                        credentials.pop('bot_token', None)
                    else:
                        credentials['bot_token'] = str(bot_token)
            else:
                if url_supplied:
                    url_value = data.get('url') if 'url' in data else data.get('webhook_url')
                    url = str(url_value or '').strip()
                    if not url:
                        raise ValueError(f'{conn.kind} connection requires a url')
                    credentials['url'] = url
                if 'secret' in data:
                    secret = data.get('secret')
                    if secret in (None, ''):
                        credentials.pop('secret', None)
                    else:
                        credentials['secret'] = str(secret)

            required = 'chat_id' if conn.kind == 'telegram' else 'url'
            if not credentials.get(required):  # pragma: no cover - corrupt legacy row
                raise ValueError(f'{conn.kind} connection requires a {required}')
            new_credentials_json = json.dumps({
                key: encrypt_secret(str(value))
                for key, value in credentials.items()
            })

        conn.name = new_name
        conn.categories_json = new_categories_json
        conn.is_active = new_is_active
        conn.credentials_json = new_credentials_json
        db.session.commit()
        return conn

    @classmethod
    def set_default(cls, conn_id):
        """Select and activate the administrative default for one kind."""
        conn = db.session.get(ChatWebhookConnection, conn_id)
        if conn is None:
            return None

        for candidate in ChatWebhookConnection.query.filter_by(kind=conn.kind).all():
            candidate.is_default = candidate.id == conn.id
        conn.is_active = True
        db.session.commit()
        return conn

    @classmethod
    def delete(cls, conn_id):
        """Delete a connection. If it was its kind's default, promote the oldest
        remaining connection of that kind. Returns True if a row was removed."""
        conn = ChatWebhookConnection.query.get(conn_id)
        if conn is None:
            return False
        was_default = conn.is_default
        kind = conn.kind
        db.session.delete(conn)
        db.session.commit()
        if was_default:
            replacement = (ChatWebhookConnection.query
                           .filter_by(kind=kind)
                           .order_by(ChatWebhookConnection.created_at.asc(),
                                     ChatWebhookConnection.id.asc())
                           .first())
            if replacement is not None:
                replacement.is_default = True
                db.session.commit()
        return True

    @staticmethod
    def list_all():
        """Every connection, oldest first (admin list)."""
        return ChatWebhookConnection.query.order_by(
            ChatWebhookConnection.id.asc()).all()

    @staticmethod
    def _build_credentials(kind, data):
        """Encrypt the per-kind credential map. Raises ValueError with no dest."""
        creds = {}
        if kind == 'telegram':
            chat_id = data.get('chat_id')
            if not chat_id:
                raise ValueError('telegram connection requires a chat_id')
            creds['chat_id'] = encrypt_secret(str(chat_id))
            if data.get('bot_token'):
                creds['bot_token'] = encrypt_secret(str(data['bot_token']))
        else:
            url = data.get('url') or data.get('webhook_url')
            if not url:
                raise ValueError(f'{kind} connection requires a url')
            creds['url'] = encrypt_secret(str(url))
            if data.get('secret'):
                creds['secret'] = encrypt_secret(str(data['secret']))
        return creds

    # ------------------------------------------------------------------
    # Category routing (used by the bus fan-out)
    # ------------------------------------------------------------------
    @staticmethod
    def active_for_category(category):
        """Active connections that accept ``category`` (a catch-all with no
        category filter matches everything). Oldest first, deterministic."""
        conns = (ChatWebhookConnection.query
                 .filter_by(is_active=True)
                 .order_by(ChatWebhookConnection.id.asc())
                 .all())
        return [c for c in conns if c.matches_category(category)]

    # ------------------------------------------------------------------
    # Connection testing
    # ------------------------------------------------------------------
    @classmethod
    def test(cls, conn_id):
        """Synchronously send a test through a connection's real formatter.

        Inactive connections remain testable so an administrator can validate
        a destination before enabling it. The transient notification is never
        persisted; only the connection's latest test outcome is recorded.
        """
        conn = db.session.get(ChatWebhookConnection, conn_id)
        if conn is None:
            return None

        from app.notifications.models import Notification

        message = 'This is a test notification from ServerKit.'
        notification = Notification(
            event_key='notification.test',
            category='system',
            severity=Notification.SEVERITY_TEST,
            title='ServerKit test notification',
            body=message,
            audience=f'chat connection:{conn.id}',
            created_at=datetime.utcnow(),
        )
        notification.set_data({'message': message})

        try:
            credentials = conn.credentials()
            if conn.kind == 'webhook':
                delivery_result = cls._deliver_webhook(
                    conn, credentials, notification)
            else:
                delivery_result = cls._deliver_chat(
                    conn, credentials, notification)
            success = delivery_result.ok
        except Exception:  # pragma: no cover - defensive formatter guard
            success = False

        conn.last_tested_at = datetime.utcnow()
        conn.last_test_ok = success
        db.session.commit()

        if success:
            return {'success': True, 'message': 'Test notification sent'}
        logger.warning(
            'Chat connection test failed (id=%s, kind=%s)',
            conn.id,
            conn.kind,
        )
        return {'success': False, 'error': 'Test notification failed'}

    # ------------------------------------------------------------------
    # Delivery (called by the chat channel adapter for ``conn:<id>`` targets)
    # ------------------------------------------------------------------
    @classmethod
    def deliver(cls, delivery, notification):
        """Deliver one org-connection NotificationDelivery. Returns a
        DeliveryResult (sent/failed/skipped) the consumer maps onto the row."""
        from app.notifications.channels.base import DeliveryResult
        conn = cls._connection_from_target(delivery.target)
        if conn is None:
            return DeliveryResult.skipped('chat connection not found')
        if not conn.is_active:
            return DeliveryResult.skipped('chat connection inactive')

        creds = conn.credentials()
        if conn.kind == 'webhook':
            return cls._deliver_webhook(conn, creds, notification)
        return cls._deliver_chat(conn, creds, notification)

    @staticmethod
    def _connection_from_target(target):
        target = (target or '').strip()
        if not target.startswith('conn:'):
            return None
        try:
            conn_id = int(target.split(':', 1)[1])
        except (ValueError, IndexError):
            return None
        return ChatWebhookConnection.query.get(conn_id)

    @staticmethod
    def _payload(notification):
        """The documented, brand-neutral generic webhook payload."""
        created = notification.created_at or datetime.utcnow()
        return {
            'event': notification.event_key,
            'category': notification.category,
            'severity': notification.severity,
            'title': notification.title,
            'body': notification.body,
            'url': notification.action_path,
            'ts': created.isoformat(),
            'notification_id': notification.id,
            'data': notification.get_data(),
        }

    @classmethod
    def _deliver_webhook(cls, conn, creds, notification):
        from app.notifications.channels.base import DeliveryResult
        url = creds.get('url')
        if not url:
            return DeliveryResult.skipped('no webhook url')

        body = json.dumps(cls._payload(notification), sort_keys=True,
                          separators=(',', ':')).encode('utf-8')
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'ServerKit-Notifications/1.0',
        }
        secret = creds.get('secret')
        if secret:
            signature = hmac.new(secret.encode('utf-8'), body,
                                 hashlib.sha256).hexdigest()
            headers[SIGNATURE_HEADER] = 'sha256=' + signature

        try:
            resp = requests.post(url, data=body, headers=headers,
                                 timeout=_REQUEST_TIMEOUT)
        except Exception as exc:  # network error -> retryable failure
            return DeliveryResult.failed(str(exc))

        ok = getattr(resp, 'ok', None)
        if ok is None:
            status = getattr(resp, 'status_code', 0)
            ok = 200 <= status < 300
        if ok:
            return DeliveryResult.sent()
        return DeliveryResult.failed(
            f'webhook returned {getattr(resp, "status_code", "?")}')

    @classmethod
    def _deliver_chat(cls, conn, creds, notification):
        """Discord/Slack/Telegram reuse the working NotificationService
        formatters — we only swap in the connection's own destination."""
        from app.notifications.channels.base import DeliveryResult
        from app.services.notification_service import NotificationService

        data = notification.get_data()
        severity = notification.severity or 'info'
        alerts = data.get('alerts')
        if not (isinstance(alerts, list) and alerts):
            alerts = [{
                'severity': severity,
                'type': notification.event_key,
                'message': data.get('message') or notification.body or notification.title,
            }]
        # Gating already happened in the bus; let every alert through.
        notify_on = sorted({a.get('severity', severity) for a in alerts} | {severity})
        saved = NotificationService.get_config()

        if conn.kind == 'discord':
            cfg = {**saved.get('discord', {}), 'enabled': True,
                   'webhook_url': creds.get('url'), 'notify_on': notify_on}
            result = NotificationService.send_discord(alerts, cfg)
        elif conn.kind == 'slack':
            cfg = {**saved.get('slack', {}), 'enabled': True,
                   'webhook_url': creds.get('url'), 'notify_on': notify_on}
            result = NotificationService.send_slack(alerts, cfg)
        elif conn.kind == 'telegram':
            cfg = {**saved.get('telegram', {}), 'enabled': True,
                   'chat_id': creds.get('chat_id'), 'notify_on': notify_on}
            if creds.get('bot_token'):
                cfg['bot_token'] = creds['bot_token']
            result = NotificationService.send_telegram(alerts, cfg)
        else:  # pragma: no cover - defensive
            return DeliveryResult.skipped(f'unsupported chat kind {conn.kind}')

        if result.get('success'):
            return DeliveryResult.sent()
        return DeliveryResult.failed(result.get('error') or 'send failed')

    # ------------------------------------------------------------------
    # One-time legacy import
    # ------------------------------------------------------------------
    @classmethod
    def import_legacy(cls):
        """Fold the global ``notifications.json`` chat config into connections.

        Idempotent: a kind that already has an imported connection is skipped, so
        re-running is a no-op. Per-user personal webhook fields are intentionally
        NOT imported (a personal DM webhook is not an org room). Returns the count
        of connections created this run.
        """
        from app.services.notification_service import NotificationService
        config = NotificationService.get_config() or {}

        created = 0
        for cfg_key, kind, dest_key in _LEGACY_MAP:
            section = config.get(cfg_key) or {}
            destination = section.get(dest_key)
            if not destination:
                continue
            already = ChatWebhookConnection.query.filter_by(
                kind=kind, imported=True).first()
            if already is not None:
                continue

            payload = {'kind': kind, 'name': f'Imported {kind.title()}',
                       'imported': True}
            if kind == 'telegram':
                payload['chat_id'] = destination
                if section.get('bot_token'):
                    payload['bot_token'] = section['bot_token']
            else:
                payload['url'] = destination
                if section.get('secret'):
                    payload['secret'] = section['secret']
            try:
                cls.add(payload)
                created += 1
            except ValueError as exc:  # pragma: no cover - defensive
                logger.warning('Skipped legacy %s import: %s', kind, exc)
        return created
