"""High-level email server management orchestrator."""

import logging
import re
import socket
import subprocess
from typing import Dict, Optional

from app import db
from app.models.email import EmailDomain, EmailAccount, EmailAlias, EmailForwardingRule
from app.services.postfix_service import PostfixService
from app.services.dovecot_service import DovecotService
from app.services.dkim_service import DKIMService
from app.services.spamassassin_service import SpamAssassinService
from app.services.dns_provider_service import DNSProviderService
from app.utils.system import ServiceControl

logger = logging.getLogger(__name__)


class EmailService:
    """High-level orchestrator for email server management."""

    @classmethod
    def get_status(cls) -> Dict:
        """Get aggregate status of all email components."""
        return {
            'postfix': PostfixService.get_status(),
            'dovecot': DovecotService.get_status(),
            'opendkim': DKIMService.get_status(),
            'spamassassin': SpamAssassinService.get_status(),
            'domains_count': EmailDomain.query.count(),
            'accounts_count': EmailAccount.query.count(),
        }

    @classmethod
    def install_all(cls, hostname: str = None) -> Dict:
        """Install and configure all email components."""
        if not hostname:
            hostname = socket.getfqdn()

        results = {}

        # 1. Install Postfix
        results['postfix_install'] = PostfixService.install()
        if not results['postfix_install'].get('success'):
            return {'success': False, 'error': 'Postfix installation failed', 'results': results}

        # 2. Install Dovecot
        results['dovecot_install'] = DovecotService.install()
        if not results['dovecot_install'].get('success'):
            return {'success': False, 'error': 'Dovecot installation failed', 'results': results}

        # 3. Install OpenDKIM
        results['dkim_install'] = DKIMService.install()

        # 4. Install SpamAssassin
        results['spamassassin_install'] = SpamAssassinService.install()

        # 5. Configure Postfix
        results['postfix_config'] = PostfixService.configure(hostname)

        # 6. Configure Dovecot
        results['dovecot_config'] = DovecotService.configure()

        # 7. Open firewall ports
        results['firewall'] = cls._open_firewall_ports()

        return {
            'success': True,
            'message': 'Email server installed and configured',
            'hostname': hostname,
            'results': results,
        }

    @classmethod
    def _open_firewall_ports(cls) -> Dict:
        """Open email-related firewall ports."""
        try:
            from app.services.firewall_service import FirewallService
            ports = [25, 587, 465, 993, 995]
            for port in ports:
                FirewallService.allow_port(port, 'tcp')
            return {'success': True, 'message': f'Opened ports: {ports}'}
        except Exception as e:
            logger.warning(f'Could not open firewall ports: {e}')
            return {'success': False, 'error': str(e)}

    # ── Domain Management ──

    @classmethod
    def add_domain(cls, domain_name: str, dns_provider_id: int = None,
                   dns_zone_id: str = None) -> Dict:
        """Add an email domain with DKIM key generation."""
        # Validate domain
        if not re.match(r'^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$', domain_name):
            return {'success': False, 'error': 'Invalid domain name'}

        if EmailDomain.query.filter_by(name=domain_name).first():
            return {'success': False, 'error': 'Domain already exists'}

        try:
            # Generate DKIM key
            dkim_result = DKIMService.generate_key(domain_name)
            if not dkim_result.get('success'):
                return {'success': False, 'error': f'DKIM key generation failed: {dkim_result.get("error")}'}

            # Create domain record
            domain = EmailDomain(
                name=domain_name,
                dkim_selector='default',
                dkim_private_key_path=dkim_result.get('private_key_path'),
                dkim_public_key=dkim_result.get('public_key'),
                spf_record='v=spf1 mx a ~all',
                dmarc_record=f'v=DMARC1; p=quarantine; rua=mailto:dmarc@{domain_name}; pct=100',
                dns_provider_id=dns_provider_id,
                dns_zone_id=dns_zone_id,
            )
            db.session.add(domain)
            db.session.commit()

            # Add to Postfix virtual domains
            PostfixService.add_virtual_domain(domain_name)

            # Add to OpenDKIM
            DKIMService.add_domain(domain_name)

            # Reload services
            PostfixService.reload()

            # Auto-deploy DNS if provider configured
            dns_deployed = False
            if dns_provider_id and dns_zone_id:
                deploy_result = DNSProviderService.deploy_email_records(
                    dns_provider_id, dns_zone_id, domain_name,
                    'default', dkim_result.get('public_key', ''),
                )
                dns_deployed = deploy_result.get('success', False)

            return {
                'success': True,
                'domain': domain.to_dict(),
                'dkim': dkim_result,
                'dns_deployed': dns_deployed,
                'message': f'Domain {domain_name} added',
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_domain(cls, domain_id: int) -> Dict:
        """Remove an email domain and all associated data."""
        try:
            domain = EmailDomain.query.get(domain_id)
            if not domain:
                return {'success': False, 'error': 'Domain not found'}

            domain_name = domain.name

            # Remove accounts' Postfix entries
            for account in domain.accounts:
                PostfixService.remove_virtual_mailbox(account.email)
                DovecotService.delete_mailbox(account.email, domain_name, account.username, remove_files=True)

            # Remove aliases
            for alias in domain.aliases:
                PostfixService.remove_virtual_alias(alias.source)

            # Remove from Postfix
            PostfixService.remove_virtual_domain(domain_name)

            # Remove from DKIM
            DKIMService.remove_domain(domain_name)

            # Remove DB record (cascades accounts, aliases)
            db.session.delete(domain)
            db.session.commit()

            PostfixService.reload()

            return {'success': True, 'message': f'Domain {domain_name} removed'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_domains(cls) -> list:
        """Get all email domains."""
        return [d.to_dict() for d in EmailDomain.query.all()]

    @classmethod
    def get_domain(cls, domain_id: int) -> Dict:
        """Get a single email domain with details."""
        domain = EmailDomain.query.get(domain_id)
        if not domain:
            return {'success': False, 'error': 'Domain not found'}

        data = domain.to_dict()
        data['accounts'] = [a.to_dict() for a in domain.accounts]
        data['aliases'] = [a.to_dict() for a in domain.aliases]
        return {'success': True, 'domain': data}

    # ── Account Management ──

    @classmethod
    def add_account(cls, domain_id: int, username: str, password: str,
                    quota_mb: int = 1024) -> Dict:
        """Create an email account."""
        domain = EmailDomain.query.get(domain_id)
        if not domain:
            return {'success': False, 'error': 'Domain not found'}

        if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9._-]*$', username):
            return {'success': False, 'error': 'Invalid username'}

        email = f'{username}@{domain.name}'

        if EmailAccount.query.filter_by(email=email).first():
            return {'success': False, 'error': 'Account already exists'}

        try:
            # Create Dovecot mailbox
            result = DovecotService.create_mailbox(email, password, domain.name, username, quota_mb)
            if not result.get('success'):
                return result

            # Add to Postfix virtual mailboxes
            PostfixService.add_virtual_mailbox(email, domain.name, username)

            # Create DB record
            # Get the password hash from Dovecot
            hash_result = subprocess.run(
                ['sudo', 'doveadm', 'pw', '-s', 'SHA512-CRYPT', '-p', password],
                capture_output=True, text=True,
            )
            password_hash = hash_result.stdout.strip() if hash_result.returncode == 0 else 'hashed'

            account = EmailAccount(
                email=email,
                username=username,
                password_hash=password_hash,
                domain_id=domain_id,
                quota_mb=quota_mb,
            )
            db.session.add(account)
            db.session.commit()

            PostfixService.reload()

            return {
                'success': True,
                'account': account.to_dict(),
                'message': f'Account {email} created',
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_account(cls, account_id: int) -> Dict:
        """Delete an email account."""
        try:
            account = EmailAccount.query.get(account_id)
            if not account:
                return {'success': False, 'error': 'Account not found'}

            email = account.email
            domain_name = account.domain.name
            username = account.username

            # Remove from Dovecot
            DovecotService.delete_mailbox(email, domain_name, username, remove_files=True)

            # Remove from Postfix
            PostfixService.remove_virtual_mailbox(email)

            # Remove forwarding aliases
            for rule in account.forwarding_rules:
                PostfixService.remove_virtual_alias(email)

            db.session.delete(account)
            db.session.commit()

            PostfixService.reload()

            return {'success': True, 'message': f'Account {email} deleted'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def change_password(cls, account_id: int, new_password: str) -> Dict:
        """Change an account's password."""
        account = EmailAccount.query.get(account_id)
        if not account:
            return {'success': False, 'error': 'Account not found'}

        result = DovecotService.change_password(account.email, new_password)
        if result.get('success'):
            hash_result = subprocess.run(
                ['sudo', 'doveadm', 'pw', '-s', 'SHA512-CRYPT', '-p', new_password],
                capture_output=True, text=True,
            )
            if hash_result.returncode == 0:
                account.password_hash = hash_result.stdout.strip()
                db.session.commit()

        return result

    @classmethod
    def update_account(cls, account_id: int, quota_mb: int = None, is_active: bool = None) -> Dict:
        """Update account settings."""
        account = EmailAccount.query.get(account_id)
        if not account:
            return {'success': False, 'error': 'Account not found'}

        try:
            if quota_mb is not None:
                DovecotService.set_quota(account.email, quota_mb)
                account.quota_mb = quota_mb

            if is_active is not None:
                account.is_active = is_active

            db.session.commit()
            return {'success': True, 'account': account.to_dict(), 'message': 'Account updated'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_accounts(cls, domain_id: int) -> list:
        """Get all accounts for a domain."""
        return [a.to_dict() for a in EmailAccount.query.filter_by(domain_id=domain_id).all()]

    # ── Alias Management ──

    @classmethod
    def add_alias(cls, domain_id: int, source: str, destination: str) -> Dict:
        """Create an email alias."""
        domain = EmailDomain.query.get(domain_id)
        if not domain:
            return {'success': False, 'error': 'Domain not found'}

        # Ensure source has domain
        if '@' not in source:
            source = f'{source}@{domain.name}'

        try:
            alias = EmailAlias(
                source=source,
                destination=destination,
                domain_id=domain_id,
            )
            db.session.add(alias)
            db.session.commit()

            PostfixService.add_virtual_alias(source, destination)
            PostfixService.reload()

            return {'success': True, 'alias': alias.to_dict(), 'message': f'Alias {source} -> {destination} created'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_alias(cls, alias_id: int) -> Dict:
        """Remove an email alias."""
        try:
            alias = EmailAlias.query.get(alias_id)
            if not alias:
                return {'success': False, 'error': 'Alias not found'}

            PostfixService.remove_virtual_alias(alias.source)

            db.session.delete(alias)
            db.session.commit()

            PostfixService.reload()

            return {'success': True, 'message': 'Alias removed'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_aliases(cls, domain_id: int) -> list:
        """Get all aliases for a domain."""
        return [a.to_dict() for a in EmailAlias.query.filter_by(domain_id=domain_id).all()]

    # ── Forwarding Rules ──

    @classmethod
    def add_forwarding(cls, account_id: int, destination: str, keep_copy: bool = True) -> Dict:
        """Add a forwarding rule for an account."""
        account = EmailAccount.query.get(account_id)
        if not account:
            return {'success': False, 'error': 'Account not found'}

        try:
            rule = EmailForwardingRule(
                account_id=account_id,
                destination=destination,
                keep_copy=keep_copy,
            )
            db.session.add(rule)
            db.session.commit()

            # Update Postfix alias: forward + optionally keep local copy
            if keep_copy:
                alias_dest = f'{account.email}, {destination}'
            else:
                alias_dest = destination

            PostfixService.add_virtual_alias(account.email, alias_dest)
            PostfixService.reload()

            return {'success': True, 'rule': rule.to_dict(), 'message': 'Forwarding rule added'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_forwarding(cls, rule_id: int) -> Dict:
        """Remove a forwarding rule."""
        try:
            rule = EmailForwardingRule.query.get(rule_id)
            if not rule:
                return {'success': False, 'error': 'Rule not found'}

            account = rule.account

            db.session.delete(rule)
            db.session.commit()

            # Rebuild forwarding alias from remaining rules
            remaining = EmailForwardingRule.query.filter_by(account_id=account.id, is_active=True).all()
            if remaining:
                destinations = [r.destination for r in remaining]
                if any(r.keep_copy for r in remaining):
                    destinations.insert(0, account.email)
                PostfixService.add_virtual_alias(account.email, ', '.join(destinations))
            else:
                PostfixService.remove_virtual_alias(account.email)

            PostfixService.reload()

            return {'success': True, 'message': 'Forwarding rule removed'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def update_forwarding(cls, rule_id: int, destination: str = None,
                          keep_copy: bool = None, is_active: bool = None) -> Dict:
        """Update a forwarding rule."""
        try:
            rule = EmailForwardingRule.query.get(rule_id)
            if not rule:
                return {'success': False, 'error': 'Rule not found'}

            if destination is not None:
                rule.destination = destination
            if keep_copy is not None:
                rule.keep_copy = keep_copy
            if is_active is not None:
                rule.is_active = is_active

            db.session.commit()

            # Rebuild the alias
            account = rule.account
            active_rules = EmailForwardingRule.query.filter_by(account_id=account.id, is_active=True).all()
            if active_rules:
                destinations = [r.destination for r in active_rules]
                if any(r.keep_copy for r in active_rules):
                    destinations.insert(0, account.email)
                PostfixService.add_virtual_alias(account.email, ', '.join(destinations))
            else:
                PostfixService.remove_virtual_alias(account.email)

            PostfixService.reload()

            return {'success': True, 'rule': rule.to_dict(), 'message': 'Forwarding rule updated'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_forwarding(cls, account_id: int) -> list:
        """Get forwarding rules for an account."""
        return [r.to_dict() for r in EmailForwardingRule.query.filter_by(account_id=account_id).all()]

    # ── DNS Verification ──

    @classmethod
    def verify_dns(cls, domain_id: int) -> Dict:
        """Verify DKIM/SPF/DMARC DNS records for a domain."""
        domain = EmailDomain.query.get(domain_id)
        if not domain:
            return {'success': False, 'error': 'Domain not found'}

        results = {}

        # Check DKIM
        dkim_name = f'{domain.dkim_selector}._domainkey.{domain.name}'
        results['dkim'] = cls._check_dns_record(dkim_name, 'TXT', 'DKIM1')

        # Check SPF
        results['spf'] = cls._check_dns_record(domain.name, 'TXT', 'v=spf1')

        # Check DMARC
        results['dmarc'] = cls._check_dns_record(f'_dmarc.{domain.name}', 'TXT', 'v=DMARC1')

        # Check MX
        results['mx'] = cls._check_dns_record(domain.name, 'MX')

        all_ok = all(r.get('found') for r in results.values())

        return {
            'success': True,
            'verified': all_ok,
            'records': results,
        }

    @classmethod
    def _check_dns_record(cls, name: str, record_type: str, expected_substr: str = None) -> Dict:
        """Check if a DNS record exists using dig."""
        try:
            result = subprocess.run(
                ['dig', '+short', record_type, name],
                capture_output=True, text=True, timeout=10,
            )
            output = result.stdout.strip()
            found = bool(output)

            if found and expected_substr:
                found = expected_substr in output

            return {
                'found': found,
                'value': output if output else None,
            }
        except (subprocess.SubprocessError, FileNotFoundError):
            return {'found': False, 'value': None, 'error': 'dig command not available'}

    # ── Service Control ──

    @classmethod
    def control_service(cls, component: str, action: str) -> Dict:
        """Start/stop/restart an email component."""
        valid_components = {
            'postfix': 'postfix',
            'dovecot': 'dovecot',
            'opendkim': 'opendkim',
            'spamassassin': 'spamassassin',
        }
        valid_actions = ('start', 'stop', 'restart', 'enable', 'disable')

        if component not in valid_components:
            return {'success': False, 'error': f'Invalid component. Use: {", ".join(valid_components)}'}
        if action not in valid_actions:
            return {'success': False, 'error': f'Invalid action. Use: {", ".join(valid_actions)}'}

        try:
            service_name = valid_components[component]
            handler = getattr(ServiceControl, action)
            result = handler(service_name, timeout=30)

            if result.returncode == 0:
                return {'success': True, 'component': component, 'action': action}
            return {'success': False, 'error': result.stderr or 'Operation failed'}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Operation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
