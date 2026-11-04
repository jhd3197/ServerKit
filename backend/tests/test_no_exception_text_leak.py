"""Unexpected failures answer with a generic message; the detail is only logged."""
from app.services import sso_service


def test_sso_authorize_does_not_echo_exception_text(client, monkeypatch):
    def boom(*a, **kw):
        raise RuntimeError('secret internal path /etc/serverkit/oidc.key')
    monkeypatch.setattr(sso_service, 'generate_auth_url', boom)

    resp = client.get('/api/v1/sso/authorize/google?redirect_uri=http://localhost/cb')

    assert resp.status_code == 400
    assert '/etc/serverkit' not in resp.get_data(as_text=True)
