import { useState } from 'react';
import useTabParam from '../hooks/useTabParam';
import { useLogsDrawer } from '../contexts/LogsDrawerContext';
import {
    Palette, Type, Box, Layout, Square, ToggleLeft, AlertTriangle,
    Info, CheckCircle, Search, Plus, Trash2, Edit3,
    Download, RefreshCw, Settings, Eye, Copy, ChevronRight, Server, Database, Globe,
    Shield, Lock, Zap, Activity, BarChart3, Cloud, Layers,
    Inbox, Table, AlertCircle, FileText, Monitor, Key, FolderOpen,
    GitBranch, WifiOff, Clock
} from 'lucide-react';
import { PageTopbar, SearchField, CatalogCard, CatalogGrid } from '@/components/ds';
import CopyField from '../components/CopyField';
import PortField from '../components/PortField';
import EnvEditor from '../components/EnvEditor';
import ServerPicker from '../components/ServerPicker';
import DomainField from '../components/DomainField';
import { LOCAL_SERVER_ID } from '../utils/serverTarget';
import Modal from '../components/Modal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import StatusBadge from '../components/StatusBadge';
import EmptyState from '../components/EmptyState';
import { PageSkeleton, PAGE_SKELETON_VARIANTS } from '../components/PageSkeleton';
import { Spinner } from '../components/Spinner';
import { StatCard, StatsGrid } from '../components/StatCard';
import { DangerZone } from '../components/DangerZone';
import { InfoList, InfoItem } from '../components/InfoList';
import { ProgressBar } from '../components/ProgressBar';
import { MetricRow, MetricItem } from '../components/MetricRow';
import { LogViewer } from '../components/LogViewer';
import { ProcessTable, ProcessDetailsPanel } from '../components/ProcessTable';
import { ServiceCard, ServicesGrid } from '../components/ServiceCard';
import { JournalControls } from '../components/JournalControls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';
import {
    Sheet, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription, SheetClose,
} from '@/components/ui/sheet';
import { Card as SharedCard, CardHeader as SharedCardHeader, CardContent as SharedCardContent, CardFooter as SharedCardFooter } from '@/components/ui/card';

const SECTIONS = [
    { id: 'colors', labelKey: 'app.styleGuide.colors', label: 'Colors', icon: Palette },
    { id: 'typography', labelKey: 'app.styleGuide.typography', label: 'Typography', icon: Type },
    { id: 'spacing', labelKey: 'app.styleGuide.spacingRadius', label: 'Spacing and radius', icon: Box },
    { id: 'buttons', labelKey: 'app.styleGuide.buttons', label: 'Buttons', icon: Square },
    { id: 'forms', labelKey: 'app.styleGuide.forms', label: 'Forms', icon: ToggleLeft },
    { id: 'fields', labelKey: 'app.styleGuide.sharedFields', label: 'Shared fields', icon: Key },
    { id: 'tables', labelKey: 'app.styleGuide.tables', label: 'Tables', icon: Table },
    { id: 'cards', labelKey: 'app.styleGuide.cardsStats', label: 'Cards and stats', icon: Layout },
    { id: 'badges', labelKey: 'app.styleGuide.badgesStatus', label: 'Badges and status', icon: Shield },
    { id: 'alerts', labelKey: 'app.styleGuide.alertsErrors', label: 'Alerts and errors', icon: AlertCircle },
    { id: 'modals', labelKey: 'app.styleGuide.modalsDialogs', label: 'Modals and dialogs', icon: Layers },
    { id: 'tabs', labelKey: 'app.styleGuide.tabs', label: 'Tabs', icon: ChevronRight },
    { id: 'lists', labelKey: 'app.styleGuide.listsInfo', label: 'Lists and info', icon: Database },
    { id: 'feedback', labelKey: 'app.styleGuide.feedbackLoading', label: 'Feedback and loading', icon: Activity },
    { id: 'empty', labelKey: 'app.styleGuide.states', label: 'States', icon: Inbox },
    { id: 'pageheaders', labelKey: 'app.styleGuide.pageHeaders', label: 'Page headers', icon: FileText },
    { id: 'patterns', labelKey: 'app.styleGuide.pagePatterns', label: 'Page patterns', icon: Monitor },
    { id: 'utilities', labelKey: 'app.styleGuide.utilities', label: 'Utilities', icon: Zap },
];

const SECTION_IDS = SECTIONS.map(s => s.id);
const MANY_TAB_ITEMS = [
    ['overview', 'Overview'],
    ['docker', 'Docker'],
    ['metrics', 'Metrics'],
    ['settings', 'Settings'],
    ['cron', 'Cron Jobs'],
    ['packages', 'Packages'],
    ['services', 'Services'],
    ['security', 'Security'],
    ['cloudflared', 'Cloudflared'],
    ['terminal', 'Terminal'],
    ['logs', 'Logs'],
    ['backups', 'Backups'],
];

