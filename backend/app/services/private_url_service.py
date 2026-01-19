"""Service for managing private URLs for applications."""

import secrets
import string
import re
from typing import Optional, Tuple


class PrivateURLService:
    """Service for managing private URLs for applications."""

    # Slug configuration
    SLUG_ALPHABET = string.ascii_lowercase + string.digits
    DEFAULT_SLUG_LENGTH = 12
    MIN_SLUG_LENGTH = 3
    MAX_SLUG_LENGTH = 50

    # Reserved slugs (system paths)
    RESERVED_SLUGS = {'api', 'admin', 'static', 'assets', 'health', 'status'}

    @classmethod
    def generate_slug(cls, length: int = None) -> str:
        """Generate a cryptographically secure random slug.

        Args:
            length: Optional length for the slug. Defaults to DEFAULT_SLUG_LENGTH.

        Returns:
            A random alphanumeric slug.
        """
        length = length or cls.DEFAULT_SLUG_LENGTH
        return ''.join(secrets.choice(cls.SLUG_ALPHABET) for _ in range(length))

    @classmethod
    def validate_slug(cls, slug: str) -> Tuple[bool, Optional[str]]:
        """Validate a custom slug.

        Args:
            slug: The slug to validate.

        Returns:
            Tuple of (is_valid, error_message). error_message is None if valid.
        """
        if not slug:
            return False, "Slug cannot be empty"

        if len(slug) < cls.MIN_SLUG_LENGTH:
            return False, f"Slug must be at least {cls.MIN_SLUG_LENGTH} characters"

        if len(slug) > cls.MAX_SLUG_LENGTH:
            return False, f"Slug cannot exceed {cls.MAX_SLUG_LENGTH} characters"

        # Only alphanumeric and hyphens allowed
        # Must start and end with alphanumeric (or be single char)
        if not re.match(r'^[a-z0-9]([a-z0-9-]*[a-z0-9])?$', slug):
            return False, "Slug must contain only lowercase letters, numbers, and hyphens (cannot start or end with hyphen)"

        # No consecutive hyphens
        if '--' in slug:
            return False, "Slug cannot contain consecutive hyphens"

        # Check reserved
        if slug.lower() in cls.RESERVED_SLUGS:
            return False, f"Slug '{slug}' is reserved"

        return True, None

    @classmethod
    def is_slug_available(cls, slug: str, exclude_app_id: int = None) -> bool:
        """Check if a slug is available (not used by another app).

        Args:
            slug: The slug to check.
            exclude_app_id: Optional app ID to exclude from the check (for updates).

        Returns:
            True if the slug is available, False otherwise.
        """
        from app.models import Application

        query = Application.query.filter_by(private_slug=slug)
        if exclude_app_id:
            query = query.filter(Application.id != exclude_app_id)

        return query.first() is None

    @classmethod
    def generate_unique_slug(cls, max_attempts: int = 10) -> Optional[str]:
        """Generate a unique slug that doesn't exist in the database.

        Args:
            max_attempts: Maximum number of attempts to generate a unique slug.

        Returns:
            A unique slug, or None if max_attempts exceeded.
        """
        for _ in range(max_attempts):
            slug = cls.generate_slug()
            if cls.is_slug_available(slug):
                return slug
        return None
