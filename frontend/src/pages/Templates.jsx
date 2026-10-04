import { useCallback, useState, useEffect, useMemo, useRef  } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Search, BookOpen, Container, Globe, BarChart3,
    Database, Shield, Cloud, MessageSquare, Video, Music, Image, Home,
    Code, Server, GitBranch, Workflow, HardDrive, Lock, Users, FileText,
    Layers, LayoutTemplate, Check, Cpu,
    Newspaper, TrendingUp, Rocket, Box, Download, ChevronRight,
    CheckCircle2, AlertTriangle, XCircle, HelpCircle
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import {
    SearchField, FilterDrawer, FilterButton, countActiveFilters, Drawer,
    DataTableFooter, CatalogCard, CatalogGrid,
} from '@/components/ds';
import { useTableChrome, GridViewPicker, GridToolsMenu } from '@/components/ds/grid';
import ServerPicker from '@/components/ServerPicker';
import PortField from '@/components/PortField';
import { LOCAL_SERVER_ID } from '@/utils/serverTarget';
import { useTopbarChrome } from '@/hooks/useTopbarActions';
import { applyTableSorts, useTableSort } from '@/hooks/useTableSort';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { useManagedProfile } from '../contexts/useManagedProfile';
import ManagedCard from '../components/ManagedCard';
import { useTranslation } from 'react-i18next';

// Featured templates (curated list)
const FEATURED_TEMPLATES = [
    'prompture-hub', 'wordpress', 'nextcloud', 'grafana', 'portainer',
    'uptime-kuma', 'gitea', 'vaultwarden', 'jellyfin', 'ghost', 'n8n'
];

// Icon strategy: every template ships an inline lucide-style base64 SVG in its
// YAML `icon:` field (rendered first by renderIcon). This map is the keyed
// fallback used when a template has no inline icon or it fails to load, so the
// grid never shows a broken image. Keep ids here in sync with backend/templates.
const TEMPLATE_ICONS = {
    // AI / LLM
    'prompture-hub': Cpu,
    'ollama-webui': Cpu,
    'qdrant': Database,
    'chroma': Database,
    'litellm': Cpu,
    'flowise': Workflow,
    'langflow': Workflow,
    'anythingllm': Cpu,
    'librechat': MessageSquare,
    'agentsite': Cpu,
    // Monitoring
    'uptime-kuma': BarChart3,
    'grafana': BarChart3,
    'prometheus': BarChart3,
    'netdata': BarChart3,
    'loki': BarChart3,
    'jaeger': BarChart3,
    'plausible': BarChart3,
    'umami': BarChart3,
    'beszel': BarChart3,
    'signoz': BarChart3,
    // Search
    'meilisearch': Search,
    'typesense': Search,
    'searxng': Search,
    // CMS / Blog
    'wordpress': Globe,
    'ghost': FileText,
    'strapi': Layers,
    'directus': Database,
    'payload': Layers,
    'grav': FileText,
    // DevOps
    'portainer': Container,
    'jenkins': Workflow,
    'drone': Workflow,
    'gitlab-runner': GitBranch,
    'sonarqube': Code,
    'registry': Container,
    'vault': Lock,
    // Storage
    'nextcloud': Cloud,
    'minio': Cloud,
    'seafile': Cloud,
    'filebrowser': HardDrive,
    'syncthing': Cloud,
    'duplicati': HardDrive,
    // Collaboration
    'rocketchat': MessageSquare,
    'mattermost': MessageSquare,
    'matrix-synapse': MessageSquare,
    'jitsi': Video,
    // Media
    'jellyfin': Video,
    'plex': Video,
    'photoprism': Image,
    'immich': Image,
    'navidrome': Music,
    'audiobookshelf': Music,
    'calibre-web': BookOpen,
    'sonarr': Video,
    'radarr': Video,
    'jellyseerr': Video,
    'prowlarr': Search,
    'qbittorrent': HardDrive,
    // News / RSS
    'freshrss': Newspaper,
    'miniflux': Newspaper,
    // Documents
    'paperless-ngx': FileText,
    'stirling-pdf': FileText,
    'memos': FileText,
    // Finance
    'actualbudget': TrendingUp,
    'firefly-iii': TrendingUp,
    // Project management
    'vikunja': Check,
    'plane': Workflow,
    // Productivity
    'bookstack': BookOpen,
    'wikijs': BookOpen,
    'outline': FileText,
    'excalidraw': FileText,
    'n8n': Workflow,
    // Notifications
    'gotify': MessageSquare,
    'ntfy': MessageSquare,
    // Security
    'vaultwarden': Lock,
    'authelia': Shield,
    'keycloak': Shield,
    'crowdsec': Shield,
    'authentik': Shield,
    'wg-easy': Shield,
    'pihole': Shield,
    // Business / niche
    'chatwoot': MessageSquare,
    'documenso': FileText,
    'metabase': BarChart3,
    'posthog': TrendingUp,
    'nodebb': Users,
    'linkding': BookOpen,
    'karakeep': BookOpen,
    // Database tools
    'phpmyadmin': Database,
    'pgadmin': Database,
    'redis-commander': Database,
    'mongo-express': Database,
    // Home Automation
    'homeassistant': Home,
    'nodered': Workflow,
    'mosquitto': Home,
    'zigbee2mqtt': Home,
    // Development
    'code-server': Code,
    'gitea': GitBranch,
    // Networking
    'traefik': Server,
    'caddy': Server,
    'nginx-proxy-manager': Server,
    // Custom apps
    'php-app': Code,
    'python-app': Code,
    'node-app': Code
};

