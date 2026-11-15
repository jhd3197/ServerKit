"""Shared subprocess stub kit (plan 75 §G7).

The suite stubs subprocess by hand, everywhere, and the shape of those stubs
is what entrenches the very duplication plan 75 exists to remove:

* ``_FakeProc(returncode, stdout, stderr)`` is pasted **byte-identical** in
  four test modules (plus variants elsewhere);
* ~25 ``def fake_run`` closures re-implement argv dispatch;
* **zero** of them patch ``run_privileged``/``run_unprivileged``. Every stub
  targets raw ``subprocess`` *inside one service module*, so each new service
  test recreates the raw seam instead of the wrapper seam — the 250-raw-call
  surface grows a test that pins it in place.

This module is the single seam. Tests script argv → result; when G1 migrates
services onto ``run_checked()`` the retarget happens **here**, once, instead of
in twelve test files.

Two properties are deliberate, and both come straight from plan 74's outage:

1. **An unscripted command is an error, never a success.** A stub that invents
   ``returncode=0`` for a command the test never described is the same defect
   as a blanket ``except`` reporting "not installed" — a fact nobody
   established. :class:`UnscriptedCommand` is a ``BaseException`` for the same
   reason :class:`popen_guard.SbinPathError` is: services wrap subprocess in
   ``except Exception`` and convert it to ``{'success': False}``, so an
   ``AssertionError`` here would be swallowed by exactly the handlers this kit
   is meant to test, and the test would see a plausible failure dict instead
   of "you forgot to script this".

2. **Stubbed execs are still sbin-guarded.** Patching ``subprocess`` removes
   the §B2 runtime guard for the duration of the test. The kit calls
   :func:`popen_guard.guard_argv` itself, so scripting a command does not buy
   an exemption from the PATH rule.

Usage::

    def test_reload(fake_subprocess):
        fake_subprocess.script(['systemctl', 'reload'], stdout='')
        fake_subprocess.script(['nginx', '-t'], returncode=1, stderr='bad')
        ...
        assert fake_subprocess.argv_for(['nginx']) == ['nginx', '-t']

Matching ignores the two things that legitimately vary at the door: a ``sudo``
prefix (``run_privileged`` adds one only when the process is not root) and
argv[0] absolutisation (``/usr/sbin/nginx`` vs ``nginx``). A test asserts on
the command, not on how the helper had to spell it today.
"""

import os
import subprocess

from popen_guard import guard_argv

_SUDO_FLAGS_WITH_VALUE = ('-u', '--user', '-g', '--group')


class UnscriptedCommand(BaseException):
    """A stubbed subprocess call the test never described.

    ``BaseException`` on purpose — see the module docstring. Do not "fix" this
    by making it an ``AssertionError``; a blanket ``except Exception`` in the
    service under test would eat it and the failure would surface as a
    confusing assertion about a result dict three layers away.
    """


class FakeProc:
    """``subprocess.CompletedProcess`` stand-in — the one every test shares.

    Carries the same attribute surface tests actually use (``returncode``,
    ``stdout``, ``stderr``, ``args``) plus ``check_returncode()`` so code under
    test that calls it behaves like the real thing.
    """

    def __init__(self, returncode=0, stdout='', stderr='', args=None):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        self.args = args

    def check_returncode(self):
        if self.returncode:
            raise subprocess.CalledProcessError(
                self.returncode, self.args, self.stdout, self.stderr)

    def __repr__(self):
        return (f'FakeProc(returncode={self.returncode!r}, '
                f'stdout={self.stdout!r}, stderr={self.stderr!r})')


class _Lines:
    """A pipe's line stream: iterable, and readable the way
    ``iter(stream.readline, '')`` reads it, which is how the streaming
    callers consume a live process."""

    def __init__(self, text):
        self._lines = iter(text.splitlines(keepends=True)) if text else iter(())

    def __iter__(self):
        return self

    def __next__(self):
        return next(self._lines)

    def readline(self):
        return next(self._lines, '')

    def close(self):
        pass


class FakePopen:
    """Minimal ``Popen`` stand-in over a :class:`FakeProc`.

    Separate type on purpose: a ``Popen``'s ``.stdout`` is an iterable of
    *lines* while a ``CompletedProcess``'s is a string, and one object cannot
    honestly be both — iterating a string yields characters, which is how a
    line-streaming test silently passes over nonsense.
    """

    def __init__(self, proc):
        self._proc = proc
        self.args = proc.args
        self.returncode = None
        self.stdout = _Lines(proc.stdout or '')
        self.stderr = _Lines('')

    def wait(self, timeout=None):
        self.returncode = self._proc.returncode
        return self.returncode

    def poll(self):
        return self.returncode

    def communicate(self, input=None, timeout=None):
        self.returncode = self._proc.returncode
        return self._proc.stdout, self._proc.stderr

    def kill(self):
        self.returncode = self._proc.returncode

    terminate = kill

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.wait()
        return False


def normalize_argv(argv):
    """argv as the *test* means it: no ``sudo`` prefix, argv[0] by basename.

    ``run_privileged`` prepends ``sudo -n`` only when the process is not root,
    and resolves argv[0] to an absolute path only when ``$PATH`` misses it.
    Both are correct, both vary by machine, and neither is what a test is
    asserting about. Normalising here is what lets one scripted rule match on
    a root box, a sudo box, and a dev box alike.
    """
    if isinstance(argv, (str, bytes)) or not argv:
        return []
    parts = [str(a) for a in argv]
    if os.path.basename(parts[0]) == 'sudo':
        parts = parts[1:]
        while parts and parts[0].startswith('-'):
            if parts[0] in _SUDO_FLAGS_WITH_VALUE:
                parts = parts[2:]
            elif parts[0] == '--':
                parts = parts[1:]
                break
            else:
                parts = parts[1:]
    if not parts:
        return []
    return [os.path.basename(parts[0])] + parts[1:]


