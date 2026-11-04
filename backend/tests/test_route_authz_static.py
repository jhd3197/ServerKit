"""Static authorization-coverage test — every mutating route must carry an
authorization *decision*, proven from the source, not from firing requests.

Companion to ``test_route_authz_sweep.py``. The two are deliberately
complementary:

* The sweep (live-fire) proves **enforcement**: a real viewer JWT is refused.
  It cannot prove coverage — routes that 400/404 on a dummy request before the
  gate runs are invisible to it (GHSA-r4q7-x795-vr4j's ``POST /workspaces/``
  400s on an empty body, so the net would never have caught it).
* This test proves **coverage**: every mutating route in ``app.url_map`` either
  carries a recognized gate, reaches an authorization primitive in its module's
  call graph, or sits in a small reviewed allowlist with a written
  justification. It cannot prove a gate actually rejects — that stays with the
  sweep.

How a route passes (first match wins):

1. ``_sk_authz`` marker on the view function — set by the rbac decorators
   (``@admin_required``, ``@developer_required``, ``@permission_required``,
   ``@require_role``, ``@require_app_member``). ``functools.wraps`` propagates
   the marker outward through ``@jwt_required``.
2. AST reachability: the view's module-level call graph reaches a name in
   ``AUTHORIZATION_PRIMITIVES`` (inline helpers like ``require_admin_user``,
   ``_check_scope``, ``can_edit_app``…) or inspects ``.is_admin`` /
   ``.is_developer``.
3. ``SELF_SCOPED[endpoint]`` — a *reviewed* route that acts only on the
   caller's own rows. Listing is explicit (never inferred) because calling
   ``get_current_user()`` is necessary but NOT sufficient: the advisory's
   ``create_workspace`` used the caller id as the *owner of a new global row*,
   which is not self-scoping. The route must still reach an identity primitive.
4. ``PUBLIC_ALT_AUTH[endpoint]`` — public by design; the value must name the
   alternative mechanism (webhook signature, pairing code, enrollment secret).
5. ``STATELESS[endpoint]`` — pure computation: no persistence, no outbound
   connections, no command execution on attacker-controlled input.

Anything else fails with instructions. Scope note: routes served from
``builtin-extensions/`` (mounted under ``/api/v1/<ext>``) are excluded — they
use the ``auth_required`` API-key model, a different surface that deserves its
own pass.
"""
import ast
import inspect

import pytest


# --- authorization vocabulary ----------------------------------------------

# Inline primitives: calling any of these (directly or through a module-local
# helper) counts as an authorization decision. Names are matched against both
# plain calls (``require_admin_user()``) and method calls
# (``WorkspaceService.get_user_role(...)``).
AUTHORIZATION_PRIMITIVES = frozenset({
    # app/middleware/rbac.py
    'require_admin_user',
    'require_workspace_access',
    'require_workspace_role',
    # workspace / app / server access checks
    'get_user_role',
    'require_app',  # app/api/_access.py
    'get_app_for',
    'can_access_app',
    'can_edit_app',
    'can_operate_app',
    'can_write_in_workspace',
    'verify_workspace_access',
    'verify_server_access',
    'check_server_access',
    'can_access_server',
    'require_app_access',
    # per-file gate helpers established by the audit
    '_check_scope',
    '_check_resource_write',
    '_endpoint_gate',
    '_vault_gate',
    '_ensure_group_accessible',
    '_require_admin',
})

# Inspecting these attributes on the current user is an inline role check.
ATTRIBUTE_GATES = frozenset({'is_admin', 'is_developer'})

# Identity resolution — required for SELF_SCOPED, never sufficient alone.
IDENTITY_PRIMITIVES = frozenset({
    'get_current_user', 'get_jwt_identity', 'get_jwt',
})


# --- reviewed allowlists (endpoint -> justification) -------------------------
# Every entry was reviewed against the code (audit of 2026-08-19; evidence
# file:line recorded in the review). The justification is load-bearing: it is
# the reason this route may legitimately lack a role gate. Keep it specific.

