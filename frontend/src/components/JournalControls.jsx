import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { useTranslation } from 'react-i18next';

// Radix Select reserves '' for "no selection", so "All" travels as a sentinel
// and is turned back into '' before it reaches the caller.
const ALL_PRIORITIES = '__all';

const PRIORITY_OPTIONS = [
    { value: ALL_PRIORITIES, labelKey: 'common.labels.all', label: 'All' },
    { value: '0', labelKey: 'app.journalControls.emergency', label: 'Emergency' },
    { value: '1', labelKey: 'app.journalControls.alert', label: 'Alert' },
    { value: '2', labelKey: 'app.journalControls.critical', label: 'Critical' },
    { value: '3', labelKey: 'app.journalControls.error', label: 'Error' },
    { value: '4', labelKey: 'common.labels.warning', label: 'Warning' },
    { value: '5', labelKey: 'app.journalControls.notice', label: 'Notice' },
    { value: '6', labelKey: 'common.labels.info', label: 'Info' },
    { value: '7', labelKey: 'app.journalControls.debug', label: 'Debug' },
];

export function JournalControls({
    unit = '',
    onUnitChange,
    unitLabel = 'Service/Unit',
    unitPlaceholder = 'All services',
    quickUnits = [],
    showQuickUnits = true,
    lineCount,
    onLineCountChange,
    lineCountOptions = [50, 100, 200, 500],
    priority,
    onPriorityChange,
    showPriority = true,
    loading = false,
    onLoad,
    loadLabel = 'Load Logs',
}) {
    const { t } = useTranslation();
    return (
        <div className="journal-controls">
            <div className="control-group">
                <label>{unitLabel}</label>
                <div className="input-with-suggestions">
                    <Input
                        type="text"
                        value={unit}
                        onChange={(e) => onUnitChange?.(e.target.value)}
                        placeholder={unitPlaceholder}
                    />
                    {showQuickUnits && quickUnits.length > 0 && (
                        <div className="quick-units">
                            {quickUnits.map(u => (
                                <Button variant="unstyled" type="button"
                                    key={u}
                                    className={`unit-chip ${unit === u ? 'active' : ''}`}
                                    onClick={() => onUnitChange?.(unit === u ? '' : u)}
                                >
                                    {u}
                                </Button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {onLineCountChange && (
                <div className="control-group">
                    <label>{t('app.journalControls.lines', 'Lines')}</label>
                    <Select value={String(lineCount)} onValueChange={(v) => onLineCountChange(parseInt(v, 10))}>
                        <SelectTrigger aria-label={t('app.journalControls.lines', 'Lines')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {lineCountOptions.map(n => (
                                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {showPriority && onPriorityChange && (
                <div className="control-group">
                    <label>{t('app.journalControls.priority', 'Priority')}</label>
                    <Select
                        value={priority == null || priority === '' ? ALL_PRIORITIES : String(priority)}
                        onValueChange={(v) => onPriorityChange(v === ALL_PRIORITIES ? '' : v)}
                    >
                        <SelectTrigger aria-label={t('app.journalControls.priority', 'Priority')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {PRIORITY_OPTIONS.map(o => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {onLoad && (
                <Button onClick={onLoad} disabled={loading}>
                    {loading ? t('common.loading', 'Loading…') : loadLabel}
                </Button>
            )}
        </div>
    );
}

export default JournalControls;
