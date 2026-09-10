"""The panel half of bounded log collection.

What matters: a file is followed from where it was left and rotation starts
a new generation; ids are stable so a resend is a duplicate, not a second
line; every bound Cloud enforces is applied here first; Cloud's answer is the
configuration and `collect: false` stops collection at once; nothing that
looks like a secret crosses the relay.
"""
import json
import os

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
    client._logs.apply_ack({'ok': True, 'collect': True, 'sources': []})
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
