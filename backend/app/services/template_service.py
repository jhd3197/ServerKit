"""
Template Service - Manages application templates for one-click deployment.

Supports:
- YAML-based template schema
- Docker Compose compatibility
- Variable substitution
- Post-install scripts
- Template repositories (local + remote)
- Update mechanism
"""

import os
import re
import copy
import time
import yaml
import json
import shutil
import secrets
import string
import hashlib
import threading
import subprocess
from datetime import datetime
from typing import Callable, Dict, List, Optional, Any
from pathlib import Path
import requests

from app import paths
from app.utils.system import run_checked
from app.services.deploy_lock import with_deploy_lock


class TemplateService:
    """Service for managing and deploying application templates."""

    CONFIG_DIR = paths.SERVERKIT_CONFIG_DIR
    TEMPLATES_DIR = paths.TEMPLATES_DIR
    LOCAL_TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'templates')
    INSTALLED_DIR = paths.APPS_DIR
    TEMPLATE_CONFIG = os.path.join(CONFIG_DIR, 'templates.json')

    # Default template repository.
    #
    # serverkit.ai proxies the serverkit-templates registry and is built for
    # exactly this consumer: it serves <repo_url>/index.json and the
    # <repo_url>/templates/<id>.yaml path this class derives below, behind a
    # TTL cache with last-good fallback. Pointing at the product domain rather
    # than raw.githubusercontent also means a branch rename upstream cannot
    # silently empty every panel's catalog.
    DEFAULT_REPOS = [
        {
            'name': 'serverkit-official',
            'url': 'https://serverkit.ai/templates',
            'enabled': True
        }
    ]

    # Remote index cache.
    #
    # `list_all_templates()` runs on every Templates page load and used to call
    # `fetch_remote_templates()` inline for every enabled repo, with a 30s
    # timeout and no memoization -- so a single unreachable repo stalled the
    # whole catalog on every render, and a reachable one was refetched for no
    # reason. Successes are cached for _REMOTE_TTL. Failures fall back to the
    # last good payload when there is one (a transient blip must never blank a
    # catalog the panel has already shown) and are otherwise negatively cached
    # for the shorter _REMOTE_ERROR_TTL, so a dead repo is retried soon but not
    # hammered. Same TTL + last-good shape as the serverkit.ai proxy that
    # DEFAULT_REPOS points at.
    _REMOTE_TTL_SECONDS = 300
    _REMOTE_ERROR_TTL_SECONDS = 60
    _REMOTE_TIMEOUT_SECONDS = 10
    # url -> {'templates': [...], 'expires': monotonic float, 'ok': bool}
    _remote_cache = {}
    _remote_cache_lock = threading.Lock()

    # Parsed-template cache for the bundled catalog.
    #
    # With the remote fetch memoized above, the remaining cost of a Templates
    # page load was `list_local_templates()` re-reading and re-parsing every
    # bundled YAML on every call (118 files, ~0.4s). Entries are memoized per
    # file and keyed on (st_mtime_ns, st_size), so a sync or an edit
    # invalidates exactly the file that changed and nothing else -- which is
    # why the writers need no explicit invalidation call. A deleted template
    # disappears because the listing only returns what the directory scan
    # finds. (Caveat: a filesystem with coarse mtime granularity could serve a
    # stale card if a file were rewritten to the identical size within the
    # same clock tick; ns-resolution local filesystems do not have this
    # problem.)
    # filepath -> {'key': (mtime_ns, size), 'entry': dict|None}
    _local_cache = {}
    _local_cache_lock = threading.Lock()

    # Repo URLs that never worked and should be healed on read rather than
    # left to rot in an operator's templates.json. `serverkit/templates` was a
    # guess at the org name -- the registry is `jhd3197/serverkit-templates` --
    # so this URL has 404'd for its entire existence and no panel has ever
    # fetched a template through it. Nothing is lost by replacing it.
    DEAD_REPO_URLS = {
        'https://raw.githubusercontent.com/serverkit/templates/main',
        'https://raw.githubusercontent.com/serverkit/templates',
    }

    # Provider-owned templates (plan 52 D4 hook inversion): these ids are
    # listed and installable ONLY while the owning extension has registered as
    # their provider (i.e. it is installed + active this boot — registration
    # happens via the manifest ``core_hooks`` seam). The map itself is core;
    # the extension supplies availability and any variable-validation hook at
    # load. Absent extension = the cards vanish from the catalog and installs
    # refuse with a clear "provider missing" error, never a half-broken deploy.
    PROVIDER_OWNED_TEMPLATES = {
        'wordpress': 'serverkit-wordpress',
        'wordpress-external-db': 'serverkit-wordpress',
    }
    # slug -> {'validate': callable(template_id, variables) -> error-dict|None,
    #          'registrant': str|None  # extension that claimed the slug (F5)
    #          }
    _TEMPLATE_PROVIDERS = {}

    @classmethod
    def register_template_provider(cls, slug, validate=None, registrant=None):
        """Register extension ``slug`` as the provider of its
        ``PROVIDER_OWNED_TEMPLATES`` entries. Idempotent; the optional
        ``validate(template_id, variables)`` hook may veto a variable set by
        returning a ``{'success': False, 'error': ...}`` dict (this replaces
        hardcoded per-template checks in core — e.g. the WordPress external-DB
        preflight now lives in the WP extension).

        ``registrant`` is the claiming extension's slug (self-asserted, like
        every extension seam). Once a slug has an owner, a DIFFERENT
        registrant can never claim it (audit F5 — defense-in-depth against an
        extension hijacking another's provider slot)."""
        providers = dict(cls._TEMPLATE_PROVIDERS)
        existing = providers.get(slug)
        if (existing and existing.get('registrant') and registrant
                and existing['registrant'] != registrant):
            raise ValueError(
                f"template provider '{slug}' is already registered by "
                f"'{existing['registrant']}'")
        providers[slug] = {'validate': validate,
                           'registrant': registrant or slug}
        cls._TEMPLATE_PROVIDERS = providers

    @classmethod
    def unregister_template_provider(cls, slug):
        """Drop a provider registration (disable/uninstall teardown, audit
        F1)."""
        providers = dict(cls._TEMPLATE_PROVIDERS)
        providers.pop(slug, None)
        cls._TEMPLATE_PROVIDERS = providers

    @classmethod
    def provider_for_template(cls, template_id):
        """The registered provider dict for ``template_id``, or None when the
        template is core-owned or its owning extension is absent."""
        slug = cls.PROVIDER_OWNED_TEMPLATES.get(template_id)
        if not slug:
            return None
        return cls._TEMPLATE_PROVIDERS.get(slug)

    @classmethod
    def template_available(cls, template_id):
        """False only for provider-owned templates whose provider extension is
        not registered this boot."""
        slug = cls.PROVIDER_OWNED_TEMPLATES.get(template_id)
        if slug is None:
            return True
        return slug in cls._TEMPLATE_PROVIDERS

    @classmethod
    def _run_provider_validate(cls, template_id, variables):
        """Dispatch to the provider's validate hook, if any. Returns an error
        dict to veto the install, or None."""
        provider = cls.provider_for_template(template_id)
        if provider and callable(provider.get('validate')):
            return provider['validate'](template_id, variables)
        return None


    # Template schema version
    SCHEMA_VERSION = '1.0'

    # ==================================================================
    # The `engine:` block — what makes a template a database engine
    # ------------------------------------------------------------------
    # A template becomes installable from the Databases page purely by
    # carrying a top-level ``engine:`` mapping. Presence of the block is the
    # ONLY marker; there is no allow-list of engine ids anywhere in Python, so
    # shipping a new engine (CockroachDB, DuckDB, whatever) is dropping a YAML
    # file into ``backend/templates/`` or syncing a template repository.
    #
    #   engine:
    #     family: Relational              # see ENGINE_FAMILIES
    #     protocol: postgresql            # see ENGINE_PROTOCOLS
    #     default_port: 26257
    #     admin_user: root
    #     admin_password_var: DB_PASSWORD # which `variables` entry is the secret
    #     database_var: DB_NAME           # optional: seeds an initial database
    #     port_var: PORT                  # optional: which variable is the port
    #     bind_var: BIND_ADDRESS          # optional: private-vs-public bind
    #     unit: tables
    #     client: cockroach sql
    #     data_path: /cockroach/cockroach-data
    #
    # ``protocol: none`` is legitimate: the engine installs and is listed, but
    # the database tree offers no introspection for it. That is honest — better
    # than pretending we can browse it.
    # ==================================================================
    ENGINE_FAMILIES = (
        'Relational', 'Document', 'Key-value', 'Time-series',
        'Analytics', 'Search', 'Graph',
    )
    # Which client adapter (if any) can introspect the engine once it is up.
    ENGINE_PROTOCOLS = ('postgresql', 'mysql', 'mongodb', 'redis', 'none')

    # Conventional variable names, used when the block does not name its own.
    ENGINE_DEFAULT_PORT_VAR = 'PORT'
    ENGINE_DEFAULT_BIND_VAR = 'BIND_ADDRESS'
    # Safety rule 1: an engine is reachable only from the host unless the
    # operator explicitly opts out.
    ENGINE_PRIVATE_BIND = '127.0.0.1'
    ENGINE_PUBLIC_BIND = '0.0.0.0'

    @classmethod
    def get_config(cls) -> Dict:
        """Get template configuration.

        A panel that has ever saved this file keeps whatever repos were in it,
        so fixing DEFAULT_REPOS alone would only help fresh installs. Dead URLs
        are therefore corrected on read (see DEAD_REPO_URLS). Not written back
        here -- a getter should not have a disk side effect -- so the repair
        re-applies each read until something saves the config normally."""
        if os.path.exists(cls.TEMPLATE_CONFIG):
            try:
                with open(cls.TEMPLATE_CONFIG, 'r') as f:
                    config = json.load(f)
                return cls._heal_dead_repos(config)
            except Exception:
                pass
        return {
            'repos': cls.DEFAULT_REPOS,
            'installed': {},
            'last_sync': None
        }

    @classmethod
    def _heal_dead_repos(cls, config: Dict) -> Dict:
        """Point any known-dead repo URL at the current default."""
        repos = config.get('repos')
        if not isinstance(repos, list):
            return config
        default_url = cls.DEFAULT_REPOS[0]['url']
        for repo in repos:
            if isinstance(repo, dict) and repo.get('url', '').rstrip('/') in cls.DEAD_REPO_URLS:
                repo['url'] = default_url
        return config

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save template configuration.

        This is the single choke point for repo mutations (add/remove/enable),
        so the remote index cache is dropped here -- a repo added now must show
        up on the next listing, not after the TTL."""
        try:
            os.makedirs(cls.CONFIG_DIR, exist_ok=True)
            with open(cls.TEMPLATE_CONFIG, 'w') as f:
                json.dump(config, f, indent=2)
            cls.invalidate_remote_cache()
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def validate_template(cls, template: Dict) -> Dict:
        """Validate a template against the schema."""
        errors = []

        # Required fields
        required = ['name', 'version', 'description']
        for field in required:
            if field not in template:
                errors.append(f"Missing required field: {field}")

        # A template is either a one-click compose/dockerfile stack (the default,
        # kind: compose) or a deployable Git repository (kind: repo). Repo
        # templates carry a `repo` block with a `url` instead of a compose stack;
        # they are deployed through the New Service wizard, not installed here.
        kind = template.get('kind', 'compose')
        if kind == 'repo':
            repo = template.get('repo')
            if not isinstance(repo, dict) or not repo.get('url'):
                errors.append("Repo template must have a 'repo' block with a 'url'")
        elif kind == 'compose':
            # Must have either compose or dockerfile
            if 'compose' not in template and 'dockerfile' not in template:
                errors.append("Template must have either 'compose' or 'dockerfile'")
        else:
            errors.append(f"Unknown template kind: {kind}")

        # Validate compose structure
        if 'compose' in template:
            compose = template['compose']
            if 'services' not in compose:
                errors.append("Compose section must have 'services'")

        # Validate variables (support both list and dict formats)
        if 'variables' in template:
            variables = template['variables']
            if isinstance(variables, list):
                # List format: [{name: 'PORT', type: 'port', ...}, ...]
                for var in variables:
                    if not isinstance(var, dict):
                        errors.append("Each variable in list must be a dictionary")
                    elif 'name' not in var:
                        errors.append("Each variable must have a 'name' field")
            elif isinstance(variables, dict):
                # Dict format: {PORT: {type: 'port', ...}, ...}
                for var_name, var_config in variables.items():
                    if not isinstance(var_config, dict):
                        errors.append(f"Variable {var_name} must be a dictionary")

        # Validate the optional `engine:` block. Unknown top-level keys were
        # already tolerated (this validator checks required fields, it does not
        # reject extras) -- what was missing is that a MALFORMED engine block
        # went unnoticed and then silently produced a broken catalog card.
        if 'engine' in template:
            errors.extend(cls._engine_block_errors(template['engine']))

        if errors:
            return {'valid': False, 'errors': errors}
        return {'valid': True}

    @classmethod
    def _engine_block_errors(cls, engine: Any) -> List[str]:
        """Hard errors in an ``engine:`` block (shape only, never opinions)."""
        if not isinstance(engine, dict):
            return ["'engine' must be a mapping"]
        errors = []
        family = engine.get('family')
        if family is not None and family not in cls.ENGINE_FAMILIES:
            errors.append(
                f"engine.family '{family}' is not one of: {', '.join(cls.ENGINE_FAMILIES)}")
        protocol = engine.get('protocol')
        if protocol is not None and protocol not in cls.ENGINE_PROTOCOLS:
            errors.append(
                f"engine.protocol '{protocol}' is not one of: {', '.join(cls.ENGINE_PROTOCOLS)}")
        port = engine.get('default_port')
        if port is not None:
            try:
                if not 1 <= int(port) <= 65535:
                    raise ValueError
            except (TypeError, ValueError):
                errors.append('engine.default_port must be a port number (1-65535)')
        if 'extensions' in engine and not isinstance(engine['extensions'], bool):
            errors.append('engine.extensions must be true or false')
        return errors

    @classmethod
    def is_engine_template(cls, template: Dict) -> bool:
        """True when a template declares itself a database engine."""
        return isinstance(template, dict) and isinstance(template.get('engine'), dict)

    @classmethod
    def engine_metadata(cls, template: Dict) -> Optional[Dict]:
        """Normalized ``engine:`` block, or ``None`` for a non-engine template.

        Fills in the conventional variable names so every consumer sees the same
        keys, and resolves ``versions`` from the template's own ``version`` plus
        any ``engine.versions`` the author offers. Nothing here is hardcoded per
        engine -- it is all read off the YAML.
        """
        if not cls.is_engine_template(template):
            return None
        engine = dict(template['engine'])
        versions = engine.get('versions')
        if not isinstance(versions, list) or not versions:
            versions = [template.get('version')] if template.get('version') else []
        return {
            'family': engine.get('family'),
            'protocol': engine.get('protocol') or 'none',
            'default_port': engine.get('default_port'),
            'admin_user': engine.get('admin_user'),
            'admin_password_var': engine.get('admin_password_var'),
            'database_var': engine.get('database_var'),
            'port_var': engine.get('port_var') or cls.ENGINE_DEFAULT_PORT_VAR,
            'bind_var': engine.get('bind_var') or cls.ENGINE_DEFAULT_BIND_VAR,
            'unit': engine.get('unit'),
            'client': engine.get('client'),
            'data_path': engine.get('data_path'),
            # Opt-in, because speaking a protocol is not the same as supporting
            # its extensions: CockroachDB answers on the PostgreSQL wire and has
            # no `CREATE EXTENSION` to speak of. An engine that can load them
            # says so, so nothing has to special-case the ones that cannot.
            'supports_extensions': engine.get('extensions') is True,
            'versions': [str(v) for v in versions],
        }

    # ==================================================================
    # The `extension:` block — an add-on that installs INTO a running engine
    # ------------------------------------------------------------------
    # An engine is a template because an engine gets a container. An
    # extension does NOT: installing pgvector means executing one statement
    # against a PostgreSQL that is already running. It therefore has no
    # compose, no port, no volume and no app row -- so it is not an app
    # template and is deliberately kept out of the app catalog. It lives in
    # its own namespace, ``<templates>/extensions/*.yaml``:
    #
    #   id: pgvector                       # == the filename stem
    #   name: pgvector
    #   version: "0.8.0"
    #   description: ...
    #   extension:
    #     protocol: postgresql             # which engines can host it
    #     statement: CREATE EXTENSION IF NOT EXISTS vector;
    #     available_query: SELECT 1 FROM pg_available_extensions WHERE ...
    #     installed_query: SELECT extversion FROM pg_extension WHERE ...
    #     images: [pgvector/pgvector]      # images that SHIP it (see below)
    #     image_hint: "pgvector/pgvector:pg{version}"
    #     templates: [postgresql]          # optional: narrow beyond protocol
    #
    # ``images:`` is the load-bearing field. `CREATE EXTENSION vector`
    # against stock ``postgres:16`` fails with "could not open extension
    # control file" -- the statement is right, the image simply does not
    # carry the shared library. Declaring which images provide the extension
    # lets the catalog say so BEFORE the operator clicks, and lets the
    # installer refuse with a remedy instead of a cryptic engine error.
    # ==================================================================
    EXTENSIONS_SUBDIR = 'extensions'
    # Extensions are one family by definition, so it is not a YAML field --
    # nothing can declare it wrong.
    EXTENSION_FAMILY = 'Extension'

    @classmethod
    def extension_dirs(cls) -> List[str]:
        """Where extension YAMLs are looked for, highest precedence first.

        The synced/operator directory shadows the bundled one, exactly like
        :meth:`list_local_templates` does for app templates.
        """
        return [os.path.join(cls.TEMPLATES_DIR, cls.EXTENSIONS_SUBDIR),
                os.path.join(cls.LOCAL_TEMPLATES_DIR, cls.EXTENSIONS_SUBDIR)]

    @classmethod
    def validate_extension(cls, document: Dict) -> Dict:
        """Validate an extension document (the whole file, not just the block)."""
        errors = []
        if not isinstance(document, dict):
            return {'valid': False, 'errors': ['extension file must be a mapping']}
        for field in ('name', 'version', 'description'):
            if not document.get(field):
                errors.append(f'Missing required field: {field}')
        if 'extension' not in document:
            errors.append("Missing required 'extension' block")
        else:
            errors.extend(cls._extension_block_errors(document['extension']))
        if 'compose' in document or 'dockerfile' in document:
            errors.append('An extension installs into a running engine and must '
                          'not declare a compose/dockerfile of its own')
        if errors:
            return {'valid': False, 'errors': errors}
        return {'valid': True, 'errors': []}

    @classmethod
    def _extension_block_errors(cls, extension: Any) -> List[str]:
        """Hard errors in an ``extension:`` block (shape only, never opinions)."""
        if not isinstance(extension, dict):
            return ["'extension' must be a mapping"]
        errors = []
        protocol = extension.get('protocol')
        if not protocol:
            errors.append('extension.protocol is required (which engines can host it)')
        elif protocol not in cls.ENGINE_PROTOCOLS:
            errors.append(
                f"extension.protocol '{protocol}' is not one of: "
                f"{', '.join(cls.ENGINE_PROTOCOLS)}")
        elif protocol == 'none':
            errors.append("extension.protocol 'none' cannot host an extension: "
                          'there is no client to execute the statement with')
        statement = extension.get('statement')
        if not statement or not isinstance(statement, str) or not statement.strip():
            errors.append('extension.statement is required and must be a non-empty string')
        for key in ('available_query', 'installed_query', 'image_hint', 'size', 'unit'):
            value = extension.get(key)
            if value is not None and not isinstance(value, str):
                errors.append(f'extension.{key} must be a string')
        for key in ('images', 'templates', 'versions'):
            value = extension.get(key)
            if value is None:
                continue
            if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
                errors.append(f'extension.{key} must be a list of strings')
        return errors

    @classmethod
    def extension_metadata(cls, document: Dict, extension_id: str = None) -> Optional[Dict]:
        """Normalized extension record, or ``None`` when the document is not one.

        Everything a consumer needs is read off the YAML; nothing about any
        particular extension is hardcoded here.
        """
        if not isinstance(document, dict) or not isinstance(document.get('extension'), dict):
            return None
        block = document['extension']
        versions = block.get('versions')
        if not isinstance(versions, list) or not versions:
            versions = [document.get('version')] if document.get('version') else []
        images = [i for i in (block.get('images') or []) if isinstance(i, str)]
        return {
            'id': extension_id or document.get('id'),
            'name': document.get('name'),
            'version': document.get('version'),
            'description': document.get('description'),
            'icon': document.get('icon'),
            'website': document.get('website'),
            'documentation': document.get('documentation'),
            'family': cls.EXTENSION_FAMILY,
            'protocol': block.get('protocol'),
            'statement': block.get('statement'),
            'available_query': block.get('available_query'),
            'installed_query': block.get('installed_query'),
            # [] means "any engine template speaking `protocol`".
            'templates': [t for t in (block.get('templates') or []) if isinstance(t, str)],
            'images': images,
            'image_hint': block.get('image_hint'),
            # An extension with no declared images makes no image claim, so it
            # is never blocked on one.
            'requires_image': bool(images),
            'size': block.get('size'),
            'unit': block.get('unit'),
            'versions': [str(v) for v in versions],
        }

    @classmethod
    def list_extension_templates(cls) -> List[Dict]:
        """Every extension declared under a ``templates/extensions/`` directory.

        Derived from the files, like the engine catalog: dropping a YAML in
        makes the extension appear, with no code change anywhere.
        """
        found: List[Dict] = []
        seen = set()
        for directory in cls.extension_dirs():
            if not os.path.isdir(directory):
                continue
            for filename in sorted(os.listdir(directory)):
                if not filename.endswith(('.yaml', '.yml')):
                    continue
                extension_id = filename.rsplit('.', 1)[0]
                if extension_id in seen:
                    continue
                record = cls._load_extension_file(os.path.join(directory, filename),
                                                  extension_id)
                if record:
                    seen.add(extension_id)
                    found.append(record)
        return found

    @classmethod
    def _load_extension_file(cls, path: str, extension_id: str) -> Optional[Dict]:
        """Parse + validate one extension file, or ``None`` (logged) if broken."""
        try:
            with open(path, 'r', encoding='utf-8') as fh:
                document = yaml.safe_load(fh)
        except Exception:
            return None
        validation = cls.validate_extension(document if isinstance(document, dict) else {})
        if not validation['valid']:
            return None
        return cls.extension_metadata(document, extension_id=extension_id)

    @classmethod
    def get_extension_template(cls, extension_id: str) -> Optional[Dict]:
        """One normalized extension by id, or ``None``."""
        if not extension_id:
            return None
        for record in cls.list_extension_templates():
            if record['id'] == extension_id:
                return record
        return None

    @classmethod
    def parse_template(cls, template_path: str) -> Dict:
        """Parse a template file."""
        try:
            with open(template_path, 'r') as f:
                template = yaml.safe_load(f)

            validation = cls.validate_template(template)
            if not validation['valid']:
                return {'success': False, 'errors': validation['errors']}

            return {'success': True, 'template': template}
        except yaml.YAMLError as e:
            return {'success': False, 'error': f"YAML parse error: {e}"}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def generate_value(cls, var_config: Dict, force_generate: bool = False) -> str:
        """Generate a value for a variable based on its configuration.

        Args:
            var_config: Variable configuration dict
            force_generate: If True, always generate new value even for ports
        """
        var_type = var_config.get('type', 'string')
        default = var_config.get('default', '')

        if var_type == 'password':
            length = var_config.get('length', 32)
            chars = string.ascii_letters + string.digits
            if var_config.get('special_chars', False):
                chars += '!@#$%^&*'
            return ''.join(secrets.choice(chars) for _ in range(length))

        elif var_type == 'port':
            # ALWAYS find an available port - never trust defaults
            start_port = int(default) if default else 8000
            # A global base-port setting (Settings > managed_app_base_port)
            # overrides the per-template default when configured (non-zero).
            base = cls._managed_app_base_port()
            if base:
                start_port = base
            return str(cls._find_available_port(start_port))

        elif var_type == 'uuid':
            import uuid
            return str(uuid.uuid4())

        elif var_type == 'random':
            length = var_config.get('length', 16)
            return secrets.token_hex(length // 2)

        return str(default)

    # ==================================================================
    # Magic variables
    # ------------------------------------------------------------------
    # "Magic variables" let template authors use industry-standard
    # placeholders that ServerKit auto-resolves at install time, instead of
    # declaring an explicit ``variables:`` entry for every generated secret.
    #
    # Supported tokens (used as ``${SERVICE_<KIND>_<NAME>}`` in compose / files /
    # scripts), where ``<NAME>`` is an author-chosen identifier that groups
    # related tokens (the same ``<NAME>`` resolves to a consistent value):
    #
    #   SERVICE_PASSWORD_<NAME>  -> a generated strong password
    #   SERVICE_USER_<NAME>      -> a generated service username (svc_<name>_<rand>)
    #   SERVICE_FQDN_<NAME>      -> the app's auto-assigned hostname (best-effort)
    #   SERVICE_URL_<NAME>       -> full URL derived from the FQDN (+ scheme)
    #   SERVICE_BASE64_<NAME>    -> base64 of a freshly generated secret
    #   SERVERKIT_METRICS_TOKEN  -> the panel's Prometheus scrape token (plan
    #                               86 §A4), so a monitoring template can scrape
    #                               /api/v1/fleet-monitor/prometheus
    #
    # Resolution is PURE and unit-testable: no Docker, no network. The only
    # contextual input is an optional ``context`` dict (app_name / fqdn / scheme).
    # ==================================================================

    # Order matters: longer prefixes (BASE64) must be matched before shorter
    # ones so they are not mis-parsed. Each entry maps the wire prefix to an
    # internal "kind".
    MAGIC_PREFIXES = [
        ('SERVICE_PASSWORD_', 'password'),
        ('SERVICE_USER_', 'user'),
        ('SERVICE_FQDN_', 'fqdn'),
        ('SERVICE_URL_', 'url'),
        ('SERVICE_BASE64_', 'base64'),
    ]

    # Whole-name magic tokens (no ``<NAME>`` suffix) -> internal kind. One
    # table so the resolver and the catalog validator agree on what exists.
    MAGIC_EXACT_TOKENS = {
        'SERVER_PUBLIC_IP': 'server_public_ip',       # appliance tier (plan 35)
        'SERVERKIT_METRICS_TOKEN': 'metrics_token',   # plan 86 §A4
    }

    # Matches ``${SERVICE_...}`` magic tokens specifically (a subset of the
    # generic ``${VAR}`` substitution pattern). ``<NAME>`` may be empty-safe:
    # we require at least one trailing char after the prefix.
    MAGIC_TOKEN_PATTERN = (
        r'\$\{(SERVICE_(?:PASSWORD|USER|FQDN|URL|BASE64)_[A-Z0-9_]+|SERVER_PUBLIC_IP'
        r'|SERVERKIT_METRICS_TOKEN)\}'
    )

    # Default password length for magic SERVICE_PASSWORD_* tokens.
    MAGIC_PASSWORD_LENGTH = 32

    @classmethod
    def _classify_magic_token(cls, token: str):
        """Return ``(kind, name)`` for a bare magic token (no ``${}``), or
        ``(None, None)`` if it is not a recognized magic variable."""
        if token in cls.MAGIC_EXACT_TOKENS:
            return cls.MAGIC_EXACT_TOKENS[token], ''
        for prefix, kind in cls.MAGIC_PREFIXES:
            if token.startswith(prefix):
                return kind, token[len(prefix):]
        return None, None

    @classmethod
    def _generate_magic_password(cls) -> str:
        """Strong password for a SERVICE_PASSWORD_* token (alnum, no special
        chars to stay shell/compose-safe). Reuses the same primitive as
        ``generate_value(type=password)``."""
        chars = string.ascii_letters + string.digits
        return ''.join(secrets.choice(chars) for _ in range(cls.MAGIC_PASSWORD_LENGTH))

    @classmethod
    def _generate_magic_user(cls, name: str) -> str:
        """Service username for a SERVICE_USER_* token: ``svc_<name>_<rand>``,
        lowercased and reduced to ``[a-z0-9_]`` so it is safe as a DB/app user."""
        base = re.sub(r'[^a-z0-9]+', '_', (name or 'service').lower()).strip('_') or 'service'
        suffix = secrets.token_hex(2)  # 4 hex chars, keeps it short but unique
        return f'svc_{base}_{suffix}'

    @classmethod
    def _resolve_magic_value(cls, kind: str, name: str, context: Dict) -> str:
        """Resolve a single magic token to a value.

        ``context`` may carry ``fqdn`` / ``scheme`` (and ``app_name``); when an
        FQDN is not known yet the FQDN/URL forms degrade to a documented
        placeholder (``localhost``) that the install finalizer can later fill —
        this keeps resolution best-effort and non-fatal.
        """
        context = context or {}
        if kind == 'password':
            return cls._generate_magic_password()
        if kind == 'user':
            return cls._generate_magic_user(name)
        if kind == 'base64':
            import base64
            secret = secrets.token_bytes(24)
            return base64.b64encode(secret).decode('ascii')
        if kind == 'fqdn':
            return str(context.get('fqdn') or context.get('app_name') or 'localhost')
        if kind == 'url':
            scheme = str(context.get('scheme') or 'http')
            host = context.get('fqdn') or context.get('app_name') or 'localhost'
            return f'{scheme}://{host}'
        if kind == 'metrics_token':
            from app.services import metrics_token_service
            return metrics_token_service.get_or_create()
        if kind == 'server_public_ip':
            ip = context.get('server_public_ip')
            if not ip:
                try:
                    from app.services.site_domain_service import SiteDomainService
                    ip = SiteDomainService.server_ip()
                except Exception:
                    ip = None
            return str(ip or '')
        return ''

    @classmethod
    def resolve_magic_variables(cls, content: Any, context: Dict = None):
        """Scan ``content`` for ``${SERVICE_*}`` magic tokens, generate a value
        once per unique token, substitute, and return ``(substituted, generated)``.

        Args:
            content: A string, or a (possibly nested) dict/list — e.g. a parsed
                compose section. Returned with the same shape.
            context: Optional dict with ``app_name`` / ``fqdn`` / ``scheme`` used
                to resolve FQDN/URL tokens. No Docker/network access is performed.

        Returns:
            ``(substituted_content, generated_vars)`` where ``generated_vars`` maps
            each magic variable name (without ``${}``) to its generated value, so
            callers can persist them as env vars / surface them post-install.
            Pure and idempotent for a given ``content`` within one call (the same
            token always maps to the same generated value here).
        """
        context = context or {}
        generated: Dict[str, str] = {}

        def _collect(text: str):
            for match in re.finditer(cls.MAGIC_TOKEN_PATTERN, text):
                token = match.group(1)
                if token in generated:
                    continue
                kind, name = cls._classify_magic_token(token)
                if kind is None:
                    continue
                generated[token] = cls._resolve_magic_value(kind, name, context)

        def _walk_collect(node: Any):
            if isinstance(node, str):
                _collect(node)
            elif isinstance(node, dict):
                for value in node.values():
                    _walk_collect(value)
            elif isinstance(node, list):
                for item in node:
                    _walk_collect(item)

        # Pass 1: discover every unique token and generate a stable value.
        _walk_collect(content)

        # Pass 2: substitute using the generated values. Reuse the existing
        # ${VAR} substitution so behavior is identical to normal variables.
        if isinstance(content, str):
            substituted = cls.substitute_variables(content, generated)
        else:
            substituted = cls.substitute_in_dict(content, generated)

        return substituted, generated

    @classmethod
    def collect_magic_variables(cls, template: Dict, context: Dict = None) -> Dict[str, str]:
        """Generate the magic variables a template uses, given its declared
        ``compose`` / ``files`` / ``scripts`` sections, WITHOUT mutating the
        template. Returns ``{name: value}`` for every ``${SERVICE_*}`` token found.

        This is the wiring entry point for the install flow: the returned dict is
        merged into the install ``variables`` so the existing ``${VAR}``
        substitution renders the tokens, and so the secrets land in ``.env`` /
        post-install output. Templates with no magic tokens get ``{}`` and behave
        exactly as before.
        """
        # Scan the parts that the installer substitutes against.
        scan_target = {
            'compose': template.get('compose', {}),
            'files': template.get('files', []),
            'scripts': template.get('scripts', {}),
        }
        _, generated = cls.resolve_magic_variables(scan_target, context)
        return generated

    @classmethod
    def _install_magic_context(cls, template: Dict, app_name: str,
                               variables: Dict = None) -> Dict:
        """Build the best-effort ``context`` for magic-variable resolution at
        install time.

        Resolves the would-be FQDN from the managed-sites base domain when one is
        configured (the same ``<slug>.<base>`` the finalizer publishes), and the
        scheme from whether wildcard HTTPS is on. All of this is best-effort and
        non-fatal: if site routing isn't set up (or we're outside an app context),
        FQDN/URL tokens fall back to a documented ``localhost`` placeholder that
        the install finalizer can later fill in.
        """
        context = {'app_name': app_name}
        try:
            from app.services.site_domain_service import SiteDomainService
            base = SiteDomainService.base_domain()
            # Only assign an FQDN when the template opts into auto-domain and a
            # base domain exists — mirrors the finalizer's publish condition.
            if base and template.get('auto_domain'):
                host = SiteDomainService.subdomain_for(app_name)
                if host:
                    context['fqdn'] = host
                    context['scheme'] = 'https' if (
                        SiteDomainService.https_enabled()
                        and SiteDomainService.covers(host)
                    ) else 'http'
        except Exception:
            # No app context / site routing not available — leave FQDN unset so
            # tokens degrade to the localhost placeholder.
            pass
        return context

    @classmethod
    def _collect_magic_for_install(cls, template: Dict, app_name: str,
                                   variables: Dict = None) -> Dict[str, str]:
        """Resolve a template's magic variables for an install, using the
        best-effort FQDN context. Thin wrapper over :meth:`collect_magic_variables`."""
        context = cls._install_magic_context(template, app_name, variables)
        return cls.collect_magic_variables(template, context)

    @classmethod
    def validate_catalog_entry(cls, entry: Dict) -> Dict:
        """Lightweight validation of a declarative catalog entry (the YAML
        template shape documented in ``docs/TEMPLATE_CATALOG_SCHEMA.md``).

        Complements :meth:`validate_template` (which the loader uses) with a few
        catalog-level checks: an ``id`` slug, declared variable ``type`` values,
        and well-formed magic tokens. Returns ``{'valid': bool, 'errors': [...],
        'warnings': [...]}``. Non-fatal issues are reported as warnings so the
        loader stays permissive.
        """
        errors: List[str] = []
        warnings: List[str] = []

        if not isinstance(entry, dict):
            return {'valid': False, 'errors': ['Catalog entry must be a mapping'], 'warnings': []}

        # Reuse the canonical template validation for required fields/compose.
        base = cls.validate_template(entry)
        if not base.get('valid'):
            errors.extend(base.get('errors', []))

        # id should be a DNS/file-safe slug when present.
        entry_id = entry.get('id')
        if entry_id is not None:
            if not isinstance(entry_id, str) or not re.fullmatch(r'[a-z0-9][a-z0-9-]*', entry_id or ''):
                errors.append("Field 'id' must be a lowercase slug (a-z, 0-9, dashes)")

        # Validate declared variable types (list or dict form).
        known_types = {'string', 'password', 'port', 'uuid', 'random', 'boolean', 'select'}
        raw_vars = entry.get('variables', [])
        var_items = []
        if isinstance(raw_vars, list):
            var_items = [(v.get('name'), v) for v in raw_vars if isinstance(v, dict)]
        elif isinstance(raw_vars, dict):
            var_items = list(raw_vars.items())
        for var_name, var_config in var_items:
            if not isinstance(var_config, dict):
                continue
            vtype = var_config.get('type', 'string')
            if vtype not in known_types:
                warnings.append(f"Variable '{var_name}' uses unknown type '{vtype}'")

        # Validate any magic tokens embedded in compose/files/scripts.
        scan_target = {
            'compose': entry.get('compose', {}),
            'files': entry.get('files', []),
            'scripts': entry.get('scripts', {}),
        }

        def _check_tokens(node):
            if isinstance(node, str):
                for match in re.finditer(r'\$\{(SERVICE_[A-Z0-9_]+)\}', node):
                    token = match.group(1)
                    kind, name = cls._classify_magic_token(token)
                    if kind is None:
                        warnings.append(f"Unrecognized magic token '${{{token}}}'")
                    elif not name:
                        warnings.append(f"Magic token '${{{token}}}' is missing a <NAME> suffix")
            elif isinstance(node, dict):
                for value in node.values():
                    _check_tokens(value)
            elif isinstance(node, list):
                for item in node:
                    _check_tokens(item)

        _check_tokens(scan_target)

        # Engine templates: shape errors already came from validate_template
        # above. Here we add the soft checks -- a block that names variables
        # which don't exist would install, but the Databases UI could not find
        # the password field or the port field.
        if cls.is_engine_template(entry):
            engine = entry['engine']
            declared = {name for name, _ in var_items if name}
            for key in ('admin_password_var', 'database_var', 'port_var', 'bind_var'):
                var_name = engine.get(key)
                if var_name and var_name not in declared:
                    warnings.append(
                        f"engine.{key} references '{var_name}', which is not a declared variable")
            if not engine.get('family'):
                warnings.append('engine block has no family; it will not match a family filter')

        return {'valid': not errors, 'errors': errors, 'warnings': warnings}

    @classmethod
    def validate_mysql_connection(cls, host: str, port: int, user: str,
                                   password: str, database: str) -> Dict:
        """Validate MySQL database connection.

        Args:
            host: Database host
            port: Database port
            user: Database username
            password: Database password
            database: Database name

        Returns:
            Dict with 'success' and optional 'error' or 'warning' message
        """
        import socket

        try:
            # First check if host:port is reachable
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(5)
            result = sock.connect_ex((host, int(port)))
            sock.close()

            if result != 0:
                return {
                    'success': False,
                    'error': f'Cannot connect to {host}:{port} - host unreachable'
                }

            # Try MySQL connection if pymysql available
            try:
                import pymysql
                conn = pymysql.connect(
                    host=host,
                    port=int(port),
                    user=user,
                    password=password,
                    database=database,
                    connect_timeout=5
                )
                conn.close()
                return {'success': True}
            except ImportError:
                # pymysql not available, just check port was reachable
                return {
                    'success': True,
                    'warning': 'MySQL library not available, only port check performed'
                }
            except Exception as e:
                return {
                    'success': False,
                    'error': f'Database connection failed: {str(e)}'
                }

        except Exception as e:
            return {
                'success': False,
                'error': f'Connection check failed: {str(e)}'
            }

    @classmethod
    def _managed_app_base_port(cls) -> int:
        """Return the admin-configured base port for managed apps, or 0 if unset.

        Reads the ``managed_app_base_port`` system setting. Returns 0 (meaning
        "use each template's own default") on any error, e.g. if the settings
        table isn't ready yet during early startup.
        """
        try:
            from app.services.settings_service import SettingsService
            return int(SettingsService.get('managed_app_base_port', 0) or 0)
        except Exception:
            return 0

    @classmethod
    def _find_available_port(cls, start_port: int = 8000, max_attempts: int = 1000) -> int:
        """Find an available port that's not in use by the system, Docker, or database.

        Checks:
        1. Ports assigned to existing applications in the database
        2. Docker container port mappings
        3. Socket binding test
        """
        import socket

        # Get ports from database (assigned to apps)
        db_ports = cls._get_database_used_ports()

        # Get ports currently used by Docker containers
        docker_ports = cls._get_docker_used_ports()

        # Combine all used ports
        used_ports = db_ports | docker_ports

        for port in range(start_port, start_port + max_attempts):
            # Skip reserved/common ports
            if port < 1024:
                continue

            # Skip if already assigned in DB or Docker
            if port in used_ports:
                continue

            # Check if port is available on localhost (where Docker binds)
            try:
                # Try to bind - most reliable check
                test_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                test_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                test_sock.bind(('127.0.0.1', port))
                test_sock.close()
                return port
            except OSError:
                continue
            except Exception:
                continue

        # Fallback: return a random high port
        import random
        return random.randint(10000, 60000)

    @classmethod
    def _port_is_free(cls, port) -> bool:
        """True when nothing -- app row, container, or live socket -- holds
        ``port``. Same three sources as :meth:`_find_available_port`, asked
        about one specific port instead of scanning."""
        import socket
        try:
            port = int(port)
        except (TypeError, ValueError):
            return False
        if not 1 <= port <= 65535:
            return False
        if port in (cls._get_database_used_ports() | cls._get_docker_used_ports()):
            return False
        try:
            test_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            test_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            test_sock.bind(('127.0.0.1', port))
            test_sock.close()
            return True
        except OSError:
            return False
        except Exception:
            return False

    @classmethod
    def _get_database_used_ports(cls) -> set:
        """Get all ports assigned to applications in the database."""
        used_ports = set()
        try:
            from app.models import Application
            # Deliberately unfiltered: a soft-deleted app must KEEP reserving its
            # port, or a new app takes it and restoring from the recycle bin collides.
            apps = Application.query.filter(Application.port.isnot(None)).all()
            for app in apps:
                if app.port:
                    used_ports.add(app.port)
            # A slot app holds two ports (plan 87): the live one is app.port,
            # the standby's stays reserved for the switch back.
            from app.models.app_slot import AppSlot
            used_ports.update(row.host_port for row in
                              AppSlot.query.filter(AppSlot.host_port.isnot(None)).all())
        except Exception:
            pass
        return used_ports

    @classmethod
    def _get_docker_used_ports(cls) -> set:
        """Get all ports currently mapped by Docker containers."""
        used_ports = set()
        try:
            result = run_checked(['docker', 'ps', '--format', '{{.Ports}}'], timeout=10)
            if result['success']:
                # Parse port mappings like "0.0.0.0:8080->80/tcp, 127.0.0.1:3306->3306/tcp"
                import re
                for line in result['output'].strip().split('\n'):
                    if line:
                        # Find all host ports in the format "host:port->container"
                        matches = re.findall(r'(?:[\d.]+:)?(\d+)->', line)
                        for port_str in matches:
                            try:
                                used_ports.add(int(port_str))
                            except ValueError:
                                pass
        except Exception:
            pass
        return used_ports

    @classmethod
    def substitute_variables(cls, content: str, variables: Dict) -> str:
        """Substitute variables in content using ${VAR} syntax."""
        def replace_var(match):
            var_name = match.group(1)
            return str(variables.get(var_name, match.group(0)))

        # Replace ${VAR} patterns
        pattern = r'\$\{([A-Z_][A-Z0-9_]*)\}'
        return re.sub(pattern, replace_var, content)

    @classmethod
    def substitute_in_dict(cls, data: Any, variables: Dict) -> Any:
        """Recursively substitute variables in a dictionary."""
        if isinstance(data, str):
            return cls.substitute_variables(data, variables)
        elif isinstance(data, dict):
            return {k: cls.substitute_in_dict(v, variables) for k, v in data.items()}
        elif isinstance(data, list):
            return [cls.substitute_in_dict(item, variables) for item in data]
        return data

    @classmethod
    def generate_compose(cls, template: Dict, variables: Dict) -> str:
        """Generate docker-compose.yml from template."""
        compose = template.get('compose', {})

        # Substitute variables
        compose = cls.substitute_in_dict(compose, variables)

        # Remove obsolete version field (not needed in modern Docker Compose)
        if 'version' in compose:
            del compose['version']

        return yaml.dump(compose, default_flow_style=False, sort_keys=False)

    @classmethod
    def list_local_templates(cls) -> List[Dict]:
        """List locally available templates.

        Deliberately NOT provider-gated: this is the raw "what is bundled on
        disk" view, which ``build_repo_index`` needs to describe the bundle
        faithfully for publishing. Provider-owned templates are hidden from
        the *catalog* instead — :meth:`list_all_templates` and
        :meth:`get_template` apply the availability gate (plan 52 D4), so an
        absent extension means hidden cards and refused installs even though
        the YAML remains bundled.

        Parsing is memoized per file (see the cache block near the top of the
        class); a repeat listing stats each file instead of re-parsing it.
        """
        templates = []
        seen_ids = set()
        seen_paths = set()

        for templates_dir in [cls.TEMPLATES_DIR, cls.LOCAL_TEMPLATES_DIR]:
            if not os.path.isdir(templates_dir):
                continue

            try:
                with os.scandir(templates_dir) as scan:
                    # Sorted so a same-id collision (foo.yaml vs foo.yml)
                    # resolves the same way on every platform; os.listdir order
                    # is filesystem-dependent.
                    dir_entries = sorted(scan, key=lambda e: e.name)
            except OSError:
                continue

            for dir_entry in dir_entries:
                if not dir_entry.name.endswith(('.yaml', '.yml')):
                    continue
                seen_paths.add(dir_entry.path)

                template_id = dir_entry.name.rsplit('.', 1)[0]
                if template_id in seen_ids:
                    continue
                try:
                    # DirEntry.stat() reuses the data the directory scan
                    # already returned where the platform provides it, so this
                    # is cheaper than a separate os.stat per file.
                    info = dir_entry.stat()
                except OSError:
                    continue

                entry = cls._local_entry(dir_entry.path, template_id,
                                         (info.st_mtime_ns, info.st_size))
                if entry is not None:
                    # A file that fails to parse deliberately does NOT claim
                    # the id, so a valid file of the same name in the fallback
                    # directory can still supply it.
                    seen_ids.add(template_id)
                    templates.append(entry)

        cls._prune_local_cache(seen_paths)
        return templates

    @classmethod
    def invalidate_local_cache(cls) -> None:
        """Drop the parsed-template cache.

        Ordinary writes do not need this -- the cache is keyed on
        (mtime_ns, size), so syncing or editing a template invalidates exactly
        that file on the next listing. Provided for tests and any out-of-band
        mutation that could defeat mtime comparison."""
        with cls._local_cache_lock:
            cls._local_cache = {}

    @classmethod
    def _prune_local_cache(cls, seen_paths: set) -> None:
        """Forget files that are no longer on disk, so a long-running panel
        that churns templates does not grow the cache without bound."""
        with cls._local_cache_lock:
            stale = [p for p in cls._local_cache if p not in seen_paths]
            for path in stale:
                del cls._local_cache[path]

    @classmethod
    def _local_entry(cls, filepath: str, template_id: str,
                     stat_key: tuple) -> Optional[Dict]:
        """Catalog projection for one bundled template, memoized on ``stat_key``.

        Returns None when the file does not parse -- and caches that negative
        result too, so one malformed YAML does not cost a parse on every
        render. Returns a deep copy so a caller mutating the result (or its
        nested ``repo``/``engine``/``categories``) cannot corrupt the cache."""
        with cls._local_cache_lock:
            cached = cls._local_cache.get(filepath)
            if cached is not None and cached['key'] == stat_key:
                return copy.deepcopy(cached['entry'])

        entry = cls._parse_local_entry(filepath, template_id)

        with cls._local_cache_lock:
            cls._local_cache[filepath] = {'key': stat_key, 'entry': entry}
        return copy.deepcopy(entry)

    @classmethod
    def _parse_local_entry(cls, filepath: str, template_id: str) -> Optional[Dict]:
        """Parse one template file into its catalog projection, or None."""
        result = cls.parse_template(filepath)
        if not result.get('success'):
            return None

        template = result['template']
        kind = template.get('kind', 'compose')
        entry = {
            'id': template_id,
            'name': template.get('name'),
            'version': template.get('version'),
            'description': template.get('description'),
            'icon': template.get('icon'),
            'categories': template.get('categories', []),
            'kind': kind,
            'source': 'local',
            'filepath': filepath
        }
        # Repo templates surface a minimal repo summary so the catalog grid
        # can badge them and link to the wizard without a second fetch.
        if kind == 'repo' and isinstance(template.get('repo'), dict):
            repo = template['repo']
            entry['repo'] = {
                'url': repo.get('url'),
                'branch': repo.get('branch', 'main'),
            }
        # A database engine declares itself with a top-level `engine:` block.
        # This listing is a fixed projection, so without carrying the block
        # through, the Databases catalog could never see an engine without
        # re-parsing every YAML file.
        engine = cls.engine_metadata(template)
        if engine:
            entry['engine'] = engine
        return entry

    @classmethod
    def list_engine_templates(cls) -> List[Dict]:
        """Every available template carrying an ``engine:`` block.

        This is what the Databases engine catalog renders. It is derived
        entirely from the template sources -- drop a new engine YAML into
        ``backend/templates/`` (or sync a repository that ships one) and it
        appears here with no code change.
        """
        return [t for t in cls.list_all_templates()
                if isinstance(t.get('engine'), dict)]

    @classmethod
    def build_repo_index(cls, repo_name: str = 'serverkit-official') -> Dict:
        """Build the ``index.json`` document that describes the locally-bundled
        templates as a publishable repository.

        This is the exact shape :meth:`fetch_remote_templates` / :meth:`sync_templates`
        consume from ``<repo_url>/index.json`` (templates served at
        ``<repo_url>/templates/<id>.yaml``). Publishing a repo is then just:
        host the ``templates/*.yaml`` files plus this ``index.json``. Lets
        Prompture Hub & friends ship template updates without a panel release.
        """
        templates = []
        for t in cls.list_local_templates():
            entry = {
                'id': t['id'],
                'name': t.get('name'),
                'version': t.get('version'),
                'description': t.get('description'),
                'icon': t.get('icon'),
                'categories': t.get('categories', []),
            }
            # Carried in the index so a panel that syncs this repo can list the
            # engine catalog without fetching all 100+ template files first.
            if isinstance(t.get('engine'), dict):
                entry['engine'] = t['engine']
            templates.append(entry)
        return {
            'name': repo_name,
            'schema_version': cls.SCHEMA_VERSION,
            'generated_at': datetime.now().isoformat(),
            'count': len(templates),
            'templates': templates,
        }

    @classmethod
    def export_repo_index(cls, dest_path: str = None) -> Dict:
        """Write :meth:`build_repo_index` to ``dest_path`` (defaults to
        ``index.json`` alongside the bundled templates). Returns a status dict."""
        index = cls.build_repo_index()
        path = dest_path or os.path.join(cls.LOCAL_TEMPLATES_DIR, 'index.json')
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(index, f, indent=2)
            return {'success': True, 'path': path, 'count': index['count']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def invalidate_remote_cache(cls, repo_url: str = None) -> None:
        """Drop cached remote indexes -- all of them, or just ``repo_url``.

        Called whenever the repo list changes so a freshly added repo appears
        immediately instead of after the TTL, and a removed one stops being
        served from cache."""
        with cls._remote_cache_lock:
            if repo_url is None:
                cls._remote_cache = {}
            else:
                cls._remote_cache.pop(repo_url, None)

    @classmethod
    def _cached_remote(cls, repo_url: str) -> Optional[List[Dict]]:
        """Unexpired cache entry for ``repo_url``, or None. Returns copies so a
        caller mutating an entry cannot corrupt the cache."""
        with cls._remote_cache_lock:
            entry = cls._remote_cache.get(repo_url)
            if entry and entry['expires'] > time.monotonic():
                return [dict(t) for t in entry['templates']]
        return None

    @classmethod
    def _last_good_remote(cls, repo_url: str) -> Optional[List[Dict]]:
        """Last payload this repo successfully served, regardless of expiry."""
        with cls._remote_cache_lock:
            entry = cls._remote_cache.get(repo_url) or {}
            last_good = entry.get('last_good')
            return [dict(t) for t in last_good] if last_good else None

    @classmethod
    def _store_remote(cls, repo_url: str, templates: List[Dict], ok: bool) -> None:
        """Cache ``templates`` for ``repo_url``. A successful payload also
        becomes the last-good; a failure carries the previous last-good
        forward, so repeated failures keep serving it instead of decaying to
        an empty catalog on the second one."""
        ttl = cls._REMOTE_TTL_SECONDS if ok else cls._REMOTE_ERROR_TTL_SECONDS
        with cls._remote_cache_lock:
            previous = cls._remote_cache.get(repo_url) or {}
            cls._remote_cache[repo_url] = {
                'templates': [dict(t) for t in templates],
                'expires': time.monotonic() + ttl,
                'ok': ok,
                'last_good': ([dict(t) for t in templates] if ok
                              else previous.get('last_good')),
            }

    @classmethod
    def fetch_remote_templates(cls, repo_url: str, force: bool = False) -> List[Dict]:
        """Fetch a repository's template index, memoized (see the cache block
        near the top of the class). ``force=True`` bypasses the cache, which is
        what an explicit sync wants."""
        if not force:
            cached = cls._cached_remote(repo_url)
            if cached is not None:
                return cached

        templates = []
        try:
            index_url = f"{repo_url}/index.json"
            response = requests.get(index_url, timeout=cls._REMOTE_TIMEOUT_SECONDS)
            response.raise_for_status()

            index = response.json()
            for template_info in index.get('templates', []):
                template_info['source'] = 'remote'
                template_info['repo_url'] = repo_url
                templates.append(template_info)

        except Exception as e:
            print(f"Failed to fetch templates from {repo_url}: {e}")
            # Keep serving the last good index rather than blanking a catalog
            # the operator has already seen, but still back off so a dead repo
            # is not retried on every single page load.
            last_good = cls._last_good_remote(repo_url)
            cls._store_remote(repo_url, last_good or [], ok=False)
            return last_good or []

        cls._store_remote(repo_url, templates, ok=True)
        return [dict(t) for t in templates]

    @classmethod
    def list_all_templates(cls, category: str = None, search: str = None) -> List[Dict]:
        """List all available templates from all sources, deduped by id.

        Bundled and registry templates deliberately overlap -- the bundle is the
        offline floor and the registry is the growth path (docs/REGISTRIES.md) --
        so the same id legitimately arrives from both. Concatenating them listed
        every bundled template twice. **Local wins**, matching
        :meth:`get_template`, which already resolves local directories before
        any repo; among repos, the first enabled one to claim an id keeps it.
        """
        by_id = {}

        def _claim(entry):
            """First source to claim an id keeps it."""
            template_id = entry.get('id')
            if template_id and template_id not in by_id:
                by_id[template_id] = entry

        # Local templates first -- they outrank every repo.
        for entry in cls.list_local_templates():
            _claim(entry)

        # Remote templates fill in ids the bundle does not carry.
        config = cls.get_config()
        for repo in config.get('repos', []):
            if repo.get('enabled', True):
                for entry in cls.fetch_remote_templates(repo['url']):
                    _claim(entry)

        templates = list(by_id.values())

        # Filter by category
        if category:
            templates = [t for t in templates if category in t.get('categories', [])]

        # Provider-owned templates from any source (incl. synced remote repos)
        # are hidden while their extension is absent.
        templates = [t for t in templates if cls.template_available(t.get('id'))]

        # Search filter
        if search:
            search_lower = search.lower()
            templates = [
                t for t in templates
                if search_lower in t.get('name', '').lower()
                or search_lower in t.get('description', '').lower()
            ]

        return templates

    @classmethod
    def get_template(cls, template_id: str) -> Dict:
        """Get full template details."""
        if not cls.template_available(template_id):
            owner = cls.PROVIDER_OWNED_TEMPLATES.get(template_id)
            return {
                'success': False,
                'error': f"Template '{template_id}' is provided by the "
                         f"'{owner}' extension, which is not installed or not active",
            }
        # Check local directories (system dir, then bundled fallback)
        for templates_dir in [cls.TEMPLATES_DIR, cls.LOCAL_TEMPLATES_DIR]:
            for ext in ['.yaml', '.yml']:
                filepath = os.path.join(templates_dir, f"{template_id}{ext}")
                if os.path.exists(filepath):
                    result = cls.parse_template(filepath)
                    if result.get('success'):
                        template = result['template']
                        template['source'] = 'local'
                        template['filepath'] = filepath
                        return {'success': True, 'template': template}
                    return result

        # Check remote repos
        config = cls.get_config()
        for repo in config.get('repos', []):
            if not repo.get('enabled', True):
                continue

            try:
                url = f"{repo['url']}/templates/{template_id}.yaml"
                response = requests.get(url, timeout=30)
                if response.status_code == 200:
                    template = yaml.safe_load(response.text)
                    validation = cls.validate_template(template)
                    if validation['valid']:
                        template['source'] = 'remote'
                        template['repo_url'] = repo['url']
                        return {'success': True, 'template': template}
            except Exception:
                continue

        return {'success': False, 'error': 'Template not found'}

    @classmethod
    def build_template_hints(cls, template: Dict) -> Dict:
        """Build a manifest-shaped payload from a repo template's declared
        ``repo`` hints, used as an honest fallback when the public repo cannot be
        inspected live. Mirrors ``RepositoryManifestService`` output so the wizard
        renders it with the same code path; the caller tags ``source`` so the UI
        can label confidence.
        """
        repo = template.get('repo') if isinstance(template.get('repo'), dict) else {}
        build_method = repo.get('build_method')
        recommended = {
            'app_type': repo.get('app_type'),
            'build_method': build_method,
            'port': repo.get('port'),
            'dockerfile_path': repo.get('dockerfile_path')
            or ('Dockerfile' if build_method == 'dockerfile' else None),
            'custom_build_cmd': repo.get('build_command'),
            'custom_start_cmd': repo.get('start_command'),
            'healthcheck_path': repo.get('healthcheck_path'),
        }
        manifests = [
            {
                'type': 'template-hint',
                'file': file_name,
                'label': file_name,
                'summary': 'Declared by template',
            }
            for file_name in (repo.get('manifest_files') or [])
        ]
        env = []
        for item in (repo.get('env') or []):
            if isinstance(item, dict) and item.get('key'):
                env.append({
                    'key': item['key'],
                    'value': None if item.get('secret') else item.get('value'),
                    'required': bool(item.get('required')),
                    'secret': bool(item.get('secret')),
                    'source': 'template-hints',
                    'description': item.get('description', ''),
                })
        return {
            'success': True,
            'strategy': repo.get('strategy')
            or ('docker_compose' if build_method else None),
            'recommended': recommended,
            'manifests': manifests,
            'env': env,
            'ports': [repo['port']] if repo.get('port') else [],
            'detected_files': list(repo.get('manifest_files') or []),
            'warnings': [],
        }

    @classmethod
    def build_install_plan(cls, template_id: str, app_name: str,
                           user_variables: Dict = None, user_id: int = None,
                           server_id: str = None,
                           auto_domain: bool = None) -> Dict:
        """Build a reusable deployment plan for installing a template.

        The returned plan can be executed locally or by a connected agent.

        ``auto_domain=True`` opts this install into subdomain publishing even
        when the template YAML doesn't — the deploy drawer shows the operator
        the exact <name>.<base> hostname before they click Deploy, and a
        promise shown on screen must not silently depend on a per-template
        flag they can't see (the install landed on host:port instead, which a
        default firewall doesn't even expose). ``None`` keeps the template's
        own say.
        """
        result = cls.get_template(template_id)
        if not result.get('success'):
            return result

        template = result['template']
        if auto_domain and not template.get('auto_domain'):
            # Copy, not mutate — get_template may serve this dict to others.
            # Downstream (FQDN magic context, plan flag, finalizer) all read
            # the template flag, so opting in here opts in everywhere.
            template = {**template, 'auto_domain': True}
        variables_result = cls._prepare_install_variables(
            template_id,
            template,
            app_name,
            user_variables or {},
        )
        if not variables_result.get('success'):
            return variables_result

        variables = variables_result['variables']
        app_path = os.path.join(cls.INSTALLED_DIR, app_name)
        compose_file = os.path.join(app_path, 'docker-compose.yml')

        compose_result = cls._render_compose_and_files(template, variables, app_path)
        if not compose_result.get('success'):
            return compose_result

        install_info = {
            'template_id': template_id,
            'template_version': template.get('version'),
            'template_name': template.get('name'),
            'installed_at': datetime.now().isoformat(),
            'variables': variables,
            'user_id': user_id,
            'server_id': server_id,
        }

        env_content = ''.join(f"{key}={value}\n" for key, value in variables.items())

        app_port = None
        for port_var in ['PORT', 'HTTP_PORT', 'WEB_PORT']:
            if port_var in variables:
                try:
                    app_port = int(variables[port_var])
                    break
                except (ValueError, TypeError):
                    pass

        files = [
            {
                'path': compose_file,
                'content': compose_result['compose_content'],
                'mode': 0o644,
            },
            {
                'path': os.path.join(app_path, '.serverkit-template.json'),
                'content': json.dumps(install_info, indent=2),
                'mode': 0o600,
            },
            {
                'path': os.path.join(app_path, '.env'),
                'content': env_content,
                'mode': 0o600,
            },
        ]
        files.extend(compose_result.get('files', []))

        steps = []
        for file_def in files:
            steps.append({
                'type': 'file.write',
                'name': f"Write {os.path.basename(file_def['path'])}",
                'path': file_def['path'],
                'content': file_def['content'],
                'mode': file_def.get('mode', 0o644),
                'create_dirs': True,
            })

        steps.append({
            'type': 'docker.compose.up',
            'name': 'Start Docker Compose stack',
            'project_dir': app_path,
            'compose_file': compose_file,
            'detach': True,
            'build': True,
            'timeout': 300,
        })
        steps.append({
            'type': 'sleep',
            'name': 'Wait for containers to initialize',
            'seconds': 3,
        })
        steps.append({
            'type': 'docker.compose.ps',
            'name': 'Capture container status',
            'project_dir': app_path,
            'compose_file': compose_file,
            'timeout': 30,
        })

        return {
            'success': True,
            'plan': {
                'kind': 'template_install',
                'template_id': template_id,
                'template_name': template.get('name'),
                'template_version': template.get('version'),
                'app_name': app_name,
                'app_path': app_path,
                'compose_file': compose_file,
                'variables': variables,
                'port': app_port,
                'server_id': server_id,
                'auto_domain': bool(template.get('auto_domain')),
                'steps': steps,
            },
            'template': template,
            'variables': variables,
            'app_path': app_path,
            'port': app_port,
        }

    @classmethod
    def _prepare_install_variables(cls, template_id: str, template: Dict,
                                    app_name: str, user_variables: Dict) -> Dict:
        """Prepare template variables for installation."""
        variables = {
            'APP_NAME': app_name,
        }
        template_vars = template.get('variables', {})

        if isinstance(template_vars, list):
            template_vars = {v['name']: v for v in template_vars if isinstance(v, dict) and 'name' in v}

        for var_name, var_config in template_vars.items():
            var_type = var_config.get('type', 'string')

            if var_type == 'port':
                # Ports are auto-assigned by default (template defaults are
                # never trusted). An explicitly REQUESTED port is honored, but
                # only after confirming it is actually free -- so the caller
                # still can never be handed a port that is already bound. The
                # Databases engine installer relies on this to make its
                # documented `port` parameter real rather than advisory.
                requested = (user_variables or {}).get(var_name)
                if requested and cls._port_is_free(requested):
                    variables[var_name] = str(requested)
                else:
                    variables[var_name] = cls.generate_value(var_config)
            elif user_variables and var_name in user_variables and user_variables[var_name]:
                variables[var_name] = user_variables[var_name]
            elif var_config.get('required', False) and var_name not in user_variables:
                return {'success': False, 'error': f"Required variable not provided: {var_name}"}
            else:
                variables[var_name] = cls.generate_value(var_config)

        # Provider-owned templates validate through their provider's hook
        # (plan 52 D4 — the WordPress external-DB preflight lives in the WP
        # extension now), never through hardcoded per-template branches here.
        veto = cls._run_provider_validate(template_id, variables)
        if veto:
            return veto

        # Resolve magic variables (${SERVICE_PASSWORD_*} etc.) used in the
        # template's compose/files/scripts and merge the generated values into the
        # install variables. A template with no magic tokens gets {} here, so this
        # is a no-op for existing templates. User-supplied values win.
        magic = cls._collect_magic_for_install(template, app_name, variables)
        for key, value in magic.items():
            variables.setdefault(key, value)

        return {'success': True, 'variables': variables}

    @classmethod
    def _render_compose_and_files(cls, template: Dict, variables: Dict, app_path: str) -> Dict:
        """Render compose YAML and any template-defined files in memory."""
        try:
            compose = cls.substitute_in_dict(template.get('compose', {}), variables)
            if 'version' in compose:
                del compose['version']

            rendered_files = []
            bind_mounts = []

            for file_def in template.get('files', []) or []:
                container_path = file_def.get('path')
                content = file_def.get('content', '')
                if not container_path:
                    continue

                content = cls.substitute_variables(content, variables)
                filename = os.path.basename(container_path)
                rendered_files.append({
                    'path': os.path.join(app_path, filename),
                    'content': content,
                    'mode': int(file_def.get('mode', 0o644)),
                })
                # Only absolute container paths are bind-mounted into the
                # container (e.g. /app/config.yaml). A relative path like
                # 'Dockerfile' is a build-context file: it is written into the
                # app directory only — mounting it would produce an invalid
                # './Dockerfile:Dockerfile' volume spec and compose up fails.
                if container_path.startswith('/'):
                    bind_mounts.append({
                        'local': f'./{filename}',
                        'container': container_path,
                        'container_dir': os.path.dirname(container_path),
                    })

            if bind_mounts:
                cls._apply_bind_mounts_to_compose(compose, bind_mounts)

            return {
                'success': True,
                'compose_content': yaml.dump(compose, default_flow_style=False, sort_keys=False),
                'files': rendered_files,
            }
        except Exception as e:
            return {'success': False, 'error': f'Failed to render template: {str(e)}'}

    @classmethod
    def _apply_bind_mounts_to_compose(cls, compose: Dict, bind_mounts: List[Dict]) -> None:
        """Apply file bind mounts to a compose dictionary."""
        volumes_to_remove = set()

        for service in compose.get('services', {}).values():
            volumes = service.get('volumes', [])
            new_volumes = []

            for vol in volumes:
                if isinstance(vol, str):
                    parts = vol.split(':')
                    if len(parts) >= 2:
                        mount_target = parts[1].rstrip('/')
                        should_replace = any(
                            mount_target == mount['container_dir'].rstrip('/')
                            for mount in bind_mounts
                        )
                        if should_replace:
                            volumes_to_remove.add(parts[0])
                            continue
                new_volumes.append(vol)

            for mount in bind_mounts:
                bind_mount = f"{mount['local']}:{mount['container']}"
                if bind_mount not in new_volumes:
                    new_volumes.append(bind_mount)

            service['volumes'] = new_volumes

        if 'volumes' in compose:
            for volume_name in volumes_to_remove:
                compose['volumes'].pop(volume_name, None)
            if not compose['volumes']:
                del compose['volumes']

    @classmethod
    def install_template(cls, template_id: str, app_name: str,
                        user_variables: Dict = None, user_id: int = None) -> Dict:
        """Install a template as a new application."""
        from app import db
        from app.models import Application
        from app.services.docker_service import DockerService

        # Get template
        result = cls.get_template(template_id)
        if not result.get('success'):
            return result

        template = result['template']

        # Prepare variables - start with automatic variables
        variables = {
            'APP_NAME': app_name,
        }
        template_vars = template.get('variables', {})

        # Handle both dict format (new) and list format (old)
        if isinstance(template_vars, list):
            # Convert list format to dict
            template_vars = {v['name']: v for v in template_vars if 'name' in v}

        for var_name, var_config in template_vars.items():
            var_type = var_config.get('type', 'string')

            # ALWAYS auto-generate ports - never use user values for ports
            if var_type == 'port':
                variables[var_name] = cls.generate_value(var_config)
            elif user_variables and var_name in user_variables and user_variables[var_name]:
                variables[var_name] = user_variables[var_name]
            elif var_config.get('required', False) and var_name not in (user_variables or {}):
                return {'success': False, 'error': f"Required variable not provided: {var_name}"}
            else:
                variables[var_name] = cls.generate_value(var_config)

        # Validate provider-owned templates through their provider hook
        # (plan 52 D4 — e.g. the external-DB connection preflight for
        # wordpress-external-db is supplied by the WordPress extension).
        veto = cls._run_provider_validate(template_id, variables)
        if veto:
            return veto

        # Resolve magic variables (${SERVICE_*}) and merge generated values.
        # No-op for templates that don't use magic tokens; user values win.
        for key, value in cls._collect_magic_for_install(template, app_name, variables).items():
            variables.setdefault(key, value)

        # Create app directory
        app_path = os.path.join(cls.INSTALLED_DIR, app_name)
        if os.path.exists(app_path):
            return {'success': False, 'error': f"A service directory already exists at {app_path}. Choose another name."}

        try:
            os.makedirs(app_path, exist_ok=True)

            # Generate docker-compose.yml
            compose_content = cls.generate_compose(template, variables)
            compose_path = os.path.join(app_path, 'docker-compose.yml')
            with open(compose_path, 'w') as f:
                f.write(compose_content)

            # Save installation info
            install_info = {
                'template_id': template_id,
                'template_version': template.get('version'),
                'template_name': template.get('name'),
                'installed_at': datetime.now().isoformat(),
                'variables': variables,
                'user_id': user_id
            }
            info_path = os.path.join(app_path, '.serverkit-template.json')
            with open(info_path, 'w') as f:
                json.dump(install_info, f, indent=2)

            # Save .env file with variables
            env_path = os.path.join(app_path, '.env')
            with open(env_path, 'w') as f:
                for key, value in variables.items():
                    f.write(f"{key}={value}\n")

            # Process template files section - create files and update compose for bind mounts
            if 'files' in template:
                files_result = cls._process_template_files(
                    template['files'],
                    app_path,
                    compose_path,
                    variables
                )
                if not files_result.get('success'):
                    shutil.rmtree(app_path)
                    return files_result

            # Run pre-install script if exists
            if 'scripts' in template and 'pre_install' in template['scripts']:
                script_result = cls._run_script(
                    template['scripts']['pre_install'],
                    app_path,
                    variables
                )
                if not script_result.get('success'):
                    shutil.rmtree(app_path)
                    return script_result

            # Start the app with docker compose
            compose_result = DockerService.compose_up(app_path, detach=True, build=True)
            if not compose_result.get('success'):
                shutil.rmtree(app_path)
                return compose_result

            # Verify container started and port is accessible
            import time
            time.sleep(3)  # Give containers time to fully start

            # Run post-install script if exists
            if 'scripts' in template and 'post_install' in template['scripts']:
                cls._run_script(
                    template['scripts']['post_install'],
                    app_path,
                    variables
                )

            # Create application record
            # Look for port in variables - templates may use PORT or HTTP_PORT
            app_port = None
            for port_var in ['PORT', 'HTTP_PORT', 'WEB_PORT']:
                if port_var in variables:
                    try:
                        app_port = int(variables[port_var])
                        break
                    except (ValueError, TypeError):
                        pass

            # Verify port is accessible after startup
            port_accessible = False
            port_warning = None
            if app_port:
                port_check = DockerService.check_port_accessible(app_port)
                port_accessible = port_check.get('accessible', False)
                if not port_accessible:
                    port_warning = f"Port {app_port} is not accessible after container start. Container may still be initializing or port mapping may be incorrect."
                    print(f"Warning: {port_warning}")

            app = Application(
                name=app_name,
                app_type='docker',
                status='running',
                root_path=app_path,
                docker_image=template.get('name'),
                user_id=user_id or 1,
                port=app_port
            )
            db.session.add(app)
            db.session.commit()

            # Update installed config
            config = cls.get_config()
            config.setdefault('installed', {})[str(app.id)] = {
                'template_id': template_id,
                'template_version': template.get('version'),
                'app_id': app.id,
                'app_name': app_name,
                'installed_at': datetime.now().isoformat()
            }
            cls.save_config(config)

            result = {
                'success': True,
                'app_id': app.id,
                'app_name': app_name,
                'app_path': app_path,
                'variables': variables,
                'port': app_port,
                'port_accessible': port_accessible
            }

            if port_warning:
                result['port_warning'] = port_warning

            return result

        except Exception as e:
            import traceback
            error_trace = traceback.format_exc()
            print(f"Template install service error: {error_trace}")
            if os.path.exists(app_path):
                shutil.rmtree(app_path)
            return {'success': False, 'error': str(e), 'trace': error_trace}

    @classmethod
    def _process_template_files(cls, files: List[Dict], app_path: str,
                                 compose_path: str, variables: Dict) -> Dict:
        """Process template files section - create files and update compose for bind mounts.

        This method:
        1. Creates files defined in the template's 'files' section
        2. Updates docker-compose.yml to bind mount these files into containers

        Args:
            files: List of file definitions from template (path, content)
            app_path: Path to the app directory
            compose_path: Path to the docker-compose.yml file
            variables: Variables dict for substitution

        Returns:
            Dict with success status
        """
        try:
            created_files = []
            bind_mounts = []  # Track files that need to be bind mounted

            for file_def in files:
                container_path = file_def.get('path')
                content = file_def.get('content', '')

                if not container_path:
                    continue

                # Substitute variables in content
                content = cls.substitute_variables(content, variables)

                # Determine local filename (use basename of container path)
                filename = os.path.basename(container_path)
                local_path = os.path.join(app_path, filename)

                # Write file locally
                with open(local_path, 'w') as f:
                    f.write(content)

                created_files.append(filename)

                # Track for bind mount: local file -> container path
                # Get the container directory from the path
                container_dir = os.path.dirname(container_path)
                bind_mounts.append({
                    'local': f'./{filename}',
                    'container': container_path,
                    'container_dir': container_dir
                })

            # Update docker-compose.yml to use bind mounts instead of named volumes
            if bind_mounts:
                cls._update_compose_with_bind_mounts(compose_path, bind_mounts)

            return {
                'success': True,
                'files_created': created_files,
                'bind_mounts': len(bind_mounts)
            }

        except Exception as e:
            return {'success': False, 'error': f'Failed to process template files: {str(e)}'}

    @classmethod
    def _update_compose_with_bind_mounts(cls, compose_path: str, bind_mounts: List[Dict]) -> None:
        """Update docker-compose.yml to use bind mounts for template files.

        Replaces named volume mounts with bind mounts for specific container paths.

        Args:
            compose_path: Path to docker-compose.yml
            bind_mounts: List of bind mount definitions
        """
        with open(compose_path, 'r') as f:
            compose = yaml.safe_load(f)

        # Group bind mounts by container directory
        dir_to_files = {}
        for mount in bind_mounts:
            dir_to_files.setdefault(mount['container_dir'], []).append(mount)

        # Process each service
        for service_name, service in compose.get('services', {}).items():
            volumes = service.get('volumes', [])
            new_volumes = []
            volumes_to_remove = set()

            for vol in volumes:
                if isinstance(vol, str):
                    # Parse volume string: "name:/path" or "./local:/path"
                    parts = vol.split(':')
                    if len(parts) >= 2:
                        mount_target = parts[1].rstrip('/')

                        # Check if this volume's target directory matches any of our file paths
                        should_replace = False
                        for mount in bind_mounts:
                            container_dir = mount['container_dir'].rstrip('/')
                            if mount_target == container_dir:
                                # This named volume covers a directory where we need to place files
                                should_replace = True
                                volumes_to_remove.add(parts[0])  # Track volume name to remove
                                break

                        if not should_replace:
                            new_volumes.append(vol)
                    else:
                        new_volumes.append(vol)
                else:
                    new_volumes.append(vol)

            # Add bind mounts for our files
            for mount in bind_mounts:
                bind_mount_str = f"{mount['local']}:{mount['container']}"
                if bind_mount_str not in new_volumes:
                    new_volumes.append(bind_mount_str)

            service['volumes'] = new_volumes

        # Remove unused named volumes from top-level volumes section
        if 'volumes' in compose and volumes_to_remove:
            for vol_name in volumes_to_remove:
                if vol_name in compose['volumes']:
                    del compose['volumes'][vol_name]
            # Remove volumes section if empty
            if not compose['volumes']:
                del compose['volumes']

        # Write updated compose file
        with open(compose_path, 'w') as f:
            yaml.dump(compose, f, default_flow_style=False, sort_keys=False)

    @classmethod
    def _run_script(cls, script: str, cwd: str, variables: Dict) -> Dict:
        """Run a script with variable substitution."""
        try:
            script = cls.substitute_variables(script, variables)

            env = os.environ.copy()
            env.update(variables)

            result = run_checked(['bash', '-c', script], cwd=cwd, env=env, timeout=300)

            if not result['success']:
                return {
                    'success': False,
                    'error': f"Script failed: {result['error']}",
                    'output': result['output'],
                }

            return {'success': True, 'output': result['output']}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Script timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def check_updates(cls, app_id: int) -> Dict:
        """Check if an installed app has template updates available."""
        config = cls.get_config()
        installed = config.get('installed', {}).get(str(app_id))

        if not installed:
            return {'success': False, 'error': 'This service was not installed from a template'}

        template_id = installed['template_id']
        installed_version = installed['template_version']

        # Get latest template
        result = cls.get_template(template_id)
        if not result.get('success'):
            return result

        latest_version = result['template'].get('version')

        return {
            'success': True,
            'installed_version': installed_version,
            'latest_version': latest_version,
            'update_available': latest_version != installed_version
        }

    @classmethod
    def _update_slot_app(cls, app, template, variables, install_info, info_path,
                         compose_path, backup_path, compose_content, config, user_id,
                         log_callback):
        """Template update for a slot app (plan 87 §C): write the new compose,
        then deploy it into the idle slot. The live slot keeps serving until
        the new one passes its gate; any failure puts the old files back."""
        from app.services.deployment_service import DeploymentService

        with open(compose_path, 'w') as f:
            f.write(compose_content)
        if 'files' in template:
            files_result = cls._process_template_files(
                template['files'], app.root_path, compose_path, variables)
            if not files_result.get('success'):
                if os.path.exists(backup_path):
                    shutil.copy(backup_path, compose_path)
                return files_result

        result = DeploymentService._deploy_locked(app.id, user_id, False, 'template_update',
                                                  f"template-{template.get('version')}",
                                                  log_callback)
        if not result.get('success'):
            # The live slot never stopped; the files on disk must match it again.
            if os.path.exists(backup_path):
                shutil.copy(backup_path, compose_path)
            return result

        install_info['template_version'] = template.get('version')
        install_info['updated_at'] = datetime.now().isoformat()
        install_info['variables'] = variables
        with open(info_path, 'w') as f:
            json.dump(install_info, f, indent=2)
        if 'scripts' in template and 'post_update' in template['scripts']:
            cls._run_script(template['scripts']['post_update'], app.root_path, variables)
        config['installed'][str(app.id)]['template_version'] = template.get('version')
        config['installed'][str(app.id)]['updated_at'] = datetime.now().isoformat()
        cls.save_config(config)
        if os.path.exists(backup_path):
            os.remove(backup_path)
        return {'success': True, 'version': template.get('version'), 'app_id': app.id,
                'slot': result.get('deployment', {}).get('id')}

    @classmethod
    @with_deploy_lock('template update')
    def update_app(cls, app_id: int, user_id: int = None,
                   log_callback: Callable[[str], None] = None) -> Dict:
        """Update an installed app to the latest template version.

        The new compose is rendered, validated and its images resolved *before*
        the running containers are stopped (plan 72 B.1) — a template whose new
        version does not render, does not validate or cannot pull now fails
        with the old stack still serving.
        """
        from app import db
        from app.models import Application
        from app.services.docker_service import DockerService
        from app.services import deploy_preflight_service as preflight

        config = cls.get_config()
        installed = config.get('installed', {}).get(str(app_id))

        if not installed:
            return {'success': False, 'error': 'This service was not installed from a template'}

        app = Application.query_active().filter_by(id=app_id).first()
        if not app:
            return {'success': False, 'error': 'Service not found'}

        template_id = installed['template_id']
        app_path = app.root_path

        # Get latest template
        result = cls.get_template(template_id)
        if not result.get('success'):
            return result

        template = result['template']

        # Load existing variables. install_info is written back further down, so
        # it must exist even when the marker file is missing or corrupt —
        # otherwise the update raised NameError *after* compose_down and left
        # the app stopped, which is exactly the outage this path is supposed to
        # avoid.
        info_path = os.path.join(app_path, '.serverkit-template.json')
        install_info = {}
        try:
            with open(info_path, 'r') as f:
                install_info = json.load(f)
            variables = install_info.get('variables', {})
        except Exception:
            variables = {}

        # Add any new variables with defaults. Templates may declare variables as
        # a list ([{name: ...}, ...]) or a dict ({NAME: {...}}); normalize to dict
        # so converted templates (which use the list form) update correctly.
        template_vars = template.get('variables', {})
        if isinstance(template_vars, list):
            template_vars = {v['name']: v for v in template_vars
                             if isinstance(v, dict) and 'name' in v}
        for var_name, var_config in template_vars.items():
            if var_name not in variables:
                variables[var_name] = cls.generate_value(var_config)

        try:
            # Backup current compose
            compose_path = os.path.join(app_path, 'docker-compose.yml')
            backup_path = os.path.join(app_path, 'docker-compose.yml.bak')
            if os.path.exists(compose_path):
                shutil.copy(compose_path, backup_path)

            # Run pre-update script
            if 'scripts' in template and 'pre_update' in template['scripts']:
                script_result = cls._run_script(
                    template['scripts']['pre_update'],
                    app_path,
                    variables
                )
                if not script_result.get('success'):
                    return script_result

            # Generate the new compose FIRST and validate it while the current
            # stack is still running. It is written to a sibling candidate file
            # (a dotfile, so nothing globbing docker-compose* picks it up) —
            # same directory, so relative bind mounts and .env resolve exactly
            # as they will after the switchover.
            compose_content = cls.generate_compose(template, variables)
            candidate_name = '.serverkit-preflight-compose.yml'
            candidate_path = os.path.join(app_path, candidate_name)
            try:
                with open(candidate_path, 'w') as f:
                    f.write(compose_content)
                checks = preflight.preflight_compose_project(
                    app_path, compose_file=candidate_name,
                    log=log_callback,
                    label=f'the new {template.get("name", template_id)} compose',
                )
            finally:
                if os.path.exists(candidate_path):
                    os.remove(candidate_path)

            if not checks.ok:
                # Nothing has been stopped and nothing on disk has changed —
                # the app is still serving the version it was serving.
                return {'success': False, 'error': checks.error,
                        'preflight': checks.to_dict()}

            if app.slot_deploys_enabled:
                return cls._update_slot_app(app, template, variables, install_info,
                                            info_path, compose_path, backup_path,
                                            compose_content, config, user_id, log_callback)

            # ---- switchover: past this line the live stack is down ---------
            DockerService.compose_down(app_path)

            # Write the compose that was just validated
            with open(compose_path, 'w') as f:
                f.write(compose_content)

            # Re-render any template-defined files and re-apply their bind mounts,
            # so templates that ship config via a `files:` section (e.g. litellm,
            # signoz, posthog) keep working across updates instead of losing the
            # mounted config when the compose is regenerated.
            if 'files' in template:
                files_result = cls._process_template_files(
                    template['files'], app_path, compose_path, variables
                )
                if not files_result.get('success'):
                    # Roll back to the backed-up compose and abort the update.
                    if os.path.exists(backup_path):
                        shutil.copy(backup_path, compose_path)
                    return files_result

            # Update installation info
            install_info['template_version'] = template.get('version')
            install_info['updated_at'] = datetime.now().isoformat()
            install_info['variables'] = variables
            with open(info_path, 'w') as f:
                json.dump(install_info, f, indent=2)

            # Pull new images and start. The preflight above already pulled
            # everything the validated compose referenced, so this is a cached
            # no-op for those; it stays as the safety net for images that
            # _process_template_files introduced after validation.
            DockerService.compose_pull(app_path)
            compose_result = DockerService.compose_up(app_path, detach=True, build=True)

            if not compose_result.get('success'):
                # Rollback — and say whether it worked: an unchecked `up` here
                # reported a plain failure while the app sat stopped (§A6).
                if os.path.exists(backup_path):
                    shutil.copy(backup_path, compose_path)
                    restored = DockerService.compose_up(app_path, detach=True)
                    compose_result = dict(compose_result)
                    compose_result['restored'] = bool(restored.get('success'))
                    if not restored.get('success'):
                        compose_result['error'] = (
                            f"{compose_result.get('error') or 'docker compose up failed'}; "
                            f"restoring the previous version also failed: "
                            f"{restored.get('error') or 'unknown error'} — the app is down")
                return compose_result

            # Run post-update script
            if 'scripts' in template and 'post_update' in template['scripts']:
                cls._run_script(
                    template['scripts']['post_update'],
                    app_path,
                    variables
                )

            # Update config
            config['installed'][str(app_id)]['template_version'] = template.get('version')
            config['installed'][str(app_id)]['updated_at'] = datetime.now().isoformat()
            cls.save_config(config)

            # Remove backup
            if os.path.exists(backup_path):
                os.remove(backup_path)

            return {
                'success': True,
                'version': template.get('version'),
                'app_id': app_id
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_installed_info(cls, app_id: int) -> Optional[Dict]:
        """Get template installation info for an app."""
        config = cls.get_config()
        return config.get('installed', {}).get(str(app_id))

    @classmethod
    def propagate_db_credentials(cls, source_app_id: int, target_app_id: int,
                                  target_prefix: str = None) -> Dict:
        """Propagate database credentials from source app to target app.

        Reads source app's .env file for DB credentials, updates target app's
        .env with same credentials but different table prefix.

        Args:
            source_app_id: ID of the app with existing DB credentials
            target_app_id: ID of the app to receive credentials
            target_prefix: Table prefix for target app (default: wp_dev_)

        Returns:
            Dict with success status and propagated config
        """
        from app.models import Application

        source_app = Application.query_active().filter_by(id=source_app_id).first()
        target_app = Application.query_active().filter_by(id=target_app_id).first()

        if not source_app or not target_app:
            return {'success': False, 'error': 'Service not found'}

        if not source_app.root_path or not target_app.root_path:
            return {'success': False, 'error': 'Both services need a root path'}

        # Read source app's .env file
        source_env_path = os.path.join(source_app.root_path, '.env')
        if not os.path.exists(source_env_path):
            return {'success': False, 'error': 'The source service has no .env file'}

        try:
            env_vars = {}
            with open(source_env_path, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        env_vars[key.strip()] = value.strip()

            # Extract DB credentials
            db_config = {}
            db_keys = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
                       'WORDPRESS_DB_HOST', 'WORDPRESS_DB_NAME', 'WORDPRESS_DB_USER',
                       'WORDPRESS_DB_PASSWORD', 'MYSQL_HOST', 'MYSQL_DATABASE',
                       'MYSQL_USER', 'MYSQL_PASSWORD']

            for key in db_keys:
                if key in env_vars:
                    db_config[key] = env_vars[key]

            if not db_config:
                return {'success': False, 'error': 'No database credentials found in the source service'}

            # Set target table prefix (default different from source)
            source_prefix = env_vars.get('TABLE_PREFIX', env_vars.get('WORDPRESS_TABLE_PREFIX', 'wp_'))
            if target_prefix is None:
                if source_prefix == 'wp_':
                    target_prefix = 'wp_dev_'
                else:
                    target_prefix = 'wp_'

            # Update target app's .env file
            target_env_path = os.path.join(target_app.root_path, '.env')

            # Read existing target .env or create new
            target_env = {}
            if os.path.exists(target_env_path):
                with open(target_env_path, 'r') as f:
                    for line in f:
                        line = line.strip()
                        if line and not line.startswith('#') and '=' in line:
                            key, value = line.split('=', 1)
                            target_env[key.strip()] = value.strip()

            # Update with source DB credentials
            for key, value in db_config.items():
                target_env[key] = value

            # Set different table prefix
            target_env['TABLE_PREFIX'] = target_prefix
            target_env['WORDPRESS_TABLE_PREFIX'] = target_prefix

            # Write updated .env
            with open(target_env_path, 'w') as f:
                for key, value in target_env.items():
                    f.write(f"{key}={value}\n")

            # Also update docker-compose.yml if it exists
            compose_path = os.path.join(target_app.root_path, 'docker-compose.yml')
            if os.path.exists(compose_path):
                try:
                    with open(compose_path, 'r') as f:
                        compose = yaml.safe_load(f)

                    # Update environment variables in services
                    for service_name, service in compose.get('services', {}).items():
                        env_list = service.get('environment', [])
                        if isinstance(env_list, list):
                            new_env = []
                            for env_item in env_list:
                                if isinstance(env_item, str) and '=' in env_item:
                                    key = env_item.split('=')[0]
                                    if key in target_env:
                                        new_env.append(f"{key}={target_env[key]}")
                                    else:
                                        new_env.append(env_item)
                                else:
                                    new_env.append(env_item)
                            service['environment'] = new_env

                    with open(compose_path, 'w') as f:
                        yaml.dump(compose, f, default_flow_style=False)
                except Exception as e:
                    # Non-fatal, continue
                    pass

            # Store shared config in both apps
            shared_config = {
                'db_host': db_config.get('DB_HOST', db_config.get('WORDPRESS_DB_HOST', '')),
                'db_name': db_config.get('DB_NAME', db_config.get('WORDPRESS_DB_NAME', '')),
                'source_prefix': source_prefix,
                'target_prefix': target_prefix,
                'propagated_at': datetime.now().isoformat()
            }

            return {
                'success': True,
                'shared_config': shared_config,
                'source_prefix': source_prefix,
                'target_prefix': target_prefix
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def add_repository(cls, name: str, url: str) -> Dict:
        """Add a template repository."""
        config = cls.get_config()

        # Check if already exists
        for repo in config.get('repos', []):
            if repo['url'] == url:
                return {'success': False, 'error': 'Repository already exists'}

        config.setdefault('repos', []).append({
            'name': name,
            'url': url.rstrip('/'),
            'enabled': True,
            'added_at': datetime.now().isoformat()
        })

        return cls.save_config(config)

    @classmethod
    def remove_repository(cls, url: str) -> Dict:
        """Remove a template repository."""
        config = cls.get_config()
        config['repos'] = [r for r in config.get('repos', []) if r['url'] != url]
        return cls.save_config(config)

    @classmethod
    def list_repositories(cls) -> List[Dict]:
        """List configured template repositories."""
        config = cls.get_config()
        return config.get('repos', cls.DEFAULT_REPOS)

    @classmethod
    def sync_templates(cls) -> Dict:
        """Sync templates from all repositories."""
        os.makedirs(cls.TEMPLATES_DIR, exist_ok=True)

        config = cls.get_config()
        synced = 0
        unverified = 0  # saved, but the index pinned no sha256 for them
        errors = []

        for repo in config.get('repos', []):
            if not repo.get('enabled', True):
                continue

            try:
                # Fetch index
                index_url = f"{repo['url']}/index.json"
                response = requests.get(index_url, timeout=30)
                response.raise_for_status()

                index = response.json()

                # Download each template
                for template_info in index.get('templates', []):
                    template_id = template_info.get('id')
                    if not template_id:
                        continue

                    try:
                        template_url = f"{repo['url']}/templates/{template_id}.yaml"
                        response = requests.get(template_url, timeout=30)
                        response.raise_for_status()

                        # Verify against the checksum the index pinned for this
                        # entry. A template is a deploy definition -- images,
                        # ports, volumes, env -- so a swapped file is worth
                        # refusing outright, and the index already carries the
                        # hash for every official entry.
                        #
                        # Missing hash is allowed (third-party repos may not
                        # publish one) and counted, mirroring how extensions
                        # treat unsigned-vs-invalid: absent is a caveat, wrong
                        # is a hard stop.
                        expected = (template_info.get('sha256') or '').strip().lower()
                        if expected:
                            actual = hashlib.sha256(response.content).hexdigest()
                            if actual != expected:
                                errors.append(
                                    f"Checksum mismatch for {template_id}: index pinned "
                                    f"{expected[:12]}..., downloaded {actual[:12]}.... Not saved."
                                )
                                continue
                        else:
                            unverified += 1

                        # Written as bytes so what lands on disk is exactly the
                        # content that was hashed (text mode would rewrite line
                        # endings on Windows and no longer match).
                        filepath = os.path.join(cls.TEMPLATES_DIR, f"{template_id}.yaml")
                        with open(filepath, 'wb') as f:
                            f.write(response.content)

                        synced += 1
                    except Exception as e:
                        errors.append(f"Failed to sync {template_id}: {e}")

            except Exception as e:
                errors.append(f"Failed to sync from {repo['name']}: {e}")

        config['last_sync'] = datetime.now().isoformat()
        cls.save_config(config)

        return {
            'success': True,
            'synced': synced,
            'unverified': unverified,
            'errors': errors if errors else None
        }

    @classmethod
    def get_categories(cls) -> List[str]:
        """Get all available template categories."""
        templates = cls.list_all_templates()
        categories = set()
        for template in templates:
            categories.update(template.get('categories', []))
        return sorted(categories)

    @classmethod
    def create_local_template(cls, template_data: Dict) -> Dict:
        """Create a local template."""
        validation = cls.validate_template(template_data)
        if not validation['valid']:
            return {'success': False, 'errors': validation['errors']}

        os.makedirs(cls.TEMPLATES_DIR, exist_ok=True)

        template_id = template_data['name'].lower().replace(' ', '-')
        filepath = os.path.join(cls.TEMPLATES_DIR, f"{template_id}.yaml")

        if os.path.exists(filepath):
            return {'success': False, 'error': 'Template with this name already exists'}

        try:
            with open(filepath, 'w') as f:
                yaml.dump(template_data, f, default_flow_style=False, sort_keys=False)

            return {'success': True, 'template_id': template_id, 'filepath': filepath}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_local_template(cls, template_id: str) -> Dict:
        """Delete a local template."""
        for ext in ['.yaml', '.yml']:
            filepath = os.path.join(cls.TEMPLATES_DIR, f"{template_id}{ext}")
            if os.path.exists(filepath):
                os.remove(filepath)
                return {'success': True}

        return {'success': False, 'error': 'Template not found'}
