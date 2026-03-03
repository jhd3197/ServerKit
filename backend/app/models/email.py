from datetime import datetime
from app import db


class EmailDomain(db.Model):
    __tablename__ = 'email_domains'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), unique=True, nullable=False, index=True)
    is_active = db.Column(db.Boolean, default=True)

    # DKIM
    dkim_selector = db.Column(db.String(63), default='default')
    dkim_private_key_path = db.Column(db.String(500))
    dkim_public_key = db.Column(db.Text)

    # SPF / DMARC
    spf_record = db.Column(db.String(500))
    dmarc_record = db.Column(db.String(500))

    # DNS provider linkage
    dns_provider_id = db.Column(db.Integer, db.ForeignKey('dns_provider_configs.id'), nullable=True)
    dns_zone_id = db.Column(db.String(255))

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    accounts = db.relationship('EmailAccount', backref='domain', lazy=True, cascade='all, delete-orphan')
    aliases = db.relationship('EmailAlias', backref='domain', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'is_active': self.is_active,
            'dkim_selector': self.dkim_selector,
            'dkim_public_key': self.dkim_public_key,
            'spf_record': self.spf_record,
            'dmarc_record': self.dmarc_record,
            'dns_provider_id': self.dns_provider_id,
            'dns_zone_id': self.dns_zone_id,
            'accounts_count': len(self.accounts) if self.accounts else 0,
            'aliases_count': len(self.aliases) if self.aliases else 0,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f'<EmailDomain {self.name}>'


class EmailAccount(db.Model):
    __tablename__ = 'email_accounts'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    username = db.Column(db.String(255), nullable=False)
    password_hash = db.Column(db.String(500), nullable=False)
    domain_id = db.Column(db.Integer, db.ForeignKey('email_domains.id'), nullable=False)

    quota_mb = db.Column(db.Integer, default=1024)
    quota_used_mb = db.Column(db.Integer, default=0)
    is_active = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    forwarding_rules = db.relationship('EmailForwardingRule', backref='account', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'username': self.username,
            'domain_id': self.domain_id,
            'domain_name': self.domain.name if self.domain else None,
            'quota_mb': self.quota_mb,
            'quota_used_mb': self.quota_used_mb,
            'is_active': self.is_active,
            'forwarding_count': len(self.forwarding_rules) if self.forwarding_rules else 0,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self):
        return f'<EmailAccount {self.email}>'


class EmailAlias(db.Model):
    __tablename__ = 'email_aliases'

    id = db.Column(db.Integer, primary_key=True)
    source = db.Column(db.String(255), nullable=False, index=True)
    destination = db.Column(db.String(255), nullable=False)
    domain_id = db.Column(db.Integer, db.ForeignKey('email_domains.id'), nullable=False)
    is_active = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'source': self.source,
            'destination': self.destination,
            'domain_id': self.domain_id,
            'domain_name': self.domain.name if self.domain else None,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<EmailAlias {self.source} -> {self.destination}>'


class EmailForwardingRule(db.Model):
    __tablename__ = 'email_forwarding_rules'

    id = db.Column(db.Integer, primary_key=True)
    account_id = db.Column(db.Integer, db.ForeignKey('email_accounts.id'), nullable=False)
    destination = db.Column(db.String(255), nullable=False)
    keep_copy = db.Column(db.Boolean, default=True)
    is_active = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': self.id,
            'account_id': self.account_id,
            'account_email': self.account.email if self.account else None,
            'destination': self.destination,
            'keep_copy': self.keep_copy,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f'<EmailForwardingRule {self.account_id} -> {self.destination}>'


class DNSProviderConfig(db.Model):
    __tablename__ = 'dns_provider_configs'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    provider = db.Column(db.String(50), nullable=False)  # 'cloudflare' | 'route53'
    api_key = db.Column(db.String(500))
    api_secret = db.Column(db.String(500))
    api_email = db.Column(db.String(255))
    is_default = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    domains = db.relationship('EmailDomain', backref='dns_provider', lazy=True)

    def to_dict(self, mask_secrets=True):
        result = {
            'id': self.id,
            'name': self.name,
            'provider': self.provider,
            'api_email': self.api_email,
            'is_default': self.is_default,
            'domains_count': len(self.domains) if self.domains else 0,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }
        if mask_secrets:
            result['api_key'] = '****' + (self.api_key[-4:] if self.api_key and len(self.api_key) > 4 else '')
            result['api_secret'] = '****' if self.api_secret else None
        else:
            result['api_key'] = self.api_key
            result['api_secret'] = self.api_secret
        return result

    def __repr__(self):
        return f'<DNSProviderConfig {self.name} ({self.provider})>'
