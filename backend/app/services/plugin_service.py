"""
Plugin Service - Download, install, and manage ServerKit plugins from URLs.

Plugins are zip files containing a plugin.json manifest, optional backend/
and frontend/ directories. They get extracted into the ServerKit plugins
directories and auto-registered at startup.
"""
import io
import json
import logging
import os
import re
import shutil
import subprocess

from app.utils.system import run_checked
import sys
import tempfile
import zipfile

from app import db
from app.utils.env import env_bool
from app.models.plugin import InstalledPlugin
from app.services.plugin_fetch import (  # noqa: F401  (re-exported)
    GitHubResolveError, _LAST_RESOLUTION, _download_resolved, _download_zip,
    _normalize_source_url, _resolve_github_url, _safe_get,
)

logger = logging.getLogger(__name__)

# Resolve paths relative to the backend directory.
# __file__ = backend/app/services/plugin_service.py
# _APP_DIR = backend/app/
# _BACKEND_ROOT = backend/
# _PROJECT_ROOT = ServerKit/
#
# Both targets are env-var overridable. The defaults work for native dev
# (backend run from a checkout). They break in Docker because the backend
# image only contains /app — the host's frontend directory isn't mounted —
# so dockerized panels MUST set SERVERKIT_FRONTEND_PLUGINS_DIR (and bind
# mount the corresponding host folder) when installing plugins that ship
# a frontend.
_APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_BACKEND_ROOT = os.path.dirname(_APP_DIR)
_PROJECT_ROOT = os.path.dirname(_BACKEND_ROOT)

BACKEND_PLUGINS_DIR = os.environ.get(
    'SERVERKIT_BACKEND_PLUGINS_DIR',
    os.path.join(_APP_DIR, 'plugins'),
)
FRONTEND_PLUGINS_DIR = os.environ.get(
    'SERVERKIT_FRONTEND_PLUGINS_DIR',
    os.path.join(_PROJECT_ROOT, 'frontend', 'src', 'plugins'),
)

# Folder of bundled-with-the-repo extensions that ship as plugins
# but are not installed by default. The discovery endpoint enumerates
# this folder so the Marketplace can show one-click installs without
# requiring users to know absolute paths.
BUILTIN_EXTENSIONS_DIR = os.environ.get(
    'SERVERKIT_BUILTIN_EXTENSIONS_DIR',
    os.path.join(_PROJECT_ROOT, 'builtin-extensions'),
)

# Flagship extensions (decision D4): bundled, installed-by-default on EVERY panel
# (fresh and upgrade), and uninstallable. Unlike the niche Tier-1 conversions
# (handled one-shot in extension_migration), a flagship is seeded in-place — no
# file copy — its backend loads straight from builtin-extensions/ and its frontend
# is pre-bundled (D5). A user uninstall records a marker so it stays gone.
#
# serverkit-wordpress GRADUATED from this list: it left the
# tree into its own repo and now distributes through the registry (the
# k8s/tramo model — bundled index entry + GitHub release zip), offered during
# onboarding via RECOMMENDED_EXTENSIONS_BY_USE_CASE. Its uninstall-marker
# semantics are preserved (the settings key machinery below is untouched), so
# a user who uninstalled WP before the extraction is never re-seeded.
FLAGSHIP_SLUGS = []  # cloudflare-ops left the tree (cutover); machinery kept for future flagships
_FLAGSHIP_UNINSTALLED_KEY = 'extensions.flagship_uninstalled'

# Wizard-optional flagships: offered — not force-installed — during
# onboarding. Currently EMPTY: WordPress (the only member) left the tree in
# its own repo and is now a registry extension the wizard offers like any
# other recommendation. The machinery stays — a future in-tree flagship that
# should be wizard-optional goes here.
WIZARD_OPTIONAL_FLAGSHIP_SLUGS = []


