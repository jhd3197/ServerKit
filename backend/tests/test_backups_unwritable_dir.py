"""GET /backups must not 500 when the backup directory cannot be created."""
import pytest

from app.services.backup_service import BackupService


@pytest.fixture
def unwritable(monkeypatch):
    def deny():
        raise PermissionError(13, 'Permission denied', '/var/backups/serverkit')
    monkeypatch.setattr(BackupService, 'ensure_backup_dirs', deny)


@pytest.mark.parametrize('path', ['/api/v1/backups', '/api/v1/backups/stats'])
def test_get_degrades_with_a_warning(client, auth_headers, unwritable, path):
    resp = client.get(path, headers=auth_headers)

    assert resp.status_code == 200
    body = resp.get_json()
    assert 'not accessible' in body['warning']
    assert '/var/backups' not in body['warning']
    assert body.get('backups', []) == []


def test_create_returns_503_with_code_when_dir_unwritable(client, auth_headers, unwritable):
    resp = client.post('/api/v1/backups/database', headers=auth_headers,
                       json={'db_type': 'mysql', 'db_name': 'x'})

    assert resp.status_code == 503
    body = resp.get_json()
    assert body['code'] == 'backup_dir_unavailable'
    assert body['error'] == 'Backup directory is not writable'
    assert '/var/backups' not in resp.get_data(as_text=True)
