import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { DataTable, DataTableFooter, ListToolbar, Pill } from '../ds';
import EmptyState from '../EmptyState';
import { useTranslation } from 'react-i18next';
import { t } from '../../i18n/t';
import {
    FileSearch,
    RefreshCw,
    AlertTriangle,
    ShieldCheck,
    Boxes,
    Globe,
    Database,
    Clock,
    Radio,
    Network,
} from 'lucide-react';
import { toastError } from '@/utils/errorMessage';

// Survey tab (plan 27/28) — the read-only "Server Map" for a paired agent.
//
// A survey is a strictly read-only "flight": the agent runs a declarative probe
// catalog and returns what's running on the box; the panel normalizes it into a
// stable Server Map and stores each flight as an immutable, diffable snapshot.
// This tab also hosts the managed/observed adoption toggle: when another control
// panel is detected we suggest switching to Observed (read-only) mode.
const SurveyTab = ({ serverId, serverStatus, server }) => {
    const { t } = useTranslation();
    const toast = useToast();

    const [loading, setLoading] = useState(true);
    const [snapshots, setSnapshots] = useState([]);
    const [map, setMap] = useState(null);
    const [takenAt, setTakenAt] = useState(null);
    const [diff, setDiff] = useState(null);

    const [mode, setMode] = useState('managed');
    const [observed, setObserved] = useState(null);

    const [flying, setFlying] = useState(false);
    const [switching, setSwitching] = useState(false);

    const [showCatalog, setShowCatalog] = useState(false);
    const [catalog, setCatalog] = useState(null);

    // The agent must advertise the `survey` capability. The tab is only mounted
    // when it does, but guard here too so an older agent degrades cleanly.
    const capable = server?.capabilities?.survey ?? true;

    const load = useCallback(async () => {
        try {
            const [surveysRes, obs] = await Promise.all([
                api.getServerSurveys(serverId),
                api.getServerObservedStatus(serverId).catch(() => null),
            ]);
            const list = surveysRes?.surveys || [];
            setSnapshots(list);
            if (obs) {
                setMode(obs.management_mode || 'managed');
                setObserved(obs);
            }
            if (list.length) {
                const latest = await api.getServerSurvey(serverId, list[0].id);
                setMap(latest?.map || null);
                setTakenAt(latest?.taken_at || null);
                if (list.length >= 2) {
                    const d = await api.diffServerSurveys(serverId).catch(() => null);
                    setDiff(d?.diff || null);
                } else {
                    setDiff(null);
                }
            } else {
                setMap(null);
                setTakenAt(null);
                setDiff(null);
            }
        } catch (err) {
            console.error('Failed to load survey:', err);
        }
    }, [serverId]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true);
            await load();
            if (!cancelled) setLoading(false);
        })();
        return () => { cancelled = true; };
    }, [load]);

    async function refly() {
        setFlying(true);
        try {
            await api.runServerSurvey(serverId);
            toast.success(t('app.surveyTab.surveyComplete', 'Survey complete'));
            await load();
        } catch (err) {
            toastError(toast, t('app.surveyTab.surveyFailed', "Couldn't run the survey."), err);
        } finally {
            setFlying(false);
        }
    }

    async function loadCatalog() {
        if (showCatalog) {
            setShowCatalog(false);
            return;
        }
        try {
            const data = catalog || await api.getSurveyCatalog();
            setCatalog(data);
            setShowCatalog(true);
        } catch (err) {
            toastError(toast, t('app.surveyTab.failedToLoadProbeIndex', "Couldn't load the probe index."), err);
        }
    }

    async function switchToObserved() {
        setSwitching(true);
        try {
            await api.setServerManagementMode(serverId, 'observed');
            toast.success(t('app.surveyTab.switchedToObservedReadOnly', 'Switched to Observed (read-only)'));
            setMode('observed');
            const obs = await api.getServerObservedStatus(serverId).catch(() => null);
            if (obs) setObserved(obs);
        } catch (err) {
            toastError(toast, t('app.surveyTab.failedToSwitchMode', "Couldn't switch modes."), err);
        } finally {
            setSwitching(false);
        }
    }

    async function toggleAgentUpdateOverride(checked) {
        setSwitching(true);
        try {
            await api.setServerManagementMode(serverId, mode, checked);
            const obs = await api.getServerObservedStatus(serverId).catch(() => null);
            if (obs) setObserved(obs);
        } catch (err) {
            toastError(toast, t('app.surveyTab.failedToUpdateSetting', "Couldn't update the setting."), err);
        } finally {
            setSwitching(false);
        }
    }

    if (!capable) {
        return (
            <EmptyState
                icon={FileSearch}
                title={t('app.surveyTab.surveyNotAvailable', 'Survey not available')}
                description={t('app.surveyTab.thisAgentDoesnTSupportThe', "This agent doesn't support the read-only survey yet. Upgrade the agent to enable Observe mode. It maps what's running on the server without changing anything.")}
            />
        );
    }

    if (loading) {
        return <EmptyState loading title={t('app.surveyTab.loadingSurvey', 'Loading survey')} />;
    }

    return (
        <div className="survey-tab">
            <ListToolbar
                tools={(
                    <div className="survey-tab__toolbar-actions">
                        <Button variant="outline" size="sm" onClick={loadCatalog}>
                            <FileSearch size={14} /> {showCatalog ? t('app.surveyTab.hide', 'Hide') : t('app.surveyTab.whatWeCheck', 'What we check')}
                        </Button>
                        <Button size="sm" onClick={refly} disabled={flying || serverStatus !== 'online'}>
                            <RefreshCw size={14} className={flying ? 'spin' : ''} />
                            {flying
                                ? t('app.surveyTab.surveying', 'Surveying…')
                                : (snapshots.length ? t('app.surveyTab.rerunSurvey', 'Run survey again') : t('app.surveyTab.runSurvey', 'Run survey'))}
                        </Button>
                    </div>
                )}
            >
                <div className="survey-tab__toolbar-info">
                    {takenAt ? (
                        <span className="survey-tab__muted">{t('app.surveyTab.lastFlight', 'Last flight')} {new Date(takenAt).toLocaleString()}</span>
                    ) : (
                        <span className="survey-tab__muted">{t('app.surveyTab.noFlightsYetRunOneTo', 'No flights yet. Run one to map this server.')}</span>
                    )}
                    {map?.foreign_panel_detected && (
                        <Pill kind="amber">
                            <AlertTriangle size={12} aria-hidden="true" /> {t('app.surveyTab.anotherControlPanelDetected', 'Another control panel detected')}
                        </Pill>
                    )}
                </div>
            </ListToolbar>

            {serverStatus !== 'online' && !snapshots.length && (
                <p className="survey-tab__muted">{t('app.surveyTab.theAgentIsOfflineReconnectIt', 'The agent is offline. Reconnect it to fly a survey.')}</p>
            )}

            {map?.foreign_panel_detected && mode === 'managed' && (
                <div className="survey-tab__suggest">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <div className="survey-tab__suggest-body">
                        <strong>{t('app.surveyTab.thisBoxLooksLikeItS', "This server looks like it's run by another control panel.")}</strong>
                        <p>
                            {t('app.surveyTab.twoPanelsWritingWebServerConfig', 'Two panels writing web-server config will fight over ownership. Switch this server to')} <em>{t('app.surveyTab.observed', 'Observed')}</em> {t('app.surveyTab.toKeepReadOnlySurveyMetrics', "to keep read-only survey, metrics and backups while ServerKit stops making config changes, then migrate sites over when you're ready.")}
                        </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={switchToObserved} disabled={switching}>
                        {switching ? t('app.surveyTab.switching', 'Switching…') : t('app.surveyTab.switchToObserved', 'Switch to observed')}
                    </Button>
                </div>
            )}

            {mode === 'observed' && (
                <div className="survey-tab__observed">
                    <div className="survey-tab__observed-head">
                        <Pill kind="amber"><ShieldCheck size={12} aria-hidden="true" /> {t('app.surveyTab.observedReadOnly', 'Observed (read-only)')}</Pill>
                        {observed && (
                            <span
                                className="survey-tab__muted"
                                title={t('app.surveyTab.mutatingCommandsTheObserveGuardHas', 'Mutating commands the Observe guard has refused on this server')}
                            >
                                {observed.observed_blocked_count} command{observed.observed_blocked_count === 1 ? '' : 's'} blocked
                            </span>
                        )}
                    </div>
                    <p className="survey-tab__muted">
                        {t('app.surveyTab.serverkitMakesNoConfigChangesOn', 'ServerKit makes no config changes on this server. Metrics, survey, doctor reads and backups of pointed paths stay on; every mutating action is refused.')}
                    </p>
                    <label className="survey-tab__observed-toggle">
                        <input
                            type="checkbox"
                            checked={!!observed?.allow_agent_update_observed}
                            disabled={switching || !observed}
                            onChange={(e) => toggleAgentUpdateOverride(e.target.checked)}
                        />
                        <span>
                            {t('app.surveyTab.allow', 'Allow')} <code>agent:update</code> {t('app.surveyTab.whileObserving', 'while observing')}
                            <span className="survey-tab__muted"> {t('app.surveyTab.keepTheAgentBinaryCurrentWithout', '(keeps the agent binary current without leaving Observed mode)')}</span>
                        </span>
                    </label>
                </div>
            )}

            {showCatalog && catalog && (
                <section className="survey-tab__catalog">
                    <p className="survey-tab__muted">
                        {t('app.surveyTab.aSurveyIsStrictlyReadOnly', 'A survey is strictly read-only. Catalog v')}{catalog.version} {t('app.surveyTab.hereIsExactlyWhatTheAgent', 'lists exactly what the agent looks at:')}
                    </p>
                    <ul className="survey-tab__catalog-list">
                        {catalog.probes.map((p) => (
                            <li key={p.id}>
                                <strong>{p.title}</strong> <span className="survey-tab__muted">— {p.reads}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {diff && (
                <section className="survey-tab__section">
                    <h3 className="survey-tab__section-title"><RefreshCw size={15} aria-hidden="true" /> {t('app.surveyTab.sinceLastFlight', 'Since last flight')}</h3>
                    <DiffSummary diff={diff} />
                </section>
            )}

            {map ? (
                <>
                    <section className="survey-tab__section">
                        <h3 className="survey-tab__section-title"><Boxes size={15} aria-hidden="true" /> {t('common.labels.services', 'Services')}</h3>
                        <ServiceGrid services={map.services} />
                    </section>

                    <section className="survey-tab__section">
                        <h3 className="survey-tab__section-title"><Globe size={15} aria-hidden="true" /> {t('app.surveyTab.sites', 'Sites')}</h3>
                        <SitesTable sites={map.sites} />
                    </section>

                    <SimpleList
                        icon={Database} title={t('common.labels.databases', 'Databases')} items={map.databases}
                        empty="No database engines detected."
                        render={(d) => (
                            <>
                                <span>{d.engine}</span>
                                {d.port ? <span className="survey-tab__muted"> :{d.port}</span> : null}
                                {' '}<Pill kind={d.active ? 'green' : 'gray'}>{d.active ? 'active' : 'inactive'}</Pill>
                            </>
                        )}
                    />

                    <SimpleList
                        icon={ShieldCheck} title={t('app.surveyTab.tlsCertificates', 'TLS certificates')} items={map.certs}
                        empty="No certificates detected."
                        render={(c) => (
                            <>
                                <span className="survey-tab__mono">{c.domain}</span>
                                {c.expires_at ? <span className="survey-tab__muted"> {t('app.surveyTab.expires', 'expires')} {new Date(c.expires_at).toLocaleDateString()}</span> : null}
                            </>
                        )}
                    />

                    <SimpleList
                        icon={Clock} title={t('app.surveyTab.cron', 'Cron')} items={map.cron}
                        empty="No crontabs detected."
                        render={(c) => (
                            <>
                                <span className="survey-tab__mono">{c.user}</span>
                                <span className="survey-tab__muted"> — {(c.lines || []).length} job(s)</span>
                            </>
                        )}
                    />

                    <SimpleList
                        icon={Radio} title={t('app.surveyTab.listeningPorts', 'Listening ports')} items={map.listeners}
                        empty="No listeners reported."
                        render={(l) => (
                            <>
                                <span className="survey-tab__mono">:{l.port}/{l.proto}</span>
                                <span className="survey-tab__muted"> → {l.process || 'unknown'}</span>
                            </>
                        )}
                    />

                    {map.foreign_panels?.length ? (
                        <SimpleList
                            icon={Network} title={t('app.surveyTab.controlPanelMarkers', 'Control-panel markers')} items={map.foreign_panels}
                            empty=""
                            render={(f) => <code className="survey-tab__mono">{f.marker}</code>}
                        />
                    ) : null}
                </>
            ) : (
                <EmptyState
                    icon={FileSearch}
                    title={t('app.surveyTab.noSurveyYet', 'No survey yet')}
                    description={t('app.surveyTab.flyAReadOnlySurveyTo', 'Fly a read-only survey to map what\'s running on this server.')}
                />
            )}
        </div>
    );
};

// A compact +added / −removed / ~changed summary across every map category.
function DiffSummary({ diff }) {
    const { t } = useTranslation();
    const cats = [
        ['services', 'Services'],
        ['sites', 'Sites'],
        ['databases', 'Databases'],
        ['certs', 'Certs'],
        ['cron', 'Cron'],
        ['listeners', 'Listeners'],
    ];
    const chips = [];
    cats.forEach(([key, label]) => {
        const d = diff?.[key];
        if (!d) return;
        const parts = [];
        if (d.added?.length) parts.push(`+${d.added.length}`);
        if (d.removed?.length) parts.push(`−${d.removed.length}`);
        if (d.changed?.length) parts.push(`~${d.changed.length}`);
        if (parts.length) chips.push({ label, text: parts.join(' ') });
    });
    if (diff?.foreign_panel_changed) chips.push({ labelKey: 'app.surveyTab.controlPanel', label: 'Control panel', text: 'changed' });

    if (!chips.length) {
        return <p className="survey-tab__muted">{t('app.surveyTab.noChangesSinceTheLastFlight', 'No changes since the last flight.')}</p>;
    }
    return (
        <ul className="survey-tab__diff">
            {chips.map((c) => (
                <li key={c.label}>
                    <span>{c.label}</span>
                    <Pill kind="gray">{c.text}</Pill>
                </li>
            ))}
        </ul>
    );
}

// Detected services as small chips (name + ports + active/inactive).
function ServiceGrid({ services }) {
    const { t } = useTranslation();
    const list = services || [];
    if (!list.length) {
        return <p className="survey-tab__muted">{t('app.surveyTab.noManagedServicesDetected', 'No managed services detected.')}</p>;
    }
    return (
        <div className="survey-tab__services">
            {list.map((s) => (
                <div key={s.id} className="survey-tab__service">
                    <Boxes size={14} aria-hidden="true" />
                    <span className="survey-tab__service-name">{s.id}</span>
                    {s.ports?.length ? (
                        <span className="survey-tab__service-ports">:{s.ports.join(', :')}</span>
                    ) : null}
                    <Pill kind={s.active ? 'green' : 'gray'}>{s.active ? 'active' : 'inactive'}</Pill>
                </div>
            ))}
        </div>
    );
}

// Read-only web-server vhosts, with a "managed by" column that flags sites owned
// by another control panel. Cell markup and classNames are identical to the
// hand-rolled table this replaces so the .survey-tab__table SCSS keeps applying.
const SITE_COLUMNS = [
    {
        key: 'domain',
        headerKey: 'common.labels.domain', header: 'Domain',
        sortable: true,
        hideable: false,
        sortValue: (s) => s.domain || '',
        cellClassName: 'survey-tab__mono',
        render: (s) => s.domain,
    },
    {
        key: 'stack',
        headerKey: 'app.surveyTab.stack', header: 'Stack',
        sortable: true,
        sortValue: (s) => s.stack || '',
        render: (s) => s.stack,
    },
    {
        key: 'docRoot',
        headerKey: 'app.surveyTab.docRoot', header: 'Doc root',
        sortable: true,
        sortValue: (s) => s.doc_root || null,
        cellClassName: 'survey-tab__mono',
        render: (s) => s.doc_root || '—',
    },
    {
        key: 'upstream',
        headerKey: 'app.surveyTab.upstream', header: 'Upstream',
        sortable: true,
        sortValue: (s) => s.upstream || null,
        cellClassName: 'survey-tab__mono',
        render: (s) => s.upstream || '—',
    },
    {
        key: 'managedBy',
        headerKey: 'app.surveyTab.managedBy', header: 'Managed by',
        sortable: true,
        sortValue: (s) => s.managed_by || '',
        render: (s) => (
            s.managed_by === 'other-panel'
                ? <Pill kind="amber">{t('app.surveyTab.otherPanel', 'other panel')}</Pill>
                : <Pill kind="gray">{s.managed_by}</Pill>
        ),
    },
];

function SitesTable({ sites }) {
    const { t } = useTranslation();
    const list = sites || [];
    if (!list.length) {
        return <p className="survey-tab__muted">{t('app.surveyTab.noWebServerVhostsDetected', 'No web-server vhosts detected.')}</p>;
    }
    return (
        <DataTable
            columns={SITE_COLUMNS}
            data={list}
            keyField={(s) => s.domain || `${s.stack}|${s.doc_root}|${s.upstream}`}
            storageKey="serverkit-table-sd-survey-sites"
            className="survey-tab__table-wrap"
            tableClassName="survey-tab__table"
            footer={(
                <DataTableFooter
                    shown={list.length}
                    total={list.length}
                    noun="site"
                />
            )}
        />
    );
}

// A titled section that renders a simple list of items, or an empty hint.
function SimpleList({ icon: Icon, title, items, empty, render }) {
    const list = items || [];
    return (
        <section className="survey-tab__section">
            <h3 className="survey-tab__section-title"><Icon size={15} aria-hidden="true" /> {title}</h3>
            {list.length ? (
                <ul className="survey-tab__list">
                    {list.map((item, i) => <li key={i}>{render(item)}</li>)}
                </ul>
            ) : (
                empty ? <p className="survey-tab__muted">{empty}</p> : null
            )}
        </section>
    );
}

export default SurveyTab;
