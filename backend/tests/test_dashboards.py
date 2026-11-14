"""Dashboard board persistence tests (plan 62).

Proves the backend contract behind the widget grid: shipped defaults are seeded
once per user, boards are CRUD-able, a default board can be restored, one user
can never see or touch another's board (404, never 403), and a malformed widget
payload is refused before it reaches the database.
"""
import pytest

from app.services.dashboard_service import DEFAULT_BOARDS, GRID_COLS


def _headers_for(app, username):
    """A second (non-admin) user's auth headers — the neighbour whose boards
    must stay invisible."""
    from app import db
    from app.models import User
    from flask_jwt_extended import create_access_token
    from werkzeug.security import generate_password_hash

    with app.app_context():
        user = User(
            email=f'{username}@test.local', username=username,
            password_hash=generate_password_hash('x'),
            role=User.ROLE_DEVELOPER, is_active=True,
        )
        db.session.add(user)
        db.session.commit()
        return {'Authorization': f'Bearer {create_access_token(identity=user.id)}'}


@pytest.fixture
def other_headers(app):
    return _headers_for(app, 'boardneighbour')


def _widget(i='w1', wtype='stat', x=0, y=0, w=3, h=2, cfg=None):
    return {'i': i, 'type': wtype, 'x': x, 'y': y, 'w': w, 'h': h, 'cfg': cfg or {}}


# ---------------------------------------------------------------- auth gate

def test_boards_require_auth(client):
    assert client.get('/api/v1/dashboards').status_code == 401


# ------------------------------------------------------------- seed defaults

def test_first_get_seeds_shipped_defaults(client, auth_headers):
    resp = client.get('/api/v1/dashboards', headers=auth_headers)
    assert resp.status_code == 200
    boards = resp.get_json()['boards']

    assert [b['slug'] for b in boards] == ['overview', 'infra', 'apps']
    assert [b['position'] for b in boards] == [0, 1, 2]
    assert [b['icon'] for b in boards] == ['grid', 'server', 'rocket']
    assert all(b['widgets'] for b in boards)

    overview = boards[0]
    types = [w['type'] for w in overview['widgets']]
    assert types.count('stat') == 4
    assert {'timeseries', 'actions', 'specs', 'table', 'feed'}.issubset(set(types))
    table = next(w for w in overview['widgets'] if w['type'] == 'table')
    assert table['cfg']['source'] == 'apps'


def test_defaults_are_seeded_only_once(client, auth_headers):
    first = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    second = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    assert [b['id'] for b in first] == [b['id'] for b in second]
    assert len(second) == len(DEFAULT_BOARDS)


def test_default_layouts_obey_the_grid_rules():
    """12 columns, no overlaps, gravity-up — the same invariants the frontend
    grid enforces at runtime."""
    for spec in DEFAULT_BOARDS:
        widgets = spec['widgets']
        assert len({w['i'] for w in widgets}) == len(widgets), spec['slug']

        cells = {}
        for w in widgets:
            assert w['x'] >= 0 and w['y'] >= 0, (spec['slug'], w['i'])
            assert w['w'] >= 1 and w['h'] >= 1, (spec['slug'], w['i'])
            assert w['x'] + w['w'] <= GRID_COLS, (spec['slug'], w['i'])
            for col in range(w['x'], w['x'] + w['w']):
                for row in range(w['y'], w['y'] + w['h']):
                    assert (col, row) not in cells, (
                        f"{spec['slug']}: {w['i']} overlaps {cells.get((col, row))}")
                    cells[(col, row)] = w['i']

        # Gravity-up: nothing may float. A widget below row 0 must be blocked
        # by something directly above it.
        for w in widgets:
            if w['y'] == 0:
                continue
            blocked = any((col, w['y'] - 1) in cells
                          for col in range(w['x'], w['x'] + w['w']))
            assert blocked, f"{spec['slug']}: {w['i']} floats above a hole"


# --------------------------------------------------------------------- CRUD

