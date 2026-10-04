"""Plan 88 §C: the common error families carry a stable, translatable `code`.

The frontend swaps the server's English for its own translation when it knows
the code (``frontend/src/services/api/errorCodes.js``), so these tests pin both
halves of that contract: the body a route returns, and that every
``not_found.<resource>`` the backend can mint has a client entry.
"""

import os
import re

import pytest

from app import db
from app.exceptions import (
    PERMISSION_DENIED_MESSAGE, RESOURCE_LABELS, already_exists, field_required, not_found,
)

ERROR_CODES_JS = os.path.join(
    os.path.dirname(__file__), '..', '..', 'frontend', 'src', 'services', 'api', 'errorCodes.js')


def test_missing_service_has_a_resource_code(client, auth_headers):
    resp = client.get('/api/v1/apps/999999', headers=auth_headers)
    body = resp.get_json()
    assert resp.status_code == 404
    assert body['error'] == 'Service not found'
    assert body['code'] == 'not_found.service'
    assert body['details'] == {'resource': 'service'}
    assert body['request_id'] == resp.headers['X-Request-ID']


def test_missing_server_has_a_resource_code(client, auth_headers):
    resp = client.post('/api/v1/servers/no-such-server/ping', headers=auth_headers)
    assert resp.status_code == 404
    assert resp.get_json()['code'] == 'not_found.server'


def test_offline_agent_is_503_agent_offline(app, client, auth_headers):
    from tests.factories import make_server
    with app.app_context():
        server_id = make_server(db, name='offline-box').id
    resp = client.post(f'/api/v1/servers/{server_id}/ping', headers=auth_headers)
    assert resp.status_code == 503
    assert resp.get_json()['code'] == 'agent.offline'


def test_duplicate_domain_is_conflict_exists(app, client, auth_headers):
    from app.models import Domain
    from tests.factories import make_application
    with app.app_context():
        app_id = make_application(db, name='dup', port=8001).id
        db.session.add(Domain(name='dup.example.com', application_id=app_id))
        db.session.commit()
    resp = client.post('/api/v1/domains', headers=auth_headers,
                       json={'name': 'dup.example.com', 'application_id': app_id})
    body = resp.get_json()
    assert resp.status_code == 409
    assert body['code'] == 'conflict.exists'
    assert body['details'] == {'resource': 'domain'}


def test_purging_a_missing_record_is_still_404(client, auth_headers):
    """The status used to come from `err == 'not found'`; rewording the message
    must not be able to turn it into a 400."""
    resp = client.delete('/api/v1/recycle-bin/domain/999999', headers=auth_headers)
    assert resp.status_code == 404
    assert resp.get_json()['code'] == 'not_found'


def test_deleting_an_unknown_theme_is_still_404(client, auth_headers):
    resp = client.delete('/api/v1/themes/no-such-theme', headers=auth_headers)
    assert resp.status_code == 404


def test_factories_mint_one_message_per_code():
    assert str(not_found('service')) == 'Service not found'
    required = field_required('name')
    assert (required.code, required.details, required.status_code) == (
        'validation.required', {'field': 'name'}, 400)
    assert already_exists('domain').code == 'conflict.exists'
    with pytest.raises(ValueError):
        not_found('widget')  # an unlisted kind would ship an untranslated code


def test_permission_denied_message_matches_the_client():
    with open(ERROR_CODES_JS, encoding='utf-8') as f:
        source = f.read()
    assert PERMISSION_DENIED_MESSAGE in source


def test_every_resource_kind_has_a_client_translation():
    with open(ERROR_CODES_JS, encoding='utf-8') as f:
        translated = set(re.findall(r"'not_found\.([a-z_]+)'", f.read()))
    assert translated == set(RESOURCE_LABELS), (
        'add the missing not_found.<resource> entries to errorCodes.js '
        '(or drop the unused kind from RESOURCE_LABELS)')
