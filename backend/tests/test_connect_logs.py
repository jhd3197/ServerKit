"""The panel half of bounded log collection.

What matters: a file is followed from where it was left and rotation starts
a new generation; ids are stable so a resend is a duplicate, not a second
line; every bound Cloud enforces is applied here first; Cloud's answer is the
configuration and `collect: false` stops collection at once; nothing that
looks like a secret crosses the relay.
"""
import json
import os
from types import SimpleNamespace

import pytest

from app.services import connect_logs


@pytest.fixture()
def logfile(tmp_path):
    path = tmp_path / 'serverkit.log'
    path.write_text('')
    return path


def test_a_file_is_followed_from_where_it_was_left_and_rotation_is_a_generation(logfile):
    tail = connect_logs.FileTail('serverkit.service', str(logfile))
    # First sight starts at the end: history is not what Cloud keeps.
    logfile.write_text('old line\n', newline='\n')
    assert tail.read() == []

    with open(logfile, 'a', encoding='utf-8', newline='\n') as fh:
        fh.write('INFO one\nERROR two\npartial')
    got = tail.read()
    assert [r['text'] for r in got] == ['INFO one', 'ERROR two']
    assert got[0]['severity'] == 'info' and got[1]['severity'] == 'error'
    assert got[0]['generation'] == 0 and got[0]['offset'] == len('old line\n')
    ids = {r['id'] for r in got}

    # The partial line arrives once its newline does, and nothing is resent.
    with open(logfile, 'a', encoding='utf-8', newline='\n') as fh:
        fh.write(' finished\n')
    again = tail.read()
    assert [r['text'] for r in again] == ['partial finished']
    assert not ids & {r['id'] for r in again}

    # Truncation is a rotation: generation moves on, the offset restarts.
    logfile.write_text('fresh\n', newline='\n')
    rotated = tail.read()
    assert rotated[0]['generation'] == 1 and rotated[0]['offset'] == 0


def test_ids_are_stable_and_lines_are_bounded_and_redacted(logfile):
    assert connect_logs.record_id('a', 1, 2) == connect_logs.record_id('a', 1, 2)
    assert connect_logs.record_id('a', 1, 2) != connect_logs.record_id('a', 2, 2)

    tail = connect_logs.FileTail('web.error', str(logfile))
    tail.read()
    with open(logfile, 'a', encoding='utf-8', newline='\n') as fh:
        fh.write('token=ghp_abcdefghijklmnop123456 password: hunter2 '
                 'https://u:p@example.test/ Authorization: Bearer abcdefghijkl\n')
        fh.write('x' * (connect_logs.MAX_LINE_BYTES + 100) + '\n')
    got = tail.read()
    assert 'hunter2' not in got[0]['text'] and 'ghp_' not in got[0]['text']
    assert 'u:p@' not in got[0]['text'] and 'abcdefghijkl' not in got[0]['text']
    assert len(got[1]['text'].encode()) <= connect_logs.MAX_LINE_BYTES
    assert got[1]['truncated'] is True
    text = json.dumps(got)
    assert str(logfile) not in text, 'a path never crosses the relay'


def test_batches_respect_every_bound(monkeypatch):
    pub = connect_logs.LogPublisher(None)
    pub.sources = []
    pub.apply_ack({'ok': True, 'collect': True, 'sources': ['serverkit.service'],
                   'flush_interval_s': 5})
    for i in range(450):
        pub.pending.append({'id': f'r{i}', 'source': 'serverkit.service',
                            'observed_at': 'now', 'text': 'x' * 900})
    pub.pending_bytes = sum(len(json.dumps(r).encode()) for r in pub.pending)
    first = pub.take_batch()
    assert first['schema'] == 'logs/1'
    assert len(first['records']) <= connect_logs.MAX_BATCH_RECORDS
    assert len(json.dumps(first).encode()) <= connect_logs.MAX_BATCH_BYTES
    # Flushes are spaced; the next one is not due yet.
    assert pub.due() is False
    pub.next_flush_at = 0.0
    second = pub.take_batch()
    assert second['generation'] == first['generation'] + 1
    assert first['records'][0]['id'] != second['records'][0]['id']