const KIND_OPTIONS = [
    { value: 'compose', labelKey: 'app.templates.oneClick', label: 'One-click' },
    { value: 'repo', labelKey: 'app.templates.gitRepo', label: 'Git repo' },
];

const isFeatured = (templateId) => FEATURED_TEMPLATES.includes(templateId);
const kindLabel = (template) => ((template.kind || 'compose') === 'repo' ? 'Git repo' : 'One-click');

// The catalog stays a card grid — a template is something you read, not a row
// you scan — but the chrome around it still has to know what a template IS.
// These descriptors are what the saved views sort by and what the "⋮" exports;
// nothing renders them, so none of them carries a `render`.
const templateColumns = [
    { key: 'name', headerKey: 'app.templates.template', header: 'Template', type: 'text', value: (t) => t.name || '', sortValue: (t) => t.name || '' },
    {
        key: 'featured',
        headerKey: 'app.templates.featured', header: 'Featured',
        type: 'bool',
        value: (t) => isFeatured(t.id),
        // 1/0 rather than the boolean: applyTableSorts compares booleans as the
        // strings "true"/"false", which happens to work and would stop working
        // the moment anyone renamed the labels.
        sortValue: (t) => (isFeatured(t.id) ? 1 : 0),
    },
    { key: 'kind', headerKey: 'common.labels.type', header: 'Type', type: 'enum', enumOrder: ['One-click', 'Git repo'], value: kindLabel, sortValue: kindLabel },
    { key: 'version', headerKey: 'common.labels.version', header: 'Version', type: 'text', value: (t) => t.version || '', sortValue: (t) => t.version || '' },
    { key: 'categories', headerKey: 'app.templates.categories', header: 'Categories', type: 'text', value: (t) => (t.categories || []).join(', ') },
    { key: 'description', headerKey: 'common.labels.description', header: 'Description', type: 'text', value: (t) => t.description || '' },
];

// Sort orders are built-in saved views now. The two-button Featured / A–Z strip
// beside the result count and the drawer's own "Sort" group were the same three
// orders offered twice, and neither could be saved or shared as a link.
//
// The views describe ORDER only — no `page` bag. Type and category stay
// URL-backed drawer filters, and a view that also wrote them could not win: the
// router defers its own state update, so `useViewLink` rewrites `?view=` from
// the search string as it was BEFORE the view was applied and drops any param
// the same apply had just written. A view whose type slice silently did nothing
// is worse than no such view.
const NO_RULES = { match: 'all', rules: [] };
const FEATURED_SORT = [
    { key: 'featured', direction: 'desc' },
    { key: 'name', direction: 'asc' },
];

const TEMPLATE_VIEWS = [
    { name: 'Featured first', state: { sorts: FEATURED_SORT, hiddenKeys: [], columnFilters: NO_RULES } },
    { name: 'A–Z', state: { sorts: [{ key: 'name', direction: 'asc' }], hiddenKeys: [], columnFilters: NO_RULES } },
    { name: 'Z–A', state: { sorts: [{ key: 'name', direction: 'desc' }], hiddenKeys: [], columnFilters: NO_RULES } },
];

