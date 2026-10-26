"""Centralized system utilities for subprocess handling.

Provides consistent privilege escalation, distro detection, package management,
and systemd service control so individual services don't need to reinvent these.
"""

import os
import shutil
import subprocess
from typing import List, Optional, Union


def _needs_sudo() -> bool:
    """Return True if the current process should prepend sudo to commands.

    Returns False when:
    - Running on Windows (no sudo concept; dev environment)
    - Already running as root (e.g. inside Docker)
    - ``sudo`` is not installed (minimal containers)
    """
    if os.name == 'nt':
        return False
    if os.geteuid() == 0:
        return False
    if not shutil.which('sudo'):
        return False
    return True


def privileged_cmd(cmd: Union[List[str], str], *, user: Optional[str] = None) -> Union[List[str], str]:
    """Return *cmd* with ``sudo`` prepended when necessary.

    Use this when you need the command list for ``Popen`` or other non-``run``
    callers.  For simple ``subprocess.run`` calls prefer :func:`run_privileged`.

    Pass *user* to run the command as a specific user (``sudo -u <user>``).

    .. warning::

       *user* is only correct for privilege ESCALATION, not for identity
       SWITCHING. When :func:`_needs_sudo` is False — most importantly when the
       process is already root — the whole ``sudo -n -u <user>`` prefix is
       dropped and the command runs as the current user, not as *user*.

       That is right for "give me root, I am not root"; it is wrong for
       "run this as postgres". ``database_service`` needs the second, because
       PostgreSQL's local peer auth maps the OS user to the DB role, so a root
       panel silently connecting as role ``root`` fails authentication. Its
       five ``psql``/``pg_dump`` sites therefore spell ``sudo -u postgres``
       out themselves and go through :func:`run_checked` unprivileged.

       *user* currently has no callers. Before giving it one, decide what
       should happen as root — ``runuser``/``su`` rather than dropping the
       switch — and test it on a root install.

    ``sudo -n`` (non-interactive) is always used: nothing here runs attached to a
    human terminal, and callers capture output, so a password prompt would be
    invisible AND unanswerable — sudo would simply block forever, hanging the
    caller (this hung backend startup on a non-root host, via the metadata
    guard's iptables probe). Failing immediately with a non-zero exit is the
    only useful outcome, and every caller already handles that.
    """
    if isinstance(cmd, str):
        if _needs_sudo() and not cmd.lstrip().startswith('sudo '):
            if user:
                return f'sudo -n -u {user} {cmd}'
            return f'sudo -n {cmd}'
        return cmd

    cmd = list(cmd)

    # Give argv[0] an absolute path ONLY when $PATH cannot resolve it. subprocess
    # searches $PATH and nothing else, so a tool that exists but sits outside it
    # raises FileNotFoundError — which callers wrapping the probe in a broad
    # `except` then report as "not installed". This is how a successfully
    # installed ufw (in /usr/sbin, absent from the unit's PATH) surfaced in the
    # panel as "No Firewall Installed". Left untouched when $PATH already works,
    # so a resolvable command is passed through exactly as the caller wrote it.
    if cmd and cmd[0] != 'sudo' and not os.path.isabs(cmd[0]) and not shutil.which(cmd[0]):
        resolved = resolve_command(cmd[0])
        if resolved:
            cmd[0] = resolved

    if _needs_sudo() and cmd[0] != 'sudo':
        if user:
            return ['sudo', '-n', '-u', user] + cmd
        return ['sudo', '-n'] + cmd
    return cmd


# Ceiling for a privileged command that does not name its own. Generous enough
# for the slow-but-legitimate work that runs through here (package installs,
# image pulls), while guaranteeing no single call can wedge a worker forever.
# Anything genuinely longer must say so explicitly with `timeout=`.
DEFAULT_PRIVILEGED_TIMEOUT = 300

# Read-only status probes (is this package installed, is this unit active).
# They answer immediately or not at all, so they get a much tighter ceiling.
PROBE_TIMEOUT = 30


