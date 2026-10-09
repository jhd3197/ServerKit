"""Frontend SDK compatibility contract (backend mirror).

The canonical value lives in ``frontend/src/plugins/sdk/index.js`` as the exported
``SDK_VERSION`` constant. The backend can't import JS at runtime, so this module
mirrors it — the two are kept in lock-step and asserted equal by
``backend/tests/test_sdk_contract.py``.

Purpose:
  - ``GET /api/v1/plugins/contributions`` reports ``sdk_version`` so the panel UI
    and tooling know what SDK surface the running panel offers.
  - An extension's ``plugin.json`` may declare ``sdk_version`` — a semver RANGE the
    extension is built against. It's checked at install
    (``plugin_service._assert_manifest_sdk_compatible``) and, for runtime ESM
    bundles, again at load (the loader refuses an incompatible bundle before
    fetching any bytes and explains why). A manifest that pins no range installs
    and loads anywhere — fail-open, deliberately.

The range grammar accepted by ``sdk_version_satisfies`` is intentionally small
(the subset extension authors actually write):

  - empty / ``*`` / ``x``        → matches anything
  - ``1.2.3``                    → exact
  - ``^1.2.3``                   → >=1.2.3 and <2.0.0 (caret; 0.x pins the minor)
  - ``~1.2.3``                   → >=1.2.3 and <1.3.0 (tilde)
  - ``>=1.2.0``, ``>1.0``, ``<=2``, ``<2.0.0``, ``=1.2.3``
  - a comma- or space-separated AND of the comparators above
"""
import re

from app.utils.version import compare_versions

# Keep in lock-step with frontend/src/plugins/sdk/index.js `SDK_VERSION`.
#
# 1.6.0 — one field per job: ServerPicker, DomainField + attachDomain,
#   PortField, EnvEditor, CopyField/CopyButton, InfoList, CatalogCard/Grid.
# 1.5.0 — declarative walkthrough authoring helpers and useWalkthroughs.
# 1.3.0 — plan 79: localization. useTranslation/Trans/t, useLocale, useLabel,
#   and the locale-aware format door (useFormat + formatDate/Number/Relative/…).
#   i18next and react-i18next also became SHARED vendor singletons, so an
#   extension that externalizes them needs a panel at this SDK or newer:
#   pin `"sdk_version": "^1.3.0"` if you use any of that surface.
#   Additive — an extension pinned to ^1.2.0 keeps loading.
# 1.2.0 — plan 52 Phases 4-5: layout/feedback primitives, ui/* form kit,
#   common hooks, format utils, and the cross-feature embeds (git repo-connect,
#   backups ProtectionPanel) the WordPress runtime-ESM extraction needed.
SDK_VERSION = '1.6.0'


def _version_tuple(v):
    parts = []
    for chunk in str(v).split('-')[0].split('+')[0].split('.'):
        num = ''.join(ch for ch in chunk if ch.isdigit())
        parts.append(int(num) if num else 0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def _satisfies_one(current, comparator):
    """Evaluate ``current`` against a single comparator token (already trimmed)."""
    comparator = comparator.strip()
    if not comparator or comparator in ('*', 'x', 'X'):
        return True

    m = re.match(r'^(\^|~|>=|<=|>|<|=)?\s*v?(.+)$', comparator)
    if not m:
        return True  # fail open on anything we don't understand
    op, ver = m.group(1) or '=', m.group(2).strip()

    if op == '^':
        lo = _version_tuple(ver)
        if lo[0] > 0:
            hi = (lo[0] + 1, 0, 0)
        elif lo[1] > 0:
            hi = (0, lo[1] + 1, 0)
        else:
            hi = (0, 0, lo[2] + 1)
        cur = _version_tuple(current)
        return lo <= cur < hi
    if op == '~':
        lo = _version_tuple(ver)
        hi = (lo[0], lo[1] + 1, 0)
        cur = _version_tuple(current)
        return lo <= cur < hi

    cmp = compare_versions(current, ver)
    if op == '>=':
        return cmp >= 0
    if op == '<=':
        return cmp <= 0
    if op == '>':
        return cmp > 0
    if op == '<':
        return cmp < 0
    return cmp == 0  # '=' or bare


def sdk_version_satisfies(range_str, current=None):
    """True iff ``current`` (defaults to this panel's SDK_VERSION) satisfies the
    semver ``range_str``. Empty/None range matches anything (an extension that
    doesn't pin a range installs everywhere). Malformed comparators fail open —
    a bad range must never hard-block for the wrong reason."""
    if current is None:
        current = SDK_VERSION
    if not range_str or not str(range_str).strip():
        return True
    # AND of comma- or whitespace-separated comparators.
    tokens = [t for t in re.split(r'[\s,]+', str(range_str).strip()) if t]
    return all(_satisfies_one(current, t) for t in tokens)
