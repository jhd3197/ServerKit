"""Authorization sweep — the default-deny backstop for mutating routes.

Motivation
----------
GHSA-r4q7-x795-vr4j: ``POST /api/v1/workspaces/`` shipped gated only by
``@jwt_required()``, so a read-only *viewer* could create and administer
workspaces. It was one forgotten authorization check, and it was not the only
one — an audit of every mutating route turned up the same class in the docker
compose read routes (arbitrary-path log/config disclosure) and the whole
monitors surface (viewer could create/edit/delete monitors and incidents).

The root cause is architectural: ServerKit has **no enforced default-deny**.
Authorization is opt-in per route, via a decorator *or* an inline helper
(``_can_edit_app``, ``require_workspace_role``, ``_check_scope``, ...). Nothing
fails closed when an author forgets, so each new feature file is one missing
line away from re-introducing the bug.

This module is the CI backstop for that class. It has two parts:

* ``test_fixed_routes_reject_non_admins`` — a precise, hermetic proof that the
  specific routes fixed alongside the advisory (docker compose + monitors)
  reject a viewer *and* a developer. These use ``@permission_required`` /
  ``@admin_required``, which run before the view body, so a dummy id still
  exercises the gate (403, not a 404 for the missing row).

* ``test_no_mutating_route_succeeds_for_a_viewer`` — the regression net. It
  fires every mutating route as a viewer and asserts none returns a 2xx unless
  its endpoint is in ``VIEWER_WRITABLE`` (a reviewed allowlist). A newly-added
  route that forgets to gate and happily answers a viewer with ``201`` trips
  this test until the author either gates it or consciously allowlists it.

Known limitation: a route with a path parameter that resolves its resource
(and 404s) *before* checking authorization is invisible to the live-fire net
— the 404 masks a missing gate. The net therefore catches the clearest
regressions (creates and global toggles with no path param); resource-scoped
routes need their own per-feature tests. See ``VIEWER_WRITABLE`` notes for the
handful of endpoints that remain viewer-writable and are tracked as follow-ups.
"""
import pytest

from factories import make_user, headers_for


# --- Part A: the routes fixed alongside the advisory -----------------------

# (endpoint path, method) — every mutating route on the docker compose read
# surface and the monitors surface. A viewer and a developer must both be
# refused; only an admin gets through.
_MONITORS_WRITE = [
    ('/api/v1/monitors/', 'POST'),
    ('/api/v1/monitors/1', 'PUT'),
    ('/api/v1/monitors/1', 'DELETE'),
    ('/api/v1/monitors/1/check', 'POST'),
    ('/api/v1/monitors/1/pause', 'POST'),
    ('/api/v1/monitors/incidents', 'POST'),
    ('/api/v1/monitors/incidents/1', 'PUT'),
    ('/api/v1/monitors/incidents/1', 'DELETE'),
]

_DOCKER_COMPOSE_READ = [
    ('/api/v1/docker/compose/ps', 'POST'),
    ('/api/v1/docker/compose/logs', 'POST'),
    ('/api/v1/docker/compose/validate', 'POST'),
    ('/api/v1/docker/compose/config', 'POST'),
]

# The advisory fix itself plus the viewer-write gaps the same audit surfaced:
# workspace creation, the global uptime on/off toggles, registrar sync/test
# (their add/delete siblings were already admin-only), and template drift checks.
_ADMIN_GATED_ROUND2 = [
    ('/api/v1/workspaces/', 'POST'),
    ('/api/v1/uptime/tracking/start', 'POST'),
    ('/api/v1/uptime/tracking/stop', 'POST'),
    ('/api/v1/registrars/sync', 'POST'),
    ('/api/v1/registrars/connections/1/test', 'POST'),
    ('/api/v1/server-templates/assignments/1/check', 'POST'),
]

_FIXED_ROUTES = _MONITORS_WRITE + _DOCKER_COMPOSE_READ + _ADMIN_GATED_ROUND2

# Round 3 — gaps surfaced by the static-coverage audit (see
# test_route_authz_static.py, seeded 2026-08-19). Admin-gated: both a viewer
# and a developer must be refused.
_ADMIN_GATED_ROUND3 = [
    ('/api/v1/fleet-monitor/alerts/a1/acknowledge', 'POST'),
    ('/api/v1/fleet-monitor/alerts/a1/resolve', 'POST'),
    ('/api/v1/recycle-bin/apps/1/restore', 'POST'),
    ('/api/v1/nginx/advanced/test', 'POST'),
    ('/api/v1/nginx/advanced/diff', 'POST'),
]

# Developer-gated: a viewer is refused; a developer is admitted (the body may
# still 400/404/500 on the dummy payload — only the gate must not fire).
_DEVELOPER_GATED_ROUND3 = [
    ('/api/v1/servers/s1/docker/compose/ps', 'POST'),
    ('/api/v1/servers/s1/docker/compose/logs', 'POST'),
    ('/api/v1/servers/s1/refresh-capabilities', 'POST'),
    ('/api/v1/servers/s1/ping', 'POST'),
    ('/api/v1/templates/test-db-connection', 'POST'),
    ('/api/v1/deploy/branches', 'POST'),
    ('/api/v1/buildpacks/detect', 'POST'),
]

