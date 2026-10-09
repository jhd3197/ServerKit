"""/api/v1/ports: the check behind the shared PortField input."""
import pytest

from app import db
from app.services import port_service
from app.services.template_service import TemplateService
from tests.factories import make_application


@pytest.fixture(autouse=True)
def _no_docker_or_sockets(monkeypatch):
    # Hermetic: no `docker ps`, and every unheld port binds.
    monkeypatch.setattr(TemplateService, '_get_docker_used_ports', classmethod(lambda cls: set()))
    monkeypatch.setattr(TemplateService, '_port_is_free', classmethod(
        lambda cls, port: port not in TemplateService._get_database_used_ports()))


def test_free_port(client, developer_headers):
    res = client.get('/api/v1/ports/check?port=18080', headers=developer_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body == {'port': 18080, 'valid': True, 'free': True, 'privileged': False,
                    'holder': None, 'reason': None}


def test_port_held_by_an_app_names_it(app, client, developer_headers):
    make_application(db, name='shop-api', port=18081)
    body = client.get('/api/v1/ports/check?port=18081', headers=developer_headers).get_json()
    assert body['free'] is False
    assert body['reason'] == 'in_use'
    assert body['holder']['kind'] == 'app'
    assert body['holder']['name'] == 'shop-api'


@pytest.mark.parametrize('raw,reason', [('abc', 'not_a_number'), ('0', 'out_of_range'),
                                        ('70000', 'out_of_range'), (None, 'not_a_number')])
def test_invalid_ports(raw, reason):
    body = port_service.check_port(raw)
    assert body['valid'] is False and body['free'] is False
    assert body['reason'] == reason


def test_privileged_port_is_flagged():
    assert port_service.check_port(80)['privileged'] is True


def test_bound_outside_serverkit(monkeypatch):
    monkeypatch.setattr(TemplateService, '_port_is_free', classmethod(lambda cls, port: False))
    body = port_service.check_port(18082)
    assert body['free'] is False and body['holder'] is None and body['reason'] == 'bound'


def test_suggest_skips_taken_ports(app, client, developer_headers, monkeypatch):
    make_application(db, name='a', port=18090)
    monkeypatch.setattr('socket.socket.bind', lambda self, addr: None)
    body = client.get('/api/v1/ports/suggest?start=18090', headers=developer_headers).get_json()
    assert body['port'] == 18091


def test_requires_developer(client, viewer_headers):
    assert client.get('/api/v1/ports/check?port=8080', headers=viewer_headers).status_code == 403
