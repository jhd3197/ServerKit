"""Dashboard board service.

Owns the shipped default boards and the per-user CRUD around them. A board is a
dashboard tab; a widget instance is ``{i, type, x, y, w, h, cfg}`` placed on a
12-column grid.

Grid rules the defaults below obey (the frontend's ``grid/layout.js`` enforces
the same ones at runtime):

* 12 columns. ``x + w <= 12`` for every widget.
* No two widgets on a board overlap.
* Gravity-up: no widget can float higher without colliding, so there are no
  floating rows or holes above a widget.
* Every widget respects its type's minimum size from the widget registry.

``cfg`` is free-form per widget type and the backend does not interpret it —
it is stored and handed back verbatim. The one exception is ``_repair_board``,
which rewrites config keys that no renderer reads any more (see below); it never
invents config the user did not set. The shapes used here mirror the widget table in
the plan contract:

* ``stat``       ``{metric, agg, resource, thresholds}``
* ``timeseries`` ``{series: [{resource, metric}, ...], legend, fill}``
* ``gauge``      ``{metric, resource, thresholds}``
* ``topn``       ``{metric, limit}``
* ``table``      ``{source: 'apps'|'servers'|'containers'|'deploys', limit}``
* ``logs``       ``{source, path, containerId, level, lines}``
* ``deploys`` / ``alerts`` / ``status`` / ``feed``  ``{limit, …}``
* ``actions``    ``{items: [...]}``  (keys the renderer can route)
* ``specs``      ``{resource}``

``resource: '$server'`` is the server variable the dashboard topbar binds, so a
default board follows whichever server the operator has selected.

Metrics are limited to the ones the panel actually records
(``MetricsHistory``): cpu, ram, disk and load.
"""

import copy

from app import db
from app.models.dashboard import DashboardBoard

# Grid width. Mirrors GRID_COLS in the frontend's grid/layout.js.
GRID_COLS = 12

# Hard ceiling on widgets per board, enforced by the API layer. Generous for a
# real dashboard, small enough that a runaway client can't store a megabyte of
# JSON per board.
MAX_WIDGETS_PER_BOARD = 100

# A board can also hold the Overview layout a user saved for one kind of
# detail page (every server page shares the user's server layout, the page's
# own server being the board's variable). It is an ordinary board row whose
# slug names the kind, so it reuses the same storage, validation and
# ownership rules; it is just never listed among the dashboard tabs.
ENTITY_SCOPE_PREFIX = 'entity:'
ENTITY_SCOPES = ('entity:server', 'entity:service')