_FIXED_ROUTES += _ADMIN_GATED_ROUND3


@pytest.mark.parametrize('path,method', _FIXED_ROUTES)
@pytest.mark.parametrize('role', ['viewer', 'developer'])
def test_fixed_routes_reject_non_admins(client, db_session, path, method, role):
    """A viewer and a developer are refused (403) on every fixed route.

    The gate is a decorator, so it fires before the view body — the dummy id
    ``1`` never matters; we never reach the row lookup.
    """
    headers = headers_for(make_user(db_session, role=role))
    resp = client.open(path, method=method, headers=headers, json={})
    assert resp.status_code == 403, (
        f'{method} {path} let a {role} through with {resp.status_code}; '
        f'expected 403 from the authorization gate'
    )


@pytest.mark.parametrize('path,method', _FIXED_ROUTES)
def test_fixed_routes_admit_admin(client, db_session, path, method):
    """Sanity: an admin is NOT stopped by the authorization gate.

    The body may still 400/404/500 on the dummy payload — we only assert the
    gate itself did not reject the admin (never 401/403).
    """
    if path == '/api/v1/uptime/tracking/start':
        # Side-effecting for an admin (spawns the tracking daemon thread);
        # the viewer/developer 403 above is the security assertion here.
        return
    headers = headers_for(make_user(db_session, role='admin'))
    resp = client.open(path, method=method, headers=headers, json={})
    assert resp.status_code not in (401, 403), (
        f'{method} {path} wrongly blocked an admin with {resp.status_code}'
    )


@pytest.mark.parametrize('path,method', _DEVELOPER_GATED_ROUND3)
def test_developer_gated_routes_reject_viewers(client, db_session, path, method):
    """A viewer is refused (403) on every developer-gated round-3 route."""
    headers = headers_for(make_user(db_session, role='viewer'))
    resp = client.open(path, method=method, headers=headers, json={})
    assert resp.status_code == 403, (
        f'{method} {path} let a viewer through with {resp.status_code}; '
        f'expected 403 from @developer_required'
    )


@pytest.mark.parametrize('path,method', _DEVELOPER_GATED_ROUND3)
def test_developer_gated_routes_admit_developers(client, db_session, path, method):
    """Sanity: a developer is NOT stopped by the gate (body may 400/404/500)."""
    headers = headers_for(make_user(db_session, role='developer'))
    resp = client.open(path, method=method, headers=headers, json={})
    assert resp.status_code not in (401, 403), (
        f'{method} {path} wrongly blocked a developer with {resp.status_code}'
    )


def test_queue_group_mutations_are_owner_scoped(app, client, db_session):
    """queue_bus cross-user fix: `_ensure_group_mutable` alone only blocked
    *system* groups — any authenticated user could rename/delete another
    user's groups, queues and messages. Every mutating route now also calls
    `_ensure_group_accessible` (owner-or-admin)."""
    from app.queue_bus.service import QueueBusService

    owner = make_user(db_session, role='developer')
    intruder = make_user(db_session, role='developer')
    group = QueueBusService.create_group(
        slug='owned-group', name='Owned', owner_type='user', owner_id=str(owner.id),
    )
    slug = group['slug'] if isinstance(group, dict) else group.slug

    headers = headers_for(intruder)
    attempts = [
        ('PATCH', f'/api/v1/queue/groups/{slug}'),
        ('DELETE', f'/api/v1/queue/groups/{slug}'),
        ('POST', f'/api/v1/queue/groups/{slug}/queues'),
        ('POST', f'/api/v1/queue/groups/{slug}/queues/q1/messages'),
    ]
    for method, url in attempts:
        resp = client.open(url, method=method, headers=headers,
                           json={'name': 'x', 'payload': {}})
        assert resp.status_code == 403, (
            f'{method} {url} let a non-owner through with {resp.status_code}'
        )

    # The owner themselves is NOT blocked by the accessibility guard.
    resp = client.open(f'/api/v1/queue/groups/{slug}', method='PATCH',
                       headers=headers_for(owner), json={'description': 'mine'})
    assert resp.status_code != 403


# --- Part B: the default-deny regression net -------------------------------

# Endpoints where a viewer legitimately receives a 2xx today. Each is reviewed
# and categorized. Adding a NEW mutating route that answers a viewer with a 2xx
# will fail the sweep below until it is gated or deliberately listed here.
VIEWER_WRITABLE = {
    # SELF — the viewer acts only on their own account/data.
    'ai.create_conversation',
    'auth.update_current_user',
    # Registration options bind exclusively to get_jwt_identity(); a viewer
    # may enroll their own passkey, never nominate another account in JSON.
    'auth.passkey_register_options',
    'notifications.mark_inbox_all_read',
    'notifications.test_user_notification',
    'notifications.unmute_own_email',
    'two_factor.initiate_2fa_setup',
    'walkthroughs.update_walkthrough_state',
    'mobile.execute_quick_action',
    # STATELESS — parse/validate/dry-run helpers; no persisted mutation.
    'cron.preview_schedule',
    'dns_cutover.ttl_guidance',
    'firewall.rule_removal_preflight',
    'nginx_advanced.test_config',
    # READ-VIA-POST — a read the permission model already grants a viewer
    # (viewer has docker:read). POST only because it takes a body of ids.
    'docker.get_containers_stats',
    # PUBLIC transport — agent long-poll fallback; user JWT is ignored here.
    'agent_poll.disconnect',
    'agent_report.report',
    # PUBLIC authentication challenge only; credential verification and UV are
    # required by passkey_authenticate before any session tokens are issued.
    'auth.passkey_auth_options',
}