def _ensure_builtin_backend_importable(slug):
    """Register ``builtin-extensions/<slug>/backend`` as the dashed package
    ``app.plugins.<slug>`` in ``sys.modules`` (in-place, no copy), so its
    blueprints and services import — and relative imports inside resolve —
    without the plugin being copy-installed under ``app/plugins/``.

    This is what makes a dashed, default-installed flagship loadable uniformly in
    production, dev checkouts, and the test suite. Idempotent; returns ``True`` if
    the package is (now) importable.
    """
    import importlib
    import importlib.util
    pkg = f'app.plugins.{slug}'
    if pkg in sys.modules:
        return True
    try:
        importlib.import_module(pkg)  # already copy-installed under app/plugins/
        return True
    except ImportError:
        pass
    backend_dir = os.path.join(BUILTIN_EXTENSIONS_DIR, slug, 'backend')
    init_py = os.path.join(backend_dir, '__init__.py')
    if not os.path.isfile(init_py):
        return False
    try:
        importlib.import_module('app.plugins')  # ensure the parent package exists
        spec = importlib.util.spec_from_file_location(
            pkg, init_py, submodule_search_locations=[backend_dir]
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[pkg] = module
        spec.loader.exec_module(module)
        return True
    except Exception as e:
        logger.warning(f'In-place load of {pkg} failed: {e}')
        sys.modules.pop(pkg, None)
        return False


def _ensure_backend_dir():
    """Create the backend plugin dir; raise a useful error if we can't."""
    try:
        os.makedirs(BACKEND_PLUGINS_DIR, exist_ok=True)
    except OSError as e:
        raise ValueError(
            f"Cannot create backend plugin directory at {BACKEND_PLUGINS_DIR}: {e}. "
            f"Set SERVERKIT_BACKEND_PLUGINS_DIR to a writable path."
        )
    init_path = os.path.join(BACKEND_PLUGINS_DIR, '__init__.py')
    if not os.path.exists(init_path):
        with open(init_path, 'w') as f:
            f.write('')


def _ensure_frontend_dir():
    """Create the frontend plugin dir on demand. Called only when a plugin
    actually ships frontend content — plugins without frontends never need
    this directory and shouldn't fail just because it doesn't exist (a
    common case in Docker)."""
    try:
        os.makedirs(FRONTEND_PLUGINS_DIR, exist_ok=True)
    except OSError as e:
        raise ValueError(
            f"This plugin ships a frontend, but the panel can't write to "
            f"the frontend plugin directory ({FRONTEND_PLUGINS_DIR}): {e}.\n\n"
            f"If the panel runs in Docker, this is expected — the container "
            f"sees only /app, not the host's frontend folder. Two fixes:\n"
            f"  • Bind-mount the host's frontend/src/plugins into the "
            f"container and set SERVERKIT_FRONTEND_PLUGINS_DIR to that path.\n"
            f"  • Or run the backend natively for plugin development.\n\n"
            f"You can also install the backend half only by stripping the "
            f"frontend/ folder from the plugin zip, but the UI half won't load."
        )


def _ensure_dirs():
    """Backwards-compatible eager init for backend dir only. Frontend dir is
    lazy now — see _ensure_frontend_dir."""
    _ensure_backend_dir()


# Caps used by the signature fetch and zip extraction.
_MAX_SIGNATURE_BYTES = 64 * 1024          # detached .minisig cap
_MAX_EXTRACT_BYTES = 250 * 1024 * 1024    # decompression cap (audit L5)


def _find_manifest(zf):
    """Find plugin.json inside the zip, handling nested directories (GitHub zipball nesting)."""
    for name in zf.namelist():
        basename = os.path.basename(name)
        if basename == 'plugin.json':
            # Return the directory prefix so we can strip it
            prefix = name[: -len('plugin.json')]
            return name, prefix
    return None, None


# 'module:attr' references (entry_point, socket_entry, models, lifecycle hooks,
# job handlers). Module part may be dotted; attr must be a bare identifier.
_MODULE_REF_RE = re.compile(r'^[A-Za-z_][\w.]*:[A-Za-z_]\w*$')

# Required keys per contribution kind (mirrors GET /plugins/manifest-spec and
# docs/EXTENSIONS.md — keep the three in sync).
_REQUIRED_CONTRIB_KEYS = {
    'nav': ('id', 'label', 'route'),
    'routes': ('path', 'component'),
    'tabs': ('group', 'to', 'label'),
    'command_palette': ('label', 'path'),
    'widgets': ('slot', 'component'),
    'dashboard_widgets': ('id', 'name', 'component'),
    'layouts': ('id', 'component'),
    'walkthroughs': ('id', 'title', 'description', 'steps'),
}

_KNOWN_CONTRIB_KINDS = set(_REQUIRED_CONTRIB_KEYS) | {'page_titles', 'ai'}


def _validate_manifest(manifest):
    """Validate the manifest: required fields plus the SHAPE of every
    declarative block the platform consumes (#52).

    A malformed block used to be silently skipped at runtime (contribution
    dropped, socket never registered, job never scheduled) — hard to debug.
    Now the install fails with a message naming each problem. Unknown
    contribution kinds only warn, so newer manifests stay installable on
    older panels (forward compat).
    """
    required = ['name', 'display_name', 'version']
    missing = [f for f in required if f not in manifest]
    if missing:
        raise ValueError(f"Manifest missing required fields: {', '.join(missing)}")

    # Sanitize the name for use as a directory
    name = manifest['name']
    if not re.match(r'^[a-zA-Z0-9_-]+$', name):
        raise ValueError(f"Plugin name must be alphanumeric/dashes/underscores: {name}")

    problems = []

    for field in ('entry_point', 'socket_entry', 'models'):
        val = manifest.get(field)
        if val and not (isinstance(val, str) and _MODULE_REF_RE.match(val)):
            problems.append(f"{field} must be a 'module:attr' string (got {val!r})")

    lifecycle = manifest.get('lifecycle')
    if lifecycle is not None:
        if not isinstance(lifecycle, dict):
            problems.append('lifecycle must be an object of phase -> module:func')
        else:
            for phase, target in lifecycle.items():
                if not (isinstance(target, str) and _MODULE_REF_RE.match(target)):
                    problems.append(
                        f"lifecycle.{phase} must be a 'module:func' string (got {target!r})")

    jobs = manifest.get('jobs')
    if jobs is not None:
        if not isinstance(jobs, list):
            problems.append('jobs must be a list of {kind, handler}')
        else:
            for i, j in enumerate(jobs):
                if not (isinstance(j, dict) and j.get('kind')
                        and isinstance(j.get('handler'), str)
                        and _MODULE_REF_RE.match(j['handler'])):
                    problems.append(f"jobs[{i}] must be {{kind, handler: 'module:func'}}")

    schedules = manifest.get('schedules')
    if schedules is not None:
        if not isinstance(schedules, list):
            problems.append('schedules must be a list of {name, kind, cron?|interval_seconds?}')
        else:
            for i, s in enumerate(schedules):
                if not (isinstance(s, dict) and s.get('name') and s.get('kind')):
                    problems.append(f'schedules[{i}] needs name and kind')

    contrib = manifest.get('contributions')
    if contrib is not None and not isinstance(contrib, dict):
        problems.append('contributions must be an object')
    elif isinstance(contrib, dict):
        for key in contrib:
            if key not in _KNOWN_CONTRIB_KINDS:
                logger.warning(
                    f"Manifest for {name}: unknown contribution kind '{key}' (ignored)")

        for kind, req in _REQUIRED_CONTRIB_KEYS.items():
            entries = contrib.get(kind)
            if entries is None:
                continue
            if not isinstance(entries, list):
                problems.append(f'contributions.{kind} must be a list')
                continue
            for i, entry in enumerate(entries):
                if not isinstance(entry, dict):
                    problems.append(f'contributions.{kind}[{i}] must be an object')
                    continue
                missing_keys = [k for k in req if not entry.get(k)]
                if missing_keys:
                    problems.append(
                        f"contributions.{kind}[{i}] missing {', '.join(missing_keys)}")

        titles = contrib.get('page_titles')
        if titles is not None and not isinstance(titles, dict):
            problems.append('contributions.page_titles must be an object of path -> title')

        walkthroughs = contrib.get('walkthroughs')
        if walkthroughs is not None:
            from app.services.walkthrough_definition_service import (
                validate_walkthrough_definitions,
            )
            problems.extend(validate_walkthrough_definitions(
                walkthroughs,
                field='contributions.walkthroughs',
            ))

    if problems:
        raise ValueError(
            'Manifest validation failed: ' + '; '.join(problems)
            + '. See GET /api/v1/plugins/manifest-spec or docs/EXTENSIONS.md.')

    return True


def _assert_manifest_panel_compatible(manifest):
    """Enforce a manifest's min/max_panel_version at install (#28), for every
    install source (URL/upload/local/builtin), not just the registry. A manifest
    without bounds installs anywhere."""
    from app.utils.version import version_satisfies, get_panel_version
    minv = manifest.get('min_panel_version')
    maxv = manifest.get('max_panel_version')
    if not (minv or maxv):
        return
    panel = get_panel_version()
    if not version_satisfies(panel, minv, maxv):
        raise ValueError(
            f"{manifest.get('display_name') or manifest.get('name')} "
            f"v{manifest.get('version')} needs panel {minv or '*'}–{maxv or '*'} "
            f"(this panel is {panel})."
        )


def _assert_manifest_sdk_compatible(manifest):
    """Enforce a manifest's ``sdk_version`` range at install.

    Two places already documented this check as existing — this module's own
    loader comment in the frontend and ``app/utils/sdk.py``'s docstring ("checked
    at install (manifest lint) and at load") — but nothing called
    ``sdk_version_satisfies`` outside its unit test. The consequences differed by
    extension kind, and both were bad:

      * a runtime ESM extension installed cleanly and only failed later, at load,
        on the version gate;
      * a builtin/in-repo extension is compiled in and never passes the load
        gate at all, so its range was never checked anywhere.

    Fail-open on a missing range is deliberate and matches the load-time
    'grace' decision: an extension that pins nothing installs anywhere.
    """
    from app.utils.sdk import SDK_VERSION, sdk_version_satisfies
    range_str = manifest.get('sdk_version')
    if not range_str or not str(range_str).strip():
        return
    if not sdk_version_satisfies(range_str):
        raise ValueError(
            f"{manifest.get('display_name') or manifest.get('name')} "
            f"v{manifest.get('version')} needs panel SDK {range_str} "
            f"(this panel offers {SDK_VERSION}) — update the panel, or install "
            f"a build of the extension made for this SDK."
        )


def _safe_extract_path(dest_root, rel_path):
    """Resolve `rel_path` under `dest_root` and assert it stays inside.

    Defense against Zip Slip: a malicious archive can carry entries like
    `../../etc/cron.d/foo` or absolute paths. Without this check, the
    extract loop happily writes outside the plugin directory and into
    anything the backend process can touch.

    Returns the validated absolute output path, or raises ValueError.
    """
    if not rel_path:
        raise ValueError('empty path in archive')
    normalized = rel_path.replace('\\', '/').lstrip('/')
    if normalized.startswith('/') or ':' in normalized.split('/')[0]:
        raise ValueError(f'absolute path in archive: {rel_path!r}')
    if '..' in normalized.split('/'):
        raise ValueError(f'path traversal in archive: {rel_path!r}')
    out = os.path.normpath(os.path.join(dest_root, normalized))
    root = os.path.normpath(dest_root) + os.sep
    if not (out + os.sep).startswith(root):
        raise ValueError(f'archive entry escapes destination: {rel_path!r}')
    return out


def _update_plugin_metadata(plugin, manifest):
    """Sync mutable manifest-derived fields onto an existing plugin row.

    Used on reinstall: the new manifest may have a fresh display_name,
    author, description, etc. Without this, those fields go stale and
    the UI keeps showing the original values.
    """
    plugin.name = manifest['name']
    plugin.display_name = manifest['display_name']
    plugin.description = manifest.get('description', '')
    plugin.author = manifest.get('author', '')
    plugin.homepage = manifest.get('homepage', '')
    plugin.repository = manifest.get('repository', '')
    plugin.license = manifest.get('license', '')
    plugin.category = manifest.get('category', 'utility')


def _record_signature_status(plugin, sig_result):
    """Stamp the install-time signature verdict on the plugin's config under
    the panel-managed ``_signature`` reserved key (same trust-machinery
    namespace as ``_frontend_hashes`` — config PUTs can't forge it). The
    extension detail surfaces this so an installed extension's origin
    verification stays visible after install."""
    cfg = dict(plugin.config or {})
    if sig_result and sig_result.get('status') != 'unsigned':
        cfg['_signature'] = {
            k: sig_result.get(k)
            for k in ('status', 'key_id', 'publisher')
            if sig_result.get(k)
        }
    else:
        cfg['_signature'] = {'status': 'unsigned'}
    plugin.config = cfg
    db.session.commit()


def install_from_url(url, user_id=None, expected_sha256=None, force=False,
                     hot_load=True, source_type=None,
                     expected_signature=None, expected_key_id=None):
    """Download and install a plugin from a URL.

    Args:
        url: GitHub repo URL, release URL, or direct zip URL
        user_id: ID of the user performing the install
        expected_sha256: if given, the downloaded zip must match this digest
            before extraction — a mismatch is a hard failure (no partial install)
        expected_signature / expected_key_id: if given, the downloaded zip is
            verified against this base64 ed25519 signature envelope under the
            pinned publisher key named by expected_key_id. A bad
            signature is a hard failure; an unpinned key installs but is
            recorded as 'untrusted_key'.
        force: allow reinstalling over an already-active plugin (used by updates)
        hot_load: register the blueprint into the running app immediately.
            The boot-time repair pass (#48) passes False — load_all_plugins
            registers right after, and a double registration would error.
        source_type: override the stamped source_type (defaults to 'url').
            Registry installs pass 'registry' so the row records where the
            plugin really came from.

    Returns:
        InstalledPlugin instance
    """
    url = _normalize_source_url(url)
    try:
        buf = _download_zip(url)
    except Exception as e:
        raise ValueError(f'Failed to download plugin: {e}')

    if expected_sha256:
        import hashlib
        digest = hashlib.sha256(buf.getvalue()).hexdigest()
        if digest.lower() != str(expected_sha256).lower():
            raise ValueError(
                f'Checksum mismatch — refusing to install. '
                f'Expected sha256 {expected_sha256}, got {digest}.'
            )
        buf.seek(0)

    sig_result = None
    if expected_signature:
        from app.services import signing_service
        sig_result = signing_service.verify_for_install(
            buf.getvalue(), expected_signature, expected_key_id)
        buf.seek(0)

    plugin = _install_from_buffer(
        buf, source_url=url, source_type=source_type or 'url',
        user_id=user_id, force=force,
        hot_load=hot_load, sig_result=sig_result,
    )
    return plugin


def _read_manifest_from_buffer(buf):
    """Read and JSON-parse plugin.json from a plugin zip buffer, handling the
    GitHub zipball directory nesting. Raises ValueError with an actionable
    message when the archive is not a valid plugin package."""
    try:
        zf = zipfile.ZipFile(buf)
    except zipfile.BadZipFile:
        raise ValueError('The downloaded file is not a valid zip archive.')
    manifest_path, _prefix = _find_manifest(zf)
    if not manifest_path:
        raise ValueError(
            'No plugin.json found at the archive root. A ServerKit extension '
            'needs plugin.json at the top level (see the layout in '
            'docs/EXTENSIONS.md).')
    try:
        with zf.open(manifest_path) as f:
            return json.loads(f.read().decode('utf-8'))
    except Exception as e:
        raise ValueError(f'plugin.json could not be parsed: {e}')


def _fetch_detached_signature(resolved_url):
    """Best-effort fetch of the minisign-style detached signature published
    beside a release zip (``<zip URL>.minisig`` — the convention
    scripts/sign-extension.mjs writes). Returns the base64 envelope string,
    or None when the release carries no signature (or the fetch fails —
    preview must never hard-fail on a missing optional asset)."""
    if not (resolved_url or '').startswith(('http://', 'https://')):
        return None
    try:
        headers = {
            'Accept': 'text/plain, application/octet-stream',
            'User-Agent': 'ServerKit-Plugin-Installer/1.0',
        }
        data = _safe_get(resolved_url + '.minisig', timeout=15, headers=headers,
                         max_bytes=_MAX_SIGNATURE_BYTES)
        text = data.decode('utf-8', errors='replace').strip()
        return text or None
    except Exception as e:
        logger.debug(f'No detached signature at {resolved_url}.minisig: {e}')
        return None


def preview_from_url(url):
    """Resolve + download a GitHub/zip source and read its manifest WITHOUT
    installing. Returns the metadata a user needs to consent to the install:
    slug, display_name, version, description, permissions, panel-version gate,
    the resolved download URL, its sha256, the signature verdict (signed by a
    pinned publisher / unsigned / untrusted key / invalid), and any warnings.

    Stateless by design — the subsequent install re-downloads (extension zips
    are small) and pins the previewed sha256 so the installed bytes are
    byte-identical to the previewed bytes.
    """
    from app.utils.version import version_satisfies, get_panel_version
    from app.services import signing_service
    import hashlib

    normalized = _normalize_source_url(url)
    _LAST_RESOLUTION['zipball_fallback'] = False
    resolved = _resolve_github_url(normalized, strict=True)

    try:
        buf = _download_resolved(resolved)
    except GitHubResolveError:
        raise
    except Exception as e:
        raise ValueError(f'Failed to download the extension: {e}')

    digest = hashlib.sha256(buf.getvalue()).hexdigest()
    buf.seek(0)
    manifest = _read_manifest_from_buffer(buf)

    # Signature verdict for the consent card: the detached .minisig
    # beside the release asset, verified against the panel's pinned publisher
    # keys. Unsigned is a verdict, not an error — the card says so honestly.
    sig_b64 = _fetch_detached_signature(resolved)
    sig_result = signing_service.verify_detached(buf.getvalue(), sig_b64)
    signature = {
        'status': sig_result['status'],
        'key_id': sig_result.get('key_id'),
        'publisher': sig_result.get('publisher'),
        # The raw envelope is echoed back so the install step can re-verify
        # the exact previewed signature against the pinned sha256 bytes.
        'signature': sig_b64 if sig_result['status'] != 'unsigned' else None,
    }
    if sig_result['status'] == 'invalid':
        signature['error'] = sig_result.get('error')

    # Validate shape early so preview surfaces manifest problems too.
    _validate_manifest(manifest)

    slug = manifest['name']
    minv = manifest.get('min_panel_version')
    maxv = manifest.get('max_panel_version')

    warnings = []
    if _LAST_RESOLUTION.get('zipball_fallback'):
        warnings.append(
            'No release asset found — installing the default-branch source '
            'archive. Publish a release with a plugin .zip asset for '
            'reproducible, checksum-pinned installs.')
    if (minv or maxv):
        panel = get_panel_version()
        if not version_satisfies(panel, minv, maxv):
            warnings.append(
                f'This extension targets panel {minv or "*"}-{maxv or "*"}, '
                f'but this panel is {panel}. Install will be blocked.')
    if InstalledPlugin.query.filter_by(slug=slug).first():
        warnings.append(
            f'An extension with the slug "{slug}" is already installed. '
            f'Installing will reinstall/overwrite it.')

    return {
        'slug': slug,
        'display_name': manifest.get('display_name') or slug,
        'version': manifest.get('version'),
        'description': manifest.get('description', ''),
        'author': manifest.get('author', ''),
        'homepage': manifest.get('homepage', ''),
        'permissions': manifest.get('permissions', []) if isinstance(
            manifest.get('permissions'), list) else [],
        'min_panel_version': minv,
        'max_panel_version': maxv,
        'resolved_url': resolved,
        'sha256': digest,
        'signature': signature,
        'warnings': warnings,
    }


def install_from_path(path, user_id=None, force=False, hot_load=True,
                      source_type=None):
    """Install a plugin from a local directory on the panel host.

    Useful during plugin development: point at the working tree, install,
    iterate. Internally we zip the folder in memory and reuse the same
    install pipeline as URL/upload installs so behavior is identical.

    Note: "local" here means local to the *panel backend*, not to the
    user's browser. If the backend runs in Docker, browser-host paths
    won't resolve — the user should either bind-mount their plugin
    source into the container or use install_from_zip via the upload
    endpoint instead.
    """
    if not path:
        raise ValueError('path is required')

    raw = path

    # Windows path on a non-Windows panel host is the most common
    # foot-gun (typical case: backend in Docker, dev on Windows). Detect
    # and reject with a helpful message before os.path.abspath turns it
    # into garbage like /app/C:\Users\...
    if os.name != 'nt' and len(path) >= 3 and path[1:3] == ':\\':
        raise ValueError(
            f"'{raw}' looks like a Windows path, but the panel backend is "
            f"running on {os.name!r} (likely a Linux container). The folder "
            f"install runs on the panel host's filesystem, not your browser's. "
            f"Either bind-mount your plugin source into the backend container, "
            f"or use 'Upload Zip' instead."
        )

    path = os.path.abspath(os.path.expanduser(path))
    if not os.path.isdir(path):
        raise ValueError(
            f"Not a directory: {path}\n"
            f"This path is resolved on the panel backend ({os.name!r}), not "
            f"your browser. If the backend runs in Docker, the path must "
            f"exist inside the container — bind-mount the source folder or "
            f"use 'Upload Zip'."
        )
    if not os.path.exists(os.path.join(path, 'plugin.json')):
        raise ValueError(f'No plugin.json in {path}')

    # Zip the folder in memory, skipping dev junk that bloats the bundle.
    skip_dirs = {
        '.git', '.github', 'node_modules', '__pycache__',
        '.venv', 'venv', 'dist', 'build', '.pytest_cache',
        '.idea', '.vscode',
    }
    skip_files_endswith = ('.pyc', '.pyo')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(path):
            # mutate dirs in place so os.walk skips them
            dirs[:] = [d for d in dirs if d not in skip_dirs]
            for name in files:
                if name.endswith(skip_files_endswith):
                    continue
                full = os.path.join(root, name)
                rel = os.path.relpath(full, path).replace(os.sep, '/')
                zf.write(full, rel)
    buf.seek(0)

    return _install_from_buffer(
        buf, source_url=path, source_type=source_type or 'local',
        user_id=user_id, force=force, hot_load=hot_load,
    )


def install_from_zip(zip_bytes, user_id=None, source_name=None):
    """Install a plugin from raw zip bytes (e.g. a multipart upload)."""
    if not zip_bytes:
        raise ValueError('Empty upload')
    buf = io.BytesIO(zip_bytes)
    return _install_from_buffer(
        buf,
        source_url=source_name or 'uploaded.zip',
        source_type='upload',
        user_id=user_id,
    )


def _install_from_buffer(buf, source_url, source_type, user_id=None, force=False,
                         hot_load=True, sig_result=None):
    """Shared install pipeline: takes a seekable BytesIO containing a zip,
    extracts it into the panel's plugin dirs, and registers / hot-loads
    the resulting blueprint. All public install_* helpers funnel here so
    behavior matches across URL / local / upload sources.

    `force=True` allows reinstalling over an active plugin (the update path);
    normal installs still refuse to clobber an active install. `hot_load=False`
    skips the immediate blueprint registration (the boot repair pass, #48).

    `sig_result` is the signature verdict produced by the caller (only
    install_from_url can produce one — local/upload/builtin installs have no
    detached signature). It is stamped on EVERY successful install so a
    reinstall via a different source can never inherit a stale 'verified'
    badge from an earlier signed install (audit M1).
    """
    _ensure_dirs()

    # Open zip
    try:
        zf = zipfile.ZipFile(buf)
    except zipfile.BadZipFile:
        raise ValueError('File is not a valid zip archive')

    # Find and read manifest
    manifest_path, prefix = _find_manifest(zf)
    if not manifest_path:
        raise ValueError('No plugin.json found in archive')

    manifest = json.loads(zf.read(manifest_path))
    _validate_manifest(manifest)
    _assert_manifest_panel_compatible(manifest)
    _assert_manifest_sdk_compatible(manifest)

    slug = manifest['name']

    # Check if already installed
    existing = InstalledPlugin.query.filter_by(slug=slug).first()
    if existing and existing.status in ('active', 'installing') and not force:
        raise ValueError(f"Plugin '{slug}' is already installed (v{existing.version}). Uninstall first to reinstall.")

    # Remember the version we're replacing so we can run lifecycle.upgrade when
    # it actually changes (reinstall/update over an existing row).
    previous_version = existing.version if existing else None

    # Create DB record early so we can track errors
    if existing:
        plugin = existing
        plugin.status = InstalledPlugin.STATUS_INSTALLING
        plugin.error_message = None
        plugin.version = manifest['version']
        plugin.source_url = source_url
        plugin.source_type = source_type
        plugin.manifest = manifest
        # Refresh display/description/author/etc from the new manifest so
        # the UI reflects the just-installed version, not the original.
        _update_plugin_metadata(plugin, manifest)
    else:
        plugin = InstalledPlugin(
            name=manifest['name'],
            display_name=manifest['display_name'],
            slug=slug,
            version=manifest['version'],
            description=manifest.get('description', ''),
            author=manifest.get('author', ''),
            homepage=manifest.get('homepage', ''),
            repository=manifest.get('repository', ''),
            license=manifest.get('license', ''),
            category=manifest.get('category', 'utility'),
            source_url=source_url,
            source_type=source_type,
            installed_by=user_id,
            status=InstalledPlugin.STATUS_INSTALLING,
        )
        plugin.manifest = manifest
        db.session.add(plugin)

    db.session.commit()

    try:
        # First pass — figure out what the archive contains. This lets us
        # bail early with a useful error if the plugin needs a frontend
        # dir we can't write to (the dockerized panel case).
        has_backend = False
        has_frontend = False
        for member in zf.namelist():
            rel = member[len(prefix):] if prefix else member
            if not rel or rel.endswith('/'):
                continue
            if rel.startswith('backend/'):
                has_backend = True
            elif rel.startswith('frontend/'):
                has_frontend = True

        if has_frontend:
            _ensure_frontend_dir()  # raises with a helpful message on failure

        backend_dest = os.path.join(BACKEND_PLUGINS_DIR, slug)
        frontend_dest = os.path.join(FRONTEND_PLUGINS_DIR, slug)

        # Clean old install
        if os.path.exists(backend_dest):
            shutil.rmtree(backend_dest)
        if has_frontend and os.path.exists(frontend_dest):
            shutil.rmtree(frontend_dest)

        # Decompression cap (audit L5): refuse archives that expand past
        # _MAX_EXTRACT_BYTES — a small zip can declare or write gigabytes
        # (zip bomb). Pre-check the declared sizes (cheap, catches honest
        # bombs before writing a byte), then count actual bytes written
        # (the declared size can lie). On abort, remove the partial dest
        # dirs so no half-extracted plugin is left behind.
        declared_total = sum(
            info.file_size for info in zf.infolist() if not info.is_dir())
        if declared_total > _MAX_EXTRACT_BYTES:
            raise ValueError(
                f'Archive expands to {declared_total // (1024 * 1024)} MB, '
                f'over the {_MAX_EXTRACT_BYTES // (1024 * 1024)} MB cap — '
                f'refusing to extract (possible zip bomb)')
        extracted_total = 0

        def _write_member(src, dst):
            nonlocal extracted_total
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                extracted_total += len(chunk)
                if extracted_total > _MAX_EXTRACT_BYTES:
                    raise ValueError(
                        f'Archive expands past the '
                        f'{_MAX_EXTRACT_BYTES // (1024 * 1024)} MB cap — '
                        f'refusing to extract (possible zip bomb)')
                dst.write(chunk)

        try:
            for member in zf.namelist():
                # Strip the GitHub zipball prefix
                rel_path = member[len(prefix):] if prefix else member
                if not rel_path or rel_path.endswith('/'):
                    continue

                if rel_path.startswith('backend/'):
                    # Zip Slip defense: _safe_extract_path rejects absolute
                    # paths, .. segments, and anything that resolves outside
                    # backend_dest after normalization.
                    out_path = _safe_extract_path(
                        backend_dest, rel_path[len('backend/'):]
                    )
                    os.makedirs(os.path.dirname(out_path), exist_ok=True)
                    with zf.open(member) as src, open(out_path, 'wb') as dst:
                        _write_member(src, dst)

                elif rel_path.startswith('frontend/'):
                    out_path = _safe_extract_path(
                        frontend_dest, rel_path[len('frontend/'):]
                    )
                    os.makedirs(os.path.dirname(out_path), exist_ok=True)
                    with zf.open(member) as src, open(out_path, 'wb') as dst:
                        _write_member(src, dst)

                elif rel_path == 'requirements.txt':
                    # Plugin Python deps are sandboxed by default: installing
                    # them runs pip with the backend's privileges, which means
                    # arbitrary code via setup.py hooks. Operators must opt in
                    # by setting SERVERKIT_ALLOW_PLUGIN_PIP=1.
                    # Same predicate the admin surface reports (task 6)
                    # — if the two ever disagreed, the page would describe a
                    # behaviour the installer does not have.
                    req_content = zf.read(member).decode('utf-8')
                    if req_content.strip() and plugin_pip_enabled():
                        _install_requirements(req_content, slug)
                    elif req_content.strip():
                        # Persist the requirements file so the admin can review
                        # and install it manually if they want.
                        req_out = _safe_extract_path(backend_dest, 'requirements.txt')
                        os.makedirs(os.path.dirname(req_out), exist_ok=True)
                        with open(req_out, 'w', encoding='utf-8') as f:
                            f.write(req_content)
                        logger.warning(
                            f"Plugin {slug} ships requirements.txt; skipping install "
                            f"(set SERVERKIT_ALLOW_PLUGIN_PIP=1 to enable). "
                            f"File saved to {req_out} for manual review."
                        )
        except ValueError:
            # Extraction aborted (zip bomb cap) — drop the partial dest dirs so
            # no half-extracted plugin is left behind, then re-raise into the
            # outer error handler (marks the row STATUS_ERROR).
            for dest in (backend_dest, frontend_dest):
                if os.path.isdir(dest):
                    shutil.rmtree(dest, ignore_errors=True)
            raise

        # Also write the manifest into the backend plugin dir for runtime access.
        # The trailing newline matters: these manifests are tracked files that
        # scripts/new-extension.mjs and scripts/sync-builtin-frontends.mjs also
        # write, and both append one. json.dump does not, so without it every
        # install rewrote the file with the newline stripped and left a dirty
        # working tree whose diff contained no actual change.
        # newline='\n' matters for the same reason: .gitattributes pins the repo
        # to `text=auto eol=lf`, but Python's text mode translates \n to \r\n on
        # Windows, so a dev-machine install rewrote every tracked manifest with
        # CRLF.
        if has_backend:
            manifest_out = os.path.join(backend_dest, 'plugin.json')
            with open(manifest_out, 'w', newline='\n') as f:
                json.dump(manifest, f, indent=2)
                f.write('\n')

        # Also write manifest to frontend dir
        if has_frontend:
            manifest_out = os.path.join(frontend_dest, 'plugin.json')
            with open(manifest_out, 'w', newline='\n') as f:
                json.dump(manifest, f, indent=2)
                f.write('\n')

        # Determine blueprint info from manifest
        entry_point = manifest.get('entry_point', '')
        url_prefix = manifest.get('url_prefix', f'/api/v1/{slug}')

        plugin.has_backend = has_backend
        plugin.has_frontend = has_frontend
        plugin.backend_path = f'app/plugins/{slug}' if has_backend else None
        plugin.frontend_path = f'src/plugins/{slug}' if has_frontend else None
        plugin.entry_point = entry_point
        plugin.url_prefix = url_prefix
        plugin.frontend_entry = manifest.get('frontend_entry', '')
        # Runtime-frontend integrity (core-slim #39): pin the sha256
        # of the prebuilt ESM bundle so the client loader can verify the bytes it
        # blob-imports match what was installed. No-op for baked .jsx builtins.
        if has_frontend:
            _record_frontend_hashes(plugin, manifest, frontend_dest)
        plugin.status = InstalledPlugin.STATUS_ACTIVE
        db.session.commit()
        # Stamp the signature verdict on every successful install (None for
        # local/upload/builtin sources → 'unsigned'), so a reinstall via a
        # different source never keeps a stale 'verified' badge.
        _record_signature_status(plugin, sig_result)

        # Try to register the blueprint immediately (hot-load)
        if has_backend and entry_point and hot_load:
            try:
                _register_plugin_blueprint(plugin)
            except Exception as e:
                logger.warning(f'Blueprint hot-load failed for {slug} (will load on restart): {e}')

        # Regenerate frontend plugin manifest
        if has_frontend:
            _regenerate_frontend_manifest()

        # Install template dependencies declared in manifest
        # (e.g. a "git-server" extension declaring "templates": ["gitea"]).
        # Best effort — record per-template result on the plugin row so the
        # UI can show what happened, but a template install failure does
        # not roll back the plugin install.
        template_results = _install_template_dependencies(plugin, manifest)

        # Register plugin-owned data models (create ext_<slug>_ tables) and
        # declarative jobs/schedules before the install hook runs, so the hook
        # can seed rows into those tables. Best-effort (never fail the install).
        if has_backend:
            try:
                from app.services import extension_lifecycle
                extension_lifecycle.register_models(plugin, manifest)
                extension_lifecycle.register_jobs(plugin, manifest)
                extension_lifecycle.register_capabilities(plugin, manifest)
            except Exception as e:
                logger.warning(f'Extension lifecycle setup failed for {slug}: {e}')
            try:
                from app.plugins_sdk import sockets as _ext_sockets
                _ext_sockets.register_from_manifest(plugin, manifest)
            except Exception as e:
                logger.warning(f'Extension socket setup failed for {slug}: {e}')

        # Run plugin's lifecycle.install hook if declared. Failure here is
        # also non-fatal — the plugin is installed; the hook is for
        # convenience setup (e.g. creating default rows).
        _run_lifecycle_hook(plugin, manifest, 'install')

        # If this was an in-place version change, run the upgrade hook too.
        if previous_version and previous_version != manifest['version']:
            _run_lifecycle_hook(plugin, manifest, 'upgrade')

        # If the plugin declares an "ai" block, register its tools/context with
        # the core assistant now so installing it teaches the assistant new
        # abilities without a restart. Best effort.
        _refresh_plugin_ai(plugin)

        logger.info(f'Plugin {slug} v{manifest["version"]} installed successfully')
        if template_results:
            plugin._template_install_results = template_results  # surfaced via to_dict if needed
        return plugin

    except Exception as e:
        plugin.status = InstalledPlugin.STATUS_ERROR
        plugin.error_message = str(e)
        db.session.commit()
        raise


def _install_requirements(req_content, plugin_name):
    """Install Python requirements for a plugin."""
    if not req_content.strip():
        return

    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        f.write(req_content)
        req_path = f.name

    try:
        logger.info(f'Installing requirements for plugin {plugin_name}')
        install = run_checked(
            [sys.executable, '-m', 'pip', 'install', '-r', req_path, '--quiet'],
            timeout=300,
        )
        if not install['success']:
            logger.error('Failed to install requirements for %s: %s',
                         plugin_name, install['error'])
            raise ValueError(
                f"Failed to install Python dependencies: {install['error']}")
    finally:
        os.unlink(req_path)


def _attach_status_guard(bp, slug):
    """Attach a before_request that 503s if the plugin is disabled.

    Flask blueprints can't be unregistered from a running app, so once a
    plugin's routes are loaded they stay reachable until restart. This
    guard makes the in-DB status authoritative at request time, so
    disabling a plugin actually stops serving its routes.
    """
    # A blueprint may be mounted at more than one url_prefix (e.g. an alias),
    # but the guard only needs to run once per blueprint object.
    if getattr(bp, '_sk_status_guarded', False):
        return
    def _check():
        from flask import jsonify
        p = InstalledPlugin.query.filter_by(slug=slug).first()
        if not p or p.status != InstalledPlugin.STATUS_ACTIVE:
            return jsonify({
                'error': f"Plugin '{slug}' is not active",
                'status': p.status if p else 'uninstalled',
            }), 503
        return None
    bp.before_request(_check)
    bp._sk_status_guarded = True


def _register_extra_blueprints(register, plugin, manifest):
    """Register a plugin's ``extra_blueprints`` beyond the single ``entry_point``.

    Some extensions (WordPress) expose several blueprints and even mount one
    blueprint at more than one prefix (a deprecation-window alias). The manifest
    declares them as::

        "extra_blueprints": [
            {"module": "wordpress_sites", "attr": "wordpress_sites_bp",
             "url_prefix": "/api/v1/wordpress"},
            {"module": "environment_pipeline", "attr": "environment_pipeline_bp",
             "url_prefix": "/api/v1/wordpress/pipelines",
             "name": "environment_pipeline_pipelines"}
        ]

    ``register`` is a ``callable(bp, url_prefix, name=None)`` — either
    ``current_app.register_blueprint`` (hot-load) or ``app.register_blueprint``
    (boot). Each blueprint gets the same status guard as the entry blueprint.
    """
    import importlib
    for extra in (manifest or {}).get('extra_blueprints', []):
        module_name = extra.get('module')
        attr = extra.get('attr')
        url_prefix = extra.get('url_prefix')
        name = extra.get('name')
        if not (module_name and attr):
            continue
        full_module = f'app.plugins.{plugin.slug}.{module_name}'
        mod = importlib.import_module(full_module)
        bp = getattr(mod, attr)
        _attach_status_guard(bp, plugin.slug)
        # Only pass name= when the manifest supplies one (mounting the SAME
        # blueprint at a second prefix needs a distinct name, e.g. the WordPress
        # /pipelines alias); passing name=None would clobber the blueprint name.
        opts = {'url_prefix': url_prefix}
        if name:
            opts['name'] = name
        register(bp, **opts)
        logger.info(f'Registered extra blueprint {attr} at {url_prefix}'
                    + (f' (as {name})' if name else ''))


def _register_blueprint_live(app, bp, **options):
    """Register a blueprint on an app that may already be serving requests.

    Flask refuses setup calls once the app has handled its first request
    (``AssertionError: The setup method 'register_blueprint' can no longer be
    called...``), so on any live panel — where login and dashboard requests
    long precede the first extension install — hot-load always failed and the
    plugin's routes stayed missing until a restart: unmatched POSTs then fell
    through to the static route and surfaced as a 405 (#144).

    Late registration is safe in this deployment shape: the panel runs a
    single gunicorn worker with threads (the process installing the plugin is
    the process serving its routes), and werkzeug rebuilds its URL matcher
    lazily on the next bind while in-flight requests keep the matcher they
    already bound. Temporarily clearing the flag only waives Flask's setup
    guard; it does not touch request state.
    """
    if not app._got_first_request:
        app.register_blueprint(bp, **options)
        return
    app._got_first_request = False
    try:
        app.register_blueprint(bp, **options)
    finally:
        app._got_first_request = True


def _register_plugin_blueprint(plugin):
    """Dynamically register a plugin's Flask blueprint into the running app."""
    from flask import current_app
    import importlib

    if not plugin.entry_point:
        return

    # entry_point format: "blueprint:ai_assistant_bp"
    parts = plugin.entry_point.split(':')
    if len(parts) != 2:
        raise ValueError(f'Invalid entry_point format: {plugin.entry_point}')

    module_name, bp_name = parts
    full_module = f'app.plugins.{plugin.slug}.{module_name}'

    try:
        mod = importlib.import_module(full_module)
        bp = getattr(mod, bp_name)
        _attach_status_guard(bp, plugin.slug)
        _register_blueprint_live(
            current_app, bp, url_prefix=plugin.url_prefix)
        logger.info(f'Registered blueprint {bp_name} at {plugin.url_prefix}')
        _register_extra_blueprints(
            lambda bp, **opts: _register_blueprint_live(current_app, bp, **opts),
            plugin, plugin.manifest or {})
    except Exception as e:
        raise ValueError(f'Failed to register blueprint: {e}')


def _regenerate_frontend_manifest():
    """Generate a plugins-manifest.json for the frontend build system.

    This file tells the frontend which plugins are installed and where
    their components/styles live so Vite can include them.

    Best-effort: if the frontend dir doesn't exist (e.g. a pure backend
    plugin install where no frontend was ever extracted, or a Docker
    panel without the bind mount), we just log and move on rather than
    failing the install.

    Never runs under the testing config: the test DB only has whatever a given
    test installed, so regenerating would clobber the repo's checked-in
    plugins-manifest.json with partial state (the flagship seed runs on every
    test boot). Tests that care about the manifest monkeypatch the dir.
    """
    try:
        from flask import current_app
        if current_app and current_app.config.get('TESTING'):
            return
    except Exception:
        pass
    if not os.path.isdir(FRONTEND_PLUGINS_DIR):
        logger.info(
            f'Skipping frontend manifest regeneration: '
            f'{FRONTEND_PLUGINS_DIR} does not exist'
        )
        return
    manifest_path = os.path.join(FRONTEND_PLUGINS_DIR, 'plugins-manifest.json')

    plugins = InstalledPlugin.query.filter(
        InstalledPlugin.has_frontend == True,
        InstalledPlugin.status.in_(['active']),
    ).all()

    entries = []
    for p in plugins:
        entry = {
            'name': p.name,
            'slug': p.slug,
            'display_name': p.display_name,
            'version': p.version,
            'frontend_entry': p.frontend_entry,
            'path': p.slug,
        }
        # Check for styles
        style_dir = os.path.join(FRONTEND_PLUGINS_DIR, p.slug, 'styles')
        if os.path.isdir(style_dir):
            styles = [
                f for f in os.listdir(style_dir)
                if f.endswith('.scss') or f.endswith('.css') or f.endswith('.less')
            ]
            entry['styles'] = [f'plugins/{p.slug}/styles/{s}' for s in styles]
        entries.append(entry)

    # Trailing newline and LF for the same reasons as the per-plugin manifests
    # above: scripts/sync-builtin-frontends.mjs writes this same tracked file
    # with one, and .gitattributes pins the repo to eol=lf.
    with open(manifest_path, 'w', newline='\n') as f:
        json.dump({'plugins': entries}, f, indent=2)
        f.write('\n')

    logger.info(f'Frontend plugin manifest regenerated with {len(entries)} plugin(s)')


def repair_missing_plugins():
    """Self-heal installed plugins whose files are gone (#48).

    A panel update deploys a fresh source tree preserving only `.env` and the
    database, so a URL/upload-installed plugin's extracted files (and a
    copy-installed builtin's backend under ``app/plugins/``) can vanish while
    the InstalledPlugin row stays active — the boot loader would then flip it
    to `error`. Before the loader runs, restore what we can:

      - builtin slug        → reinstall from ``builtin-extensions/`` (in-repo,
                              always present in the fresh tree)
      - source_type 'url' or 'registry'
                            → re-download from ``source_url`` (no checksum —
                              the original install verified it; best effort)
      - anything else       → mark `error` with a re-upload hint

    Reinstalls run with ``hot_load=False`` — load_all_plugins registers the
    blueprints right after this pass. Never raises; each repair is
    best-effort and logged. The update.sh carry-forward is the first line of
    defense; this is the backstop (e.g. Docker image updates).
    """
    builtin_by_slug = {}
    try:
        for entry in list_builtin_extensions():
            builtin_by_slug[entry['slug']] = entry
    except Exception:
        pass

    plugins = InstalledPlugin.query.filter(
        InstalledPlugin.status.in_([
            InstalledPlugin.STATUS_ACTIVE,
            InstalledPlugin.STATUS_ERROR,
        ]),
    ).all()

    for plugin in plugins:
        slug = plugin.slug
        # Flagships load in-place from builtin-extensions/ (repo-tracked, never
        # copy-installed) — nothing on disk to go missing.
        if slug in FLAGSHIP_SLUGS:
            continue

        backend_missing = bool(plugin.has_backend) and not os.path.isdir(
            os.path.join(BACKEND_PLUGINS_DIR, slug))
        frontend_missing = bool(plugin.has_frontend) and not os.path.isdir(
            os.path.join(FRONTEND_PLUGINS_DIR, slug))
        if not backend_missing and not frontend_missing:
            continue

        halves = ' + '.join(h for h, m in (('backend', backend_missing),
                                           ('frontend', frontend_missing)) if m)
        logger.warning(
            f'Plugin {slug}: {halves} files missing (panel update?) — attempting repair')

        try:
            if slug in builtin_by_slug:
                install_from_path(builtin_by_slug[slug]['path'],
                                  user_id=plugin.installed_by,
                                  force=True, hot_load=False,
                                  source_type='builtin')
                logger.info(f'Plugin {slug}: restored from builtin-extensions/')
            elif plugin.source_type in ('url', 'registry') and plugin.source_url:
                install_from_url(plugin.source_url, user_id=plugin.installed_by,
                                 force=True, hot_load=False,
                                 source_type=plugin.source_type)
                logger.info(f'Plugin {slug}: reinstalled from {plugin.source_url}')
            else:
                plugin.status = InstalledPlugin.STATUS_ERROR
                plugin.error_message = (
                    'Plugin files are missing (likely removed by a panel update) '
                    'and there is no source URL to reinstall from. Re-upload the '
                    'plugin zip from the Marketplace to restore it.'
                )
                db.session.commit()
        except Exception as e:
            logger.error(f'Plugin {slug}: repair failed: {e}')
            try:
                plugin.status = InstalledPlugin.STATUS_ERROR
                plugin.error_message = f'Repair after panel update failed: {e}'
                db.session.commit()
            except Exception:
                db.session.rollback()


def load_all_plugins(app):
    """Load all active plugin blueprints at app startup.

    Called from create_app() to register all installed plugin blueprints.
    """
    _ensure_dirs()

    with app.app_context():
        # Restore any install whose files a panel update wiped (#48) BEFORE
        # querying/loading, so a repaired plugin loads normally this boot.
        try:
            repair_missing_plugins()
        except Exception as e:
            logger.warning(f'Plugin repair pass failed: {e}')

        plugins = InstalledPlugin.query.filter_by(
            status=InstalledPlugin.STATUS_ACTIVE,
            has_backend=True,
        ).all()

        for plugin in plugins:
            if not plugin.entry_point:
                continue
            try:
                parts = plugin.entry_point.split(':')
                if len(parts) != 2:
                    continue

                module_name, bp_name = parts
                full_module = f'app.plugins.{plugin.slug}.{module_name}'

                import importlib
                mod = importlib.import_module(full_module)
                bp = getattr(mod, bp_name)
                _attach_status_guard(bp, plugin.slug)
                app.register_blueprint(bp, url_prefix=plugin.url_prefix)
                logger.info(f'Loaded plugin: {plugin.display_name} v{plugin.version} at {plugin.url_prefix}')

                manifest = plugin.manifest or {}
                _register_extra_blueprints(app.register_blueprint, plugin, manifest)

                # Re-establish the plugin's data models, jobs, core-hook
                # registrations, and socket namespace on boot (install-time
                # registration doesn't survive a restart).
                try:
                    from app.services import extension_lifecycle
                    extension_lifecycle.register_models(plugin, manifest)
                    extension_lifecycle.register_jobs(plugin, manifest)
                    extension_lifecycle.register_capabilities(plugin, manifest)
                    from app.plugins_sdk import sockets as _ext_sockets
                    _ext_sockets.register_from_manifest(plugin, manifest)
                except Exception as e:
                    logger.warning(f'Extension runtime setup for {plugin.slug}: {e}')
            except Exception as e:
                logger.error(f'Failed to load plugin {plugin.slug}: {e}')
                plugin.status = InstalledPlugin.STATUS_ERROR
                plugin.error_message = f'Failed to load: {e}'
                db.session.commit()


def uninstall_plugin(plugin_id, purge=False):
    """Uninstall a plugin by removing its files and DB record.

    `purge=True` also drops the plugin's ``ext_<slug>_`` data tables (keep-data
    is the default, mirroring the installer's --purge/--keep-data semantics).
    """
    plugin = InstalledPlugin.query.get(plugin_id)
    if not plugin:
        return False

    slug = plugin.slug
    manifest = plugin.manifest or {}

    # Run lifecycle.uninstall hook *before* we delete the files (the hook
    # may need to read its own files). It's told whether the caller asked to
    # purge data. Best effort — never block teardown.
    _run_lifecycle_hook(plugin, manifest, 'uninstall', purge=purge)

    # Tear down declarative schedules, and (only on purge) the data tables and
    # the plugin's key/value store. Store rows follow the same rule as the
    # ext_* tables: an ordinary uninstall leaves them, so a reinstall finds its
    # state where it left it, and "uninstall and delete data" removes them.
    try:
        from app.services import extension_lifecycle
        extension_lifecycle.remove_jobs(plugin, manifest)
        # Audit F1: seam registrations (backup kinds, event types, template
        # providers) must not keep executing after uninstall.
        extension_lifecycle.unregister_capabilities(plugin)
        if purge:
            extension_lifecycle.purge_models(plugin)
            from app.plugins_sdk.store_sdk import purge as purge_store
            removed = purge_store(slug)
            if removed:
                logger.info(f'Purged {removed} store row(s) for {slug}')
    except Exception as e:
        logger.warning(f'Extension lifecycle teardown for {slug}: {e}')

    # Drop any AI tools/context this plugin contributed to the assistant.
    _unregister_plugin_ai(slug)

    if slug in FLAGSHIP_SLUGS:
        # Flagships live in-place (backend in builtin-extensions/, frontend
        # pre-bundled under src/plugins/ — both tracked in the repo). Never delete
        # those; just record the user's choice so the boot seed leaves it out, and
        # drop the row (the status guard 503s any still-registered routes).
        _set_flagship_uninstalled(slug, True)
    else:
        # Remove backend files
        backend_dest = os.path.join(BACKEND_PLUGINS_DIR, slug)
        if os.path.exists(backend_dest):
            shutil.rmtree(backend_dest)

        # Remove frontend files
        frontend_dest = os.path.join(FRONTEND_PLUGINS_DIR, slug)
        if os.path.exists(frontend_dest):
            shutil.rmtree(frontend_dest)

    db.session.delete(plugin)
    db.session.commit()

    # Regenerate frontend manifest
    _regenerate_frontend_manifest()

    logger.info(f'Plugin {slug} uninstalled')
    return True


def enable_plugin(plugin_id):
    """Enable a disabled plugin."""
    plugin = InstalledPlugin.query.get(plugin_id)
    if not plugin:
        return None
    plugin.status = InstalledPlugin.STATUS_ACTIVE
    plugin.error_message = None
    db.session.commit()
    _regenerate_frontend_manifest()
    _refresh_plugin_ai(plugin)
    # Resume the plugin's scheduled jobs (status-guard parity for background work).
    try:
        from app.services import extension_lifecycle
        extension_lifecycle.resume_jobs(plugin, plugin.manifest or {})
        # Audit F4: re-register the core seams disable tore down (idempotent).
        extension_lifecycle.register_capabilities(plugin, plugin.manifest or {})
    except Exception as e:
        logger.warning(f'Could not resume jobs for {plugin.slug}: {e}')
    return plugin


def disable_plugin(plugin_id):
    """Disable a plugin without removing files."""
    plugin = InstalledPlugin.query.get(plugin_id)
    if not plugin:
        return None
    plugin.status = InstalledPlugin.STATUS_DISABLED
    db.session.commit()
    _regenerate_frontend_manifest()
    _unregister_plugin_ai(plugin.slug)
    # Pause the plugin's scheduled jobs so a disabled plugin does no background work.
    try:
        from app.services import extension_lifecycle
        extension_lifecycle.pause_jobs(plugin, plugin.manifest or {})
        # Audit F1: seam registrations (backup kinds, event types, template
        # providers) must not keep executing while disabled.
        extension_lifecycle.unregister_capabilities(plugin)
    except Exception as e:
        logger.warning(f'Could not pause jobs for {plugin.slug}: {e}')
    return plugin


def _refresh_plugin_ai(plugin):
    """Register a plugin's AI tools/context with the core assistant (if it has an
    ``ai`` manifest block). Idempotent; safe whether or not AI is initialized."""
    try:
        manifest = plugin.manifest or {}
        if isinstance(manifest.get('ai'), dict):
            from app.services.ai_tool_registry import ai_tool_registry
            ai_tool_registry.reload_plugin(plugin.slug)
    except Exception:
        logger.warning(f'AI tool refresh failed for plugin {plugin.slug}', exc_info=True)


def _unregister_plugin_ai(slug):
    """Drop a plugin's AI tools/context from the core assistant."""
    try:
        from app.services.ai_tool_registry import ai_tool_registry
        ai_tool_registry.unregister_plugin(slug)
    except Exception:
        logger.warning(f'AI tool unregister failed for plugin {slug}', exc_info=True)


def _run_lifecycle_hook(plugin, manifest, phase, **kwargs):
    """Execute a plugin's lifecycle hook.

    Manifest format:
        "lifecycle": { "install": "module:func", "upgrade": "module:func",
                       "uninstall": "module:func" }

    The module path is resolved under ``app.plugins.<slug>``. The hook receives
    the InstalledPlugin row as its single positional arg; the uninstall hook may
    additionally accept ``purge`` (whether the caller asked to drop data). Hooks
    written as ``func(plugin)`` still work — extra kwargs are only passed when the
    signature accepts them. Return value is ignored; failure is logged and
    swallowed — lifecycle hooks are convenience, not correctness.
    """
    lifecycle = (manifest or {}).get('lifecycle') or {}
    target = lifecycle.get(phase)
    if not target or ':' not in target:
        return

    module_name, func_name = target.split(':', 1)
    full_module = f'app.plugins.{plugin.slug}.{module_name}'

    try:
        import importlib
        import inspect
        mod = importlib.import_module(full_module)
        func = getattr(mod, func_name, None)
        if not callable(func):
            logger.warning(
                f'Lifecycle {phase} hook {target} for {plugin.slug} is not callable'
            )
            return
        # Only forward kwargs the hook actually declares (keeps func(plugin) valid).
        if kwargs:
            try:
                params = inspect.signature(func).parameters
                accepts_kwargs = any(
                    p.kind == inspect.Parameter.VAR_KEYWORD for p in params.values()
                )
                passable = {k: v for k, v in kwargs.items()
                            if accepts_kwargs or k in params}
            except (TypeError, ValueError):
                passable = {}
            func(plugin, **passable)
        else:
            func(plugin)
        logger.info(f'Ran lifecycle.{phase} hook for {plugin.slug}')
    except Exception as e:
        logger.warning(f'Lifecycle {phase} hook for {plugin.slug} failed: {e}')


def _install_template_dependencies(plugin, manifest):
    """Install app templates declared in the manifest's `templates` key.

    Format:
        "templates": ["gitea", "umami"]            # template ids
        "templates": [{ "id": "gitea",
                        "app_name": "git-server",   # default: template id
                        "variables": {"PORT": "3000"} }]

    Returns a list of {template_id, success, message} dicts. Failures are
    logged but do not abort the plugin install — the user can install the
    template manually from /templates if it didn't auto-install.
    """
    deps = (manifest or {}).get('templates') or []
    if not deps:
        return []

    try:
        from app.services.template_service import TemplateService
    except Exception as e:
        logger.warning(f'TemplateService unavailable; skipping template deps: {e}')
        return []

    results = []
    for dep in deps:
        if isinstance(dep, str):
            template_id, app_name, variables = dep, dep, {}
        elif isinstance(dep, dict):
            template_id = dep.get('id') or dep.get('template_id')
            app_name = dep.get('app_name') or template_id
            variables = dep.get('variables') or {}
        else:
            continue

        if not template_id:
            continue

        try:
            res = TemplateService.install_template(
                template_id=template_id,
                app_name=app_name,
                user_variables=variables,
                user_id=plugin.installed_by,
            )
            ok = bool(res and res.get('success'))
            results.append({
                'template_id': template_id,
                'success': ok,
                'message': res.get('error') if not ok else 'installed',
            })
            if ok:
                logger.info(f'Plugin {plugin.slug} installed template {template_id}')
            else:
                logger.warning(
                    f'Plugin {plugin.slug} template dep {template_id} failed: '
                    f'{res.get("error")}'
                )
        except Exception as e:
            logger.warning(
                f'Plugin {plugin.slug} template dep {template_id} raised: {e}'
            )
            results.append({
                'template_id': template_id,
                'success': False,
                'message': str(e),
            })

    return results


def list_plugins(status=None):
    """List installed plugins."""
    query = InstalledPlugin.query
    if status:
        query = query.filter_by(status=status)
    return query.order_by(InstalledPlugin.display_name).all()


def get_plugin(plugin_id):
    """Get a single plugin by ID."""
    return InstalledPlugin.query.get(plugin_id)


def get_plugin_by_slug(slug):
    """Get a plugin by its slug."""
    return InstalledPlugin.query.filter_by(slug=slug).first()


# Opt-in for installing a plugin's Python dependencies. Off by default: pip runs
# with the backend's privileges and a setup.py hook is arbitrary code.
PLUGIN_PIP_ENV = 'SERVERKIT_ALLOW_PLUGIN_PIP'
# How big a requirements.txt we are willing to echo back to the browser.
_MAX_REQUIREMENTS_BYTES = 64 * 1024


def plugin_pip_enabled():
    """Whether the operator has opted into installing plugin Python deps."""
    return env_bool(PLUGIN_PIP_ENV)


def pending_requirements(plugin):
    """The Python dependencies an install declined to pip-install.

    When the opt-in is off, install writes the plugin's requirements.txt into
    its backend dir and moves on with a log line nobody reads — the extension
    then runs with imports it may not have. This makes that state answerable:
    the file's contents, where it is, and the exact env var that changes the
    behaviour.

    Read-only by design. Nothing here installs anything, and the plan is
    explicit that this surface introduces no auto-install behaviour change.
    """
    info = {
        'slug': getattr(plugin, 'slug', None),
        'pending': False,
        'pip_enabled': plugin_pip_enabled(),
        'env_var': PLUGIN_PIP_ENV,
        'path': None,
        'content': '',
        'packages': [],
        'truncated': False,
    }
    backend_path = getattr(plugin, 'backend_path', None)
    if not backend_path:
        return info

    # backend_path is stored relative to the backend package root; join it the
    # same way the loader does rather than trusting it as absolute.
    candidate = backend_path if os.path.isabs(backend_path) else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '..',
        backend_path)
    req_path = os.path.normpath(os.path.join(candidate, 'requirements.txt'))
    if not os.path.isfile(req_path):
        return info

    try:
        size = os.path.getsize(req_path)
        with open(req_path, 'r', encoding='utf-8', errors='replace') as fh:
            content = fh.read(_MAX_REQUIREMENTS_BYTES)
    except OSError as exc:
        logger.warning('could not read %s: %s', req_path, exc)
        return info

    info.update({
        'pending': True,
        'path': req_path,
        'content': content,
        'truncated': size > _MAX_REQUIREMENTS_BYTES,
        # One line per requirement, comments and blanks dropped — enough for a
        # compact list without pretending to parse PEP 508.
        'packages': [ln.strip() for ln in content.splitlines()
                     if ln.strip() and not ln.strip().startswith('#')],
    })
    return info


