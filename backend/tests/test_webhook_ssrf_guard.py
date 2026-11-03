"""User-configured webhook URLs must go through app.utils.safe_http."""
import pytest

from app.notifications.channels.base import DeliveryResult
from app.services.chat_webhook_service import ChatWebhookService
from app.services.monitoring_service import MonitoringService

PRIVATE_URLS = ['http://127.0.0.1:5000/hook', 'http://169.254.169.254/latest/meta-data', 'http://localhost/x']


@pytest.mark.parametrize('url', PRIVATE_URLS)
def test_monitoring_webhook_refuses_private_targets(url, monkeypatch):
    monkeypatch.setattr(MonitoringService, 'get_config',
                        classmethod(lambda cls: {'webhook': {'enabled': True, 'url': url}}))
    result = MonitoringService.send_webhook_alert([{'type': 'cpu'}])
    assert result['success'] is False
    assert 'refused' in result['error']


@pytest.mark.parametrize('url', PRIVATE_URLS)
def test_chat_webhook_refuses_private_targets(url):
    class _Notification:
        severity = 'info'
        event_key = 'x'
        title = 't'
        body = 'b'
        created_at = None
        category = 'c'
        action_path = None
        id = 1

        def get_data(self):
            return {}

    result = ChatWebhookService._deliver_webhook(None, {'url': url}, _Notification())
    assert result.status == DeliveryResult.SKIPPED  # terminal: the queue must not retry
    assert 'refused' in result.error
