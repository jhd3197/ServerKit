import { Button } from '@/components/ui/button';
import { nextFire, untilLabel } from '@/utils/backupSchedule';
import { useState, useEffect, useMemo } from 'react';
import {
    AlertTriangle, Archive, ChevronRight, Cloud, Database, Globe, HardDrive,
    History, Package, ShieldCheck, Timer,
} from 'lucide-react';
import api from '../../services/api';
import { formatBytes } from '@/utils/formatBytes';
import { KpiBand, MetricCard, Pill, DataTable, DataTableFooter } from '@/components/ds';
import EmptyState from '../EmptyState';
import { useTranslation } from 'react-i18next';

// Daily activity cells: one column per week, one row per weekday. Half a year
// rather than the mock's 18 weeks — the cells stretch to fill the card (see
// `.bk-heat` in _backups.scss), and at 18 columns that left the panel visibly
// half empty. 26 also covers a 90-day retention window with room either side.
const HEATMAP_WEEKS = 26;
const HEATMAP_DAYS = HEATMAP_WEEKS * 7;

const TARGET_LABEL = {
    application: ['service', 'services'],
    app: ['service', 'services'],
    wordpress_site: ['site', 'sites'],
    database: ['DB', 'DBs'],
    files: ['volume', 'volumes'],
    server: ['server', 'servers'],
};

const KIND_ICON = {
    application: Package,
    app: Package,
    wordpress_site: Globe,
    database: Database,
    files: Archive,
    server: HardDrive,
};

const dayKey = (d) => d.toISOString().slice(0, 10);

function relativeTime(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (Number.isNaN(diff)) return '—';
    if (diff < 90) return 'just now';
    if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    if (diff < 172800) return 'yesterday';
    return `${Math.round(diff / 86400)}d ago`;
}

function formatDuration(seconds) {
    if (!seconds && seconds !== 0) return '—';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return s ? `${m}m ${s}s` : `${m}m`;
}

// DataTable columns for the "Latest snapshots" digest. The hand-rolled table
// had no thead; the shared primitive always renders one, so the cells keep
// their exact markup (.sk-cell-name, .bk-ico, .sk-cell-sub) and the columns
// gain the standard sk-dtable headers.
const LATEST_COLUMNS = [
    {
        key: 'name',
        headerKey: 'app.backupsOverview.snapshot', header: 'Backup',
        sortable: true,
        hideable: false,
        sortValue: (e) => e.name || '',
        render: (e) => {
            const Icon = KIND_ICON[e.kind] || Archive;
            return (
                <div className="sk-cell-name">
                    <span className="bk-ico"><Icon size={14} /></span>
                    <span>
                        <div>{e.name}</div>
                        <div className="sk-cell-sub">{e.sub} · {relativeTime(e.at)}</div>
                    </span>
                </div>
            );
        },
    },
    {
        key: 'size',
        headerKey: 'common.labels.size', header: 'Size',
        sortable: true,
        sortValue: (e) => e.size || 0,
        cellClassName: 'sk-cell-dim',
        render: (e) => formatBytes(e.size, { defaultValue: '—' }),
    },
    {
        key: 'status',
        headerKey: 'common.labels.status', header: 'Status',
        sortable: true,
        sortValue: (e) => e.status || '',
        render: (e) => (
            <Pill kind={e.status === 'complete' ? 'green' : e.status === 'running' ? 'cyan' : 'red'}>
                {e.status}
            </Pill>
        ),
    },
];