DEFAULT_BOARDS = [
    {
        'slug': 'overview',
        'name': 'Overview',
        'icon': 'grid',
        'position': 0,
        'widgets': [
            # Row 0-1: four stats across the top.
            {'i': 'w1', 'type': 'stat', 'x': 0, 'y': 0, 'w': 3, 'h': 2,
             'cfg': {'title': 'CPU usage', 'metric': 'cpu', 'agg': 'last', 'resource': '$server',
                     'thresholds': [70, 90]}},
            {'i': 'w2', 'type': 'stat', 'x': 3, 'y': 0, 'w': 3, 'h': 2,
             'cfg': {'title': 'Memory', 'metric': 'ram', 'agg': 'last', 'resource': '$server',
                     'thresholds': [80, 92]}},
            {'i': 'w3', 'type': 'stat', 'x': 6, 'y': 0, 'w': 3, 'h': 2,
             'cfg': {'title': 'Disk', 'metric': 'disk', 'agg': 'last', 'resource': '$server',
                     'thresholds': [75, 90]}},
            {'i': 'w4', 'type': 'stat', 'x': 9, 'y': 0, 'w': 3, 'h': 2,
             'cfg': {'title': 'Load average', 'metric': 'load', 'agg': 'last', 'resource': '$server',
                     'thresholds': None}},
            # Rows 2-5: the wide chart, with quick actions + host details stacked
            # in the right-hand column.
            {'i': 'w5', 'type': 'timeseries', 'x': 0, 'y': 2, 'w': 8, 'h': 4,
             'cfg': {'title': 'Real-time performance', 'series': [{'resource': '$server', 'metric': 'cpu'}, {'resource': '$server', 'metric': 'ram'}],
                     'legend': True, 'fill': True}},
            {'i': 'w6', 'type': 'actions', 'x': 8, 'y': 2, 'w': 4, 'h': 2,
             'cfg': {'title': 'Quick actions', 'items': ['services', 'docker', 'terminal', 'backups']}},
            {'i': 'w7', 'type': 'specs', 'x': 8, 'y': 4, 'w': 4, 'h': 2,
             'cfg': {'title': 'Hardware specs', 'resource': '$server'}},
            # Rows 6-9: inventory + what happened.
            {'i': 'w8', 'type': 'table', 'x': 0, 'y': 6, 'w': 8, 'h': 4,
             'cfg': {'title': 'Applications', 'source': 'apps', 'limit': 8}},
            {'i': 'w9', 'type': 'feed', 'x': 8, 'y': 6, 'w': 4, 'h': 4,
             'cfg': {'title': 'Recent activity', 'limit': 10}},
        ],
    },
    {
        'slug': 'infra',
        'name': 'Infrastructure',
        'icon': 'server',
        'position': 1,
        'widgets': [
            # Rows 0-3: fleet-wide chart + the ranked hot list.
            {'i': 'w1', 'type': 'timeseries', 'x': 0, 'y': 0, 'w': 8, 'h': 4,
             'cfg': {'title': 'Fleet performance', 'series': [{'resource': '$server', 'metric': 'cpu'}, {'resource': '$server', 'metric': 'ram'}, {'resource': '$server', 'metric': 'disk'}],
                     'legend': True, 'fill': True}},
            {'i': 'w2', 'type': 'topn', 'x': 8, 'y': 0, 'w': 4, 'h': 4,
             'cfg': {'title': 'Busiest servers', 'metric': 'cpu', 'limit': 5}},
            # Rows 4-6: two dials and the up/down matrix.
            {'i': 'w3', 'type': 'gauge', 'x': 0, 'y': 4, 'w': 3, 'h': 3,
             'cfg': {'title': 'CPU', 'metric': 'cpu', 'resource': '$server',
                     'thresholds': [70, 90]}},
            {'i': 'w4', 'type': 'gauge', 'x': 3, 'y': 4, 'w': 3, 'h': 3,
             'cfg': {'title': 'Memory', 'metric': 'ram', 'resource': '$server',
                     'thresholds': [80, 92]}},
            {'i': 'w5', 'type': 'status', 'x': 6, 'y': 4, 'w': 6, 'h': 3,
             'cfg': {'title': 'Endpoint status', 'source': 'servers', 'limit': 12}},
            # Rows 7-10: containers + anything currently shouting.
            {'i': 'w6', 'type': 'table', 'x': 0, 'y': 7, 'w': 8, 'h': 4,
             'cfg': {'title': 'Containers', 'source': 'containers', 'limit': 8}},
            {'i': 'w7', 'type': 'alerts', 'x': 8, 'y': 7, 'w': 4, 'h': 4,
             'cfg': {'title': 'Open alerts', 'limit': 8, 'severity': 'all'}},
        ],
    },
    {
        'slug': 'apps',
        'name': 'Apps',
        'icon': 'rocket',
        'position': 2,
        'widgets': [
            # Rows 0-1: three wider stats, averaged over the selected range.
            {'i': 'w1', 'type': 'stat', 'x': 0, 'y': 0, 'w': 4, 'h': 2,
             'cfg': {'title': 'CPU (average)', 'metric': 'cpu', 'agg': 'avg', 'resource': '$server',
                     'thresholds': [70, 90]}},
            {'i': 'w2', 'type': 'stat', 'x': 4, 'y': 0, 'w': 4, 'h': 2,
             'cfg': {'title': 'Memory (average)', 'metric': 'ram', 'agg': 'avg', 'resource': '$server',
                     'thresholds': [80, 92]}},
            {'i': 'w3', 'type': 'stat', 'x': 8, 'y': 0, 'w': 4, 'h': 2,
             'cfg': {'title': 'Load average', 'metric': 'load', 'agg': 'last', 'resource': '$server',
                     'thresholds': None}},
            # Rows 2-5: load over time next to the deploy stream.
            {'i': 'w4', 'type': 'timeseries', 'x': 0, 'y': 2, 'w': 8, 'h': 4,
             'cfg': {'title': 'Performance over time', 'series': [{'resource': '$server', 'metric': 'cpu'}, {'resource': '$server', 'metric': 'ram'}],
                     'legend': True, 'fill': True}},
            {'i': 'w5', 'type': 'deploys', 'x': 8, 'y': 2, 'w': 4, 'h': 4,
             'cfg': {'title': 'Deploy activity', 'limit': 8}},
            # Rows 6-9: full-width tail.
            {'i': 'w6', 'type': 'logs', 'x': 0, 'y': 6, 'w': 12, 'h': 4,
             'cfg': {'title': 'Live logs', 'source': 'file', 'path': '', 'containerId': '',
                     'level': 'all', 'lines': 60}},
        ],
    },
]