# Plugin-config keys the panel owns — never user-editable, preserved across a
# config PUT. The runtime-frontend loader's per-bundle sha256 hashes live here,
# and so does the install-time signature verdict.
RESERVED_PLUGIN_CONFIG_KEYS = ('_frontend_hashes', '_signature')


def _record_frontend_hashes(plugin, manifest, frontend_dest):
    """Pin the sha256 of a runtime-frontend ESM bundle at install time.

    Stored on the plugin's config under the panel-managed ``_frontend_hashes``
    key (a reserved namespace preserved across config edits). Only ESM bundles
    (manifest ``frontend_entry`` ending ``.mjs``) are hashed — baked ``.jsx``
    builtins load via the build-time glob and need no integrity pin. Best
    effort: a missing bundle file just records nothing (the loader then refuses
    to import an extension with no recorded hash).
    """
    entry = (manifest.get('frontend_entry') or '').strip()
    if not entry.endswith('.mjs'):
        return
    bundle_path = os.path.join(frontend_dest, entry)
    if not os.path.isfile(bundle_path):
        return
    import hashlib
    with open(bundle_path, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    cfg = dict(plugin.config or {})
    hashes = dict(cfg.get('_frontend_hashes') or {})
    hashes[entry] = digest
    cfg['_frontend_hashes'] = hashes
    plugin.config = cfg


def update_plugin_config(slug, config):
    """Save a plugin's user config, preserving panel-managed reserved keys.

    A config PUT from the Marketplace replaces the user-visible values but must
    never drop (or let the caller forge) the panel-managed ``_frontend_hashes``
    integrity pins. Reserved keys are stripped from the incoming payload and the
    existing values are re-applied on top.
    """
    plugin = get_plugin_by_slug(slug)
    if not plugin:
        raise ValueError('Plugin not found')

    existing = plugin.config or {}
    new_cfg = {
        k: v for k, v in (config or {}).items()
        if k not in RESERVED_PLUGIN_CONFIG_KEYS
    }
    for key in RESERVED_PLUGIN_CONFIG_KEYS:
        if key in existing:
            new_cfg[key] = existing[key]
    plugin.config = new_cfg
    db.session.commit()
    return plugin


def list_builtin_extensions():
    """Enumerate folders in BUILTIN_EXTENSIONS_DIR that look like plugins.

    Each entry includes the manifest, the absolute source path, and the
    install state (installed/active/disabled/error/not_installed). The
    Marketplace UI uses this to render one-click installs.
    """
    out = []
    if not os.path.isdir(BUILTIN_EXTENSIONS_DIR):
        return out

    for name in sorted(os.listdir(BUILTIN_EXTENSIONS_DIR)):
        folder = os.path.join(BUILTIN_EXTENSIONS_DIR, name)
        manifest_path = os.path.join(folder, 'plugin.json')
        if not os.path.isfile(manifest_path):
            continue

        try:
            with open(manifest_path, 'r', encoding='utf-8') as f:
                manifest = json.load(f)
        except Exception as e:
            logger.warning(f'Skipping builtin {name}: bad plugin.json ({e})')
            continue

        slug = manifest.get('name') or name
        existing = InstalledPlugin.query.filter_by(slug=slug).first()
        installed_state = existing.status if existing else 'not_installed'

        out.append({
            'folder': name,
            'path': folder,
            'slug': slug,
            'manifest': manifest,
            'installed': existing is not None,
            'install_id': existing.id if existing else None,
            'status': installed_state,
        })

    return out


# ── Onboarding wizard: use-case → recommended extension slugs ──
#
# Drives the setup wizard's "Recommended for you" install checkboxes. Every slug
# here MUST resolve to a real bundled builtin (builtin-extensions/) or a registry
# entry — guarded by tests/test_onboarding_recommendations.py so the map can never
# point at a dead slug. Order within a use case is significant; the resolver
# de-dupes across the selected use cases preserving first-seen order.
RECOMMENDED_EXTENSIONS_BY_USE_CASE = {
    'wordpress': ['serverkit-wordpress', 'serverkit-analytics'],
    'web-apps': ['serverkit-git', 'serverkit-status', 'serverkit-analytics'],
    'self-hosted': ['serverkit-dns-server', 'serverkit-status', 'serverkit-mail'],
    'devops': ['serverkit-k8s', 'serverkit-tramo', 'serverkit-git'],
}


def _recommendation_index():
    """slug -> {slug, display_name, description, category, source, installed,
    status}. Merges the registry catalog with bundled builtins so a recommended
    slug resolves regardless of where it lives; builtins win on slug collision."""
    index = {}
    try:
        from app.services import registry_service
        for entry in registry_service.list_catalog(include_bundled=True):
            slug = entry.get('slug')
            if not slug:
                continue
            index[slug] = {
                'slug': slug,
                'display_name': entry.get('display_name') or slug,
                'description': entry.get('description') or '',
                'category': entry.get('category') or 'utility',
                'source': 'registry',
                'installed': bool(entry.get('installed')),
                'status': entry.get('status') or 'not_installed',
            }
    except Exception as e:
        logger.debug(f'Registry unavailable for onboarding recommendations: {e}')
    for entry in list_builtin_extensions():
        manifest = entry.get('manifest') or {}
        slug = entry['slug']
        index[slug] = {
            'slug': slug,
            'display_name': manifest.get('display_name') or slug,
            'description': manifest.get('description') or '',
            'category': manifest.get('category') or 'utility',
            'source': 'builtin',
            'installed': bool(entry.get('installed')),
            'status': entry.get('status') or 'not_installed',
        }
    return index


def recommend_extensions_for_use_cases(use_cases):
    """Resolve selected onboarding use cases to installable extension metadata.

    Returns a de-duped, order-preserving list of dicts (one per recommended
    extension). Slugs that don't resolve to a builtin/registry entry are silently
    dropped (defensive — the map is test-guarded against dead slugs)."""
    index = _recommendation_index()
    seen = set()
    out = []
    for use_case in (use_cases or []):
        for slug in RECOMMENDED_EXTENSIONS_BY_USE_CASE.get(use_case, []):
            if slug in seen:
                continue
            seen.add(slug)
            meta = index.get(slug)
            if meta:
                out.append(meta)
    return out


# Wizard round 2: "How much security tooling?" The extracted
# security suite installs by chosen posture, not per-tool nagging. Slugs here
# resolve through the same catalog index as the use-case map — an entry that
# is not yet published (or a registry that is unreachable) silently drops out,
# so the wizard only ever offers what is actually installable right now.
# Deliberately NOT folded into RECOMMENDED_EXTENSIONS_BY_USE_CASE: posture is
# persisted separately (`onboarding_security_posture`) and orthogonal to what
# the server is for.
SECURITY_POSTURE_LEVELS = {
    'minimal': [],
    'recommended': ['serverkit-fail2ban', 'serverkit-auto-updates'],
    'hardened': [
        'serverkit-fail2ban', 'serverkit-auto-updates', 'serverkit-clamav',
        'serverkit-lynis', 'serverkit-image-scan', 'serverkit-crowdsec',
    ],
}


def recommend_security_extensions(posture):
    """Resolve a security posture to installable extension metadata.

    Same contract as ``recommend_extensions_for_use_cases``: order-preserving,
    and slugs that don't resolve to a catalog entry are dropped rather than
    surfaced as dead install buttons."""
    index = _recommendation_index()
    out = []
    for slug in SECURITY_POSTURE_LEVELS.get(posture or 'minimal', []):
        meta = index.get(slug)
        if meta:
            out.append(meta)
    return out


def finalize_setup_flagships():
    """Keep the panel lean after onboarding completes: any wizard-optional
    flagship (WordPress) the user didn't install during the wizard gets the
    uninstall marker so the boot-time flagship seeder won't re-add it on later
    boots. Called from the complete-onboarding endpoint."""
    for slug in WIZARD_OPTIONAL_FLAGSHIP_SLUGS:
        if not InstalledPlugin.query.filter_by(slug=slug).first():
            _set_flagship_uninstalled(slug, True)


def get_installed_extension_attr(slug, module, attr, default=None):
    """Return ``attr`` from an installed extension's backend module, else default.

    A core seam that calls into a feature which now lives in an extracted
    extension uses this so it no-ops cleanly when the extension isn't
    installed. Resolves ``app.plugins.<slug>.<module>`` (the dashed package the
    plugin loader wires up on install); any import/lookup failure yields
    ``default``."""
    try:
        import importlib
        mod = importlib.import_module(f'app.plugins.{slug}.{module}')
        return getattr(mod, attr, default)
    except Exception:
        return default


def install_builtin_extension(slug, user_id=None):
    """Install a builtin extension by its slug (folder lookup)."""
    if not os.path.isdir(BUILTIN_EXTENSIONS_DIR):
        raise ValueError(f'Builtin extensions dir not found: {BUILTIN_EXTENSIONS_DIR}')

    # Flagships (D4) re-install in-place: clear the user-uninstall marker and
    # re-seed the active row — no file copy, since the backend loads from
    # builtin-extensions/ and the frontend is pre-bundled.
    if slug in FLAGSHIP_SLUGS:
        _set_flagship_uninstalled(slug, False)
        for entry in list_builtin_extensions():
            if entry['slug'] == slug:
                _ensure_builtin_backend_importable(slug)
                existing = InstalledPlugin.query.filter_by(slug=slug).first()
                if existing:
                    existing.status = InstalledPlugin.STATUS_ACTIVE
                    db.session.commit()
                    # A builtin re-install carries no signature — never keep a
                    # verdict stamped by some earlier install of the slug.
                    _record_signature_status(existing, None)
                    return existing
                plugin = _seed_flagship_row(entry)
                try:
                    _register_plugin_blueprint(plugin)
                except Exception as e:
                    logger.warning(
                        f'Flagship blueprint hot-load failed for {slug} '
                        f'(will load on restart): {e}')
                return plugin
        raise ValueError(f"No builtin extension with slug '{slug}'")

    for entry in list_builtin_extensions():
        if entry['slug'] == slug:
            return install_from_path(entry['path'], user_id=user_id,
                                     source_type='builtin')

    raise ValueError(f"No builtin extension with slug '{slug}'")


# ── Flagship (D4) default-install machinery ──

def _flagship_uninstalled_set():
    """Slugs the user explicitly uninstalled — never re-seeded on boot."""
    from app.services.settings_service import SettingsService
    raw = SettingsService.get(_FLAGSHIP_UNINSTALLED_KEY, '')
    if not raw:
        return set()
    try:
        return set(json.loads(raw))
    except (ValueError, TypeError):
        return {s.strip() for s in str(raw).split(',') if s.strip()}


def _set_flagship_uninstalled(slug, uninstalled):
    from app.services.settings_service import SettingsService
    current = _flagship_uninstalled_set()
    if uninstalled:
        current.add(slug)
    else:
        current.discard(slug)
    SettingsService.set(_FLAGSHIP_UNINSTALLED_KEY, json.dumps(sorted(current)))


def _seed_flagship_row(entry):
    """Create an active InstalledPlugin row for a flagship without copying files.

    The backend is loaded in-place from builtin-extensions/ (see
    ``_ensure_builtin_backend_importable``) and the frontend is pre-bundled under
    ``frontend/src/plugins/<slug>`` (D5), so the row only records install state
    for the Marketplace/contributions surfaces and drives the status guard.
    """
    manifest = entry['manifest']
    slug = entry['slug']
    has_backend = os.path.isdir(os.path.join(entry['path'], 'backend'))
    has_frontend = os.path.isdir(os.path.join(entry['path'], 'frontend'))

    plugin = InstalledPlugin(
        name=manifest['name'],
        display_name=manifest.get('display_name', slug),
        slug=slug,
        version=manifest['version'],
        description=manifest.get('description', ''),
        author=manifest.get('author', ''),
        homepage=manifest.get('homepage', ''),
        repository=manifest.get('repository', ''),
        license=manifest.get('license', ''),
        category=manifest.get('category', 'utility'),
        source_type='builtin',
        status=InstalledPlugin.STATUS_ACTIVE,
    )
    plugin.manifest = manifest
    plugin.has_backend = has_backend
    plugin.has_frontend = has_frontend
    plugin.backend_path = f'builtin-extensions/{slug}/backend' if has_backend else None
    plugin.frontend_path = f'src/plugins/{slug}' if has_frontend else None
    plugin.entry_point = manifest.get('entry_point', '')
    plugin.url_prefix = manifest.get('url_prefix', f'/api/v1/{slug}')
    plugin.frontend_entry = manifest.get('frontend_entry', '')
    db.session.add(plugin)
    db.session.commit()

    # Register plugin-owned data models / jobs / core hooks / sockets, same as
    # a copy-install.
    try:
        from app.services import extension_lifecycle
        extension_lifecycle.register_models(plugin, manifest)
        extension_lifecycle.register_jobs(plugin, manifest)
        extension_lifecycle.register_capabilities(plugin, manifest)
        from app.plugins_sdk import sockets as _ext_sockets
        _ext_sockets.register_from_manifest(plugin, manifest)
    except Exception as e:
        logger.warning(f'Flagship lifecycle setup for {slug}: {e}')

    _refresh_plugin_ai(plugin)
    # Only touch the frontend build manifest if the flagship actually ships a
    # frontend (WordPress is backend-only — its UI stays core for now). A
    # pre-bundled flagship frontend (D5) is already represented in the checked-in
    # manifest, so there's nothing to regenerate here.
    if plugin.has_frontend:
        try:
            _regenerate_frontend_manifest()
        except Exception as e:
            logger.warning(f'Frontend manifest regen after flagship seed for {slug}: {e}')
    logger.info(f'Seeded flagship extension row: {slug} v{manifest["version"]}')
    return plugin


def _wizard_optional_flagships_suppressed():
    """True when wizard-optional flagships (WordPress) should NOT be boot-seeded:
    a fresh install whose setup wizard hasn't completed.

    Bypassed under TESTING so the extensive WordPress test suite keeps its
    seeded flagship; the real gate is exercised by dedicated proving tests that
    toggle ``app.config['TESTING']``."""
    try:
        from flask import current_app
        if current_app and current_app.config.get('TESTING'):
            return False
    except Exception:
        pass
    try:
        from app.services.settings_service import SettingsService
        return bool(SettingsService.needs_setup())
    except Exception:
        return False


def seed_flagship_extensions():
    """Ensure bundled flagship extensions (D4) have an active row on EVERY panel
    — fresh AND upgrade — unless the user explicitly uninstalled them.

    Called from ``create_app`` right before ``load_all_plugins`` so the loader
    picks up the seeded row and registers the blueprints (in-place). Best-effort.
    """
    uninstalled = _flagship_uninstalled_set()
    suppress_optional = _wizard_optional_flagships_suppressed()
    available = {e['slug']: e for e in list_builtin_extensions()}
    for slug in FLAGSHIP_SLUGS:
        if slug in uninstalled:
            continue
        # Fresh install: don't seed wizard-optional flagships (WordPress)
        # until the setup wizard installs them. Existing/completed-setup installs
        # fall through and seed as before.
        if suppress_optional and slug in WIZARD_OPTIONAL_FLAGSHIP_SLUGS:
            continue
        entry = available.get(slug)
        if not entry:
            continue
        # Make the backend importable in-place regardless (the bridge and the
        # loader both rely on app.plugins.<slug> resolving).
        _ensure_builtin_backend_importable(slug)
        existing = InstalledPlugin.query.filter_by(slug=slug).first()
        if existing:
            # Heal a row left in ERROR by a prior failed load so the flagship
            # comes back active on the next boot (the seed is authoritative for a
            # flagship the user hasn't uninstalled). A deliberate DISABLE is kept.
            if existing.status == InstalledPlugin.STATUS_ERROR:
                existing.status = InstalledPlugin.STATUS_ACTIVE
                existing.error_message = None
                db.session.commit()
            continue
        try:
            _seed_flagship_row(entry)
        except Exception as e:
            logger.warning(f'Flagship seed for {slug} failed (retry next boot): {e}')


def _assert_panel_compatible(entry):
    """Raise if the panel version is outside an entry's min/max_panel_version."""
    from app.utils.version import version_satisfies, get_panel_version
    panel = get_panel_version()
    minv = entry.get('min_panel_version')
    maxv = entry.get('max_panel_version')
    if not version_satisfies(panel, minv, maxv):
        raise ValueError(
            f"{entry.get('display_name') or entry.get('slug')} "
            f"v{entry.get('version')} needs panel "
            f"{minv or '*'}–{maxv or '*'} (this panel is {panel})."
        )


def install_registry_extension(slug, user_id=None):
    """Install an extension listed in the remote registry (checksum-verified).

    When the index entry carries a ``signature``/``publisher_key_id`` pair
    (index schema v3) the downloaded zip is also verified against
    the panel's pinned publisher keys — a bad signature is a hard failure
    even when the sha256 matches."""
    from app.services import registry_service
    entry = registry_service.get_entry(slug)
    if not entry:
        raise ValueError(f"No registry extension with slug '{slug}'")
    _assert_panel_compatible(entry)
    source = (entry.get('source') or '').strip()
    if not source:
        raise ValueError(f"Registry entry '{slug}' has no source URL.")
    return install_from_url(
        source, user_id=user_id, expected_sha256=entry.get('sha256'),
        source_type='registry',
        expected_signature=entry.get('signature'),
        expected_key_id=entry.get('publisher_key_id'),
    )


def check_for_updates(refresh=False):
    """Compare installed plugins to the registry / bundled manifests.

    Registry-driven for url/registry rows (matched on slug); ``builtin`` rows
    compare against the bundled manifest in builtin-extensions/. Rows with no
    known source of truth (url/local/upload/git without a registry entry) are
    skipped. A malformed version means "no update"; one bad row never breaks
    the list. ``requires_ack``/``risk`` mirror the update route's consent gate.
    """
    from app.services import registry_service
    from app.utils.version import compare_versions, version_satisfies, get_panel_version
    if refresh:
        registry_service.refresh(force=True)
    panel = get_panel_version()
    bundled = {b['slug']: b['manifest'] for b in list_builtin_extensions()}
    out = []
    for p in InstalledPlugin.query.all():
        try:
            if p.source_type == 'builtin':
                m = bundled.get(p.slug)
                if not m:
                    continue
                available = m.get('version')
                row = {
                    'display_name': m.get('display_name') or p.name,
                    'update_source': 'builtin', 'source': None,
                    'compatible': True, 'requires_ack': False, 'risk': None,
                }
                minv = m.get('min_panel_version')
                maxv = m.get('max_panel_version')
            else:
                entry = registry_service.get_entry(p.slug)
                if not entry:
                    continue
                available = entry.get('version')
                minv = entry.get('min_panel_version')
                maxv = entry.get('max_panel_version')
                risk, _ = registry_service.consent_gate(entry, False)
                row = {
                    'display_name': entry.get('display_name') or p.name,
                    'update_source': 'registry', 'source': entry.get('source'),
                    'requires_ack': bool(risk), 'risk': risk,
                }
            try:
                newer = compare_versions(available, p.version) > 0
            except Exception:  # noqa: BLE001 - malformed version = no update
                newer = False
            compatible = version_satisfies(panel, minv, maxv)
            row['compatible'] = bool(compatible)
            row['incompatible_reason'] = None if compatible else (
                f"Needs panel {minv or '*'}–{maxv or '*'} (this panel is {panel})."
            )
            if minv:
                row['min_panel_version'] = minv
            out.append({
                'slug': p.slug,
                'plugin_id': p.id,
                'installed_version': p.version,
                'available_version': available,
                'update_available': newer,
                'installed_source_type': p.source_type,
                **row,
            })
        except Exception as exc:  # noqa: BLE001 - isolate bad rows
            logger.warning(f'Update check skipped {p.slug}: {exc}')
    return out


def update_plugin(plugin_id, user_id=None):
    """Update an installed plugin to the registry's version (reinstall in place)."""
    from app.services import registry_service
    plugin = InstalledPlugin.query.get(plugin_id)
    if not plugin:
        raise ValueError('Plugin not found')
    folder = next((b['path'] for b in list_builtin_extensions()
                   if b['slug'] == plugin.slug), None) \
        if plugin.source_type == 'builtin' else None
    # A builtin row with no bundled folder (e.g. stamped by hand) falls
    # through to the registry path below.
    if folder:
        return install_from_path(
            folder, user_id=user_id, force=True, source_type='builtin',
        )
    entry = registry_service.get_entry(plugin.slug)
    if not entry:
        raise ValueError(
            f"No registry entry for '{plugin.slug}' — cannot update from the registry."
        )
    _assert_panel_compatible(entry)
    source = (entry.get('source') or '').strip()
    if not source:
        raise ValueError('Registry entry has no source URL.')
    # The update itself is registry-driven, so plain url/registry rows get
    # stamped 'registry'; builtin/local/upload rows keep their identity.
    if plugin.source_type in (None, '', 'url', 'registry'):
        stamped = 'registry'
    else:
        stamped = plugin.source_type
    return install_from_url(
        source, user_id=user_id, expected_sha256=entry.get('sha256'), force=True,
        source_type=stamped,
        expected_signature=entry.get('signature'),
        expected_key_id=entry.get('publisher_key_id'),
    )