export default function StyleGuide() {
    const { t } = useTranslation();
    const [activeSection, setActiveSection] = useTabParam('/style-guide', SECTION_IDS, 'colors');
    const { openDrawer } = useLogsDrawer();
    const [modalOpen, setModalOpen] = useState(false);
    const [sheetSide, setSheetSide] = useState('right');
    const [sheetOpen, setSheetOpen] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmVariant, setConfirmVariant] = useState('danger');
    const [controlledDemoTab, setControlledDemoTab] = useState('general');
    const [halfDemoTab, setHalfDemoTab] = useState('summary');
    const [halfOverflowTab, setHalfOverflowTab] = useState('overview');
    const [inputValue, setInputValue] = useState('');
    const [selectValue, setSelectValue] = useState('');
    const [portValue, setPortValue] = useState(8080);
    const [envRows, setEnvRows] = useState([{ key: 'NODE_ENV', value: 'production' }, { key: 'API_TOKEN', value: 'demo-token' }]);
    const [serverValue, setServerValue] = useState(LOCAL_SERVER_ID);
    const [domainValue, setDomainValue] = useState('');
    const [checkValue, setCheckValue] = useState(false);
    const sections = SECTIONS;

    return (
        <div className="styleguide">
            <PageTopbar
                icon={<Palette size={18} />}
                title={t('app.styleGuide.styleGuide', 'Style guide')}
                meta="Design system reference — dev only"
            />

            <Tabs value={activeSection} onValueChange={setActiveSection}>
                <TabsList>
                    {sections.map(s => (
                        <TabsTrigger key={s.id} value={s.id}>
                            <s.icon size={14} />
                            {s.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>

            <div className="styleguide__content">

                {/* ── COLORS ── */}
                {activeSection === 'colors' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.backgroundColors', 'Background colors')} />
                        <div className="styleguide__swatch-grid">
                            <Swatch name="--bg-body" label={t('app.styleGuide.body', 'Body')} />
                            <Swatch name="--bg-sidebar" label={t('app.styleGuide.sidebar', 'Sidebar')} />
                            <Swatch name="--bg-card" label={t('app.styleGuide.card', 'Card')} />
                            <Swatch name="--bg-hover" label={t('app.styleGuide.hover', 'Hover')} />
                            <Swatch name="--bg-elevated" label={t('app.styleGuide.elevated', 'Elevated')} />
                            <Swatch name="--bg-secondary" label={t('app.styleGuide.secondary', 'Secondary')} />
                            <Swatch name="--bg-tertiary" label={t('app.styleGuide.tertiary', 'Tertiary')} />
                        </div>

                        <SectionTitle title={t('app.styleGuide.borderColors', 'Border colors')} />
                        <div className="styleguide__swatch-grid">
                            <Swatch name="--border-default" label={t('common.labels.default', 'Default')} />
                            <Swatch name="--border-subtle" label={t('app.styleGuide.subtle', 'Subtle')} />
                            <Swatch name="--border-active" label={t('app.styleGuide.active', 'Active')} />
                            <Swatch name="--border-hover" label={t('app.styleGuide.hover', 'Hover')} />
                        </div>

                        <SectionTitle title={t('app.styleGuide.textColors', 'Text colors')} />
                        <div className="styleguide__swatch-grid">
                            <Swatch name="--text-primary" label={t('app.styleGuide.primary', 'Primary')} text />
                            <Swatch name="--text-secondary" label={t('app.styleGuide.secondary', 'Secondary')} text />
                            <Swatch name="--text-tertiary" label={t('app.styleGuide.tertiary', 'Tertiary')} text />
                        </div>

                        <SectionTitle title={t('app.styleGuide.accentColors', 'Accent colors')} />
                        <div className="styleguide__swatch-grid">
                            <Swatch name="--accent-primary" label={t('app.styleGuide.primary', 'Primary')} />
                            <Swatch name="--accent-hover" label={t('app.styleGuide.hover', 'Hover')} />
                            <Swatch name="--accent-glow" label={t('app.styleGuide.glow', 'Glow')} />
                        </div>

                        <SectionTitle title={t('app.styleGuide.semanticColors', 'Semantic colors')} />
                        <div className="styleguide__swatch-grid">
                            <SwatchStatic color="#10b981" label={t('app.styleGuide.success', 'Success')} token="$success" />
                            <SwatchStatic color="rgba(16,185,129,0.1)" label={t('app.styleGuide.successBg', 'Success BG')} token="$success-bg" />
                            <SwatchStatic color="#f59e0b" label={t('common.labels.warning', 'Warning')} token="$warning" />
                            <SwatchStatic color="rgba(245,158,11,0.1)" label={t('app.styleGuide.warningBg', 'Warning BG')} token="$warning-bg" />
                            <SwatchStatic color="#ef4444" label={t('app.styleGuide.danger', 'Danger')} token="$danger" />
                            <SwatchStatic color="rgba(239,68,68,0.1)" label={t('app.styleGuide.dangerBg', 'Danger BG')} token="$danger-bg" />
                            <SwatchStatic color="#3b82f6" label={t('common.labels.info', 'Info')} token="$info" />
                            <SwatchStatic color="rgba(59,130,246,0.1)" label={t('app.styleGuide.infoBg', 'Info BG')} token="$info-bg" />
                        </div>

                        <SectionTitle title={t('app.styleGuide.brandColors', 'Brand colors')} />
                        <div className="styleguide__swatch-grid">
                            <SwatchStatic color="#f29111" label={t('app.styleGuide.mysql', 'MySQL')} token="$color-mysql" />
                            <SwatchStatic color="#336791" label={t('app.styleGuide.postgresql', 'PostgreSQL')} token="$color-postgresql" />
                            <SwatchStatic color="#2496ed" label={t('common.labels.docker', 'Docker')} token="$color-docker" />
                            <SwatchStatic color="#777bb4" label="PHP" token="$color-php" />
                            <SwatchStatic color="#3776ab" label={t('app.styleGuide.python', 'Python')} token="$color-python" />
                            <SwatchStatic color="#21759b" label={t('app.styleGuide.wordpress', 'WordPress')} token="$color-wordpress" />
                        </div>
                    </div>
                )}

                {/* ── TYPOGRAPHY ── */}
                {activeSection === 'typography' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.fontFamilies', 'Font families')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <p className="styleguide__font-sample">
                                <span className="styleguide__description styleguide__description--muted">$font-main:</span><br />
                                {t('app.styleGuide.theQuickBrownFoxJumpsOver', 'The quick brown fox jumps over the lazy dog (IBM Plex Sans)')}
                            </p>
                            <p className="styleguide__code-sample">
                                <span className="styleguide__description styleguide__description--muted">$font-mono:</span><br />
                                {'const server = createApp(); // IBM Plex Mono'}
                            </p>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.fontSizes', 'Font sizes')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            {[
                                ['$text-xs', '12px'], ['$text-sm', '13px'],
                                ['$text-base', '14px'], ['$text-md', '16px'],
                                ['$text-lg', '18px'], ['$text-xl', '24px'],
                                ['$text-2xl', '32px'],
                            ].map(([token, size]) => (
                                <div key={token} className="styleguide__token-row">
                                    <span className="styleguide__token-name styleguide__token-name--font">{token}</span>
                                    <span style={{ fontSize: size }}>{size} {t('app.styleGuide.theQuickBrownFox', 'The quick brown fox')}</span>
                                </div>
                            ))}
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.fontWeights', 'Font weights')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            {[['Normal (400)', 400], ['Medium (500)', 500], ['Semibold (600)', 600]].map(([label, weight]) => (
                                <p key={weight} className="styleguide__weight-sample" style={{ fontWeight: weight }}>
                                    {label} {t('app.styleGuide.theQuickBrownFoxJumpsOver2', 'The quick brown fox jumps over the lazy dog')}
                                </p>
                            ))}
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.headingTags', 'Heading tags')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <h1>{t('app.styleGuide.h1PageTitle', 'h1: Page title')}</h1>
                            <h2>{t('app.styleGuide.h2SectionTitle', 'h2: Section title')}</h2>
                            <h3>{t('app.styleGuide.h3CardTitle', 'h3: Card title')}</h3>
                            <h4>{t('app.styleGuide.h4Subsection', 'h4: Subsection')}</h4>
                            <h5>{t('app.styleGuide.h5MinorHeading', 'h5: Minor heading')}</h5>
                            <p>{t('app.styleGuide.pBodyTextParagraphWithNormal', 'p: Body text paragraph with normal weight and base font size.')}</p>
                            <p className="text-secondary">{t('app.styleGuide.pTextSecondarySecondaryParagraphText', 'p.text-secondary: Secondary paragraph text.')}</p>
                            <p className="text-tertiary">{t('app.styleGuide.pTextTertiaryTertiaryMutedParagraph', 'p.text-tertiary: Tertiary/muted paragraph text.')}</p>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.textUtilityClasses', 'Text utility classes')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <p className="text-primary">.text-primary</p>
                            <p className="text-secondary">.text-secondary</p>
                            <p className="text-tertiary">.text-tertiary</p>
                            <p className="text-success">.text-success</p>
                            <p className="text-warning">.text-warning</p>
                            <p className="text-danger">.text-danger</p>
                            <p className="text-accent">.text-accent</p>
                        </SharedCard>
                    </div>
                )}

                {/* ── SPACING & RADIUS ── */}
                {activeSection === 'spacing' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.spacingScale', 'Spacing scale')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            {[
                                ['$space-1', 4], ['$space-2', 8], ['$space-3', 12], ['$space-4', 16],
                                ['$space-5', 20], ['$space-6', 24], ['$space-8', 32], ['$space-10', 40],
                                ['$space-12', 48], ['$space-16', 64],
                            ].map(([token, px]) => (
                                <div key={token} className="styleguide__token-row styleguide__token-row--spacing">
                                    <span className="styleguide__token-name styleguide__token-name--spacing">{token}</span>
                                    <span className="styleguide__token-value">{px}px</span>
                                    <div className="styleguide__spacing-bar" style={{ width: px }} />
                                </div>
                            ))}
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.borderRadius', 'Border radius')} />
                        <div className="styleguide__swatch-grid">
                            {[
                                ['$radius-sm', '4px'], ['$radius-md', '6px'], ['$radius-lg', '8px'],
                                ['$radius-xl', '12px'], ['$radius-2xl', '16px'], ['$radius-full', '9999px'],
                            ].map(([token, val]) => (
                                <SharedCard variant="legacy" key={token} className="card styleguide__swatch-card">
                                    <div className="styleguide__radius-box" style={{ borderRadius: val }} />
                                    <span className="styleguide__description styleguide__description--muted styleguide__description--mono">{token}</span>
                                    <span className="styleguide__description">{val}</span>
                                </SharedCard>
                            ))}
                        </div>

                        <SectionTitle title={t('app.styleGuide.shadows', 'Shadows')} />
                        <div className="styleguide__swatch-grid">
                            {['sm', 'md', 'lg'].map(size => (
                                <SharedCard variant="legacy" key={size} className="card styleguide__swatch-card">
                                    <div className="styleguide__shadow-box" style={{ boxShadow: `var(--shadow-${size})` }} />
                                    <span className="styleguide__description styleguide__description--muted styleguide__description--mono">$shadow-{size}</span>
                                </SharedCard>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── BUTTONS ── */}
                {activeSection === 'buttons' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.buttonVariants', 'Button variants')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="styleguide__actions styleguide__actions--section-end">
                                <Button><Plus size={16} /> {t('app.styleGuide.primary', 'Primary')}</Button>
                                <Button variant="outline"><Edit3 size={16} /> {t('app.styleGuide.outline', 'Outline')}</Button>
                                <Button variant="destructive"><Trash2 size={16} /> {t('app.styleGuide.destructive', 'Destructive')}</Button>
                                <Button variant="ghost"><Eye size={16} /> {t('app.styleGuide.ghost', 'Ghost')}</Button>
                                <Button variant="secondary"><Settings size={16} /> {t('app.styleGuide.secondary', 'Secondary')}</Button>
                            </div>
                            <div className="styleguide__actions">
                                <Button disabled>{t('app.styleGuide.disabledPrimary', 'Disabled primary')}</Button>
                                <Button variant="outline" disabled>{t('app.styleGuide.disabledOutline', 'Disabled outline')}</Button>
                                <Button variant="destructive" disabled>{t('app.styleGuide.disabledDestructive', 'Disabled destructive')}</Button>
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.buttonSizes', 'Button sizes')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="styleguide__actions styleguide__actions--aligned">
                                <Button size="sm">{t('app.styleGuide.small', 'Small')}</Button>
                                <Button>{t('common.labels.default', 'Default')}</Button>
                                <Button size="lg">{t('app.styleGuide.large', 'Large')}</Button>
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.iconButtons', 'Icon buttons')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="styleguide__actions">
                                <Button size="icon"><Plus size={16} /></Button>
                                <Button size="icon" variant="outline"><Edit3 size={16} /></Button>
                                <Button size="icon" variant="destructive"><Trash2 size={16} /></Button>
                                <Button size="icon" variant="ghost"><Settings size={16} /></Button>
                                <Button size="icon" variant="ghost"><Copy size={16} /></Button>
                                <Button size="icon" variant="ghost"><RefreshCw size={16} /></Button>
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.fullWidthLoading', 'Full width and loading')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <Button className="styleguide__full-width-button">{t('app.styleGuide.fullWidthButton', 'Full width button')}</Button>
                            <div className="styleguide__actions">
                                <Button disabled>
                                    <Spinner size="sm" />
                                    {t('common.editing.saving', 'Saving…')}
                                </Button>
                                <Button variant="outline" disabled>
                                    <Spinner size="sm" />
                                    {t('common.loading', 'Loading…')}
                                </Button>
                            </div>
                        </SharedCard>
                    </div>
                )}

                {/* ── FORMS ── */}
                {activeSection === 'forms' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.textInputs', 'Text inputs')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="form-group">
                                <label>{t('app.styleGuide.defaultInput', 'Default input')}</label>
                                <Input type="text" placeholder={t('app.styleGuide.enterText', 'Enter text…')} value={inputValue} onChange={e => setInputValue(e.target.value)} />
                                <span className="hint">{t('app.styleGuide.thisIsAHintTextBelow', 'This is a hint text below the input.')}</span>
                            </div>
                            <div className="form-group">
                                <label>{t('app.styleGuide.disabledInput', 'Disabled input')}</label>
                                <Input type="text" placeholder={t('app.styleGuide.disabled', 'Disabled…')} disabled />
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.selectTextarea', 'Select and textarea')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="form-group">
                                <Label htmlFor="sg-select">{t('app.styleGuide.selectDropdown', 'Select dropdown')}</Label>
                                <Select value={selectValue} onValueChange={setSelectValue}>
                                    <SelectTrigger id="sg-select">
                                        <SelectValue placeholder={t('app.styleGuide.chooseAnOption', 'Choose an option…')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1">{t('app.styleGuide.option1', 'Option 1')}</SelectItem>
                                        <SelectItem value="2">{t('app.styleGuide.option2', 'Option 2')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="form-group">
                                <label>{t('app.styleGuide.textarea', 'Textarea')}</label>
                                <Textarea rows={3} placeholder={t('app.styleGuide.enterMultilineText', 'Enter multiline text…')} />
                            </div>
                            <div className="form-group">
                                <label>{t('app.styleGuide.codeEditor', 'Code editor')}</label>
                                <Textarea className="code-editor" rows={3} placeholder={t('app.styleGuide.serverListen80', 'server { listen 80; }')} />
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.formRow2Column', 'Form row (2-column)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="form-row">
                                <div className="form-group">
                                    <label>{t('app.styleGuide.firstName', 'First name')}</label>
                                    <Input type="text" placeholder={t('app.styleGuide.john', 'John')} />
                                </div>
                                <div className="form-group">
                                    <label>{t('app.styleGuide.lastName', 'Last name')}</label>
                                    <Input type="text" placeholder={t('app.styleGuide.doe', 'Doe')} />
                                </div>
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.inlineForm', 'Inline form')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="install-form">
                                <Input type="text" placeholder={t('app.styleGuide.searchPackages', 'Search packages…')} />
                                <Button><Search size={16} /> {t('app.styleGuide.search', 'Search')}</Button>
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.checkboxToggle', 'Checkbox toggle')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <label className="filter-toggle">
                                <input type="checkbox" checked={checkValue} onChange={e => setCheckValue(e.target.checked)} />
                                <span>{t('app.styleGuide.enableFeature', 'Enable feature')}</span>
                            </label>
                        </SharedCard>
                    </div>
                )}

                {/* ── SHARED FIELDS ── */}
                {activeSection === 'fields' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.copyField', 'Copy field (CopyField)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="form-group">
                                <CopyField label={t('app.styleGuide.connectionString', 'Connection string')} value="postgresql://app@db.internal:5432/app" />
                            </div>
                            <div className="form-group">
                                <CopyField label={t('app.styleGuide.password', 'Password')} value="s3cr3t-demo-value" secret />
                            </div>
                            <div className="form-group">
                                <CopyField value={'curl -fsSL https://example.com/install.sh -o install.sh && \\\n  sudo bash install.sh'} multiline />
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.portField', 'Port field (PortField)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="form-group">
                                <Label htmlFor="sg-port">{t('app.styleGuide.containerPort', 'Container port')}</Label>
                                <PortField id="sg-port" host={false} value={portValue} onChange={setPortValue} />
                                <span className="hint">{t('app.styleGuide.portFieldHint', 'host={false}: range checks only. Host ports (the default) are also checked for collisions.')}</span>
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.envEditor', 'Environment editor (EnvEditor)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <EnvEditor value={envRows} onChange={setEnvRows} />
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.serverPicker', 'Server picker (ServerPicker)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="form-group">
                                <ServerPicker value={serverValue} onChange={(id) => setServerValue(id)} capability="docker" />
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.domainField', 'Domain field (DomainField)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="form-group">
                                <Label htmlFor="sg-domain">{t('common.labels.domain', 'Domain')}</Label>
                                <DomainField id="sg-domain" value={domainValue} onChange={(fqdn) => setDomainValue(fqdn)} defaultLabel="my-app" />
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.catalogCard', 'Catalog card (CatalogCard)')} />
                        <CatalogGrid>
                            <CatalogCard
                                icon={<Database size={18} />}
                                title={t('app.styleGuide.postgresql', 'PostgreSQL')}
                                sub="v16 · by ServerKit"
                                tag={t('app.styleGuide.database', 'Database')}
                                description={t('app.styleGuide.catalogCardDemo', 'Something you browse to install or deploy. Things you operate are table rows.')}
                                facts=":5432 · 256 MB RAM"
                                action={<Button size="sm">{t('app.styleGuide.deploy', 'Deploy')}</Button>}
                            />
                            <CatalogCard
                                icon={<Globe size={18} />}
                                title={t('app.styleGuide.staticSite', 'Static site')}
                                sub="by ServerKit"
                                featured
                                description={t('app.styleGuide.catalogCardDemo2', 'One tag, one action; counts and versions stay plain text.')}
                                facts=":80"
                                action={<Button size="sm" variant="outline">{t('app.styleGuide.deploy', 'Deploy')}</Button>}
                            />
                        </CatalogGrid>
                    </div>
                )}

                {/* ── TABLES ── */}
                {activeSection === 'tables' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.standardTableTable', 'Standard table (.table)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h3>{t('app.styleGuide.sshAuthorizedKeys', 'SSH authorized keys')}</h3>
                                <SharedCardFooter variant="legacy">
                                    <Button size="sm">{t('app.styleGuide.addKey', 'Add key')}</Button>
                                    <Button size="sm" variant="outline">{t('common.actions.refresh', 'Refresh')}</Button>
                                </SharedCardFooter>
                            </SharedCardHeader>
                            <SharedCardContent variant="legacy" className="card-body">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>{t('common.labels.type', 'Type')}</th>
                                            <th>{t('app.styleGuide.fingerprint', 'Fingerprint')}</th>
                                            <th>{t('app.styleGuide.comment', 'Comment')}</th>
                                            <th>{t('common.labels.actions', 'Actions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td><code>ssh-ed25519</code></td>
                                            <td><code>{t('app.styleGuide.sha256Abc123def456', 'SHA256:abc123def456…')}</code></td>
                                            <td>deploy@server</td>
                                            <td><Button size="sm" variant="destructive">{t('common.actions.remove', 'Remove')}</Button></td>
                                        </tr>
                                        <tr>
                                            <td><code>ssh-rsa</code></td>
                                            <td><code>{t('app.styleGuide.sha256Xyz789ghi012', 'SHA256:xyz789ghi012…')}</code></td>
                                            <td>admin@laptop</td>
                                            <td><Button size="sm" variant="destructive">{t('common.actions.remove', 'Remove')}</Button></td>
                                        </tr>
                                        <tr>
                                            <td><code>ssh-ed25519</code></td>
                                            <td><code>{t('app.styleGuide.sha256Mno345pqr678', 'SHA256:mno345pqr678…')}</code></td>
                                            <td>ci-pipeline</td>
                                            <td><Button size="sm" variant="destructive">{t('common.actions.remove', 'Remove')}</Button></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </SharedCardContent>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.tableWithBadges', 'Table with badges')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h3>{t('app.styleGuide.scanHistory', 'Scan history')}</h3>
                                <Button size="sm" variant="outline">{t('common.actions.refresh', 'Refresh')}</Button>
                            </SharedCardHeader>
                            <SharedCardContent variant="legacy" className="card-body">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>{t('app.styleGuide.date', 'Date')}</th>
                                            <th>{t('app.styleGuide.directory', 'Directory')}</th>
                                            <th>{t('common.labels.status', 'Status')}</th>
                                            <th>{t('app.styleGuide.threats', 'Threats')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td>2026-03-29 14:30</td>
                                            <td>/var/www</td>
                                            <td><Badge variant="success">completed</Badge></td>
                                            <td><Badge variant="success">{t('app.styleGuide.clean', 'Clean')}</Badge></td>
                                        </tr>
                                        <tr>
                                            <td>2026-03-28 09:15</td>
                                            <td>/home/deploy</td>
                                            <td><Badge variant="success">completed</Badge></td>
                                            <td><Badge variant="destructive">{t('app.styleGuide.2Found', '2 found')}</Badge></td>
                                        </tr>
                                        <tr>
                                            <td>2026-03-27 22:00</td>
                                            <td>/var/www</td>
                                            <td><Badge variant="warning">cancelled</Badge></td>
                                            <td>&mdash;</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </SharedCardContent>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.tableWithStatusBadges', 'Table with status badges')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h3>{t('app.styleGuide.firewallRules', 'Firewall rules')}</h3>
                            </SharedCardHeader>
                            <SharedCardContent variant="legacy" className="card-body">
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>{t('common.labels.port', 'Port')}</th>
                                            <th>{t('app.styleGuide.protocol', 'Protocol')}</th>
                                            <th>{t('common.labels.action', 'Action')}</th>
                                            <th>{t('common.labels.source', 'Source')}</th>
                                            <th>{t('common.labels.status', 'Status')}</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td><code>22</code></td>
                                            <td>TCP</td>
                                            <td><Badge variant="success">{t('app.styleGuide.allow', 'Allow')}</Badge></td>
                                            <td>{t('app.styleGuide.anywhere', 'Anywhere')}</td>
                                            <td><StatusBadge status="active" /></td>
                                        </tr>
                                        <tr>
                                            <td><code>80</code></td>
                                            <td>TCP</td>
                                            <td><Badge variant="success">{t('app.styleGuide.allow', 'Allow')}</Badge></td>
                                            <td>{t('app.styleGuide.anywhere', 'Anywhere')}</td>
                                            <td><StatusBadge status="active" /></td>
                                        </tr>
                                        <tr>
                                            <td><code>3306</code></td>
                                            <td>TCP</td>
                                            <td><Badge variant="destructive">{t('app.styleGuide.deny', 'Deny')}</Badge></td>
                                            <td>{t('app.styleGuide.external', 'External')}</td>
                                            <td><StatusBadge status="active" /></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </SharedCardContent>
                        </SharedCard>
                    </div>
                )}

                {/* ── CARDS & STATS ── */}
                {activeSection === 'cards' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.basicCard', 'Basic card')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h3>{t('app.styleGuide.cardTitle', 'Card title')}</h3>
                                <SharedCardFooter variant="legacy">
                                    <Button size="sm" variant="outline">{t('common.actions.refresh', 'Refresh')}</Button>
                                    <Button size="sm">{t('common.labels.action', 'Action')}</Button>
                                </SharedCardFooter>
                            </SharedCardHeader>
                            <SharedCardContent variant="legacy" className="card-body">
                                <p className="text-secondary">{t('app.styleGuide.cardBodyContentWithCardHeader', 'Card body content with card-header and card-actions in the header.')}</p>
                            </SharedCardContent>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.statsGridStatcardStatsgrid', 'Stats grid (StatCard / StatsGrid)')} />
                        <StatsGrid>
                            <StatCard icon={Server} iconVariant="apps" label={t('app.styleGuide.applications', 'Services')} value={12} />
                            <StatCard icon={Database} iconVariant="databases" label={t('common.labels.databases', 'Databases')} value={5} />
                            <StatCard icon={Cloud} iconVariant="backups" label={t('common.labels.backups', 'Backups')} value={24} />
                            <StatCard icon={BarChart3} iconVariant="size" label={t('app.styleGuide.diskUsed', 'Disk used')} value={48} suffix="GB" />
                        </StatsGrid>

                        <SectionTitle title={t('app.styleGuide.metricRowMetricrowMetricitem', 'Metric row (MetricRow / MetricItem)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <MetricRow>
                                <MetricItem label="CPU" value="23%" />
                                <MetricItem label={t('common.labels.memory', 'Memory')} value="1.2 GB" />
                                <MetricItem label={t('common.labels.disk', 'Disk')} value="48 GB" />
                                <MetricItem label={t('app.styleGuide.network', 'Network')} value="2.4 Mbps" />
                            </MetricRow>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.progressBarProgressbar', 'Progress bar (ProgressBar)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="styleguide__examples">
                                {[
                                    ['Storage', '48 / 100 GB', 48, null],
                                    ['Memory', '6.2 / 8 GB', 78, '#f59e0b'],
                                    ['CPU', '92%', 92, '#ef4444'],
                                ].map(([label, text, percent, color]) => (
                                    <div key={label}>
                                        <div className="styleguide__progress-labels">
                                            <span className="styleguide__description">{label}</span>
                                            <span className="styleguide__progress-value">{text}</span>
                                        </div>
                                        <ProgressBar percent={percent} color={color} />
                                    </div>
                                ))}
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.dangerZoneDangerzone', 'Destructive action (DangerZone)')} />
                        <DangerZone
                            title={t('app.styleGuide.deleteApplication', 'Delete service')}
                            description={t('app.styleGuide.onceDeletedThisCannotBeUndone', 'Once deleted, this cannot be undone. All data will be permanently removed.')}
                            action={<Button variant="destructive"><Trash2 size={16} /> {t('common.actions.delete', 'Delete')}</Button>}
                        />
                    </div>
                )}

                {/* ── BADGES & STATUS ── */}
                {activeSection === 'badges' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.statusBadgesComponent', 'Status badges (component)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="styleguide__actions styleguide__actions--spaced">
                                <StatusBadge status="online" />
                                <StatusBadge status="running" />
                                <StatusBadge status="healthy" />
                                <StatusBadge status="active" />
                                <StatusBadge status="connected" />
                            </div>
                            <div className="styleguide__actions styleguide__actions--spaced">
                                <StatusBadge status="offline" />
                                <StatusBadge status="stopped" />
                                <StatusBadge status="error" />
                                <StatusBadge status="failed" />
                                <StatusBadge status="disconnected" />
                            </div>
                            <div className="styleguide__actions styleguide__actions--spaced">
                                <StatusBadge status="warning" />
                                <StatusBadge status="degraded" />
                                <StatusBadge status="pending" />
                                <StatusBadge status="building" />
                                <StatusBadge status="deploying" />
                            </div>
                            <div className="styleguide__actions">
                                <StatusBadge status="paused" />
                                <StatusBadge status="unknown" />
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.shadcnBadgeVariants', 'shadcn badge variants')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="styleguide__actions">
                                <Badge>{t('common.labels.default', 'Default')}</Badge>
                                <Badge variant="info">{t('common.labels.info', 'Info')}</Badge>
                                <Badge variant="success">{t('app.styleGuide.success', 'Success')}</Badge>
                                <Badge variant="warning">{t('common.labels.warning', 'Warning')}</Badge>
                                <Badge variant="destructive">{t('app.styleGuide.destructive', 'Destructive')}</Badge>
                                <Badge variant="secondary">{t('app.styleGuide.secondary', 'Secondary')}</Badge>
                                <Badge variant="outline">{t('app.styleGuide.outline', 'Outline')}</Badge>
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.appTypeEnvDbBadges', 'Service type / env / DB badges')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">{t('app.styleGuide.appTypes', 'Service types')}</p>
                            <div className="styleguide__actions styleguide__actions--spaced">
                                <span className="app-type">PHP</span>
                                <span className="app-type">{t('app.styleGuide.python', 'Python')}</span>
                                <span className="app-type">{t('app.styleGuide.nodeJs', 'Node.js')}</span>
                                <span className="app-type">{t('app.styleGuide.wordpress', 'WordPress')}</span>
                                <span className="app-type">{t('app.styleGuide.static', 'Static')}</span>
                            </div>
                            <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">{t('app.styleGuide.environments', 'Environments')}</p>
                            <div className="styleguide__actions styleguide__actions--spaced">
                                <span className="env-badge env-production">{t('app.styleGuide.production', 'Production')}</span>
                                <span className="env-badge env-staging">{t('app.styleGuide.staging', 'Staging')}</span>
                                <span className="env-badge env-development">{t('app.styleGuide.development', 'Development')}</span>
                            </div>
                            <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">{t('app.styleGuide.databaseTypes', 'Database types')}</p>
                            <div className="styleguide__actions styleguide__actions--spaced">
                                <span className="db-type-badge mysql">{t('app.styleGuide.mysql', 'MySQL')}</span>
                                <span className="db-type-badge postgresql">{t('app.styleGuide.postgresql', 'PostgreSQL')}</span>
                            </div>
                            <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">SSL</p>
                            <div className="styleguide__actions">
                                <span className="ssl-badge"><Lock size={12} /> {t('app.styleGuide.sslActive', 'SSL active')}</span>
                            </div>
                        </SharedCard>
                    </div>
                )}

                {/* ── ALERTS & ERRORS ── */}
                {activeSection === 'alerts' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.alertBannersAlert', 'Alert banners (.alert)')} />
                        <div className="styleguide__examples styleguide__examples--compact">
                            <div className="alert alert-success">
                                <CheckCircle size={16} /> {t('app.styleGuide.operationCompletedSuccessfully', 'Operation completed.')}
                            </div>
                            <div className="alert alert-danger">
                                <AlertTriangle size={16} /> {t('app.styleGuide.failedToConnectToTheServer', "Couldn't connect to the server.")}
                            </div>
                            <div className="alert alert-warning">
                                <AlertCircle size={16} /> {t('app.styleGuide.sslCertificateExpiresIn7Days', 'SSL certificate expires in 7 days.')}
                            </div>
                            <div className="alert alert-info">
                                <Info size={16} /> {t('app.styleGuide.aNewVersionIsAvailableFor', 'A new version is available for update.')}
                            </div>
                        </div>

                        <SectionTitle title={t('app.styleGuide.alertWithCloseButton', 'Alert with close button')} />
                        <div className="styleguide__examples styleguide__examples--compact">
                            <div className="alert alert-danger">
                                {t('app.styleGuide.somethingWentWrongWhileSaving', "Couldn't save. Try again.")}
                                <Button variant="unstyled" className="alert-close">&times;</Button>
                            </div>
                        </div>

                        <SectionTitle title={t('app.styleGuide.errorMessageErrorMessage', 'Error message (.error-message)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="error-message">
                                <AlertTriangle size={16} /> {t('app.styleGuide.thisIsAnInlineErrorMessage', 'This is an inline error message.')}
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.errorBannerErrorBanner', 'Error banner (.error-banner)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="error-banner">
                                <AlertTriangle size={16} /> {t('app.styleGuide.thisIsAFullWidthError', 'This is a full-width error banner.')}
                            </div>
                        </SharedCard>
                    </div>
                )}

                {/* ── MODALS ── */}
                {activeSection === 'modals' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.modalDialog', 'Modal dialog')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <Button onClick={() => setModalOpen(true)}>
                                {t('app.styleGuide.openModal', 'Open modal')}
                            </Button>
                            <Modal
                                open={modalOpen}
                                onClose={() => setModalOpen(false)}
                                title={t('app.styleGuide.exampleModal', 'Example modal')}
                                footer={<>
                                    <Button variant="outline" onClick={() => setModalOpen(false)}>{t('common.actions.cancel', 'Cancel')}</Button>
                                    <Button onClick={() => setModalOpen(false)}>{t('app.styleGuide.saveChanges', 'Save changes')}</Button>
                                </>}
                            >
                                <p className="text-secondary">{t('app.styleGuide.modalBodyContentWithAForm', 'Modal body content with a form field.')}</p>
                                <div className="form-group styleguide__modal-field">
                                    <label>{t('app.styleGuide.exampleField', 'Example field')}</label>
                                    <Input type="text" placeholder={t('app.styleGuide.typeSomething', 'Type something…')} />
                                </div>
                            </Modal>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.sideDrawerSheet', 'Side drawer (Sheet)')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.rightLeftAnchoredPanelBuiltOn', 'Right/left-anchored panel built on Radix Dialog. Used for forms like "Add server" or "Add service" where a slide-in panel is preferred over a centered modal.')}</p>
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="styleguide__actions">
                                <Button onClick={() => { setSheetSide('right'); setSheetOpen(true); }}>
                                    <Plus size={16} /> {t('app.styleGuide.openRightDrawer', 'Open right drawer')}
                                </Button>
                                <Button variant="outline" onClick={() => { setSheetSide('left'); setSheetOpen(true); }}>
                                    <Plus size={16} /> {t('app.styleGuide.openLeftDrawer', 'Open left drawer')}
                                </Button>
                            </div>
                            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                                <SheetContent side={sheetSide}>
                                    <SheetHeader>
                                        <SheetTitle>{t('app.styleGuide.addService', 'New service')}</SheetTitle>
                                        <SheetDescription>
                                            {t('app.styleGuide.configureANewServiceThisDrawer', 'Configure a new service. This drawer pattern is the panel-style alternative to a centered modal.')}
                                        </SheetDescription>
                                    </SheetHeader>
                                    <div className="styleguide__drawer-fields">
                                        <div className="form-group">
                                            <label>{t('app.styleGuide.serviceName', 'Service name')}</label>
                                            <Input type="text" placeholder="my-service" />
                                        </div>
                                        <div className="form-group">
                                            <label>{t('common.labels.description', 'Description')}</label>
                                            <Textarea placeholder={t('app.styleGuide.whatDoesThisServiceDo', 'What does this service do?')} rows={3} />
                                        </div>
                                    </div>
                                    <SheetFooter>
                                        <SheetClose asChild>
                                            <Button variant="outline">{t('common.actions.cancel', 'Cancel')}</Button>
                                        </SheetClose>
                                        <Button onClick={() => setSheetOpen(false)}>{t('app.styleGuide.createService', 'Create service')}</Button>
                                    </SheetFooter>
                                </SheetContent>
                            </Sheet>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.logsDrawerLogsdrawer', 'Logs drawer (LogsDrawer)')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.globalBottomPinnedDrawerForStreaming', 'Global bottom-pinned drawer for streaming logs. Opens via the LogsDrawer context.')}</p>
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <Button onClick={() => openDrawer({ name: 'sample-service', logPath: '/var/log/syslog', appType: 'logfile' })}>
                                <FileText size={16} /> {t('app.styleGuide.openLogsDrawer', 'Open logs drawer')}
                            </Button>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.confirmDialogs', 'Confirm dialogs')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="styleguide__actions">
                                <Button variant="destructive" onClick={() => { setConfirmVariant('danger'); setConfirmOpen(true); }}>{t('app.styleGuide.danger', 'Danger')}</Button>
                                <Button variant="outline" onClick={() => { setConfirmVariant('warning'); setConfirmOpen(true); }}>{t('common.labels.warning', 'Warning')}</Button>
                                <Button variant="outline" onClick={() => { setConfirmVariant('info'); setConfirmOpen(true); }}>{t('common.labels.info', 'Info')}</Button>
                            </div>
                            <ConfirmDialog
                                isOpen={confirmOpen}
                                title={t('app.styleGuide.action3', '{{value}} Action', { value: confirmVariant.charAt(0).toUpperCase() + confirmVariant.slice(1) })}
                                message={t('app.styleGuide.areYouSureYouWantTo', "Delete this item? This can't be undone.")}
                                variant={confirmVariant}
                                confirmText={t('app.styleGuide.proceed', 'Proceed')}
                                onConfirm={() => setConfirmOpen(false)}
                                onCancel={() => setConfirmOpen(false)}
                            />
                        </SharedCard>
                    </div>
                )}

                {/* ── TABS ── */}
                {activeSection === 'tabs' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.tabsBasic', 'Tabs (basic)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <Tabs defaultValue="tab1">
                                <TabsList>
                                    <TabsTrigger value="tab1"><Server size={14} /> {t('app.styleGuide.general', 'General')}</TabsTrigger>
                                    <TabsTrigger value="tab2"><Shield size={14} /> {t('common.labels.security', 'Security')}</TabsTrigger>
                                    <TabsTrigger value="tab3"><Activity size={14} /> {t('common.labels.monitoring', 'Monitoring')}</TabsTrigger>
                                </TabsList>
                                <TabsContent value="tab1">
                                    <p className="styleguide__tab-content">{t('app.styleGuide.generalTabContent', 'General tab content.')}</p>
                                </TabsContent>
                                <TabsContent value="tab2">
                                    <p className="styleguide__tab-content">{t('app.styleGuide.securityTabContent', 'Security tab content.')}</p>
                                </TabsContent>
                                <TabsContent value="tab3">
                                    <p className="styleguide__tab-content">{t('app.styleGuide.monitoringTabContent', 'Monitoring tab content.')}</p>
                                </TabsContent>
                            </Tabs>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.tabsControlled', 'Tabs (controlled)')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.controlledValueOnvaluechangeUsageThisShould', 'Controlled value/onValueChange usage. This should match URL-backed pages behaviorally.')}</p>
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <Tabs value={controlledDemoTab} onValueChange={setControlledDemoTab}>
                                <TabsList>
                                    <TabsTrigger value="general"><Server size={14} /> {t('app.styleGuide.general', 'General')}</TabsTrigger>
                                    <TabsTrigger value="security"><Shield size={14} /> {t('common.labels.security', 'Security')}</TabsTrigger>
                                    <TabsTrigger value="monitoring"><Activity size={14} /> {t('common.labels.monitoring', 'Monitoring')}</TabsTrigger>
                                    <TabsTrigger value="disabled" disabled><Lock size={14} /> {t('app.styleGuide.disabled2', 'Disabled')}</TabsTrigger>
                                </TabsList>
                                <TabsContent value="general">
                                    <p className="styleguide__tab-content">{t('app.styleGuide.controlledGeneralContent', 'Controlled general content.')}</p>
                                </TabsContent>
                                <TabsContent value="security">
                                    <p className="styleguide__tab-content">{t('app.styleGuide.controlledSecurityContent', 'Controlled security content.')}</p>
                                </TabsContent>
                                <TabsContent value="monitoring">
                                    <p className="styleguide__tab-content">{t('app.styleGuide.controlledMonitoringContent', 'Controlled monitoring content.')}</p>
                                </TabsContent>
                            </Tabs>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.tabsOverflowMenu', 'Tabs (overflow menu)')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.manyTabsForceTheOverflowMenu', 'Many tabs force the overflow menu. Selecting an item from the ellipsis must activate the tab and close the popover.')}</p>
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <Tabs defaultValue="overview">
                                <TabsList>
                                    {MANY_TAB_ITEMS.map(([value, label]) => (
                                        <TabsTrigger key={value} value={value}>{label}</TabsTrigger>
                                    ))}
                                </TabsList>
                                {MANY_TAB_ITEMS.map(([value, label]) => (
                                    <TabsContent key={value} value={value}>
                                        <p className="styleguide__tab-content">{label} {t('app.styleGuide.tabContent', 'tab content.')}</p>
                                    </TabsContent>
                                ))}
                            </Tabs>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.tabsHalfHalfLayout', 'Tabs (half + half layout)')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.constrainedCardsCatchLayoutBugsThat', 'Constrained cards catch layout bugs that full-width tabs hide.')}</p>
                        <div className="styleguide__split-demo">
                            <SharedCard variant="legacy" className="card styleguide__demo-card">
                                <Tabs value={halfDemoTab} onValueChange={setHalfDemoTab}>
                                    <TabsList>
                                        <TabsTrigger value="summary">{t('app.styleGuide.summary', 'Summary')}</TabsTrigger>
                                        <TabsTrigger value="activity">{t('app.styleGuide.activity', 'Activity')}</TabsTrigger>
                                    </TabsList>
                                    <TabsContent value="summary">
                                        <p className="styleguide__tab-content">{t('app.styleGuide.shortTwoTabCardContent', 'Short two-tab card content.')}</p>
                                    </TabsContent>
                                    <TabsContent value="activity">
                                        <p className="styleguide__tab-content">{t('app.styleGuide.recentActivityContent', 'Recent activity content.')}</p>
                                    </TabsContent>
                                </Tabs>
                            </SharedCard>

                            <SharedCard variant="legacy" className="card styleguide__demo-card">
                                <Tabs value={halfOverflowTab} onValueChange={setHalfOverflowTab}>
                                    <TabsList>
                                        {MANY_TAB_ITEMS.map(([value, label]) => (
                                            <TabsTrigger key={value} value={value}>{label}</TabsTrigger>
                                        ))}
                                    </TabsList>
                                    {MANY_TAB_ITEMS.map(([value, label]) => (
                                        <TabsContent key={value} value={value}>
                                            <p className="styleguide__tab-content">{label} {t('app.styleGuide.contentInsideAHalfWidthCard', 'content inside a half-width card.')}</p>
                                        </TabsContent>
                                    ))}
                                </Tabs>
                            </SharedCard>
                        </div>
                    </div>
                )}

                {/* ── LISTS & INFO ── */}
                {activeSection === 'lists' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.infoListInfolistInfoitem', 'Info list (InfoList / InfoItem)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <InfoList>
                                <InfoItem label={t('app.styleGuide.hostname', 'Hostname')} value="srv-01.example.com" mono />
                                <InfoItem label={t('common.labels.ipAddress', 'IP address')} value="192.168.1.100" mono />
                                <InfoItem label="OS" value="Ubuntu 22.04 LTS" />
                                <InfoItem label={t('common.labels.uptime', 'Uptime')} value="42 days, 7 hours" />
                                <InfoItem label={t('common.labels.status', 'Status')}>
                                    <StatusBadge status="online" />
                                </InfoItem>
                            </InfoList>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.environmentVariables', 'Environment variables')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="env-list">
                                {[
                                    ['DATABASE_URL', 'postgresql://localhost:5432/mydb'],
                                    ['SECRET_KEY', '••••••••••'],
                                    ['NODE_ENV', 'production'],
                                ].map(([key, val]) => (
                                    <div key={key} className="env-item">
                                        <span className="env-key">{key}</span>
                                        <span className="env-value">{val}</span>
                                    </div>
                                ))}
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.packageList', 'Package list')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="packages-list">
                                {[['nginx', '1.24.0'], ['postgresql-15', '15.4'], ['redis-server', '7.2.1']].map(([name, ver]) => (
                                    <div key={name} className="package-item">
                                        <span className="package-name">{name}</span>
                                        <span className="package-version">{ver}</span>
                                    </div>
                                ))}
                            </div>
                        </SharedCard>
                    </div>
                )}

                {/* ── FEEDBACK & LOADING ── */}
                {activeSection === 'feedback' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.spinners', 'Spinners')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <div className="styleguide__spinner-row">
                                {['sm', 'md', 'lg'].map(size => (
                                    <div key={size} className="styleguide__spinner-example">
                                        <Spinner size={size} />
                                        <span className="styleguide__description styleguide__description--muted">{size}</span>
                                    </div>
                                ))}
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.spinnerSizesStandalone', 'Spinner sizes (standalone)')} />
                        <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">{t('app.styleGuide.useSpinnerDirectlyOnlyInsideButtons', 'Use Spinner directly only inside buttons or inline indicators.')}</p>

                        <SectionTitle title={t('app.styleGuide.loadingSkeletonArchetypes', 'Loading skeleton archetypes')} />
                        <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">
                            {t('app.styleGuide.aSkeletonShouldPredictTheLayout', 'A skeleton should predict the layout that is about to arrive. Pick the archetype matching the page shape via')}
                            {' '}<code>{t('app.styleGuide.emptystateLoadingLoadingvariantTable', '<EmptyState loading loadingVariant="table" />')}</code>{t('app.styleGuide.orRender', ', or render')}
                            {' '}<code>{t('app.styleGuide.pageskeleton', '<PageSkeleton />')}</code> {t('app.styleGuide.directlyForAPixelExactSkeleton', 'directly. For a pixel-exact skeleton of one region, capture bones instead (')}<code>{t('app.styleGuide.npmRunCaptureSkeletons', 'npm run capture:skeletons')}</code>).
                        </p>
                        {PAGE_SKELETON_VARIANTS.map(variant => (
                            <div key={variant} className="sk-gallery">
                                <div className="sk-gallery__name">{variant}</div>
                                <PageSkeleton variant={variant} />
                            </div>
                        ))}
                    </div>
                )}

                {/* ── EMPTY, LOADING & UNAVAILABLE STATES ── */}
                {activeSection === 'empty' && (
                    <div className="styleguide__section">
                        <p className="styleguide__description">{t('app.styleGuide.oneComponentForEverythingEmptyLoading', 'One component for everything: empty, loading, not-installed, unavailable. Import EmptyState from components/EmptyState.')}</p>

                        <SectionTitle title={t('app.styleGuide.defaultNoData', 'Default (no data)')} />
                        <EmptyState />

                        <SectionTitle title={t('app.styleGuide.withIconTitleDescriptionAction', 'With icon, title, description, action')} />
                        <EmptyState
                            icon={Server}
                            title={t('app.styleGuide.noServersConnected', 'No servers connected')}
                            description={t('app.styleGuide.connectYourFirstServerToStart', 'Connect your first server to start managing it from the dashboard.')}
                            action={<Button><Plus size={16} /> {t('app.styleGuide.addServer', 'Add server')}</Button>}
                        />

                        <SectionTitle title={t('app.styleGuide.loadingState', 'Loading state')} />
                        <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">{t('app.styleGuide.passLoadingTrueSameComponentSpinner', 'Pass loading=true. Same component, spinner instead of icon.')}</p>
                        <EmptyState loading title={t('app.styleGuide.loadingServices', 'Loading services…')} />

                        <SectionTitle title={t('app.styleGuide.searchEmpty', 'Search empty')} />
                        <EmptyState
                            icon={Search}
                            title={t('app.styleGuide.noResultsFound', 'No results found')}
                            description={t('app.styleGuide.tryAdjustingYourSearchOrFilter', 'Try adjusting your search or filter criteria.')}
                        />

                        <SectionTitle title={t('app.styleGuide.largeNotInstalledSizeLg', 'Large, not installed (size="lg")')} />
                        <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">{t('app.styleGuide.fullPageStateForGitDocker', 'Full-page state for Git, Docker, FTP when not installed.')}</p>
                        <EmptyState
                            size="lg"
                            icon={GitBranch}
                            title={t('app.styleGuide.noGitServerInstalled', 'No Git server installed')}
                            description={t('app.styleGuide.installGiteaToHostAndManage', 'Install Gitea to host and manage your Git repositories locally.')}
                            action={<Button size="lg"><Download size={16} /> {t('app.styleGuide.installGitServer', 'Install Git server')}</Button>}
                        />

                        <SectionTitle title={t('app.styleGuide.largeUnavailableSizeLg', 'Large, unavailable (size="lg")')} />
                        <EmptyState
                            size="lg"
                            icon={WifiOff}
                            title={t('app.styleGuide.dockerNotAvailable', 'Docker not available')}
                            description={t('app.styleGuide.dockerIsNotInstalledOrNot', 'Docker is not installed or not running on this system.')}
                            action={<Button><RefreshCw size={16} /> {t('app.styleGuide.retryConnection', 'Retry connection')}</Button>}
                        />

                        <SectionTitle title={t('app.styleGuide.largeLoading', 'Large, loading')} />
                        <EmptyState size="lg" loading title={t('app.styleGuide.loadingServices', 'Loading services…')} />

                        <SectionTitle title={t('app.styleGuide.insideACardEGEmpty', 'Inside a Card (e.g. empty table)')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h3>{t('app.styleGuide.scanHistory', 'Scan history')}</h3>
                                <Button size="sm" variant="outline">{t('common.actions.refresh', 'Refresh')}</Button>
                            </SharedCardHeader>
                            <SharedCardContent variant="legacy" className="card-body">
                                <EmptyState
                                    icon={Search}
                                    title={t('app.styleGuide.noScansYet', 'No scans yet')}
                                    description={t('app.styleGuide.startAScanAboveToCheck', 'Start a scan above to check for threats.')}
                                />
                            </SharedCardContent>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.contextGrid', 'Context grid')} />
                        <div className="styleguide__comparison-grid">
                            <EmptyState icon={Database} title={t('app.styleGuide.noDatabases', 'No databases')} description={t('app.styleGuide.createYourFirstDatabase', 'Create your first database.')} action={<Button size="sm"><Plus size={14} /> {t('common.actions.create', 'Create')}</Button>} />
                            <EmptyState icon={Globe} title={t('app.styleGuide.noDomainsConfigured', 'No domains configured')} description={t('app.styleGuide.addADomainToGetStarted', 'Add a domain to route traffic to a service.')} action={<Button size="sm"><Plus size={14} /> {t('app.styleGuide.addDomain', 'Add domain')}</Button>} />
                            <EmptyState icon={Key} title={t('app.styleGuide.noSshKeys', 'No SSH keys')} description={t('app.styleGuide.addAnSshKeyForSecure', 'Add an SSH key for secure access.')} action={<Button size="sm"><Plus size={14} /> {t('app.styleGuide.addKey', 'Add key')}</Button>} />
                            <EmptyState icon={Shield} title={t('app.styleGuide.noScanHistory', 'No scan history')} description={t('app.styleGuide.runAScanToCheckFor', 'Run a scan to check for threats.')} action={<Button size="sm"><Activity size={14} /> {t('app.styleGuide.scan', 'Scan')}</Button>} />
                        </div>
                    </div>
                )}

                {/* ── PAGE HEADERS ── */}
                {activeSection === 'pageheaders' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.tabGroupTheDefaultNoTitle', 'Tab group: the default (no title)')} />
                        <p className="styleguide__description styleguide__description--spaced">
                            {t('app.styleGuide.howMostPagesGetTheirBar', 'How most pages get their bar: a parent')} <code>{t('app.styleGuide.tabgrouplayout', 'TabGroupLayout')}</code> {t('app.styleGuide.rendersOneTitleless', 'renders one titleless')} <code>{t('app.styleGuide.pagetopbar', 'PageTopbar')}</code> {t('app.styleGuide.forTheWholeGroupAndSwaps', 'for the whole group and swaps only the content below. Child pages render')} <strong>{t('app.styleGuide.noBarOfTheirOwn', 'no bar of their own')}</strong> {t('app.styleGuide.theyPublishActionsThrough', 'and publish actions through')} <code>useTopbarActions()</code>{t('app.styleGuide.searchRightMostTheTabStrip', ', search right-most. The tab strip is the heading, so there is no title to repeat.')}
                        </p>
                        <SharedCard variant="legacy" className="card styleguide__demo-card styleguide__demo-card--flush">
                            <PageTopbar
                                navLabel="Domains"
                                tabs={[
                                    { to: '#sg-domains', labelKey: 'common.labels.domains', label: 'Domains' },
                                    { to: '#sg-ssl', labelKey: 'app.styleGuide.sslCertificates', label: 'SSL certificates' },
                                ]}
                                actions={(
                                    <>
                                        <Button variant="outline" size="sm"><RefreshCw size={15} /> {t('app.styleGuide.checkDns', 'Check DNS')}</Button>
                                        <Button size="sm"><Plus size={15} /> {t('app.styleGuide.addDomain2', 'Add domain')}</Button>
                                        <SearchField placeholder={t('app.styleGuide.searchDomains', 'Search domains…')} />
                                    </>
                                )}
                            />
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.standalonePageTitledBar', 'Standalone page: titled bar')} />
                        <p className="styleguide__description styleguide__description--spaced">
                            {t('app.styleGuide.onlyForPagesWithNoTab', 'Only for pages with no tab group, and for entity pages where the title names')} <em>which</em> {t('app.styleGuide.recordYouAreOnServiceDetail', 'record you are on (Service Detail, Workspace…). Everything else should join a group.')}
                        </p>
                        <SharedCard variant="legacy" className="card styleguide__demo-card styleguide__demo-card--flush">
                            <PageTopbar
                                icon={<Clock size={18} />}
                                title={t('app.styleGuide.cronJobs', 'Cron jobs')}
                                actions={(
                                    <>
                                        <Button variant="outline" size="sm"><RefreshCw size={15} /> {t('common.actions.refresh', 'Refresh')}</Button>
                                        <Button size="sm"><Plus size={15} /> {t('app.styleGuide.createJob', 'Create job')}</Button>
                                        <SearchField placeholder={t('app.styleGuide.searchJobsOrCommands', 'Search jobs or commands…')} />
                                    </>
                                )}
                            />
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.retiredPageHeader', 'Retired: .page-header')} />
                        <p className="styleguide__description styleguide__description--spaced">
                            {t('app.styleGuide.theOld', 'The old')} <code>{t('app.styleGuide.divClassnamePageHeader', '<div className="page-header">')}</code> +{' '}
                            <code>&lt;h1&gt;</code> {t('app.styleGuide.blockHasBeenRemovedFromThe', "block has been removed from the codebase and its styles deleted. Don't reintroduce it; use one of the two bars above. Bespoke workspace pages (Docker, Database Explorer) intentionally carry no page bar at all; that is not a licence to invent a third header.")}
                        </p>

                        <SectionTitle title={t('app.styleGuide.cardWithHeaderActions', 'Card with header + actions')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.forCardsInsidePagesThatNeed', 'For cards inside pages that need their own header row.')}</p>
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h3>{t('app.styleGuide.cardSectionTitle', 'Card section title')}</h3>
                                <SharedCardFooter variant="legacy">
                                    <Button size="sm">{t('common.actions.add', 'Add')}</Button>
                                    <Button size="sm" variant="outline">{t('common.actions.refresh', 'Refresh')}</Button>
                                </SharedCardFooter>
                            </SharedCardHeader>
                            <SharedCardContent variant="legacy" className="card-body">
                                <p className="text-secondary">{t('app.styleGuide.contentBelowTheCardHeader', 'Content below the card header.')}</p>
                            </SharedCardContent>
                        </SharedCard>
                    </div>
                )}

                {/* ── PAGE PATTERNS ── */}
                {activeSection === 'patterns' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.cardTablePattern', 'Card + table pattern')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.standardLayoutForTabularDataInside', 'Standard layout for tabular data inside a card.')}</p>
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h3>{t('app.styleGuide.authorizedKeys', 'Authorized keys')}</h3>
                                <SharedCardFooter variant="legacy">
                                    <Button size="sm"><Plus size={14} /> {t('app.styleGuide.addKey', 'Add key')}</Button>
                                    <Button size="sm" variant="outline"><RefreshCw size={14} /></Button>
                                </SharedCardFooter>
                            </SharedCardHeader>
                            <SharedCardContent variant="legacy" className="card-body">
                                <table className="table">
                                    <thead>
                                        <tr><th>{t('common.labels.type', 'Type')}</th><th>{t('app.styleGuide.fingerprint', 'Fingerprint')}</th><th>{t('app.styleGuide.comment', 'Comment')}</th><th>{t('common.labels.actions', 'Actions')}</th></tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td><code>ssh-ed25519</code></td>
                                            <td><code>{t('app.styleGuide.sha256Abc123', 'SHA256:abc123…')}</code></td>
                                            <td>deploy@server</td>
                                            <td><Button size="sm" variant="destructive">{t('common.actions.remove', 'Remove')}</Button></td>
                                        </tr>
                                    </tbody>
                                </table>
                            </SharedCardContent>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.cardEmptyStatePattern', 'Card + empty state pattern')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.whenTheCardTableHasNo', 'When the card table has no data.')}</p>
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <SharedCardHeader variant="legacy" className="card-header">
                                <h3>{t('app.styleGuide.scanHistory', 'Scan history')}</h3>
                                <Button size="sm" variant="outline">{t('common.actions.refresh', 'Refresh')}</Button>
                            </SharedCardHeader>
                            <SharedCardContent variant="legacy" className="card-body">
                                <EmptyState
                                    icon={Search}
                                    title={t('app.styleGuide.noScansYet', 'No scans yet')}
                                    description={t('app.styleGuide.startAScanAboveToCheck', 'Start a scan above to check for threats.')}
                                />
                            </SharedCardContent>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.cardGridScanOptions', 'Card grid (scan options)')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.actionCardsInAGridFor', 'Action cards in a grid for scan/setup type selections.')}</p>
                        <div className="styleguide__scan-grid">
                            {[
                                { icon: Zap, titleKey: 'app.styleGuide.quickScan', title: 'Quick scan', desc: 'Scan common web directories' },
                                { icon: Globe, titleKey: 'app.styleGuide.fullScan', title: 'Full scan', desc: 'Scan entire system (slow)' },
                                { icon: FolderOpen, titleKey: 'app.styleGuide.customPath', title: 'Custom path', desc: 'Scan a specific directory' },
                            ].map(item => (
                                <SharedCard variant="legacy" key={item.title} className="card styleguide__demo-card styleguide__demo-card--interactive">
                                    <div className="styleguide__scan-icon">
                                        <div className="stat-icon"><item.icon size={20} /></div>
                                    </div>
                                    <h4 className="styleguide__scan-title">{item.title}</h4>
                                    <p className="styleguide__description styleguide__description--muted styleguide__description--section-end">{item.desc}</p>
                                    <Button size="sm">{t('app.styleGuide.startScan', 'Start scan')}</Button>
                                </SharedCard>
                            ))}
                        </div>

                        <SectionTitle title={t('app.styleGuide.errorBannerAtPageLevel', 'Error banner at page level')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.shownBelowPageHeaderWhenAn', 'Shown below page header when an API call fails.')}</p>
                        <div className="alert alert-danger">
                            {t('app.styleGuide.failedToLoadServicesPleaseTry', "Couldn't load services. Try again.")}
                            <Button variant="unstyled" className="alert-close">&times;</Button>
                        </div>

                        <SectionTitle title={t('app.styleGuide.logViewerLogviewer', 'Log viewer (LogViewer)')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.splitLayoutFileListSidebarLog', 'Split layout: file list sidebar + log content viewer with toolbar.')}</p>
                        <div className="styleguide__log-example">
                            <LogViewer
                                files={[
                                    { name: 'error.log', path: '/var/log/nginx/error.log', size: 2516582, type: 'error' },
                                    { name: 'access.log', path: '/var/log/nginx/access.log', size: 19608371, type: 'access' },
                                    { name: 'syslog', path: '/var/log/syslog', size: 5347737, type: 'default' },
                                ]}
                                selectedPath="/var/log/nginx/error.log"
                                getLogIconType={(log) => log.type}
                                content={`[2026-03-29 14:23:01] ERROR connect() failed (111: Connection refused)\n[2026-03-29 14:23:05] WARN  upstream timed out (110: Connection timed out)\n[2026-03-29 14:23:12] INFO  nginx/1.24.0 started\n[2026-03-29 14:23:12] INFO  worker process 1234 started`}
                                searchPattern=""
                                lineCount={100}
                                onLineCountChange={() => {}}
                                autoRefresh={false}
                                onAutoRefreshChange={() => {}}
                                onRefreshFiles={() => {}}
                                onRefreshContent={() => {}}
                                onDownload={() => {}}
                                onClear={() => {}}
                            />
                        </div>

                        <SectionTitle title={t('app.styleGuide.journalControlsJournalcontrols', 'Journal controls (JournalControls)')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.journalTabWithServiceUnitChips', 'Journal tab with service unit chips and priority filter.')}</p>
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <JournalControls
                                unit="nginx"
                                onUnitChange={() => {}}
                                quickUnits={['nginx', 'mysql', 'postgresql', 'docker', 'sshd', 'cron']}
                                lineCount={100}
                                onLineCountChange={() => {}}
                                priority=""
                                onPriorityChange={() => {}}
                                onLoad={() => {}}
                            />
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.codeLogViewerBlock', 'Code/log viewer block')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.monospacePreformattedContentWithDarkBackground', 'Monospace preformatted content with dark background.')}</p>
                        <div className="journal-viewer styleguide__journal-example">
                            <pre>{`Mar 29 14:23:01 srv-01 nginx[1234]: worker process started\nMar 29 14:23:02 srv-01 systemd[1]: Started Nginx HTTP Server\nMar 29 14:23:05 srv-01 sshd[5678]: Accepted publickey for deploy\nMar 29 14:23:12 srv-01 cron[91011]: (root) CMD (/usr/local/bin/backup.sh)`}</pre>
                        </div>

                        <SectionTitle title={t('app.styleGuide.processTableProcesstable', 'Process table (ProcessTable)')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.tableWithInlineUsageBarsAnd', 'Table with inline usage bars and action buttons.')}</p>
                        <ProcessTable
                            processes={[
                                { pid: 1234, name: 'nginx', user: 'www-data', cpu_percent: 12.5, memory_percent: 3.2, memory_info: { rss: 134543872 }, status: 'running' },
                                { pid: 5678, name: 'postgres', user: 'postgres', cpu_percent: 8.1, memory_percent: 15.4, memory_info: { rss: 644874240 }, status: 'sleeping' },
                                { pid: 9012, name: 'node', user: 'deploy', cpu_percent: 45.2, memory_percent: 22.1, memory_info: { rss: 924844032 }, status: 'running' },
                            ]}
                            onKill={() => {}}
                            onForceKill={() => {}}
                        />

                        <SectionTitle title={t('app.styleGuide.detailPanelProcessdetailspanel', 'Detail panel (ProcessDetailsPanel)')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.expandableDetailPanelBelowAList', 'Expandable detail panel below a list/table selection.')}</p>
                        <ProcessDetailsPanel
                            process={{
                                pid: 1234,
                                name: 'nginx',
                                user: 'www-data',
                                status: 'running',
                                cpu_percent: 12.5,
                                memory_info: { rss: 134543872 },
                                num_threads: 4,
                                create_time: 1711700400,
                                command: "/usr/sbin/nginx -g 'daemon off;'",
                            }}
                            onClose={() => {}}
                        />

                        <SectionTitle title={t('app.styleGuide.serviceCardsGridServicecardServicesgrid', 'Service cards grid (ServiceCard / ServicesGrid)')} />
                        <p className="styleguide__description styleguide__description--spaced">{t('app.styleGuide.gridOfServiceCardsWithStatus', 'Grid of service cards with status dot, metadata, and action buttons.')}</p>
                        <ServicesGrid>
                            {[
                                { name: 'nginx', status: 'running', desc: 'HTTP and reverse proxy server', pid: 1234, mem: '48.2 MB' },
                                { name: 'postgresql', status: 'running', desc: 'PostgreSQL database server', pid: 5678, mem: '256 MB' },
                                { name: 'redis-server', status: 'inactive', desc: 'In-memory data structure store', pid: null, mem: null },
                                { name: 'php8.2-fpm', status: 'running', desc: 'PHP FastCGI Process Manager', pid: 3456, mem: '92 MB' },
                            ].map(s => {
                                const meta = [
                                    s.pid && { label: 'PID', value: s.pid },
                                    s.mem && { labelKey: 'common.labels.memory', label: 'Memory', value: s.mem },
                                ].filter(Boolean);
                                return (
                                    <ServiceCard
                                        key={s.name}
                                        name={s.name}
                                        status={s.status}
                                        description={s.desc}
                                        meta={meta}
                                        actions={
                                            <>
                                                {s.status === 'running' ? (
                                                    <>
                                                        <Button size="sm" variant="outline">{t('common.actions.restart', 'Restart')}</Button>
                                                        <Button size="sm" variant="outline">{t('common.actions.stop', 'Stop')}</Button>
                                                    </>
                                                ) : (
                                                    <Button size="sm">{t('common.actions.start', 'Start')}</Button>
                                                )}
                                                <Button size="sm" variant="outline">{t('common.labels.logs', 'Logs')}</Button>
                                            </>
                                        }
                                    />
                                );
                            })}
                        </ServicesGrid>
                    </div>
                )}

                {/* ── UTILITIES ── */}
                {activeSection === 'utilities' && (
                    <div className="styleguide__section">
                        <SectionTitle title={t('app.styleGuide.flexUtilities', 'Flex layouts')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">.styleguide__flex-example</p>
                            <div className="styleguide__flex-example">
                                <div className="styleguide__util-box">A</div>
                                <div className="styleguide__util-box">B</div>
                                <div className="styleguide__util-box">C</div>
                            </div>
                            <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">.styleguide__flex-example--spread</p>
                            <div className="styleguide__flex-example styleguide__flex-example--spread">
                                <div className="styleguide__util-box">{t('app.styleGuide.left', 'Left')}</div>
                                <div className="styleguide__util-box">{t('app.styleGuide.right', 'Right')}</div>
                            </div>
                            <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">.styleguide__flex-example--stack</p>
                            <div className="styleguide__flex-example styleguide__flex-example--stack">
                                <div className="styleguide__util-box">{t('app.styleGuide.row1', 'Row 1')}</div>
                                <div className="styleguide__util-box">{t('app.styleGuide.row2', 'Row 2')}</div>
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.gridUtilities', 'Grid layouts')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            <p className="styleguide__description styleguide__description--muted styleguide__description--spaced">.styleguide__layout-grid</p>
                            <div className="styleguide__layout-grid">
                                {[1,2,3,4,5,6,7,8].map(i => (
                                    <div key={i} className="styleguide__util-box">{t('app.styleGuide.cell', 'Cell')} {i}</div>
                                ))}
                            </div>
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.zIndexScale', 'Z-index scale')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            {[
                                ['$z-dropdown', 10], ['$z-sticky', 20], ['$z-fixed', 30],
                                ['$z-modal-backdrop', 40], ['$z-modal', 50], ['$z-tooltip', 60],
                            ].map(([token, val]) => (
                                <div key={token} className="styleguide__token-row">
                                    <span className="styleguide__token-name styleguide__token-name--layout">{token}</span>
                                    <span className="mono">{val}</span>
                                </div>
                            ))}
                        </SharedCard>

                        <SectionTitle title={t('app.styleGuide.breakpoints', 'Breakpoints')} />
                        <SharedCard variant="legacy" className="card styleguide__demo-card">
                            {[
                                ['$breakpoint-sm', '640px'], ['$breakpoint-md', '768px'],
                                ['$breakpoint-lg', '1024px'], ['$breakpoint-xl', '1280px'],
                            ].map(([token, val]) => (
                                <div key={token} className="styleguide__token-row">
                                    <span className="styleguide__token-name styleguide__token-name--layout">{token}</span>
                                    <span className="mono">{val}</span>
                                </div>
                            ))}
                        </SharedCard>
                    </div>
                )}
            </div>
        </div>
    );
}

function SectionTitle({ title }) {
    return <h2 className="styleguide__section-title">{title}</h2>;
}

function Swatch({ name, label, text }) {
    const style = text
        ? { color: `var(${name})`, background: 'var(--bg-card)' }
        : { background: `var(${name})` };
    return (
        <div className="styleguide__swatch">
            <div className="styleguide__swatch-preview" style={style}>
                {text && <span className="styleguide__swatch-text">Aa</span>}
            </div>
            <span className="styleguide__swatch-label">{label}</span>
            <span className="styleguide__swatch-token">{name}</span>
        </div>
    );
}

function SwatchStatic({ color, label, token }) {
    return (
        <div className="styleguide__swatch">
            <div className="styleguide__swatch-preview" style={{ background: color }} />
            <span className="styleguide__swatch-label">{label}</span>
            <span className="styleguide__swatch-token">{token}</span>
        </div>
    );
}
