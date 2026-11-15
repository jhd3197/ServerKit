"""Pinned subnets for compose projects once Docker's address pools run out.

Every compose project gets its own bridge network, and Docker carves those out
of a fixed set of default pools: about thirty networks on a stock daemon. The
next ``compose up`` after that fails with "all predefined address pools have
been fully subnetted", which caps a host at roughly thirty stacks no matter how
much CPU, memory or disk is left.

An explicit ``ipam`` subnet does not come out of the default pools, so the
project that hit the limit is given a small subnet of its own and started
again. The pin is written into the project's base compose file rather than a
ServerKit override: any ``compose up`` that left the pin out would recreate the
network from the exhausted pools and take the stack down with it.
"""
import ipaddress
import logging
import os
import tempfile
import threading
import time

import yaml

logger = logging.getLogger(__name__)

POOL_ENV = 'SERVERKIT_COMPOSE_SUBNET_POOL'
DEFAULT_POOL = '10.213.0.0/16'
# 62 addresses: room for the largest bundled templates, 1024 projects per /16.
SUBNET_PREFIX = 26

_EXHAUSTED = (
    'all predefined address pools have been fully subnetted',
    'could not find an available, non-overlapping ipv4 address pool',
)
_OVERLAP = 'pool overlaps with other one on this address space'

# A subnet handed out here is not visible to `docker network inspect` until the
# retried `compose up` creates the network, so two deploys racing each other
# would be given the same one. Remember recent grants for that window.
_RECENT_TTL = 600
_recent = {}
_lock = threading.Lock()


def needs_pinned_subnet(text):
    """True when compose output says the project's network needs a pinned subnet."""
    lowered = (text or '').lower()
    return _OVERLAP in lowered or any(marker in lowered for marker in _EXHAUSTED)


def _pool():
    raw = os.environ.get(POOL_ENV) or DEFAULT_POOL
    try:
        pool = ipaddress.ip_network(raw, strict=False)
        if pool.version == 4 and pool.prefixlen <= SUBNET_PREFIX:
            return pool
        logger.warning('%s=%s is not an IPv4 network of /%s or larger; using %s',
                       POOL_ENV, raw, SUBNET_PREFIX, DEFAULT_POOL)
    except ValueError:
        logger.warning('%s=%s is not a network; using %s', POOL_ENV, raw, DEFAULT_POOL)
    return ipaddress.ip_network(DEFAULT_POOL)


def _docker_subnets():
    """Subnets of every network the daemon knows about."""
    from app.services.docker_service import DockerService
    listed = DockerService.run(['network', 'ls', '-q'])
    ids = (listed.get('output') or '').split()
    if not listed.get('success') or not ids:
        return []
    inspected = DockerService.run(
        ['network', 'inspect', '--format', '{{range .IPAM.Config}}{{.Subnet}} {{end}}', *ids])
    return (inspected.get('output') or '').split()


def _host_addresses():
    """The host's own IPv4 addresses, so a pin never lands on a live interface."""
    try:
        import psutil
        return [addr.address for addrs in psutil.net_if_addrs().values()
                for addr in addrs if getattr(addr.family, 'name', '') == 'AF_INET']
    except Exception as exc:  # noqa: BLE001 - a missing probe must not block the pin
        logger.debug('host address probe failed: %s', exc)
        return []


def _taken():
    taken = []
    for raw in [*_docker_subnets(), *_host_addresses()]:
        try:
            taken.append(ipaddress.ip_network(raw, strict=False))
        except ValueError:
            continue
    now = time.monotonic()
    for subnet, granted in list(_recent.items()):
        if now - granted > _RECENT_TTL:
            del _recent[subnet]
        else:
            taken.append(subnet)
    return [net for net in taken if net.version == 4]


def _allocate(count):
    """``count`` free subnets from the pool, or fewer if it is nearly full."""
    taken = _taken()
    granted = []
    for candidate in _pool().subnets(new_prefix=SUBNET_PREFIX):
        if len(granted) == count:
            break
        if any(candidate.overlaps(net) for net in taken):
            continue
        granted.append(candidate)
        _recent[candidate] = time.monotonic()
    return granted


def _ours(spec):
    """True when a network's subnets were all pinned from our pool."""
    config = ((spec or {}).get('ipam') or {}).get('config') or []
    subnets = [entry.get('subnet') for entry in config if isinstance(entry, dict)]
    if not subnets or not all(subnets):
        return False
    pool = _pool()
    try:
        return all(ipaddress.ip_network(s, strict=False).subnet_of(pool) for s in subnets)
    except (ValueError, TypeError):
        return False


