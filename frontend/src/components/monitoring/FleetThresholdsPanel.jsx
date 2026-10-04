import { useState, useEffect } from 'react';
import { Plus, XCircle } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable, DataTableFooter } from '@/components/ds';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import ServerPicker from '@/components/ServerPicker';

// ServerPicker's "no server" entry: a threshold without server_id is the
// fleet default.
const FLEET_DEFAULT = '__fleet';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { METRIC_LABELS } from './fleetMetrics';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

const DEFAULT_THRESHOLD = {
    metric: 'cpu',
    warning_threshold: 80,
    critical_threshold: 95,
    duration_seconds: 300,
};

// Per-server limits, sitting under the panel host's own limits on the Rules
// tab: same idea, wider scope. Two lists rather than one because they are two
// backends — the host's four values are a single config, these are rows.
export default function FleetThresholdsPanel({ refreshKey = 0 }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [thresholds, setThresholds] = useState([]);
    const [draft, setDraft] = useState(DEFAULT_THRESHOLD);
    const [adding, setAdding] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let cancelled = false;
        api.getFleetThresholds()
            .then((data) => { if (!cancelled) setThresholds(Array.isArray(data) ? data : []); })
            .catch(() => { if (!cancelled) setThresholds([]); });
        return () => { cancelled = true; };
    }, [refreshKey, reloadKey]);

    const reload = () => setReloadKey((k) => k + 1);

    const saveThreshold = async () => {
        try {
            await api.createFleetThreshold(draft);
            toast.success(t('app.fleetThresholdsPanel.thresholdSaved', 'Threshold saved'));
            setDraft(DEFAULT_THRESHOLD);
            setAdding(false);
            reload();
        } catch (err) {
            toastError(toast, t('app.fleetThresholdsPanel.failedToSaveThreshold', "Couldn't save the threshold."), err);
        }
    };

    const removeThreshold = async (id) => {
        try {
            await api.deleteFleetThreshold(id);
            reload();
        } catch (err) {
            toastError(toast, t('app.fleetThresholdsPanel.failedToDeleteThreshold', "Couldn't delete the threshold."), err);
        }
    };

    const { sorts, setSorts } = useTableSort({ storageKey: 'serverkit-table-fleet-thresholds-sort' });
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({ storageKey: 'serverkit-table-fleet-thresholds-cols' });

    // Columns for the shared DataTable; cell markup is identical to the
    // hand-rolled table it replaces (.sk-cell-mono, .mon-row-actions).
    const thresholdColumns = [
        {
            key: 'applies',
            headerKey: 'app.fleetThresholdsPanel.appliesTo', header: 'Applies to',
            sortable: true,
            hideable: false,
            sortValue: (t) => t.server_name || 'Every server',
            render: (t) => t.server_name || 'Every server',
        },
        {
            key: 'metric',
            headerKey: 'app.fleetThresholdsPanel.metric', header: 'Metric',
            sortable: true,
            sortValue: (t) => METRIC_LABELS[t.metric] || t.metric,
            render: (t) => METRIC_LABELS[t.metric] || t.metric,
        },
        {
            key: 'warning',
            headerKey: 'common.labels.warning', header: 'Warning',
            sortable: true,
            sortValue: (t) => t.warning_threshold ?? null,
            cellClassName: 'sk-cell-dim',
            render: (t) => `${t.warning_threshold}%`,
        },
        {
            key: 'critical',
            headerKey: 'app.fleetThresholdsPanel.critical', header: 'Critical',
            sortable: true,
            sortValue: (t) => t.critical_threshold ?? null,
            cellClassName: 'sk-cell-dim',
            render: (t) => `${t.critical_threshold}%`,
        },
        {
            key: 'sustained',
            headerKey: 'app.fleetThresholdsPanel.sustained', header: 'Sustained',
            sortable: true,
            sortValue: (t) => t.duration_seconds ?? null,
            cellClassName: 'sk-cell-dim',
            render: (t) => `${t.duration_seconds}s`,
        },
        {
            key: 'actions',
            header: '',
            sortable: false,
            hideable: false,
            cellClassName: 'mon-row-actions',
            render: (t) => (
                <Button variant="ghost" size="sm" onClick={() => removeThreshold(t.id)}>
                    <XCircle size={14} />
                </Button>
            ),
        },
    ];

    return (
        <section className="monitoring-panel">
            <div className="monitoring-panel__header">
                <div>
                    <h3>{t('app.fleetThresholdsPanel.perServerRules', 'Per-server rules')}</h3>
                    <span className="mon-panel-sub">{t('app.fleetThresholdsPanel.limitsAppliedToPairedServersBy', 'Limits applied to paired servers by their agents')}</span>
                </div>
                <div>
                    <Button size="sm" variant={adding ? 'outline' : 'default'} onClick={() => setAdding((v) => !v)}>
                        <Plus size={14} /> {adding ? 'Cancel' : 'Add rule'}
                    </Button>
                </div>
            </div>

            {adding && (
                <div className="mon-threshold-form">
                    <div className="form-group">
                        <Label>{t('app.fleetThresholdsPanel.appliesTo', 'Applies to')}</Label>
                        <ServerPicker
                            value={draft.server_id || FLEET_DEFAULT}
                            onChange={(id) => setDraft((p) => ({ ...p, server_id: id === FLEET_DEFAULT ? undefined : id }))}
                            includeLocal={false}
                            onlineOnly={false}
                            extraOptions={[{ value: FLEET_DEFAULT, label: t('app.fleetThresholdsPanel.everyServerFleetDefault', 'Every server (fleet default)') }]}
                            label={t('app.fleetThresholdsPanel.appliesTo', 'Applies to')}
                        />
                    </div>
                    <div className="form-group">
                        <Label htmlFor="fleet-threshold-metric">{t('app.fleetThresholdsPanel.metric', 'Metric')}</Label>
                        <Select value={draft.metric} onValueChange={(metric) => setDraft((p) => ({ ...p, metric }))}>
                            <SelectTrigger id="fleet-threshold-metric"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="cpu">CPU</SelectItem>
                                <SelectItem value="memory">{t('common.labels.memory', 'Memory')}</SelectItem>
                                <SelectItem value="disk">{t('common.labels.disk', 'Disk')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="form-group">
                        <Label htmlFor="fleet-threshold-warning">{t('app.fleetThresholdsPanel.warning2', 'Warning (%)')}</Label>
                        <Input
                            id="fleet-threshold-warning"
                            type="number"
                            value={draft.warning_threshold}
                            onChange={(e) => setDraft((p) => ({ ...p, warning_threshold: parseFloat(e.target.value) || 80 }))}
                        />
                    </div>
                    <div className="form-group">
                        <Label htmlFor="fleet-threshold-critical">{t('app.fleetThresholdsPanel.critical2', 'Critical (%)')}</Label>
                        <Input
                            id="fleet-threshold-critical"
                            type="number"
                            value={draft.critical_threshold}
                            onChange={(e) => setDraft((p) => ({ ...p, critical_threshold: parseFloat(e.target.value) || 95 }))}
                        />
                    </div>
                    <div className="form-group">
                        <Label htmlFor="fleet-threshold-duration">{t('app.fleetThresholdsPanel.sustainedForS', 'Sustained for (s)')}</Label>
                        <Input
                            id="fleet-threshold-duration"
                            type="number"
                            value={draft.duration_seconds}
                            onChange={(e) => setDraft((p) => ({ ...p, duration_seconds: parseInt(e.target.value, 10) || 300 }))}
                        />
                    </div>
                    <Button size="sm" onClick={saveThreshold}>{t('app.fleetThresholdsPanel.saveRule', 'Save rule')}</Button>
                </div>
            )}

            {thresholds.length > 0 ? (
                <DataTable
                    columns={thresholdColumns}
                    data={thresholds}
                    keyField="id"
                    sorts={sorts}
                    onSortsChange={setSorts}
                    hiddenKeys={hiddenKeys}
                    onHiddenKeysChange={setHiddenKeys}
                    className="mon-table-scroll"
                    footer={(
                        <DataTableFooter
                            shown={thresholds.length}
                            total={thresholds.length}
                            noun="rule"
                        />
                    )}
                />
            ) : (
                <p className="mon-panel-hint">
                    {t('app.fleetThresholdsPanel.noPerServerRulesYetPaired', 'No per-server rules yet. Paired servers fall back to their agent defaults.')}
                </p>
            )}
        </section>
    );
}
