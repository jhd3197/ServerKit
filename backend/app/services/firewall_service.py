"""Firewall management service for firewalld and ufw."""

import subprocess
import re
from typing import Dict, List, Optional
from datetime import datetime


class FirewallService:
    """Service for managing firewall (firewalld or ufw)."""

    @classmethod
    def get_status(cls) -> Dict:
        """Get firewall status and detect which firewall is in use."""
        firewalld = cls._check_firewalld()
        ufw = cls._check_ufw()

        active_firewall = None
        if firewalld['installed'] and firewalld['running']:
            active_firewall = 'firewalld'
        elif ufw['installed'] and ufw['active']:
            active_firewall = 'ufw'
        elif firewalld['installed']:
            active_firewall = 'firewalld'
        elif ufw['installed']:
            active_firewall = 'ufw'

        return {
            'firewalld': firewalld,
            'ufw': ufw,
            'active_firewall': active_firewall,
            'any_installed': firewalld['installed'] or ufw['installed'],
            'any_active': firewalld['running'] or ufw['active']
        }

    @classmethod
    def _check_firewalld(cls) -> Dict:
        """Check firewalld status."""
        try:
            # Check if installed
            result = subprocess.run(['which', 'firewall-cmd'], capture_output=True, text=True)
            installed = result.returncode == 0

            running = False
            default_zone = None

            if installed:
                # Check if running
                result = subprocess.run(
                    ['firewall-cmd', '--state'],
                    capture_output=True, text=True
                )
                running = 'running' in result.stdout.lower()

                if running:
                    # Get default zone
                    result = subprocess.run(
                        ['firewall-cmd', '--get-default-zone'],
                        capture_output=True, text=True
                    )
                    default_zone = result.stdout.strip()

            return {
                'installed': installed,
                'running': running,
                'default_zone': default_zone
            }
        except Exception:
            return {'installed': False, 'running': False, 'default_zone': None}

    @classmethod
    def _check_ufw(cls) -> Dict:
        """Check ufw status."""
        try:
            # Check if installed
            result = subprocess.run(['which', 'ufw'], capture_output=True, text=True)
            installed = result.returncode == 0

            active = False
            if installed:
                result = subprocess.run(
                    ['sudo', 'ufw', 'status'],
                    capture_output=True, text=True
                )
                active = 'Status: active' in result.stdout

            return {
                'installed': installed,
                'active': active
            }
        except Exception:
            return {'installed': False, 'active': False}

    @classmethod
    def enable(cls, firewall: str = None) -> Dict:
        """Enable the firewall."""
        if firewall is None:
            status = cls.get_status()
            firewall = status['active_firewall']

        if firewall == 'firewalld':
            return cls._enable_firewalld()
        elif firewall == 'ufw':
            return cls._enable_ufw()
        else:
            return {'success': False, 'error': 'No firewall detected'}

    @classmethod
    def _enable_firewalld(cls) -> Dict:
        """Enable firewalld."""
        try:
            subprocess.run(['sudo', 'systemctl', 'enable', 'firewalld'], capture_output=True)
            result = subprocess.run(
                ['sudo', 'systemctl', 'start', 'firewalld'],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'message': 'Firewalld enabled and started'}
            return {'success': False, 'error': result.stderr or 'Failed to start firewalld'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _enable_ufw(cls) -> Dict:
        """Enable ufw."""
        try:
            result = subprocess.run(
                ['sudo', 'ufw', '--force', 'enable'],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'message': 'UFW enabled'}
            return {'success': False, 'error': result.stderr or 'Failed to enable UFW'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def disable(cls, firewall: str = None) -> Dict:
        """Disable the firewall."""
        if firewall is None:
            status = cls.get_status()
            firewall = status['active_firewall']

        if firewall == 'firewalld':
            return cls._disable_firewalld()
        elif firewall == 'ufw':
            return cls._disable_ufw()
        else:
            return {'success': False, 'error': 'No firewall detected'}

    @classmethod
    def _disable_firewalld(cls) -> Dict:
        """Disable firewalld."""
        try:
            result = subprocess.run(
                ['sudo', 'systemctl', 'stop', 'firewalld'],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'message': 'Firewalld stopped'}
            return {'success': False, 'error': result.stderr or 'Failed to stop firewalld'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _disable_ufw(cls) -> Dict:
        """Disable ufw."""
        try:
            result = subprocess.run(
                ['sudo', 'ufw', 'disable'],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'message': 'UFW disabled'}
            return {'success': False, 'error': result.stderr or 'Failed to disable UFW'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_rules(cls, firewall: str = None) -> Dict:
        """Get all firewall rules."""
        if firewall is None:
            status = cls.get_status()
            firewall = status['active_firewall']

        if firewall == 'firewalld':
            return cls._get_firewalld_rules()
        elif firewall == 'ufw':
            return cls._get_ufw_rules()
        else:
            return {'success': False, 'error': 'No firewall detected'}

    @classmethod
    def _get_firewalld_rules(cls) -> Dict:
        """Get firewalld rules."""
        try:
            rules = []

            # Get default zone
            result = subprocess.run(
                ['firewall-cmd', '--get-default-zone'],
                capture_output=True, text=True
            )
            default_zone = result.stdout.strip()

            # Get services
            result = subprocess.run(
                ['firewall-cmd', '--list-services'],
                capture_output=True, text=True
            )
            services = result.stdout.strip().split() if result.stdout.strip() else []
            for service in services:
                rules.append({
                    'type': 'service',
                    'service': service,
                    'zone': default_zone,
                    'permanent': True
                })

            # Get ports
            result = subprocess.run(
                ['firewall-cmd', '--list-ports'],
                capture_output=True, text=True
            )
            ports = result.stdout.strip().split() if result.stdout.strip() else []
            for port in ports:
                port_num, protocol = port.split('/') if '/' in port else (port, 'tcp')
                rules.append({
                    'type': 'port',
                    'port': port_num,
                    'protocol': protocol,
                    'zone': default_zone,
                    'permanent': True
                })

            # Get rich rules (includes IP blocks)
            result = subprocess.run(
                ['firewall-cmd', '--list-rich-rules'],
                capture_output=True, text=True
            )
            rich_rules = result.stdout.strip().split('\n') if result.stdout.strip() else []
            for rule in rich_rules:
                if rule:
                    rules.append({
                        'type': 'rich',
                        'rule': rule,
                        'zone': default_zone
                    })

            return {
                'success': True,
                'firewall': 'firewalld',
                'default_zone': default_zone,
                'rules': rules
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _get_ufw_rules(cls) -> Dict:
        """Get ufw rules."""
        try:
            result = subprocess.run(
                ['sudo', 'ufw', 'status', 'numbered'],
                capture_output=True, text=True
            )

            rules = []
            lines = result.stdout.strip().split('\n')

            for line in lines:
                # Parse rules like: [ 1] 22/tcp ALLOW IN Anywhere
                match = re.match(r'\[\s*(\d+)\]\s+(.+?)\s+(ALLOW|DENY|REJECT)\s+(IN|OUT)?\s*(.+)?', line)
                if match:
                    rules.append({
                        'number': int(match.group(1)),
                        'port': match.group(2),
                        'action': match.group(3),
                        'direction': match.group(4) or 'IN',
                        'from': match.group(5) or 'Anywhere'
                    })

            return {
                'success': True,
                'firewall': 'ufw',
                'rules': rules
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def add_rule(cls, rule_type: str, **kwargs) -> Dict:
        """Add a firewall rule."""
        status = cls.get_status()
        firewall = status['active_firewall']

        if firewall == 'firewalld':
            return cls._add_firewalld_rule(rule_type, **kwargs)
        elif firewall == 'ufw':
            return cls._add_ufw_rule(rule_type, **kwargs)
        else:
            return {'success': False, 'error': 'No firewall detected'}

    @classmethod
    def _add_firewalld_rule(cls, rule_type: str, **kwargs) -> Dict:
        """Add a firewalld rule."""
        try:
            permanent = kwargs.get('permanent', True)
            perm_flag = ['--permanent'] if permanent else []

            if rule_type == 'service':
                service = kwargs.get('service')
                if not service:
                    return {'success': False, 'error': 'Service name required'}
                cmd = ['sudo', 'firewall-cmd'] + perm_flag + [f'--add-service={service}']

            elif rule_type == 'port':
                port = kwargs.get('port')
                protocol = kwargs.get('protocol', 'tcp')
                if not port:
                    return {'success': False, 'error': 'Port number required'}
                cmd = ['sudo', 'firewall-cmd'] + perm_flag + [f'--add-port={port}/{protocol}']

            elif rule_type == 'block_ip':
                ip = kwargs.get('ip')
                if not ip:
                    return {'success': False, 'error': 'IP address required'}
                cmd = ['sudo', 'firewall-cmd'] + perm_flag + [
                    f'--add-rich-rule=rule family="ipv4" source address="{ip}" reject'
                ]

            elif rule_type == 'allow_ip':
                ip = kwargs.get('ip')
                port = kwargs.get('port')
                if not ip:
                    return {'success': False, 'error': 'IP address required'}
                if port:
                    cmd = ['sudo', 'firewall-cmd'] + perm_flag + [
                        f'--add-rich-rule=rule family="ipv4" source address="{ip}" port port="{port}" protocol="tcp" accept'
                    ]
                else:
                    cmd = ['sudo', 'firewall-cmd'] + perm_flag + [
                        f'--add-rich-rule=rule family="ipv4" source address="{ip}" accept'
                    ]

            else:
                return {'success': False, 'error': f'Unknown rule type: {rule_type}'}

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode == 0:
                # Reload if permanent
                if permanent:
                    subprocess.run(['sudo', 'firewall-cmd', '--reload'], capture_output=True)
                return {'success': True, 'message': 'Rule added successfully'}

            return {'success': False, 'error': result.stderr or 'Failed to add rule'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _add_ufw_rule(cls, rule_type: str, **kwargs) -> Dict:
        """Add a ufw rule."""
        try:
            if rule_type == 'port':
                port = kwargs.get('port')
                protocol = kwargs.get('protocol', 'tcp')
                action = kwargs.get('action', 'allow')
                if not port:
                    return {'success': False, 'error': 'Port number required'}
                cmd = ['sudo', 'ufw', action, f'{port}/{protocol}']

            elif rule_type == 'service':
                service = kwargs.get('service')
                action = kwargs.get('action', 'allow')
                if not service:
                    return {'success': False, 'error': 'Service name required'}
                cmd = ['sudo', 'ufw', action, service]

            elif rule_type == 'block_ip':
                ip = kwargs.get('ip')
                if not ip:
                    return {'success': False, 'error': 'IP address required'}
                cmd = ['sudo', 'ufw', 'deny', 'from', ip]

            elif rule_type == 'allow_ip':
                ip = kwargs.get('ip')
                port = kwargs.get('port')
                if not ip:
                    return {'success': False, 'error': 'IP address required'}
                if port:
                    cmd = ['sudo', 'ufw', 'allow', 'from', ip, 'to', 'any', 'port', str(port)]
                else:
                    cmd = ['sudo', 'ufw', 'allow', 'from', ip]

            else:
                return {'success': False, 'error': f'Unknown rule type: {rule_type}'}

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode == 0:
                return {'success': True, 'message': 'Rule added successfully'}

            return {'success': False, 'error': result.stderr or 'Failed to add rule'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def remove_rule(cls, rule_type: str, **kwargs) -> Dict:
        """Remove a firewall rule."""
        status = cls.get_status()
        firewall = status['active_firewall']

        if firewall == 'firewalld':
            return cls._remove_firewalld_rule(rule_type, **kwargs)
        elif firewall == 'ufw':
            return cls._remove_ufw_rule(rule_type, **kwargs)
        else:
            return {'success': False, 'error': 'No firewall detected'}

    @classmethod
    def _remove_firewalld_rule(cls, rule_type: str, **kwargs) -> Dict:
        """Remove a firewalld rule."""
        try:
            permanent = kwargs.get('permanent', True)
            perm_flag = ['--permanent'] if permanent else []

            if rule_type == 'service':
                service = kwargs.get('service')
                cmd = ['sudo', 'firewall-cmd'] + perm_flag + [f'--remove-service={service}']

            elif rule_type == 'port':
                port = kwargs.get('port')
                protocol = kwargs.get('protocol', 'tcp')
                cmd = ['sudo', 'firewall-cmd'] + perm_flag + [f'--remove-port={port}/{protocol}']

            elif rule_type == 'block_ip':
                ip = kwargs.get('ip')
                cmd = ['sudo', 'firewall-cmd'] + perm_flag + [
                    f'--remove-rich-rule=rule family="ipv4" source address="{ip}" reject'
                ]

            elif rule_type == 'rich':
                rule = kwargs.get('rule')
                cmd = ['sudo', 'firewall-cmd'] + perm_flag + [f'--remove-rich-rule={rule}']

            else:
                return {'success': False, 'error': f'Unknown rule type: {rule_type}'}

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode == 0:
                if permanent:
                    subprocess.run(['sudo', 'firewall-cmd', '--reload'], capture_output=True)
                return {'success': True, 'message': 'Rule removed successfully'}

            return {'success': False, 'error': result.stderr or 'Failed to remove rule'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _remove_ufw_rule(cls, rule_type: str, **kwargs) -> Dict:
        """Remove a ufw rule."""
        try:
            rule_number = kwargs.get('number')
            if rule_number:
                # Remove by number
                result = subprocess.run(
                    ['sudo', 'ufw', '--force', 'delete', str(rule_number)],
                    capture_output=True, text=True
                )
            else:
                # Remove by specification
                if rule_type == 'port':
                    port = kwargs.get('port')
                    protocol = kwargs.get('protocol', 'tcp')
                    action = kwargs.get('action', 'allow')
                    result = subprocess.run(
                        ['sudo', 'ufw', 'delete', action, f'{port}/{protocol}'],
                        capture_output=True, text=True
                    )
                elif rule_type == 'block_ip':
                    ip = kwargs.get('ip')
                    result = subprocess.run(
                        ['sudo', 'ufw', 'delete', 'deny', 'from', ip],
                        capture_output=True, text=True
                    )
                else:
                    return {'success': False, 'error': 'Rule number or specification required'}

            if result.returncode == 0:
                return {'success': True, 'message': 'Rule removed successfully'}

            return {'success': False, 'error': result.stderr or 'Failed to remove rule'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def block_ip(cls, ip: str, permanent: bool = True) -> Dict:
        """Quick method to block an IP address."""
        # Validate IP format
        if not cls._is_valid_ip(ip):
            return {'success': False, 'error': 'Invalid IP address format'}

        return cls.add_rule('block_ip', ip=ip, permanent=permanent)

    @classmethod
    def unblock_ip(cls, ip: str, permanent: bool = True) -> Dict:
        """Quick method to unblock an IP address."""
        return cls.remove_rule('block_ip', ip=ip, permanent=permanent)

    @classmethod
    def allow_port(cls, port: int, protocol: str = 'tcp', permanent: bool = True) -> Dict:
        """Quick method to allow a port."""
        return cls.add_rule('port', port=port, protocol=protocol, permanent=permanent)

    @classmethod
    def deny_port(cls, port: int, protocol: str = 'tcp', permanent: bool = True) -> Dict:
        """Quick method to deny a port."""
        return cls.remove_rule('port', port=port, protocol=protocol, permanent=permanent)

    @classmethod
    def get_blocked_ips(cls) -> Dict:
        """Get list of blocked IP addresses."""
        status = cls.get_status()
        firewall = status['active_firewall']

        blocked_ips = []

        if firewall == 'firewalld':
            result = subprocess.run(
                ['firewall-cmd', '--list-rich-rules'],
                capture_output=True, text=True
            )
            for line in result.stdout.strip().split('\n'):
                if 'reject' in line.lower() or 'drop' in line.lower():
                    match = re.search(r'source address="([^"]+)"', line)
                    if match:
                        blocked_ips.append({
                            'ip': match.group(1),
                            'rule': line
                        })

        elif firewall == 'ufw':
            result = subprocess.run(
                ['sudo', 'ufw', 'status', 'numbered'],
                capture_output=True, text=True
            )
            for line in result.stdout.strip().split('\n'):
                if 'DENY' in line:
                    # Parse IP from rule
                    match = re.search(r'from\s+(\d+\.\d+\.\d+\.\d+(?:/\d+)?)', line)
                    if match:
                        blocked_ips.append({
                            'ip': match.group(1),
                            'rule': line
                        })

        return {
            'success': True,
            'firewall': firewall,
            'blocked_ips': blocked_ips
        }

    @classmethod
    def get_zones(cls) -> Dict:
        """Get firewalld zones (firewalld only)."""
        try:
            # Get all zones
            result = subprocess.run(
                ['firewall-cmd', '--get-zones'],
                capture_output=True, text=True
            )
            zones = result.stdout.strip().split()

            # Get default zone
            result = subprocess.run(
                ['firewall-cmd', '--get-default-zone'],
                capture_output=True, text=True
            )
            default_zone = result.stdout.strip()

            zone_details = []
            for zone in zones:
                result = subprocess.run(
                    ['firewall-cmd', f'--zone={zone}', '--list-all'],
                    capture_output=True, text=True
                )
                zone_details.append({
                    'name': zone,
                    'is_default': zone == default_zone,
                    'details': result.stdout
                })

            return {
                'success': True,
                'zones': zone_details,
                'default_zone': default_zone
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def set_default_zone(cls, zone: str) -> Dict:
        """Set default firewalld zone."""
        try:
            result = subprocess.run(
                ['sudo', 'firewall-cmd', f'--set-default-zone={zone}'],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return {'success': True, 'message': f'Default zone set to {zone}'}
            return {'success': False, 'error': result.stderr or 'Failed to set default zone'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def install_firewall(cls, firewall: str = 'ufw') -> Dict:
        """Install a firewall."""
        if firewall not in ['ufw', 'firewalld']:
            return {'success': False, 'error': 'Invalid firewall. Use ufw or firewalld'}

        try:
            # Update package list
            subprocess.run(['sudo', 'apt-get', 'update'], capture_output=True, timeout=120)

            # Install
            result = subprocess.run(
                ['sudo', 'apt-get', 'install', '-y', firewall],
                capture_output=True, text=True, timeout=300
            )

            if result.returncode == 0:
                return {'success': True, 'message': f'{firewall} installed successfully'}
            return {'success': False, 'error': result.stderr or 'Installation failed'}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Installation timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def _is_valid_ip(ip: str) -> bool:
        """Validate IP address format."""
        # IPv4 pattern
        ipv4_pattern = r'^(\d{1,3}\.){3}\d{1,3}(/\d{1,2})?$'
        # IPv6 pattern (simplified)
        ipv6_pattern = r'^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}(/\d{1,3})?$'

        if re.match(ipv4_pattern, ip):
            # Validate each octet
            parts = ip.split('/')[0].split('.')
            return all(0 <= int(part) <= 255 for part in parts)

        return bool(re.match(ipv6_pattern, ip))