SELF_SCOPED = {
    # Acts only on the caller's own rows, ownership enforced in the service.
    'ai.chat': 'conversation ownership via _load_or_create/_owned_conversation',
    'ai.chat_cancel': 'ownership checked before cancel',
    'ai.chat_confirm': 'conversation ownership + pending action belongs to caller',
    'ai.chat_stream': 'conversation ownership via _load_or_create',
    'ai.create_conversation': 'row stamped with caller user_id',
    'ai.delete_conversation': '_owned_conversation gate',
    'ai.rename_conversation': '_owned_conversation gate',
    'api_keys.revoke_key': 'service query filtered by caller user_id',
    'api_keys.rotate_key': 'service query filtered by caller user_id',
    'auth.passkey_delete': 'credential lookup filtered by id + caller user_id',
    'auth.passkey_register': 'registers a passkey for the JWT user only',
    'auth.passkey_register_options': 'challenge issued for the JWT user only',
    'auth.refresh': 'mints an access token only for the refresh-token identity',
    'auth.update_current_user': 'mutates only the caller\'s own user row',
    'dashboards.create_board': 'board created with caller user_id',
    'dashboards.delete_board': 'get_board_for_user scopes id + user_id',
    'dashboards.reset_board': 'get_board_for_user scopes id + user_id',
    'dashboards.update_board': 'get_board_for_user scopes id + user_id',
    'event_subscriptions.delete_subscription': 'service get_for_user enforces admin-or-owner',
    'event_subscriptions.retry_delivery': 'routes through get_for_user (owner check)',
    'event_subscriptions.test_subscription': 'routes through get_for_user (owner check)',
    'event_subscriptions.update_subscription': 'routes through get_for_user (owner check)',
    'mobile.register_push': 'writes the caller\'s own push_subscriptions_json',
    'notifications.mark_inbox_all_read': 'mark_all_read scoped to caller user_id',
    'notifications.mark_inbox_read': 'inbox query scoped to caller user_id',
    'notifications.test_user_notification': 'sends only to the caller\'s own channels',
    'notifications.unmute_own_email': 'unmutes the caller\'s own email only',
    'notifications.update_user_preferences': 'preferences row keyed to caller',
    'queue_bus.create_group': 'non-admin owner_type/owner_id forced to the caller',
    'secrets_webhooks.create_webhook_endpoint': 'workspace resolved via membership-checked resolve_workspace_id; endpoint stamped with caller user_id',
    'source_connections.bitbucket_callback': 'completes OAuth for the caller\'s user_id',
    'source_connections.disconnect_bitbucket': 'disconnect scoped to caller user_id',
    'source_connections.disconnect_github': 'disconnect scoped to caller user_id',
    'source_connections.disconnect_gitlab': 'disconnect scoped to caller user_id',
    'source_connections.github_callback': 'completes OAuth for the caller\'s user_id',
    'source_connections.gitlab_callback': 'completes OAuth for the caller\'s user_id',
    'sso.link_provider': 'links identity to the JWT user with cross-account conflict check',
    'sso.unlink_provider': 'unlink_identity scoped to caller user_id',
    'two_factor.confirm_2fa_setup': 'own user + valid TOTP required',
    'two_factor.disable_2fa': 'own user, requires TOTP/backup code',
    'two_factor.initiate_2fa_setup': 'own user 2FA setup only',
    'two_factor.regenerate_backup_codes': 'own user, TOTP required',
    'views.create_view': 'view created with caller user_id',
    'views.delete_view': 'query filtered by id + caller user_id',
    'views.update_view': 'query filtered by id + caller user_id',
}

