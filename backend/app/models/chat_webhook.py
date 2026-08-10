"""Organization-level chat / webhook connection for the Notification Bus.

A shared destination — a Discord/Slack/Telegram room or a generic webhook — that
receives notifications matching its category filter. Replaces the legacy global
``notifications.json`` chat config and the per-user webhook URL fields (which
become deprecated). Credentials are Fernet-encrypted per-field in
``credentials_json`` (never serialized); follows the ``EmailProviderConnection``
Connections pattern.

Per kind, ``credentials_json`` holds:
  - discord / slack / webhook : {'url': ..., 'secret': <optional HMAC secret>}
  - telegram                  : {'chat_id': ..., 'bot_token': ...}
"""
import json
from datetime import datetime

from app import db
from app.utils.crypto import decrypt_secret_safe


class ChatWebhookConnection(db.Model):
    __tablename__ = 'chat_webhook_connections'

    KINDS = ('discord', 'slack', 'telegram', 'webhook')

    id = db.Column(db.Integer, primary_key=True)
    kind = db.Column(db.String(20), nullable=False)  # discord|slack|telegram|webhook
    name = db.Column(db.String(120), nullable=False)

    # Encrypted per-field credential map (see module docstring).
    credentials_json = db.Column(db.Text)

    # JSON list of categories this connection accepts (system/security/backups/
    # apps). Null / empty = every category (a catch-all room).
    categories_json = db.Column(db.Text)

    is_active = db.Column(db.Boolean, default=True, nullable=False)
    # Administrative default for this kind. Category fan-out remains driven by
    # active connections whose category filters match the notification.
    is_default = db.Column(db.Boolean, default=False, index=True)
    # True when created by the one-time import of legacy notifications.json config.
    imported = db.Column(db.Boolean, default=False)

    created_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_tested_at = db.Column(db.DateTime)
    last_test_ok = db.Column(db.Boolean)

    def raw_credentials(self):
        try:
            return json.loads(self.credentials_json) if self.credentials_json else {}
        except (json.JSONDecodeError, TypeError):
            return {}

    def credentials(self):
        """Decrypted credentials for use at send/test time (never serialized)."""
        out = {}
        for key, value in self.raw_credentials().items():
            out[key] = decrypt_secret_safe(value) if isinstance(value, str) else value
        return out

    def categories(self):
        try:
            value = json.loads(self.categories_json) if self.categories_json else []
            return value if isinstance(value, list) else []
        except (json.JSONDecodeError, TypeError):
            return []

    def matches_category(self, category):
        """A connection with no category filter accepts everything."""
        cats = self.categories()
        return not cats or category in cats

    @property
    def has_signing(self):
        return bool(self.credentials().get('secret')) and self.kind == 'webhook'

    def to_dict(self):
        creds = self.credentials()
        # Surface a masked destination hint, never the full URL / secret / token.
        dest = creds.get('url') or creds.get('chat_id') or ''
        masked = (dest[:24] + '…') if len(dest) > 25 else dest
        return {
            'id': self.id,
            'kind': self.kind,
            'name': self.name,
            'destination': masked,
            'categories': self.categories(),
            'is_active': self.is_active,
            'is_default': self.is_default,
            'imported': self.imported,
            'has_signing': self.has_signing,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'last_tested_at': self.last_tested_at.isoformat() if self.last_tested_at else None,
            'last_test_ok': self.last_test_ok,
        }

    def __repr__(self):
        return f'<ChatWebhookConnection {self.id} {self.kind} {self.name}>'