def run_privileged(cmd: Union[List[str], str], *, user: Optional[str] = None, **kwargs) -> subprocess.CompletedProcess:
    """Run a command with sudo if the current process is not root.

    Prepends ``sudo`` only when needed (not root, not Windows, sudo exists).
    Pass *user* to run the command as a specific user (``sudo -u <user>``).
    Defaults to ``capture_output=True, text=True`` but callers can override.

    A default ``timeout`` is applied when the caller does not give one: with
    output captured and no terminal, a command that never returns takes its
    caller with it silently and forever. ``TimeoutExpired`` is a far better
    outcome than a wedged request or a boot that never finishes — pass
    ``timeout=None`` to opt out deliberately.

    Returns the raw ``CompletedProcess`` so services keep their existing
    error-handling patterns.
    """
    cmd = privileged_cmd(cmd, user=user)
    kwargs.setdefault('capture_output', True)
    kwargs.setdefault('text', True)
    kwargs.setdefault('timeout', DEFAULT_PRIVILEGED_TIMEOUT)
    return subprocess.run(cmd, **kwargs)


def run_unprivileged(cmd: Union[List[str], str], *, timeout: int = 60,
                     capture_stderr: bool = False, **kwargs) -> dict:
    """Run a command WITHOUT privilege escalation; dict with stdout/stderr/rc.

    Named for what it does not do. It was called ``run_command`` — a name that
    described nothing and sat one autocomplete away from
    :func:`run_privileged`, so ``nginx -t`` went through it and could neither
    read root-owned config nor find /usr/sbin/nginx. The caller reported every
    config as invalid. ``run_unprivileged(['nginx', '-t'])`` reads as obviously
    wrong; ``run_command(['nginx', '-t'])`` did not.

    The old name was also ambiguous across the codebase: ``PythonService`` has
    an unrelated method of the same name.

    Use :func:`run_privileged` unless the command genuinely must not gain root.
    That is the common case — this helper has a handful of callers and they are
    all reads that work fine as the invoking user.
    """
    # Same argv[0] resolution as privileged_cmd: this helper does no privilege
    # escalation, so nothing else would find a command outside $PATH. Without
    # it `run_unprivileged(['nginx', '-t'])` raised FileNotFoundError on every
    # root install (nginx is /usr/sbin/nginx). Only applied when $PATH
    # genuinely misses the command.
    if isinstance(cmd, (list, tuple)):
        cmd = list(cmd)
        if cmd and cmd[0] != 'sudo' and not os.path.isabs(cmd[0]) and not shutil.which(cmd[0]):
            resolved = resolve_command(cmd[0])
            if resolved:
                cmd[0] = resolved

    kwargs.setdefault('capture_output', True)
    kwargs.setdefault('text', True)
    result = subprocess.run(cmd, timeout=timeout, **kwargs)
    return {
        'stdout': result.stdout or '',
        'stderr': result.stderr or '',
        'returncode': result.returncode,
    }