// The Backups overview, ported from the design mock: what is protected, how
// reliably it has been running, where the bytes live, and what happened lately.
// The archive table lives on its own Snapshots section — this page answers
// "is my data safe?", not "show me every file".
export default function BackupsOverview({
    stats, storageConfig, costSummary, schedules = [], backups = [], onGo,
}) {
    const { t } = useTranslation();
    const now = new Date();
    const [policies, setPolicies] = useState(null);
    const [runs, setRuns] = useState(null);

    useEffect(() => {
        let cancelled = false;
        // Both are admin-only and both are optional: a panel that has never used
        // policy-driven backups still renders this page off the archive listing.
        api.listBackupPolicies()
            .then((res) => { if (!cancelled) setPolicies(res?.policies || []); })
            .catch(() => { if (!cancelled) setPolicies([]); });
        api.listBackupRuns({ limit: 500 })
            .then((res) => { if (!cancelled) setRuns(res?.runs || []); })
            .catch(() => { if (!cancelled) setRuns([]); });
        return () => { cancelled = true; };
    }, []);

    // Activity events, newest first. Policy runs are richer (status, duration,
    // errors) so they win; the filesystem archive is the fallback for panels
    // that only ever used manual backups.
    const events = useMemo(() => {
        if (runs?.length) {
            return runs.map((r) => ({
                id: `run-${r.id}`,
                at: r.finished_at || r.started_at,
                status: r.status === 'success' ? 'complete' : r.status === 'running' ? 'running' : 'failed',
                name: r.target_meta?.name || `${r.target_type} #${r.target_id}`,
                kind: r.target_type,
                size: r.size_total || r.size_local || 0,
                duration: r.duration_seconds,
                error: r.error_message,
                sub: r.kind === 'full' ? 'Full' : 'Incremental',
            }));
        }
        return (backups || []).map((b, i) => ({
            id: `bk-${i}`,
            at: b.timestamp,
            status: 'complete',
            name: b.name || b.app_name,
            kind: b.type,
            size: b.size || 0,
            duration: null,
            error: null,
            sub: b.type === 'database' ? 'Database' : b.type === 'files' ? 'Files' : 'Service',
        }));
    }, [runs, backups]);

    // Daily buckets over the heatmap window. A day is "failed" if anything that
    // day failed — the point of the strip is to make a bad day findable.
    const heatmap = useMemo(() => {
        const byDay = new Map();
        events.forEach((e) => {
            if (!e.at) return;
            const key = e.at.slice(0, 10);
            const cell = byDay.get(key) || { count: 0, failed: false };
            cell.count += 1;
            if (e.status === 'failed') cell.failed = true;
            byDay.set(key, cell);
        });
        const cells = [];
        for (let i = HEATMAP_DAYS - 1; i >= 0; i -= 1) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const key = dayKey(d);
            cells.push({ key, ...(byDay.get(key) || { count: 0, failed: false }) });
        }
        return cells;
    }, [events]);

    const window30 = useMemo(() => {
        const cutoff = Date.now() - 30 * 86400000;
        return events.filter((e) => e.at && new Date(e.at).getTime() >= cutoff);
    }, [events]);

    const failed30 = window30.filter((e) => e.status === 'failed').length;
    const finished30 = window30.filter((e) => e.status !== 'running');
    const successRate = finished30.length
        ? ((finished30.length - failed30) / finished30.length) * 100
        : null;

    const thisWeek = useMemo(() => {
        const cutoff = Date.now() - 7 * 86400000;
        return events.filter((e) => e.at && new Date(e.at).getTime() >= cutoff).length;
    }, [events]);

    const avgDuration = useMemo(() => {
        const withDuration = events.filter((e) => typeof e.duration === 'number' && e.duration > 0);
        if (!withDuration.length) return null;
        return withDuration.reduce((a, e) => a + e.duration, 0) / withDuration.length;
    }, [events]);

    // Protected resources, grouped the way the mock labels them.
    const protection = useMemo(() => {
        const active = (policies || []).filter((p) => p.enabled);
        const counts = {};
        active.forEach((p) => {
            const [one, many] = TARGET_LABEL[p.target_type] || [p.target_type, `${p.target_type}s`];
            const label = one;
            counts[label] = counts[label] || { one, many, n: 0 };
            counts[label].n += 1;
        });
        const parts = Object.values(counts).map((c) => `${c.n} ${c.n === 1 ? c.one : c.many}`);
        return { total: active.length, detail: parts.join(' · ') };
    }, [policies]);

    const destinations = useMemo(() => {
        const provider = storageConfig?.provider || 'local';
        const rates = costSummary?.cost_rates || {};
        const localBytes = stats?.total_size || 0;
        const remoteBytes = stats?.remote_size || 0;
        const rows = [
            {
                key: 'local',
                name: 'Local disk',
                sub: 'this server',
                bytes: localBytes,
                tone: 'local',
                primary: provider === 'local',
                cost: (localBytes / 1024 ** 3) * (rates.local || 0),
            },
        ];
        if (provider !== 'local') {
            rows.unshift({
                key: provider,
                name: provider === 'b2' ? 'Backblaze B2' : 'S3-compatible',
                sub: storageConfig?.[provider]?.bucket || 'remote bucket',
                bytes: remoteBytes,
                tone: 'remote',
                primary: true,
                cost: (remoteBytes / 1024 ** 3) * (rates[provider] || 0),
            });
        }
        const peak = Math.max(...rows.map((r) => r.bytes), 1);
        return { rows, peak, count: rows.length };
    }, [stats, storageConfig, costSummary]);

    const nextScheduled = (() => {
        const upcoming = (schedules || [])
            .filter((s) => s.enabled !== false)
            .map((s) => ({ schedule: s, at: nextFire(s) }))
            .filter((x) => x.at)
            .sort((a, b) => a.at - b.at);
        return upcoming[0] || null;
    })();

    const totalBytes = (stats?.total_size || 0) + (stats?.remote_size || 0);
    const latest = events.slice(0, 5);

    return (
        <div className="bk-overview">
            <KpiBand max={4}>
                <MetricCard
                    tone="green"
                    icon={<ShieldCheck size={16} />}
                    value={protection.total || stats?.total_backups || 0}
                    label={t('app.backupsOverview.protectedResources', 'Protected resources')}
                >
                    <div className="sk-kpi__sub">
                        <span>{protection.detail || t('app.backupsOverview.fromTheBackupArchive', 'from the backup archive')}</span>
                    </div>
                </MetricCard>
                <MetricCard
                    tone="accent"
                    icon={<Database size={16} />}
                    value={formatBytes(totalBytes, { defaultValue: '0 B' })}
                    label={t('app.backupsOverview.storageUsed', 'Storage used')}
                >
                    <div className="sk-kpi__sub">
                        <span>across {destinations.count} destination{destinations.count === 1 ? '' : 's'}</span>
                    </div>
                </MetricCard>
                <MetricCard
                    tone={successRate == null ? 'accent' : successRate >= 99 ? 'green' : successRate >= 90 ? 'amber' : 'red'}
                    icon={<History size={16} />}
                    value={successRate == null ? '—' : `${successRate.toFixed(1)}`}
                    unit={successRate == null ? undefined : '%'}
                    label={t('app.backupsOverview.successRate', 'Success rate')}
                >
                    <div className="sk-kpi__sub">
                        <span>{finished30.length ? t('app.backupsOverview.runsLast30Days', { count: finished30.length, defaultValue_one: '1 run · last 30 days', defaultValue_other: '{{count}} runs · last 30 days' }) : t('app.backupsOverview.noRunsRecordedYet', 'no runs recorded yet')}</span>
                    </div>
                </MetricCard>
                <MetricCard
                    tone="violet"
                    icon={<Timer size={16} />}
                    value={nextScheduled ? untilLabel(nextScheduled.at, now) : 'Not set'}
                    label={t('app.backupsOverview.nextScheduled', 'Next scheduled')}
                >
                    <div className="sk-kpi__sub">
                        <span>
                            {nextScheduled
                                ? `${nextScheduled.schedule.name || 'schedule'} · ${[nextScheduled.schedule.schedule_time, nextScheduled.schedule.timezone].filter(Boolean).join(' ')}`
                                : t('app.backupsOverview.noScheduledRun', 'no scheduled run reported')}
                        </span>
                    </div>
                </MetricCard>
            </KpiBand>

            <div className="bk-grid2">
                <section className="bk-panel">
                    <div className="bk-panel__head">
                        <div>
                            <h3>{t('app.backupsOverview.backupActivity', 'Backup activity')}</h3>
                            <span className="bk-panel__sub">{t('app.backupsOverview.last', 'Last')} {HEATMAP_WEEKS} {t('app.backupsOverview.weeksDailySnapshots', 'weeks · daily backups')}</span>
                        </div>
                        <div className="bk-heat__legend">
                            less
                            <i className="l1" /><i className="l2" /><i className="l3" />
                            more
                        </div>
                    </div>

                    <div className="bk-heat__scroll">
                        <div className="bk-heat">
                            {heatmap.map((cell) => (
                                <i
                                    key={cell.key}
                                    className={cell.failed ? 'fail' : cell.count === 0 ? '' : cell.count <= 2 ? 'l1' : cell.count <= 4 ? 'l2' : 'l3'}
                                    title={`${cell.key} · ${cell.failed ? 'failed' : `${cell.count} backup${cell.count === 1 ? '' : 's'}`}`}
                                />
                            ))}
                        </div>
                    </div>

                    <div className="bk-heat__stats">
                        {[
                            ['Total backups', events.length.toLocaleString()],
                            ['This week', String(thisWeek)],
                            ['Avg duration', formatDuration(avgDuration)],
                            ['Failed (30d)', String(failed30)],
                        ].map(([label, value]) => (
                            <div key={label}>
                                <span>{label}</span>
                                <strong>{value}</strong>
                            </div>
                        ))}
                    </div>
                </section>

                <section className="bk-panel">
                    <div className="bk-panel__head">
                        <h3>{t('app.backupsOverview.recentActivity', 'Recent activity')}</h3>
                        <Button variant="unstyled" type="button" className="bk-link" onClick={() => onGo('snapshots')}>
                            {t('app.backupsOverview.allSnapshots', 'All backups')} <ChevronRight size={14} />
                        </Button>
                    </div>
                    {events.length === 0 ? (
                        <p className="bk-hint">{t('app.backupsOverview.nothingHasRunYetTheFirst', 'Nothing has run yet. The first backup will show up here.')}</p>
                    ) : (
                        <div className="bk-feed">
                            {events.slice(0, 5).map((e) => (
                                <div key={e.id} className="bk-feed__item">
                                    <span className={`bk-feed__dot is-${e.status}`}>
                                        {e.status === 'failed'
                                            ? <AlertTriangle size={14} />
                                            : e.status === 'running'
                                                ? <History size={14} />
                                                : <Archive size={14} />}
                                    </span>
                                    <div className="bk-feed__body">
                                        <div className="bk-feed__txt">
                                            {e.status === 'failed'
                                                ? <>{t('app.backupsOverview.backupFailed', "Couldn't back up ·")} <b>{e.name}</b>{e.error ? ` — ${e.error}` : ''}</>
                                                : e.status === 'running'
                                                    ? <>{t('app.backupsOverview.backupRunning', 'Backup running ·')} <b>{e.name}</b></>
                                                    : <>{t('app.backupsOverview.backupCompleted', 'Backup completed ·')} <b>{e.name}</b>{e.size ? ` (${formatBytes(e.size)})` : ''}</>}
                                        </div>
                                        <div className="bk-feed__time">{relativeTime(e.at)}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            </div>

            <div className="bk-grid2">
                <section className="bk-panel">
                    <div className="bk-panel__head">
                        <h3>{t('app.backupsOverview.storageDestinations', 'Storage destinations')}</h3>
                        <Button variant="unstyled" type="button" className="bk-link" onClick={() => onGo('storage')}>
                            {t('app.backupsOverview.manage', 'Manage')} <ChevronRight size={14} />
                        </Button>
                    </div>
                    {destinations.rows.map((row) => (
                        <div key={row.key} className="bk-dest__row">
                            <div className="bk-dest__top">
                                <span className="bk-dest__name">
                                    {row.tone === 'local' ? <HardDrive size={14} /> : <Cloud size={14} />}
                                    {row.name}
                                    {row.primary && <span className="bk-dest__tag">{t('app.backups.primary', 'Primary')}</span>}
                                    <small>{row.sub}</small>
                                </span>
                                <span className="bk-dest__size">
                                    {formatBytes(row.bytes, { defaultValue: '0 B' })}
                                    {row.cost > 0 && <em>· ${row.cost.toFixed(2)}/mo</em>}
                                </span>
                            </div>
                            <div className={`bk-dest__bar bk-dest__bar--${row.tone}`}>
                                <i style={{ width: `${Math.max(2, (row.bytes / destinations.peak) * 100)}%` }} />
                            </div>
                        </div>
                    ))}
                    {destinations.count === 1 && (
                        <p className="bk-hint bk-hint--warn">
                            <AlertTriangle size={13} />
                            {t('app.backupsOverview.everythingIsOnOneDiskAdd', 'Everything is on one disk. Add a remote destination so a dead server doesn\'t take the backups with it.')}
                        </p>
                    )}
                </section>

                <section className="bk-panel bk-panel--flush">
                    <div className="bk-panel__head">
                        <h3>{t('app.backupsOverview.latestSnapshots', 'Latest backups')}</h3>
                    </div>
                    {latest.length === 0 ? (
                        <EmptyState
                            icon={Archive}
                            title={t('app.backupsOverview.noSnapshotsYet', 'No backups yet')}
                            description={t('app.backupsOverview.runABackupOrEnableA', 'Run a backup or enable a schedule to start building an archive.')}
                        />
                    ) : (
                        <DataTable
                            columns={LATEST_COLUMNS}
                            data={latest}
                            keyField="id"
                            storageKey="serverkit-table-backup-latest"
                            tableClassName="bk-latest"
                            footer={(
                                <DataTableFooter
                                    shown={latest.length}
                                    total={events.length}
                                    noun="snapshot"
                                />
                            )}
                        />
                    )}
                </section>
            </div>
        </div>
    );
}