const Templates = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const toast = useToast();
    const toastError = toast.error;
    const [searchParams, setSearchParams] = useSearchParams();

    const [templates, setTemplates] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [failedIcons, setFailedIcons] = useState(new Set());
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [filtersOpen, setFiltersOpen] = useState(false);

    // Deploying targets a fleet ServerKit Cloud operates under the managed
    // profile (plan 25): the catalog stays browsable, the Deploy control goes.
    const { isControlHeld, profile: managedProfile } = useManagedProfile();
    const deployManaged = isControlHeld('templates-deploy');

    // Initialize from URL params
    const selectedCategory = searchParams.get('category') || '';
    const selectedKind = searchParams.get('kind') || '';
    const searchQuery = searchParams.get('search') || '';
    const installTemplateId = searchParams.get('install');
    const installAttempt = useRef(null);
    const templatesRequest = useRef(0);

    const { sorts, setSorts } = useTableSort({
        defaultSorts: FEATURED_SORT,
        storageKey: 'serverkit-table-templates-sort',
    });

    const loadCategories = useCallback(async () => {
        try {
            const result = await api.getTemplateCategories();
            setCategories(result.categories || []);
        } catch {
            // Categories only feed the filter drawer's options; the catalog
            // itself reports its own load failure in the content area.
        }
    }, []);

    const loadTemplates = useCallback(async () => {
        const request = ++templatesRequest.current;
        setLoading(true);
        try {
            const result = await api.listTemplates(selectedCategory || null, searchQuery || null);
            if (request === templatesRequest.current) {
                setTemplates(result.templates || []);
                setLoadError(null);
            }
        } catch (err) {
            if (request === templatesRequest.current) setLoadError(err);
        } finally {
            if (request === templatesRequest.current) setLoading(false);
        }
    }, [selectedCategory, searchQuery]);

    const handleViewTemplate = useCallback(async (template) => {
        // WordPress has its own dedicated page
        if (template.id === 'wordpress') {
            navigate('/wordpress');
            return;
        }
        try {
            const result = await api.getTemplate(template.id);
            if (result.template) {
                setSelectedTemplate(result.template);
            }
        } catch {
            toastError(t('app.templates.failedToLoadTemplateDetails', 'Failed to load template details'));
        }
    }, [navigate, t, toastError]);

    useEffect(() => {
        loadCategories();
    }, [loadCategories]);

    // Compat: the old `#deploy-templates` anchor (linked from the wizard + docs)
    // now redirects to the repo-kind filtered view of the unified grid.
    useEffect(() => {
        if (window.location.hash === '#deploy-templates' && !selectedKind) {
            setSearchParams(previous => {
                const next = new URLSearchParams(previous);
                next.set('kind', 'repo');
                return next;
            });
            // Drop the hash so a refresh doesn't re-trigger.
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }, [selectedKind, setSearchParams]);

    // Auto-open install modal if template ID is in URL (compose templates only;
    // repo templates deploy through the wizard, never the install modal).
    useEffect(() => {
        if (!installTemplateId) {
            installAttempt.current = null;
            return;
        }
        if (templates.length > 0 && !loading && installAttempt.current !== installTemplateId) {
            if (installTemplateId === 'wordpress') {
                navigate('/wordpress', { replace: true });
                return;
            }
            const template = templates.find(t => t.id === installTemplateId);
            // Repo templates are no longer excluded — they deploy from this same
            // drawer, so ?install=<id> works for the whole catalog.
            if (template) {
                installAttempt.current = installTemplateId;
                handleViewTemplate(template).then(() => {
                    setShowInstallModal(true);
                });
                setSearchParams(previous => {
                    const next = new URLSearchParams(previous);
                    next.delete('install');
                    return next;
                }, { replace: true });
            }
        }
    }, [installTemplateId, templates, loading, handleViewTemplate, navigate, setSearchParams]);

    useEffect(() => {
        loadTemplates();
    }, [loadTemplates]);

    // Functional update: ?view= is written by the chrome from its own copy of
    // the search string, so rebuilding this one from a captured `searchParams`
    // would drop whichever of the two landed first.
    function updateFilters(updates) {
        setSearchParams((previous) => {
            const next = new URLSearchParams(previous);
            Object.entries(updates).forEach(([key, value]) => {
                if (value) next.set(key, value);
                else next.delete(key);
            });
            return next;
        });
    }

    function setSearchQueryFilter(search) {
        updateFilters({ search: search || null });
    }

    // Clears the filters, not the whole query string — ?view= is which view you
    // are in, not something the filters put there.
    function clearAllFilters() {
        updateFilters({ category: null, kind: null, search: null });
    }


    function handleIconError(templateId) {
        setFailedIcons(prev => new Set(prev).add(templateId));
    }

    function getTemplateIcon(templateId) {
        return TEMPLATE_ICONS[templateId] || Layers;
    }

    function renderIcon(template, size = 32) {
        const IconComponent = getTemplateIcon(template.id);
        const hasIcon = template.icon && !failedIcons.has(template.id);

        if (hasIcon) {
            return (
                <img
                    src={template.icon}
                    alt={template.name}
                    onError={() => handleIconError(template.id)}
                />
            );
        }
        return <IconComponent size={size} />;
    }


    // Load the full template record. Used by the ?install=<id> deep link, which
    // needs variables/description before the deploy drawer can open.


    // What both a card click and its Deploy button do — one predictable
    // outcome for every template, compose or repo. A curated repo template
    // already declares its repo, branch, build method and port, so the
    // detection wizard had nothing left to ask; it deploys from the same
    // drawer as everything else.
    async function handleDeploy(template) {
        if (deployManaged) return;
        if (template.id === 'wordpress') {
            navigate('/wordpress');
            return;
        }
        try {
            const result = await api.getTemplate(template.id);
            if (result.template) {
                setSelectedTemplate(result.template);
                setShowInstallModal(true);
            }
        } catch {
            toast.error(t('app.templates.failedToLoadTemplateDetails', 'Failed to load template details'));
        }
    }

    // Kind is filtered client-side (the list endpoint filters category + search).
    const kindFiltered = useMemo(
        () => (selectedKind
            ? templates.filter(t => (t.kind || 'compose') === selectedKind)
            : templates),
        [templates, selectedKind],
    );

    // The active-filter badge counts real filters only (category + kind); sort is
    // an ordering, not a filter, so it never inflates the count.
    const activeFilterCount = countActiveFilters({ category: selectedCategory, kind: selectedKind });
    const hasActiveFilters = Boolean(selectedCategory || selectedKind || searchQuery);

    // How many templates each option would match, counted over the whole
    // catalog rather than the current result set — a count that shrank to 0 as
    // you filtered would say nothing about whether the option is worth a click.
    const optionCounts = useMemo(() => {
        const byKind = {};
        const byCategory = {};
        templates.forEach((t) => {
            const kind = t.kind || 'compose';
            byKind[kind] = (byKind[kind] || 0) + 1;
            (t.categories || []).forEach((c) => {
                byCategory[c] = (byCategory[c] || 0) + 1;
            });
        });
        return { byKind, byCategory };
    }, [templates]);

    const filterGroups = [
        {
            key: 'kind',
            labelKey: 'common.labels.type', label: 'Type',
            type: 'single',
            options: KIND_OPTIONS.map(o => ({ ...o, count: optionCounts.byKind[o.value] || 0 })),
        },
        {
            key: 'category',
            labelKey: 'app.templates.category', label: 'Category',
            type: 'single',
            options: categories.map(cat => ({
                value: cat,
                label: cat,
                count: optionCounts.byCategory[cat] || 0,
            })),
        },
    ];

    const filterValue = { category: selectedCategory, kind: selectedKind };

    function handleFilterChange(next) {
        updateFilters({
            category: next.category || null,
            kind: next.kind || null,
        });
    }

    // No `pageState`: type and category are the drawer's, and a template belongs
    // to SEVERAL categories at once, so neither could become a column rule
    // either — the rule engine compares one value per row, and "is any of" would
    // miss every template whose match is its second category.
    const chrome = useTableChrome({
        columns: templateColumns,
        rows: kindFiltered,
        viewPageKey: 'templates',
        builtinViews: TEMPLATE_VIEWS,
        noun: 'templates',
        sorts,
        setSorts,
    });

    // No <DataTable> to apply the view's sort, so the cards do it themselves
    // from the same state a table would have used.
    const sortedTemplates = useMemo(
        () => applyTableSorts(chrome.shownRows, sorts, chrome.columns),
        [chrome.shownRows, sorts, chrome.columns],
    );

    // Search, the filter button and the "⋮" ride the tab group's top bar, so the
    // view row below is the view name alone.
    const { portal: topbarChrome, actions: chromeActions } = useTopbarChrome(
        <>
            <SearchField
                value={searchQuery}
                onSearch={setSearchQueryFilter}
                placeholder={t('app.templates.searchTemplates', 'Search templates…')}
            />
            <FilterButton count={activeFilterCount} onClick={() => setFiltersOpen(true)} />
            <GridToolsMenu {...chrome.toolsProps} onRefresh={() => Promise.all([loadCategories(), loadTemplates()])} />
        </>,
    );

    if (loading) {
        return (
            <div className="sk-tabgroup__inner">
                <EmptyState loading loadingVariant="cards" title={t('app.templates.loadingTemplates', 'Loading templates')} />
            </div>
        );
    }

    return (
        <div className="sk-tabgroup__inner templates-page">
            {topbarChrome}
            {/* The catalog is not the only way in: a repo or an archive skips
                templates entirely, so both routes lead the page rather than
                hiding behind the New Service tab. */}
            <div className="tpl-quickstart">
                <Button variant="unstyled" type="button" className="tpl-quickstart__card" onClick={() => navigate('/services/new?source=github')}>
                    <span className="tpl-quickstart__ico"><GitBranch size={18} /></span>
                    <span className="tpl-quickstart__body">
                        <span className="tpl-quickstart__title">{t('app.templates.importFromGithub', 'Import from GitHub')}</span>
                        <span className="tpl-quickstart__sub">{t('app.templates.connectARepoAndAutoDeploy', 'Connect a repo and auto-deploy on every push')}</span>
                    </span>
                    <ChevronRight size={16} className="tpl-quickstart__arrow" />
                </Button>
                <Button variant="unstyled" type="button" className="tpl-quickstart__card" onClick={() => navigate('/services/new?source=archive')}>
                    <span className="tpl-quickstart__ico"><Download size={18} /></span>
                    <span className="tpl-quickstart__body">
                        <span className="tpl-quickstart__title">{t('app.templates.importAZip', 'Import a ZIP')}</span>
                        <span className="tpl-quickstart__sub">{t('app.templates.dropInAProjectArchiveTo', 'Drop in a project archive to build and run')}</span>
                    </span>
                    <ChevronRight size={16} className="tpl-quickstart__arrow" />
                </Button>
            </div>

            {/* The one row of chrome: the active view names what you are looking
                at, and its actions ride the top bar. The count that used to sit
                here is under the cards now, next to what it is counting. */}
            <GridViewPicker
                views={chrome.views}
                label="templates"
                onCreate={chrome.createView}
                actions={chromeActions}
            />

            {deployManaged && (
                <ManagedCard capability="fleet" profile={managedProfile} compact />
            )}
            {loadError && templates.length > 0 && (
                <ErrorState compact error={loadError} onRetry={loadTemplates} />
            )}
            {loadError && templates.length === 0 ? (
                <ErrorState
                    title={t('app.templates.couldntLoadTemplates', "Couldn't load templates")}
                    error={loadError}
                    onRetry={loadTemplates}
                />
            ) : sortedTemplates.length === 0 ? (
                <EmptyState
                    icon={LayoutTemplate}
                    title={t('app.templates.noTemplatesFound', 'No templates found')}
                    description={hasActiveFilters ? t('app.templates.tryAdjustingYourFilters', 'Try adjusting your filters') : t('app.templates.noTemplatesAreAvailableYet', 'No templates are available yet')}
                    action={hasActiveFilters && (
                        <Button variant="outline" size="sm" onClick={clearAllFilters}>
                            {t('app.templates.clearFilters', 'Clear filters')}
                        </Button>
                    )}
                />
            ) : (
                <CatalogGrid>
                    {sortedTemplates.map(template => {
                        const isRepo = (template.kind || 'compose') === 'repo';
                        return (
                            <CatalogCard
                                key={template.id}
                                icon={renderIcon(template, 22)}
                                title={template.name}
                                sub={`v${template.version}`}
                                tag={isRepo ? t('app.templates.gitRepo', 'Git repo') : t('app.templates.oneClick', 'One-click')}
                                featured={isFeatured(template.id)}
                                description={template.description}
                                facts={(template.categories || []).slice(0, 2).join(' · ')}
                                onClick={deployManaged ? undefined : () => handleDeploy(template)}
                                action={!deployManaged && (
                                    <Button variant="outline" size="sm" onClick={() => handleDeploy(template)}>
                                        <Rocket size={12} /> {t('app.templates.deploy', 'Deploy')}
                                    </Button>
                                )}
                            />
                        );
                    })}
                </CatalogGrid>
            )}

            {/* Under the cards, not above them: `templates` is what the category
                and search query returned, `sortedTemplates` is what the kind
                slice left of it. */}
            {sortedTemplates.length > 0 && (
                <DataTableFooter
                    shown={sortedTemplates.length}
                    total={templates.length}
                    noun="template"
                />
            )}

            {/* Install Modal (compose templates only) */}
            {showInstallModal && selectedTemplate && (
                <InstallModal
                    template={selectedTemplate}
                    renderIcon={renderIcon}
                    onClose={() => {
                        setShowInstallModal(false);
                        setSelectedTemplate(null);
                    }}
                    onSuccess={(appId) => {
                        setShowInstallModal(false);
                        setSelectedTemplate(null);
                        toast.success(t('app.templates.applicationInstalledSuccessfully', 'Service installed'));
                        navigate(`/services/${appId}/logs`);
                    }}
                />
            )}

            <FilterDrawer
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                groups={filterGroups}
                value={filterValue}
                onChange={handleFilterChange}
                title={t('app.templates.filterTemplates', 'Filter templates')}
                activeCount={activeFilterCount}
                resultCount={sortedTemplates.length}
                resultNoun="template"
            />
        </div>
    );
};

