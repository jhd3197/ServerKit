"""
Resource Tier Service

Determines server resource tier based on CPU and RAM, and controls
feature availability accordingly.

Tiers:
- lite: 1 CPU core OR <2GB RAM - Limited features (no WordPress creation)
- standard: 2-3 cores, 2-4GB RAM - Most features enabled
- performance: 4+ cores, >4GB RAM - All features enabled
"""

import time
import psutil

# Module-level cache with 1-hour TTL
_tier_cache = {
    'data': None,
    'timestamp': 0,
    'ttl': 3600  # 1 hour
}


class ResourceTierService:
    """Service for determining server resource tier and feature availability."""

    TIER_LITE = 'lite'
    TIER_STANDARD = 'standard'
    TIER_PERFORMANCE = 'performance'

    # Minimum requirements for WordPress
    MIN_CORES_FOR_WORDPRESS = 2
    MIN_RAM_GB_FOR_WORDPRESS = 2

    @classmethod
    def get_tier_info(cls, force_refresh=False):
        """
        Get resource tier information including specs, tier, and feature permissions.

        Args:
            force_refresh: If True, bypass cache and recalculate

        Returns:
            dict: {
                'tier': 'lite'|'standard'|'performance',
                'specs': {'cpu_cores': int, 'ram_gb': float, 'ram_bytes': int},
                'features': {'wordpress_create': bool, ...},
                'cached': bool
            }
        """
        global _tier_cache

        current_time = time.time()
        cache_valid = (
            _tier_cache['data'] is not None and
            (current_time - _tier_cache['timestamp']) < _tier_cache['ttl']
        )

        if cache_valid and not force_refresh:
            return {**_tier_cache['data'], 'cached': True}

        # Get system specs
        specs = cls._get_system_specs()

        # Calculate tier
        tier = cls._calculate_tier(specs)

        # Get features for this tier
        features = cls._get_features_for_tier(tier, specs)

        result = {
            'tier': tier,
            'specs': specs,
            'features': features,
            'cached': False
        }

        # Update cache
        _tier_cache['data'] = {
            'tier': tier,
            'specs': specs,
            'features': features
        }
        _tier_cache['timestamp'] = current_time

        return result

    @classmethod
    def _get_system_specs(cls):
        """
        Get system CPU and RAM specifications using psutil.

        Returns:
            dict: {'cpu_cores': int, 'ram_gb': float, 'ram_bytes': int}
        """
        cpu_cores = psutil.cpu_count(logical=False) or psutil.cpu_count(logical=True) or 1
        memory = psutil.virtual_memory()
        ram_bytes = memory.total
        ram_gb = round(ram_bytes / (1024 ** 3), 2)

        return {
            'cpu_cores': cpu_cores,
            'ram_gb': ram_gb,
            'ram_bytes': ram_bytes
        }

    @classmethod
    def _calculate_tier(cls, specs):
        """
        Determine tier based on system specs.

        Tier determination:
        - Lite: 1 core OR <2GB RAM
        - Performance: 4+ cores AND >4GB RAM
        - Standard: Everything else (2-3 cores, 2-4GB RAM)

        Args:
            specs: dict from _get_system_specs()

        Returns:
            str: 'lite', 'standard', or 'performance'
        """
        cpu_cores = specs['cpu_cores']
        ram_gb = specs['ram_gb']

        # Lite tier: single core or very low RAM
        if cpu_cores < 2 or ram_gb < 2:
            return cls.TIER_LITE

        # Performance tier: high resources
        if cpu_cores >= 4 and ram_gb > 4:
            return cls.TIER_PERFORMANCE

        # Standard tier: moderate resources
        return cls.TIER_STANDARD

    @classmethod
    def _get_features_for_tier(cls, tier, specs):
        """
        Get feature permissions based on tier and specs.

        Args:
            tier: The calculated tier string
            specs: System specs dict

        Returns:
            dict: Feature permission flags
        """
        # WordPress creation requires minimum resources
        can_create_wordpress = (
            specs['cpu_cores'] >= cls.MIN_CORES_FOR_WORDPRESS and
            specs['ram_gb'] >= cls.MIN_RAM_GB_FOR_WORDPRESS
        )

        return {
            'wordpress_create': can_create_wordpress,
            'wordpress_manage': True,  # Always allow managing existing sites
            'docker': True,  # Docker available on all tiers
            'databases': True,  # Database management available on all tiers
        }

    @classmethod
    def can_create_wordpress(cls):
        """
        Quick check if WordPress site creation is allowed.

        Returns:
            bool: True if WordPress creation is permitted
        """
        tier_info = cls.get_tier_info()
        return tier_info['features']['wordpress_create']

    @classmethod
    def get_minimum_requirements(cls):
        """
        Get the minimum requirements for WordPress creation.

        Returns:
            dict: {'cpu_cores': int, 'ram_gb': int}
        """
        return {
            'cpu_cores': cls.MIN_CORES_FOR_WORDPRESS,
            'ram_gb': cls.MIN_RAM_GB_FOR_WORDPRESS
        }
