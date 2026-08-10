"""Org-level chat/webhook connections (plan 24 Phase 4).

Proves connection CRUD + encryption, category-matched routing (the bus fans a
notification out to matching connections), HMAC signing of the generic webhook
payload, the consumer delivery path, and legacy-import idempotency.
"""
import hashlib
import hmac
import json

import pytest
from werkzeug.security import generate_password_hash

from app import db
from app.models import User
from app.models.chat_webhook import ChatWebhookConnection
from app.models.notification_preferences import NotificationPreferences
from app.notifications.consumer import process_message
from app.notifications.models import NotificationDelivery
from app.notifications.service import GROUP_SLUG, QUEUE_SLUG, NotificationBusService
from app.queue_bus.service import QueueBusService
from app.services.chat_webhook_service import ChatWebhookService


@pytest.fixture(autouse=True)
def reset_broker(app):
    QueueBusService.reset_broker()


def _make_user(username='alice', email='alice@example.com'):
    user = User(email=email, username=username,
                password_hash=generate_password_hash('x'), role='developer', is_active=True)
    db.session.add(user)
    db.session.commit()
    # Enable everything so per-user gating never hides the org fan-out under test.
    prefs = NotificationPreferences.get_or_create(user.id)
    prefs.set_severities(['critical', 'warning', 'info', 'success'])
    db.session.commit()
    return user


def _drain():
    msgs = QueueBusService.receive(GROUP_SLUG, QUEUE_SLUG, visibility_timeout_ms=60000, max_messages=100)
    for m in msgs:
        process_message(m)
    return len(msgs)


class TestCrud:
    def test_add_encrypts_and_first_is_default(self, app):
        conn = ChatWebhookService.add({
            'kind': 'webhook', 'name': 'Ops', 'url': 'https://hooks.example/abc',
            'secret': 'shh', 'categories': ['security'],
        })
        assert conn.is_default is True
        # URL + secret encrypted at rest, decrypt back, never serialized.
        assert conn.raw_credentials()['url'] != 'https://hooks.example/abc'
        assert conn.credentials()['url'] == 'https://hooks.example/abc'
        assert 'shh' not in json.dumps(conn.to_dict())
        assert conn.has_signing is True

    def test_add_requires_destination(self, app):
        with pytest.raises(ValueError):
            ChatWebhookService.add({'kind': 'webhook', 'name': 'x'})

    def test_delete_promotes_new_default(self, app):
        a = ChatWebhookService.add({'kind': 'webhook', 'name': 'A', 'url': 'https://x/a'})
        b = ChatWebhookService.add({'kind': 'webhook', 'name': 'B', 'url': 'https://x/b'})
        assert a.is_default and not b.is_default
        ChatWebhookService.delete(a.id)
        db.session.refresh(b)
        assert b.is_default is True

    def test_update_changes_metadata_and_preserves_omitted_credentials(self, app):
        conn = ChatWebhookService.add({
            'kind': 'webhook',
            'name': 'Old name',
            'url': 'https://hooks.example/old',
            'secret': 'keep-me',
            'categories': ['security'],
        })

        updated = ChatWebhookService.update(conn.id, {
            'name': 'New name',
            'categories': ['backups'],
            'is_active': False,
        })

        assert updated.name == 'New name'
        assert updated.categories() == ['backups']
        assert updated.is_active is False
        assert updated.credentials() == {
            'url': 'https://hooks.example/old',
            'secret': 'keep-me',
        }

    def test_update_rotates_supplied_credentials(self, app):
        conn = ChatWebhookService.add({
            'kind': 'webhook',
            'name': 'Ops',
            'url': 'https://hooks.example/old',
            'secret': 'old-secret',
        })

        updated = ChatWebhookService.update(conn.id, {
            'url': 'https://hooks.example/new',
            'secret': 'new-secret',
        })

        assert updated.credentials() == {
            'url': 'https://hooks.example/new',
            'secret': 'new-secret',
        }
        assert updated.raw_credentials()['url'] != 'https://hooks.example/new'
        assert updated.raw_credentials()['secret'] != 'new-secret'

    def test_update_clears_explicitly_empty_optional_credential(self, app):
        conn = ChatWebhookService.add({
            'kind': 'telegram',
            'name': 'Bot',
            'chat_id': '1234',
            'bot_token': 'token-to-clear',
        })

        updated = ChatWebhookService.update(conn.id, {'bot_token': ''})

        assert updated.credentials() == {'chat_id': '1234'}

    def test_update_rejects_kind_change(self, app):
        conn = ChatWebhookService.add({
            'kind': 'discord', 'name': 'Ops', 'url': 'https://discord/hook',
        })

        with pytest.raises(ValueError, match='kind cannot be changed'):
            ChatWebhookService.update(conn.id, {'kind': 'slack'})

    def test_update_rejects_non_list_categories(self, app):
        conn = ChatWebhookService.add({
            'kind': 'discord', 'name': 'Ops', 'url': 'https://discord/hook',
        })

        with pytest.raises(ValueError, match='categories must be a list'):
            ChatWebhookService.update(conn.id, {'categories': 'security'})

    def test_update_rejects_empty_required_destination(self, app):
        conn = ChatWebhookService.add({
            'kind': 'telegram', 'name': 'Bot', 'chat_id': '1234',
        })

        with pytest.raises(ValueError, match='requires a chat_id'):
            ChatWebhookService.update(conn.id, {'chat_id': ''})

    def test_update_validation_failure_does_not_mutate_connection(self, app):
        conn = ChatWebhookService.add({
            'kind': 'telegram',
            'name': 'Original',
            'chat_id': '1234',
            'categories': ['security'],
        })

        with pytest.raises(ValueError, match='requires a chat_id'):
            ChatWebhookService.update(conn.id, {
                'name': 'Changed',
                'categories': ['apps'],
                'is_active': False,
                'chat_id': '',
            })

        assert conn.name == 'Original'
        assert conn.categories() == ['security']
        assert conn.is_active is True


