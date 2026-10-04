import { Button } from '@/components/ui/button';
import { nextFire, untilLabel, frequencyLabel } from '@/utils/backupSchedule';
import { Archive, Database, Globe, HardDrive, Package, Play, ShieldCheck, Trash2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { DataTable, DataTableFooter } from '@/components/ds';
import { useTranslation } from 'react-i18next';

const KIND_ICON = {
    application: Package,
    database: Database,
    files: Archive,
    wordpress: Globe,
    server: HardDrive,
};

function agoLabel(iso) {
    if (!iso) return 'Never';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (Number.isNaN(diff)) return 'Never';
    if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}m ago`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
    if (diff < 172800) return 'yesterday';
    return `${Math.round(diff / 86400)}d ago`;
}

// Policy list in the design mock's shape: what runs, how often, how long it is
// kept, where it lands, and whether it is on. The columns the mock fills from
// its fixtures but this panel has no source for (per-policy size, run-now) are
// left out rather than faked.
export default function SchedulesTable({
    schedules, retentionDays, remoteLabel, onToggle, onRemove, onRun,
}) {
    const { t } = useTranslation();
    const now = new Date();
    // DataTable columns. Cell markup and classNames are identical to the
    // hand-rolled table they replace, so _backups.scss keeps applying
    // (.bk-name, .bk-ret, .bk-lastrun, .bk-paused, .bk-col-on, .bk-actions).
    const columns = [
        {
            key: 'policy',
            headerKey: 'app.schedulesTable.policy', header: 'Policy',
            sortable: true,
            hideable: false,
            sortValue: (s) => s.name || '',
            render: (schedule) => {
                const Icon = KIND_ICON[schedule.backup_type] || Archive;
                return (
                    <div className="sk-cell-name bk-name">
                        <span className={`bk-ico bk-ico--${schedule.backup_type}`}>
                            <Icon size={15} />
                        </span>
                        <span>
                            <div>{schedule.name}</div>
                            <div className="sk-cell-sub">
                                {[schedule.target, schedule.backup_type,
                                    schedule.upload_remote ? 'off-box copy' : null]
                                    .filter(Boolean).join(' · ')}
                            </div>
                        </span>
                    </div>
                );
            },
        },
        {
            key: 'frequency',
            headerKey: 'app.schedulesTable.frequency', header: 'Frequency',
            sortable: true,
            sortValue: (s) => frequencyLabel(s),
            cellClassName: 'sk-cell-dim',
            render: (schedule) => frequencyLabel(schedule),
        },
        {
            // Same retentionDays on every row — sorting it would be noise.
            key: 'retention',
            headerKey: 'app.schedulesTable.retention', header: 'Retention',
            render: () => (
                <span className="bk-ret">
                    <span>{retentionDays} d</span>
                </span>
            ),
        },
        {
            key: 'destination',
            headerKey: 'app.schedulesTable.destination', header: 'Destination',
            sortable: true,
            sortValue: (s) => (s.upload_remote ? remoteLabel : 'Local disk'),
            cellClassName: 'sk-cell-dim',
            render: (schedule) => (schedule.upload_remote ? remoteLabel : 'Local disk'),
        },
        {
            key: 'lastRun',
            headerKey: 'app.schedulesTable.lastRun', header: 'Last run',
            sortable: true,
            sortValue: (s) => (s.last_run ? new Date(s.last_run).getTime() : null),
            render: (schedule) => {
                const failed = schedule.last_status === 'failed';
                return failed ? (
                    <span className="bk-lastrun is-failed">
                        <i />{agoLabel(schedule.last_run)}
                    </span>
                ) : (
                    <span className="bk-lastrun">{agoLabel(schedule.last_run)}</span>
                );
            },
        },
        {
            key: 'next',
            headerKey: 'app.schedulesTable.next', header: 'Next',
            sortable: true,
            sortValue: (s) => {
                const next = nextFire(s);
                return next ? next.getTime() : null;
            },
            cellClassName: 'sk-cell-dim',
            render: (schedule) => {
                const next = nextFire(schedule);
                if (schedule.schedule_error) return <span title={schedule.schedule_error}>{t('app.schedulesTable.invalidSchedule', "Schedule isn't valid")}</span>;
                return schedule.enabled
                    ? (next ? <span title={schedule.next_run_at}>{untilLabel(next, now)}</span> : '—')
                    : <span className="bk-paused">paused</span>;
            },
        },
        {
            key: 'on',
            header: 'On',
            sortable: true,
            sortValue: (s) => (s.enabled ? 1 : 0),
            className: 'bk-col-on',
            cellClassName: 'bk-col-on',
            render: (schedule) => (
                <Switch
                    checked={Boolean(schedule.enabled)}
                    onCheckedChange={() => onToggle(schedule)}
                    aria-label={schedule.enabled
                        ? t('app.schedulesTable.disable', 'Disable {{name}}', { name: schedule.name })
                        : t('app.schedulesTable.enable', 'Enable {{name}}', { name: schedule.name })}
                />
            ),
        },
        {
            key: 'actions',
            header: '',
            sortable: false,
            hideable: false,
            render: (schedule) => (
                <div className="bk-actions">
                    {onRun && (
                        <Button variant="unstyled"
                            type="button"
                            className="bk-iconbtn"
                            onClick={() => onRun(schedule)}
                            title={t('app.schedulesTable.runThisPolicyNow', 'Run this policy now')}
                            aria-label={t('app.schedulesTable.runNow', 'Run {{name}} now', { name: schedule.name })}
                        >
                            <Play size={15} />
                        </Button>
                    )}
                    <Button variant="unstyled"
                        type="button"
                        className="bk-iconbtn bk-iconbtn--danger"
                        onClick={() => onRemove(schedule.id)}
                        title={t('app.schedulesTable.deleteThisPolicy', 'Delete this policy')}
                        aria-label={t('app.schedulesTable.delete', 'Delete {{name}}', { name: schedule.name })}
                    >
                        <Trash2 size={15} />
                    </Button>
                </div>
            ),
        },
    ];

    return (
        <>
            <div className="bk-card">
                <DataTable
                    columns={columns}
                    data={schedules}
                    keyField="id"
                    storageKey="serverkit-table-backup-schedules"
                    rowClassName={(schedule) => (schedule.enabled ? undefined : 'is-off')}
                    tableClassName="bk-table bk-table--schedules"
                    footer={(
                        <DataTableFooter
                            shown={schedules.length}
                            total={schedules.length}
                            noun="schedule"
                        />
                    )}
                />
            </div>
            <p className="bk-hint bk-hint--foot">
                <ShieldCheck size={13} />
                {t('app.schedulesTable.snapshotsOlderThan', 'Backups older than')} {retentionDays} {t('app.schedulesTable.daysArePrunedAutomaticallyPerResource', 'days are pruned automatically. Per-resource policies (with their own retention) are set on each service or database.')}
            </p>
        </>
    );
}