def test_create_board(client, auth_headers):
    client.get('/api/v1/dashboards', headers=auth_headers)  # seed the defaults
    resp = client.post('/api/v1/dashboards', headers=auth_headers, json={
        'name': 'Night shift', 'icon': 'zap',
        'widgets': [_widget(wtype='gauge', w=3, h=3)],
    })
    assert resp.status_code == 201, resp.get_json()
    board = resp.get_json()
    assert board['name'] == 'Night shift'
    assert board['icon'] == 'zap'
    assert board['slug'] is None
    assert len(board['widgets']) == 1

    listing = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    assert len(listing) == len(DEFAULT_BOARDS) + 1
    # Created boards land after the seeded defaults.
    assert listing[-1]['id'] == board['id']


def test_create_board_requires_a_name(client, auth_headers):
    resp = client.post('/api/v1/dashboards', headers=auth_headers, json={'icon': 'zap'})
    assert resp.status_code == 400
    assert 'error' in resp.get_json()


def test_update_board_stores_layout(client, auth_headers):
    boards = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    board_id = boards[0]['id']

    layout = [_widget('a', 'stat', 0, 0, 4, 2), _widget('b', 'logs', 4, 0, 8, 4)]
    resp = client.put(f'/api/v1/dashboards/{board_id}', headers=auth_headers,
                      json={'name': 'Renamed', 'icon': 'cpu', 'widgets': layout})
    assert resp.status_code == 200, resp.get_json()
    updated = resp.get_json()
    assert updated['name'] == 'Renamed'
    assert updated['icon'] == 'cpu'
    assert [w['i'] for w in updated['widgets']] == ['a', 'b']

    reread = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    assert reread[0]['widgets'][1]['type'] == 'logs'


def test_update_board_accepts_partial_payload(client, auth_headers):
    boards = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    board = boards[1]
    resp = client.put(f"/api/v1/dashboards/{board['id']}", headers=auth_headers,
                      json={'position': 9})
    assert resp.status_code == 200
    updated = resp.get_json()
    assert updated['position'] == 9
    assert updated['name'] == board['name']
    assert updated['widgets'] == board['widgets']


def test_delete_board(client, auth_headers):
    boards = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    victim = boards[2]['id']

    assert client.delete(f'/api/v1/dashboards/{victim}',
                         headers=auth_headers).status_code == 200

    remaining = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    assert victim not in [b['id'] for b in remaining]
    # The survivors are NOT re-seeded — seeding only happens for a user with no
    # boards at all.
    assert len(remaining) == len(DEFAULT_BOARDS) - 1


def test_unknown_board_is_404(client, auth_headers):
    assert client.put('/api/v1/dashboards/99999', headers=auth_headers,
                      json={'name': 'x'}).status_code == 404
    assert client.delete('/api/v1/dashboards/99999',
                         headers=auth_headers).status_code == 404
    assert client.post('/api/v1/dashboards/99999/reset',
                       headers=auth_headers).status_code == 404


# -------------------------------------------------------------------- reset

def test_reset_restores_the_shipped_default(client, auth_headers):
    boards = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    overview = boards[0]
    original = overview['widgets']

    client.put(f"/api/v1/dashboards/{overview['id']}", headers=auth_headers,
               json={'name': 'Wrecked', 'widgets': [_widget('solo', 'note')]})

    resp = client.post(f"/api/v1/dashboards/{overview['id']}/reset", headers=auth_headers)
    assert resp.status_code == 200, resp.get_json()
    restored = resp.get_json()
    assert restored['name'] == 'Overview'
    assert restored['widgets'] == original


def test_reset_refuses_a_user_created_board(client, auth_headers):
    created = client.post('/api/v1/dashboards', headers=auth_headers,
                          json={'name': 'Mine'}).get_json()
    resp = client.post(f"/api/v1/dashboards/{created['id']}/reset", headers=auth_headers)
    assert resp.status_code == 400
    assert 'error' in resp.get_json()


# ----------------------------------------------------------- user isolation

def test_boards_are_scoped_per_user(client, auth_headers, other_headers):
    mine = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    theirs = client.get('/api/v1/dashboards', headers=other_headers).get_json()['boards']

    # Each user got their own seeded copy — same slugs, different rows.
    assert [b['slug'] for b in mine] == [b['slug'] for b in theirs]
    assert not set(b['id'] for b in mine) & set(b['id'] for b in theirs)


