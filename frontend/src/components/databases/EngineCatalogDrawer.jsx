import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Layers, Check, Download, Loader2, PackageX, ShieldAlert, RefreshCw, ChevronRight,
} from 'lucide-react';
import api from '../../services/api';
import { Drawer, SearchField, CatalogCard, CatalogGrid } from '@/components/ds';
import EmptyState from '../EmptyState';
import { useToast } from '../../contexts/useToast.js';
import EngineGlyph from './EngineGlyph';
import { useTranslation } from 'react-i18next';
import {
    engineInstanceKey, engineLocation, engineMeta, engineTreeStatus, familiesOf,
    formatMemory,
} from './engineHelpers';
import { Button as SharedButton } from '@/components/ui/button';
import { toastError } from '@/utils/errorMessage';

// "Add a database engine" — the browse half of the install flow.
//
// This component knows the name of no engine. The catalog is every app template
// carrying an `engine:` block, so adding CockroachDB is adding a YAML file:
// families, versions, ports and copy all come off the response. The footer
// links to the full template catalog and to a repository sync, because that is
// how an operator gets an engine ServerKit doesn't ship.
//
// Built on the shared ds/Drawer (Radix Sheet), so Escape, the scrim click and
// focus containment behave like every other drawer in the panel.

function StatusBadge({ status }) {
    if (status === 'installing') {
        return (
            <span className="dbx-eng-badge is-installing">
                <Loader2 size={11} className="dbx-spin" aria-hidden="true" /> installing
            </span>
        );
    }
    if (status === 'failed') {
        return (
            <span className="dbx-eng-badge is-failed">
                <ShieldAlert size={11} aria-hidden="true" /> failed
            </span>
        );
    }
    if (status === 'inactive') return <span className="dbx-eng-badge is-stopped">stopped</span>;
    return (
        <span className="dbx-eng-badge is-running">
            <Check size={11} aria-hidden="true" /> running
        </span>
    );
}

function RunningRow({ instance }) {
    const meta = engineMeta(instance);
    return (
        <li className="dbx-eng-row">
            <span className="dbx-eng-glyph"><EngineGlyph entry={instance} size={16} /></span>
            <span className="dbx-eng-rowtext">
                <span className="dbx-eng-name">{instance.name}</span>
                <span className="dbx-eng-sub">
                    {[
                        instance.template_name || instance.template_id,
                        engineLocation(instance),
                        meta.family,
                        instance.exposed_public ? 'public' : null,
                    ].filter(Boolean).join(' · ')}
                </span>
            </span>
            <StatusBadge status={engineTreeStatus(instance)} />
        </li>
    );
}

function EngineCard({ entry, onPick }) {
    const { t } = useTranslation();
    const meta = engineMeta(entry);
    const memory = formatMemory(entry.requirements?.memory);
    const facts = [
        meta.default_port ? `:${meta.default_port}` : null,
        memory ? `${memory} RAM` : null,
    ].filter(Boolean).join(' · ');

    return (
        <CatalogCard
            icon={<EngineGlyph entry={entry} size={20} />}
            title={entry.name}
            sub={[entry.version ? `v${entry.version}` : null, entry.id].filter(Boolean).join(' · ')}
            tag={meta.family}
            description={entry.description}
            facts={facts}
            onClick={() => onPick(entry)}
            action={(
                <SharedButton
                    variant="outline"
                    size="sm"
                    onClick={() => onPick(entry)}
                    aria-label={t('app.engineCatalogDrawer.install', 'Install {{name}}', { name: entry.name })}
                >
                    <Download size={12} aria-hidden="true" />
                    {entry.installed_count > 0 ? t('app.engineCatalogDrawer.addAnother', 'Add another') : t('app.engineCatalogDrawer.installAction', 'Install')}
                </SharedButton>
            )}
        />
    );
}

