"""
Two-Factor Authentication (2FA) Service

Handles TOTP generation, verification, backup codes, and QR code provisioning.
Uses pyotp for TOTP implementation (RFC 6238 compliant).
"""

import pyotp
import secrets
import hashlib
import base64
from io import BytesIO
from datetime import datetime

# QR code generation
try:
    import qrcode
    HAS_QRCODE = True
except ImportError:
    HAS_QRCODE = False


class TOTPService:
    """Service for managing TOTP-based two-factor authentication."""

    # App name for authenticator apps
    ISSUER_NAME = "ServerKit"

    # TOTP settings
    DIGITS = 6
    INTERVAL = 30  # seconds

    # Backup codes settings
    BACKUP_CODE_LENGTH = 8
    BACKUP_CODE_COUNT = 10

    @staticmethod
    def generate_secret():
        """Generate a new TOTP secret key."""
        return pyotp.random_base32()

    @staticmethod
    def get_totp(secret):
        """Get a TOTP instance for the given secret."""
        return pyotp.TOTP(secret, digits=TOTPService.DIGITS, interval=TOTPService.INTERVAL)

    @staticmethod
    def verify_code(secret, code, valid_window=1):
        """
        Verify a TOTP code.

        Args:
            secret: The user's TOTP secret
            code: The 6-digit code to verify
            valid_window: Number of time periods to check before/after current

        Returns:
            bool: True if code is valid
        """
        if not secret or not code:
            return False

        # Clean the code (remove spaces, dashes)
        code = code.replace(' ', '').replace('-', '')

        # Must be digits only
        if not code.isdigit():
            return False

        totp = TOTPService.get_totp(secret)
        return totp.verify(code, valid_window=valid_window)

    @staticmethod
    def get_current_code(secret):
        """Get the current TOTP code (for testing)."""
        totp = TOTPService.get_totp(secret)
        return totp.now()

    @staticmethod
    def get_provisioning_uri(secret, email):
        """
        Get the provisioning URI for authenticator apps.

        This URI is used to generate QR codes that can be scanned
        by Google Authenticator, Authy, 1Password, etc.
        """
        totp = TOTPService.get_totp(secret)
        return totp.provisioning_uri(
            name=email,
            issuer_name=TOTPService.ISSUER_NAME
        )

    @staticmethod
    def generate_qr_code_base64(secret, email):
        """
        Generate a QR code as base64 encoded PNG.

        Returns:
            str: Base64 encoded PNG image, or None if qrcode not available
        """
        if not HAS_QRCODE:
            return None

        uri = TOTPService.get_provisioning_uri(secret, email)

        # Generate QR code
        qr = qrcode.QRCode(
            version=1,
            error_correction=qrcode.constants.ERROR_CORRECT_L,
            box_size=10,
            border=4,
        )
        qr.add_data(uri)
        qr.make(fit=True)

        # Create image
        img = qr.make_image(fill_color="black", back_color="white")

        # Convert to base64
        buffer = BytesIO()
        img.save(buffer, format='PNG')
        buffer.seek(0)
        img_base64 = base64.b64encode(buffer.getvalue()).decode()

        return f"data:image/png;base64,{img_base64}"

    @staticmethod
    def generate_backup_codes():
        """
        Generate a set of backup codes.

        Returns:
            tuple: (plain_codes, hashed_codes)
                - plain_codes: List of codes to show to user (one-time only)
                - hashed_codes: List of SHA256 hashes to store in database
        """
        plain_codes = []
        hashed_codes = []

        for _ in range(TOTPService.BACKUP_CODE_COUNT):
            # Generate random code (e.g., "a1b2c3d4")
            code = secrets.token_hex(TOTPService.BACKUP_CODE_LENGTH // 2)
            plain_codes.append(code)

            # Hash for storage
            code_hash = hashlib.sha256(code.encode()).hexdigest()
            hashed_codes.append(code_hash)

        return plain_codes, hashed_codes

    @staticmethod
    def verify_backup_code(code, hashed_codes):
        """
        Verify a backup code against stored hashes.

        Args:
            code: The backup code entered by user
            hashed_codes: List of valid backup code hashes

        Returns:
            str or None: The matching hash if valid, None otherwise
        """
        if not code or not hashed_codes:
            return None

        # Clean the code
        code = code.lower().replace(' ', '').replace('-', '')

        # Hash the input
        code_hash = hashlib.sha256(code.encode()).hexdigest()

        if code_hash in hashed_codes:
            return code_hash

        return None

    @staticmethod
    def format_backup_codes(codes):
        """Format backup codes for display (add dashes for readability)."""
        formatted = []
        for code in codes:
            # Format as "a1b2-c3d4" for 8-char codes
            mid = len(code) // 2
            formatted.append(f"{code[:mid]}-{code[mid:]}")
        return formatted


class TwoFactorSetup:
    """Helper class for managing 2FA setup flow."""

    def __init__(self, user):
        self.user = user

    def initiate_setup(self):
        """
        Start 2FA setup by generating a new secret.

        Returns:
            dict: Setup data including secret and QR code
        """
        from app import db

        # Generate new secret (don't enable yet)
        secret = TOTPService.generate_secret()
        self.user.totp_secret = secret

        # Don't enable until verified
        db.session.commit()

        # Generate QR code
        qr_code = TOTPService.generate_qr_code_base64(secret, self.user.email)
        uri = TOTPService.get_provisioning_uri(secret, self.user.email)

        return {
            'secret': secret,  # For manual entry
            'qr_code': qr_code,  # Base64 PNG
            'uri': uri,  # For advanced users
            'issuer': TOTPService.ISSUER_NAME
        }

    def confirm_setup(self, code):
        """
        Confirm 2FA setup by verifying the first code.

        Returns:
            tuple: (success, backup_codes or error_message)
        """
        from app import db

        if not self.user.totp_secret:
            return False, "2FA setup not initiated"

        # Verify the code
        if not TOTPService.verify_code(self.user.totp_secret, code):
            return False, "Invalid verification code"

        # Generate backup codes
        plain_codes, hashed_codes = TOTPService.generate_backup_codes()

        # Enable 2FA
        self.user.totp_enabled = True
        self.user.totp_confirmed_at = datetime.utcnow()
        self.user.set_backup_codes(hashed_codes)

        db.session.commit()

        # Return formatted backup codes (one-time display)
        formatted_codes = TOTPService.format_backup_codes(plain_codes)

        return True, formatted_codes

    def disable(self, code_or_backup):
        """
        Disable 2FA for the user.

        Args:
            code_or_backup: Either a TOTP code or backup code

        Returns:
            tuple: (success, error_message or None)
        """
        from app import db

        if not self.user.totp_enabled:
            return False, "2FA is not enabled"

        # Try TOTP code first
        if TOTPService.verify_code(self.user.totp_secret, code_or_backup):
            self._clear_totp()
            db.session.commit()
            return True, None

        # Try backup code
        backup_codes = self.user.get_backup_codes()
        matched_hash = TOTPService.verify_backup_code(code_or_backup, backup_codes)
        if matched_hash:
            self._clear_totp()
            db.session.commit()
            return True, None

        return False, "Invalid verification code"

    def _clear_totp(self):
        """Clear all 2FA data from user."""
        self.user.totp_secret = None
        self.user.totp_enabled = False
        self.user.backup_codes = None
        self.user.totp_confirmed_at = None

    def regenerate_backup_codes(self, totp_code):
        """
        Regenerate backup codes (requires valid TOTP code).

        Returns:
            tuple: (success, new_codes or error_message)
        """
        from app import db

        if not self.user.totp_enabled:
            return False, "2FA is not enabled"

        if not TOTPService.verify_code(self.user.totp_secret, totp_code):
            return False, "Invalid verification code"

        # Generate new backup codes
        plain_codes, hashed_codes = TOTPService.generate_backup_codes()
        self.user.set_backup_codes(hashed_codes)

        db.session.commit()

        formatted_codes = TOTPService.format_backup_codes(plain_codes)
        return True, formatted_codes

    def get_remaining_backup_codes_count(self):
        """Get the number of remaining backup codes."""
        codes = self.user.get_backup_codes()
        return len(codes)