// The one deploy surface for every template, compose or repo.
// Whether the chosen server has room for this template: what it typically
// needs, against what that server has free right now.
//
// Advisory by design — it never disables the Deploy button. An estimate is an
// estimate, and the operator knows things the panel doesn't (a box about to be
// resized, an app that idles far below its documented minimum). The job here is
// to make sure nobody is *surprised*, not to hold the door shut.
const CAPACITY_TONES = {
    ok: { icon: CheckCircle2, labelKey: 'app.templates.fits', label: 'Fits' },
    tight: { icon: AlertTriangle, labelKey: 'app.templates.tight', label: 'Tight' },
    insufficient: { icon: XCircle, labelKey: 'app.templates.wonTFit', label: 'Won\'t fit' },
    unknown: { icon: HelpCircle, labelKey: 'app.templates.unknown', label: 'Unknown' },
};

const CapacityNote = ({ capacity, loading }) => {
    // Nothing on first paint rather than a flash of "unknown" that immediately
    // becomes an answer.
    if (!capacity && loading) return null;
    if (!capacity) return null;

    const tone = CAPACITY_TONES[capacity.verdict] || CAPACITY_TONES.unknown;
    const Icon = tone.icon;

    return (
        <div className={`tpl-capacity tpl-capacity--${capacity.verdict}`}
             aria-live="polite" data-loading={loading ? 'true' : undefined}>
            <Icon size={16} className="tpl-capacity__icon" />
            <div className="tpl-capacity__text">
                <strong className="tpl-capacity__headline">{capacity.headline}</strong>
                <span className="tpl-capacity__detail">{capacity.detail}</span>
            </div>
        </div>
    );
};

