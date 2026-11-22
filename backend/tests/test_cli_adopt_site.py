"""`serverkit adopt-site` — the CLI face of site adoption (issue #269).

Dry run by default: naming a site prints what would be recorded and changes
nothing; only `--apply` registers it. The host fixture and the "nothing on
the host changed" snapshot come from test_site_adoption.py.
"""
import json

import pytest
from click.testing import CliRunner

from factories import make_user
from test_site_adoption import _snapshot, host  # noqa: F401  (fixture)


@pytest.fixture
def run(app, monkeypatch):
    """Invoke the Click command against the test app instead of a fresh one."""
    import cli
    monkeypatch.setattr(cli, 'create_app', lambda *args, **kwargs: app)

    def invoke(*args):
        return CliRunner().invoke(cli.cli, ['adopt-site', *args], catch_exceptions=False)
    return invoke


def test_no_argument_lists_sites_with_their_state(run, host):  # noqa: F811
    result = run()
    assert result.exit_code == 0, result.output
    assert 'shop.example.com' in result.output and 'wordpress' in result.output
    assert 'not managed (adoptable)' in result.output
    assert '2 site(s) can be adopted' in result.output
    listed = json.loads(run('--json').output)['sites']
    assert {site['primary_domain'] for site in listed} == {
        'shop.example.com', 'docs.example.com', 'api.example.com'}


def test_naming_a_site_is_a_dry_run(run, host):  # noqa: F811
    from app.models.application import Application
    before = _snapshot(host['root'])
    result = run('shop.example.com')
    assert result.exit_code == 0, result.output
    assert 'Dry run. Nothing was changed.' in result.output
    assert 'serverkit adopt-site shop.example.com --apply' in result.output
    assert 'Left exactly as it is:' in result.output
    assert Application.query.filter_by(name='shop-example-com').first() is None
    assert _snapshot(host['root']) == before


def test_apply_registers_the_site_and_leaves_the_host_alone(run, host, app):  # noqa: F811
    from app import db
    from app.models.application import Application
    make_user(db, 'cli_adopt_admin', 'admin')
    before = _snapshot(host['root'])
    result = run('docs.example.com', '--apply', '--name', 'docs-site')
    assert result.exit_code == 0, result.output
    assert 'Adopted as "docs-site"' in result.output
    row = Application.query_active().filter_by(name='docs-site').one()
    assert (row.managed_by, row.app_type, row.status) == ('host', 'static', 'running')
    assert _snapshot(host['root']) == before


def test_refusals_exit_non_zero_and_register_nothing(run, host, app):  # noqa: F811
    from app import db
    from app.models.application import Application
    make_user(db, 'cli_adopt_admin2', 'admin')
    count = Application.query.count()
    assert run('nope.example.com').exit_code == 1
    # A proxied process is described, but --apply refuses it.
    assert run('api.example.com').exit_code == 0
    assert run('api.example.com', '--apply').exit_code == 1
    assert run('--apply').exit_code == 1
    assert Application.query.count() == count
