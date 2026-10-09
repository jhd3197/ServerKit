"""Declarative serverkit.yaml manifest API.

Phase 0: `scaffold` (render a v1 manifest from a live app).
Later phases add `get`, `plan` and `apply`. Admin-gated; applies are
audit-logged.
"""

from flask import Blueprint, jsonify, request, Response
from flask_jwt_extended import jwt_required

from app import db
from app.models.application import Application
from app.models.application_manifest import ApplicationManifest, STATUS_PENDING
from app.models.project import Project
from app.services.manifest_scaffold_service import ManifestScaffoldService
from app.services.manifest_spec_service import ManifestSpecService, ManifestError
from app.services.manifest_apply_service import ManifestApplyService
from app.services.manifest_persistence_service import ManifestPersistenceService
from app.middleware.rbac import require_admin_user
from app.exceptions import not_found

manifests_bp = Blueprint('manifests', __name__)


def _load_normalized(data):
    """Normalize from an inline body, or fall back to the project's stored row.
    Returns (normalized, raw_text, error_response_or_None)."""
    if 'content' in data:
        try:
            return ManifestSpecService.normalize_text(data['content']), data['content'], None
        except ManifestError as exc:
            return None, None, (jsonify({'error': 'Invalid manifest', 'errors': exc.errors}), 400)
    if 'manifest' in data:
        try:
            return ManifestSpecService.normalize(data['manifest']), None, None
        except ManifestError as exc:
            return None, None, (jsonify({'error': 'Invalid manifest', 'errors': exc.errors}), 400)
    # fall back to the stored manifest for the project
    project_id = data.get('project_id')
    row = ApplicationManifest.query.filter_by(project_id=project_id).first() if project_id else None
    if row and row.get_normalized():
        return row.get_normalized(), row.raw_text, None
    return None, None, (jsonify({'error': 'Provide `content`/`manifest`, or store one first'}), 400)


@manifests_bp.route('/scaffold', methods=['GET'])
@jwt_required()
def scaffold_manifest():
    """GET /api/v1/manifests/scaffold?app_id=&format=json|yaml"""
    user = require_admin_user()

    app_id = request.args.get('app_id', type=int)
    if not app_id:
        return jsonify({'error': 'app_id is required'}), 400

    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        raise not_found('service')

    fmt = (request.args.get('format') or 'json').lower()
    if fmt == 'yaml':
        yaml_text = ManifestScaffoldService.scaffold_yaml(app)
        return Response(yaml_text, mimetype='text/yaml')

    manifest = ManifestScaffoldService.scaffold_for_app(app)
    return jsonify({'manifest': manifest,
                    'yaml': ManifestScaffoldService.scaffold_yaml(app)}), 200


@manifests_bp.route('/validate', methods=['POST'])
@jwt_required()
def validate_manifest():
    """POST /api/v1/manifests/validate  { content | manifest } -> normalized summary."""
    user = require_admin_user()

    data = request.get_json(silent=True) or {}
    try:
        if 'content' in data:
            normalized = ManifestSpecService.normalize_text(data['content'])
        elif 'manifest' in data:
            normalized = ManifestSpecService.normalize(data['manifest'])
        else:
            return jsonify({'error': 'Provide `content` or `manifest`'}), 400
    except ManifestError as exc:
        return jsonify({'valid': False, 'errors': exc.errors}), 200

    return jsonify({
        'valid': True,
        'summary': ManifestSpecService.summarize(normalized),
        'normalized': normalized,
    }), 200


@manifests_bp.route('', methods=['GET'])
@jwt_required()
def get_manifest():
    """GET /api/v1/manifests?project_id= -> the stored manifest for a project."""
    user = require_admin_user()
    project_id = request.args.get('project_id', type=int)
    if not project_id:
        return jsonify({'error': 'project_id is required'}), 400
    row = ApplicationManifest.query.filter_by(project_id=project_id).first()
    if not row:
        return jsonify({'manifest': None}), 200
    return jsonify({'manifest': row.to_dict(include_raw=True)}), 200


@manifests_bp.route('/plan', methods=['POST'])
@jwt_required()
def plan_manifest():
    """POST /api/v1/manifests/plan {project_id, content|manifest?} -> dry-run plan."""
    user = require_admin_user()
    data = request.get_json(silent=True) or {}
    project = Project.query.get(data.get('project_id')) if data.get('project_id') else None
    if not project:
        return jsonify({'error': 'A valid project_id is required'}), 400

    normalized, _raw, err_resp = _load_normalized(data)
    if err_resp:
        return err_resp

    plan = ManifestApplyService.plan(project, normalized)
    return jsonify({'plan': plan}), 200


@manifests_bp.route('/apply', methods=['POST'])
@jwt_required()
def apply_manifest():
    """POST /api/v1/manifests/apply {project_id, content|manifest?} -> apply."""
    user = require_admin_user()
    data = request.get_json(silent=True) or {}
    project = Project.query.get(data.get('project_id')) if data.get('project_id') else None
    if not project:
        return jsonify({'error': 'A valid project_id is required'}), 400

    normalized, raw, err_resp = _load_normalized(data)
    if err_resp:
        return err_resp

    # persist/refresh the manifest row (pending) before applying
    row = ManifestPersistenceService.store_manifest(
        project_id=project.id, normalized=normalized, raw_text=raw, status=STATUS_PENDING)
    db.session.commit()

    result = ManifestApplyService.apply(project, normalized, user_id=user.id,
                                        manifest_row=row)

    # Appliance-tier blockers (plan 35): apply refused, nothing executed.
    if result.get('refused'):
        return jsonify(result), 400

    try:
        from app.services.audit_service import AuditService
        AuditService.log('manifest.apply', user_id=user.id, target_type='project',
                         target_id=project.id,
                         details={'success': result['success'], 'applied': result.get('applied'),
                                  'job_id': result.get('job_id')})
    except Exception:
        pass

    status = 200 if result['success'] else 207
    return jsonify(result), status


@manifests_bp.route('/bootstrap/reset', methods=['POST'])
@jwt_required()
def reset_bootstrap():
    """POST /api/v1/manifests/bootstrap/reset {app_id, confirm}

    Re-arm a one-shot appliance bootstrap so the next apply runs it again.
    Destructive-ish (the bootstrap may regenerate config), so it requires
    typing the app name in `confirm`.
    """
    user = require_admin_user()
    data = request.get_json(silent=True) or {}
    app = (Application.query_active().filter_by(id=data.get('app_id')).first()
           if data.get('app_id') else None)
    if not app:
        raise not_found('service')
    if (data.get('confirm') or '') != app.name:
        return jsonify({'error': f'Type the service name "{app.name}" to confirm'}), 400
    app.bootstrap_done = False
    db.session.commit()
    return jsonify({'success': True, 'app_id': app.id, 'bootstrap_done': False}), 200