PUBLIC_ALT_AUTH = {
    # Public by design; the value names the mechanism that authenticates the call.
    'agent_poll.connect': 'agent HMAC handshake + per-IP throttle',
    'agent_poll.disconnect': 'X-Session-Token lookup',
    'agent_report.report': 'HMAC over timestamp+nonce+body hash, skew/replay/rate limits',
    'agent_poll.poll': 'X-Session-Token resolves the ConnectedAgent',
    'agent_poll.result': 'X-Session-Token resolves the ConnectedAgent',
    'auth.connect_session': 'loopback-only + Cloud grant verified against JWKS, 30/min',
    'auth.login': 'password credential + per-IP/per-user throttles + lockout',
    'auth.passkey_authenticate': 'WebAuthn assertion verification, 5/min',
    'auth.redeem_login_link': 'single-use login-link token + per-IP throttle',
    'auth.register': 'invite token / first-user / registration-enabled flag, 3/min',
    'ddns.update': 'per-host token is the credential (DynDNS protocol)',
    'deploy.webhook': 'URL token + provider signature verified before handling',
    'error_logs.client_error_log': 'unauthenticated client error intake: per-IP rate limit + strict field validation',
    'git.receive_webhook': 'webhook token lookup + HMAC signature before processing',
    'notifications.inbound_email_webhook': 'HMAC-SHA256 over raw body; 404 when secret unset',
    'pairing.code_freeze': 'enrollment_id + enrollment_secret',
    'pairing.code_refresh': 'enrollment_id + enrollment_secret',
    'pairing.enroll': 'pubkey+passphrase enrollment; produces a PENDING enrollment needing developer-gated claim',
    'pairing.poll': 'enrollment creds + optional Ed25519 proof-of-possession',
    'preview_webhooks.receive_pull_request': 'webhook token lookup + HMAC signature before any action',
    'secrets_webhooks.receive_webhook': 'HMAC signature mandatory since the 2026-08 fix (missing or wrong signature -> 401)',
    'servers.register_agent': 'single-use hashed registration token, 5/min',
    'sso.callback': 'OAuth authorization-code + state exchange with the provider',
    'sso.saml_callback': 'SAML assertion validated by the SSO service',
    'two_factor.verify_2fa_code': 'short-lived 2fa_pending token + TOTP/backup code + throttle',
}

STATELESS = {
    # Persists nothing, dials nothing attacker-chosen, executes nothing
    # attacker-controlled.
    'agent_plugins.validate_manifest': 'pure manifest schema validation',
    'auth.passkey_auth_options': 'challenge issuance only, no mutation',
    'buildpacks.generate': 'pure plan -> Dockerfile/compose templating',
    'cron.preview_schedule': 'pure cron-expression computation',
    'dns_cutover.ttl_guidance': 'pure computation over supplied records',
    'dns_cutover.verify': 'read-only DNS lookups against public resolvers',
    'docker.get_containers_stats': 'read-via-POST of container stats; viewer holds docker:read',
    'firewall.rule_removal_preflight': 'pure analysis against current rules',
    'htaccess_tools.htaccess_convert': 'pure text transform, 256KB cap',
    'mobile.execute_quick_action': 'stub: canned no-op responses / live metrics read only',
    'mobile.unregister_push': 'stub: returns success without touching the DB',
    'servers.check_agent_version': 'agent-facing version check; outbound only to a fixed GitHub releases URL, cached',
    'templates.validate_installation': 'validation only (name-clash read + variable checks)',
}


# --- AST machinery -----------------------------------------------------------

_MUTATING = {'POST', 'PUT', 'PATCH', 'DELETE'}


def _mutating_rules(app):
    """Mutating rules served from backend/app/api (the core surface).

    Yields ``(rule, view, unwrapped)``: ``view`` is the registered (possibly
    decorator-wrapped) endpoint function — where ``_sk_authz`` markers live —
    and ``unwrapped`` is the original view reached through ``__wrapped__``
    chains, which is what source-file attribution and AST analysis must use
    (``inspect.getsourcefile`` on a wrapped view returns the *decorator's*
    module, e.g. flask_jwt_extended, not the route's file).
    """
    for rule in app.url_map.iter_rules():
        if not (rule.methods & _MUTATING):
            continue
        view = app.view_functions.get(rule.endpoint)
        if view is None:
            continue
        try:
            unwrapped = inspect.unwrap(view)
        except ValueError:  # wrapper cycle
            unwrapped = view
        src = inspect.getsourcefile(unwrapped)
        if src is None or '\\app\\api\\' not in src.replace('/', '\\'):
            continue  # builtin-extensions and flask internals: separate surface
        yield rule, view, unwrapped


