"""A host must not stop at ~30 compose stacks.

Issue #254: creating one more WordPress site failed with "all predefined
address pools have been fully subnetted". Every compose project takes a bridge
network from Docker's default pools, a stock daemon has about thirty of them,
and nothing in the panel knew the limit existed.

``compose up`` now answers that failure by pinning the project's networks to
subnets outside the default pools and starting again.
"""

import ipaddress

import pytest
import yaml

from app.services import compose_network_service as cns
from app.services.docker_service import DockerService
from subprocess_stub import FakeProc

EXHAUSTED = ('failed to create network site_default: Error response from daemon: '
             'all predefined address pools have been fully subnetted')
OVERLAP = ('failed to create network site_default: Error response from daemon: '
           'invalid pool request: Pool overlaps with other one on this address space')


@pytest.fixture(autouse=True)
def _isolated_allocator(monkeypatch):
    cns._recent.clear()
    monkeypatch.delenv(cns.POOL_ENV, raising=False)
    monkeypatch.setattr(cns, '_docker_subnets', lambda: [])
    monkeypatch.setattr(cns, '_host_addresses', lambda: [])
    yield
    cns._recent.clear()


def _project(tmp_path, text):
    (tmp_path / 'docker-compose.yml').write_text(text, encoding='utf-8')
    return str(tmp_path)


def _compose(path):
    with open(f'{path}/docker-compose.yml', encoding='utf-8') as stream:
        return yaml.safe_load(stream)


def _subnet(config, network='default'):
    return config['networks'][network]['ipam']['config'][0]['subnet']


SIMPLE = '''# kept: a comment the pin must not eat
services:
  wordpress:
    image: wordpress
    ports:
      - "8300:80"
  db:
    image: mysql:8.4
'''


class TestDetection:
    @pytest.mark.parametrize('text', [
        EXHAUSTED,
        'could not find an available, non-overlapping IPv4 address pool among '
        'the defaults to assign to the network',
        OVERLAP,
    ])
    def test_daemon_messages_are_recognised(self, text):
        assert cns.needs_pinned_subnet(text)

    @pytest.mark.parametrize('text', [None, '', 'pull access denied for wordpress',
                                      'port is already allocated'])
    def test_other_failures_are_left_alone(self, text):
        assert not cns.needs_pinned_subnet(text)


class TestPin:
    def test_implicit_default_network_is_pinned_and_file_kept(self, tmp_path):
        path = _project(tmp_path, SIMPLE)
        result = cns.pin_project_subnets(path, error_text=EXHAUSTED)

        assert result['success'] and list(result['pinned']) == ['default']
        text = (tmp_path / 'docker-compose.yml').read_text(encoding='utf-8')
        assert text.startswith(SIMPLE)  # appended, not rewritten
        subnet = ipaddress.ip_network(_subnet(_compose(path)))
        assert subnet.subnet_of(ipaddress.ip_network(cns.DEFAULT_POOL))
        assert subnet.prefixlen == cns.SUBNET_PREFIX
        assert _compose(path)['services']['wordpress']['ports'] == ['8300:80']

    def test_skips_subnets_docker_and_the_host_already_use(self, tmp_path, monkeypatch):
        monkeypatch.setattr(cns, '_docker_subnets', lambda: ['10.213.0.0/24'])
        monkeypatch.setattr(cns, '_host_addresses', lambda: ['10.213.1.5'])
        path = _project(tmp_path, SIMPLE)
        cns.pin_project_subnets(path, error_text=EXHAUSTED)

        subnet = ipaddress.ip_network(_subnet(_compose(path)))
        assert not subnet.overlaps(ipaddress.ip_network('10.213.0.0/24'))
        assert ipaddress.ip_address('10.213.1.5') not in subnet
        assert str(subnet) == '10.213.1.64/26'

    def test_two_projects_before_either_network_exists_differ(self, tmp_path):
        # Neither subnet is visible to the daemon until the retried `up` runs.
        (tmp_path / 'a').mkdir()
        (tmp_path / 'b').mkdir()
        first = _project(tmp_path / 'a', SIMPLE)
        second = _project(tmp_path / 'b', SIMPLE)
        cns.pin_project_subnets(first, error_text=EXHAUSTED)
        cns.pin_project_subnets(second, error_text=EXHAUSTED)
        assert _subnet(_compose(first)) != _subnet(_compose(second))

    def test_declared_networks_are_pinned_external_and_chosen_ones_are_not(self, tmp_path):
        path = _project(tmp_path, '''services:
  web:
    image: nginx
    networks: [front, shared, fixed, overlay]
networks:
  front:
  shared:
    external: true
  fixed:
    ipam:
      config:
        - subnet: 172.30.9.0/24
  overlay:
    driver: overlay
''')
        result = cns.pin_project_subnets(path, error_text=EXHAUSTED)

        assert list(result['pinned']) == ['front']
        networks = _compose(path)['networks']
        assert networks['shared'] == {'external': True}
        assert _subnet(_compose(path), 'fixed') == '172.30.9.0/24'
        assert networks['overlay'] == {'driver': 'overlay'}

    def test_a_copied_pin_is_replaced_only_on_an_overlap(self, tmp_path):
        path = _project(tmp_path, SIMPLE)
        cns.pin_project_subnets(path, error_text=EXHAUSTED)
        copied = _subnet(_compose(path))

        # Exhaustion elsewhere is not about a network that already has a subnet.
        assert not cns.pin_project_subnets(path, error_text=EXHAUSTED)['success']
        assert _subnet(_compose(path)) == copied

        # The copy's source still holds the subnet.
        assert cns.pin_project_subnets(path, error_text=OVERLAP)['success']
        assert _subnet(_compose(path)) != copied

    def test_a_subnet_someone_chose_is_never_replaced(self, tmp_path):
        path = _project(tmp_path, '''services:
  web:
    image: nginx
networks:
  default:
    ipam:
      config:
        - subnet: 172.30.9.0/24
''')
        assert not cns.pin_project_subnets(path, error_text=OVERLAP)['success']
        assert _subnet(_compose(path)) == '172.30.9.0/24'

    def test_host_networked_project_has_nothing_to_pin(self, tmp_path):
        path = _project(tmp_path, 'services:\n  web:\n    image: nginx\n    network_mode: host\n')
        result = cns.pin_project_subnets(path, error_text=EXHAUSTED)
        assert not result['success'] and 'networks' not in _compose(path)

    def test_full_pool_says_so(self, tmp_path, monkeypatch):
        monkeypatch.setenv(cns.POOL_ENV, '10.213.0.0/26')
        monkeypatch.setattr(cns, '_docker_subnets', lambda: ['10.213.0.0/26'])
        result = cns.pin_project_subnets(_project(tmp_path, SIMPLE), error_text=EXHAUSTED)
        assert not result['success'] and cns.POOL_ENV in result['error']

    def test_pool_is_configurable(self, tmp_path, monkeypatch):
        monkeypatch.setenv(cns.POOL_ENV, '192.168.200.0/24')
        path = _project(tmp_path, SIMPLE)
        cns.pin_project_subnets(path, error_text=EXHAUSTED)
        assert _subnet(_compose(path)) == '192.168.200.0/26'

    def test_missing_compose_file_never_raises(self, tmp_path):
        assert not cns.pin_project_subnets(str(tmp_path), error_text=EXHAUSTED)['success']