def test_a_foreign_board_is_404_not_403(client, auth_headers, other_headers):
    mine = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    target = mine[0]['id']

    # Seed the neighbour so their own boards exist and the id is simply not theirs.
    client.get('/api/v1/dashboards', headers=other_headers)

    assert client.put(f'/api/v1/dashboards/{target}', headers=other_headers,
                      json={'name': 'stolen'}).status_code == 404
    assert client.post(f'/api/v1/dashboards/{target}/reset',
                       headers=other_headers).status_code == 404
    assert client.delete(f'/api/v1/dashboards/{target}',
                         headers=other_headers).status_code == 404

    # The owner's board is untouched.
    still = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    assert still[0]['id'] == target
    assert still[0]['name'] == 'Overview'


# ------------------------------------------------------- payload validation

@pytest.mark.parametrize('payload,reason', [
    ('not-a-list', 'widgets must be a list'),
    ({'i': 'w1'}, 'a dict is not a list'),
    ([{'type': 'stat', 'x': 0, 'y': 0, 'w': 3, 'h': 2}], 'missing i'),
    ([{'i': 5, 'type': 'stat', 'x': 0, 'y': 0, 'w': 3, 'h': 2}], 'non-string i'),
    ([{'i': 'w1', 'x': 0, 'y': 0, 'w': 3, 'h': 2}], 'missing type'),
    ([{'i': 'w1', 'type': 'stat', 'x': '0', 'y': 0, 'w': 3, 'h': 2}], 'string x'),
    ([{'i': 'w1', 'type': 'stat', 'x': 0, 'y': 0, 'w': 3.5, 'h': 2}], 'float w'),
    ([{'i': 'w1', 'type': 'stat', 'x': True, 'y': 0, 'w': 3, 'h': 2}], 'bool x'),
    ([{'i': 'w1', 'type': 'stat', 'x': -1, 'y': 0, 'w': 3, 'h': 2}], 'negative x'),
    ([{'i': 'w1', 'type': 'stat', 'x': 0, 'y': 0, 'w': 0, 'h': 2}], 'zero width'),
    ([{'i': 'w1', 'type': 'stat', 'x': 10, 'y': 0, 'w': 4, 'h': 2}], 'overflows 12 cols'),
    ([{'i': 'w1', 'type': 'stat', 'x': 0, 'y': 0, 'w': 3, 'h': 2, 'cfg': 'nope'}], 'cfg not an object'),
    (['just-a-string'], 'entry is not an object'),
])
def test_bad_widget_payloads_are_rejected(client, auth_headers, payload, reason):
    resp = client.post('/api/v1/dashboards', headers=auth_headers,
                       json={'name': 'Bad', 'widgets': payload})
    assert resp.status_code == 400, f'{reason} should be rejected'
    assert 'error' in resp.get_json()


def test_duplicate_widget_ids_are_rejected(client, auth_headers):
    resp = client.post('/api/v1/dashboards', headers=auth_headers, json={
        'name': 'Dupes', 'widgets': [_widget('w1'), _widget('w1', x=3)],
    })
    assert resp.status_code == 400
    assert 'duplicate' in resp.get_json()['error'].lower()


def test_oversized_widget_payload_is_rejected(client, auth_headers):
    huge = [_widget(f'w{n}', x=(n % 4) * 3, y=n) for n in range(101)]
    resp = client.post('/api/v1/dashboards', headers=auth_headers,
                       json={'name': 'Huge', 'widgets': huge})
    assert resp.status_code == 400
    assert '100' in resp.get_json()['error']


def test_update_rejects_a_bad_layout_without_touching_the_board(client, auth_headers):
    boards = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    board = boards[0]

    resp = client.put(f"/api/v1/dashboards/{board['id']}", headers=auth_headers,
                      json={'name': 'Attempted', 'widgets': [{'i': 'w1'}]})
    assert resp.status_code == 400

    unchanged = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    assert unchanged[0]['name'] == board['name']
    assert unchanged[0]['widgets'] == board['widgets']


