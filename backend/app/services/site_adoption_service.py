"""Adopt sites that already run on this host (issue #269).

A site that was set up by hand, by a script or by a migration serves traffic
through host nginx but has no row in ``applications`` / ``domains`` /
``wordpress_sites``, so the panel cannot see it: no monitoring, backups, SSL
status or logs. The other entry points all *create* something — a vhost, a
copy of the files — which is the wrong thing to do to a site that is already
live.

This module only ever READS the host: the live nginx config, the PHP-FPM
pools, the certificate files and ``wp-config.php``. Adopting writes database
rows and nothing else. The resulting application carries
``managed_by='host'``, which the vhost writer, the lifecycle and the delete
path all honour by leaving the running config alone
(``Application.is_host_managed``).

``discover()`` doubles as the drift report: every site it returns without a
``linked_app`` is one serving traffic that the panel does not know about.
"""
import glob
import logging
import os
import re
from datetime import datetime

from app import db
from app.models.application import Application
from app.models.domain import Domain
from app.services.nginx_service import NginxService
from app.utils.slug import app_name_clash_error, slugify

logger = logging.getLogger(__name__)

HOST_MANAGED = Application.MANAGED_BY_HOST

# Where the distro keeps PHP-FPM pools: /etc/php/<version>/fpm/pool.d/*.conf.
# Globbed rather than iterated over a list of known versions, so a 7.4 or 8.4
# pool is found too.
PHP_ETC_DIR = os.environ.get('PHP_ETC_DIR', '/etc/php')

# Kinds of site a vhost can describe, and what each one adopts as.
KIND_PHP = 'php'
KIND_STATIC = 'static'
KIND_PROXY = 'proxy'
KIND_REDIRECT = 'redirect'
_ADOPTABLE_KINDS = (KIND_PHP, KIND_STATIC)