@pytest.mark.parametrize('key', [
    'password', 'api_key', 'API-KEY', 'token', 'authorization', 'private_key',
])
def test_json_secrets_are_redacted_without_changing_other_fields(key):
    secret = 'private "quoted" value\\with\\slashes'
    line = json.dumps({
        'message': 'request failed',
        'context': [{key: secret, 'status': 401}],
    })
    redacted = json.loads(connect_logs.redact(line))
    assert redacted == {
        'message': 'request failed',
        'context': [{key: '[redacted]', 'status': 401}],
    }


@pytest.mark.parametrize('secret', [123456, True, None])
def test_json_secret_scalars_remain_valid_json(secret):
    line = json.dumps({'password': secret, 'status': 'failed'})
    assert json.loads(connect_logs.redact(line)) == {
        'password': '[redacted]', 'status': 'failed',
    }


def test_prefixed_json_is_redacted_before_a_file_record_is_published(logfile):
    tail = connect_logs.FileTail('serverkit.service', str(logfile))
    tail.read()
    line = 'ERROR request ' + json.dumps({
        'password': 'example-secret', 'api_key': 'example-key', 'status': 401,
    })
    logfile.write_text(line + '\n', newline='\n')
    records = tail.read()
    assert len(records) == 1
    assert json.loads(records[0]['text'].removeprefix('ERROR request ')) == {
        'password': '[redacted]', 'api_key': '[redacted]', 'status': 401,
    }


@pytest.mark.parametrize('extra_bytes', [0, 1, connect_logs.MAX_READ_BYTES + 20])
def test_oversized_lines_do_not_block_later_records(logfile, extra_bytes):
    tail = connect_logs.FileTail('serverkit.service', str(logfile))
    tail.read()
    prefix = b'INFO before\n'
    oversized = b'password=' + b'x' * (
        connect_logs.MAX_READ_BYTES + extra_bytes - len(b'password='))
    logfile.write_bytes(prefix + oversized + b'\nINFO after\n')

    records = []
    for _ in range(8):
        records.extend(tail.read())
    assert [r['text'] for r in records] == [
        'INFO before', '[oversized log line omitted]', 'INFO after',
    ]
    assert records[1]['truncated'] is True
    assert records[1]['offset'] == len(prefix)
    assert records[2]['offset'] == len(prefix) + len(oversized) + 1
    assert records[1]['id'] == connect_logs.record_id(
        'serverkit.service', 0, len(prefix))
    assert tail.offset == logfile.stat().st_size
    assert tail.read() == []


def test_oversized_unterminated_line_waits_for_newline_without_leaking_remainder(logfile):
    tail = connect_logs.FileTail('serverkit.service', str(logfile))
    tail.read()
    logfile.write_bytes(b'password=' + b'x' * connect_logs.MAX_READ_BYTES)
    assert tail.read()[0]['truncated'] is True
    assert tail.read() == []
    assert tail.offset == logfile.stat().st_size

    with logfile.open('ab') as fh:
        fh.write(b'secret-continuation')
    assert tail.read() == []
    with logfile.open('ab') as fh:
        fh.write(b'\nINFO recovered\n')
    assert [r['text'] for r in tail.read()] == ['INFO recovered']


@pytest.mark.parametrize('rotate', [False, True])
def test_rotation_resets_oversized_line_discarding(logfile, rotate):
    tail = connect_logs.FileTail('serverkit.service', str(logfile))
    tail.read()
    logfile.write_bytes(b'x' * connect_logs.MAX_READ_BYTES)
    assert tail.read()[0]['truncated'] is True
    if rotate:
        logfile.rename(logfile.with_suffix('.old'))
    logfile.write_bytes(b'INFO fresh file\n')
    records = tail.read()
    assert [r['text'] for r in records] == ['INFO fresh file']
    assert records[0]['generation'] == 1
    assert records[0]['offset'] == 0


def test_a_refused_batch_goes_back_to_the_front_and_a_stop_clears_it():
    pub = connect_logs.LogPublisher(None)
    pub.apply_ack({'ok': True, 'collect': True, 'sources': ['web.error']})
    pub.pending = [{'id': 'b', 'source': 'web.error', 'observed_at': 'now', 'text': 'b'}]
    batch = {'schema': 'logs/1', 'generation': 1,
             'records': [{'id': 'a', 'source': 'web.error', 'observed_at': 'now', 'text': 'a'}]}
    pub.requeue(batch)
    assert [r['id'] for r in pub.pending] == ['a', 'b']

    # Consent withdrawn: stop now, hold nothing, ask again only slowly.
    pub.apply_ack({'ok': False, 'reason': 'scope_not_granted', 'collect': False, 'sources': []})
    assert pub.collect is False and pub.pending == [] and pub.pending_bytes == 0
    assert pub.due() is False
    pub.retry_after_refusal()
    assert pub.collect is False, 'not before the retry window'
    pub.refused_until = 0.0
    pub.retry_after_refusal()
    assert pub.collect is True and pub.sources is None
    assert pub.due() is True, 'one empty batch asks for the configuration'


