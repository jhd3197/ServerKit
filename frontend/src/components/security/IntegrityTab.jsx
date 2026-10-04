import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import ErrorState from '@/components/ErrorState';
import { DataTable, DataTableFooter, ListToolbar } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer, applyFilters,
} from '@/components/ds/grid';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { useTranslation } from 'react-i18next';
import { Card as SharedCard, CardHeader as SharedCardHeader, CardContent as SharedCardContent } from '@/components/ui/card';

// Scoped file-integrity monitoring: baseline-and-diff over the paths
// ServerKit manages (nginx configs, serverkit-owned systemd units, and
// app docroots on explicit per-app opt-in).

const SCOPE_META = {
    nginx: {
        labelKey: 'app.integrityTab.nginxConfiguration', label: 'Nginx configuration',
        hintKey: 'app.integrityTab.sitesEnabledConfD', hint: 'sites-enabled + conf.d',
    },
    systemd: {
        labelKey: 'app.integrityTab.systemdUnits', label: 'Systemd units',
        hintKey: 'app.integrityTab.serverkitUnitsInEtcSystemdSystem', hint: 'serverkit-* units in /etc/systemd/system',
    },
};

// Matches the service's own listing cap — a check that touched thousands of
// files reports counts, not a scrollback.
const MAX_LISTED_CHANGES = 200;

function formatAge(iso) {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms)) return null;
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 48) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

function scopeLabel(scope) {
    if (SCOPE_META[scope.scope]) return SCOPE_META[scope.scope].label;
    return scope.app_name ? `App: ${scope.app_name}` : `App #${scope.app_id}`;
}

// A check result is three separate lists; the table is one. `tone` rides along
// so each cell keeps the colour the hand-rolled table gave it.
function toChangeRows(check) {
    if (!check || !check.total_changes) return [];
    return [
        ...(check.added || []).map((p) => ({ kind: 'added', tone: 'green', path: p, what: null })),
        ...(check.removed || []).map((p) => ({ kind: 'removed', tone: 'red', path: p, what: null })),
        ...(check.modified || []).map((m) => ({
            kind: 'modified', tone: 'amber', path: m.path, what: m.what,
        })),
    ];
}

// Cell markup/classNames identical to the hand-rolled table they replace. Two
// accessors per column on purpose: `value` is what the column menu, the filter
// rules and the export read, `sortValue` is what DataTable's sorter reads — it
// has no fallback to `value`, so a sortable column needs both.
const CHANGE_COLUMNS = [
    {
        key: 'change',
        headerKey: 'app.integrityTab.change', header: 'Change',
        sortable: true,
        // Declared, not inferred: a check that turned up a single change gives
        // the inferrer one sample, which fails its "values repeat" test and
        // types the column `text` — and then every preset that picks a kind
        // matches zero rows on exactly the tables that are easiest to read.
        type: 'enum',
        enumOrder: ['added', 'removed', 'modified'],
        value: (row) => row.kind,
        sortValue: (row) => row.kind,
        render: (row) => <span className={`sec-state sec-state--${row.tone}`}>{row.kind}</span>,
    },
    {
        key: 'path',
        headerKey: 'app.integrityTab.path', header: 'Path',
        sortable: true,
        type: 'text',
        value: (row) => row.path,
        sortValue: (row) => row.path,
        cellClassName: 'sk-cell-mono sec-path',
        render: (row) => row.path,
    },
    {
        key: 'what',
        headerKey: 'app.integrityTab.whatChanged', header: 'What changed',
        // The service reports exactly hash | size | mode, in that order, and
        // only for modified rows. Joined into one string so a rule can ask for
        // "the bytes moved" (contains hash) or "only the bits moved"
        // (is mode); added/removed rows carry nothing and read ''.
        type: 'text',
        value: (row) => (row.what || []).join(', '),
        render: (row) => (
            row.what ? (
                <span className="sec-what">
                    {row.what.map((w) => (
                        <span key={w} className="sec-state sec-state--gray">{w}</span>
                    ))}
                </span>
            ) : (
                <span className="sec-dash">—</span>
            )
        ),
    },
];