class TestDefaults:
    def test_set_default_is_scoped_to_kind_and_activates_selection(self, app):
        first_discord = ChatWebhookService.add({
            'kind': 'discord', 'name': 'Primary', 'url': 'https://discord/primary',
        })
        second_discord = ChatWebhookService.add({
            'kind': 'discord', 'name': 'Secondary', 'url': 'https://discord/secondary',
            'is_active': False,
        })
        slack = ChatWebhookService.add({
            'kind': 'slack', 'name': 'Slack', 'url': 'https://slack/default',
        })

        selected = ChatWebhookService.set_default(second_discord.id)

        assert selected.id == second_discord.id
        assert selected.is_default is True
        assert selected.is_active is True
        assert first_discord.is_default is False
        assert slack.is_default is True

    def test_set_default_returns_none_for_unknown_id(self, app):
        assert ChatWebhookService.set_default(999999) is None


class TestCategoryRouting:
    def test_catch_all_matches_every_category(self, app):
        conn = ChatWebhookService.add({'kind': 'webhook', 'name': 'All', 'url': 'https://x/all'})
        assert conn.matches_category('backups')
        assert ChatWebhookService.active_for_category('security') == [conn]

    def test_filtered_connection_only_matches_its_categories(self, app):
        ChatWebhookService.add({'kind': 'webhook', 'name': 'Sec', 'url': 'https://x/s',
                                'categories': ['security']})
        assert [c.name for c in ChatWebhookService.active_for_category('security')] == ['Sec']
        assert ChatWebhookService.active_for_category('backups') == []


