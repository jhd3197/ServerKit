"""Pytest fixtures for backend tests (Flask app, DB, client)."""
import os
import sys

import pytest

# Ensure backend root is on path
_backend = os.path.dirname(os.path.abspath(__file__))
if _backend not in sys.path:
    sys.path.insert(0, _backend)

os.environ.setdefault('FLASK_ENV', 'testing')


@pytest.fixture(scope='function')
def app():
    """Create Flask app with testing config and in-memory DB."""
    from app import create_app
    from app import db as _db

    app = create_app('testing')
    with app.app_context():
        _db.create_all()
        yield app
        _db.session.remove()
        _db.drop_all()


@pytest.fixture
def client(app):
    """Flask test client."""
    return app.test_client()


@pytest.fixture
def db_session(app):
    """Database session for the current test (same as app's db)."""
    from app import db
    return db


@pytest.fixture
def auth_headers(app):
    """Create an admin user and return headers with valid JWT for API tests."""
    from app import db
    from app.models import User
    from flask_jwt_extended import create_access_token
    from werkzeug.security import generate_password_hash

    with app.app_context():
        user = User(
            email='testadmin@test.local',
            username='testadmin',
            password_hash=generate_password_hash('testpass'),
            role=User.ROLE_ADMIN,
            is_active=True,
        )
        db.session.add(user)
        db.session.commit()
        token = create_access_token(identity=user.id)
    return {'Authorization': f'Bearer {token}'}