def test_before_cloud_answers_nothing_is_read_and_the_first_batch_is_empty(monkeypatch):
    pub = connect_logs.LogPublisher(None)
    assert pub.wanted() == []
    assert pub.collect_now() == 0
    assert pub.due() is True
    batch = pub.take_batch()
    assert batch['records'] == []
    # Cloud names the sources; only those are read from then on.
    pub.apply_ack({'ok': True, 'collect': True, 'sources': ['web.error', 'not-a-source']})
    assert pub.wanted() == ['web.error']


def test_deploy_output_is_sent_once_per_deployment(tmp_path):
    log = tmp_path / 'build-7.json'
    log.write_text(json.dumps({'logs': [{'message': 'Step 1'}, {'message': 'token=abc123456789'},
                                        {'message': ''}]}))

    class Dep:
        id = 7
        app_id = 3
        version = 2
        build_log_path = str(log)

    reader = connect_logs.DeployOutput(None)
    reader._recent = lambda: [Dep()]
    got = reader.read()
    assert [r['text'] for r in got] == ['Step 1', 'token=[redacted]']
    assert got[0]['app_key'] == '3' and got[0]['deployment_key'] == '3:2'
    assert reader.read() == [], 'once'
    assert str(log) not in json.dumps(got)


def test_the_client_wires_the_stream_and_requeues_an_unacknowledged_batch():
    from app.services import connect_client
    client = connect_client.RelayClient(None)
    client._logs.apply_ack({'ok': True, 'collect': True, 'sources': ['web.error']})
    client._logs.pending = [{'id': 'a', 'source': 'web.error', 'observed_at': 'now', 'text': 'a'}]
    client._logs.pending_bytes = 60
    sent = []

    class WS:
        def send(self, raw):
            sent.append(json.loads(raw))
    assert client._publish_logs(WS()) is True
    assert sent[0]['k'] == 'logs' and sent[0]['p']['records'][0]['id'] == 'a'
    stream_id = sent[0]['s']
    assert stream_id in client._logs_inflight

    # A refusal that is not a stop: the batch goes back.
    client._handle_frame(WS(), json.dumps({'s': stream_id, 't': 'close',
                                           'p': {'ok': False, 'reason': 'malformed',
                                                 'collect': True, 'sources': ['web.error']}}))
    assert [r['id'] for r in client._logs.pending] == ['a']
    assert stream_id not in client._logs_inflight

    # A stop: nothing is held and nothing more is sent.
    client._logs.next_flush_at = 0.0
    client._publish_logs(WS())
    stream_id = sent[-1]['s']
    client._handle_frame(WS(), json.dumps({'s': stream_id, 't': 'close',
                                           'p': {'ok': False, 'reason': 'scope_not_granted',
                                                 'collect': False, 'sources': []}}))
    assert client._logs.collect is False and client._logs.pending == []
    assert client._publish_logs(WS()) is False


@pytest.mark.parametrize('line', [
    'Authorization: Bearer abc', 'Authorization: Basic x',
    'client_secret=hidden refresh_token=hidden',
    '{"client_secret":"hidden","refresh_token":"hidden"}',
    "password='hidden\\'also-hidden'",
])
def test_short_credentials_and_compound_keys_are_redacted(line):
    redacted = connect_logs.redact(line)
    assert 'hidden' not in redacted
    assert not redacted.endswith((' abc', ' x'))
    assert '[redacted]' in redacted


def test_file_tail_rejects_symlinks(logfile, tmp_path):
    tail = connect_logs.FileTail('web.error', str(logfile))
    tail.read()
    target = tmp_path / 'private.txt'
    target.write_text('private file contents\n')
    logfile.unlink()
    try:
        logfile.symlink_to(target)
    except OSError:
        pytest.skip('symlinks require privileges on this platform')
    assert tail.read() == []
    assert tail.offset == 0


