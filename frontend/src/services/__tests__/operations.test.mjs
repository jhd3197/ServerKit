import assert from 'node:assert/strict';
import test from 'node:test';
import i18next from 'i18next';

import {
    boundOperationHistory,
    normalizeDeploymentOperation,
    normalizeJobOperation,
    normalizeOperations,
    operationKey,
    reconcileOperationStatus,
} from '../operations.js';

// Uninitialised i18next returns undefined; the app initialises it in i18n/index.js.
await i18next.init({ lng: 'en', resources: {} });

test('normalizes deployment progress, resource, and detail route', () => {
    const operation = normalizeDeploymentOperation({
        id: 'dep-1',
        kind: 'app_deploy',
        status: 'running',
        app_id: 8,
        app_name: 'api-production',
        current_step: 2,
        total_steps: 5,
        started_at: '2026-08-19T14:22:00Z',
    });

    assert.equal(operationKey(operation), 'deploy:dep-1');
    assert.equal(operation.title, 'Deploy api-production');
    assert.deepEqual(operation.progress, { completed: 2, total: 5, percent: 40 });
    assert.equal(operation.resource.type, 'app');
    assert.equal(operation.detailPath, '/deployments/dep-1');
});

test('normalizes proof job kinds and keeps deploy queue mirrors out', () => {
    const backup = normalizeJobOperation({
        id: 'job-1',
        kind: 'backup.policy.run',
        status: 'pending',
        owner_type: 'backup_policy',
        owner_id: 12,
    });
    assert.equal(backup.title, 'Backup policy run');
    assert.equal(backup.detailPath, '/monitoring/jobs?focus=job-1');

    const operations = normalizeOperations({
        deployments: [{ id: 'dep-1', status: 'running' }],
        jobs: [
            { id: 'mirror', kind: 'deploy.app', status: 'running' },
            { id: 'backup', kind: 'backup.policy.run', status: 'running' },
            { id: 'doctor', kind: 'doctor.repair', status: 'running' },
            { id: 'security', kind: 'security.malware_scan', status: 'running' },
        ],
    });
    assert.deepEqual(operations.map(operationKey).sort(), [
        'deploy:dep-1',
        'job:backup',
        'job:doctor',
        'job:security',
    ]);
    assert.deepEqual(
        Object.fromEntries(operations.map((operation) => [operation.id, operation.title])),
        {
            'dep-1': 'Service deployment',
            backup: 'Backup policy run',
            doctor: 'Doctor repair',
            security: 'Security scan',
        },
    );
});

test('bounds terminal history without dropping active or selected work', () => {
    const operations = [
        normalizeJobOperation({ id: 'active', status: 'running', updated_at: '2026-08-21T03:00:00Z' }),
        normalizeJobOperation({ id: 'recent', status: 'succeeded', updated_at: '2026-08-21T02:00:00Z' }),
        normalizeJobOperation({ id: 'selected', status: 'succeeded', updated_at: '2026-08-21T01:00:00Z' }),
    ];
    const bounded = boundOperationHistory(operations, 1, 'job:selected');
    assert.deepEqual(bounded.map(operationKey), ['job:active', 'job:recent', 'job:selected']);
});

test('keeps a handoff-waiting Recipe active and attention-worthy', () => {
    const recipe = normalizeDeploymentOperation({
        id: 'recipe-1',
        kind: 'recipe.run',
        status: 'waiting',
        title: 'Recipe: Media server',
        requires_action: true,
        handoff: { step_id: 'claim', title: 'Claim the server' },
    });
    const bounded = boundOperationHistory([recipe], 0);
    assert.deepEqual(bounded.map(operationKey), ['deploy:recipe-1']);
    assert.equal(recipe.title, 'Recipe: Media server');
    assert.equal(recipe.requiresAction, true);
    assert.equal(recipe.handoff.step_id, 'claim');
});

test('keeps a boolean handoff flag out of the handoff descriptor', () => {
    const withDescriptor = normalizeDeploymentOperation({
        id: 'recipe-flagged',
        kind: 'recipe.run',
        status: 'waiting',
        handoff: true,
        result: { handoff: { step_id: 'credentials', title: 'Add credentials' } },
    });
    const flagOnly = normalizeDeploymentOperation({
        id: 'recipe-flag-only',
        kind: 'recipe.run',
        status: 'waiting',
        handoff: true,
    });

    assert.equal(withDescriptor.requiresAction, true);
    assert.deepEqual(withDescriptor.handoff, {
        step_id: 'credentials',
        title: 'Add credentials',
    });
    assert.equal(flagOnly.requiresAction, true);
    assert.equal(flagOnly.handoff, null);
});

test('reconciles one run and marks a newly failed terminal operation unread', () => {
    const current = [normalizeJobOperation({ id: 'job-1', kind: 'doctor.run', status: 'running' })];
    const result = reconcileOperationStatus(current, {
        run_kind: 'job',
        run_id: 'job-1',
        status: { status: 'failed', error_message: 'repair failed' },
    });
    assert.equal(result.matched, true);
    assert.equal(result.attentionKey, 'job:job-1');
    assert.equal(result.operations[0].status, 'failed');
    assert.equal(result.operations[0].error, 'repair failed');
});

test('preserves operation identity while accepting and clearing server capabilities', () => {
    const current = [normalizeJobOperation({
        id: 'job-2',
        kind: 'security.lynis_scan',
        status: 'running',
        can_retry: true,
    })];
    const result = reconcileOperationStatus(current, {
        run_kind: 'job',
        run_id: 'job-2',
        status: { status: 'running', requires_action: true, can_retry: false },
    });
    assert.equal(result.attentionKey, 'job:job-2');
    assert.equal(result.operations[0].title, 'Security scan');
    assert.equal(result.operations[0].canRetry, false);
    assert.equal(result.operations[0].requiresAction, true);
});
