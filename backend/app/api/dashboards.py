"""Dashboard boards API — /api/v1/dashboards.

Per-user dashboard tabs and their widget layout. Everything here is scoped to
the calling user: a board that belongs to somebody else is indistinguishable
from a board that does not exist, so cross-user access returns 404 rather than
403 — a 403 would confirm the id is real.

``GET /`` seeds the shipped default boards the first time a user asks for
theirs, so a fresh account lands on a populated dashboard it can then edit,
rearrange or delete like anything else.

The widget payload is validated defensively before it is stored: the panel
hands this JSON straight back to the grid renderer, so a malformed instance
would be a broken dashboard the user cannot fix without an API call.
"""
import logging

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from app.services import dashboard_service
from app.services.dashboard_service import ENTITY_SCOPES, GRID_COLS, MAX_WIDGETS_PER_BOARD
from app.api._request import json_object
from app.exceptions import ValidationError

logger = logging.getLogger(__name__)

dashboards_bp = Blueprint('dashboards', __name__)

# Defensive ceilings on the geometry. The grid is 12 columns wide and rows are
# 88px; nothing legitimate is thousands of rows tall.
MAX_ROW = 1000
MAX_SPAN = 100
MAX_ID_LEN = 64
MAX_NAME_LEN = 120


def _validate_widgets(raw):
    """Normalise a widget-instance list. Returns ``(widgets, error)``.

    Each instance must be an object carrying a string ``i`` unique within the
    board, a string ``type``, and integer ``x``/``y``/``w``/``h`` that fit the
    12-column grid. ``cfg`` is free-form but must be an object; it is stored
    verbatim because only the widget renderer knows what it means.
    """
    if not isinstance(raw, list):
        return None, 'widgets must be a list'
    if len(raw) > MAX_WIDGETS_PER_BOARD:
        return None, f'A board holds at most {MAX_WIDGETS_PER_BOARD} widgets'

    seen = set()
    out = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            return None, f'widget {index} must be an object'

        wid = item.get('i')
        if not isinstance(wid, str) or not wid.strip():
            return None, f'widget {index} needs a string id "i"'
        if len(wid) > MAX_ID_LEN:
            return None, f'widget {index} id is too long'
        if wid in seen:
            return None, f'duplicate widget id "{wid}"'
        seen.add(wid)

        wtype = item.get('type')
        if not isinstance(wtype, str) or not wtype.strip():
            return None, f'widget "{wid}" needs a string type'
        if len(wtype) > MAX_ID_LEN:
            return None, f'widget "{wid}" type is too long'

        geometry = {}
        for field in ('x', 'y', 'w', 'h'):
            value = item.get(field)
            # bool is a subclass of int in Python; True is not a coordinate.
            if isinstance(value, bool) or not isinstance(value, int):
                return None, f'widget "{wid}" needs an integer {field}'
            geometry[field] = value

        if geometry['x'] < 0 or geometry['y'] < 0:
            return None, f'widget "{wid}" cannot have negative coordinates'
        if geometry['w'] < 1 or geometry['h'] < 1:
            return None, f'widget "{wid}" must span at least one cell'
        if geometry['x'] + geometry['w'] > GRID_COLS:
            return None, f'widget "{wid}" does not fit the {GRID_COLS}-column grid'
        if geometry['y'] > MAX_ROW or geometry['h'] > MAX_SPAN:
            return None, f'widget "{wid}" is out of bounds'

        cfg = item.get('cfg')
        if cfg is None:
            cfg = {}
        if not isinstance(cfg, dict):
            return None, f'widget "{wid}" cfg must be an object'

        out.append({
            'i': wid,
            'type': wtype,
            'x': geometry['x'],
            'y': geometry['y'],
            'w': geometry['w'],
            'h': geometry['h'],
            'cfg': cfg,
        })

    return out, None


def _validate_name(value):
    if not isinstance(value, str) or not value.strip():
        return None, 'name is required'
    name = value.strip()
    if len(name) > MAX_NAME_LEN:
        return None, f'name must be {MAX_NAME_LEN} characters or fewer'
    return name, None


def _validate_icon(value):
    if not isinstance(value, str) or not value.strip():
        return None, 'icon must be a string'
    icon = value.strip()
    if len(icon) > MAX_ID_LEN:
        return None, f'icon must be {MAX_ID_LEN} characters or fewer'
    return icon, None


