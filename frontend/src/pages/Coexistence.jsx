import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
    Eye, ArrowRightLeft, ServerCog, ShieldCheck, RadioTower, Upload,
    RefreshCw, ArrowRight,
} from 'lucide-react';
import { Pill } from '@/components/ds';
import PageLayout from '../layouts/PageLayout';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import api from '../services/api';
import { useTranslation } from 'react-i18next';

// Coexistence — the honest "running ServerKit alongside another control panel"
// surface (plan 27 #15, plan 31). Mirrors docs/COEXISTENCE.md: the three
// adoption modes (Observe / Migrate / Manage), the read-only guarantees, and the
// never-supported two-writers case. Any Observed servers currently paired are
// listed with a link into the survey/migrate → DNS-cutover journey.
//
// The page is informational-first: it renders fully even with no paired servers
// or when the servers endpoint is unavailable — the adoption story is static.

const MODES = [
    {
        id: 'observe',
        icon: Eye,
        titleKey: 'app.coexistence.observe', title: 'Observe',
        tone: 'cyan',
        tagline: 'Read-only, safe to run anywhere',
        points: [
            'Install the agent on any Linux server — including one another panel still runs — and set it Observed.',
            'You get metrics, a read-only survey ("flight") of what is running, doctor probes, and backups of paths you point at.',
            'Every mutating server action is refused server-side; the agent command choke point returns a clean refusal instead of letting two panels fight over the same files.',
            'Agent binary updates are refused too, unless you set the per-server "allow agent updates while observing" break-glass.',
        ],
    },
    {
        id: 'migrate',
        icon: ArrowRightLeft,
        titleKey: 'app.coexistence.migrate', title: 'Migrate',
        tone: 'violet',
        tagline: 'The guided path off the other panel',
        points: [
            'Survey the box, then "Migrate this site" pre-fills the import wizard with the domain and document root.',
            'Imports cover files + MySQL databases + database users + crontabs — from a panel backup archive or a live SSH pull.',
            'Verify on a staging domain before touching public DNS; WordPress sites get the URL-swap tool.',
            'DNS cutover is reversible per domain: snapshot the records, switch, verify propagation, and revert in one click.',
        ],
    },
    {
        id: 'manage',
        icon: ServerCog,
        titleKey: 'app.coexistence.manage', title: 'Manage',
        tone: 'green',
        tagline: 'Full takeover on a clean box',
        points: [
            'The normal mode: ServerKit owns the box and manages the web stack end to end.',
            'Right for a fresh server, or one you have finished migrating off its previous panel and cleaned up.',
        ],
    },
];

const GUARANTEES = [
    'Credential and environment files are listed by path only — never read.',
    'No file contents leave the box beyond a few parse-light config directives (server_name, root, proxy_pass, and equivalents).',
    'The probe catalog can only combine fixed read-only primitives; it can never name a command to run. A compromised panel can at worst enumerate paths — never execute.',
];

const isObserved = (s) => (s.management_mode || s.mode) === 'observed';