class _Rule:
    def __init__(self, prefix, responder):
        self.prefix = list(prefix)
        self.responder = responder


class ScriptedSubprocess:
    """Scriptable ``subprocess`` replacement: argv prefix → result.

    Rules are matched **longest prefix first**, ties broken by most recently
    scripted. So a broad rule can be laid down first and narrowed later::

        fake.script(['docker'], stdout='')                  # default
        fake.script(['docker', 'inspect'], returncode=1)    # override
    """

    def __init__(self):
        self._rules = []
        self.calls = []  # [(argv, kwargs), ...] — every call, in order

    # ---- scripting -----------------------------------------------------
    def script(self, prefix, *, returncode=0, stdout='', stderr='',
               raises=None):
        """Answer any command starting with *prefix*.

        *raises* takes an exception instance or class and is raised instead of
        returning — this is how the §A probe-contract suites force
        ``FileNotFoundError`` / ``TimeoutExpired`` / ``PermissionError``
        without needing a machine that lacks the binary.
        """
        def responder(argv, kwargs):
            if raises is not None:
                raise raises() if isinstance(raises, type) else raises
            return FakeProc(returncode=returncode, stdout=stdout,
                            stderr=stderr, args=argv)

        return self.when(prefix, responder)

    def when(self, prefix, responder):
        """Answer *prefix* with ``responder(argv, kwargs) -> FakeProc``.

        The responder receives the **normalised** argv (no sudo prefix,
        argv[0] by basename) for the same reason matching uses it: a stub that
        emulates ``tee`` should not have to know whether the door decided to
        add ``sudo`` on this machine. The raw argv is still recorded, and
        :meth:`argv_for` hands it back.
        """
        self._rules.append(_Rule(normalize_argv(prefix), responder))
        return self

    # ---- the patched entry points --------------------------------------
    def run(self, cmd, *args, **kwargs):
        return self._dispatch(cmd, kwargs)

    def popen(self, cmd, *args, **kwargs):
        return FakePopen(self._dispatch(cmd, kwargs))

    def check_output(self, cmd, *args, **kwargs):
        proc = self._dispatch(cmd, kwargs)
        proc.check_returncode()
        return proc.stdout

    def call(self, cmd, *args, **kwargs):
        return self._dispatch(cmd, kwargs).returncode

    def check_call(self, cmd, *args, **kwargs):
        proc = self._dispatch(cmd, kwargs)
        proc.check_returncode()
        return 0

    def install(self, monkeypatch, module=subprocess):
        """Patch every exec entry point on *module* onto this script."""
        monkeypatch.setattr(module, 'run', self.run)
        monkeypatch.setattr(module, 'Popen', self.popen)
        monkeypatch.setattr(module, 'check_output', self.check_output)
        monkeypatch.setattr(module, 'call', self.call)
        monkeypatch.setattr(module, 'check_call', self.check_call)
        return self

    # ---- assertions ----------------------------------------------------
    def commands(self):
        """Every argv seen, normalised — the list to assert ordering on."""
        return [normalize_argv(argv) for argv, _ in self.calls]

    def argv_for(self, prefix):
        """The RAW argv of the first call matching *prefix*, or ``None``.

        Raw, not normalised: this is what a test asserting "the secret went to
        stdin and never onto the argv" needs to inspect.
        """
        wanted = normalize_argv(prefix)
        for argv, _ in self.calls:
            if self._matches(normalize_argv(argv), wanted):
                return argv
        return None

    def kwargs_for(self, prefix):
        """The kwargs of the first call matching *prefix*, or ``None``."""
        wanted = normalize_argv(prefix)
        for argv, kwargs in self.calls:
            if self._matches(normalize_argv(argv), wanted):
                return kwargs
        return None

    def writes(self):
        """``{path: content}`` for every privileged file write seen.

        ``write_privileged_file`` (plan 75 §G2) spells a write as
        ``tee [-a] <path>`` with the content on stdin, and three suites already
        rebuilt this dict by hand from their own stub. Reading it here means
        that when the door switches to a tmp-file + ``os.replace`` write, the
        assertions follow in one place instead of in each of them.
        """
        out = {}
        for raw, kwargs in self.calls:
            argv = normalize_argv(raw)
            if not argv or argv[0] != 'tee':
                continue
            path = argv[2] if len(argv) > 2 and argv[1] == '-a' else argv[1]
            content = kwargs.get('input', '')
            out[path] = out.get(path, '') + content if argv[1] == '-a' else content
        return out

    def ran(self, prefix):
        """True when at least one call matched *prefix*."""
        return self.argv_for(prefix) is not None

    # ---- internals ------------------------------------------------------
    @staticmethod
    def _matches(argv, prefix):
        return len(argv) >= len(prefix) and argv[:len(prefix)] == prefix

    def _dispatch(self, cmd, kwargs):
        guard_argv(cmd)
        self.calls.append((cmd, kwargs))
        argv = normalize_argv(cmd)
        best = None
        for rule in self._rules:
            if not self._matches(argv, rule.prefix):
                continue
            if best is None or len(rule.prefix) >= len(best.prefix):
                best = rule
        if best is None:
            raise UnscriptedCommand(
                f'no scripted result for {list(cmd)!r} (normalised {argv!r}).\n'
                f'  scripted: {[r.prefix for r in self._rules] or "nothing"}\n'
                'A stub that answered anyway would be inventing a fact the '
                'test never established — plan 74\'s bug class, in test form. '
                'Call fake_subprocess.script([...]) for this command.'
            )
        return best.responder(argv, kwargs)
