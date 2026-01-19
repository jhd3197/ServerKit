import os
import sys
from datetime import timedelta

# Default insecure keys that must be changed in production
INSECURE_SECRET_KEYS = [
    'dev-secret-key-change-in-production',
    'jwt-secret-key-change-in-production',
    'change-this-to-a-secure-random-string',
    'change-this-to-another-secure-random-string',
]


class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')

    # Database - use instance folder for Flask convention
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL', 'sqlite:////app/instance/serverkit.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # JWT
    JWT_SECRET_KEY = os.environ.get('JWT_SECRET_KEY', 'jwt-secret-key-change-in-production')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)

    # CORS - Allow both dev server and Flask server
    CORS_ORIGINS = os.environ.get('CORS_ORIGINS', 'http://localhost:5173,http://localhost:5000,http://127.0.0.1:5173,http://127.0.0.1:5000').split(',')


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False

    def __init__(self):
        # Validate that secret keys are not default values in production
        if self.SECRET_KEY in INSECURE_SECRET_KEYS:
            print("FATAL: SECRET_KEY is set to a default insecure value in production mode!", file=sys.stderr)
            print("Generate a secure key with: python -c \"import secrets; print(secrets.token_hex(32))\"", file=sys.stderr)
            sys.exit(1)

        if self.JWT_SECRET_KEY in INSECURE_SECRET_KEYS:
            print("FATAL: JWT_SECRET_KEY is set to a default insecure value in production mode!", file=sys.stderr)
            print("Generate a secure key with: python -c \"import secrets; print(secrets.token_hex(32))\"", file=sys.stderr)
            sys.exit(1)


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'default': DevelopmentConfig
}
