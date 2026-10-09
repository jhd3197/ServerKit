import { useState } from 'react';
import { Pill, DataTable, DataTableFooter } from '@/components/ds';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/EmptyState';
import {
    Archive, RotateCcw, ShieldCheck, Trash2, HardDrive, Cloud, Layers,
    FlaskConical, ChevronRight, ChevronDown,
} from 'lucide-react';
import { humanSize, formatMoney, formatWhen, statusKind, storageLabel } from './format';
import { useTranslation } from 'react-i18next';
import { t } from '../../i18n/t';

// Card 3 of the backup "Protection" panel: a data-table of backup runs.
// The table is .sk-dtable; .backup-history-list__* styles cell content only.
function storageIcon(run) {
    const label = storageLabel(run);
    if (label === 'both') {
        return (
            <span className="backup-history-list__storage" title={t('app.backupHistoryList.localRemote', 'Local + remote')}>
                <Layers size={13} /> both
            </span>
        );
    }
    if (label === 'remote') {
        return (
            <span className="backup-history-list__storage" title={t('app.backupHistoryList.remote', 'Remote')}>
                <Cloud size={13} /> remote
            </span>
        );
    }
    return (
        <span className="backup-history-list__storage" title={t('app.backupHistoryList.local', 'Local')}>
            <HardDrive size={13} /> local
        </span>
    );
}

// Drill outcomes read straight from the shared table (skipped_no_space is a
// soft amber warning there — no disk headroom to drill, never a hard failure).
function drillStatusLabel(status) {
    if (status === 'skipped_no_space') return 'skipped (no space)';
    return status || 'unknown';
}

// Render whatever shape `probes` arrives in (array of checks, keyed object, or
// a plain string) as compact key/value rows without assuming a schema.
function renderProbes(probes) {
    if (!probes) return <span className="backup-drills__probe-empty">{t('app.backupHistoryList.noProbeDetailsRecorded', 'No probe details recorded.')}</span>;
    const entries = Array.isArray(probes)
        ? probes.map((p, i) => [p?.name || `Probe ${i + 1}`, p?.detail ?? p?.result ?? p?.ok ?? p])
        : (typeof probes === 'object' ? Object.entries(probes) : [['result', probes]]);
    return (
        <dl className="backup-drills__probes">
            {entries.map(([key, value]) => (
                <div key={key} className="backup-drills__probe">
                    <dt>{key}</dt>
                    <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                </div>
            ))}
        </dl>
    );
}