class TestBusFanout:
    def test_matching_category_gets_a_connection_delivery(self, app):
        user = _make_user()
        conn = ChatWebhookService.add({'kind': 'webhook', 'name': 'Sec', 'url': 'https://x/s',
                                       'categories': ['security']})

        NotificationBusService.send('security.alert', to=user, data={'message': 'breach'})
        chat = NotificationDelivery.query.filter_by(channel='webhook', target=f'conn:{conn.id}').all()
        assert len(chat) == 1
        assert chat[0].recipient_user_id is None  # org-level, not per-user

    def test_non_matching_category_is_skipped(self, app):
        user = _make_user()
        ChatWebhookService.add({'kind': 'webhook', 'name': 'Sec', 'url': 'https://x/s',
                                'categories': ['security']})
        NotificationBusService.send('backup.completed', to=user, data={'app': 'blog'})
        assert NotificationDelivery.query.filter_by(channel='webhook').count() == 0

    def test_directed_send_skips_org_chat(self, app):
        user = _make_user()
        ChatWebhookService.add({'kind': 'webhook', 'name': 'All', 'url': 'https://x/all'})
        # Explicit channels = transactional; org chat must not fan out.
        NotificationBusService.send('user.welcome', to=user, channels=['email'], data={})
        assert NotificationDelivery.query.filter_by(channel='webhook').count() == 0


class TestSigningAndDelivery:
    def test_generic_webhook_signs_and_delivers(self, app, monkeypatch):
        captured = {}

        class _Resp:
            ok = True
            status_code = 200

        def fake_post(url, data=None, headers=None, timeout=None, **kw):
            captured.update({'url': url, 'data': data, 'headers': headers})
            return _Resp()

        monkeypatch.setattr('app.services.chat_webhook_service.requests.post', fake_post)

        user = _make_user()
        conn = ChatWebhookService.add({'kind': 'webhook', 'name': 'Ops', 'url': 'https://hooks/x',
                                       'secret': 'topsecret', 'categories': ['security']})
        NotificationBusService.send('security.alert', to=user, data={'message': 'breach'})
        assert _drain() >= 1

        assert captured['url'] == 'https://hooks/x'
        body = captured['data']
        expected = 'sha256=' + hmac.new(b'topsecret', body, hashlib.sha256).hexdigest()
        assert captured['headers']['X-ServerKit-Signature'] == expected
        payload = json.loads(body)
        assert payload['event'] == 'security.alert'
        assert payload['category'] == 'security'

        delivery = NotificationDelivery.query.filter_by(target=f'conn:{conn.id}').one()
        assert delivery.status == 'sent'

    def test_discord_connection_delegates_to_formatter(self, app, monkeypatch):
        from app.services.notification_service import NotificationService
        seen = {}
        monkeypatch.setattr(NotificationService, 'send_discord',
                            classmethod(lambda cls, alerts, cfg: seen.update({'cfg': cfg}) or {'success': True}))

        user = _make_user()
        ChatWebhookService.add({'kind': 'discord', 'name': 'Room',
                                'url': 'https://discord/webhook'})
        NotificationBusService.send('backup.completed', to=user, data={'app': 'blog'})
        assert _drain() >= 1
        assert seen['cfg']['webhook_url'] == 'https://discord/webhook'


