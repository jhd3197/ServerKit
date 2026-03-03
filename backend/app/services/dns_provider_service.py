"""DNS Provider service for managing DKIM/SPF/DMARC records via Cloudflare and Route53."""

import logging
from typing import Dict, List, Optional

import requests

from app import db
from app.models.email import DNSProviderConfig

logger = logging.getLogger(__name__)


class DNSProviderService:
    """Service for managing DNS records via Cloudflare and Route53 APIs."""

    @classmethod
    def list_providers(cls) -> List[Dict]:
        """List all configured DNS providers (secrets masked)."""
        providers = DNSProviderConfig.query.all()
        return [p.to_dict(mask_secrets=True) for p in providers]

    @classmethod
    def get_provider(cls, provider_id: int) -> Optional[DNSProviderConfig]:
        """Get a DNS provider config by ID."""
        return DNSProviderConfig.query.get(provider_id)

    @classmethod
    def add_provider(cls, name: str, provider: str, api_key: str,
                     api_secret: str = None, api_email: str = None,
                     is_default: bool = False) -> Dict:
        """Add a new DNS provider configuration."""
        if provider not in ('cloudflare', 'route53'):
            return {'success': False, 'error': 'Provider must be cloudflare or route53'}

        try:
            if is_default:
                # Unset other defaults
                DNSProviderConfig.query.filter_by(is_default=True).update({'is_default': False})

            config = DNSProviderConfig(
                name=name,
                provider=provider,
                api_key=api_key,
                api_secret=api_secret,
                api_email=api_email,
                is_default=is_default,
            )
            db.session.add(config)
            db.session.commit()

            return {'success': True, 'provider': config.to_dict(), 'message': 'DNS provider added'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_provider(cls, provider_id: int) -> Dict:
        """Remove a DNS provider configuration."""
        try:
            config = DNSProviderConfig.query.get(provider_id)
            if not config:
                return {'success': False, 'error': 'Provider not found'}

            db.session.delete(config)
            db.session.commit()
            return {'success': True, 'message': 'DNS provider removed'}

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def test_connection(cls, provider_id: int) -> Dict:
        """Test DNS provider API connection."""
        config = DNSProviderConfig.query.get(provider_id)
        if not config:
            return {'success': False, 'error': 'Provider not found'}

        if config.provider == 'cloudflare':
            return cls._test_cloudflare(config)
        elif config.provider == 'route53':
            return cls._test_route53(config)

        return {'success': False, 'error': 'Unknown provider'}

    @classmethod
    def list_zones(cls, provider_id: int) -> Dict:
        """List DNS zones from the provider."""
        config = DNSProviderConfig.query.get(provider_id)
        if not config:
            return {'success': False, 'error': 'Provider not found'}

        if config.provider == 'cloudflare':
            return cls._cloudflare_list_zones(config)
        elif config.provider == 'route53':
            return cls._route53_list_zones(config)

        return {'success': False, 'error': 'Unknown provider'}

    @classmethod
    def set_record(cls, provider_id: int, zone_id: str, record_type: str,
                   name: str, value: str, ttl: int = 3600) -> Dict:
        """Create or update a DNS record."""
        config = DNSProviderConfig.query.get(provider_id)
        if not config:
            return {'success': False, 'error': 'Provider not found'}

        if config.provider == 'cloudflare':
            return cls._cloudflare_set_record(config, zone_id, record_type, name, value, ttl)
        elif config.provider == 'route53':
            return cls._route53_set_record(config, zone_id, record_type, name, value, ttl)

        return {'success': False, 'error': 'Unknown provider'}

    @classmethod
    def delete_record(cls, provider_id: int, zone_id: str, record_type: str, name: str) -> Dict:
        """Delete a DNS record."""
        config = DNSProviderConfig.query.get(provider_id)
        if not config:
            return {'success': False, 'error': 'Provider not found'}

        if config.provider == 'cloudflare':
            return cls._cloudflare_delete_record(config, zone_id, record_type, name)
        elif config.provider == 'route53':
            return cls._route53_delete_record(config, zone_id, record_type, name)

        return {'success': False, 'error': 'Unknown provider'}

    @classmethod
    def deploy_email_records(cls, provider_id: int, zone_id: str, domain: str,
                             selector: str, dkim_public_key: str,
                             server_ip: str = None) -> Dict:
        """Deploy DKIM, SPF, and DMARC records for an email domain."""
        results = {}

        # Deploy DKIM record
        dkim_name = f'{selector}._domainkey.{domain}'
        dkim_value = f'v=DKIM1; k=rsa; p={dkim_public_key}'
        results['dkim'] = cls.set_record(provider_id, zone_id, 'TXT', dkim_name, dkim_value)

        # Deploy SPF record
        spf_value = 'v=spf1 mx a ~all'
        if server_ip:
            spf_value = f'v=spf1 mx a ip4:{server_ip} ~all'
        results['spf'] = cls.set_record(provider_id, zone_id, 'TXT', domain, spf_value)

        # Deploy DMARC record
        dmarc_name = f'_dmarc.{domain}'
        dmarc_value = f'v=DMARC1; p=quarantine; rua=mailto:dmarc@{domain}; pct=100'
        results['dmarc'] = cls.set_record(provider_id, zone_id, 'TXT', dmarc_name, dmarc_value)

        # Deploy MX record
        results['mx'] = cls.set_record(provider_id, zone_id, 'MX', domain, f'10 mail.{domain}')

        all_ok = all(r.get('success') for r in results.values())
        return {
            'success': all_ok,
            'results': results,
            'message': 'All DNS records deployed' if all_ok else 'Some records failed',
        }

    # ── Cloudflare Implementation ──

    @classmethod
    def _cloudflare_headers(cls, config: DNSProviderConfig) -> Dict:
        """Build Cloudflare API headers."""
        if config.api_email:
            return {
                'X-Auth-Email': config.api_email,
                'X-Auth-Key': config.api_key,
                'Content-Type': 'application/json',
            }
        return {
            'Authorization': f'Bearer {config.api_key}',
            'Content-Type': 'application/json',
        }

    @classmethod
    def _test_cloudflare(cls, config: DNSProviderConfig) -> Dict:
        """Test Cloudflare API connection."""
        try:
            resp = requests.get(
                'https://api.cloudflare.com/client/v4/user/tokens/verify',
                headers=cls._cloudflare_headers(config),
                timeout=15,
            )
            data = resp.json()
            if data.get('success'):
                return {'success': True, 'message': 'Cloudflare connection successful'}
            return {'success': False, 'error': data.get('errors', [{}])[0].get('message', 'Unknown error')}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _cloudflare_list_zones(cls, config: DNSProviderConfig) -> Dict:
        """List Cloudflare zones."""
        try:
            resp = requests.get(
                'https://api.cloudflare.com/client/v4/zones?per_page=50',
                headers=cls._cloudflare_headers(config),
                timeout=15,
            )
            data = resp.json()
            if not data.get('success'):
                return {'success': False, 'error': 'Failed to list zones'}

            zones = [{'id': z['id'], 'name': z['name'], 'status': z['status']}
                     for z in data.get('result', [])]
            return {'success': True, 'zones': zones}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _cloudflare_set_record(cls, config: DNSProviderConfig, zone_id: str,
                                record_type: str, name: str, value: str, ttl: int) -> Dict:
        """Create or update a Cloudflare DNS record."""
        try:
            headers = cls._cloudflare_headers(config)
            base = f'https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records'

            # Check if record exists
            resp = requests.get(
                f'{base}?type={record_type}&name={name}',
                headers=headers, timeout=15,
            )
            data = resp.json()
            existing = data.get('result', [])

            payload = {'type': record_type, 'name': name, 'content': value, 'ttl': ttl}

            if existing:
                # Update existing record
                record_id = existing[0]['id']
                resp = requests.put(
                    f'{base}/{record_id}',
                    headers=headers, json=payload, timeout=15,
                )
            else:
                # Create new record
                resp = requests.post(base, headers=headers, json=payload, timeout=15)

            data = resp.json()
            if data.get('success'):
                return {'success': True, 'message': f'{record_type} record set for {name}'}
            return {'success': False, 'error': data.get('errors', [{}])[0].get('message', 'Unknown error')}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _cloudflare_delete_record(cls, config: DNSProviderConfig, zone_id: str,
                                   record_type: str, name: str) -> Dict:
        """Delete a Cloudflare DNS record."""
        try:
            headers = cls._cloudflare_headers(config)
            base = f'https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records'

            resp = requests.get(
                f'{base}?type={record_type}&name={name}',
                headers=headers, timeout=15,
            )
            data = resp.json()
            existing = data.get('result', [])

            if not existing:
                return {'success': True, 'message': 'Record not found (already deleted)'}

            for record in existing:
                requests.delete(f'{base}/{record["id"]}', headers=headers, timeout=15)

            return {'success': True, 'message': f'{record_type} record deleted for {name}'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    # ── Route53 Implementation ──

    @classmethod
    def _get_route53_client(cls, config: DNSProviderConfig):
        """Get a boto3 Route53 client."""
        try:
            import boto3
        except ImportError:
            raise RuntimeError('boto3 is required for Route53 integration. Install with: pip install boto3')

        return boto3.client(
            'route53',
            aws_access_key_id=config.api_key,
            aws_secret_access_key=config.api_secret,
        )

    @classmethod
    def _test_route53(cls, config: DNSProviderConfig) -> Dict:
        """Test Route53 API connection."""
        try:
            client = cls._get_route53_client(config)
            client.list_hosted_zones(MaxItems='1')
            return {'success': True, 'message': 'Route53 connection successful'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _route53_list_zones(cls, config: DNSProviderConfig) -> Dict:
        """List Route53 hosted zones."""
        try:
            client = cls._get_route53_client(config)
            resp = client.list_hosted_zones()

            zones = [
                {
                    'id': z['Id'].replace('/hostedzone/', ''),
                    'name': z['Name'].rstrip('.'),
                    'status': 'active',
                }
                for z in resp.get('HostedZones', [])
            ]
            return {'success': True, 'zones': zones}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _route53_set_record(cls, config: DNSProviderConfig, zone_id: str,
                             record_type: str, name: str, value: str, ttl: int) -> Dict:
        """Create or update a Route53 DNS record."""
        try:
            client = cls._get_route53_client(config)

            # Ensure name ends with a dot for Route53
            fqdn = name if name.endswith('.') else f'{name}.'

            resource_record = {'Value': value}
            if record_type == 'TXT':
                # TXT records need to be quoted
                resource_record = {'Value': f'"{value}"'}
            elif record_type == 'MX':
                resource_record = {'Value': value}

            client.change_resource_record_sets(
                HostedZoneId=zone_id,
                ChangeBatch={
                    'Changes': [{
                        'Action': 'UPSERT',
                        'ResourceRecordSet': {
                            'Name': fqdn,
                            'Type': record_type,
                            'TTL': ttl,
                            'ResourceRecords': [resource_record],
                        }
                    }]
                }
            )
            return {'success': True, 'message': f'{record_type} record set for {name}'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _route53_delete_record(cls, config: DNSProviderConfig, zone_id: str,
                                record_type: str, name: str) -> Dict:
        """Delete a Route53 DNS record."""
        try:
            client = cls._get_route53_client(config)
            fqdn = name if name.endswith('.') else f'{name}.'

            # Get current record to know its value (required for DELETE)
            resp = client.list_resource_record_sets(
                HostedZoneId=zone_id,
                StartRecordName=fqdn,
                StartRecordType=record_type,
                MaxItems='1',
            )
            records = resp.get('ResourceRecordSets', [])
            matching = [r for r in records if r['Name'] == fqdn and r['Type'] == record_type]

            if not matching:
                return {'success': True, 'message': 'Record not found (already deleted)'}

            record = matching[0]
            client.change_resource_record_sets(
                HostedZoneId=zone_id,
                ChangeBatch={
                    'Changes': [{
                        'Action': 'DELETE',
                        'ResourceRecordSet': record,
                    }]
                }
            )
            return {'success': True, 'message': f'{record_type} record deleted for {name}'}

        except Exception as e:
            return {'success': False, 'error': str(e)}