// Built-in saved views. A check result is a pile of diffs of three very
// different kinds, and the whole job of reading one is separating "something
// touched the box" from "a deploy chmod'd a file".
const INTEGRITY_VIEWS = [
    {
        // Nothing ServerKit does adds a file to sites-enabled or drops a unit
        // in /etc/systemd/system without going through the panel, so a file
        // appearing or vanishing is the loudest signal on this table.
        name: 'Added or removed',
        state: {
            sorts: [{ key: 'path', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'fi1', field: 'change', op: 'any', value: ['added', 'removed'] }],
            },
        },
    },
    {
        // The bytes moved. A size- or mode-only diff is not tampering; a
        // changed sha256 on a managed config is the thing you came here for.
        name: 'Content changed',
        state: {
            sorts: [{ key: 'path', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'fi2', field: 'what', op: 'contains', value: 'hash' }],
            },
        },
    },
    {
        // Permission bits moved and the content did not — nearly always a
        // chmod from a deploy or a hand-run command, so it triages apart from
        // the content diffs. `is` rather than `contains`: a row whose hash
        // moved as well belongs in the view above, not here.
        name: 'Permissions only',
        state: {
            sorts: [{ key: 'path', direction: 'asc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'fi3', field: 'what', op: 'is', value: 'mode' }],
            },
        },
    },
];