export default function Coexistence() {
    const { t } = useTranslation();
    const [servers, setServers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.getServers();
            const list = Array.isArray(res) ? res : (res?.servers || []);
            setServers(list);
            setLoadError(null);
        } catch (err) {
            // Informational content stands on its own: an unavailable server
            // list only errors its own panel, never the page.
            setServers([]);
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const observed = servers.filter(isObserved);

    return (
        <PageLayout
            className="coexistence"
            icon={<RadioTower size={18} />}
            title={t('app.coexistence.coexistence', 'Coexistence')}
            meta="Running alongside another panel"
            actions={
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                    <RefreshCw size={15} />
                    {t('common.actions.refresh', 'Refresh')}
                </Button>
            }
        >
            <p className="coexistence__intro app-panel-hint">
                {t('app.coexistence.serverkitHasThreeExplicitAdoptionModes', 'ServerKit has three explicit adoption modes. Pick the one that matches where the server is today; you can move between them as you migrate. The hard rule: keep exactly one owner of nginx / Apache / PHP-FPM / TLS per server. Two panels writing the same web-server config is never supported; Observe mode exists so you can adopt a server for visibility without stepping on the panel that currently owns its config.')}
            </p>

            <div className="overview-grid coexistence__modes">
                {MODES.map((mode) => {
                    const Icon = mode.icon;
                    return (
                        <section key={mode.id} className="app-panel coexistence__mode">
                            <div className="app-panel-header">
                                <Icon size={16} />
                                <span>{mode.title}</span>
                                <span className="app-panel-header-actions">
                                    <Pill kind={mode.tone}>{mode.tagline}</Pill>
                                </span>
                            </div>
                            <div className="app-panel-body">
                                <ul className="coexistence__list">
                                    {mode.points.map((p, i) => <li key={i}>{p}</li>)}
                                </ul>
                            </div>
                        </section>
                    );
                })}
            </div>

            <section className="app-panel coexistence__observed">
                <div className="app-panel-header">
                    <Eye size={16} />
                    <span>{t('app.coexistence.observedServers', 'Observed servers')}</span>
                    <span className="app-panel-header-actions app-panel-hint">
                        {loadError ? '—' : observed.length} {t('app.coexistence.pairedInReadOnlyMode', 'paired in read-only mode')}
                    </span>
                </div>
                <div className="app-panel-body">
                    {loading ? (
                        <EmptyState loading loadingVariant="table" title={t('app.coexistence.loadingServers', 'Loading servers')} />
                    ) : loadError ? (
                        <ErrorState
                            title={t('app.coexistence.couldntLoadServers', "Couldn't load servers.")}
                            error={loadError}
                            onRetry={load}
                        />
                    ) : observed.length === 0 ? (
                        <EmptyState
                            icon={Eye}
                            title={t('app.coexistence.noObservedServers', 'No observed servers')}
                            description={t('app.coexistence.pairAnAgentAndSwitchA', "Pair an agent and switch a server to Observed to survey a server another panel still runs. It's read-only and safe.")}
                        />
                    ) : (
                        <ul className="coexistence__servers">
                            {observed.map((s) => (
                                <li key={s.id} className="coexistence__server">
                                    <div className="coexistence__server-main">
                                        <span className="coexistence__server-name">{s.name || s.hostname || `Server ${s.id}`}</span>
                                        {(s.ip_address || s.host) && (
                                            <span className="coexistence__server-ip">{s.ip_address || s.host}</span>
                                        )}
                                    </div>
                                    <div className="coexistence__server-actions">
                                        <Pill kind="cyan">{t('app.coexistence.observed', 'Observed')}</Pill>
                                        <Link to={`/servers/${s.id}`}>
                                            <Button variant="outline" size="sm">
                                                {t('app.coexistence.survey', 'Survey')}
                                                <ArrowRight size={14} />
                                            </Button>
                                        </Link>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </section>

            <div className="overview-grid coexistence__footer">
                <section className="app-panel">
                    <div className="app-panel-header">
                        <ShieldCheck size={16} />
                        <span>{t('app.coexistence.theSurveySReadOnlyGuarantees', 'The survey\'s read-only guarantees')}</span>
                    </div>
                    <div className="app-panel-body">
                        <ul className="coexistence__list">
                            {GUARANTEES.map((g, i) => <li key={i}>{g}</li>)}
                        </ul>
                    </div>
                </section>

                <section className="app-panel">
                    <div className="app-panel-header">
                        <Upload size={16} />
                        <span>{t('app.coexistence.readyToMigrate', 'Ready to migrate?')}</span>
                    </div>
                    <div className="app-panel-body">
                        <p className="app-panel-hint">
                            {t('app.coexistence.whenASiteIsReadyTo', 'When a site is ready to move onto ServerKit, the import wizard pulls its files, databases, and crontabs, then hands off to the reversible DNS cutover: snapshot, switch, verify, revert.')}
                        </p>
                        <div className="coexistence__cta">
                            <Link to="/imports">
                                <Button variant="primary" size="sm">
                                    {t('app.coexistence.openImportWizard', 'Open import wizard')}
                                    <ArrowRight size={14} />
                                </Button>
                            </Link>
                        </div>
                    </div>
                </section>
            </div>
        </PageLayout>
    );
}