class SiteAdoptionError(Exception):
    """Adoption refused. ``status`` is the HTTP status the API answers with."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# --------------------------------------------------------------------------
# Reading nginx
# --------------------------------------------------------------------------

def _live_vhost_files():
    """Config files nginx is actually loading: ``sites-enabled/*`` (Debian
    layout) and ``conf.d/*.conf`` (RHEL layout, and extras on Debian)."""
    files = []
    enabled = NginxService.SITES_ENABLED
    if os.path.isdir(enabled):
        files.extend(sorted(glob.glob(os.path.join(enabled, '*'))))
    conf_d = os.path.join(NginxService.NGINX_CONF_DIR, 'conf.d')
    if os.path.isdir(conf_d):
        files.extend(sorted(glob.glob(os.path.join(conf_d, '*.conf'))))
    return [f for f in files if os.path.isfile(f)]


def _strip_comments(text):
    return re.sub(r'(?m)#.*$', '', text)


def _server_blocks(text):
    """The body of every ``server { ... }`` block, by brace matching."""
    blocks = []
    for match in re.finditer(r'(?:^|[\s;{}])server\s*\{', text):
        depth, start = 1, match.end()
        pos = start
        while pos < len(text) and depth:
            char = text[pos]
            if char == '{':
                depth += 1
            elif char == '}':
                depth -= 1
            pos += 1
        if depth == 0:
            blocks.append(text[start:pos - 1])
    return blocks


def _directive(body, name):
    """Every value of directive ``name`` in ``body``, in order."""
    pattern = r'(?:^|[;{}])\s*' + re.escape(name) + r'\s+([^;{}]+);'
    return [value.strip() for value in re.findall(pattern, body)]


def _first(values):
    return values[0] if values else None


def _unquote(value):
    return value.strip().strip('"\'') if value else value


def _parse_block(body):
    names = []
    for value in _directive(body, 'server_name'):
        for name in value.split():
            # `_` is the catch-all and `~...` a regex: neither is a domain.
            if name != '_' and not name.startswith('~') and name not in names:
                names.append(name)
    listens = _directive(body, 'listen')
    return {
        'domains': names,
        'root': _unquote(_first(_directive(body, 'root'))),
        'fastcgi_pass': _first(_directive(body, 'fastcgi_pass')),
        'proxy_pass': _first(_directive(body, 'proxy_pass')),
        'certificate': _unquote(_first(_directive(body, 'ssl_certificate'))),
        'certificate_key': _unquote(_first(_directive(body, 'ssl_certificate_key'))),
        'ssl': any('ssl' in value.split() or value.split()[0].endswith('443')
                   for value in listens if value.split()),
    }


def _has_content(block):
    return bool(block['root'] or block['fastcgi_pass'] or block['proxy_pass'])


def _related(domain_a, domain_b):
    """`www.example.com` and `example.com` are the same site."""
    return domain_a == 'www.' + domain_b or domain_b == 'www.' + domain_a


def _merge(target, block):
    for name in block['domains']:
        if name not in target['domains']:
            target['domains'].append(name)
    for key in ('root', 'fastcgi_pass', 'proxy_pass', 'certificate', 'certificate_key'):
        target[key] = target[key] or block[key]
    target['ssl'] = target['ssl'] or block['ssl']


def _group_blocks(blocks):
    """One group per site. A port-80 redirect and its 443 twin share names and
    merge; a content-less `www.` redirect folds into the site it points at."""
    groups = []
    for block in blocks:
        if not block['domains']:
            continue
        home = next((g for g in groups if set(g['domains']) & set(block['domains'])), None)
        if home is None:
            groups.append(dict(block, domains=list(block['domains'])))
        else:
            _merge(home, block)

    sites = [g for g in groups if _has_content(g)]
    for group in groups:
        if _has_content(group):
            continue
        home = next((s for s in sites
                     if any(_related(a, b) for a in s['domains'] for b in group['domains'])),
                    None)
        if home is not None:
            _merge(home, group)
        else:
            sites.append(group)
    return sites


# --------------------------------------------------------------------------
# Reading PHP-FPM, certificates, WordPress
# --------------------------------------------------------------------------

def _fpm_pools():
    """Every PHP-FPM pool on the box: ``{version, pool, listen, file}``."""
    pools = []
    pattern = os.path.join(PHP_ETC_DIR, '*', 'fpm', 'pool.d', '*.conf')
    for path in sorted(glob.glob(pattern)):
        version = os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(path))))
        try:
            with open(path, encoding='utf-8', errors='replace') as handle:
                text = re.sub(r'(?m)^\s*[;#].*$', '', handle.read())
        except OSError:
            continue
        section = re.search(r'(?m)^\s*\[([^\]]+)\]', text)
        listen = re.search(r'(?m)^\s*listen\s*=\s*(\S+)', text)
        if listen:
            pools.append({'version': version,
                          'pool': section.group(1) if section else None,
                          'listen': listen.group(1), 'file': path})
    return pools


def _php_for(fastcgi_pass, pools):
    """Which PHP serves a ``fastcgi_pass`` target: matched against the pools'
    ``listen``, falling back to the version in a conventional socket name."""
    target = fastcgi_pass.strip()
    target = target[len('unix:'):] if target.startswith('unix:') else target
    for pool in pools:
        if pool['listen'] == target:
            return {'version': pool['version'], 'pool': pool['pool'],
                    'listen': pool['listen'], 'pool_file': pool['file']}
    named = re.search(r'php-?(\d+\.\d+)', target)
    return {'version': named.group(1) if named else None, 'pool': None,
            'listen': target, 'pool_file': None}


def _certificate_expiry(path):
    try:
        from cryptography import x509
        with open(path, 'rb') as handle:
            cert = x509.load_pem_x509_certificate(handle.read())
        expires = getattr(cert, 'not_valid_after_utc', None) or cert.not_valid_after
        return expires.replace(tzinfo=None)
    except Exception:  # unreadable, missing or not a PEM certificate
        return None


_WP_DEFINE = r'''define\(\s*['"]{key}['"]\s*,\s*['"]([^'"]*)['"]'''


def _wordpress(root):
    """What ``wp-config.php`` says about the site. The password is never read:
    nothing here needs it, and a secret we do not hold cannot leak."""
    config = next((path for path in (os.path.join(root, 'wp-config.php'),
                                     os.path.join(os.path.dirname(root.rstrip('/\\')),
                                                  'wp-config.php'))
                   if os.path.isfile(path)), None)
    if config is None:
        return None
    try:
        with open(config, encoding='utf-8', errors='replace') as handle:
            text = handle.read()
    except OSError:
        return {'config_file': config, 'readable': False}

    def define(key):
        match = re.search(_WP_DEFINE.format(key=key), text)
        return match.group(1) if match else None

    prefix = re.search(r'''\$table_prefix\s*=\s*['"]([^'"]+)['"]''', text)
    version = None
    try:
        with open(os.path.join(root, 'wp-includes', 'version.php'),
                  encoding='utf-8', errors='replace') as handle:
            found = re.search(r'''\$wp_version\s*=\s*['"]([^'"]+)['"]''', handle.read())
            version = found.group(1) if found else None
    except OSError:
        pass
    return {
        'config_file': config, 'readable': True, 'version': version,
        'db_name': define('DB_NAME'), 'db_user': define('DB_USER'),
        'db_host': define('DB_HOST') or 'localhost',
        'table_prefix': prefix.group(1) if prefix else 'wp_',
        'multisite': bool(re.search(r'''define\(\s*['"]MULTISITE['"]\s*,\s*true''', text, re.I)),
    }


# --------------------------------------------------------------------------
# Discovery
# --------------------------------------------------------------------------

def _is_panel_vhost(path):
    """ServerKit's own vhost and snippets are not sites to adopt."""
    return os.path.basename(path).lower().startswith('serverkit')


def _link_index():
    """Lookup tables for "is this site already an application?"."""
    apps = Application.query_active().all()
    by_id = {app.id: app for app in apps}
    by_domain = {}
    for domain in Domain.query_active().all():
        if domain.application_id in by_id:
            by_domain[domain.name.lower()] = by_id[domain.application_id]
    by_root = {os.path.normpath(app.root_path): app for app in apps
               if app.root_path and not app.server_id}
    by_name = {app.name: app for app in apps if not app.server_id}
    return by_domain, by_root, by_name


def _linked_app(site, vhost_file, index):
    by_domain, by_root, by_name = index
    for domain in site['domains']:
        if domain.lower() in by_domain:
            return by_domain[domain.lower()]
    if site['root'] and os.path.normpath(site['root']) in by_root:
        return by_root[os.path.normpath(site['root'])]
    # A vhost the panel wrote is named after its application.
    stem = os.path.basename(vhost_file)
    return by_name.get(stem) or by_name.get(stem[:-len('.conf')] if stem.endswith('.conf') else stem)


def _describe(site, vhost_file, pools, index, single):
    primary = site['domains'][0]
    stem = os.path.basename(vhost_file)
    root = site['root']
    root_exists = bool(root and os.path.isdir(root))

    if site['fastcgi_pass']:
        kind = KIND_PHP
    elif site['proxy_pass']:
        kind = KIND_PROXY
    elif root:
        kind = KIND_STATIC
    else:
        kind = KIND_REDIRECT

    php = _php_for(site['fastcgi_pass'], pools) if kind == KIND_PHP else None
    wordpress = _wordpress(root) if kind == KIND_PHP and root_exists else None
    app_type = {KIND_PHP: 'wordpress' if wordpress else 'php',
                KIND_STATIC: 'static'}.get(kind)

    port = None
    if site['proxy_pass']:
        found = re.search(r':(\d+)', site['proxy_pass'].split('//', 1)[-1])
        port = int(found.group(1)) if found else None

    certificate = site['certificate']
    expires = _certificate_expiry(certificate) if certificate else None
    linked = _linked_app(site, vhost_file, index)

    reason = None
    if linked is not None:
        reason = f'Already managed as "{linked.name}".'
    elif kind == KIND_PROXY:
        reason = ('This vhost proxies to a running process. Register that process as a '
                  'service (Docker Compose or systemd) instead of adopting the vhost.')
    elif kind == KIND_REDIRECT:
        reason = 'This vhost only redirects; there is no site behind it to adopt.'
    elif not root_exists:
        reason = f'Document root does not exist: {root}'

    return {
        'id': stem if single else f'{stem}#{primary}',
        'vhost_file': os.path.realpath(vhost_file),
        'domains': list(site['domains']),
        'primary_domain': primary,
        'kind': kind,
        'app_type': app_type,
        'root': root,
        'root_exists': root_exists,
        'php': php,
        'upstream': site['proxy_pass'],
        'port': port,
        'ssl': {
            'enabled': bool(site['ssl'] and certificate),
            'certificate': certificate,
            'certificate_key': site['certificate_key'],
            'letsencrypt': bool(certificate and '/letsencrypt/' in certificate.replace('\\', '/')),
            'expires_at': expires.isoformat() if expires else None,
        },
        'wordpress': wordpress,
        'database': ({'engine': 'mysql', 'name': wordpress['db_name'],
                      'user': wordpress.get('db_user'), 'host': wordpress.get('db_host')}
                     if wordpress and wordpress.get('db_name') else None),
        'linked_app': {'id': linked.id, 'name': linked.name} if linked is not None else None,
        'adoptable': reason is None and kind in _ADOPTABLE_KINDS,
        'reason': reason,
        'suggested_name': slugify(primary) or 'site',
    }


def discover():
    """Every site host nginx is serving, with what backs it and whether the
    panel already manages it. Read-only; an unreadable file is skipped."""
    pools = _fpm_pools()
    index = _link_index()
    sites = []
    for path in _live_vhost_files():
        if _is_panel_vhost(path):
            continue
        try:
            with open(path, encoding='utf-8', errors='replace') as handle:
                text = _strip_comments(handle.read())
        except OSError as exc:
            logger.warning('site adoption: cannot read %s: %s', path, exc)
            continue
        groups = _group_blocks([_parse_block(body) for body in _server_blocks(text)])
        for group in groups:
            sites.append(_describe(group, path, pools, index, single=len(groups) == 1))
    return sites


def unmanaged():
    """The drift list: sites serving traffic that no application accounts for."""
    return [site for site in discover() if site['linked_app'] is None]


def find(identifier):
    """A discovered site by its id, vhost file name or any of its domains."""
    wanted = (identifier or '').strip().lower()
    if not wanted:
        return None
    for site in discover():
        candidates = {site['id'].lower(), os.path.basename(site['vhost_file']).lower()}
        candidates.update(domain.lower() for domain in site['domains'])
        if wanted in candidates:
            return site
    return None


# --------------------------------------------------------------------------
# Adopting
# --------------------------------------------------------------------------

def plan(site, name=None):
    """What adopting ``site`` would record, and what it would leave alone.
    Pure: this is the dry run, and `adopt` builds its rows from the same dict."""
    name = (name or site['suggested_name']).strip()
    php = site['php'] or {}
    wordpress = site['wordpress']
    return {
        'site': site['id'],
        'application': {
            'name': name,
            'app_type': site['app_type'],
            'managed_by': HOST_MANAGED,
            'source': 'manual',
            'root_path': site['root'],
            'php_version': php.get('version'),
        },
        'domains': [{
            'name': domain,
            'is_primary': position == 0,
            'ssl_enabled': site['ssl']['enabled'],
            'ssl_certificate_path': site['ssl']['certificate'],
            'ssl_key_path': site['ssl']['certificate_key'],
            'ssl_expires_at': site['ssl']['expires_at'],
        } for position, domain in enumerate(site['domains'])],
        'wordpress_site': ({
            'wp_version': wordpress.get('version'),
            'multisite': bool(wordpress.get('multisite')),
            'db_name': wordpress.get('db_name'),
            'db_user': wordpress.get('db_user'),
            'db_host': wordpress.get('db_host'),
            'db_prefix': wordpress.get('table_prefix'),
        } if wordpress and wordpress.get('readable') else None),
        'database': site['database'],
        # Named so the operator can see exactly what stays as it is.
        'untouched': [path for path in (site['vhost_file'], php.get('pool_file'),
                                        site['ssl']['certificate'],
                                        (wordpress or {}).get('config_file')) if path],
    }


def adopt(identifier, user, name=None, workspace_id=None):
    """Register a running site as an application. Writes rows, never config.

    Returns ``(application, plan)``. Raises :class:`SiteAdoptionError` when the
    site is unknown, already managed, or not something this flow adopts.
    """
    site = find(identifier)
    if site is None:
        raise SiteAdoptionError(
            f'No site served by host nginx matches "{identifier}".', status=404)
    if not site['adoptable']:
        raise SiteAdoptionError(site['reason'] or 'This site cannot be adopted.', status=409)

    todo = plan(site, name)
    app_name = todo['application']['name']
    if not app_name or len(app_name) < 2:
        raise SiteAdoptionError('Service name must be at least 2 characters.')
    # Not query_active: a tombstone keeps its name reserved so a restore from
    # the Recycle Bin can never collide with an app adopted in the meantime.
    clash = app_name_clash_error(Application.query.filter_by(name=app_name).first(), app_name)
    if clash:
        raise SiteAdoptionError(clash, status=409)

    if workspace_id is None:
        from app.services.workspace_service import WorkspaceService
        workspace_id = WorkspaceService.ensure_default_workspace().id

    application = Application(
        name=app_name,
        app_type=todo['application']['app_type'],
        # It is serving traffic right now; that is the whole premise.
        status='running',
        source='manual',
        managed_by=HOST_MANAGED,
        root_path=todo['application']['root_path'],
        php_version=todo['application']['php_version'],
        user_id=user.id,
        workspace_id=workspace_id,
    )
    db.session.add(application)
    db.session.flush()

    for row in todo['domains']:
        expires = row['ssl_expires_at']
        db.session.add(Domain(
            name=row['name'],
            is_primary=row['is_primary'],
            ssl_enabled=row['ssl_enabled'],
            ssl_certificate_path=row['ssl_certificate_path'],
            ssl_key_path=row['ssl_key_path'],
            ssl_expires_at=datetime.fromisoformat(expires) if expires else None,
            application_id=application.id,
        ))

    if todo['wordpress_site'] is not None:
        from app.models.wordpress_site import WordPressSite
        db.session.add(WordPressSite(application_id=application.id, **todo['wordpress_site']))

    db.session.commit()

    if todo['database'] is not None:
        _link_database(todo['database'], application)

    try:
        from app.services.audit_service import AuditService
        AuditService.log(action='app.adopt', user_id=user.id, target_type='application',
                         target_id=application.id,
                         details={'site': site['id'], 'domains': site['domains'],
                                  'vhost_file': site['vhost_file']})
    except Exception:  # audit is best-effort and never blocks the adoption
        logger.debug('site adoption: audit log failed', exc_info=True)

    return application, todo


def _link_database(database, application):
    """Point the site's database at the application, so Databases stops
    showing it as belonging to nothing. Best-effort: the site is adopted
    either way."""
    try:
        from app.services.managed_database_service import ManagedDatabaseService
        host, _, port = (database.get('host') or 'localhost').partition(':')
        ManagedDatabaseService.adopt(
            database['engine'], host or 'localhost', database['name'],
            port=int(port) if port.isdigit() else None,
            owner_application_id=application.id,
            workspace_id=application.workspace_id)
    except Exception as exc:
        logger.warning('site adoption: could not link database %s to %s: %s',
                       database.get('name'), application.name, exc)