class TestComposeUpRetries:
    @pytest.fixture(autouse=True)
    def _plain_command(self, monkeypatch):
        monkeypatch.setattr(DockerService, '_compose_cmd_with_overlay',
                            classmethod(lambda cls, path, compose_file=None:
                                        ['docker', 'compose']))

    def test_exhausted_pool_is_pinned_and_retried(self, tmp_path, monkeypatch):
        path = _project(tmp_path, SIMPLE)
        calls = []

        def run_compose(cmd, cwd=None, timeout=None):
            calls.append(cmd)
            if len(calls) == 1:
                return {'success': False, 'output': '', 'stderr': EXHAUSTED,
                        'error': EXHAUSTED, 'returncode': 1}
            return {'success': True, 'output': 'started', 'stderr': '',
                    'error': None, 'returncode': 0}

        monkeypatch.setattr(DockerService, 'run_compose', staticmethod(run_compose))
        result = DockerService.compose_up(path)

        assert result == {'success': True, 'output': 'started'}
        assert len(calls) == 2
        assert _subnet(_compose(path))

    def test_other_failures_are_not_retried(self, tmp_path, monkeypatch):
        path = _project(tmp_path, SIMPLE)
        calls = []

        def run_compose(cmd, cwd=None, timeout=None):
            calls.append(cmd)
            return {'success': False, 'output': '', 'stderr': 'port is already allocated',
                    'error': 'port is already allocated', 'returncode': 1}

        monkeypatch.setattr(DockerService, 'run_compose', staticmethod(run_compose))
        result = DockerService.compose_up(path)

        assert not result['success'] and len(calls) == 1
        assert 'networks' not in _compose(path)

    def test_streaming_up_pins_retries_and_says_what_it_did(self, tmp_path, monkeypatch,
                                                            fake_subprocess):
        path = _project(tmp_path, SIMPLE)
        runs = []

        def up(argv, kwargs):
            runs.append(argv)
            if len(runs) == 1:
                return FakeProc(returncode=1, stdout=EXHAUSTED + '\n', args=argv)
            return FakeProc(stdout='started\n', args=argv)

        fake_subprocess.when(['docker', 'compose'], up)
        monkeypatch.setattr(DockerService, '_is_compose_v2', classmethod(lambda cls: True))
        lines = []
        result = DockerService.compose_up_streaming(path, lines.append)

        assert result == {'success': True, 'exit_code': 0}
        assert len(runs) == 2
        assert any('pinned a dedicated subnet (default -> 10.213.' in line for line in lines)
        assert lines[-1] == 'started'
