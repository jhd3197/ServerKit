import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

// The real File Manager. Opening a folder while the previous one was still
// loading let the slow answer land last and navigate the user back to the
// folder they had just left. Only HTTP, toasts and translation are stubbed.
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter} from 'react-router-dom';
import FileManager from '/src/pages/FileManager.jsx';
import {ConfirmProvider} from '/src/contexts/ConfirmContext.jsx';
window.pending=[];
const listing=(p)=>({path:p,parent:p==='/'?null:p.replace(/\\/[^/]+$/,'')||'/',entries:p==='/home'?[{name:'projects',path:'/home/projects',is_dir:true,type:'directory',size:0,permissions:'drwxr-xr-x',permissions_octal:'750'}]:[{name:'inside-'+p.split('/').pop()+'.txt',path:p+'/x.txt',is_dir:false,type:'file',size:1}]});
window.release=(p)=>{const i=window.pending.findIndex(x=>x.path===p);const x=window.pending.splice(i,1)[0];x.resolve(listing(p));};
window.testApi={
 browseFiles:(p)=>(window.calls=window.calls||[]).push(p)&&window.holdAll||p!=='/home'?new Promise(resolve=>window.pending.push({path:p,resolve})):Promise.resolve(listing(p)),
 getDiskMounts:()=>Promise.resolve({mounts:[]}),
 browseRemoteFiles:(sid,p)=>{(window.remoteCalls=window.remoteCalls||[]).push([sid,p]);return Promise.resolve({path:p,parent:null,entries:[{name:'on-agent.txt',path:p+'/on-agent.txt',is_dir:false,type:'file',size:1}]});},
 createDirectory:(p)=>{(window.ops=window.ops||[]).push(['mkdir',p]);return Promise.resolve({});},
 renameFile:(p,n)=>{(window.ops=window.ops||[]).push(['rename',p,n]);return Promise.resolve({});},
 changeFilePermissions:(p,m)=>{(window.ops=window.ops||[]).push(['chmod',p,m]);return Promise.resolve({});},
};
createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[window.initialPath || '/files']}><ConfirmProvider><FileManager/></ConfirmProvider></MemoryRouter>);
`;
const server = await createServer({
    root, configFile: false, logLevel: 'error', resolve: { alias: { '@': path.join(root, 'src') } },
    cacheDir: path.join(root, 'node_modules/.vite-file-manager-regression'),
    optimizeDeps: { entries: [] }, server: { host: '127.0.0.1', port: 0 },
    plugins: [{
        name: 'file-manager-fixtures', enforce: 'pre',
        resolveId(id) {
            if (id === 'react-i18next') return '\0test-i18n';
            if (id.endsWith('/fm-fixture.jsx')) return path.join(root, 'fm-fixture.jsx');
        },
        load(id) {
            const normalized = id.replaceAll('\\', '/');
            if (id === '\0test-i18n') return `const t=(key,f)=>typeof f==='string'?f:(f&&(f.defaultValue_other||f.defaultValue))||key;export const useTranslation=()=>({t,i18n:{language:'en'}});export const Trans=({children})=>children;export const initReactI18next={type:'3rdParty',init(){}};`;
            if (normalized.endsWith('/src/contexts/useAuth.js')) return `import {createContext} from 'react';export const AuthContext=createContext(null);const auth={user:{id:1,role:'admin'},isAdmin:true,isAuthenticated:true,hasPermission:()=>true};export const useAuth=()=>auth;`;
            if (normalized.endsWith('/src/contexts/useWorkspace.js')) return `const ws={activeWorkspaceId:null,workspaces:[],setActiveWorkspace(){}};export const useWorkspace=()=>ws;`;
            if (normalized.endsWith('/src/contexts/useToast.js')) return `const toast={error(m){(window.toasts=window.toasts||[]).push(m)},success(){},info(){},warning(){}};export const useToast=()=>toast;`;
            if (normalized.endsWith('/src/services/api.js') || normalized.endsWith('/src/services/api/index.js')) return `const api=new Proxy({}, {get:(_,key)=>(...args)=>(window.testApi[key]?window.testApi[key](...args):Promise.resolve({}))});export {api};export default api;`;
            if (normalized.endsWith('/src/components/ServerPicker.jsx')) return `export default function ServerPicker({onChange}){return <button type="button" onClick={()=>onChange('7',{name:'edge',allowed_paths:[]})}>pick-agent</button>;}`;
            if (normalized.endsWith('/fm-fixture.jsx')) return fixture;
        },
        configureServer(vite) {
            vite.middlewares.use('/fm-check', async (_req, res) => {
                res.setHeader('Content-Type', 'text/html');
                res.end(await vite.transformIndexHtml('/fm-check', '<div id="root"></div><script type="module" src="/fm-fixture.jsx"></script>'));
            });
        },
    }, react()],
});
const executablePath = [process.env.CHROME_PATH, chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(candidate => candidate && existsSync(candidate));
let browser;
try {
    await server.listen();
    browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);

    // Open /home/projects (held), then go back Home before it answers.
    await page.getByText('projects', { exact: true }).first().dblclick();
    await page.waitForFunction(() => window.pending.some(x => x.path === '/home/projects'));
    await page.evaluate(() => { window.holdAll = true; });
    await page.getByTitle('Home', { exact: true }).first().click();
    await page.waitForFunction(() => window.pending.some(x => x.path === '/home'));
    await page.evaluate(() => window.release('/home'));
    await page.getByText('projects', { exact: true }).first().waitFor();

    // The answer for the folder the user left arrives last.
    await page.evaluate(() => window.release('/home/projects'));
    await page.waitForTimeout(400);
    assert.deepEqual(await page.evaluate(() => window.calls.filter(c => c === '/home/projects').length), 1,
        'a late answer for the previous folder navigated the user back into it');
    assert.equal(await page.getByText('inside-projects.txt').count(), 0);
    assert.equal(await page.getByText('projects', { exact: true }).count() > 0, true);
    assert.deepEqual(errors, []);
    console.log('PASS a slow listing for a folder the user left does not pull them back');

    // Blocked site data: every localStorage access throws. The view prefs
    // used to read it unguarded during render, which took the page down.
    const blocked = await browser.newPage();
    const blockedErrors = [];
    blocked.on('pageerror', error => blockedErrors.push(error.message));
    await blocked.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
        });
    });
    await blocked.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await blocked.getByText('projects', { exact: true }).first().waitFor();
    assert.deepEqual(blockedErrors, []);
    console.log('PASS the File Manager renders and browses with storage blocked');

    // The dialogs: each owns its input, prefilled from the entry, and hands
    // the answer back to the page.
    const dlg = await browser.newPage();
    const dlgErrors = [];
    dlg.on('pageerror', error => dlgErrors.push(error.message));
    await dlg.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await dlg.getByText('projects', { exact: true }).first().waitFor();
    const lastOp = () => dlg.evaluate(() => (window.ops || []).at(-1));

    await dlg.getByRole('button', { name: 'New folder' }).first().click();
    await dlg.getByPlaceholder('new-folder').fill('assets');
    await dlg.getByRole('button', { name: 'Create folder' }).click();
    await dlg.waitForFunction(() => (window.ops || []).length === 1);
    assert.deepEqual(await lastOp(), ['mkdir', '/home/assets']);
    assert.equal(await dlg.getByPlaceholder('new-folder').count(), 0, 'new-folder dialog stayed open');

    await dlg.getByTitle('Rename').first().click();
    const renameInput = dlg.getByRole('dialog').getByRole('textbox');
    assert.equal(await renameInput.inputValue(), 'projects');
    await renameInput.fill('work');
    await renameInput.press('Enter');
    await dlg.waitForFunction(() => (window.ops || []).length === 2);
    assert.deepEqual(await lastOp(), ['rename', '/home/projects', 'work']);

    await dlg.getByTitle('Permissions').first().click();
    // Found by its label: the label is associated with the field.
    const modeInput = dlg.getByLabel('Permissions (octal)');
    assert.equal(await modeInput.inputValue(), '750');
    await modeInput.fill('700');
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await dlg.waitForFunction(() => (window.ops || []).length === 3);
    assert.deepEqual(await lastOp(), ['chmod', '/home/projects', '700']);
    assert.deepEqual(dlgErrors, []);
    console.log('PASS new-folder, rename and permissions dialogs prefill and submit');

    // Switching to a remote agent that advertises no allowed paths keeps the
    // same path, so the listing has to reload because the source changed, or
    // the panel host's /home stays on screen under a remote header.
    const sw = await browser.newPage();
    const swErrors = [];
    sw.on('pageerror', error => swErrors.push(error.message));
    await sw.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await sw.getByText('projects', { exact: true }).first().waitFor();
    await sw.getByRole('button', { name: 'pick-agent' }).first().click();
    await sw.getByText('on-agent.txt').first().waitFor({ timeout: 5000 });
    assert.deepEqual(await sw.evaluate(() => window.remoteCalls), [['7', '/home']]);
    assert.equal(await sw.getByText('projects', { exact: true }).count(), 0, 'the panel host listing is still shown');
    assert.deepEqual(swErrors, []);
    console.log('PASS switching to a remote agent reloads the listing from that agent');

    // A local request still in flight must not replace the agent's listing.
    const late = await browser.newPage();
    await late.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await late.getByText('projects', { exact: true }).first().waitFor();
    await late.getByText('projects', { exact: true }).first().dblclick();
    await late.waitForFunction(() => window.pending.some(x => x.path === '/home/projects'));
    await late.getByRole('button', { name: 'pick-agent' }).click();
    await late.getByText('on-agent.txt').first().waitFor();
    await late.evaluate(() => window.release('/home/projects'));
    await late.waitForTimeout(100);
    assert.equal(await late.getByText('inside-projects.txt').count(), 0);
    // Back carries a disabledReason, so it is aria-disabled (focusable), not natively disabled.
    assert.equal(await late.getByRole('button', { name: 'Back', exact: true }).getAttribute('aria-disabled'), 'true',
        'navigation history must not cross storage targets');
    console.log('PASS late local responses and history cannot cross a target switch');

    // Search responses and canceled searches must not overwrite navigation.
    const search = await browser.newPage();
    await search.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await search.getByText('projects', { exact: true }).first().waitFor();
    await search.evaluate(() => {
        window.testApi.searchFiles = () => new Promise(resolve => { window.finishSearch = resolve; });
    });
    await search.getByPlaceholder('Search files…').fill('old');
    await search.getByPlaceholder('Search files…').press('Enter');
    await search.waitForFunction(() => Boolean(window.finishSearch));
    await search.getByTitle('Home', { exact: true }).click();
    // Home is already the current folder, so explicitly refresh it.
    await search.locator('.file-manager-toolbar').getByTitle('Refresh', { exact: true }).click();
    await search.getByText('projects', { exact: true }).first().waitFor();
    await search.evaluate(() => window.finishSearch({ results: [{ name: 'stale-result.txt', path: '/old', is_dir: false }] }));
    await search.waitForTimeout(100);
    assert.equal(await search.getByText('stale-result.txt').count(), 0);
    console.log('PASS a late search cannot overwrite a refreshed directory');
    await search.getByPlaceholder('Search files…').fill('cancel me');
    await search.getByPlaceholder('Search files…').press('Enter');
    await search.locator('.search-field-clear').click();
    await search.evaluate(() => window.finishSearch({ results: [{ name: 'canceled-result.txt', path: '/old', is_dir: false }] }));
    await search.waitForTimeout(100);
    assert.equal(await search.getByText('canceled-result.txt').count(), 0);
    console.log('PASS clearing search invalidates its pending response');

    // Read A, then B; A arriving last must not become B's editable contents.
    const editor = await browser.newPage();
    const editorErrors = [];
    editor.on('pageerror', error => editorErrors.push(error.message));
    await editor.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await editor.getByText('projects', { exact: true }).first().waitFor();
    await editor.evaluate(() => {
        window.reads = {};
        window.testApi.browseFiles = p => Promise.resolve({ path: p, parent: '/', entries:
            ['a.txt', 'b.txt'].map(name => ({ name, path: p + '/' + name, is_dir: false, is_editable: true, size: 1 })) });
        window.testApi.readFile = p => new Promise(resolve => { window.reads[p] = resolve; });
        window.testApi.writeFile = () => Promise.reject(new Error('disk full'));
    });
    await editor.locator('.file-manager-toolbar').getByTitle('Refresh', { exact: true }).click();
    await editor.getByText('a.txt', { exact: true }).first().dblclick();
    await editor.waitForFunction(() => Boolean(window.reads['/home/a.txt']));
    await editor.getByText('b.txt', { exact: true }).first().dblclick();
    await editor.waitForFunction(() => Boolean(window.reads['/home/b.txt']));
    await editor.evaluate(() => window.reads['/home/b.txt']({ content: 'new-content' }));
    await editor.getByLabel('File contents').getByText('new-content', { exact: true }).waitFor();
    await editor.evaluate(() => window.reads['/home/a.txt']({ content: 'old-content' }));
    await editor.waitForTimeout(100);
    assert.equal(await editor.getByText('old-content', { exact: true }).count(), 0);
    const preview = editor.getByRole('complementary', { name: 'File preview' });
    await preview.getByRole('button', { name: 'Edit', exact: true }).click();
    await preview.locator('textarea').fill('unsaved draft');
    await preview.getByRole('button', { name: 'Save', exact: true }).click();
    await editor.waitForFunction(() => (window.toasts || []).length > 0);
    assert.equal(await preview.locator('textarea').inputValue(), 'unsaved draft');
    await editor.evaluate(() => {
        const browse = window.testApi.browseRemoteFiles;
        window.testApi.browseRemoteFiles = (...args) => new Promise(resolve => {
            window.releaseEditorTarget = () => resolve(browse(...args));
        });
    });
    await editor.getByRole('button', { name: 'pick-agent' }).click();
    await editor.waitForFunction(() => Boolean(window.releaseEditorTarget));
    await preview.waitFor({ state: 'detached' });
    await editor.evaluate(() => window.releaseEditorTarget());
    await editor.getByText('on-agent.txt').first().waitFor();
    assert.equal(await preview.count(), 0, 'the previous target preview stayed open');
    assert.deepEqual(editorErrors, []);
    console.log('PASS preview read races, failed-save draft retention and target reset');

    // Shared confirmation must preserve cancel/confirm semantics.
    const deletion = await browser.newPage();
    await deletion.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await deletion.getByText('projects', { exact: true }).first().waitFor();
    await deletion.evaluate(() => {
        window.deleted = [];
        window.testApi.deleteFile = p => { window.deleted.push(p); return Promise.resolve({}); };
    });
    await deletion.getByTitle('Delete', { exact: true }).first().click();
    await deletion.getByRole('alertdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.deepEqual(await deletion.evaluate(() => window.deleted), []);
    await deletion.getByTitle('Delete', { exact: true }).first().click();
    await deletion.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
    await deletion.waitForFunction(() => window.deleted.length === 1);
    assert.deepEqual(await deletion.evaluate(() => window.deleted), ['/home/projects']);
    console.log('PASS shared delete confirmation cancels or executes the intended path');

    // Back/forward still works after moving the toolbar into its own component.
    const nav = await browser.newPage();
    await nav.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await nav.getByText('projects', { exact: true }).first().waitFor();
    await nav.getByText('projects', { exact: true }).first().dblclick();
    await nav.waitForFunction(() => window.pending.some(x => x.path === '/home/projects'));
    await nav.evaluate(() => window.release('/home/projects'));
    await nav.getByText('inside-projects.txt').waitFor();
    await nav.getByTitle('Back', { exact: true }).click();
    await nav.getByText('projects', { exact: true }).first().waitFor();
    assert.equal(await nav.getByTitle('Forward', { exact: true }).isDisabled(), false);
    await nav.getByTitle('Forward', { exact: true }).click();
    await nav.waitForFunction(() => window.pending.some(x => x.path === '/home/projects'));
    await nav.evaluate(() => window.release('/home/projects'));
    await nav.getByText('inside-projects.txt').waitFor();
    console.log('PASS directory back and forward navigation');

    const transfer = await browser.newPage();
    await transfer.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await transfer.getByText('projects', { exact: true }).first().waitFor();
    await transfer.evaluate(() => {
        window.uploadPaths = [];
        window.testApi.uploadFile = (p, file, progress) => {
            window.uploadPaths.push([p, file.name]);
            progress(50);
            return new Promise(resolve => { window.finishUpload = resolve; });
        };
    });
    await transfer.locator('input[type="file"]').setInputFiles({ name: 'upload.txt', mimeType: 'text/plain', buffer: Buffer.from('test') });
    await transfer.waitForFunction(() => Boolean(window.finishUpload));
    await transfer.getByText('projects', { exact: true }).first().dblclick();
    await transfer.waitForFunction(() => window.pending.some(x => x.path === '/home/projects'));
    await transfer.evaluate(() => window.release('/home/projects'));
    await transfer.getByText('inside-projects.txt').waitFor();
    const callsBeforeUpload = await transfer.evaluate(() => window.calls.length);
    await transfer.evaluate(() => window.finishUpload({}));
    await transfer.getByText('Uploads complete', { exact: true }).waitFor();
    assert.deepEqual(await transfer.evaluate(() => window.uploadPaths), [['/home', 'upload.txt']]);
    assert.equal(await transfer.evaluate(() => window.calls.length), callsBeforeUpload,
        'finishing an upload must not reload or navigate to the previous directory');
    console.log('PASS uploads retain their destination without disrupting later navigation');

    const images = await browser.newPage();
    await images.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await images.getByText('projects', { exact: true }).first().waitFor();
    await images.evaluate(() => {
        window.blobCalls = [];
        window.testApi.getFileBlob = p => { window.blobCalls.push(p); return Promise.resolve(new Blob(['x'])); };
        window.testApi.browseRemoteFiles = (_id, p) => Promise.resolve({ path: p, entries: [{ name: 'remote.png', path: p + '/remote.png', is_dir: false }] });
    });
    await images.getByRole('button', { name: 'pick-agent' }).click();
    await images.getByText('remote.png', { exact: true }).first().dblclick();
    await images.getByText('Image preview unavailable', { exact: true }).waitFor();
    assert.deepEqual(await images.evaluate(() => window.blobCalls), []);
    console.log('PASS agent image previews never fetch files from the panel host');

    const tree = await browser.newPage();
    await tree.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await tree.getByText('projects', { exact: true }).first().waitFor();
    await tree.evaluate(() => {
        const browse = window.testApi.browseFiles;
        window.testApi.browseFiles = p => p === '/srv'
            ? new Promise(resolve => { window.finishTree = resolve; }) : browse(p);
    });
    const treeRow = tree.locator('.tree-row').filter({ has: tree.locator('.tree-name[title="/srv"]') });
    await treeRow.getByRole('button', { name: 'Expand', exact: true }).click();
    await tree.waitForFunction(() => Boolean(window.finishTree));
    await tree.getByRole('button', { name: 'pick-agent' }).click();
    await tree.getByText('on-agent.txt').first().waitFor();
    await tree.evaluate(() => window.finishTree({ entries: [{ name: 'local-tree-child', path: '/srv/local-tree-child', is_dir: true }] }));
    await tree.waitForTimeout(100);
    assert.equal(await tree.getByText('local-tree-child', { exact: true }).count(), 0);
    console.log('PASS late tree responses cannot populate another target cache');

    const failed = await browser.newPage();
    await failed.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await failed.getByText('projects', { exact: true }).first().waitFor();
    await failed.evaluate(() => {
        window.testApi.browseFiles = () => Promise.reject(new Error('permission denied'));
    });
    await failed.locator('.file-manager-toolbar').getByTitle('Refresh', { exact: true }).click();
    await failed.getByText("Couldn't open this folder.", { exact: true }).waitFor();
    assert.equal(await failed.getByText('This folder is empty', { exact: true }).count(), 0);
    console.log('PASS listing failures remain errors rather than empty folders');

    const deepLink = await browser.newPage();
    await deepLink.addInitScript(() => { window.initialPath = '/files?path=/var/www'; });
    await deepLink.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await deepLink.waitForFunction(() => window.pending.some(x => x.path === '/var/www'));
    await deepLink.evaluate(() => window.release('/var/www'));
    await deepLink.getByText('inside-www.txt', { exact: true }).waitFor();
    assert.equal(await deepLink.getByText('projects', { exact: true }).count(), 0);
    assert.equal(await deepLink.getByRole('button', { name: 'Back', exact: true }).getAttribute('aria-disabled'), 'true');
    console.log('PASS initial deep links retain their directory and history');

    const clearing = await browser.newPage();
    await clearing.goto(`http://127.0.0.1:${server.httpServer.address().port}/fm-check`);
    await clearing.getByText('projects', { exact: true }).first().waitFor();
    await clearing.getByPlaceholder('Search files…').fill('draft query');
    await clearing.getByText('projects', { exact: true }).first().dblclick();
    await clearing.waitForFunction(() => window.pending.some(x => x.path === '/home/projects'));
    await clearing.locator('.search-field-clear').click();
    assert.equal(await clearing.locator('.file-manager-main').getByText('projects', { exact: true }).count(), 0,
        'clearing a query must not expose the previous directory listing while browsing');
    await clearing.evaluate(() => {
        while (window.pending.some(x => x.path === '/home/projects')) window.release('/home/projects');
    });
    await clearing.getByText('inside-projects.txt', { exact: true }).waitFor();
    console.log('PASS clearing a query during navigation preserves the pending directory load');
} finally {
    await browser?.close();
    await server.close();
}
