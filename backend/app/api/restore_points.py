"""Generic restore-point lifecycle API (Plan 81, M3).

Application-owned scopes use the existing ResourceGrant seam. Host-level
surfaces are operational and require a developer role even when their local
``server_id`` is NULL. Persistence and adapter work stay in the service layer.
"""

from flask import Blueprint, jsonify, request

from app.exceptions import PermissionDeniedError, ValidationError
from app.middleware.rbac import auth_required, developer_required, get_current_user
from app.services import restore_point_service
from app.services.resource_grant_service import ResourceGrantService


restore_points_bp = Blueprint('restore_points', __name__)

_APP_SCOPE_TYPES = frozenset({'application', 'env'})
_LIST_QUERY_KEYS = frozenset({'scope_type', 'scope_id', 'server_id', 'limit'})
_CREATE_BODY_KEYS = frozenset({'scope_type', 'scope_id', 'label'})


def _require_active_user(user):
    if user is None:
        raise PermissionDeniedError('Authenticated user not found')
    if not user.is_active:
        raise PermissionDeniedError('Account is deactivated')


def _require_developer(user):
    _require_active_user(user)
    if user is None or not user.is_developer:
        raise PermissionDeniedError(
            'Developer access required for operational restore points',
        )


def _authorize_scope(user, scope_type, scope_id, *, write=False):
    """Authorize one scope and return its Application when app-owned."""
    _require_active_user(user)
    if scope_type in _APP_SCOPE_TYPES:
        application = restore_point_service.resolve_application_scope(
            scope_type, scope_id,
        )
        allowed = (
            ResourceGrantService.can_edit_app(user, application)
            if write else
            ResourceGrantService.can_access_app(user, application)
        )
        if not allowed:
            raise PermissionDeniedError("You don't have access to this service")
        return application

    _require_developer(user)
    return None


def _authorize_point(point, *, write=False):
    _authorize_scope(
        get_current_user(), point.scope_type, point.scope_id, write=write,
    )
    return point


def _point_for_caller(point_id, *, write=False):
    point = restore_point_service.get(point_id)
    return _authorize_point(point, write=write)


def _text_field(value, name, *, required=False, max_length=None):
    if value is None:
        if required:
            raise ValidationError(f'{name} is required')
        return None
    if not isinstance(value, str):
        raise ValidationError(f'{name} must be a string')
    value = value.strip()
    if required and not value:
        raise ValidationError(f'{name} is required')
    if max_length is not None and len(value) > max_length:
        raise ValidationError(
            f'{name} must not exceed {max_length} characters',
        )
    return value or None


def _limit_arg():
    raw = request.args.get('limit', '50')
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError('limit must be an integer') from exc
    if value < 1 or value > 200:
        raise ValidationError('limit must be between 1 and 200')
    return value


def _serialize(point, *, include_payload):
    data = point.to_dict()
    if not include_payload:
        data.pop('payload', None)
    return data


@restore_points_bp.route('', methods=['GET'])
@auth_required()
def list_restore_points():
    """List a scope's linear restore-point timeline, newest first."""
    unknown = set(request.args) - _LIST_QUERY_KEYS
    if unknown:
        raise ValidationError(
            'Unknown query parameters',
            details={'fields': sorted(unknown)},
        )

    scope_type = _text_field(
        request.args.get('scope_type'), 'scope_type', max_length=32,
    )
    scope_id = _text_field(
        request.args.get('scope_id'), 'scope_id', max_length=255,
    )
    server_id = _text_field(
        request.args.get('server_id'), 'server_id', max_length=36,
    )
    if scope_id is not None and scope_type is None:
        raise ValidationError('scope_type is required when scope_id is set')
    user = get_current_user()
    _require_active_user(user)
    if scope_type is not None:
        if scope_type in _APP_SCOPE_TYPES and scope_id is not None:
            _authorize_scope(user, scope_type, scope_id)
        elif scope_type not in _APP_SCOPE_TYPES:
            _require_developer(user)

    if server_id is not None:
        _require_developer(user)
        restore_point_service.resolve_server(server_id)

    kwargs = {
        'scope_type': scope_type,
        'scope_id': scope_id,
        'limit': _limit_arg(),
        'allowed_application_scope_ids': (
            restore_point_service.accessible_application_scope_ids(user)
        ),
        'include_operational': bool(user.is_developer),
    }
    if server_id is not None:
        kwargs['server_id'] = server_id
    points = restore_point_service.list_points(**kwargs)
    return jsonify({
        'restore_points': [
            _serialize(point, include_payload=False) for point in points
        ],
    }), 200


@restore_points_bp.route('', methods=['POST'])
@developer_required
def create_restore_point():
    """Create a retained, manually labelled quicksave for one local scope."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        raise ValidationError('Request body must be a JSON object')
    unknown = set(body) - _CREATE_BODY_KEYS
    if unknown:
        raise ValidationError(
            'Unknown request fields', details={'fields': sorted(unknown)},
        )

    scope_type = _text_field(
        body.get('scope_type'), 'scope_type', required=True, max_length=32,
    )
    scope_id = _text_field(
        body.get('scope_id'), 'scope_id', required=True, max_length=255,
    )
    label = _text_field(body.get('label'), 'label', max_length=255)
    user = get_current_user()
    application = _authorize_scope(user, scope_type, scope_id, write=True)

    # Environment state is application-owned. Its server association is
    # derived from that trusted row; callers cannot stamp arbitrary servers.
    server_id = application.server_id if scope_type == 'env' else None
    point = restore_point_service.capture_manual(
        scope_type, scope_id, label=label, actor=user, server_id=server_id,
    )
    return jsonify({
        'restore_point': _serialize(point, include_payload=True),
    }), 201


@restore_points_bp.route('/<point_id>', methods=['GET'])
@auth_required()
def get_restore_point(point_id):
    """Fetch a restore point including its already-secret-safe payload."""
    point = _point_for_caller(point_id)
    return jsonify({
        'restore_point': _serialize(point, include_payload=True),
    }), 200


@restore_points_bp.route('/<point_id>/diff', methods=['GET'])
@auth_required()
def diff_restore_point(point_id):
    """Diff against the previous point or an explicit same-scope point."""
    unknown = set(request.args) - {'against'}
    if unknown:
        raise ValidationError(
            'Unknown query parameters',
            details={'fields': sorted(unknown)},
        )
    _point_for_caller(point_id)
    against = request.args.get('against', 'previous')
    if against not in ('', 'previous'):
        # Load and authorize before the service compares scopes, so a guessed
        # point id can never become an authorization bypass.
        _point_for_caller(against)
    return jsonify(restore_point_service.diff(point_id, against=against)), 200


@restore_points_bp.route('/<point_id>/preview', methods=['POST'])
@developer_required
def preview_restore_point(point_id):
    """Dry-run a restore with coverage and refusal information."""
    point = _point_for_caller(point_id, write=True)
    return jsonify(restore_point_service.preview(
        point.id, actor=get_current_user(),
    )), 200


@restore_points_bp.route('/<point_id>/restore', methods=['POST'])
@developer_required
def restore_restore_point(point_id):
    """Re-converge a scope through its adapter's normal mutation doors."""
    point = _point_for_caller(point_id, write=True)
    result = restore_point_service.restore(
        point.id, actor=get_current_user(),
    )
    if isinstance(result, dict) and result.get('success') is False:
        message = result.get('error') or 'Restore adapter reported failure'
        if result.get('refused'):
            raise restore_point_service.RestorePointRefusedError([message])
        raise restore_point_service.RestorePointAdapterError(
            message, details=result,
        )
    return jsonify(result or {'success': True}), 200
