"""The shipped nginx configs must let Let's Encrypt HTTP-01 through (issue #269).

Each vhost denies dotfiles with the regex location ``location ~ /\\.``. That
regex also matches ``/.well-known/acme-challenge/<token>``, and nginx prefers
a matching regex location over a plain prefix location — so a plain
``location /.well-known/acme-challenge/`` in the same server block loses and
the challenge answers 403. Issuance and renewal then fail, and a hand fix was
undone by the next ``serverkit update`` re-copying the shipped file.

``^~`` on the prefix location tells nginx to stop there and skip the regex
pass, which is the only form that wins.
"""
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

CONFIGS = [
    ROOT / 'nginx' / 'nginx.conf',
    ROOT / 'nginx' / 'sites-available' / 'serverkit.conf',
    ROOT / 'nginx' / 'sites-available' / 'serverkit-insecure.conf',
    ROOT / 'nginx' / 'sites-available' / 'example.conf.template',
]

_ACME = re.compile(r'^\s*location\s+(?P<modifier>\S+\s+)?/\.well-known/acme-challenge/\s*\{',
                   re.MULTILINE)
_DOTFILE_DENY = re.compile(r'^\s*location\s+~\*?\s+/\\\.\s*\{', re.MULTILINE)


@pytest.mark.parametrize('config', CONFIGS, ids=lambda p: p.name)
def test_acme_challenge_location_beats_the_dotfile_deny(config):
    text = config.read_text(encoding='utf-8')
    locations = list(_ACME.finditer(text))
    assert locations, f'{config.name}: no ACME challenge location to serve HTTP-01'
    for match in locations:
        assert (match.group('modifier') or '').strip() == '^~', (
            f'{config.name}: the ACME challenge location must be '
            f'`location ^~ /.well-known/acme-challenge/` or the dotfile deny wins')


def test_the_collision_this_guards_is_real():
    """At least one shipped server block carries both locations — the plain
    HTTP vhost — so the modifier is load-bearing, not decoration."""
    text = (ROOT / 'nginx' / 'sites-available' / 'serverkit-insecure.conf').read_text(
        encoding='utf-8')
    assert _ACME.search(text) and _DOTFILE_DENY.search(text)
    assert text.count('server {') == 1