const IntegrityTab = () => {
    const { t } = useTranslation();
    const [status, setStatus] = useState(null);
    const [apps, setApps] = useState([]);
    const [busy, setBusy] = useState(null); // `${scope}:${action}` while a call runs
    const [savingOptins, setSavingOptins] = useState(false);
    const [message, setMessage] = useState(null);
    const [loadError, setLoadError] = useState(null);
    const [appsError, setAppsError] = useState(null);
    const [expanded, setExpanded] = useState(null); // scope whose changes table is open

    // Lifted out of <DataTable storageKey> so the chrome can capture and
    // restore them. The keys keep DataTable's own `-sort` / `-cols` suffixes so
    // a sort or a hidden column persisted by an earlier build still loads.
    const { sorts, setSorts } = useTableSort({
        storageKey: 'serverkit-table-integrity-changes-sort',
    });
    const { hiddenKeys, setHiddenKeys } = useColumnVisibility({
        storageKey: 'serverkit-table-integrity-changes-cols',
    });

    const load = useCallback(async () => {
        try {
            const data = await api.request('/security/fim');
            setStatus(data);
            setLoadError(null);
        } catch (err) {
            setLoadError(err);
        }
    }, []);

    const loadApps = useCallback(() => {
        api.getApps().then(
            (data) => { setApps(data.apps || []); setAppsError(null); },
            // The apps list is optional chrome; FIM still works without it, but
            // a failed read must not claim there are no applications.
            (err) => setAppsError(err),
        );
    }, []);

    useEffect(() => {
        load();
        loadApps();
    }, [load, loadApps]);

    async function runAction(scope, action) {
        setBusy(`${scope}:${action}`);
        setMessage(null);
        try {
            const result = await api.request(`/security/fim/${scope}/${action}`, { method: 'POST' });
            if (action === 'check') {
                setExpanded(result.total_changes > 0 ? scope : null);
                setMessage(result.total_changes === 0
                    ? { type: 'success', text: `${scope}: no changes since baseline` }
                    : { type: 'error', text: `${scope}: ${result.total_changes} change(s) detected` });
            } else {
                setExpanded(null);
                setMessage({
                    type: 'success',
                    text: `${scope}: baseline saved (${result.file_count} files)`,
                });
            }
            await load();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setBusy(null);
        }
    }

    async function toggleApp(appId, enabled) {
        const current = status?.app_optins || [];
        const next = enabled
            ? [...new Set([...current, appId])]
            : current.filter((id) => id !== appId);
        setSavingOptins(true);
        setMessage(null);
        try {
            await api.request('/security/fim/apps', { method: 'PUT', body: { app_ids: next } });
            await load();
        } catch (err) {
            setMessage({ type: 'error', text: err.message });
        } finally {
            setSavingOptins(false);
        }
    }

    const scopes = status?.scopes || [];
    const optins = status?.app_optins || [];

    // `expanded` holds ONE scope key, so at most one changes table is mounted —
    // which is why this tab has a single chrome instance and passes no
    // urlScope: there is no second table to fight it over ?view= / ?sort=.
    const openScope = scopes.find((s) => s.scope === expanded) || null;
    const changeRows = useMemo(() => toChangeRows(openScope?.last_check), [openScope]);
    const shownRows = useMemo(
        () => changeRows.slice(0, MAX_LISTED_CHANGES),
        [changeRows],
    );

    // No `pageState`: a check result is whatever the last run produced, and the
    // tab owns no search or filter of its own, so there is nothing
    // page-private for a saved view to carry.
    const chrome = useTableChrome({
        columns: CHANGE_COLUMNS,
        rows: shownRows,
        viewPageKey: 'security-integrity',
        builtinViews: INTEGRITY_VIEWS,
        noun: 'changes',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
    });

    // DataTable applies the column rules itself, so the tab re-runs them to say
    // how many rows survived them.
    const shownCount = useMemo(
        () => applyFilters(shownRows, chrome.cfg.filters, chrome.columns).length,
        [shownRows, chrome.cfg.filters, chrome.columns],
    );

    function renderScopeCard(scope) {
        const key = scope.scope;
        const baseline = scope.baseline;
        const check = scope.last_check;
        const changed = check && check.total_changes > 0;
        // Same guard the old renderChanges() applied: a scope with nothing to
        // show never opens, even if it is the expanded one.
        const isOpen = expanded === key && changeRows.length > 0;
        return (
            <SharedCard variant="legacy" className="card sec-flush" key={key}>
                <SharedCardHeader variant="legacy" className="card-header">
                    <h3>
                        {scopeLabel(scope)}{' '}
                        <span className="sec-count">
                            · {SCOPE_META[key]?.hint || (scope.roots[0] || 'no docroot')}
                        </span>
                    </h3>
                    {!scope.available && <span className="sec-state sec-state--gray">{t('app.integrityTab.notPresent', 'not present')}</span>}
                    {scope.available && !baseline && <span className="sec-state sec-state--gray">{t('app.integrityTab.noBaseline', 'no baseline')}</span>}
                    {baseline && !check && <span className="sec-state sec-state--cyan">baselined</span>}
                    {check && (changed
                        ? <span className="sec-state sec-state--amber">{check.total_changes} changes</span>
                        : <span className="sec-state sec-state--green">clean</span>)}
                </SharedCardHeader>
                <SharedCardContent variant="legacy" className="card-body">
                    <p className="sec-hint--lead sec-hint">
                        {baseline
                            ? `Baseline: ${baseline.file_count} files, ${formatAge(baseline.created_at) || 'unknown age'}`
                            : 'No baseline yet — create one to start tracking changes.'}
                        {check && ` · Last check ${formatAge(check.checked_at) || ''}`}
                    </p>
                    {/* These act on the SCOPE and are there whether or not the
                        changes list is open, so they keep their own bar; the
                        table's chrome rides the view line below. */}
                    <ListToolbar>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => runAction(key, 'baseline')}
                            disabled={!scope.available || busy !== null}
                        >
                            {busy === `${key}:baseline` ? 'Baselining…' : 'Baseline'}
                        </Button>
                        <Button
                            variant="default"
                            size="sm"
                            onClick={() => runAction(key, 'check')}
                            disabled={!baseline || busy !== null}
                        >
                            {busy === `${key}:check` ? 'Checking…' : 'Check now'}
                        </Button>
                        {changed && (
                            <>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => runAction(key, 'accept')}
                                    disabled={busy !== null}
                                >
                                    {busy === `${key}:accept` ? 'Accepting…' : 'Accept changes'}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setExpanded(expanded === key ? null : key)}
                                >
                                    {expanded === key ? 'Hide changes' : 'View changes'}
                                </Button>
                            </>
                        )}
                    </ListToolbar>
                    {/* The view name is the changes table's heading — the card's
                        own h3 names the SCOPE, which is a different thing. */}
                    {isOpen && (
                        <>
                            <GridViewPicker
                                views={chrome.views}
                                label="changes"
                                onCreate={chrome.createView}
                                actions={(
                                    <>
                                        <GridFilterButton
                                            count={chrome.filterCount}
                                            onClick={() => chrome.setDrawerOpen(true)}
                                        />
                                        <GridToolsMenu {...chrome.toolsProps} onRefresh={load} />
                                    </>
                                )}
                            />
                            <GridChips {...chrome.chipProps} />
                        </>
                    )}
                </SharedCardContent>
                {isOpen && (
                    <DataTable
                        columns={chrome.columns}
                        data={shownRows}
                        keyField={(row) => `${row.kind}:${row.path}`}
                        sorts={sorts}
                        onSortsChange={setSorts}
                        {...chrome.tableProps}
                        footer={(
                            <DataTableFooter
                                shown={shownCount}
                                total={changeRows.length}
                                noun="change"
                            />
                        )}
                    />
                )}
            </SharedCard>
        );
    }

    const managedScopes = scopes.filter((s) => !s.scope.startsWith('app:'));
    const appScopes = scopes.filter((s) => s.scope.startsWith('app:'));

    if (!status) {
        return loadError ? (
            <ErrorState
                title={t('app.integrityTab.couldntLoadIntegrity', "Couldn't load file integrity status.")}
                error={loadError}
                onRetry={load}
            />
        ) : (
            <div className="loading-sm">{t('common.loading', 'Loading…')}</div>
        );
    }

    return (
        <div className="integrity-tab">
            {loadError && <ErrorState compact error={loadError} onRetry={load} />}
            {message && (
                <div className={`alert alert-${message.type === 'success' ? 'success' : 'danger'}`}>
                    {message.text}
                </div>
            )}

            <p className="sec-hint sec-hint--lead">
                {t('app.integrityTab.baselineAndDiffMonitoringOverThe', 'Baseline-and-diff monitoring over the paths ServerKit manages. Baseline a scope, then check it (or let the scheduled sweep do it). Any added, removed or modified files are flagged and admins are notified. Accepting changes re-baselines the scope.')}
            </p>

            {managedScopes.map(renderScopeCard)}
            {appScopes.map(renderScopeCard)}

            <SharedCard variant="legacy" className="card">
                <SharedCardHeader variant="legacy" className="card-header">
                    <h3>{t('app.integrityTab.applicationDocroots', 'Service docroots')} <span className="sec-count">{t('app.integrityTab.optIn', '· opt-in')}</span></h3>
                </SharedCardHeader>
                <SharedCardContent variant="legacy" className="card-body">
                    <p className="sec-hint sec-hint--lead">
                        {t('app.integrityTab.watchingADocrootHashesEveryFile', 'Watching a docroot hashes every file outside upload/cache directories, so it is opt-in per service.')}
                    </p>
                    {appsError ? (
                        <ErrorState compact error={appsError} onRetry={loadApps} />
                    ) : apps.length === 0 ? (
                        <p className="sec-faint">{t('app.integrityTab.noApplicationsFound', 'No services found.')}</p>
                    ) : (
                        <div className="sec-finding-list">
                            {apps.map((appItem) => (
                                <div className="sec-finding" key={appItem.id}>
                                    <Switch
                                        checked={optins.includes(appItem.id)}
                                        disabled={savingOptins}
                                        onCheckedChange={(checked) => toggleApp(appItem.id, checked)}
                                    />
                                    <div className="sec-finding__msg">
                                        {appItem.name}{' '}
                                        <span className="sec-mono">{appItem.root_path || 'no docroot'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </SharedCardContent>
            </SharedCard>

            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
};

export default IntegrityTab;