def get_default_board(slug):
    """A deep copy of one shipped default, or None when the slug is unknown."""
    for spec in DEFAULT_BOARDS:
        if spec['slug'] == slug:
            return copy.deepcopy(spec)
    return None


def seed_defaults(user_id):
    """Create the shipped default boards for a user. Returns the new rows."""
    created = []
    for spec in DEFAULT_BOARDS:
        board = DashboardBoard(
            user_id=user_id,
            slug=spec['slug'],
            name=spec['name'],
            icon=spec['icon'],
            position=spec['position'],
            widgets=copy.deepcopy(spec['widgets']),
        )
        db.session.add(board)
        created.append(board)
    db.session.commit()
    return created


# Widget configs that early boards were seeded with, mapped to the keys the
# renderers actually read. Fixing DEFAULT_BOARDS only helps users who have never
# opened the dashboard — everyone else already has rows in the database, and
# seeding never runs again for them. So repair on read.
#
# Each entry: (old key, new key, converter). A converter of None copies through.
_CFG_RENAMES = {
    # `metrics: ['cpu','ram']` -> `series: [{resource, metric}, ...]`
    'timeseries': [('metrics', 'series',
                    lambda v, cfg: [{'resource': cfg.get('resource', '$server'),
                                     'metric': m} for m in v if isinstance(m, str)])],
    # `actions: [...]` -> `items: [...]`
    'actions': [('actions', 'items', None)],
}

# Shortcut keys the quick-actions widget can resolve (ACTIONS in renderers.jsx).
# Early boards seeded 'new-app'/'deploy'/'backup', none of which route anywhere.
_QUICK_ACTIONS = {
    'servers', 'services', 'docker', 'terminal', 'deploys', 'databases',
    'backups', 'monitoring', 'domains', 'files', 'security', 'jobs',
}
_QUICK_ACTION_ALIASES = {'new-app': 'services', 'deploy': 'deploys', 'backup': 'backups'}
_DEFAULT_QUICK_ACTIONS = ['services', 'docker', 'terminal', 'backups']





def _repair_widget_cfg(widget):
    """Bring one stored widget's cfg up to the current renderer contract.

    Returns True when something changed. Deliberately conservative: it renames
    known-dead keys and drops unroutable shortcuts, and never touches config the
    renderers understand.
    """
    if not isinstance(widget, dict):
        return False
    cfg = widget.get('cfg')
    if not isinstance(cfg, dict):
        return False

    changed = False
    for old, new, convert in _CFG_RENAMES.get(widget.get('type'), []):
        if old in cfg and new not in cfg:
            value = cfg.pop(old)
            cfg[new] = convert(value, cfg) if convert else value
            changed = True

    if widget.get('type') == 'actions':
        items = cfg.get('items')
        mapped = [_QUICK_ACTION_ALIASES.get(i, i)
                  for i in (items or []) if isinstance(i, str)]
        kept = [i for i in dict.fromkeys(mapped) if i in _QUICK_ACTIONS]
        # An empty shortcut list renders "No actions selected", which is a
        # useless thing to greet someone with. If nothing survived (or nothing
        # was ever set), fall back to the shipped four.
        if not kept:
            kept = _DEFAULT_QUICK_ACTIONS[:]
        if kept != items:
            cfg['items'] = kept
            changed = True

    return changed