function RestoreDrills({ drills }) {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(null);
    if (!drills || drills.length === 0) return null;

    return (
        <div className="backup-drills">
            <div className="backup-drills__head">
                <FlaskConical size={14} />
                <span>{t('app.backupHistoryList.restoreDrills', 'Restore drills')}</span>
                <span className="backup-drills__sub">{t('app.backupHistoryList.proofThatTheseBackupsCanActually', 'Proof that these backups can actually be recovered.')}</span>
            </div>
            <ul className="backup-drills__list">
                {drills.map((drill) => {
                    const isOpen = expanded === drill.id;
                    return (
                        <li key={drill.id} className="backup-drills__item">
                            <Button variant="unstyled"
                                type="button"
                                className="backup-drills__row"
                                onClick={() => setExpanded(isOpen ? null : drill.id)}
                                aria-expanded={isOpen}
                            >
                                <span className="backup-drills__chev">
                                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                </span>
                                <Pill kind={statusKind(drill.status)}>{drillStatusLabel(drill.status)}</Pill>
                                <span className="backup-drills__trigger">{drill.trigger || 'manual'}</span>
                                <span className="backup-drills__when">{formatWhen(drill.started_at)}</span>
                                {drill.duration_seconds != null && (
                                    <span className="backup-drills__meta">{drill.duration_seconds}s</span>
                                )}
                                {drill.bytes_restored != null && (
                                    <span className="backup-drills__meta">{humanSize(drill.bytes_restored)}</span>
                                )}
                            </Button>
                            {isOpen && (
                                <div className="backup-drills__detail">
                                    {drill.error && <p className="backup-drills__error">{drill.error}</p>}
                                    {renderProbes(drill.probes)}
                                </div>
                            )}
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

export default function BackupHistoryList({
    runs,
    drills,
    loading,
    onRestore,
    onVerify,
    onDelete,
    onRowClick,
}) {
    const { t } = useTranslation();
    const hasDrills = drills && drills.length > 0;

    // DataTable columns. Cell markup and classNames are identical to the
    // hand-rolled table they replace (.sk-cell-name, .backup-history-list__*,
    // .sk-cell-mono). The row click opens the detail drawer; the actions cell
    // stops propagation so its buttons never trigger it.
    const columns = [
        {
            key: 'backup',
            headerKey: 'app.backupHistoryList.backup', header: 'Backup',
            sortable: true,
            hideable: false,
            sortValue: (run) => run.metadata?.backup_name || `Backup #${run.id}`,
            render: (run) => (
                <div className="sk-cell-name">
                    <span className="backup-history-list__ico"><Archive size={14} /></span>
                    <span>{run.metadata?.backup_name || t('app.backupHistoryList.backupNumber', 'Backup #{{id}}', { id: run.id })}</span>
                    <Pill kind={run.kind === 'full' ? 'violet' : 'gray'} dot={false}>{run.kind}</Pill>
                </div>
            ),
        },
        {
            key: 'date',
            headerKey: 'app.backupHistoryList.date', header: 'Date',
            sortable: true,
            sortValue: (run) => (run.started_at ? new Date(run.started_at).getTime() : null),
            cellClassName: 'backup-history-list__when',
            render: (run) => formatWhen(run.started_at),
        },
        {
            key: 'size',
            headerKey: 'common.labels.size', header: 'Size',
            sortable: true,
            sortValue: (run) => run.size_total || 0,
            cellClassName: 'sk-cell-dim',
            render: (run) => humanSize(run.size_total),
        },
        {
            key: 'cost',
            headerKey: 'app.backupHistoryList.cost', header: 'Cost',
            sortable: true,
            sortValue: (run) => Number(run.cost_total || 0),
            cellClassName: 'sk-cell-dim',
            render: (run) => formatMoney(run.cost_total),
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            sortValue: (run) => run.status || '',
            render: (run) => <Pill kind={statusKind(run.status)}>{run.status}</Pill>,
        },
        {
            key: 'storage',
            headerKey: 'common.labels.storage', header: 'Storage',
            sortable: true,
            sortValue: (run) => storageLabel(run),
            render: (run) => storageIcon(run),
        },
        {
            key: 'actions',
            header: '',
            sortable: false,
            hideable: false,
            render: (run) => (
                <div className="backup-history-list__actions" onClick={(e) => e.stopPropagation()}>
                    <Button size="icon" variant="outline" title={t('common.actions.restore', 'Restore')} disabled={run.status !== 'success'} onClick={() => onRestore(run)}><RotateCcw size={14} /></Button>
                    {run.remote_key && (
                        <Button size="icon" variant="outline" title={t('app.backupHistoryList.verifyRemoteCopy', 'Verify remote copy')} onClick={() => onVerify(run)}><ShieldCheck size={14} /></Button>
                    )}
                    <Button size="icon" variant="destructive" title={t('common.actions.delete', 'Delete')} onClick={() => onDelete(run)}><Trash2 size={14} /></Button>
                </div>
            ),
        },
    ];

    if (loading && (!runs || runs.length === 0)) {
        return <EmptyState icon={Archive} title={t('app.backupHistoryList.loadingBackups', 'Loading backups…')} loading />;
    }

    if (!loading && (!runs || runs.length === 0)) {
        return (
            <>
                <RestoreDrills drills={drills} />
                {!hasDrills && (
                    <EmptyState
                        icon={Archive}
                        title={t('app.backupHistoryList.noBackupsYet', 'No backups yet')}
                        description={t('app.backupHistoryList.turnOnProtectionOrClickBack', 'Turn on protection or click Back up now.')}
                    />
                )}
            </>
        );
    }

    return (
        <>
            <RestoreDrills drills={drills} />
            <DataTable
                columns={columns}
                data={runs}
                keyField="id"
                storageKey="serverkit-table-backup-history"
                onRowClick={onRowClick}
                footer={(
                    <DataTableFooter
                        shown={runs.length}
                        total={runs.length}
                        noun="backup"
                    />
                )}
            />
        </>
    );
}