def run_checked(cmd: Union[List[str], str], *, privileged: bool = False,
                timeout: Optional[int] = 60, input: Optional[str] = None,
                cwd: Optional[str] = None, env: Optional[dict] = None,
                merge_stderr: bool = False, **kwargs) -> dict:
    """Run a command and get a result, not a ``CompletedProcess``.

    Use this instead of raw ``subprocess``: hand-rolled exec handling is
    where a failure to run gets reported as a fact about the server.

    Returns::

        {'success': bool, 'output': str, 'stderr': str,
         'error': str|None, 'returncode': int|None}

    ``returncode`` is ``None`` when the command never ran, which is the
    distinction the hand-rolled handlers keep losing: exit code 1 means the
    command answered "no", while no exit code at all means nobody answered.
    A caller that renders "not installed" must check ``returncode is not None``
    first, and now it can.

    ``stderr`` is the raw stream; ``error`` is the verdict — a human-facing
    message, ``None`` on success. They are separate because plenty of commands
    write to stderr and still succeed (``docker exec``, ``git``), so folding
    the stream into the verdict would invent failures. Callers that show
    command output want ``stderr``; callers that report a problem want
    ``error``.

    ``merge_stderr=True`` interleaves stderr into ``output`` the way a terminal
    would (``stderr=STDOUT``). ``docker logs`` needs it — a container's stderr
    is part of its log, not an error about fetching the log — and hand-rolled
    ``result.stdout + result.stderr`` concatenation is not the same thing: it
    loses the ordering.

    ``privileged=True`` routes through :func:`run_privileged` — same sudo-vs-root
    decision, same argv[0] resolution, so no caller re-implements either.

    ``timeout`` defaults to 60s rather than ``None`` on purpose: with output
    captured and no terminal, a command that never returns takes its caller
    with it, silently and forever. Pass ``timeout=None`` to opt out
    deliberately.
    """
    if input is not None:
        kwargs['input'] = input
    if cwd is not None:
        kwargs['cwd'] = cwd
    if env is not None:
        kwargs['env'] = env
    if merge_stderr:
        # capture_output and an explicit stderr= are mutually exclusive.
        kwargs.setdefault('stdout', subprocess.PIPE)
        kwargs.setdefault('stderr', subprocess.STDOUT)
    elif 'stdout' not in kwargs and 'stderr' not in kwargs:
        kwargs.setdefault('capture_output', True)
    # else: the caller is directing the streams itself (writing straight to a
    # log file, say). Adding capture_output on top would raise ValueError, and
    # silently overriding their redirect would throw the output away.
    kwargs.setdefault('text', True)

    try:
        if privileged:
            result = run_privileged(cmd, timeout=timeout, **kwargs)
        else:
            resolved = cmd
            if isinstance(cmd, (list, tuple)):
                resolved = list(cmd)
                if (resolved and not os.path.isabs(resolved[0])
                        and not shutil.which(resolved[0])):
                    # Same argv[0] resolution privileged_cmd does: a bare name
                    # that $PATH cannot find is the sbin outage, not a missing
                    # binary. Only applied when $PATH genuinely misses it.
                    absolute = resolve_command(resolved[0])
                    if absolute:
                        resolved[0] = absolute
            result = subprocess.run(resolved, timeout=timeout, **kwargs)
    except FileNotFoundError as exc:
        name = cmd[0] if isinstance(cmd, (list, tuple)) and cmd else cmd
        return _never_ran(f'{name} not found: {exc}')
    except subprocess.TimeoutExpired:
        return _never_ran(f'timed out after {timeout}s')
    except PermissionError as exc:
        return _never_ran(f'permission denied: {exc}')
    except OSError as exc:
        return _never_ran(str(exc))

    stderr = result.stderr or ''
    return {
        'success': result.returncode == 0,
        'output': result.stdout or '',
        'stderr': stderr,
        'returncode': result.returncode,
        'error': (stderr.strip() or f'command failed (exit {result.returncode})')
                 if result.returncode != 0 else None,
    }


def _never_ran(error: str) -> dict:
    """The result shape for a command that never produced an exit code.

    ``returncode is None`` is the whole point — see :func:`run_checked`.
    """
    return {'success': False, 'output': '', 'stderr': '',
            'returncode': None, 'error': error}


_PANEL_SECRET_ENV = frozenset({
    'SECRET_KEY', 'JWT_SECRET_KEY', 'DATABASE_URL', 'TEST_DATABASE_URL',
    'PROMETHEUS_TOKEN',
})


def app_process_env(extra: Optional[dict] = None) -> dict:
    """The environment for code the panel runs on an app's behalf — build
    commands, deploy and template scripts — without the panel's own secrets.

    Those scripts come from repositories and registries, not from the panel,
    and ``os.environ.copy()`` handed them the JWT signing key, the session
    key, the database URL and every SERVERKIT_* credential.
    """
    env = {k: v for k, v in os.environ.items()
           if k not in _PANEL_SECRET_ENV
           and not k.startswith('SERVERKIT_')
           and not k.endswith('_CLIENT_SECRET')}
    if extra:
        env.update(extra)
    return env


_CHUNK = 1024 * 1024


def _streamed(cmd: List[str], pump, *, env: Optional[dict], timeout: Optional[int],
              **popen_kwargs) -> dict:
    """Run *cmd* while *pump(proc)* moves bytes through its pipes.

    A ``gzip.open()`` handle can't be passed as ``stdin=``/``stdout=``: the
    child gets the underlying fd and reads or writes the compressed bytes
    raw. So the bytes are pumped through Python instead. stderr goes to a
    temp file so a chatty child can't fill a pipe and deadlock the pump.
    """
    import tempfile
    try:
        with tempfile.TemporaryFile() as err:
            proc = subprocess.Popen(cmd, stderr=err, env=env, **popen_kwargs)
            try:
                pump(proc)
            except BrokenPipeError:
                pass  # the child exited early; its exit code says why
            except BaseException:
                proc.kill()
                proc.wait()
                raise
            try:
                proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
                return _never_ran(f'timed out after {timeout}s')
            err.seek(0)
            stderr = err.read().decode('utf-8', 'replace')
    except FileNotFoundError as exc:
        return _never_ran(f'{cmd[0]} not found: {exc}')
    except OSError as exc:
        return _never_ran(str(exc))
    return {
        'success': proc.returncode == 0,
        'output': '',
        'stderr': stderr,
        'returncode': proc.returncode,
        'error': (stderr.strip() or f'command failed (exit {proc.returncode})')
                 if proc.returncode != 0 else None,
    }