def test_widget_cfg_round_trips_verbatim(client, auth_headers):
    cfg = {'metric': 'cpu', 'agg': 'p95', 'resource': '$server',
           'thresholds': [70, 90], 'nested': {'deep': ['a', 1, None]}}
    created = client.post('/api/v1/dashboards', headers=auth_headers, json={
        'name': 'Cfg', 'widgets': [_widget(cfg=cfg)],
    }).get_json()
    assert created['widgets'][0]['cfg'] == cfg

    reread = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    assert reread[-1]['widgets'][0]['cfg'] == cfg


# ── seeded cfg must match what the renderers actually read ───────────────────
# The shipped boards are the first thing every user sees, and a cfg key the
# frontend doesn't read fails SILENTLY — the widget just renders empty. That
# shipped once: `timeseries` seeded `metrics` while the renderer read `series`,
# and `actions` seeded `actions` while the renderer read `items`, so the default
# dashboard greeted everyone with a blank chart and "No actions selected".
#
# This table mirrors the `cfg.*` reads in
# frontend/src/components/dashboard/widgets/renderers.jsx and useWidgetData.js.
# If you change a widget's config shape there, change it here too — that is the
# coupling this test exists to make loud.
RENDERER_CFG_KEYS = {
    'stat':       {'required': {'metric', 'resource'}, 'known': {'metric', 'resource', 'agg', 'thresholds', 'spark', 'color', 'title'}},
    'timeseries': {'required': {'series'},             'known': {'series', 'legend', 'fill', 'title'}},
    'gauge':      {'required': {'metric', 'resource'}, 'known': {'metric', 'resource', 'agg', 'thresholds', 'title'}},
    'topn':       {'required': {'metric'},             'known': {'metric', 'limit', 'title'}},
    'table':      {'required': {'source'},             'known': {'source', 'limit', 'title'}},
    'logs':       {'required': {'source'},             'known': {'source', 'path', 'containerId', 'lines', 'level', 'title'}},
    'deploys':    {'required': set(),                  'known': {'limit', 'title'}},
    'alerts':     {'required': set(),                  'known': {'limit', 'severity', 'title'}},
    'status':     {'required': {'source'},             'known': {'source', 'limit', 'title'}},
    'feed':       {'required': set(),                  'known': {'limit', 'title'}},
    'actions':    {'required': {'items'},              'known': {'items', 'title'}},
    'specs':      {'required': {'resource'},           'known': {'resource', 'title'}},
    'clock':      {'required': set(),                  'known': {'timezone', 'showDate', 'showSeconds', 'title'}},
    'note':       {'required': set(),                  'known': {'text', 'title'}},
}

# Shortcut keys the quick-actions widget can actually resolve to a route
# (ACTIONS in renderers.jsx). Anything else renders nothing.
QUICK_ACTION_KEYS = {
    'servers', 'services', 'docker', 'terminal', 'deploys', 'databases',
    'backups', 'monitoring', 'domains', 'files', 'security', 'jobs',
}


def test_seeded_widget_cfgs_match_the_renderer_contract():
    from app.services.dashboard_service import DEFAULT_BOARDS

    problems = []
    for board in DEFAULT_BOARDS:
        for widget in board['widgets']:
            wtype = widget['type']
            spec = RENDERER_CFG_KEYS.get(wtype)
            if spec is None:
                problems.append(f"{board['slug']}/{widget['i']}: unknown widget type {wtype!r}")
                continue
            keys = set((widget.get('cfg') or {}).keys())
            missing = spec['required'] - keys
            unread = keys - spec['known']
            if missing:
                problems.append(f"{board['slug']}/{widget['i']} ({wtype}): missing {sorted(missing)}")
            if unread:
                problems.append(f"{board['slug']}/{widget['i']} ({wtype}): nothing reads {sorted(unread)}")

    assert not problems, 'seeded cfg drifted from the renderers:\n' + '\n'.join(problems)


def test_seeded_quick_actions_all_resolve():
    """An unrecognised shortcut key is filtered out, so a typo shows an empty
    widget rather than an error."""
    from app.services.dashboard_service import DEFAULT_BOARDS

    for board in DEFAULT_BOARDS:
        for widget in board['widgets']:
            if widget['type'] != 'actions':
                continue
            items = set((widget.get('cfg') or {}).get('items') or [])
            assert items, f"{board['slug']}/{widget['i']}: quick actions with no items"
            unknown = items - QUICK_ACTION_KEYS
            assert not unknown, (
                f"{board['slug']}/{widget['i']}: unroutable shortcuts {sorted(unknown)}"
            )


