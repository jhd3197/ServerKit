"""
Build Packs API — zero-Dockerfile detection + Dockerfile/compose generation.

Mounted at /api/v1/buildpacks (registered in app/__init__.py).

Two endpoints:
  * POST /detect    — clone a repo to a throwaway workspace, run BuildpackService
                      .detect(), return the plan + a generated Dockerfile preview.
                      Results are cached by (repo_url, commit) so repeated detects
                      on an unchanged repo are cheap. Accepts an already-cloned
                      ``path`` to skip cloning (used by tests / advanced callers).
  * POST /generate  — pure: given a plan dict, return Dockerfile + compose.
"""

import logging
import os
import shutil
import tempfile

from flask import Blueprint, jsonify
from flask_jwt_extended import jwt_required

from app.services.buildpack_service import BuildpackService
from app.services.git_service import GitService
from app.services.source_connection_service import SourceConnectionService
from app.middleware.rbac import developer_required, get_current_user
from app.api._request import json_object

logger = logging.getLogger(__name__)

buildpacks_bp = Blueprint('buildpacks', __name__)


def _build_response(plan: dict, app_name: str = 'app') -> dict:
    """Attach generated artifacts to a plan for the client."""
    return {
        'plan': plan,
        'dockerfile': BuildpackService.generate_dockerfile(plan),
        'compose': BuildpackService.generate_compose(plan, app_name),
    }


@buildpacks_bp.route('/detect', methods=['POST'])
@developer_required
def detect():
    """Detect the build pack for a repository.

    Body: {repo_url?, branch?, source_connection_id?, repository_full_name?, path?}

    If ``path`` is supplied it is used directly (no clone). Otherwise the repo is
    cloned shallowly to a temp workspace, inspected, and the workspace removed.
    """
    data = json_object()
    # Through the one identity door: @developer_required admits API-key
    # callers, for whom reading the JWT directly raises.
    caller = get_current_user()
    current_user_id = caller.id if caller else None

    explicit_path = (data.get('path') or '').strip() or None
    repo_url = (data.get('repo_url') or '').strip()
    branch = (data.get('branch') or '').strip() or None
    source_connection_id = data.get('source_connection_id')
    repository_full_name = (data.get('repository_full_name') or '').strip()
    app_name = (data.get('name') or 'app').strip() or 'app'

    # ---- Path supplied: detect in place, no clone. --------------------------
    if explicit_path:
        if not os.path.isdir(explicit_path):
            return jsonify({'error': f'Path does not exist: {explicit_path}'}), 400
        plan = BuildpackService.detect(explicit_path)
        return jsonify(_build_response(plan, app_name)), 200

    # ---- Resolve the clone URL (optionally via a stored source connection). --
    clone_url = repo_url
    display_url = repo_url
    if source_connection_id:
        try:
            source_repo = SourceConnectionService.get_authenticated_clone_url(
                user_id=current_user_id,
                connection_id=int(source_connection_id),
                full_name=repository_full_name,
            )
            clone_url = source_repo['clone_url']
            display_url = source_repo['public_url']
        except (TypeError, ValueError) as exc:
            return jsonify({'error': str(exc)}), 400
        except Exception as exc:  # pragma: no cover - defensive
            return jsonify({'error': f'Failed to resolve source connection: {exc}'}), 400

    if not clone_url:
        return jsonify({'error': 'repo_url or path is required'}), 400

    # ---- Cache hit on (display_url, branch)? --------------------------------
    cache_key_url = display_url or clone_url
    cached = BuildpackService.get_cached_plan(cache_key_url, branch)
    if cached:
        return jsonify({**_build_response(cached, app_name), 'cached': True}), 200

    # ---- Clone shallowly to a throwaway workspace, detect, clean up. --------
    workdir = tempfile.mkdtemp(prefix='serverkit-buildpack-')
    clone_target = os.path.join(workdir, 'repo')
    try:
        clone_result = GitService.clone_repository(clone_target, clone_url, branch)
        if not clone_result.get('success'):
            err = clone_result.get('error') or 'Failed to clone repository'
            # Never leak the authenticated clone URL (it may embed a token).
            if clone_url != display_url and display_url:
                err = err.replace(clone_url, display_url)
            return jsonify({'error': err}), 400

        commit = None
        info = GitService.get_commit_info(clone_target)
        if info:
            commit = info.get('hash') or info.get('commit')

        plan = BuildpackService.detect(clone_target)
        BuildpackService.cache_plan(cache_key_url, plan, commit or branch)
        return jsonify(_build_response(plan, app_name)), 200
    except Exception:  # pragma: no cover - defensive
        logger.exception('Buildpack detection failed')
        return jsonify({'error': 'Could not detect a build plan for this repository'}), 400
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@buildpacks_bp.route('/generate', methods=['POST'])
@jwt_required()
def generate():
    """Generate a Dockerfile + compose from a plan (pure, no clone).

    Body: {plan, overrides?, name?}
    """
    data = json_object()
    plan = data.get('plan')
    if not isinstance(plan, dict):
        return jsonify({'error': 'plan (object) is required'}), 400

    overrides = data.get('overrides')
    if overrides:
        plan = BuildpackService.apply_overrides(plan, overrides)

    app_name = (data.get('name') or 'app').strip() or 'app'
    return jsonify(_build_response(plan, app_name)), 200
