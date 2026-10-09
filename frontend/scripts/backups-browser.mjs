import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';

// Real query/mutation/form hooks and the production schedule modal. Only HTTP,
// current workspace, toast output and translation are controlled boundaries.
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {WorkspaceTestContext} from '/src/contexts/useWorkspace.js';
import {useBackupSchedules} from '/src/hooks/useBackupSchedules.js';
import AddScheduleModal from '/src/components/backups/AddScheduleModal.jsx';
window.calls=[];window.messages=[];window.workspace='one';
window.toast={error:value=>window.messages.push(['error',value]),success:value=>window.messages.push(['success',value])};
window.rows={one:[{id:1,name:'Daily',enabled:true,next_run_at:'2026-09-06T02:00:00-04:00',timezone:'America/New_York'}],two:[{id:2,name:'Other workspace',enabled:true}]};
window.testApi={
 getBackupSchedules:()=>{window.calls.push(['get',window.workspace]);const result={schedules:window.rows[window.workspace].map(row=>({...row})),timezone:'America/New_York'};return window.holdRead?new Promise(resolve=>window.finishRead=()=>resolve(result)):Promise.resolve(result)},
 addBackupSchedule:(...args)=>{window.calls.push(['create',...args]);return new Promise((resolve,reject)=>{window.finishCreate=()=>{window.rows.one.push({id:3,name:args[0],enabled:true});resolve({id:3})};window.failCreate=()=>reject(Object.assign(new Error('Please fix the field'),{fieldErrors:{name:'Already exists'}}))})},
 updateBackupSchedule:(id,body)=>{window.calls.push(['toggle',id,body]);window.rows[window.workspace]=window.rows[window.workspace].map(row=>row.id===id?{...row,...body}:row);return Promise.resolve({})},
 removeBackupSchedule:id=>{window.calls.push(['remove',id]);window.rows[window.workspace]=window.rows[window.workspace].filter(row=>row.id!==id);return Promise.resolve({})}
};
function Screen(){const store=useBackupSchedules();const [open,setOpen]=useState(true);return <>
 <output id="rows">{JSON.stringify(store.schedules)}</output>
 <button id="toggle" onClick={()=>store.toggle(store.schedules[0])}>Toggle</button>
 <button id="remove" onClick={()=>store.remove(store.schedules[0].id)}>Remove</button>
 <button id="open" onClick={()=>setOpen(true)}>Create</button>
 <AddScheduleModal open={open} onClose={()=>setOpen(false)} onCreate={store.create} onCreated={()=>setOpen(false)} remoteEnabled timezone={store.timezone}/>
 </>}
function App(){const [workspace,setWorkspace]=useState('one');window.changeWorkspace=()=>{window.workspace='two';setWorkspace('two')};return <WorkspaceTestContext.Provider value={{activeWorkspaceId:workspace}}><Screen/></WorkspaceTestContext.Provider>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`;
const server = await createServer({
    root, configFile: false, logLevel: 'error', resolve: { alias: { '@': path.join(root, 'src') } },
    cacheDir: path.join(root, 'node_modules/.vite-backups-regression'),
    optimizeDeps: { entries: [] }, server: { host: '127.0.0.1', port: 0 },
    plugins: [{
        name: 'backup-regression-fixtures', enforce: 'pre',
        resolveId(id) {
            if (id === 'react-i18next') return '\0test-i18n';
            if (id.endsWith('/backups-fixture.jsx')) return path.join(root, 'backups-fixture.jsx');
        },
        load(id) {
            const normalized = id.replaceAll('\\', '/');
            if (id === '\0test-i18n') return `const t=(key,fallback)=>typeof fallback==='string'?fallback:key;export const useTranslation=()=>({t});`;
            if (normalized.endsWith('/src/contexts/useWorkspace.js')) return `import {createContext,useContext} from 'react';export const WorkspaceTestContext=createContext({});export const useWorkspace=()=>useContext(WorkspaceTestContext);`;
            if (normalized.endsWith('/src/contexts/useToast.js')) return `export const useToast=()=>window.toast;`;
            if (normalized.endsWith('/src/services/api.js') || normalized.endsWith('/src/services/api/index.js')) return `export default new Proxy({}, {get:(_,key)=>(...args)=>window.testApi[key](...args)});`;
            if (normalized.endsWith('/backups-fixture.jsx')) return fixture;
        },
        configureServer(vite) {
            vite.middlewares.use('/backups-check', async (_req, res) => {
                res.setHeader('Content-Type', 'text/html');
                res.end(await vite.transformIndexHtml('/backups-check', '<div id="root"></div><script type="module" src="/backups-fixture.jsx"></script>'));
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
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/backups-check`);
    await page.getByLabel('Schedule name', { exact: false }).fill('Daily 2');
    await page.getByLabel('Service name', { exact: false }).fill('my-app');
    assert.equal(await page.locator('.form-field__hint').textContent(), 'America/New_York');
    await page.evaluate(() => {
        const form = document.querySelector('[data-walkthrough="backup-schedule-form"]');
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => window.calls.filter(([type]) => type === 'create').length === 1);
    assert.equal(await page.locator('[data-walkthrough="backup-schedule-submit"]').isDisabled(), true);
    await page.evaluate(() => window.failCreate());
    await page.getByText('Already exists', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Schedule name', { exact: false }).inputValue(), 'Daily 2');
    await page.getByLabel('Schedule name', { exact: false }).fill('Unique schedule');
    await page.locator('[data-walkthrough="backup-schedule-submit"]').click();
    await page.waitForFunction(() => window.calls.filter(([type]) => type === 'create').length === 2);
    await page.evaluate(() => window.finishCreate());
    await page.locator('[data-walkthrough="backup-schedule-form"]').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#rows').textContent.includes('Unique schedule'));
    console.log('PASS duplicate-submit guard, inline server errors, preserved input, retry and creation cache invalidation');

    await page.locator('#toggle').click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('#rows').textContent)[0].enabled === false);
    await page.locator('#remove').click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('#rows').textContent).length === 1);
    assert.equal(await page.evaluate(() => window.messages.filter(([type]) => type === 'success').length), 2);
    await page.evaluate(() => { window.holdRead = true; window.changeWorkspace(); });
    await page.waitForFunction(() => Boolean(window.finishRead));
    assert.deepEqual(JSON.parse(await page.locator('#rows').textContent()), []);
    await page.evaluate(() => window.finishRead());
    await page.waitForFunction(() => document.querySelector('#rows').textContent.includes('Other workspace'));
    assert.deepEqual(errors, []);
    console.log('PASS toggle/delete query invalidation and workspace isolation while a new workspace request is pending');
} finally {
    await browser?.close();
    await server.close();
}
