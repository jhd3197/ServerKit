// Real settings components and SCSS; synthetic APIs never contact a provider.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';

const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } });
let browser;
try {
    await server.listen();
    await mkdir('test-results', { recursive: true });
    browser = await chromium.launch({ headless: true });
    for (const theme of ['light', 'dark']) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript((value) => {
            localStorage.setItem('access_token', 'synthetic-browser-fixture');
            document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.theme = value; });
        }, theme);
        let enabled = false;
        let rejectToggle = false;
        let savedConnection;
        let savedPreferences;
        let sentChat;
        let management = {
            profiles: { utility: null, standard: null, advanced: null }, routing_enabled: false, strategy: 'balanced', pool: [],
            fallback_enabled: false, fallbacks: [], budget_policy: 'hard_stop', max_tokens: 0, max_output_tokens: 2048,
            max_tool_rounds: 6, max_tool_result_length: 4000, max_history_messages: 40, temperature: null, reasoning_effort: null,
            monthly_limit_usd: 0, user_monthly_limit_usd: 0, workspace_monthly_limit_usd: 0, reservation_usd: 0.5,
        };
        const usage = { run_id: 'run-1', model: 'openai_compatible/team/cheap', connection_id: 'connection-1', profile: 'utility', workflow: 'summarize',
            reason: 'Selected Utility task model', cost: 0.02, total_tokens: 120, cost_source: 'estimated', call_count: 1, errors: 0, duration_ms: 1200,
            budget: { cost_remaining: 0.48, tokens_remaining: null },
            attempts: [{ connection_id: 'connection-1', model: 'team/cheap', status: 'success', total_tokens: 120 }] };
        let connection = { id: 'connection-1', name: 'Local gateway', provider: 'openai_compatible', model: 'team/default', config: { endpoint: 'http://gateway.test/v1' }, secrets_set: ['api_key'] };
        await page.route('**/api/v1/**', async (route) => {
            const path = new URL(route.request().url()).pathname;
            const method = route.request().method();
            let payload = {};
            if (path.endsWith('/auth/setup-status')) payload = { needs_setup: false };
            else if (path.endsWith('/auth/me')) payload = { user: { id: 1, username: 'operator', email: 'operator@example.test', role: 'admin', created_at: '2026-01-01' } };
            else if (path.endsWith('/ai/status')) payload = { enabled, configured: true };
            else if (path.endsWith('/ai/management/preview')) payload = { connection_id: connection.id, model: 'team/cheap', reason: 'Approved Utility candidate' };
            else if (path.endsWith('/ai/management')) {
                if (method === 'PUT') management = route.request().postDataJSON();
                payload = management;
            } else if (path.endsWith('/ai/usage')) payload = {
                totals: { cost: 0.02, tokens: 120, runs: 1, errors: 0, unknown_cost_runs: 0, average_duration_ms: 1200 },
                groups: { model: [{ label: usage.model, cost: 0.02, tokens: 120, runs: 1 }], profile: [{ label: 'utility', cost: 0.02, tokens: 120, runs: 1 }] },
                runs: [{ id: 'run-1', model: usage.model, profile: 'utility', status: 'success', cost: 0.02, reason: usage.reason, created_at: '2026-09-08T12:00:00Z', usage }],
                allowances: [{ scope: 'Panel', remaining: 9.98, limit: 10 }], has_more: false, next_offset: 50,
            };
            else if (path.endsWith('/ai/chat/stream')) {
                sentChat = route.request().postDataJSON();
                const events = [['open', { conversation_id: 'chat-1' }], ['run_start', usage], ['text_delta', { text: 'The server is healthy.' }], ['done', { conversation_id: 'chat-1', usage }]];
                return route.fulfill({ contentType: 'text/event-stream', body: events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('') });
            }
            else if (path.endsWith('/ai/settings')) {
                if (method === 'PUT') {
                    const body = route.request().postDataJSON();
                    if ('enabled' in body) {
                        if (rejectToggle) return route.fulfill({ status: 500, json: { error: 'Synthetic save failure' } });
                        enabled = body.enabled;
                    }
                }
                payload = { enabled, connections: [connection], default_connection_id: connection.id, max_cost_usd: '0.5', pii_redaction: true, injection_detection: true };
            } else if (path.endsWith('/ai/providers')) payload = { providers: [{ id: 'openai_compatible', label: 'OpenAI-Compatible', available: true, fields: [
                { name: 'endpoint', label: 'API base URL', type: 'url', required: true },
                { name: 'api_key', label: 'API key', type: 'text', secret: true },
            ] }] };
            else if (path.endsWith('/ai/connections/probe')) payload = { models: ['team/default', 'team/reasoning', 'team/fast'], source: 'live',
                model_details: [{ id: 'team/default' }, { id: 'team/reasoning', reasoning: true, tools: true, context_window: 128000, max_output_tokens: 8192, pricing: { input: 1, output: 3 } }, { id: 'team/fast' }] };
            else if (path.endsWith('/ai/connections/connection-1')) {
                savedConnection = route.request().postDataJSON();
                connection = { ...connection, ...savedConnection, secrets_set: ['api_key'] };
                payload = connection;
            } else if (path.endsWith('/ai/connections')) payload = { connections: [connection], default_connection_id: connection.id };
            else if (path.endsWith('/notifications/preferences')) {
                if (method === 'PUT') savedPreferences = route.request().postDataJSON();
                payload = { enabled: true, channels: ['email', 'slack'], severities: ['critical', 'warning'] };
            } else if (path.endsWith('/api-analytics/overview')) payload = { total_requests: 0, avg_response_time_ms: 0, error_rate: 0, success_count: 0 };
            else if (path.endsWith('/views')) payload = { views: [] };
            await route.fulfill({ json: payload });
        });
        const visit = async (pane) => page.goto(`${server.resolvedUrls.local[0]}tests/browser/settings-ui.html?pane=${pane}`);
        await visit('ai');
        await page.locator('#ai-enabled').waitFor();
        await page.locator('#ai-max-cost').fill('1.25');
        await page.getByRole('button', { name: 'Discover models', exact: true }).click();
        await page.getByRole('button', { name: 'Browse models (3)', exact: true }).click();
        await page.getByLabel('Capability', { exact: true }).selectOption('reasoning');
        await page.getByText('1 USD input / 3 USD output per 1M tokens', { exact: false }).waitFor();
        assert.equal(await page.getByRole('option').filter({ hasText: 'team/default' }).count(), 0);
        await page.getByPlaceholder('Search models…').fill('reasoning');
        await page.getByRole('option', { name: /^team\/reasoning/ }).click();
        assert.equal(await page.locator('#ai-model').inputValue(), 'team/reasoning');
        await page.getByRole('button', { name: 'Save connection', exact: true }).click();
        await page.getByText('Connection saved.', { exact: false }).waitFor();
        assert.equal(savedConnection.model, 'team/reasoning');
        assert.equal(savedConnection.config.api_key, undefined, 'Saved secret must not be copied to the browser');
        assert.equal(await page.locator('#ai-max-cost').inputValue(), '1.25', 'Saving a connection erased unsaved limits');
        await page.locator('#ai-enabled').click();
        await page.locator('[data-testid="ai-state"][data-ready="true"]').waitFor({ state: 'attached' });
        await page.reload();
        await page.locator('#ai-enabled[data-state="checked"]').waitFor();
        rejectToggle = true;
        await page.locator('#ai-enabled').click();
        await page.getByRole('alert').filter({ hasText: 'Synthetic save failure' }).waitFor();
        assert.equal(await page.locator('#ai-enabled').getAttribute('data-state'), 'checked');
        rejectToggle = false;
        await page.locator('#ai-enabled').click();
        await page.locator('[data-testid="ai-state"][data-enabled="false"][data-ready="false"]').waitFor({ state: 'attached' });
        await page.screenshot({ path: `test-results/settings-ai-${theme}.png`, fullPage: true });

        await page.getByRole('tab', { name: 'Task models and behavior' }).click();
        await page.locator('#ai-profile-utility-connection').selectOption('connection-1');
        await page.locator('#ai-profile-utility-model').fill('team/cheap');
        await page.getByRole('button', { name: 'Add model candidate' }).first().click();
        await page.locator('#ai-pool-0-model').fill('team/cheap');
        await page.locator('#ai-tier-0').selectOption('budget');
        await page.locator('#ai-routing_enabled').click();
        await page.locator('#ai-routing-sample').fill('Summarize server health');
        await page.getByRole('button', { name: 'Preview routing' }).click();
        await page.getByText('Approved Utility candidate').waitFor();
        await page.locator('#ai-max_output_tokens').fill('1024');
        await page.getByRole('button', { name: 'Save AI management settings' }).click();
        await page.getByText('AI management settings saved.').waitFor();
        assert.equal(management.profiles.utility.model, 'team/cheap');
        assert.equal(management.routing_enabled, true);
        assert.equal(Number(management.max_output_tokens), 1024);
        await page.screenshot({ path: `test-results/settings-ai-management-${theme}.png`, fullPage: true });
        await page.reload();
        await page.getByRole('tab', { name: 'Task models and behavior' }).click();
        assert.equal(await page.locator('#ai-profile-utility-model').inputValue(), 'team/cheap');
        await page.getByRole('tab', { name: 'AI usage', exact: true }).click();
        await page.getByRole('heading', { name: 'Run details' }).waitFor();
        await page.getByRole('button', { name: 'Details', exact: true }).click();
        await page.getByRole('dialog').getByText('Cost source: estimated').waitFor();
        await page.screenshot({ path: `test-results/settings-ai-usage-${theme}.png`, fullPage: true });
        await page.keyboard.press('Escape');
        enabled = true;
        await visit('chat');
        await page.locator('#ai-chat-workflow').selectOption('summarize');
        await page.locator('#ai-chat-profile').selectOption('utility');
        await page.getByRole('textbox', { name: 'Message the assistant' }).fill('Summarize server health');
        await page.getByRole('textbox', { name: 'Message the assistant' }).press('Enter');
        await page.locator('.sk-ai-message__usage summary').click();
        await page.locator('.sk-ai-message__usage summary').getByText('0.02 USD', { exact: false }).waitFor();
        await page.getByText('Conversation cost allowance remaining:', { exact: false }).waitFor();
        assert.equal(sentChat.workflow, 'summarize');
        assert.equal(sentChat.profile, 'utility');
        assert(!sentChat.connection_id, 'A default connection override must not bypass task roles');
        await page.screenshot({ path: `test-results/ai-chat-usage-${theme}.png`, fullPage: true });

        await visit('notifications');
        await page.getByRole('heading', { name: 'Notification Channels' }).waitFor();
        assert.equal(await page.getByRole('switch', { name: 'Slack', exact: true }).count(), 0);
        assert.equal(await page.getByRole('checkbox').count(), 0);
        await Promise.all([
            page.getByRole('button', { name: 'Send Test Notification' }).waitFor({ state: 'visible' }),
            page.getByRole('button', { name: 'Save Preferences' }).waitFor({ state: 'visible' }),
        ]);
        const testButton = await page.getByRole('button', { name: 'Send Test Notification' }).boundingBox();
        const saveButton = await page.getByRole('button', { name: 'Save Preferences' }).boundingBox();
        const footer = await page.locator('.settings-actions--footer').boundingBox();
        assert(saveButton.x - testButton.x - testButton.width >= 12, 'Footer buttons must have a visible gap');
        assert(Math.abs(saveButton.y - testButton.y) < 1, 'Desktop footer actions must align');
        assert(Math.abs(saveButton.x + saveButton.width - footer.x - footer.width) < 2, 'Save belongs at the right edge');
        await page.getByRole('switch', { name: 'Info', exact: true }).click();
        await page.getByRole('button', { name: /Save Preferences/i }).click();
        await page.getByText('Your notification preferences have been saved').waitFor();
        assert(savedPreferences.severities.includes('info'));
        assert(!savedPreferences.channels.includes('slack'), 'Personal preferences must not retain the nonfunctional Slack channel');
        await page.screenshot({ path: `test-results/settings-notifications-${theme}.png`, fullPage: true });
        await page.getByRole('tab', { name: 'Delivery settings' }).click();
        await page.getByRole('button', { name: 'Slack', exact: true }).focus();
        await page.keyboard.press('Enter');
        await page.locator('.channel-config').waitFor();
        for (const display of await page.locator('.channel-config .severity-toggle').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).display))) assert.equal(display, 'flex', 'Form labels must not break severity toggle layout');
        const surfaces = await page.locator('.channel-config').evaluate((node) => [getComputedStyle(node).backgroundColor, getComputedStyle(node.querySelector('input')).backgroundColor]);
        assert.notEqual(surfaces[0], surfaces[1], 'Webhook fields disappear into the form surface');
        await page.screenshot({ path: `test-results/settings-delivery-${theme}.png`, fullPage: true });

        await visit('profile');
        await page.locator('.settings-form input').first().waitFor();
        assert.notEqual(await page.locator('.settings-form').evaluate((node) => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
        await page.screenshot({ path: `test-results/settings-profile-${theme}.png`, fullPage: true });
        await visit('api');
        await page.getByRole('button', { name: 'Create Key' }).waitFor();
        await page.getByText('No API keys yet.').waitFor();
        for (const border of await page.locator('.settings-card > .empty-state').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).borderTopWidth))) assert.equal(border, '0px');
        const create = await page.getByRole('button', { name: 'Create Key' }).boundingBox();
        const webhook = await page.getByRole('button', { name: 'Add Webhook' }).boundingBox();
        assert(create.x > 800 && webhook.x > 800, 'Create actions should share the right side of section headers');
        await page.screenshot({ path: `test-results/settings-api-${theme}.png`, fullPage: true });

        await visit('controls');
        await page.locator('#native-field').waitFor();
        for (const selector of ['#native-field', '#native-select']) {
            const field = await page.locator(selector).evaluate((node) => ({ height: node.getBoundingClientRect().height, bg: getComputedStyle(node).backgroundColor }));
            assert(field.height >= 36, 'FormField left a native control unstyled');
            assert.notEqual(field.bg, 'rgba(0, 0, 0, 0)');
        }
        assert((await page.getByRole('checkbox').boundingBox()).width < 32);
        const chrome = await page.locator('.fixture-chrome > *').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).backgroundColor));
        assert.equal(new Set(chrome).size, 1, 'Shell bars must share one background token');
        await page.setViewportSize({ width: 390, height: 844 });
        for (const pane of ['ai', 'profile', 'notifications', 'api']) {
            await visit(pane);
            await page.locator('.settings-card, .settings-form').first().waitFor();
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${pane} overflows on mobile`);
            if (pane === 'ai') {
                for (const tab of ['Task models and behavior', 'AI usage']) {
                    await page.getByRole('tab', { name: tab, exact: true }).click();
                    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${tab} overflows on mobile`);
                }
                await page.screenshot({ path: `test-results/settings-ai-mobile-${theme}.png`, fullPage: true });
            }
            if (pane === 'notifications') {
                await page.getByRole('button', { name: 'Save Preferences' }).waitFor();
                await page.getByRole('button', { name: 'Send Test Notification' }).waitFor();
                const testAction = await page.getByRole('button', { name: 'Send Test Notification' }).boundingBox();
                const saveAction = await page.getByRole('button', { name: 'Save Preferences' }).boundingBox();
                assert(testAction && saveAction, 'Both mobile footer buttons must be visible');
                assert(saveAction.y - testAction.y - testAction.height >= 12, 'Mobile footer buttons should stack with a gap');
            }
        }
        assert.deepEqual(errors, []);
        await page.close();
        console.log(`Settings ${theme}: model discovery, secret preservation, enable persistence/failure, notifications, surfaces, shell and mobile passed`);
    }
} finally {
    await browser?.close();
    await server.close();
}
