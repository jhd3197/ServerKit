import { useState } from 'react';
import { usePolling } from '../../hooks/usePolling';
import { useTranslation } from 'react-i18next';
import {
    Bell, Copy, Database, Globe, HardDrive, RefreshCw, Rocket, Server, Settings, Trash2,
} from 'lucide-react';
import { FormField, FormRow } from '../FormField';
import { IconButton } from '../IconButton';
import { ProgressBar } from '../ProgressBar';
import { Stepper } from '../ds/Stepper';
import { TreeView } from '../ds/TreeView';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tip } from '@/components/ui/tooltip';
import { NumberField } from '@/components/ui/number-field';
import { Combobox } from '@/components/ui/combobox';
import { TagInput } from '@/components/ui/tag-input';
import { Calendar } from '@/components/ui/calendar';
import { DatePicker, DateRangePicker } from '@/components/ui/date-picker';
import { PinInput } from '@/components/ui/pin-input';
import { Slider } from '@/components/ui/slider';
import { RadioGroup } from '@/components/ui/radio-group';
import { FileDropzone, FileUploadList } from '@/components/ui/file-dropzone';
import { addDays, startOfDay } from '@/lib/dateMath';

const MB = 1024 * 1024;
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/i;
// Upload simulation: percent added per tick, and the tick length.
const UPLOAD_STEP = 7;
const UPLOAD_TICK_MS = 180;

function Demo({ id, title, note, children }) {
    return (
        <section className="styleguide__control-demo" data-demo={id}>
            <header className="styleguide__control-head">
                <h3>{title}</h3>
                {note && <p>{note}</p>}
            </header>
            <div className="styleguide__control-body">{children}</div>
        </section>
    );
}

function State({ label, children }) {
    return (
        <div className="styleguide__control-state">
            <span className="styleguide__control-state-label">{label}</span>
            {children}
        </div>
    );
}

function buildTree(t) {
    return [
        {
            id: 'etc', label: 'etc', children: [
                {
                    id: 'nginx', label: 'nginx', children: [
                        { id: 'nginx.conf', label: 'nginx.conf', meta: '2.4 KB' },
                        {
                            id: 'sites-enabled', label: 'sites-enabled', children: [
                                { id: 'shop.conf', label: 'shop.example.com.conf', meta: '1.1 KB' },
                                { id: 'api.conf', label: 'api.example.com.conf', meta: '0.9 KB' },
                            ],
                        },
                    ],
                },
                { id: 'ssh', label: 'ssh', hasChildren: true },
                { id: 'hosts', label: 'hosts', meta: '212 B' },
            ],
        },
        { id: 'var', label: 'var', hasChildren: true },
        { id: 'locked', label: t('app.styleGuide.controls.treeLocked', 'root (no access)'), disabled: true },
    ];
}