class TestConnectionTesting:
    def test_inactive_connection_can_send_test_through_real_formatter(self, app, monkeypatch):
        captured = {}

        class _Resp:
            status_code = 204
            text = ''

        def fake_post(url, json=None, timeout=None, **kwargs):
            captured.update({'url': url, 'json': json, 'timeout': timeout})
            return _Resp()

        monkeypatch.setattr('app.services.notification_service.requests.post', fake_post)
        conn = ChatWebhookService.add({
            'kind': 'discord',
            'name': 'Disabled room',
            'url': 'https://discord.example/webhook',
            'is_active': False,
        })

        result = ChatWebhookService.test(conn.id)

        assert result == {'success': True, 'message': 'Test notification sent'}
        assert captured['url'] == 'https://discord.example/webhook'
        assert captured['json']['embeds'][0]['description'] == (
            'This is a test notification from ServerKit.'
        )
        assert conn.last_tested_at is not None
        assert conn.last_test_ok is True

    def test_failed_connection_test_persists_failure(self, app, monkeypatch):
        class _Resp:
            ok = False
            status_code = 503

        monkeypatch.setattr(
            'app.services.chat_webhook_service.requests.post',
            lambda *args, **kwargs: _Resp(),
        )
        conn = ChatWebhookService.add({
            'kind': 'webhook', 'name': 'Ops', 'url': 'https://hooks.example/failing',
        })

        result = ChatWebhookService.test(conn.id)

        assert result == {
            'success': False, 'error': 'Test notification failed',
        }
        assert conn.last_tested_at is not None
        assert conn.last_test_ok is False

    def test_connection_test_hides_transport_errors(self, app, monkeypatch):
        def fail_post(*args, **kwargs):
            raise RuntimeError('x' * 500)

        monkeypatch.setattr('app.services.notification_service.requests.post', fail_post)
        conn = ChatWebhookService.add({
            'kind': 'discord', 'name': 'Ops', 'url': 'https://discord.example/webhook',
        })

        result = ChatWebhookService.test(conn.id)

        assert result == {
            'success': False, 'error': 'Test notification failed',
        }
        assert conn.last_test_ok is False

    def test_connection_test_does_not_expose_transport_secrets(self, app, monkeypatch):
        def fail_post(url, *args, **kwargs):
            raise RuntimeError(f'failed POST {url}')

        monkeypatch.setattr(
            'app.services.chat_webhook_service.requests.post', fail_post,
        )
        secret_url = 'https://hooks.example/super-secret-token'
        conn = ChatWebhookService.add({
            'kind': 'webhook', 'name': 'Ops', 'url': secret_url,
        })

        result = ChatWebhookService.test(conn.id)

        assert result == {
            'success': False, 'error': 'Test notification failed',
        }
        assert secret_url not in json.dumps(result)

    def test_connection_test_returns_none_for_unknown_id(self, app):
        assert ChatWebhookService.test(999999) is None


class TestImport:
    def test_import_is_idempotent(self, app, monkeypatch):
        from app.services.notification_service import NotificationService
        cfg = {
            'discord': {'webhook_url': 'https://discord/hook'},
            'slack': {'webhook_url': 'https://hooks.slack/x'},
            'generic_webhook': {'url': 'https://hooks/generic'},
            'telegram': {},
        }
        monkeypatch.setattr(NotificationService, 'get_config', classmethod(lambda cls: cfg))

        assert ChatWebhookService.import_legacy() == 3
        assert ChatWebhookService.import_legacy() == 0  # second run is a no-op
        kinds = {c.kind for c in ChatWebhookConnection.query.filter_by(imported=True).all()}
        assert kinds == {'discord', 'slack', 'webhook'}


