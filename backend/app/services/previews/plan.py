"""Pure preview identity and eligibility; no host operations."""
import re
from pathlib import Path
from app.services.nginx.validation import _validate_domain
from app.utils.git_security import validate_repo_url, validate_ref_name


class PreviewError(ValueError):
    pass


def validate(app, preview, settings, git_config):
    if app.server_id or settings.target_server_id:
        raise PreviewError('Generic previews currently require a local server.')
    if app.compose_file or app.managed_by in ('docker_compose', 'systemd', 'host'):
        raise PreviewError('Compose, systemd and host-managed previews are not supported by this provisioner.')
    if app.ingress_plane not in (None, '', 'nginx'):
        raise PreviewError('Generic previews currently require nginx ingress.')
    if not app.port or not 1 <= app.port <= 65535:
        raise PreviewError('Configure the application container port before deploying a preview.')
    if not preview.domain or len(preview.domain) > 253 or not _validate_domain(preview.domain):
        raise PreviewError('Invalid preview domain.')
    if not isinstance(preview.pr_number, int) or preview.pr_number <= 0:
        raise PreviewError('PR number must be a positive integer.')
    if not preview.branch or validate_ref_name(preview.branch, 'branch'):
        raise PreviewError('A valid branch in the configured repository is required.')
    if not re.fullmatch(r'[0-9a-fA-F]{40}|[0-9a-fA-F]{64}', preview.commit_sha or ''):
        raise PreviewError('An exact full commit SHA is required.')
    if not git_config or validate_repo_url(git_config.get('repo_url')):
        raise PreviewError('Configure a valid Git repository for this application first.')


def identity(preview_id, token):
    if not isinstance(preview_id, int) or preview_id <= 0 or not re.fullmatch(r'[0-9a-f]{32}', token):
        raise PreviewError('Invalid preview resource identity.')
    return f'serverkit-preview-{preview_id}-{token}'


def workspace(root, preview_id, token):
    # Never accept stored/PR-provided paths as cleanup targets.
    name = identity(preview_id, token)
    base = Path(root).resolve()
    target = base / name
    if target.is_symlink() or target.resolve().parent != base:
        raise PreviewError('Preview workspace escaped its managed directory.')
    return target


def relative_file(root, name):
    path = Path(root) / name
    if Path(name).is_absolute() or not path.resolve().is_relative_to(Path(root).resolve()):
        raise PreviewError('Build path must stay inside the preview checkout.')
    return path