export default function ControlsShowcase() {
    const { t } = useTranslation();
    const today = startOfDay(new Date());

    const [name, setName] = useState('');
    const [workers, setWorkers] = useState(4);
    const [memory, setMemory] = useState(512);
    const [ratio, setRatio] = useState(null);
    const [server, setServer] = useState('web-01');
    const [scopes, setScopes] = useState(['apps:read', 'apps:deploy', 'logs:read', 'backups:read']);
    const [labels, setLabels] = useState(['production']);
    const [labelOptions, setLabelOptions] = useState(['production', 'staging', 'internal'].map((v) => ({ value: v, label: v })));
    const [domains, setDomains] = useState(['example.com', 'www.example.com']);
    const [expires, setExpires] = useState(addDays(today, 30));
    const [range, setRange] = useState({ start: addDays(today, -6), end: today });
    const [inlineDay, setInlineDay] = useState(today);
    const [code, setCode] = useState('');
    const [verified, setVerified] = useState(null);
    const [retention, setRetention] = useState(30);
    const [memoryMb, setMemoryMb] = useState(2048);
    const [ports, setPorts] = useState([3000, 8000]);
    const [strategy, setStrategy] = useState('rolling');
    const [plan, setPlan] = useState('standard');
    const [step, setStep] = useState(2);
    const [treeNodes, setTreeNodes] = useState(() => buildTree(t));
    const [selectedFile, setSelectedFile] = useState('nginx.conf');
    const [uploads, setUploads] = useState([
        { id: 'a', name: 'site-backup-2026-10-24.tar.gz', size: 182 * MB, status: 'done' },
        { id: 'b', name: 'database-dump.sql.gz', size: 48 * MB, status: 'uploading', progress: 62 },
        { id: 'c', name: 'uploads.zip', size: 310 * MB, status: 'error', error: t('app.styleGuide.controls.uploadErrorDemo', 'The connection dropped at 41%.') },
        { id: 'd', name: 'media-library.zip', size: 96 * MB, status: 'queued' },
    ]);
    const [saving, setSaving] = useState(false);

    // Move the "uploading" rows forward so the list reads as live.
    usePolling(() => {
        setUploads((items) => items.map((item) => {
            if (item.status !== 'uploading') return item;
            const progress = Math.min(100, (item.progress || 0) + UPLOAD_STEP);
            return progress >= 100 ? { ...item, status: 'done', progress: 100 } : { ...item, progress };
        }));
    }, UPLOAD_TICK_MS, { immediate: false });

    const servers = [
        { value: 'web-01', label: 'web-01', description: t('app.styleGuide.controls.hostWeb01', '10.0.0.11 · Ubuntu 24.04'), icon: Server, group: t('app.styleGuide.controls.groupProduction', 'Production') },
        { value: 'web-02', label: 'web-02', description: t('app.styleGuide.controls.hostWeb02', '10.0.0.12 · Ubuntu 24.04'), icon: Server, group: t('app.styleGuide.controls.groupProduction', 'Production') },
        { value: 'db-01', label: 'db-01', description: t('app.styleGuide.controls.hostDb01', '10.0.0.21 · Debian 13'), icon: Database, group: t('app.styleGuide.controls.groupProduction', 'Production') },
        { value: 'staging', label: 'staging-01', description: t('app.styleGuide.controls.hostStaging', '10.0.1.5 · Rocky 9'), icon: Server, group: t('app.styleGuide.controls.groupStaging', 'Staging') },
        { value: 'edge', label: 'edge-ams', description: t('app.styleGuide.controls.offline', 'Offline'), icon: Globe, group: t('app.styleGuide.controls.groupStaging', 'Staging'), disabled: true },
    ];
    const scopeOptions = ['apps:read', 'apps:deploy', 'apps:delete', 'logs:read', 'backups:read', 'backups:restore', 'dns:write']
        .map((value) => ({ value, label: value }));

    const loadChildren = (node) => new Promise((resolve) => {
        setTimeout(() => {
            const children = node.id === 'ssh'
                ? [{ id: 'sshd_config', label: 'sshd_config', meta: '3.3 KB' }, { id: 'ssh_config', label: 'ssh_config', meta: '1.5 KB' }]
                : [{ id: 'log', label: 'log', hasChildren: true }, { id: 'www', label: 'www', hasChildren: true }];
            const attach = (nodes) => nodes.map((item) => (item.id === node.id
                ? { ...item, children }
                : item.children ? { ...item, children: attach(item.children) } : item));
            setTreeNodes((nodes) => attach(nodes));
            resolve();
        }, 700);
    });

    const steps = [
        { id: 'source', label: t('app.styleGuide.controls.stepSource', 'Source'), description: 'github.com/acme/shop' },
        { id: 'build', label: t('app.styleGuide.controls.stepBuild', 'Build'), description: t('app.styleGuide.controls.stepBuildNote', 'Node 20 detected') },
        { id: 'configure', label: t('app.styleGuide.controls.stepConfigure', 'Configure') },
        { id: 'deploy', label: t('app.styleGuide.controls.stepDeploy', 'Deploy') },
    ];

    return (
        <div className="styleguide__controls">
            {/* ── TIER 1 ── */}
            <Demo
                id="form-field"
                title={t('app.styleGuide.controls.formFieldTitle', 'Form field wiring')}
                note={t('app.styleGuide.controls.formFieldNote', 'The control gets the id, aria-describedby, aria-invalid and aria-required from FormField. No htmlFor needed.')}
            >
                <FormRow>
                    <FormField label={t('app.styleGuide.controls.serviceName', 'Service name')} hint={t('app.styleGuide.controls.serviceNameHint', 'Lowercase letters, numbers and dashes.')} required>
                        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="shop-api" />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.healthPath', 'Health check path')} error={t('app.styleGuide.controls.healthPathError', 'Must start with a slash.')} required>
                        <Input defaultValue="healthz" />
                    </FormField>
                </FormRow>
                <FormField label={t('app.styleGuide.controls.notes', 'Notes')} hint={t('app.styleGuide.controls.notesHint', 'Shown to everyone with access to this service.')}>
                    <Textarea rows={2} />
                </FormField>
            </Demo>

            <Demo
                id="tooltip"
                title={t('app.styleGuide.controls.tooltipTitle', 'Tooltip')}
                note={t('app.styleGuide.controls.tooltipNote', 'Shows on hover and on keyboard focus. Moving along a row of icon buttons skips the delay.')}
            >
                <div className="styleguide__control-row">
                    <IconButton icon={<RefreshCw size={16} />} label={t('app.styleGuide.controls.restart', 'Restart service')} shortcut="R" />
                    <IconButton icon={<Copy size={16} />} label={t('app.styleGuide.controls.copyUrl', 'Copy URL')} />
                    <IconButton icon={<Settings size={16} />} label={t('app.styleGuide.controls.settings', 'Settings')} />
                    <IconButton icon={<Bell size={16} />} label={t('app.styleGuide.controls.alerts', 'Alert rules')} />
                    <IconButton icon={<Trash2 size={16} />} label={t('app.styleGuide.controls.delete', 'Delete')} />
                    <Tip content={t('app.styleGuide.controls.deployDisabledWhy', 'A deploy is already running')}>
                        <span className="styleguide__control-tip-wrap">
                            <Button size="sm" disabled>{t('app.styleGuide.controls.deploy', 'Deploy')}</Button>
                        </span>
                    </Tip>
                </div>
            </Demo>

            <Demo
                id="progress"
                title={t('app.styleGuide.controls.progressTitle', 'Progress bar')}
                note={t('app.styleGuide.controls.progressNote', 'role="progressbar" with value text; semantic tones; indeterminate for unknown length.')}
            >
                <div className="styleguide__control-stack">
                    <State label={t('app.styleGuide.controls.progressDisk', 'Disk · 48 of 100 GB')}>
                        <ProgressBar percent={48} label={t('app.styleGuide.controls.disk', 'Disk')} valueText="48 of 100 GB" />
                    </State>
                    <State label={t('app.styleGuide.controls.progressMemory', 'Memory · 78%')}>
                        <ProgressBar percent={78} tone="warning" size="md" label={t('app.styleGuide.controls.memory', 'Memory')} />
                    </State>
                    <State label={t('app.styleGuide.controls.progressCpu', 'CPU · 94%')}>
                        <ProgressBar percent={94} tone="danger" size="md" label={t('app.styleGuide.controls.cpu', 'CPU')} />
                    </State>
                    <State label={t('app.styleGuide.controls.progressPulling', 'Pulling image')}>
                        <ProgressBar indeterminate label={t('app.styleGuide.controls.pulling', 'Pulling image')} />
                    </State>
                </div>
            </Demo>

            <Demo
                id="button-loading"
                title={t('app.styleGuide.controls.loadingTitle', 'Button loading')}
                note={t('app.styleGuide.controls.loadingNote', 'The label stays in the layout, so the button keeps its width. aria-busy while it lasts.')}
            >
                <div className="styleguide__control-row">
                    <Button loading loadingText={t('common.editing.saving', 'Saving…')}>{t('app.styleGuide.controls.saveChanges', 'Save changes')}</Button>
                    <Button variant="outline" loading>{t('app.styleGuide.controls.testConnection', 'Test connection')}</Button>
                    <Button variant="danger" loading>{t('app.styleGuide.controls.delete', 'Delete')}</Button>
                    <Button
                        variant="outline"
                        loading={saving}
                        onClick={() => { setSaving(true); setTimeout(() => setSaving(false), 1600); }}
                    >
                        <Rocket size={16} />
                        {t('app.styleGuide.controls.tryIt', 'Click to try')}
                    </Button>
                </div>
            </Demo>

            {/* ── TIER 2 ── */}
            <Demo
                id="number-field"
                title={t('app.styleGuide.controls.numberTitle', 'Number field')}
                note={t('app.styleGuide.controls.numberNote', '↑/↓ step, Shift or PageUp/PageDown ×10, Home/End jump to the bounds. Hold a stepper to repeat.')}
            >
                <div className="styleguide__control-grid">
                    <FormField label={t('app.styleGuide.controls.workers', 'Workers')} hint="1–64">
                        <NumberField value={workers} onChange={setWorkers} min={1} max={64} />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.memoryLimit', 'Memory limit')} hint={t('app.styleGuide.controls.memoryHint', 'Steps of 128 MB')}>
                        <NumberField value={memory} onChange={setMemory} min={128} max={16384} step={128} unit="MB" />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.sampleRate', 'Sample rate')} error={ratio === null ? t('app.styleGuide.controls.required', 'Required') : null} required>
                        <NumberField value={ratio} onChange={setRatio} min={0} max={1} step={0.05} placeholder="0.25" />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.disabled', 'Disabled')}>
                        <NumberField value={3} min={1} disabled />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.compact', 'Compact')}>
                        <NumberField value={workers} onChange={setWorkers} min={1} max={64} size="sm" />
                    </FormField>
                </div>
            </Demo>

            <Demo
                id="combobox"
                title={t('app.styleGuide.controls.comboboxTitle', 'Combobox')}
                note={t('app.styleGuide.controls.comboboxNote', 'Searchable single or multiple choice with groups, descriptions and disabled options. Multiple stays open and toggles.')}
            >
                <div className="styleguide__control-grid">
                    <FormField label={t('app.styleGuide.controls.server', 'Server')}>
                        <Combobox options={servers} value={server} onChange={setServer} placeholder={t('app.styleGuide.controls.pickServer', 'Pick a server')} />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.apiScopes', 'API key scopes')}>
                        <Combobox multiple options={scopeOptions} value={scopes} onChange={setScopes} placeholder={t('app.styleGuide.controls.pickScopes', 'Choose scopes')} />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.labels', 'Labels')} hint={t('app.styleGuide.controls.labelsHint', 'Type a new label to create it.')}>
                        <Combobox
                            multiple
                            creatable
                            options={labelOptions}
                            value={labels}
                            onChange={setLabels}
                            onCreate={(text) => {
                                setLabelOptions((options) => [...options, { value: text, label: text }]);
                                setLabels((current) => [...current, text]);
                            }}
                        />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.empty', 'Empty')} error={t('app.styleGuide.controls.pickOne', 'Pick at least one server.')}>
                        <Combobox options={servers} value={null} onChange={() => {}} />
                    </FormField>
                </div>
            </Demo>

            <Demo
                id="tag-input"
                title={t('app.styleGuide.controls.tagTitle', 'Tag input')}
                note={t('app.styleGuide.controls.tagNote', 'Enter, comma or Tab adds; paste a list to add many; Backspace removes the last. Duplicates flash instead of repeating.')}
            >
                <FormField label={t('app.styleGuide.controls.domains', 'Domains')} hint={t('app.styleGuide.controls.domainsHint', 'Try “not a domain” or paste “a.com, b.com”.')}>
                    <TagInput
                        value={domains}
                        onChange={setDomains}
                        normalize={(text) => text.trim().toLowerCase()}
                        validate={(text) => (DOMAIN_PATTERN.test(text) ? null : t('app.styleGuide.controls.notADomain', '“{{value}}” is not a domain.', { value: text }))}
                        placeholder={t('app.styleGuide.controls.addDomain', 'Add a domain')}
                    />
                </FormField>
            </Demo>

            <Demo
                id="dates"
                title={t('app.styleGuide.controls.datesTitle', 'Date and range pickers')}
                note={t('app.styleGuide.controls.datesNote', 'Arrows move by day and week, PageUp/PageDown by month, Shift for a year. Month and weekday names follow the panel language.')}
            >
                <div className="styleguide__control-grid">
                    <FormField label={t('app.styleGuide.controls.keyExpires', 'Key expires')}>
                        <DatePicker value={expires} onChange={setExpires} min={today} />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.logRange', 'Log range')}>
                        <DateRangePicker value={range} onChange={setRange} max={today} />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.empty', 'Empty')}>
                        <DatePicker value={null} onChange={() => {}} />
                    </FormField>
                </div>
                <div className="styleguide__control-calendar">
                    <Calendar value={inlineDay} onChange={setInlineDay} min={addDays(today, -10)} max={addDays(today, 60)} />
                    <Calendar mode="range" months={2} value={range} onChange={(next) => { if (next.end) setRange(next); }} max={today} />
                </div>
            </Demo>

            <Demo
                id="pin-input"
                title={t('app.styleGuide.controls.pinTitle', 'Pin input')}
                note={t('app.styleGuide.controls.pinNote', 'Typing advances, Backspace walks back, paste fills every cell. Try 123456.')}
            >
                <div className="styleguide__control-row styleguide__control-row--top">
                    <FormField
                        label={t('app.styleGuide.controls.authCode', 'Authenticator code')}
                        hint={verified === null ? t('app.styleGuide.controls.authCodeHint', 'Six digits from your app.') : null}
                        error={verified === false ? t('app.styleGuide.controls.authCodeWrong', 'That code did not match. Try again.') : null}
                    >
                        <PinInput
                            length={6}
                            groupSize={3}
                            value={code}
                            onChange={(next) => { setCode(next); if (next.length < 6) setVerified(null); }}
                            onComplete={(full) => setVerified(full === '123456')}
                        />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.recoveryCode', 'Recovery code')}>
                        <PinInput length={8} type="alphanumeric" groupSize={4} value="A7K2" onChange={() => {}} />
                    </FormField>
                </div>
                {verified && <p className="styleguide__control-ok">{t('app.styleGuide.controls.verified', 'Verified.')}</p>}
            </Demo>

            <Demo
                id="slider"
                title={t('app.styleGuide.controls.sliderTitle', 'Slider')}
                note={t('app.styleGuide.controls.sliderNote', 'Single value or a range, with marks and a formatted readout.')}
            >
                <div className="styleguide__control-stack">
                    <FormField label={t('app.styleGuide.controls.logRetention', 'Log retention')}>
                        <Slider value={retention} onChange={setRetention} min={1} max={90} unit={t('app.styleGuide.controls.days', 'days')} />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.memoryLimit', 'Memory limit')}>
                        <Slider
                            value={memoryMb}
                            onChange={setMemoryMb}
                            min={256}
                            max={8192}
                            step={256}
                            marks={[256, 2048, 4096, 8192]}
                            format={(mb) => (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`)}
                        />
                    </FormField>
                    <FormField label={t('app.styleGuide.controls.portRange', 'Port range')}>
                        <Slider value={ports} onChange={setPorts} min={1024} max={9999} step={1} aria-label={t('app.styleGuide.controls.portRange', 'Port range')} />
                    </FormField>
                </div>
            </Demo>

            <Demo
                id="radio"
                title={t('app.styleGuide.controls.radioTitle', 'Radio group')}
                note={t('app.styleGuide.controls.radioNote', 'For a few options that deserve to be read side by side. Arrow keys move and select.')}
            >
                <div className="styleguide__control-split">
                    <RadioGroup
                        aria-label={t('app.styleGuide.controls.strategy', 'Deploy strategy')}
                        value={strategy}
                        onValueChange={setStrategy}
                        options={[
                            { value: 'rolling', label: t('app.styleGuide.controls.rolling', 'Rolling'), description: t('app.styleGuide.controls.rollingNote', 'Replace containers one at a time. No downtime.') },
                            { value: 'recreate', label: t('app.styleGuide.controls.recreate', 'Recreate'), description: t('app.styleGuide.controls.recreateNote', 'Stop everything, then start the new version.') },
                            { value: 'manual', label: t('app.styleGuide.controls.manual', 'Manual'), description: t('app.styleGuide.controls.manualNote', 'Requires an admin.'), disabled: true },
                        ]}
                    />
                    <RadioGroup
                        variant="card"
                        orientation="horizontal"
                        aria-label={t('app.styleGuide.controls.storage', 'Storage')}
                        value={plan}
                        onValueChange={setPlan}
                        options={[
                            { value: 'standard', label: t('app.styleGuide.controls.local', 'Local disk'), description: t('app.styleGuide.controls.localNote', 'Fast. Lost if the server is.'), icon: HardDrive },
                            { value: 'replicated', label: t('app.styleGuide.controls.s3', 'S3 compatible'), description: t('app.styleGuide.controls.s3Note', 'Off-site copy after each backup.'), icon: Database },
                        ]}
                    />
                </div>
            </Demo>

            <Demo
                id="stepper"
                title={t('app.styleGuide.controls.stepperTitle', 'Stepper')}
                note={t('app.styleGuide.controls.stepperNote', 'Completed steps are buttons back; later steps stay inert. A step can carry its own error status.')}
            >
                <Stepper steps={steps} current={step} onStepClick={(index) => setStep(index)} />
                <div className="styleguide__control-row">
                    <Button size="sm" variant="outline" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
                        {t('common.actions.back', 'Back')}
                    </Button>
                    <Button size="sm" disabled={step >= steps.length} onClick={() => setStep((s) => s + 1)}>
                        {t('common.actions.next', 'Next')}
                    </Button>
                </div>
                <div className="styleguide__control-split">
                    <Stepper
                        orientation="vertical"
                        current={2}
                        steps={[
                            { id: 'pull', label: t('app.styleGuide.controls.pull', 'Pull image'), description: t('app.styleGuide.controls.pullTime', '12.4 s') },
                            { id: 'migrate', label: t('app.styleGuide.controls.migrate', 'Run migrations'), description: t('app.styleGuide.controls.migrationsApplied', '3 applied') },
                            { id: 'health', label: t('app.styleGuide.controls.health', 'Health check'), description: t('app.styleGuide.controls.healthFailed', '503 after 30 s'), status: 'error' },
                            { id: 'switch', label: t('app.styleGuide.controls.switch', 'Switch traffic') },
                        ]}
                    />
                </div>
            </Demo>

            <Demo
                id="tree"
                title={t('app.styleGuide.controls.treeTitle', 'Tree view')}
                note={t('app.styleGuide.controls.treeNote', 'Arrows walk and open branches, * opens siblings, typing jumps to a name. ssh and var load their children lazily.')}
            >
                <div className="styleguide__control-tree">
                    <TreeView
                        aria-label={t('app.styleGuide.controls.files', 'Files')}
                        nodes={treeNodes}
                        defaultExpandedIds={['etc', 'nginx', 'sites-enabled']}
                        selectedId={selectedFile}
                        onSelect={(node) => setSelectedFile(node.id)}
                        onLoadChildren={loadChildren}
                    />
                </div>
            </Demo>

            <Demo
                id="dropzone"
                title={t('app.styleGuide.controls.dropzoneTitle', 'File dropzone and upload list')}
                note={t('app.styleGuide.controls.dropzoneNote', 'Type and size are re-checked on drop. Each file reports its own progress, error and retry.')}
            >
                <FileDropzone
                    accept=".zip,.tar.gz,.sql,.gz"
                    maxSize={512 * MB}
                    onFiles={(files) => setUploads((items) => [
                        ...files.map((file, index) => ({ id: `${file.name}-${Date.now()}-${index}`, name: file.name, size: file.size, status: 'uploading', progress: 0 })),
                        ...items,
                    ])}
                />
                <FileUploadList
                    items={uploads}
                    onRetry={(item) => setUploads((items) => items.map((x) => (x.id === item.id ? { ...x, status: 'uploading', progress: 0, error: null } : x)))}
                    onRemove={(item) => setUploads((items) => items.filter((x) => x.id !== item.id))}
                    onCancel={(item) => setUploads((items) => items.filter((x) => x.id !== item.id))}
                />
                <FileDropzone compact disabled title={t('app.styleGuide.controls.dropDisabled', 'Uploads are paused while a restore runs')} />
            </Demo>
        </div>
    );
}
