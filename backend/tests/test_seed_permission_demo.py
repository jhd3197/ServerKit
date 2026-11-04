import importlib.util
from pathlib import Path

from app.models.metric_alert import MetricAlert
from app.models.server import Server


def test_seed_is_idempotent(app):
    path = Path(__file__).parents[1] / 'scripts/seed_permission_demo.py'
    spec = importlib.util.spec_from_file_location('seed_demo', path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.seed()
    mod.seed()
    assert Server.query.filter(Server.agent_id.like('demo-perm-%')).count() == 5
    assert Server.query.filter_by(status='offline').count() == 1
    assert MetricAlert.query.filter_by(metric='offline').count() == 1
