"""
IP address utilities for ServerKit.

Provides IP matching with support for single IPs, CIDR notation, and wildcards.
"""

import ipaddress
import re
from typing import List


def is_ip_allowed(client_ip: str, allowed_list: List[str]) -> bool:
    """
    Check if a client IP is allowed based on an allowlist.

    Supports:
    - Single IP addresses: "192.168.1.100"
    - CIDR notation: "192.168.1.0/24"
    - Wildcards: "192.168.1.*" or "192.168.*.*"
    - IPv6 addresses and CIDR: "2001:db8::/32"

    Args:
        client_ip: The client IP address to check
        allowed_list: List of allowed IP patterns

    Returns:
        bool: True if the IP is allowed, False otherwise
    """
    if not allowed_list:
        # Empty list means all IPs are allowed
        return True

    try:
        # Parse the client IP
        client_addr = ipaddress.ip_address(client_ip)
    except ValueError:
        # Invalid IP address format
        return False

    for pattern in allowed_list:
        if not pattern:
            continue

        try:
            # Check for wildcard pattern (e.g., "192.168.1.*")
            if '*' in pattern:
                if _match_wildcard(client_ip, pattern):
                    return True
                continue

            # Check for CIDR notation (e.g., "192.168.1.0/24")
            if '/' in pattern:
                network = ipaddress.ip_network(pattern, strict=False)
                if client_addr in network:
                    return True
                continue

            # Check for exact match
            allowed_addr = ipaddress.ip_address(pattern)
            if client_addr == allowed_addr:
                return True

        except ValueError:
            # Invalid pattern, skip it
            continue

    return False


def _match_wildcard(ip: str, pattern: str) -> bool:
    """
    Match an IP address against a wildcard pattern.

    Args:
        ip: The IP address to check
        pattern: Wildcard pattern like "192.168.1.*" or "192.168.*.*"

    Returns:
        bool: True if the IP matches the pattern
    """
    # Convert wildcard pattern to regex
    # Escape dots and replace * with digit pattern
    regex_pattern = pattern.replace('.', r'\.')
    regex_pattern = regex_pattern.replace('*', r'\d{1,3}')
    regex_pattern = f'^{regex_pattern}$'

    return bool(re.match(regex_pattern, ip))


def validate_ip_pattern(pattern: str) -> tuple:
    """
    Validate an IP pattern.

    Args:
        pattern: The IP pattern to validate

    Returns:
        tuple: (is_valid: bool, error_message: str or None)
    """
    if not pattern:
        return False, "Pattern cannot be empty"

    # Check for wildcard pattern
    if '*' in pattern:
        # Validate wildcard format
        parts = pattern.split('.')
        if len(parts) != 4:
            return False, "Invalid wildcard pattern format"

        for part in parts:
            if part == '*':
                continue
            try:
                num = int(part)
                if num < 0 or num > 255:
                    return False, f"Invalid octet value: {part}"
            except ValueError:
                return False, f"Invalid octet: {part}"

        return True, None

    # Check for CIDR notation
    if '/' in pattern:
        try:
            ipaddress.ip_network(pattern, strict=False)
            return True, None
        except ValueError as e:
            return False, str(e)

    # Check for single IP
    try:
        ipaddress.ip_address(pattern)
        return True, None
    except ValueError as e:
        return False, str(e)


def normalize_ip(ip: str) -> str:
    """
    Normalize an IP address to a standard format.

    Args:
        ip: The IP address to normalize

    Returns:
        str: Normalized IP address
    """
    try:
        return str(ipaddress.ip_address(ip))
    except ValueError:
        return ip


def get_ip_info(ip: str) -> dict:
    """
    Get information about an IP address.

    Args:
        ip: The IP address to analyze

    Returns:
        dict: Information about the IP
    """
    try:
        addr = ipaddress.ip_address(ip)
        return {
            'ip': str(addr),
            'version': addr.version,
            'is_private': addr.is_private,
            'is_loopback': addr.is_loopback,
            'is_multicast': addr.is_multicast,
            'is_reserved': addr.is_reserved,
            'is_global': addr.is_global,
        }
    except ValueError:
        return {
            'ip': ip,
            'error': 'Invalid IP address'
        }