class TestApi:
    def test_crud_roundtrip(self, app, client, auth_headers):
        resp = client.post('/api/v1/notifications/admin/chat-connections',
                          json={'kind': 'webhook', 'name': 'Ops', 'url': 'https://x/ops',
                                'categories': ['security']}, headers=auth_headers)
        assert resp.status_code == 201
        cid = resp.get_json()['connection']['id']

        listing = client.get('/api/v1/notifications/admin/chat-connections', headers=auth_headers)
        assert listing.status_code == 200
        body = listing.get_json()
        assert any(c['id'] == cid for c in body['connections'])
        assert 'webhook' in body['kinds']

        dele = client.delete(f'/api/v1/notifications/admin/chat-connections/{cid}', headers=auth_headers)
        assert dele.status_code == 200

    def test_update_connection(self, app, client, auth_headers):
        conn = ChatWebhookService.add({
            'kind': 'webhook',
            'name': 'Old name',
            'url': 'https://hooks.example/original-destination',
            'secret': 'never-serialize-me',
        })

        resp = client.put(
            f'/api/v1/notifications/admin/chat-connections/{conn.id}',
            json={'name': 'New name', 'categories': ['apps'], 'is_active': False},
            headers=auth_headers,
        )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body['success'] is True
        assert body['connection']['name'] == 'New name'
        assert body['connection']['categories'] == ['apps']
        assert body['connection']['is_active'] is False
        assert 'never-serialize-me' not in json.dumps(body)
        assert 'https://hooks.example/original-destination' not in json.dumps(body)

    def test_update_connection_returns_404_for_unknown_id(self, app, client, auth_headers):
        resp = client.put(
            '/api/v1/notifications/admin/chat-connections/999999',
            json={'name': 'Missing'},
            headers=auth_headers,
        )

        assert resp.status_code == 404
        assert resp.get_json() == {'error': 'Connection not found'}

    def test_update_connection_returns_400_for_kind_change(self, app, client, auth_headers):
        conn = ChatWebhookService.add({
            'kind': 'discord', 'name': 'Ops', 'url': 'https://discord/hook',
        })

        resp = client.put(
            f'/api/v1/notifications/admin/chat-connections/{conn.id}',
            json={'kind': 'slack'},
            headers=auth_headers,
        )

        assert resp.status_code == 400
        assert 'kind cannot be changed' in resp.get_json()['error']

    @pytest.mark.parametrize('payload', [[], False, None])
    def test_update_connection_rejects_falsy_non_object_json(self, app, client,
                                                              auth_headers, payload):
        conn = ChatWebhookService.add({
            'kind': 'discord', 'name': 'Ops', 'url': 'https://discord/hook',
        })

        resp = client.put(
            f'/api/v1/notifications/admin/chat-connections/{conn.id}',
            data=json.dumps(payload),
            content_type='application/json',
            headers=auth_headers,
        )

        assert resp.status_code == 400
        assert resp.get_json() == {'error': 'request body must be an object'}

    def test_test_connection_returns_200_on_delivery(self, app, client, auth_headers,
                                                       monkeypatch):
        class _Resp:
            status_code = 204
            text = ''

        monkeypatch.setattr(
            'app.services.notification_service.requests.post',
            lambda *args, **kwargs: _Resp(),
        )
        conn = ChatWebhookService.add({
            'kind': 'discord',
            'name': 'Disabled room',
            'url': 'https://discord.example/webhook',
            'is_active': False,
        })

        resp = client.post(
            f'/api/v1/notifications/admin/chat-connections/{conn.id}/test',
            headers=auth_headers,
        )

        assert resp.status_code == 200
        assert resp.get_json() == {
            'success': True, 'message': 'Test notification sent',
        }
        db.session.refresh(conn)
        assert conn.last_test_ok is True

    def test_test_connection_returns_400_on_delivery_failure(self, app, client,
                                                               auth_headers, monkeypatch):
        class _Resp:
            ok = False
            status_code = 503

        monkeypatch.setattr(
            'app.services.chat_webhook_service.requests.post',
            lambda *args, **kwargs: _Resp(),
        )
        conn = ChatWebhookService.add({
            'kind': 'webhook', 'name': 'Ops', 'url': 'https://hooks.example/failing',
        })

        resp = client.post(
            f'/api/v1/notifications/admin/chat-connections/{conn.id}/test',
            headers=auth_headers,
        )

        assert resp.status_code == 400
        assert resp.get_json() == {
            'success': False, 'error': 'Test notification failed',
        }

    def test_test_connection_returns_404_for_unknown_id(self, app, client, auth_headers):
        resp = client.post(
            '/api/v1/notifications/admin/chat-connections/999999/test',
            headers=auth_headers,
        )

        assert resp.status_code == 404
        assert resp.get_json() == {'error': 'Connection not found'}

    def test_set_default_connection(self, app, client, auth_headers):
        first = ChatWebhookService.add({
            'kind': 'discord', 'name': 'First', 'url': 'https://discord/first',
        })
        second = ChatWebhookService.add({
            'kind': 'discord', 'name': 'Second', 'url': 'https://discord/second',
            'is_active': False,
        })

        resp = client.post(
            f'/api/v1/notifications/admin/chat-connections/{second.id}/default',
            headers=auth_headers,
        )

        assert resp.status_code == 200
        body = resp.get_json()
        assert body['success'] is True
        assert body['connection']['id'] == second.id
        assert body['connection']['is_default'] is True
        assert body['connection']['is_active'] is True
        db.session.refresh(first)
        assert first.is_default is False

    def test_set_default_connection_returns_404_for_unknown_id(self, app, client,
                                                                 auth_headers):
        resp = client.post(
            '/api/v1/notifications/admin/chat-connections/999999/default',
            headers=auth_headers,
        )

        assert resp.status_code == 404
        assert resp.get_json() == {'error': 'Connection not found'}
