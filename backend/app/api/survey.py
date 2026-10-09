"""Server survey API — read-only "flights" over a paired agent (plan 27).

Mounted at /api/v1/servers (see app/__init__.py). All routes are admin-only: a
survey enumerates what's running on a host, and the catalog index is the honest
"here is what we look at" surface shown verbatim in the UI.
"""
from flask import Blueprint, jsonify, request

from app.middleware.rbac import admin_required, get_current_user
from app.models.server import Server
from app.services import survey_service
from app.exceptions import not_found

survey_bp = Blueprint('survey', __name__)


@survey_bp.route('/survey/catalog', methods=['GET'])
@admin_required
def get_catalog():
    """The operator-facing probe index — exactly what the survey reads."""
    try:
        return jsonify(survey_service.probe_index()), 200
    except survey_service.SurveyError as exc:
        return jsonify({'error': f'Invalid probe catalog: {exc}'}), 500


@survey_bp.route('/<server_id>/survey', methods=['POST'])
@admin_required
def run_survey(server_id):
    """Fly a read-only survey against the server's agent and store the map."""
    server = Server.query.get(server_id)
    if server is None:
        raise not_found('server')

    user = get_current_user()
    survey, error = survey_service.run_survey(server_id, user_id=getattr(user, 'id', None))
    if error:
        return jsonify({'error': error['error'], 'code': error['code']}), error['status']
    return jsonify(survey), 201


@survey_bp.route('/<server_id>/management-mode', methods=['POST'])
@admin_required
def set_management_mode(server_id):
    """Switch a server between 'managed' and 'observed' (plan 27, Decision 1/4).

    An operator confirms mode changes; detection only ever SUGGESTS. Existing
    managed boxes are never auto-downgraded — this is the explicit, audited flip.
    """
    from app import db
    from app.services.audit_service import AuditService

    server = Server.query.get(server_id)
    if server is None:
        raise not_found('server')

    data = request.get_json(silent=True) or {}
    mode = (data.get('mode') or '').strip().lower()
    if mode not in Server.MANAGEMENT_MODES:
        return jsonify({'error': f'mode must be one of {list(Server.MANAGEMENT_MODES)}'}), 400

    previous = server.management_mode or 'managed'
    server.management_mode = mode

    # Optional break-glass toggle (plan 31 #10, Decision 6): permit agent:update
    # while observing. Only meaningful for observed boxes but always storable.
    details = {'from': previous, 'to': mode}
    if 'allow_agent_update_observed' in data:
        override = bool(data.get('allow_agent_update_observed'))
        server.allow_agent_update_observed = override
        details['allow_agent_update_observed'] = override
    db.session.commit()

    user = get_current_user()
    try:
        AuditService.log(
            action='server.management_mode',
            user_id=getattr(user, 'id', None),
            target_type='server',
            target_id=server_id,
            details=details,
        )
    except Exception:  # audit is best-effort, never blocks the flip
        pass

    result = server.to_dict()
    from app.services.agent_registry import agent_registry
    result['observed_blocked_count'] = agent_registry.observed_blocked_count(server_id)
    return jsonify(result), 200


@survey_bp.route('/<server_id>/observed-status', methods=['GET'])
@admin_required
def observed_status(server_id):
    """Observe-mode status for a server (plan 31 #10/#11).

    Returns the current mode, the agent:update break-glass flag, and how many
    commands the Observe guard has blocked — the "blocked N commands" counter.
    """
    from app.services.agent_registry import agent_registry
    server = Server.query.get(server_id)
    if server is None:
        raise not_found('server')
    return jsonify({
        'management_mode': server.management_mode or 'managed',
        'allow_agent_update_observed': bool(server.allow_agent_update_observed),
        'observed_blocked_count': agent_registry.observed_blocked_count(server_id),
    }), 200


@survey_bp.route('/<server_id>/surveys', methods=['GET'])
@admin_required
def list_surveys(server_id):
    """List survey snapshots for a server (newest first, without the map blob)."""
    server = Server.query.get(server_id)
    if server is None:
        raise not_found('server')
    surveys = survey_service.list_surveys(server_id)
    return jsonify({'surveys': [s.to_dict(include_map=False) for s in surveys]}), 200


@survey_bp.route('/<server_id>/surveys/<int:survey_id>', methods=['GET'])
@admin_required
def get_survey(server_id, survey_id):
    """Fetch one survey snapshot including its full Server Map."""
    from app.models.server_survey import ServerSurvey
    survey = ServerSurvey.query.filter_by(id=survey_id, server_id=server_id).first()
    if survey is None:
        return jsonify({'error': 'Survey not found'}), 404
    return jsonify(survey.to_dict()), 200


@survey_bp.route('/<server_id>/surveys/diff', methods=['GET'])
@admin_required
def diff_surveys(server_id):
    """Diff two survey snapshots (``?from=<id>&to=<id>``).

    Defaults ``to`` to the latest snapshot and ``from`` to the one before it, so
    a bare call answers "what changed since the last flight".
    """
    from app.models.server_survey import ServerSurvey

    surveys = survey_service.list_surveys(server_id)
    if len(surveys) < 2 and not (request.args.get('from') and request.args.get('to')):
        return jsonify({'error': 'Need at least two surveys to diff'}), 400

    def _load(arg, default):
        raw = request.args.get(arg)
        if raw is None:
            return default
        s = ServerSurvey.query.filter_by(id=int(raw), server_id=server_id).first()
        if s is None:
            return None
        return s

    new_survey = _load('to', surveys[0] if surveys else None)
    old_survey = _load('from', surveys[1] if len(surveys) > 1 else None)
    if new_survey is None or old_survey is None:
        return jsonify({'error': 'Survey not found'}), 404

    diff = survey_service.diff_maps(old_survey.get_map(), new_survey.get_map())
    return jsonify({
        'from': old_survey.to_dict(include_map=False),
        'to': new_survey.to_dict(include_map=False),
        'diff': diff,
    }), 200