const InstallModal = ({ template, onClose, onSuccess, renderIcon }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const isRepo = (template.kind || 'compose') === 'repo';
    const [appName, setAppName] = useState(
        (template.repo?.service_name || template.id).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    );
    const [branch, setBranch] = useState(template.repo?.branch || 'main');
    const [variables, setVariables] = useState({});
    const [selectedServerId, setSelectedServerId] = useState(LOCAL_SERVER_ID);
    const [capacity, setCapacity] = useState(null);
    const [capacityLoading, setCapacityLoading] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [errors, setErrors] = useState([]);
    // Managed-sites base domain, so the drawer can offer the subdomain this
    // service would get instead of leaving the user to wire DNS afterwards.
    const [baseDomain, setBaseDomain] = useState(null);
    const [httpsBase, setHttpsBase] = useState(false);

    useEffect(() => {
        // Initialize variables with defaults
        const defaults = {};
        (template.variables || []).forEach(v => {
            if (v.default) {
                defaults[v.name] = v.default;
            }
        });
        setVariables(defaults);
    }, [template]);

    useEffect(() => {
        api.getSiteBaseDomains()
            .then((data) => {
                const bases = data?.base_domains || [];
                const chosen = bases.find((b) => b.domain === data?.default) || bases[0];
                setBaseDomain(chosen?.domain || null);
                setHttpsBase(!!chosen?.https_enabled);
            })
            .catch(() => setBaseDomain(null));
    }, []);

    // Ask whether this template fits the chosen server, and re-ask whenever
    // they switch — the whole point is to answer before the deploy, not after.
    useEffect(() => {
        let cancelled = false;
        setCapacityLoading(true);
        api.getTemplateCapacity(template.id, selectedServerId)
            .then(result => { if (!cancelled) setCapacity(result); })
            .catch(() => { if (!cancelled) setCapacity(null); })
            .finally(() => { if (!cancelled) setCapacityLoading(false); });
        return () => { cancelled = true; };
    }, [template.id, selectedServerId]);

    // The promise is only shown when it can actually be kept: the finalizer
    // publishes <name>.<base> via the panel's own nginx, which can't proxy a
    // container on a remote server — and the repo pipeline has no auto-publish
    // step at all. Showing it and then landing on host:port is worse than not
    // offering it (the operator had to redo the domain in service settings).
    const isLocalTarget = selectedServerId === LOCAL_SERVER_ID;
    const domainPreview = baseDomain && appName && isLocalTarget && !isRepo
        ? `${appName}.${baseDomain}` : null;

    async function handleInstall(e) {
        e.preventDefault();
        setInstalling(true);
        setErrors([]);

        // A repo template builds from source rather than composing images, so
        // it goes through createAppFromRepository. Everything that endpoint
        // needs is already declared by the template, which is why this no
        // longer detours through the New Service wizard's detection steps.
        if (isRepo) {
            try {
                const repo = template.repo || {};
                // Forward the build inputs the template already declares. The
                // endpoint has always accepted these; the drawer just never sent
                // them, so a repo template's build_command/start_command were
                // decorative and anything without a `start` script in its
                // package.json built an image that could not boot.
                const result = await api.createAppFromRepository({
                    name: appName,
                    template_id: template.id,
                    repo_url: repo.url,
                    branch: branch.trim() || repo.branch || 'main',
                    app_type: repo.app_type || 'auto',
                    build_method: repo.build_method || 'auto',
                    port: repo.port ? Number(repo.port) : null,
                    dockerfile_path: repo.dockerfile_path || null,
                    custom_build_cmd: repo.build_command || null,
                    custom_start_cmd: repo.start_command || null,
                    auto_deploy: true,
                    ingress_plane: 'nginx',
                });
                onClose?.();
                if (result.deploy_job_id) {
                    navigate(`/deployments/${result.deploy_job_id}`);
                } else {
                    navigate(`/services/${result.app.id}`);
                }
            } catch (err) {
                setErrors([err?.data?.error || err.message || 'Deploy failed']);
                setInstalling(false);
            }
            return;
        }

        try {
            // Validate first
            const validation = await api.validateTemplateInstall(
                template.id, appName, variables, selectedServerId);
            if (!validation.valid) {
                setErrors(validation.errors || ['Validation failed']);
                setInstalling(false);
                return;
            }

            // Install. When the drawer displayed a domain, the deploy must
            // deliver it — the backend honors this over the template's own
            // auto_domain flag, so the promise on screen is the contract.
            const result = await api.installTemplate(template.id, appName, variables, {
                serverId: selectedServerId,
                autoDomain: domainPreview ? true : undefined,
            });
            if (result.success && result.job_id) {
                // Job started — hand off to the full-page Deploy Console.
                onClose?.();
                navigate(`/deployments/${result.job_id}`);
            } else if (result.success) {
                setInstalling(false);
                onSuccess(result.app_id);
            } else {
                setErrors([result.error || 'Installation failed']);
                setInstalling(false);
            }
        } catch (err) {
            // validate-install 400s with an `errors` ARRAY (no `error` key),
            // and request() throws on any non-2xx — so invalid input lands
            // here, never in the `!validation.valid` branch above.
            const serverErrors = Array.isArray(err?.data?.errors) && err.data.errors.length
                ? err.data.errors
                : [err?.data?.error || err.message || 'Installation failed'];
            setErrors(serverErrors);
            setInstalling(false);
        }
    }

    const visibleVars = (template.variables || []).filter(v => !v.hidden);

    return (
        <Drawer
            flush
            open
            onOpenChange={(next) => { if (!next) onClose?.(); }}
            title={t('app.templates.deploy2', 'Deploy {{name}}', { name: template.name })}
            subtitle={[`v${template.version}`, ...(template.categories || []).slice(0, 3)].join(' · ')}
            icon={renderIcon(template, 20)}
            width={520}
            className="sk-formdrawer"
        >
            <form onSubmit={handleInstall} className="sk-formdrawer__form">
                <div className="sk-formdrawer__body">
                    {errors.length > 0 && (
                        <div className="alert alert-danger">
                            <ul>
                                {errors.map((error, i) => <li key={i}>{error}</li>)}
                            </ul>
                        </div>
                    )}

                    <p className="sk-formdrawer__desc">{template.description}</p>

                    <div className="sk-formdrawer__field">
                        <label htmlFor="tpl-deploy-name">{t('app.templates.serviceName', 'Service name')}</label>
                        <div className="sk-formdrawer__input">
                            <Box size={15} />
                            <input
                                id="tpl-deploy-name"
                                type="text"
                                value={appName}
                                onChange={(e) => setAppName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                placeholder="my-app"
                                minLength={2}
                                required
                            />
                        </div>
                        <span className="sk-formdrawer__hint">
                            {t('app.templates.lowercaseLettersNumbersAndHyphensOnly', 'Lowercase letters, numbers, and hyphens only (min 2 chars)')}
                        </span>
                    </div>

                    {/* Repo templates build from source, so the branch is the one
                        thing the template cannot decide for you. */}
                    {isRepo && (
                        <div className="sk-formdrawer__field">
                            <label htmlFor="tpl-deploy-branch">{t('common.labels.branch', 'Branch')}</label>
                            <div className="sk-formdrawer__input">
                                <GitBranch size={15} />
                                <input
                                    id="tpl-deploy-branch"
                                    type="text"
                                    value={branch}
                                    onChange={(e) => setBranch(e.target.value)}
                                    placeholder="main"
                                />
                            </div>
                            <span className="sk-formdrawer__hint">
                                {template.repo?.url || 'Builds from the template repository'}
                            </span>
                        </div>
                    )}

                    {/* Only shown once a managed-sites base domain exists — with
                        no base there is no subdomain to promise, and a dead
                        field would be worse than none. */}
                    {domainPreview && (
                        <div className="sk-formdrawer__field">
                            <span className="sk-formdrawer__label">{t('common.labels.domain', 'Domain')}</span>
                            <div className="sk-formdrawer__input sk-formdrawer__input--readonly">
                                <Globe size={15} />
                                <span className="sk-formdrawer__domain">{domainPreview}</span>
                            </div>
                            <span className="sk-formdrawer__hint">
                                {httpsBase
                                    ? 'Published automatically with HTTPS once the deploy finishes'
                                    : 'Published automatically once the deploy finishes'}
                            </span>
                        </div>
                    )}

                    <div className="sk-formdrawer__field">
                        <span className="sk-formdrawer__label">{t('app.templates.deployToServer', 'Deploy to server')}</span>
                        <ServerPicker
                            value={selectedServerId}
                            onChange={(id) => setSelectedServerId(id)}
                            capability="docker"
                            label={t('app.serverPicker.deployToServer', 'Deploy to server')}
                        />
                        {/* Sits under the picker because the answer depends on
                            which server is chosen — switching re-asks. */}
                        <CapacityNote capacity={capacity} loading={capacityLoading} />
                    </div>

                    {visibleVars.length > 0 && (
                        <div className="sk-formdrawer__field">
                            <span className="sk-formdrawer__label">{t('app.templates.configuration', 'Settings')}</span>
                            {visibleVars.map(variable => (
                                <div key={variable.name} className="form-group">
                                    <label>
                                        {variable.name}
                                        {variable.required && ' *'}
                                    </label>
                                    {variable.options ? (
                                        <Select
                                            value={variables[variable.name] || ''}
                                            onValueChange={(v) => setVariables({...variables, [variable.name]: v})}
                                            required={variable.required}
                                        >
                                            <SelectTrigger aria-label={variable.name}>
                                                <SelectValue placeholder={t('app.templates.select', 'Select…')} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {variable.options.filter(opt => opt !== '').map(opt => (
                                                    <SelectItem key={opt} value={String(opt)}>{opt}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : variable.type === 'port' ? (
                                        // Host ports are only checked against this panel's
                                        // host; on a remote server just the range applies.
                                        <PortField
                                            value={variables[variable.name] || ''}
                                            onChange={(port) => setVariables({...variables, [variable.name]: port === '' ? '' : String(port)})}
                                            host={isLocalTarget}
                                            placeholder={variable.default || ''}
                                            required={variable.required}
                                        />
                                    ) : variable.type === 'password' ? (
                                        <Input
                                            type="password"
                                            value={variables[variable.name] || ''}
                                            onChange={(e) => setVariables({...variables, [variable.name]: e.target.value})}
                                            placeholder={variable.default ? '(auto-generated)' : ''}
                                            required={variable.required && !variable.default}
                                        />
                                    ) : (
                                        <Input
                                            type="text"
                                            value={variables[variable.name] || ''}
                                            onChange={(e) => setVariables({...variables, [variable.name]: e.target.value})}
                                            placeholder={variable.default || ''}
                                            required={variable.required}
                                        />
                                    )}
                                    {variable.description && (
                                        <span className="form-help">{variable.description}</span>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="sk-formdrawer__foot">
                    <Button type="button" variant="outline" onClick={onClose} disabled={installing}>
                        {t('common.actions.cancel', 'Cancel')}
                    </Button>
                    <Button type="submit" disabled={installing}>
                        <Rocket size={15} />
                        {installing ? 'Deploying…' : `Deploy ${template.name}`}
                    </Button>
                </div>
            </form>
        </Drawer>
    );
};

export default Templates;