def secret_env(**secrets) -> dict:
    """This process's environment plus *secrets*, for passing a password to a
    child (MYSQL_PWD, PGPASSWORD) without putting it on the command line,
    where every local account can read it from ps or /proc/<pid>/cmdline.
    For ``docker exec``/``docker compose exec`` name the variable bare
    (``-e MYSQL_PWD``) so docker copies the value from this environment."""
    return {**os.environ, **{k: v for k, v in secrets.items() if v}}


def run_to_gzip(cmd: List[str], dest: str, *, env: Optional[dict] = None,
                timeout: Optional[int] = None) -> dict:
    """Run *cmd* and gzip its stdout into *dest*; *dest* is removed on failure."""
    import gzip

    def pump(proc):
        with gzip.open(dest, 'wb') as out:
            shutil.copyfileobj(proc.stdout, out, _CHUNK)
        proc.stdout.close()

    result = _streamed(cmd, pump, env=env, timeout=timeout, stdout=subprocess.PIPE)
    if not result['success'] and os.path.exists(dest):
        os.remove(dest)
    return result


def run_from_gzip(cmd: List[str], src: str, *, env: Optional[dict] = None,
                  timeout: Optional[int] = None) -> dict:
    """Run *cmd* with the decompressed contents of *src* on its stdin."""
    import gzip

    def pump(proc):
        try:
            with gzip.open(src, 'rb') as data:
                shutil.copyfileobj(data, proc.stdin, _CHUNK)
        finally:
            proc.stdin.close()

    return _streamed(cmd, pump, env=env, timeout=timeout,
                     stdin=subprocess.PIPE, stdout=subprocess.DEVNULL)


def write_privileged_file(path: str, content: str, *, append: bool = False,
                          mode: Optional[str] = None,
                          owner: Optional[str] = None) -> dict:
    """Write *content* to *path* with privilege escalation. One door.

    The write-a-root-owned-file sequence was pasted at 15+ call sites in **two
    competing forms**: ``run_privileged(['tee', path], input=content)`` and a
    raw ``subprocess.run(['sudo', 'tee', path], ...)``. The second form is the
    drift this plan exists to remove — it hardcodes ``sudo`` instead of asking
    :func:`_needs_sudo`, so it fails on a panel already running as root (no
    sudo binary in a minimal container) exactly the way a past outage did.

    Returns a result dict rather than a ``CompletedProcess`` because every one
    of those call sites immediately converted one into the other:

        {'success': bool, 'path': str, 'error': str}   # 'error' only on failure

    ``success`` is never True on a write that did not demonstrably happen — a
    ``FileNotFoundError`` (no ``tee``) or a timeout reports the failure instead
    of being swallowed into a cheerful return (probe honesty).

    *mode* and *owner* are applied after the write (``chmod`` / ``chown``); a
    failure there is reported, because a config written with the wrong
    ownership is not a config that works.

    Still ``tee`` under the hood, deliberately: this change is a collapse, not
    a behaviour change. Having one door is what makes a later atomic write
    (tmp + ``os.replace``) a single edit instead of fifteen.
    """
    argv = ['tee', '-a', path] if append else ['tee', path]
    try:
        result = run_privileged(argv, input=content)
    except FileNotFoundError:
        return {'success': False, 'path': path,
                'error': "'tee' not found - cannot write privileged file"}
    except subprocess.TimeoutExpired:
        return {'success': False, 'path': path,
                'error': f'timed out writing {path}'}
    except Exception as exc:  # noqa: BLE001 - reported, never converted to success
        return {'success': False, 'path': path, 'error': str(exc)}

    if result.returncode != 0:
        return {'success': False, 'path': path,
                'error': (result.stderr or f'failed to write {path}').strip()}

    follow_ups = ([['chmod', mode, path]] if mode else []) + \
                 ([['chown', owner, path]] if owner else [])
    for step_argv in follow_ups:
        try:
            step = run_privileged(step_argv)
        except Exception as exc:  # noqa: BLE001
            return {'success': False, 'path': path, 'error': str(exc)}
        if step.returncode != 0:
            return {'success': False, 'path': path,
                    'error': (step.stderr or f'{step_argv[0]} failed on {path}').strip()}

    return {'success': True, 'path': path}


