"""The release build must never run PR code with repository-write credentials."""
from pathlib import Path

import yaml


def test_only_push_only_publication_has_write_permissions():
    path = Path(__file__).resolve().parents[2] / '.github/workflows/release-smoke.yml'
    workflow = yaml.safe_load(path.read_text(encoding='utf-8'))
    assert workflow['permissions'] == {'contents': 'read'}
    privileged_jobs = []
    for name, job in workflow['jobs'].items():
        permissions = job.get('permissions', workflow['permissions'])
        if permissions.get('contents') != 'write':
            continue
        privileged_jobs.append(name)
        assert job['if'] == "github.event_name == 'push' && github.ref == 'refs/heads/dev'"
        assert job['needs'] == 'build-release-smoke'
        assert not any('checkout@' in step.get('uses', '') for step in job['steps'])
        # The only shell step is inline cleanup; none executes repository code.
        for step in job['steps']:
            if 'run' in step:
                assert 'gh release list' in step['run']
                assert 'scripts/' not in step['run']
    assert privileged_jobs == ['publish-dev']