export default function EngineCatalogDrawer({
    open,
    onOpenChange,
    catalog = [],
    installed = [],
    // The response carries the family list it derived from the catalog it just
    // built. Deriving it again here is only the fallback.
    families: providedFamilies = null,
    loading = false,
    unavailable = false,
    // Seeds the search box each time the drawer opens, so a caller that already
    // knows which engine you asked for (an "Install" on a tree row) doesn't make
    // you find it again. Empty is the normal case: browse everything.
    presetQuery = '',
    onPick,
    onSynced,
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const [query, setQuery] = useState('');
    const [family, setFamily] = useState(null);
    const [syncing, setSyncing] = useState(false);

    // Only on open/preset change — typing while open must not be overwritten. A
    // scoped open also drops a family filter left over from a previous visit,
    // which would otherwise hide the very engine the caller asked for.
    useEffect(() => {
        if (!open) return;
        setQuery(presetQuery);
        if (presetQuery) setFamily(null);
    }, [open, presetQuery]);

    const families = useMemo(
        () => (providedFamilies?.length ? providedFamilies : familiesOf(catalog)),
        [providedFamilies, catalog],
    );

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        return catalog.filter((entry) => {
            const meta = engineMeta(entry);
            if (family && meta.family !== family) return false;
            if (!q) return true;
            const haystack = [entry.name, entry.description, entry.id, meta.family, meta.protocol]
                .filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(q);
        });
    }, [catalog, query, family]);

    const filtering = Boolean(query.trim() || family);

    async function syncRepos() {
        setSyncing(true);
        try {
            await api.syncTemplates();
            toast.success(t('app.engineCatalogDrawer.templateRepositoriesSynced', 'Template repositories synced'));
            await onSynced?.();
        } catch (err) {
            toastError(toast, t('app.engineCatalogDrawer.couldNotSyncTemplateRepositories', "Couldn't sync template repositories."), err);
        } finally {
            setSyncing(false);
        }
    }

    return (
        <Drawer
            flush
            open={open}
            onOpenChange={onOpenChange}
            title={t('app.engineCatalogDrawer.addADatabaseEngine', 'Add a database engine')}
            subtitle={unavailable
                ? t('app.engineCatalogDrawer.catalogUnavailable', 'catalog unavailable')
                : t('app.engineCatalogDrawer.enginesSameCatalogAsServicesTemplates', '{{length}} engines · same catalog as Services › Templates', { length: catalog.length })}
            icon={<Layers size={18} aria-hidden="true" />}
            width={720}
            className="dbx-drawer"
        >
            <div className="dbx-drawer__shell">
                <div className="dbx-eng-filters">
                    <SearchField
                        value={query}
                        onSearch={setQuery}
                        placeholder={t('app.engineCatalogDrawer.searchEngines', 'Search engines…')}
                        className="dbx-eng-search"
                    />
                    {families.length > 0 && (
                        <div className="dbx-cat-chips" role="group" aria-label={t('app.engineCatalogDrawer.filterByFamily', 'Filter by family')}>
                            <SharedButton variant="unstyled"
                                type="button"
                                className={`dbx-cat-chip${family ? '' : ' is-on'}`}
                                onClick={() => setFamily(null)}
                                aria-pressed={!family}
                            >
                                {t('common.labels.all', 'All')}
                            </SharedButton>
                            {families.map((f) => (
                                <SharedButton variant="unstyled"
                                    key={f}
                                    type="button"
                                    className={`dbx-cat-chip${family === f ? ' is-on' : ''}`}
                                    onClick={() => setFamily((cur) => (cur === f ? null : f))}
                                    aria-pressed={family === f}
                                >
                                    {f}
                                </SharedButton>
                            ))}
                        </div>
                    )}
                </div>

                <div className="dbx-drawer__scroll">
                    {unavailable ? (
                        <EmptyState
                            icon={PackageX}
                            title={t('app.engineCatalogDrawer.engineCatalogUnavailable', 'Engine catalog unavailable')}
                            description={t('app.engineCatalogDrawer.thisPanelCouldnTReachThe', "This panel couldn't reach the engine catalog. Databases that already exist keep working. Try again once the backend is up to date.")}
                        />
                    ) : loading ? (
                        <EmptyState loading loadingVariant="cards" loadingRows={6} title={t('app.engineCatalogDrawer.loadingEngines', 'Loading engines')} />
                    ) : (
                        <>
                            {!filtering && installed.length > 0 && (
                                <section className="dbx-eng-section">
                                    <h3 className="dbx-eyebrow">{t('app.engineCatalogDrawer.alreadyRunning', 'Already running')}</h3>
                                    <ul className="dbx-eng-list">
                                        {installed.map((inst) => (
                                            <RunningRow key={engineInstanceKey(inst)} instance={inst} />
                                        ))}
                                    </ul>
                                </section>
                            )}

                            <section className="dbx-eng-section">
                                <h3 className="dbx-eyebrow">{t('app.engineCatalogDrawer.availableToInstall', 'Available to install')}</h3>
                                {results.length === 0 ? (
                                    <EmptyState
                                        icon={Layers}
                                        title={catalog.length === 0 ? t('app.engineCatalogDrawer.noEngineTemplatesYet', 'No engine templates yet') : t('app.engineCatalogDrawer.noEnginesMatch', 'No engines match')}
                                        description={catalog.length === 0
                                            ? t('app.engineCatalogDrawer.anEngineIsAnAppTemplate', 'An engine is a service template carrying an engine block. Sync your template repositories to pull more in.')
                                            : t('app.engineCatalogDrawer.tryADifferentSearchTermOr', 'Try a different search term or clear the family filter.')}
                                    />
                                ) : (
                                    <CatalogGrid>
                                        {results.map((entry) => (
                                            <EngineCard key={entry.id} entry={entry} onPick={onPick} />
                                        ))}
                                    </CatalogGrid>
                                )}
                            </section>
                        </>
                    )}
                </div>

                <footer className="dbx-drawer__foot dbx-drawer__foot--split">
                    <SharedButton variant="unstyled"
                        type="button"
                        className="dbx-inline-link"
                        onClick={syncRepos}
                        disabled={syncing}
                    >
                        <RefreshCw size={13} className={syncing ? 'dbx-spin' : undefined} aria-hidden="true" />
                        {syncing ? t('app.engineCatalogDrawer.syncing', 'Syncing…') : t('app.engineCatalogDrawer.syncTemplateRepositories', 'Sync template repositories')}
                    </SharedButton>
                    <Link
                        className="dbx-inline-link"
                        to="/templates"
                        onClick={() => onOpenChange(false)}
                    >
                        {t('app.engineCatalogDrawer.openTheFullTemplateCatalog', 'Open the full template catalog')} <ChevronRight size={13} aria-hidden="true" />
                    </Link>
                </footer>
            </div>
        </Drawer>
    );
}