def test_replacement_between_stat_and_open_is_not_read(logfile, monkeypatch):
    tail = connect_logs.FileTail('web.error', str(logfile))
    tail.read()
    original_open = os.open

    def replace_then_open(path, flags):
        logfile.rename(logfile.with_suffix('.old'))
        logfile.write_bytes(b'private replacement contents\n')
        return original_open(path, flags)

    monkeypatch.setattr(connect_logs.os, 'open', replace_then_open)
    assert tail.read() == []
    assert tail.offset == 0


def test_panel_reader_uses_production_error_log(tmp_path, monkeypatch):
    monkeypatch.setattr(connect_logs.paths, 'SERVERKIT_LOG_DIR', str(tmp_path))
    assert connect_logs._panel_log_path() == str(tmp_path / 'error.log')
    (tmp_path / 'error.log').write_text('')
    (tmp_path / 'serverkit.log').write_text('')
    assert connect_logs._panel_log_path() == str(tmp_path / 'error.log')


def test_deployment_reader_drains_more_than_one_batch_and_new_lines(tmp_path):
    path = tmp_path / 'build.json'
    lines = [f'line {i}' for i in range(450)]
    path.write_text(json.dumps({'logs': lines}))
    reader = connect_logs.DeployOutput()
    reader._recent = lambda: [
        SimpleNamespace(id=7, app_id=3, version=2, build_log_path=str(path))]
    records = reader.read() + reader.read() + reader.read()
    assert [r['text'] for r in records] == lines
    assert len({r['id'] for r in records}) == 450
    assert reader.read() == []
    path.write_text(json.dumps({'logs': lines + ['last line']}))
    assert [r['text'] for r in reader.read()] == ['last line']


def test_repeated_app_messages_are_distinct_and_overlaps_are_skipped(monkeypatch):
    from app.services.log_service import LogService
    reader = connect_logs.AppOutput()
    reader._applications = lambda: [
        SimpleNamespace(id=7, name='web', app_type='docker', compose_file=None)]
    first = 'web | 2026-09-11T01:00:00.123456789Z ERROR repeated'
    later = 'web | 2026-09-11T01:00:01.123456789Z ERROR repeated'
    snapshots = iter([[first, first], [first, first], [first, later]])

    def read_logs(*args, **kwargs):
        assert kwargs['timestamps'] is True
        return {'success': True, 'lines': next(snapshots)}

    monkeypatch.setattr(LogService, 'get_docker_app_logs', read_logs)
    records = reader.read()
    assert len(records) == 2
    assert records[0]['id'] != records[1]['id']
    assert reader.read() == []
    newer = reader.read()
    assert len(newer) == 1 and newer[0]['text'] == later
    assert newer[0]['id'] not in {r['id'] for r in records}


@pytest.mark.parametrize('consent', [None, False, 1, 'true'])
def test_log_consent_requires_literal_true(consent):
    pub = connect_logs.LogPublisher()
    pub.apply_ack({'ok': True, 'collect': True, 'sources': ['web.error']})
    payload = {'ok': True}
    if consent is not None:
        payload['collect'] = consent
    pub.apply_ack(payload)
    assert pub.collect is False
    assert pub.collect_now() == 0
    assert pub.pending == []


