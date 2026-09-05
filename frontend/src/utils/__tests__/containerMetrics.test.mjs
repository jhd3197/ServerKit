import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeContainerStats, resolveAppContainerId } from '../containerMetrics.js';

test('prefers the recorded container id over repository or naming heuristics', () => {
    assert.equal(
        resolveAppContainerId(
            { id: 3, name: 'findu-api-staging', container_id: 'recorded-id' },
            [{ id: 'legacy-id', name: 'findu-api-staging-web-1' }]
        ),
        'recorded-id'
    );
});

test('falls back to generated and legacy container names', () => {
    assert.equal(
        resolveAppContainerId(
            { id: 3, name: 'findu-api-staging' },
            [{ id: 'generated-id', name: 'serverkit-app-3' }]
        ),
        'generated-id'
    );
    assert.equal(
        resolveAppContainerId(
            { id: 7, name: 'legacy-api' },
            [{ ID: 'legacy-id', Names: ['/legacy-api-web-1'] }]
        ),
        'legacy-id'
    );
});

test('normalizes wrapped Docker CLI stats', () => {
    assert.deepEqual(normalizeContainerStats({ stats: {
        CPUPerc: '1.25%',
        MemPerc: '2.50%',
        MemUsage: '50MiB / 2GiB',
        NetIO: '1MB / 2MB',
        BlockIO: '3MB / 4MB',
        PIDs: '12',
    } }), {
        cpuPercent: 1.25,
        memoryPercent: 2.5,
        memoryUsage: '50MiB / 2GiB',
        networkIO: '1MB / 2MB',
        blockIO: '3MB / 4MB',
        pids: '12',
    });
});

test('keeps compatibility with the historical normalized shape', () => {
    assert.deepEqual(normalizeContainerStats({
        cpu_percent: '0.5',
        memory_percent: '1.5',
        memory_usage: '10MiB',
        net_io: '5kB',
        block_io: '8kB',
        pids: 4,
    }), {
        cpuPercent: 0.5,
        memoryPercent: 1.5,
        memoryUsage: '10MiB',
        networkIO: '5kB',
        blockIO: '8kB',
        pids: 4,
    });
});