# ── repairing boards that predate the current renderer contract ──────────────
def test_legacy_board_is_repaired_on_read(app, client, auth_headers):
    """Fixing DEFAULT_BOARDS only helps users who have never opened the
    dashboard — seeding never runs again for anyone else. Boards already in the
    database carried `metrics`/`actions` keys nothing reads and no titles at
    all, so every tile read "Stat" and the chart and shortcuts rendered empty.
    """
    from app import db as _db
    from app.models.dashboard import DashboardBoard
    from app.models import User

    user = User.query.filter_by(username='testadmin').first() or User.query.first()
    legacy = DashboardBoard(
        user_id=user.id, slug='overview', name='Overview', icon='grid', position=0,
        widgets=[
            {'i': 'w1', 'type': 'stat', 'x': 0, 'y': 0, 'w': 3, 'h': 2,
             'cfg': {'metric': 'cpu', 'resource': '$server'}},
            {'i': 'w5', 'type': 'timeseries', 'x': 0, 'y': 2, 'w': 8, 'h': 4,
             'cfg': {'metrics': ['cpu', 'ram'], 'resource': '$server'}},
            {'i': 'w6', 'type': 'actions', 'x': 8, 'y': 2, 'w': 4, 'h': 2,
             'cfg': {'actions': ['new-app', 'deploy', 'terminal', 'backup']}},
        ])
    _db.session.add(legacy)
    _db.session.commit()

    boards = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    board = next(b for b in boards if b['slug'] == 'overview')
    by_id = {w['i']: w for w in board['widgets']}

    # timeseries: metrics -> series, as [{resource, metric}]
    ts = by_id['w5']['cfg']
    assert 'metrics' not in ts
    assert ts['series'] == [{'resource': '$server', 'metric': 'cpu'},
                            {'resource': '$server', 'metric': 'ram'}]

    # actions: actions -> items, aliased to keys that actually route
    items = by_id['w6']['cfg']['items']
    assert 'actions' not in by_id['w6']['cfg']
    assert items and all(i in {'servers', 'services', 'docker', 'terminal', 'deploys',
                              'databases', 'backups', 'monitoring', 'domains',
                              'files', 'security', 'jobs'} for i in items)

    # Titles are NOT written into stored config — that would break the
    # verbatim round-trip promise. The frame derives a display title instead.
    assert 'title' not in by_id['w1']['cfg']

    # and the repair is persisted, not recomputed on every read
    stored = DashboardBoard.query.get(legacy.id)
    assert 'series' in stored.widgets[1]['cfg']


def test_quick_actions_never_render_empty(app, client, auth_headers):
    """An empty shortcut list shows "No actions selected", which is a useless
    thing to greet someone with — fall back to the shipped four."""
    from app import db as _db
    from app.models.dashboard import DashboardBoard
    from app.models import User

    user = User.query.filter_by(username='testadmin').first() or User.query.first()
    board = DashboardBoard(
        user_id=user.id, slug=None, name='Custom', icon='grid', position=9,
        widgets=[{'i': 'a1', 'type': 'actions', 'x': 0, 'y': 0, 'w': 3, 'h': 2,
                  'cfg': {'items': ['nope', 'also-nope']}}])
    _db.session.add(board)
    _db.session.commit()

    boards = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    custom = next(b for b in boards if b['name'] == 'Custom')
    assert custom['widgets'][0]['cfg']['items'], 'unroutable shortcuts left the widget empty'


def test_repair_leaves_a_current_board_untouched(app, client, auth_headers):
    """The repair must be a no-op for config the renderers already understand."""
    from app import db as _db
    from app.models.dashboard import DashboardBoard
    from app.models import User

    user = User.query.filter_by(username='testadmin').first() or User.query.first()
    cfg = {'title': 'Mine', 'series': [{'resource': 'local', 'metric': 'cpu'}],
           'legend': True, 'fill': False}
    board = DashboardBoard(
        user_id=user.id, slug=None, name='Current', icon='grid', position=8,
        widgets=[{'i': 't1', 'type': 'timeseries', 'x': 0, 'y': 0, 'w': 8, 'h': 4,
                  'cfg': dict(cfg)}])
    _db.session.add(board)
    _db.session.commit()

    boards = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    current = next(b for b in boards if b['name'] == 'Current')
    assert current['widgets'][0]['cfg'] == cfg


