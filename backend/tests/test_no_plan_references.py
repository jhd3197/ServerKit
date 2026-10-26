"""App code must not cite internal plan numbers.

Plans live in a git-ignored folder, so "(plan 29 #9)" in a comment points
at nothing for anyone but its author — 680 of them had piled up, and one
reached users in a bottleneck hint. Say what the code does and why; the
history belongs in the commit message.

The pre-commit hook runs this file directly (``--staged``) so a citation is
caught at commit time, on any file type, instead of in a CI shard minutes
after the push.
"""
import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ROOTS = ['backend/app', 'frontend/src', 'builtin-extensions']
PLAN_REF = re.compile(r'\bplan[- ]?\d{2}\b', re.IGNORECASE)
# The same citation wrapped across lines: "(plan" then "#   86 ...".
SPLIT_REF = re.compile(r'\(plan\s*\n\s*(?:#|//|\*)?\s*\d{2}\b', re.IGNORECASE)
# A bare section sign cites a plan section; one next to a real document
# name (``docs/REDESIGN_MAP.md §3``) is fine.
SECTION_REF = re.compile(r'^(?!.*(?:\.md\b|REDESIGN_MAP)).*§', re.MULTILINE)

# A vendored, signed registry index: its text is not ours to edit.
EXCLUDED = {'backend/app/data/registry_index.json'}
# Files with references still to remove, at their current count. The count
# may only go down; delete an entry once its file is clean.
PENDING = {
    'backend/app/services/deployment_job_service.py': 5,
}


def _tracked():
    out = subprocess.run(['git', 'ls-files', '-z', '--', *ROOTS], cwd=REPO,
                         capture_output=True, check=True).stdout
    return [p for p in out.decode().split('\0') if p and p not in EXCLUDED]


def _hits(text):
    return (len(PLAN_REF.findall(text)) + len(SPLIT_REF.findall(text))
            + len(SECTION_REF.findall(text)))


def _counts():
    found = {}
    for rel in _tracked():
        try:
            text = (REPO / rel).read_text(encoding='utf-8')
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        hits = _hits(text)
        if hits:
            found[rel] = hits
    return found


def _staged_counts():
    """Hits in the staged (index) version of each staged file under ROOTS."""
    out = subprocess.run(['git', 'diff', '--cached', '--name-only', '-z',
                          '--diff-filter=ACMR', '--', *ROOTS], cwd=REPO,
                         capture_output=True, check=True).stdout
    found = {}
    for rel in out.decode().split('\0'):
        if not rel or rel in EXCLUDED:
            continue
        blob = subprocess.run(['git', 'show', f':{rel}'], cwd=REPO,
                              capture_output=True, check=True).stdout
        try:
            hits = _hits(blob.decode('utf-8'))
        except UnicodeDecodeError:
            continue
        if hits:
            found[rel] = hits
    return found


def test_no_plan_number_references_in_app_code():
    over = {rel: n for rel, n in _counts().items() if n > PENDING.get(rel, 0)}
    assert not over, (
        'Internal plan numbers in app code (the plans are not in the repo): '
        + ', '.join(f'{rel} ({n})' for rel, n in sorted(over.items())))


def test_pending_list_is_not_stale():
    counts = _counts()
    stale = {rel: n for rel, n in PENDING.items() if counts.get(rel, 0) < n}
    assert not stale, f'Lower or remove these PENDING entries: {stale} (now {counts})'


if __name__ == '__main__':
    import sys
    counts = _staged_counts() if '--staged' in sys.argv else _counts()
    over = {rel: n for rel, n in counts.items() if n > PENDING.get(rel, 0)}
    for rel, n in sorted(over.items()):
        print(f'{rel}: {n} internal plan reference(s), e.g. "plan 92" or a bare section sign')
    if over:
        print('Plans are git-ignored, so these point at nothing. Say what the code '
              'does instead; the history belongs in the commit message.')
    sys.exit(1 if over else 0)