def _repair_board(board):
    """Bring one board's stored widgets up to the current renderer contract.

    Works on a deep copy on purpose. A JSON column mutated in place looks
    unchanged to SQLAlchemy, so no UPDATE is emitted — and the commit then
    expires the instance, which reloads the ORIGINAL rows and silently undoes
    the repair. Copying first is what makes the change both detected and kept.
    """
    widgets = copy.deepcopy(board.widgets or [])
    # Only dead config is rewritten. A missing `title` is NOT repaired here —
    # writing a title into config the user never set would break the promise
    # that a widget's cfg round-trips verbatim. The frame derives a display
    # title instead (deriveWidgetTitle in the frontend registry).
    changed = any([_repair_widget_cfg(w) for w in widgets])

    if not changed:
        return False
    board.widgets = widgets
    return True


def _dashboard_tabs(user_id):
    """This user's dashboard tabs: every board except saved overview layouts."""
    return (DashboardBoard.query
            .filter_by(user_id=user_id)
            .filter(db.or_(DashboardBoard.slug.is_(None),
                           ~DashboardBoard.slug.like(f'{ENTITY_SCOPE_PREFIX}%')))
            .order_by(DashboardBoard.position, DashboardBoard.id)
            .all())


def get_boards_for_user(user_id):
    """Every dashboard tab owned by this user, seeding the shipped defaults on
    the first read for a user who has none, and repairing configs that predate
    the current renderer contract."""
    boards = _dashboard_tabs(user_id)
    if boards:
        # Not `any(...)`: it short-circuits, so only the first repairable board
        # would ever be fixed.
        if [_repair_board(b) for b in boards].count(True):
            db.session.commit()
        return boards
    seed_defaults(user_id)
    return _dashboard_tabs(user_id)


def get_entity_board(user_id, scope):
    """The overview layout this user saved for one kind of detail page, or
    None when they are still on the shipped layout."""
    return DashboardBoard.query.filter_by(user_id=user_id, slug=scope).first()


def save_entity_board(user_id, scope, name, widgets):
    """Store a user's overview layout for one kind of detail page. There is at
    most one per user and kind, so a second save replaces the first. Returns
    ``(board, created)``."""
    board = get_entity_board(user_id, scope)
    created = board is None
    if created:
        board = DashboardBoard(user_id=user_id, slug=scope, icon='grid', position=0)
        db.session.add(board)
    board.name = name
    board.widgets = list(widgets or [])
    db.session.commit()
    return board, created


def get_board_for_user(user_id, board_id):
    """One board, scoped to its owner. None means "not yours / not there" — the
    caller must not distinguish the two."""
    return DashboardBoard.query.filter_by(id=board_id, user_id=user_id).first()


def create_board(user_id, name, icon=None, widgets=None):
    """Add a user-created board after the existing ones. ``slug`` stays NULL:
    a board the user invented has no shipped default to reset to."""
    last = (db.session.query(db.func.max(DashboardBoard.position))
            .filter(DashboardBoard.user_id == user_id).scalar())
    board = DashboardBoard(
        user_id=user_id,
        slug=None,
        name=name,
        icon=icon or 'grid',
        position=(last + 1) if last is not None else 0,
        widgets=list(widgets or []),
    )
    db.session.add(board)
    db.session.commit()
    return board


def update_board(board, name=None, icon=None, position=None, widgets=None):
    """Patch the fields that were actually supplied."""
    if name is not None:
        board.name = name
    if icon is not None:
        board.icon = icon
    if position is not None:
        board.position = position
    if widgets is not None:
        board.widgets = list(widgets)
    db.session.commit()
    return board


def delete_board(board):
    db.session.delete(board)
    db.session.commit()
    return True


def reset_board(board):
    """Restore a board to its shipped default. Returns None when the board was
    created by the user and therefore has no default to go back to."""
    spec = get_default_board(board.slug) if board.slug else None
    if not spec:
        return None
    board.name = spec['name']
    board.icon = spec['icon']
    board.widgets = copy.deepcopy(spec['widgets'])
    db.session.commit()
    return board