@dashboards_bp.route('', methods=['GET'])
@dashboards_bp.route('/', methods=['GET'])
@jwt_required()
def list_boards():
    """This user's dashboard tabs, seeding the shipped defaults on the first
    call. With ``?scope=entity:<kind>`` it returns instead the overview layout
    the user saved for that kind of detail page: a list of one, or empty while
    they are still on the shipped layout."""
    user_id = get_jwt_identity()
    scope = request.args.get('scope')
    if scope is not None:
        if scope not in ENTITY_SCOPES:
            raise ValidationError('Unknown board scope')
        board = dashboard_service.get_entity_board(user_id, scope)
        return jsonify({'boards': [board.to_dict()] if board else []})
    boards = dashboard_service.get_boards_for_user(user_id)
    return jsonify({'boards': [b.to_dict() for b in boards]})


@dashboards_bp.route('', methods=['POST'])
@dashboards_bp.route('/', methods=['POST'])
@jwt_required()
def create_board():
    """Add a board for this user. ``widgets`` is optional — a new tab usually
    starts empty and gets filled from the widget library.

    With ``scope: 'entity:<kind>'`` the board is the user's overview layout for
    that kind of detail page rather than a dashboard tab. A user has one per
    kind, so posting again replaces it (200 instead of 201)."""
    user_id = get_jwt_identity()
    body = json_object(optional=True)

    scope = body.get('scope')
    if scope is not None and scope not in ENTITY_SCOPES:
        raise ValidationError('Unknown board scope')

    name, err = _validate_name(body.get('name'))
    if err:
        return jsonify({'error': err}), 400

    icon = 'grid'
    if body.get('icon') is not None:
        icon, err = _validate_icon(body.get('icon'))
        if err:
            return jsonify({'error': err}), 400

    widgets = []
    if body.get('widgets') is not None:
        widgets, err = _validate_widgets(body.get('widgets'))
        if err:
            return jsonify({'error': err}), 400

    if scope is not None:
        board, created = dashboard_service.save_entity_board(user_id, scope, name, widgets)
        return jsonify(board.to_dict()), 201 if created else 200

    board = dashboard_service.create_board(user_id, name, icon=icon, widgets=widgets)
    return jsonify(board.to_dict()), 201


@dashboards_bp.route('/<int:board_id>', methods=['PUT'])
@jwt_required()
def update_board(board_id):
    """Rename / re-icon / reorder a board, or store a new widget layout."""
    user_id = get_jwt_identity()
    board = dashboard_service.get_board_for_user(user_id, board_id)
    if not board:
        return jsonify({'error': 'Board not found'}), 404

    body = json_object(optional=True)
    name = icon = position = widgets = None

    if body.get('name') is not None:
        name, err = _validate_name(body.get('name'))
        if err:
            return jsonify({'error': err}), 400

    if body.get('icon') is not None:
        icon, err = _validate_icon(body.get('icon'))
        if err:
            return jsonify({'error': err}), 400

    if body.get('position') is not None:
        position = body.get('position')
        if isinstance(position, bool) or not isinstance(position, int) or position < 0:
            return jsonify({'error': 'position must be a non-negative integer'}), 400

    if body.get('widgets') is not None:
        widgets, err = _validate_widgets(body.get('widgets'))
        if err:
            return jsonify({'error': err}), 400

    board = dashboard_service.update_board(
        board, name=name, icon=icon, position=position, widgets=widgets)
    return jsonify(board.to_dict())


@dashboards_bp.route('/<int:board_id>', methods=['DELETE'])
@jwt_required()
def delete_board(board_id):
    user_id = get_jwt_identity()
    board = dashboard_service.get_board_for_user(user_id, board_id)
    if not board:
        return jsonify({'error': 'Board not found'}), 404
    dashboard_service.delete_board(board)
    return jsonify({'success': True}), 200


@dashboards_bp.route('/<int:board_id>/reset', methods=['POST'])
@jwt_required()
def reset_board(board_id):
    """Restore a shipped default board. Boards the user created have no default
    to fall back to, so those are refused rather than silently emptied."""
    user_id = get_jwt_identity()
    board = dashboard_service.get_board_for_user(user_id, board_id)
    if not board:
        return jsonify({'error': 'Board not found'}), 404
    restored = dashboard_service.reset_board(board)
    if not restored:
        return jsonify({'error': 'This board has no shipped default to reset to'}), 400
    return jsonify(restored.to_dict())