def _networks_to_pin(config, repin):
    """Names of the project's own bridge networks that draw on the default pools.

    ``repin`` also returns networks already pinned from our pool: a copied
    project carries its source's subnet, which the daemon rejects as an overlap.
    A subnet somebody chose themselves is never touched.
    """
    services = config.get('services') or {}
    networks = config.get('networks') or {}
    names = []
    # A service that names no network (and has no network_mode) joins the
    # implicit `default` one, which exists even when the file never declares it.
    implicit_default = any(
        isinstance(svc, dict) and not svc.get('network_mode')
        and (not svc.get('networks') or 'default' in svc['networks'])
        for svc in services.values())
    if implicit_default and 'default' not in networks:
        names.append('default')
    for name, spec in networks.items():
        spec = spec or {}
        if not isinstance(spec, dict) or spec.get('external'):
            continue
        if spec.get('driver') not in (None, 'bridge'):
            continue
        has_subnet = bool((spec.get('ipam') or {}).get('config'))
        if not has_subnet or (repin and _ours(spec)):
            names.append(name)
    return names


def _replace(path, content):
    """Same-directory atomic replacement; never leave a half-written compose."""
    directory = os.path.dirname(path)
    fd, temporary = tempfile.mkstemp(dir=directory, prefix='.network-pin-')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            stream.write(content)
        if os.name != 'nt':
            os.chmod(temporary, os.stat(path).st_mode & 0o777)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def pin_project_subnets(project_path, compose_file=None, error_text=''):
    """Give a compose project's networks subnets outside Docker's default pools.

    Returns ``{'success': bool, 'pinned': {network: subnet}, 'error': str|None}``.
    Never raises: this runs on a deploy's failure path, where a second
    exception would bury the daemon's own message.
    """
    try:
        with _lock:
            return _pin(project_path, compose_file, error_text)
    except Exception as exc:  # noqa: BLE001 - see docstring
        logger.warning('could not pin compose subnets for %s: %s', project_path, exc)
        return {'success': False, 'pinned': {}, 'error': str(exc)}


def _pin(project_path, compose_file, error_text):
    from app.services.compose_env_service import ComposeEnvService
    base = ComposeEnvService.find_base_compose(project_path, compose_file)
    if not base:
        return {'success': False, 'pinned': {}, 'error': 'no compose file found'}
    path = base if os.path.isabs(base) else os.path.join(project_path, base)
    with open(path, 'r', encoding='utf-8') as stream:
        original = stream.read()
    config = yaml.safe_load(original) or {}
    if not isinstance(config, dict):
        return {'success': False, 'pinned': {}, 'error': 'compose file is not a mapping'}

    names = _networks_to_pin(config, repin=_OVERLAP in (error_text or '').lower())
    if not names:
        return {'success': False, 'pinned': {},
                'error': 'no project network draws on the default address pools'}
    subnets = _allocate(len(names))
    if len(subnets) < len(names):
        return {'success': False, 'pinned': {},
                'error': f'subnet pool {_pool()} is full; set {POOL_ENV} to a larger network'}
    pinned = {name: str(subnet) for name, subnet in zip(names, subnets)}

    if 'networks' not in config:
        # The common shape (one implicit network): append, so the rest of the
        # file keeps its comments and formatting.
        block = yaml.safe_dump(
            {'networks': {name: {'ipam': {'config': [{'subnet': subnet}]}}
                          for name, subnet in pinned.items()}},
            default_flow_style=False, sort_keys=False)
        content = (original.rstrip('\n') + '\n\n'
                   "# Pinned by ServerKit: Docker's default address pools were full.\n"
                   + block)
    else:
        networks = config['networks'] or {}
        for name, subnet in pinned.items():
            spec = networks.get(name) or {}
            spec['ipam'] = {**(spec.get('ipam') or {}), 'config': [{'subnet': subnet}]}
            networks[name] = spec
        config['networks'] = networks
        content = yaml.safe_dump(config, default_flow_style=False, sort_keys=False)
    _replace(path, content)
    logger.info('pinned compose subnets for %s: %s', project_path, pinned)
    return {'success': True, 'pinned': pinned, 'error': None}
