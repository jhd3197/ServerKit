"""cron_jobs.json and the off-site storage settings were written with a plain
truncating open(), and their loaders read a damaged file as empty. A full disk
mid-write then silently turned off-site backups back to "local", and the next
cron add saved a file holding only the new job. Both now go through the atomic
config store, which also moves an unreadable file aside."""
import json
from unittest.mock import patch

import pytest

import app.services.cron_service as cron_mod
from app.services.cron_service import CronService
from app.services.storage_provider_service import StorageProviderService


def _fail_dump(*args, **kwargs):
    raise OSError(28, 'No space left on device')


@pytest.fixture
def jobs_file(tmp_path, monkeypatch):
    path = tmp_path / 'cron_jobs.json'
    monkeypatch.setattr(cron_mod, 'JOBS_FILE', str(path))
    monkeypatch.setattr(CronService, 'is_linux', classmethod(lambda cls: False))
    return path


def test_failed_cron_save_keeps_the_old_file(jobs_file):
    assert CronService.add_job('0 3 * * *', '/usr/bin/true', name='keep')['success']
    before = jobs_file.read_text()
    with patch('app.utils.config_store.json.dump', _fail_dump), pytest.raises(OSError):
        CronService.add_job('0 4 * * *', '/usr/bin/false', name='new')
    assert jobs_file.read_text() == before


def test_corrupt_cron_file_is_moved_aside_not_overwritten(jobs_file):
    jobs_file.write_text('{"jobs": {"job_1": {"name": "precious"', encoding='utf-8')
    assert CronService.add_job('0 3 * * *', '/usr/bin/true', name='new')['success']
    aside = list(jobs_file.parent.glob('cron_jobs.json.corrupt-*'))
    assert len(aside) == 1 and 'precious' in aside[0].read_text()


def test_failed_storage_save_keeps_the_old_file(tmp_path, monkeypatch):
    path = tmp_path / 'storage.json'
    path.write_text(json.dumps({'provider': 's3', 's3': {'bucket': 'b'}}), encoding='utf-8')
    monkeypatch.setattr(StorageProviderService, 'CONFIG_FILE', str(path))
    before = path.read_text()
    with patch('app.utils.config_store.json.dump', _fail_dump):
        result = StorageProviderService.save_config({'provider': 'b2', 'b2': {'bucket': 'x'}})
    assert result['success'] is False
    assert path.read_text() == before
    assert StorageProviderService.get_config()['provider'] == 's3'