# Searched when ``$PATH`` does not resolve a command. Ordered the way a login
# shell would. ``/usr/sbin`` and ``/sbin`` matter most: the panel's systemd unit
# ships a PATH of venv:/usr/local/bin:/usr/bin:/bin, so every sbin-resident tool
# (ufw, iptables, nft) is unreachable by bare name from the service. ``/snap/bin``
# is included because snap is the recommended install route for certbot and is
# almost never on a service's PATH.
_COMMAND_SEARCH_DIRS = ('/usr/local/sbin', '/usr/local/bin', '/usr/sbin',
                        '/usr/bin', '/sbin', '/bin', '/snap/bin')


def unit_is_active(unit: str, *, timeout: int = 10) -> Optional[bool]:
    """Tri-state systemd unit probe: ``True``, ``False``, or ``None``.

    ``None`` means *could not determine* — no systemctl, no systemd, a probe
    that timed out — and is deliberately not ``False``. The five hand-rolled
    copies of this ``systemctl is-active`` call all collapsed those cases into
    "not running", which is how a working service gets reported as down on a
    host the panel simply could not ask (the same outage, one layer up).

    Callers that genuinely want two states write ``unit_is_active(u) is True``
    and are then saying so out loud.
    """
    try:
        result = subprocess.run(
            ['systemctl', 'is-active', unit],
            capture_output=True, text=True, timeout=timeout,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return None
    # systemctl prints one word: active / inactive / failed / unknown. An empty
    # stdout means it answered nothing useful, which is not the same as "no".
    answer = (result.stdout or '').strip()
    if not answer:
        return None
    return answer == 'active'


def resolve_command(cmd: str) -> Optional[str]:
    """Absolute path to *cmd*, or None when it cannot be found anywhere.

    ``shutil.which`` first, then :data:`_COMMAND_SEARCH_DIRS`. Knowing a command
    exists is not enough to run it: ``subprocess`` resolves argv[0] through
    ``$PATH`` alone and raises ``FileNotFoundError`` when that misses, so a
    caller that only checked availability would still fail to exec.
    """
    if os.path.isabs(cmd):
        return cmd if os.path.exists(cmd) else None

    found = shutil.which(cmd)
    if found:
        return found

    for directory in _COMMAND_SEARCH_DIRS:
        candidate = os.path.join(directory, cmd)
        if os.path.exists(candidate):
            return candidate

    return None


def is_command_available(cmd: str) -> bool:
    """Check whether *cmd* is available on the system.

    Uses ``shutil.which`` first, then falls back to the same sbin/local paths
    :func:`resolve_command` searches — so "available" and "runnable" can never
    disagree.
    """
    return resolve_command(cmd) is not None


def sourced_result(lines: list, source: str, source_label: str) -> dict:
    """Standard response shape for multi-source data endpoints.

    Every fallback-chain endpoint should return this shape so the frontend
    can show a consistent source-aware banner.
    """
    return {
        'success': True,
        'lines': lines,
        'count': len(lines),
        'source': source,
        'source_label': source_label,
    }


class PackageManager:
    """Cross-distro package management helpers.

    Detects ``apt``, ``dnf``, or ``yum`` once and caches the result.
    """

    _detected: Optional[str] = None
    _detection_done: bool = False

    @classmethod
    def detect(cls) -> Optional[str]:
        """Return ``'apt'``, ``'dnf'``, ``'yum'``, or ``None``."""
        if cls._detection_done:
            return cls._detected

        for manager in ('apt', 'dnf', 'yum'):
            if shutil.which(manager):
                cls._detected = manager
                cls._detection_done = True
                return cls._detected

        cls._detection_done = True
        return cls._detected

    @classmethod
    def is_available(cls) -> bool:
        """Return ``True`` if any supported package manager was found."""
        return cls.detect() is not None

    @classmethod
    def is_installed(cls, package: str) -> bool:
        """Check whether *package* is installed (cross-distro).

        Uses ``dpkg -s`` on apt systems and ``rpm -q`` on dnf/yum systems.
        Catches ``FileNotFoundError`` so it works on any distro.
        """
        manager = cls.detect()

        if manager == 'apt':
            try:
                result = subprocess.run(
                    ['dpkg', '-s', package],
                    capture_output=True, text=True, timeout=PROBE_TIMEOUT,
                )
                return (
                    result.returncode == 0
                    and 'Status: install ok installed' in result.stdout
                )
            except FileNotFoundError:
                return False

        if manager in ('dnf', 'yum'):
            try:
                result = subprocess.run(
                    ['rpm', '-q', package],
                    capture_output=True, text=True, timeout=PROBE_TIMEOUT,
                )
                return result.returncode == 0
            except FileNotFoundError:
                return False

        return False

    @classmethod
    def install(cls, packages: Union[str, List[str]], timeout: int = 300) -> subprocess.CompletedProcess:
        """Install one or more packages (cross-distro).

        Raises ``RuntimeError`` when no supported package manager is found.
        """
        manager = cls.detect()
        if manager is None:
            raise RuntimeError('No supported package manager found (apt/dnf/yum)')

        if isinstance(packages, str):
            packages = [packages]

        cmd = [manager, 'install', '-y'] + packages
        return run_privileged(cmd, timeout=timeout)

    @classmethod
    def reset_cache(cls) -> None:
        """Reset the cached detection (useful in tests)."""
        cls._detected = None
        cls._detection_done = False


class ServiceControl:
    """Thin wrappers around ``systemctl`` that use :func:`run_privileged`."""

    @staticmethod
    def start(service: str, **kwargs) -> subprocess.CompletedProcess:
        return run_privileged(['systemctl', 'start', service], **kwargs)

    @staticmethod
    def stop(service: str, **kwargs) -> subprocess.CompletedProcess:
        return run_privileged(['systemctl', 'stop', service], **kwargs)

    @staticmethod
    def restart(service: str, **kwargs) -> subprocess.CompletedProcess:
        return run_privileged(['systemctl', 'restart', service], **kwargs)

    @staticmethod
    def reload(service: str, **kwargs) -> subprocess.CompletedProcess:
        return run_privileged(['systemctl', 'reload', service], **kwargs)

    @staticmethod
    def enable(service: str, **kwargs) -> subprocess.CompletedProcess:
        return run_privileged(['systemctl', 'enable', service], **kwargs)

    @staticmethod
    def disable(service: str, **kwargs) -> subprocess.CompletedProcess:
        return run_privileged(['systemctl', 'disable', service], **kwargs)

    @staticmethod
    def daemon_reload(**kwargs) -> subprocess.CompletedProcess:
        return run_privileged(['systemctl', 'daemon-reload'], **kwargs)

    @staticmethod
    def result_dict(proc, ok_message, error_key='error',
                    fallback='Operation failed'):
        """CompletedProcess → the service-dict shape every *Service returns.

        The translation was re-implemented per service with subtly divergent
        failure shapes ('error' vs 'message' carrying stderr); keep the key
        and fallback parametrized so converting a site is parity, not a
        contract change.
        """
        if proc.returncode == 0:
            return {'success': True, 'message': ok_message}
        return {'success': False, error_key: proc.stderr or fallback}

    @staticmethod
    def is_active(service: str) -> bool:
        """Return ``True`` when the service is active.  No sudo needed.

        Raises ``FileNotFoundError`` when ``systemctl`` itself is missing: a
        host without systemd is "could not check", not "not running" — the
        doctor converts that to a warn row, and swallowing it here made every
        such host read as a repairable failure. Callers that want the old
        leniency guard their own call (php/postfix/security services do).
        """
        result = subprocess.run(
            ['systemctl', 'is-active', service],
            capture_output=True, text=True, timeout=PROBE_TIMEOUT,
        )
        return result.stdout.strip() == 'active'

    @staticmethod
    def is_enabled(service: str) -> bool:
        """Return ``True`` when the service is enabled.  No sudo needed."""
        try:
            result = subprocess.run(
                ['systemctl', 'is-enabled', service],
                capture_output=True, text=True, timeout=PROBE_TIMEOUT,
            )
            return result.stdout.strip() == 'enabled'
        except FileNotFoundError:
            return False
