// Render actual Settings components with synthetic responses; no backend needed.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

async function withinDeadline(signal) {
    let timer;
    try {
        return await Promise.race([
            signal,
            new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('Expected API request was not sent within 10 seconds')), 10000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

const users = [
    { id: 1, username: 'operator', email: 'operator@example.test', role: 'admin', is_active: true, totp_enabled: true, passkey_enabled: true },
    { id: 2, username: 'needs-mfa', email: 'second@example.test', role: 'admin', is_active: true, totp_enabled: false },
    { id: 3, username: 'disabled-admin', email: 'disabled@example.test', role: 'admin', is_active: false, totp_enabled: false },
].map((user) => ({ ...user, auth_provider: 'local', permissions: {}, created_at: '2026-08-15T14:30:00Z' }));
const invitations = [{ id: 1, email: 'invite@example.test', role: 'viewer', status: 'pending', token: 'synthetic', created_at: '2026-08-15T14:30:00Z', expires_at: '2099-01-01T00:00:00Z', is_expired: false }];

const server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, open: false } });
let browser;
try {
    await server.listen();
    const base = server.resolvedUrls.local[0];
    browser = await chromium.launch({ headless: true });
    await mkdir('test-results', { recursive: true });
    for (const theme of ['dark', 'light']) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        await context.addInitScript((value) => {
            localStorage.setItem('access_token', 'synthetic-browser-fixture');
            document.addEventListener('DOMContentLoaded', () => {
                document.documentElement.setAttribute('data-theme', value);
            }, { once: true });
        }, theme);
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        let resolveUsers;
        const ready = new Promise((resolve) => { resolveUsers = resolve; });
        let empty = false;
        let fail = false;
        let deletes = 0;
        let releaseDelete;
        let notifyDelete;
        const deleteStarted = new Promise((resolve) => { notifyDelete = resolve; });
        let revokes = 0;
        let releaseRevoke;
        let notifyRevoke;
        const revokeStarted = new Promise((resolve) => { notifyRevoke = resolve; });
        await page.route('**/api/v1/**', async (route) => {
            const url = new URL(route.request().url());
            let payload = {};
            if (url.pathname.endsWith('/admin/users') && route.request().method() === 'GET') {
                await ready;
                if (fail) return route.fulfill({ status: 500, json: { error: 'Synthetic users failure' } });
                payload = { users: empty ? [] : users };
            } else if (/\/admin\/users\/\d+$/.test(url.pathname) && route.request().method() === 'DELETE') {
                deletes += 1;
                await new Promise((resolve) => { releaseDelete = resolve; notifyDelete(); });
                return route.fulfill({ json: { message: 'Deleted' } });
            } else if (url.pathname.endsWith('/auth/setup-status')) payload = { needs_setup: false };
            else if (url.pathname.endsWith('/auth/me')) payload = { user: users[0] };
            else if (url.pathname.includes('/admin/invitations') && route.request().method() === 'DELETE') {
                revokes += 1;
                await new Promise((resolve) => { releaseRevoke = resolve; notifyRevoke(); });
                return route.fulfill({ status: 500, json: { error: 'Synthetic revoke failure' } });
            }
            else if (url.pathname.includes('/admin/invitations')) payload = { invitations };
            else if (url.pathname.endsWith('/auth/login-links')) payload = { links: [] };
            else if (url.pathname.endsWith('/views')) payload = { views: [] };
            await route.fulfill({ json: payload });
        });
        await page.goto(`${base}tests/browser/settings.html`);
        await page.getByText('Loading users…', { exact: true }).waitFor();
        resolveUsers();
        await page.locator('.users-table').first().getByText('needs-mfa', { exact: true }).waitFor();
        await page.getByText('invite@example.test', { exact: true }).waitFor();
        const surfaces = await page.locator('.users-table-container').evaluateAll((nodes) => nodes.map((node) => {
            const style = getComputedStyle(node);
            return { color: style.backgroundColor, surface: style.getPropertyValue('--surface').trim() };
        }));
        assert.equal(surfaces.length, 2);
        for (const surface of surfaces) assert.notEqual(surface.color, 'rgba(0, 0, 0, 0)', `${theme} table has no resting surface`);
        await page.screenshot({ path: `test-results/settings-${theme}.png`, fullPage: true });
        assert.equal(await page.getByRole('columnheader', { name: /^2FA\b/ }).count(), 1);
        assert.equal(await page.getByRole('columnheader', { name: /^Passkey\b/ }).count(), 1);

        await page.getByRole('button', { name: 'All users', exact: true }).click();
        await page.getByRole('button', { name: 'Admins without 2FA', exact: true }).click();
        await page.locator('.users-table').first().getByText('needs-mfa', { exact: true }).waitFor();
        assert.equal(await page.locator('.users-table').first().locator('tbody tr').count(), 1);
        assert.equal(await page.locator('.users-table').first().getByText('disabled-admin', { exact: true }).count(), 0);

        await page.getByRole('button', { name: 'Delete user', exact: true }).click();
        await page.getByRole('alertdialog').waitFor();
        await page.getByRole('alertdialog').getByRole('button', { name: 'Delete user', exact: true }).click();
        await withinDeadline(deleteStarted);
        await page.waitForFunction(() => document.querySelector('.users-table button[aria-busy="true"]'));
        assert.equal(await page.locator('.users-table').first().locator('tbody button:not(:disabled)').count(), 0);
        assert.equal(deletes, 1);
        releaseDelete();
        await page.locator('.users-table').first().getByText('needs-mfa', { exact: true }).waitFor();

        const inviteSection = page.locator('.invitations-section');
        await inviteSection.getByRole('button', { name: 'Revoke', exact: true }).click();
        await withinDeadline(revokeStarted);
        assert.equal(await inviteSection.getByRole('button', { name: 'Revoke', exact: true }).isDisabled(), true);
        assert.equal(await inviteSection.getByRole('button', { name: 'Resend', exact: true }).isDisabled(), true);
        assert.equal(revokes, 1);
        releaseRevoke();
        await inviteSection.getByRole('alert').filter({ hasText: 'Synthetic revoke failure' }).waitFor();
        assert.equal(await inviteSection.getByRole('button', { name: 'Revoke', exact: true }).isEnabled(), true);

        empty = true;
        await page.reload();
        await page.locator('.users-tab .empty-state').first().waitFor();
        fail = true;
        await page.reload();
        await page.getByRole('alert').filter({ hasText: 'Synthetic users failure' }).waitFor();
        assert.deepEqual(errors, []);
        await context.close();
        console.log(`Settings ${theme}: surfaces, 2FA view, guarded delete/revoke, loading, empty and error states passed`);
    }
} finally {
    await browser?.close();
    await server.close();
}
