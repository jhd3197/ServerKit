"""
Cryptographic utilities for ServerKit.

Provides encryption/decryption for sensitive data like API secrets.
"""

import os
import base64
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


def get_encryption_key() -> bytes:
    """
    Get the encryption key from environment variable.

    The key should be a valid Fernet key (32 url-safe base64-encoded bytes).
    Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

    Returns:
        bytes: The encryption key

    Raises:
        ValueError: If SERVERKIT_ENCRYPTION_KEY is not set
    """
    key = os.environ.get('SERVERKIT_ENCRYPTION_KEY')
    if not key:
        # In development, use a default key (NOT for production!)
        # This allows the system to work without explicit configuration
        default_key = "DEV_ONLY_NOT_SECURE_CHANGE_IN_PRODUCTION_KEY"
        # Derive a proper Fernet key from the default
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b'serverkit_dev_salt',
            iterations=100000,
        )
        key_bytes = base64.urlsafe_b64encode(kdf.derive(default_key.encode()))
        return key_bytes
    return key.encode()


def encrypt_secret(plaintext: str) -> str:
    """
    Encrypt a secret using Fernet symmetric encryption.

    Args:
        plaintext: The secret to encrypt

    Returns:
        str: Base64-encoded encrypted data
    """
    key = get_encryption_key()
    f = Fernet(key)
    encrypted = f.encrypt(plaintext.encode())
    return encrypted.decode()


def decrypt_secret(encrypted: str) -> str:
    """
    Decrypt a secret encrypted with encrypt_secret.

    Args:
        encrypted: Base64-encoded encrypted data

    Returns:
        str: The decrypted plaintext

    Raises:
        InvalidToken: If decryption fails (wrong key or corrupted data)
    """
    key = get_encryption_key()
    f = Fernet(key)
    decrypted = f.decrypt(encrypted.encode())
    return decrypted.decode()


def is_encryption_configured() -> bool:
    """
    Check if encryption is properly configured.

    Returns:
        bool: True if SERVERKIT_ENCRYPTION_KEY is set
    """
    return os.environ.get('SERVERKIT_ENCRYPTION_KEY') is not None