def test_passkey_enrollment_options_are_self_scoped(client, db_session):
    from app.services.passkey_service import PasskeyService, _b64decode_url
    viewer = make_user(db_session, role='viewer')
    foreign = make_user(db_session, role='admin')
    assert client.post('/api/v1/auth/passkeys/options/register', json={}).status_code == 401
    response = client.post('/api/v1/auth/passkeys/options/register',
                           headers=headers_for(viewer), json={'user_id': foreign.id})
    assert response.status_code == 200
    assert _b64decode_url(response.json['user']['id']) == str(viewer.id).encode()
    assert PasskeyService._get_challenge(viewer.id, 'register') is not None
    assert PasskeyService._get_challenge(foreign.id, 'register') is None


def test_public_passkey_options_issue_only_a_challenge(client, db_session):
    from app.models import PasskeyCredential
    viewer = make_user(db_session, role='viewer')
    response = client.post('/api/v1/auth/passkeys/options/authenticate',
                           json={'user_id': viewer.id})
    assert response.status_code == 200
    assert response.json['challenge']
    assert response.json['userVerification'] == 'required'
    assert 'access_token' not in response.json and 'refresh_token' not in response.json
    assert PasskeyCredential.query.count() == 0

# Endpoints skipped by the live-fire net because firing them reaches out to the
# network / external providers (slow, flaky in CI). Their gating is asserted by
# dedicated per-feature tests, not here.
_SKIP_ENDPOINTS = {
    'servers.check_agent_version',
    # Revokes the sweep's shared viewer token, masking later missing gates.
    # Covered with real viewer sessions in test_session_security.py instead.
    'auth.logout',
}


def _mutating_rules(app):
    for rule in app.url_map.iter_rules():
        methods = rule.methods - {'GET', 'HEAD', 'OPTIONS'}
        if not methods:
            continue
        if rule.endpoint in _SKIP_ENDPOINTS:
            continue
        method = 'POST' if 'POST' in methods else sorted(methods)[0]
        yield rule, method


def _fill(rule):
    """Concrete URL for a rule, dummy values for path params."""
    url = rule.rule
    for arg in rule.arguments:
        conv = type(rule._converters.get(arg)).__name__
        val = '1' if 'Integer' in conv or 'Float' in conv else 'x'
        for token in (f'<{arg}>', f'<int:{arg}>', f'<string:{arg}>',
                      f'<path:{arg}>', f'<float:{arg}>', f'<default:{arg}>'):
            url = url.replace(token, val)
    return url


def test_no_mutating_route_succeeds_for_a_viewer(app, client, db_session):
    """No mutating route may answer a viewer with a 2xx unless allowlisted.

    This is the default-deny backstop. A 2xx here means the authorization gate
    definitively did NOT stop a read-only user — the exact shape of the
    workspace advisory. Non-2xx (401/403/400/404/5xx) is fine: either the gate
    refused, or the body rejected the dummy payload before mutating anything.
    """
    headers = headers_for(make_user(db_session, role='viewer'))
    offenders = []
    for rule, method in _mutating_rules(app):
        url = _fill(rule)
        try:
            resp = client.open(url, method=method, headers=headers, json={})
            code = resp.status_code
        except Exception:
            # A crash in the view body is not a viewer succeeding — the gate
            # question is answered "not 2xx". Real gating bugs surface as 2xx.
            continue
        if 200 <= code < 300 and rule.endpoint not in VIEWER_WRITABLE:
            offenders.append(f'{method} {url} ({rule.endpoint}) -> {code}')

    assert not offenders, (
        'A read-only viewer received a success response on mutating '
        'route(s) with no authorization gate:\n  ' + '\n  '.join(sorted(offenders))
        + '\n\nGate the route (a decorator or an inline role/ownership check), '
        'or — if a viewer is genuinely allowed — add the endpoint to '
        'VIEWER_WRITABLE with a category comment.'
    )


def test_viewer_writable_allowlist_is_not_stale(app):
    """Every allowlisted endpoint must still exist — stale entries hide gaps.

    If a route is renamed/removed and its VIEWER_WRITABLE entry is left behind,
    a future viewer-writable route could reuse a nearby name and slip through.
    """
    live = {r.endpoint for r in app.url_map.iter_rules()}
    stale = (VIEWER_WRITABLE | _SKIP_ENDPOINTS) - live
    assert not stale, f'Allowlist references endpoints that no longer exist: {sorted(stale)}'