# --- saved overview layouts (entity-scoped boards) ---------------------------

def test_overview_layout_is_stored_but_is_not_a_dashboard_tab(client, auth_headers):
    saved = client.post('/api/v1/dashboards', headers=auth_headers, json={
        'name': 'Server overview', 'scope': 'entity:server', 'widgets': [_widget()],
    })
    assert saved.status_code == 201
    assert saved.get_json()['slug'] == 'entity:server'

    tabs = client.get('/api/v1/dashboards', headers=auth_headers).get_json()['boards']
    assert 'entity:server' not in [board['slug'] for board in tabs]
    # Saving an overview first must not stop the shipped tabs from seeding.
    assert [board['slug'] for board in tabs] == ['overview', 'infra', 'apps']

    scoped = client.get('/api/v1/dashboards?scope=entity:server', headers=auth_headers).get_json()['boards']
    assert [board['id'] for board in scoped] == [saved.get_json()['id']]
    assert scoped[0]['widgets'] == [_widget()]


@pytest.mark.parametrize('scope', [
    'entity:server', 'entity:service', 'entity:monitoring', 'entity:backups',
])
def test_overview_layout_is_empty_until_saved(client, auth_headers, scope):
    resp = client.get(f'/api/v1/dashboards?scope={scope}', headers=auth_headers)
    assert resp.status_code == 200
    assert resp.get_json()['boards'] == []

    saved = client.post('/api/v1/dashboards', headers=auth_headers, json={
        'name': 'Overview', 'scope': scope, 'widgets': [_widget()],
    })
    assert saved.status_code == 201
    again = client.get(f'/api/v1/dashboards?scope={scope}', headers=auth_headers).get_json()['boards']
    assert [board['slug'] for board in again] == [scope]


def test_saving_an_overview_layout_again_replaces_it(client, auth_headers):
    first = client.post('/api/v1/dashboards', headers=auth_headers, json={
        'name': 'Server overview', 'scope': 'entity:server', 'widgets': [_widget()],
    })
    second = client.post('/api/v1/dashboards', headers=auth_headers, json={
        'name': 'Server overview', 'scope': 'entity:server',
        'widgets': [_widget(i='w1'), _widget(i='w2', x=3)],
    })
    assert second.status_code == 200
    assert second.get_json()['id'] == first.get_json()['id']

    scoped = client.get('/api/v1/dashboards?scope=entity:server', headers=auth_headers).get_json()['boards']
    assert len(scoped) == 1
    assert [widget['i'] for widget in scoped[0]['widgets']] == ['w1', 'w2']


def test_deleting_an_overview_layout_returns_to_the_shipped_one(client, auth_headers):
    saved = client.post('/api/v1/dashboards', headers=auth_headers, json={
        'name': 'Service overview', 'scope': 'entity:service', 'widgets': [_widget()],
    }).get_json()
    assert client.delete(f"/api/v1/dashboards/{saved['id']}", headers=auth_headers).status_code == 200
    scoped = client.get('/api/v1/dashboards?scope=entity:service', headers=auth_headers).get_json()['boards']
    assert scoped == []


def test_overview_layouts_are_scoped_per_user(client, auth_headers, other_headers):
    client.post('/api/v1/dashboards', headers=auth_headers, json={
        'name': 'Server overview', 'scope': 'entity:server', 'widgets': [_widget()],
    })
    theirs = client.get('/api/v1/dashboards?scope=entity:server', headers=other_headers).get_json()['boards']
    assert theirs == []


@pytest.mark.parametrize('scope', ['entity:database', 'overview', '', 7])
def test_unknown_board_scope_is_rejected(client, auth_headers, scope):
    resp = client.post('/api/v1/dashboards', headers=auth_headers, json={
        'name': 'Nope', 'scope': scope, 'widgets': [],
    })
    assert resp.status_code == 400
    assert client.get('/api/v1/dashboards?scope=entity:database', headers=auth_headers).status_code == 400