def _module_functions(path):
    """name -> FunctionDef for every function defined in the module."""
    with open(path, encoding='utf-8') as fh:
        tree = ast.parse(fh.read())
    return {n.name: n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))}


def _called_names(fn):
    """Every called name plus gated-attribute lookups in one function body."""
    names = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name):
                names.add(func.id)
            elif isinstance(func, ast.Attribute):
                names.add(func.attr)
        elif isinstance(node, ast.Attribute) and node.attr in ATTRIBUTE_GATES:
            names.add(node.attr)
    return names


def _reachable_names(funcs, start):
    """Transitive closure of names callable from `start` within the module."""
    calls = {name: _called_names(f) for name, f in funcs.items()}
    seen, stack = set(), [start]
    while stack:
        for callee in calls.get(stack.pop(), ()):
            if callee not in seen:
                seen.add(callee)
                stack.append(callee)
    return seen


# --- the test ----------------------------------------------------------------

def test_every_mutating_route_carries_an_authorization_decision(app):
    # Parse each api module at most once.
    module_funcs = {}

    def reachable(unwrapped):
        path = inspect.getsourcefile(unwrapped)
        if path not in module_funcs:
            module_funcs[path] = _module_functions(path)
        return _reachable_names(module_funcs[path], unwrapped.__name__)

    ungated = []
    for rule, view, unwrapped in _mutating_rules(app):
        endpoint = rule.endpoint

        # 1. Decorator gate (marker propagates through functools.wraps).
        if getattr(view, '_sk_authz', None):
            continue

        names = reachable(unwrapped)

        # 2. Inline primitive or attribute role check.
        if names & AUTHORIZATION_PRIMITIVES or names & ATTRIBUTE_GATES:
            continue

        # 3. Reviewed self-scoped route — must resolve the caller's identity.
        if endpoint in SELF_SCOPED and names & IDENTITY_PRIMITIVES:
            continue

        # 4/5. Reviewed public-with-alt-auth / stateless routes.
        if endpoint in PUBLIC_ALT_AUTH or endpoint in STATELESS:
            continue

        methods = sorted(rule.methods & _MUTATING)
        ungated.append(f'{methods} {rule.rule} ({endpoint})')

    assert not ungated, (
        'Mutating route(s) with no authorization decision found:\n  '
        + '\n  '.join(sorted(ungated))
        + '\n\nFix one of:'
        '\n  - add a gate decorator (@admin_required / @developer_required /'
        ' @permission_required), or'
        '\n  - call an inline authorization primitive (require_admin_user,'
        ' require_app, _check_scope, ...), or'
        '\n  - if the route is genuinely self-scoped / public-with-alt-auth /'
        ' stateless, add it to the matching allowlist in this file with a'
        ' specific justification.'
    )


def test_static_allowlists_are_not_stale(app):
    """Every allowlisted endpoint must still exist and still need its listing.

    A stale entry is a hiding place: if the route is renamed or gains a real
    gate, the entry must leave so a future route cannot reuse the slot.
    """
    live = {rule.endpoint for rule, _, _ in _mutating_rules(app)}
    listed = set(SELF_SCOPED) | set(PUBLIC_ALT_AUTH) | set(STATELESS)
    stale = listed - live
    assert not stale, f'Allowlist entries for endpoints that no longer exist: {sorted(stale)}'


def test_self_scoped_entries_actually_resolve_identity(app):
    """A SELF_SCOPED entry whose route no longer resolves the caller's identity
    is not self-scoped by any definition — drop the entry or fix the route."""
    module_funcs = {}
    bogus = []
    for rule, _, unwrapped in _mutating_rules(app):
        if rule.endpoint not in SELF_SCOPED:
            continue
        path = inspect.getsourcefile(unwrapped)
        if path not in module_funcs:
            module_funcs[path] = _module_functions(path)
        names = _reachable_names(module_funcs[path], unwrapped.__name__)
        if not (names & IDENTITY_PRIMITIVES):
            bogus.append(rule.endpoint)
    assert not bogus, (
        f'SELF_SCOPED entries whose view never resolves the caller identity: {sorted(bogus)}'
    )
