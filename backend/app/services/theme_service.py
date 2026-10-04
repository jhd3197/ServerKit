"""Theme service (plan 60).

Business logic for the themes platform: load the bundled seed themes, list /
import / delete installed themes, resolve the panel-default theme (for pre-auth
login/setup screens), and validate every incoming theme through the shared token
whitelist before it touches the DB.

A theme is data, not code — installing one is just storing a validated JSON blob
of color tokens. No filesystem writes, no restart, works identically on a
prebuilt panel.
"""
import json
import logging
import os

from app import db
from app.models.theme import Theme
from app.services import theme_tokens
from app.services.settings_service import SettingsService

logger = logging.getLogger(__name__)

# Bundled seed themes ship as JSON alongside the code (synced from the frontend
# authoring source via frontend/scripts/sync-bundled-themes.mjs).
_THEMES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'themes'
)

# The slug that means "stock look / no skin". Always present, never a DB row.
DEFAULT_THEME_SLUG = 'default'

# Setting key holding the panel-wide default theme slug (what login/setup and
# brand-new users get before they pick their own).
_DEFAULT_SETTING_KEY = 'default_theme'


def _load_bundled_file(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            theme, err = theme_tokens.validate_theme(json.load(f))
            if err:
                logger.warning('Bundled theme %s invalid: %s', path, err)
                return None
            theme['source'] = 'bundled'
            theme['builtin'] = True
            theme['installed'] = True
            return theme
    except Exception as e:  # pragma: no cover - defensive
        logger.warning('Could not read bundled theme %s: %s', path, e)
        return None


def list_bundled():
    """The always-present seed themes, validated. 'default' sorts first."""
    out = []
    try:
        files = sorted(f for f in os.listdir(_THEMES_DIR) if f.endswith('.json'))
    except FileNotFoundError:
        return []
    for fname in files:
        theme = _load_bundled_file(os.path.join(_THEMES_DIR, fname))
        if theme:
            out.append(theme)
    out.sort(key=lambda t: (t['slug'] != DEFAULT_THEME_SLUG, t['name'].lower()))
    return out


def _bundled_map():
    return {t['slug']: t for t in list_bundled()}


def list_installed():
    """Installed (DB) themes as dicts."""
    return [t.to_dict() for t in Theme.query.order_by(Theme.name.asc()).all()]


def list_all():
    """Bundled seeds + installed themes, de-duplicated by slug (an installed
    theme with a bundled slug shadows the seed)."""
    by_slug = {t['slug']: t for t in list_bundled()}
    for t in list_installed():
        by_slug[t['slug']] = t
    themes = list(by_slug.values())
    themes.sort(key=lambda t: (t['slug'] != DEFAULT_THEME_SLUG, (t.get('name') or t['slug']).lower()))
    return themes


def get_theme(slug):
    """Resolve a theme by slug: installed row first, then bundled seed."""
    row = Theme.query.filter_by(slug=slug).first()
    if row:
        return row.to_dict()
    return _bundled_map().get(slug)


def import_theme(raw, source='import'):
    """Validate a raw theme dict and upsert it as an installed theme.

    Returns ``(theme_dict, error)``. ``source`` is one of theme_tokens
    VALID_SOURCES ('import' | 'studio' | 'registry').
    """
    theme, err = theme_tokens.validate_theme(raw)
    if err:
        return None, err
    if source not in theme_tokens.VALID_SOURCES:
        source = 'import'
    if theme['slug'] == DEFAULT_THEME_SLUG:
        return None, "'default' is reserved for the stock theme"

    row = Theme.query.filter_by(slug=theme['slug']).first()
    if row is None:
        row = Theme(slug=theme['slug'])
        db.session.add(row)
    row.name = theme['name']
    row.author = theme['author']
    row.version = theme['version']
    row.description = theme['description']
    row.base = theme['base']
    row.tokens = theme['tokens']
    row.accent = theme['accent']
    row.preview = theme['preview']
    row.source = source
    db.session.commit()
    return row.to_dict(), None


# delete_theme()'s error for an unknown slug; the route compares against this
# constant (`err is THEME_NOT_FOUND`), never against the wording.
THEME_NOT_FOUND = 'Theme not found'


def delete_theme(slug):
    """Uninstall an installed theme. Bundled seeds cannot be deleted. If the
    deleted theme was the panel default, revert the default to the stock look.
    Returns ``(ok, error)``."""
    if slug == DEFAULT_THEME_SLUG:
        return False, 'The default theme cannot be removed'
    row = Theme.query.filter_by(slug=slug).first()
    if row is None:
        # A bundled seed (not a DB row) can't be uninstalled — it ships with the
        # panel. Distinguish that from a genuinely unknown slug so the API can
        # return 400 (can't) vs 404 (nonexistent).
        if slug in _bundled_map():
            return False, 'Bundled themes cannot be removed'
        return False, THEME_NOT_FOUND
    db.session.delete(row)
    if get_default_slug() == slug:
        set_default_slug(DEFAULT_THEME_SLUG)
    db.session.commit()
    return True, None


def get_default_slug():
    """The panel-wide default theme slug."""
    return SettingsService.get(_DEFAULT_SETTING_KEY, DEFAULT_THEME_SLUG) or DEFAULT_THEME_SLUG


def set_default_slug(slug):
    """Set the panel-wide default theme slug. Returns ``(ok, error)``.

    The default must resolve to a known theme (bundled or installed); 'default'
    (stock) is always valid."""
    if slug != DEFAULT_THEME_SLUG and get_theme(slug) is None:
        return False, 'Unknown theme'
    SettingsService.set(_DEFAULT_SETTING_KEY, slug)
    return True, None


def get_public_active():
    """The panel-default theme for the pre-auth login/setup screens.

    Unauthenticated-safe: returns just what the screen needs to paint itself —
    the slug plus the resolved token maps and accent. For the stock look it
    returns ``{slug: 'default'}`` with no tokens (the screen uses the shipped
    stylesheet)."""
    slug = get_default_slug()
    if slug == DEFAULT_THEME_SLUG:
        return {'slug': DEFAULT_THEME_SLUG, 'base': 'dark', 'tokens': {}, 'accent': None}
    theme = get_theme(slug)
    if not theme:
        return {'slug': DEFAULT_THEME_SLUG, 'base': 'dark', 'tokens': {}, 'accent': None}
    return {
        'slug': theme['slug'],
        'name': theme.get('name'),
        'base': theme.get('base', 'dark'),
        'tokens': theme.get('tokens', {}),
        'accent': theme.get('accent'),
    }