def test_requeue_obeys_byte_bound_and_preserves_original_expiry(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(connect_logs.time, 'monotonic', lambda: clock[0])
    pub = connect_logs.LogPublisher()
    pub.apply_ack({'ok': True, 'collect': True, 'sources': ['web.error']})
    record = lambda key: {'id': key, 'source': 'web.error', 'text': 'x' * 100}
    size = len(json.dumps(record('a')).encode())
    monkeypatch.setattr(connect_logs, 'OUTAGE_BUFFER_BYTES', size * 2)
    pub.pending = [record('a'), record('b')]
    pub.pending_bytes = size * 2
    pub.oldest_pending_at = clock[0]
    batch = pub.take_batch()
    assert '_queued_at' not in connect_logs.logs_frame('log1', batch)['p']
    pub.pending = [record('c')]
    pub.pending_bytes = size
    pub.oldest_pending_at = 200.0
    clock[0] = 200.0
    pub.requeue(batch)
    assert pub.pending_bytes <= size * 2
    assert [r['id'] for r in pub.pending] == ['a', 'b']
    retry = pub.take_batch()
    clock[0] = 401.0
    pub.requeue(retry)
    assert pub.pending == []


def test_restricted_source_selection_purges_queued_records():
    pub = connect_logs.LogPublisher()
    pub.apply_ack({'ok': True, 'collect': True, 'sources': ['web.error', 'app.output']})
    pub.pending = [
        {'id': 'a', 'source': 'app.output', 'text': 'app'},
        {'id': 'b', 'source': 'web.error', 'text': 'web'},
    ]
    pub.apply_ack({'ok': True, 'collect': True, 'sources': ['web.error']})
    assert [r['id'] for r in pub.pending] == ['b']
    pub.requeue({'records': [{'id': 'a', 'source': 'app.output', 'text': 'app'}]})
    assert [r['id'] for r in pub.pending] == ['b']


def test_log_ack_timeout_retries_only_after_empty_consent_probe(monkeypatch):
    from app.services import connect_client
    clock = [100.0]
    monkeypatch.setattr(connect_logs.time, 'monotonic', lambda: clock[0])
    client = connect_client.RelayClient()
    client._logs.apply_ack({'ok': True, 'collect': True, 'sources': ['web.error']})
    client._logs._readers['web.error'] = SimpleNamespace(read=lambda: [])
    client._logs.pending = [{'id': 'a', 'source': 'web.error', 'text': 'message'}]
    client._logs.pending_bytes = 60
    client._logs.oldest_pending_at = clock[0]
    frames = []
    ws = SimpleNamespace(send=lambda raw: frames.append(json.loads(raw)))
    assert client._publish_logs(ws)
    assert not client._publish_logs(ws)
    clock[0] = 161.0
    assert client._publish_logs(ws)
    assert frames[-1]['p']['records'] == []
    assert [r['id'] for r in client._logs.pending] == ['a']
    assert len(client._logs_inflight) == 1
    client._handle_frame(ws, json.dumps({
        's': frames[-1]['s'], 't': 'close',
        'p': {'ok': True, 'collect': True, 'sources': ['web.error']},
    }))
    clock[0] = 167.0
    assert client._publish_logs(ws)
    assert frames[-1]['p']['records'][0]['id'] == 'a'


def test_socket_drop_recovers_unacknowledged_logs(monkeypatch):
    from app.services import connect_client
    client = connect_client.RelayClient()
    client.running = True
    client._logs.apply_ack({'ok': True, 'collect': True, 'sources': ['web.error']})
    batch = {'schema': 'logs/1', 'generation': 1,
             'records': [{'id': 'a', 'source': 'web.error', 'text': 'message'}],
             '_queued_at': connect_logs.time.monotonic()}
    client._logs_inflight['log1'] = batch

    def drop(**kwargs):
        raise ConnectionError('connection dropped before ack')

    ws = SimpleNamespace(recv=drop, close=lambda: None)
    monkeypatch.setattr(client, '_ws_connect', lambda cfg: ws)
    monkeypatch.setattr(client, '_set_state', lambda *args, **kwargs: None)
    for name in ('_check_for_update', '_load_jwks', '_publish_storage',
                 '_publish_policy', '_publish_inventory'):
        monkeypatch.setattr(client, name, lambda *args: None)
    assert client._ws_session({}).startswith('drop:')
    assert client._logs_inflight == {}
    assert client._logs.pending == batch['records']
    assert client._logs.sources is None
    assert client._logs.take_batch()['records'] == []


def test_timestamped_log_service_options_reach_commands(fake_subprocess, monkeypatch):
    from app.services import log_service
    fake_subprocess.script(['docker', 'compose', 'logs'], stdout='timestamp message\n')
    result = log_service.LogService.get_docker_app_logs(
        'web', '.', timestamps=True)
    assert result['success']
    assert '--timestamps' in fake_subprocess.argv_for(['docker', 'compose'])

    monkeypatch.setattr(log_service, 'is_command_available', lambda name: True)
    fake_subprocess.script(['journalctl'], stdout='timestamp message\n')
    result = log_service.LogService.get_journalctl_logs(unit='web.service', precise=True)
    assert result['success']
    assert 'short-iso-precise' in fake_subprocess.argv_for(['journalctl'])
