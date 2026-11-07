"""Copying, moving, renaming or deleting a PARENT of a protected root must not
reach the panel's secrets (GHSA-rm3m-9mvw-68fh, second door): the path checks
only look at the path typed, so `copy /opt -> /home/u/x` used to carry
/opt/serverkit/.env along with it."""
import os

import pytest

from app.exceptions import PermissionDeniedError
from app.services.file_service import FileService


@pytest.fixture
def tree(tmp_path, monkeypatch):
    opt = tmp_path / 'opt'
    panel = opt / 'serverkit'
    panel.mkdir(parents=True)
    (panel / '.env').write_text('JWT_SECRET_KEY=s3cret\n', encoding='utf-8')
    app_dir = opt / 'myapp'
    app_dir.mkdir()
    (app_dir / 'index.html').write_text('hi', encoding='utf-8')
    home = tmp_path / 'home'
    home.mkdir()
    monkeypatch.setattr(FileService, 'ALLOWED_ROOTS', [str(opt), str(home)])
    monkeypatch.setattr(FileService, 'READ_ONLY_ROOTS', [])
    monkeypatch.setattr(FileService, 'PROTECTED_ROOTS', [os.path.realpath(panel)])
    return {'opt': opt, 'panel': panel, 'app': app_dir, 'home': home}


def test_copying_a_parent_is_refused(tree):
    dest = tree['home'] / 'loot'
    with pytest.raises(PermissionDeniedError):
        FileService.copy(str(tree['opt']), str(dest))
    assert not dest.exists()


def test_moving_renaming_or_deleting_a_parent_is_refused(tree):
    with pytest.raises(PermissionDeniedError):
        FileService.move(str(tree['opt']), str(tree['home'] / 'moved'))
    with pytest.raises(PermissionDeniedError):
        FileService.rename(str(tree['opt']), 'renamed')
    with pytest.raises(PermissionDeniedError):
        FileService.delete(str(tree['opt']))
    assert (tree['panel'] / '.env').exists()


def test_siblings_still_work(tree):
    FileService.copy(str(tree['app']), str(tree['home'] / 'copy'))
    assert (tree['home'] / 'copy' / 'index.html').read_text(encoding='utf-8') == 'hi'
    FileService.delete(str(tree['app']))
    assert not tree['app'].exists()


@pytest.mark.skipif(os.name == 'nt', reason='symlinks need privileges on Windows')
def test_copied_symlinks_stay_links(tree):
    (tree['app'] / 'env').symlink_to(tree['panel'] / '.env')
    FileService.copy(str(tree['app']), str(tree['home'] / 'copy'))
    assert os.path.islink(tree['home'] / 'copy' / 'env')
