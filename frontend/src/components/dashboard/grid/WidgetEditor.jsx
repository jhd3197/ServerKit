import { useMemo, useState } from 'react';
import {
    Copy, LayoutGrid, Minus, Plus, Trash2,
} from 'lucide-react';
import { Drawer, SegControl } from '@/components/ds';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import {
    Select as UiSelect, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
    AGGREGATIONS, LINE_STYLES, SERIES_COLORS, getMetric,
    metricsForResource, metricsForSource,
} from '../widgets/metrics';
// Single source of truth for shortcut targets: what a user can pick here is
// exactly what the renderer can draw. WidgetBody is what the board itself
// draws with, so the preview cannot drift from the real thing.
import { QUICK_ACTION_OPTIONS, WidgetBody } from '../widgets/renderers';
import { deriveWidgetTitle } from '../widgets/registry';
import { GRID_COLS, GRID_GAP, GRID_ROW } from './layout';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Tallest a widget may be dragged/stepped to. Twelve columns wide is the board;
// height is only bounded so a stepper can't run away.
const MAX_ROWS = 20;
const FALLBACK_MIN = [2, 2];
// Log widgets count lines, everything else counts rows — different granularity.
const LINE_STEP = 20;
const LINE_MIN = 20;
const ROW_MIN = 2;

// One grid column plus its gutter on a typical ~1300px board. The preview
// reproduces that step (rather than a fraction of the stage) so a 4-wide widget
// looks 4-wide instead of shrinking to fit a 700px drawer column; anything
// wider than the stage is capped by `max-width` in the stylesheet.
const PREVIEW_STEP = 109;

const TABLE_SOURCES = [
    ['services', 'Services'],
    ['servers', 'Servers'],
    ['containers', 'Containers'],
    ['deploys', 'Deploys'],
];
const TOPN_DIMENSIONS = [['servers', 'Servers'], ['services', 'Services']];
const LOG_LEVELS = [['all', 'All'], ['out', 'Info'], ['warn', 'Warn'], ['err', 'Error']];
const SEVERITIES = [['all', 'All'], ['critical', 'Critical'], ['high', 'High'], ['low', 'Low']];

// Types that point at one machine, so they get the resource picker.
const RESOURCE_TYPES = ['stat', 'gauge', 'specs'];
// Every core type except `status`, which draws the whole fleet and so has
// nothing to configure beyond its title and size.
const CONFIGURABLE_TYPES = [
    'stat', 'timeseries', 'gauge', 'topn', 'table', 'logs',
    'deploys', 'alerts', 'feed', 'actions', 'specs', 'note',
];

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const toOptions = (pairs) => pairs.map(([value, label]) => ({ value, label }));

// A metric saved before the resource changed is kept in the list, flagged,
// rather than silently swapped out from under the operator.
function asOptions(catalog, selected) {
    const options = catalog.map((metric) => [metric.id, metric.label]);
    if (selected && !catalog.some((metric) => metric.id === selected)) {
        options.push([selected, `${getMetric(selected).label} · unavailable here`]);
    }
    return options;
}

/**
 * Metric dropdown options for a resource. metrics.js is explicit that config
 * UIs must build this from the resource's own catalog, so a dead option
 * (network on the local host, load average on an agent) never reaches a user.
 * The `$server` variable can resolve either way, so it gets the union.
 */
function metricOptionsFor(resource, selected) {
    const catalog = !resource || resource === '$server'
        ? [...new Set([...metricsForSource('local'), ...metricsForSource('server')])]
        : metricsForResource(resource);
    return asOptions(catalog, selected);
}

/** Top N ranks servers/services, never the panel host. */
function topnMetricOptions(selected) {
    return asOptions(metricsForSource('server'), selected);
}

const iconOf = (type) => {
    const candidate = type?.icon;
    const usable = typeof candidate === 'function' || (candidate && typeof candidate === 'object');
    return usable ? candidate : LayoutGrid;
};

/**
 * One labelled setting. `inline` puts the control beside the caption instead of
 * under it, which is how a bare switch reads best.
 */
function Field({ label, hint, inline, children }) {
    return (
        <div className={`skwe-edit__row${inline ? ' skwe-edit__row--inline' : ''}`}>
            {/* A <span>, not a <label>: every control below carries its own
                aria-label, so the caption is presentation only and must not
                claim an association it does not have. */}
            <span className="skwe-edit__label">{label}</span>
            <div className="skwe-edit__control">{children}</div>
            {hint && <p className="skwe-edit__hint">{hint}</p>}
        </div>
    );
}

function Group({ title, children }) {
    return (
        <div className="skwe-edit__group">
            <div className="skwe-edit__grouphead">{title}</div>
            {children}
        </div>
    );
}

// Radix reserves '' for "no selection", so an empty option value rides this
// sentinel inside the control and is handed back as '' (what the native
// <select> used to emit). Values are strings either way, as before.
const EMPTY_OPTION = '__none';
const toItemValue = (value) => (value === '' || value == null ? EMPTY_OPTION : String(value));

function Select({ value, onChange, options, label }) {
    return (
        <UiSelect
            value={toItemValue(value)}
            onValueChange={(next) => onChange(next === EMPTY_OPTION ? '' : next)}
        >
            <SelectTrigger size="sm" className="skwe-edit__select" aria-label={label}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map(([optionValue, optionLabel]) => (
                    <SelectItem key={optionValue} value={toItemValue(optionValue)}>{optionLabel}</SelectItem>
                ))}
            </SelectContent>
        </UiSelect>
    );
}

function Stepper({ label, value, onStep, suffix }) {
    const { t } = useTranslation();
    return (
        <div className="skwe-stepper">
            <SharedButton variant="unstyled"
                type="button"
                className="skwe-stepper__btn"
                title={t('app.widgetEditor.decrease', 'Decrease {{label}}', { label: label })}
                aria-label={t('app.widgetEditor.decrease', 'Decrease {{label}}', { label: label })}
                onClick={() => onStep(-1)}
            >
                <Minus size={13} aria-hidden="true" />
            </SharedButton>
            <span className="skwe-stepper__val">{value}{suffix ? ` ${suffix}` : ''}</span>
            <SharedButton variant="unstyled"
                type="button"
                className="skwe-stepper__btn"
                title={t('app.widgetEditor.increase', 'Increase {{label}}', { label: label })}
                aria-label={t('app.widgetEditor.increase', 'Increase {{label}}', { label: label })}
                onClick={() => onStep(1)}
            >
                <Plus size={13} aria-hidden="true" />
            </SharedButton>
        </div>
    );
}

/**
 * Wide configuration drawer for the selected widget: the real widget rendered
 * live on the left, its settings on the right. Every field writes straight
 * through `onChange` with a whole new widget instance — the board owns the list
 * and decides when to persist — so the preview updates on the same keystroke
 * the board does.
 *
 * Built on the shared ds/Drawer (a Radix dialog) rather than a hand-rolled
 * fixed panel. That buys escape-to-close, scrim-to-close, focus trapping and
 * listener teardown from the primitive, and it is also why the floating AI
 * bubble steps aside: `_ai-assistant.scss` already hides `.sk-ai-bubble` while
 * any `[role=dialog][data-state=open]` is mounted. The old inspector was a bare
 * <aside>, which is exactly why the bubble sat on top of its footer.
 */
/**
 * One dot showing a series' current colour; the palette lives behind it.
 *
 * The first pass rendered all seven swatches inline on every series row, which
 * for a four-series chart meant twenty-eight coloured squares competing with
 * the controls that actually matter. A colour picker only needs to show the
 * colour — the alternatives are a click away.
 */
function SeriesColor({ value, fallback, index, onChange }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <SharedButton variant="unstyled"
                    type="button"
                    className="skwe-edit__color"
                    aria-label={t('app.widgetEditor.seriesColour', 'Series {{value}} colour', { value: index + 1 })}
                    title={t('app.widgetEditor.seriesColour2', 'Series colour')}
                    style={{ background: value || fallback }}
                />
            </PopoverTrigger>
            <PopoverContent align="start" sideOffset={6} className="skwe-palette">
                {SERIES_COLORS.map(([option, name]) => (
                    <SharedButton variant="unstyled"
                        key={option || 'default'}
                        type="button"
                        aria-label={name}
                        title={name}
                        className={`skwe-palette__dot${(value || '') === option ? ' is-on' : ''}`}
                        style={{ background: option || fallback }}
                        onClick={() => { onChange(option); setOpen(false); }}
                    />
                ))}
            </PopoverContent>
        </Popover>
    );
}

export function WidgetEditor({
    widget,
    type,
    resources = [],
    ctx,
    onChange,
    onClose,
    onDuplicate,
    onRemove,
}) {
    const { t } = useTranslation();
    const resourceOptions = useMemo(() => [
        ['$server', 'Dashboard variable'],
        ...resources.map((resource) => [
            resource.id,
            resource.kind ? `${resource.label} · ${resource.kind}` : resource.label,
        ]),
    ], [resources]);

    if (!widget) return null;

    const cfg = widget.cfg || {};
    const kind = widget.type;
    const [minW, minH] = type?.min || FALLBACK_MIN;
    const Icon = iconOf(type);
    const title = deriveWidgetTitle(widget, type);

    // A chevron that opens a menu of one is noise: with a single connected
    // machine the board variable and that machine are the same answer, so the
    // picker is replaced by a plain readout of what the widget reads.
    const multiResource = resources.length > 1;
    const soleResourceLabel = resources[0]?.label || 'Dashboard variable';
    // What that readout should say. A saved widget can still point at a server
    // that has since been removed, and silently printing the surviving host
    // would hide the problem — so say so instead.
    const resolvedResource = (value) => {
        if (!value || value === '$server') return soleResourceLabel;
        return resources.find((resource) => resource.id === value)?.label || `${value} · not connected`;
    };

    const set = (key, value) => onChange?.({ ...widget, cfg: { ...cfg, [key]: value } });
    const setSeries = (index, key, value) => set(
        'series',
        (cfg.series || []).map((series, i) => (i === index ? { ...series, [key]: value } : series)),
    );
    const stepSize = (key, delta) => {
        const min = key === 'w' ? minW : minH;
        const max = key === 'w' ? GRID_COLS : MAX_ROWS;
        onChange?.({ ...widget, [key]: clamp((widget[key] || min) + delta, min, max) });
    };

    const countsLines = kind === 'logs';
    const countKey = countsLines ? 'lines' : 'limit';
    const countValue = countsLines ? (cfg.lines || 60) : (cfg.limit || 6);
    const stepCount = (direction) => {
        const step = countsLines ? LINE_STEP : 1;
        const floor = countsLines ? LINE_MIN : ROW_MIN;
        set(countKey, Math.max(floor, countValue + step * direction));
    };

    // Real board geometry, so stepping the size steppers moves the preview by
    // the same amount the board would.
    const previewStyle = {
        width: Math.max(1, widget.w) * PREVIEW_STEP - GRID_GAP,
        height: Math.max(1, widget.h) * GRID_ROW + (Math.max(1, widget.h) - 1) * GRID_GAP,
    };

    return (
        <Drawer
            flush
            open
            onOpenChange={(next) => { if (!next) onClose?.(); }}
            title={title}
            subtitle={t('app.widgetEditor.cells', '{{value}} · {{w}}×{{h}} cells', { value: type?.name || kind, w: widget.w, h: widget.h })}
            icon={<Icon size={18} aria-hidden="true" />}
            // ds/Drawer caps itself at 95vw, so the effective width is
            // min(1100px, 95vw) — a hair under the 96vw asked for, and the
            // cap is shared with every other drawer in the app.
            width="min(1100px, 96vw)"
            className="skwe-drawer"
        >
            <div className="skwe-edit">
                <div className="skwe-edit__cols">
                    <section className="skwe-edit__preview" aria-label={t('common.labels.livePreview', 'Live preview')}>
                        <div className="skwe-edit__stage">
                            {/* Same chrome the board draws, driven by the same
                                renderer — so "preview" costs no second
                                implementation and cannot lie. */}
                            <div className="skw-frame skwe-edit__frame" style={previewStyle}>
                                <div className="skw-frame__head">
                                    <span className="skw-frame__title">{title}</span>
                                </div>
                                <div className="skw-frame__body">
                                    <WidgetBody widget={widget} ctx={ctx} />
                                </div>
                            </div>
                        </div>
                        {/* No pixel figure here: a widget wider than the stage
                            is capped by max-width, so quoting its board size
                            would describe something the operator isn't seeing. */}
                        <div className="skwe-edit__caption">
                            {t('app.widgetEditor.livePreview2', 'live preview ·')} {widget.w}×{widget.h} {t('app.widgetEditor.of12Columns', 'of 12 columns')}
                        </div>
                    </section>

                    <section className="skwe-edit__pane" aria-label={t('app.widgetEditor.widgetSettings', 'Widget settings')}>
                        <Group title={t('app.widgetEditor.widget', 'Widget')}>
                            <Field label={t('common.labels.title', 'Title')}>
                                <input
                                    type="text"
                                    className="skwe-edit__field"
                                    aria-label={t('app.widgetEditor.widgetTitle', 'Widget title')}
                                    placeholder={deriveWidgetTitle({ ...widget, cfg: { ...cfg, title: '' } }, type)}
                                    value={cfg.title || ''}
                                    onChange={(event) => set('title', event.target.value)}
                                />
                            </Field>
                        </Group>

                        {CONFIGURABLE_TYPES.includes(kind) && (
                            <Group title={t('app.widgetEditor.data', 'Data')}>
                                {RESOURCE_TYPES.includes(kind) && (multiResource ? (
                                    <Field label={t('app.widgetEditor.resource', 'Resource')}>
                                        <Select
                                            label={t('app.widgetEditor.resource', 'Resource')}
                                            value={cfg.resource || '$server'}
                                            onChange={(value) => set('resource', value)}
                                            options={resourceOptions}
                                        />
                                    </Field>
                                ) : (
                                    <Field label={t('app.widgetEditor.resource', 'Resource')} hint={t('app.widgetEditor.oneMachineIsConnectedSoThis', 'One server is connected, so this widget reads it.')}>
                                        <div className="skwe-edit__static">{resolvedResource(cfg.resource)}</div>
                                    </Field>
                                ))}

                                {['stat', 'gauge'].includes(kind) && (
                                    <Field label={t('app.widgetEditor.metric', 'Metric')}>
                                        <Select
                                            label={t('app.widgetEditor.metric', 'Metric')}
                                            value={cfg.metric || 'cpu'}
                                            onChange={(value) => set('metric', value)}
                                            options={metricOptionsFor(cfg.resource, cfg.metric || 'cpu')}
                                        />
                                    </Field>
                                )}

                                {['stat', 'gauge', 'topn'].includes(kind) && (
                                    <Field label={t('app.widgetEditor.aggregation', 'Aggregation')}>
                                        <SegControl
                                            options={toOptions(AGGREGATIONS)}
                                            value={cfg.agg || 'last'}
                                            onChange={(value) => set('agg', value)}
                                        />
                                    </Field>
                                )}

                                {['stat', 'gauge'].includes(kind) && (
                                    <Field label={t('app.widgetEditor.thresholds', 'Thresholds')} hint={t('app.widgetEditor.valueColoursTurnAmberThenRed', 'Value colours turn amber, then red.')}>
                                        <div className="skwe-edit__pair">
                                            {[0, 1].map((index) => (
                                                <div className="skwe-edit__pairitem" key={index}>
                                                    <span className="skwe-edit__unit">{index ? t('app.widgetEditor.redAtLeast', 'red ≥') : t('app.widgetEditor.amberAtLeast', 'amber ≥')}</span>
                                                    <input
                                                        type="number"
                                                        className="skwe-edit__field"
                                                        aria-label={index ? t('app.widgetEditor.redThreshold', 'Red threshold') : t('app.widgetEditor.amberThreshold', 'Amber threshold')}
                                                        value={(cfg.thresholds || [])[index] ?? ''}
                                                        onChange={(event) => {
                                                            const next = [...(cfg.thresholds || [null, null])];
                                                            next[index] = event.target.value === ''
                                                                ? null
                                                                : Number(event.target.value);
                                                            set('thresholds', next);
                                                        }}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </Field>
                                )}

                                {kind === 'stat' && (
                                    <Field label={t('app.widgetEditor.sparkline', 'Sparkline')} inline>
                                        <Switch
                                            checked={cfg.spark !== false}
                                            aria-label={t('app.widgetEditor.showSparkline', 'Show sparkline')}
                                            onCheckedChange={(checked) => set('spark', checked)}
                                        />
                                    </Field>
                                )}

                                {kind === 'timeseries' && (
                                    <>
                                        <Field label={t('app.widgetEditor.series', 'Series')}>
                                            <div className="skwe-edit__series">
                                                {(cfg.series || []).length === 0 && (
                                                    <div className="skwe-edit__empty">
                                                        {t('app.widgetEditor.noSeriesYetTheChartDraws', 'No series yet. The chart draws nothing until you add one.')}
                                                    </div>
                                                )}
                                                {(cfg.series || []).map((series, index) => (
                                                    <div
                                                        // Series have no stable id of their own; the index is
                                                        // the identity the config file itself uses.
                                                        key={index}
                                                        className={`skwe-edit__ser${multiResource ? '' : ' skwe-edit__ser--solo'}`}
                                                    >
                                                        <SeriesColor
                                                            value={series.color}
                                                            fallback={getMetric(series.metric)?.color}
                                                            index={index}
                                                            onChange={(value) => setSeries(index, 'color', value)}
                                                        />
                                                        {multiResource && (
                                                            <Select
                                                                label={t('app.widgetEditor.seriesResource', 'Series {{value}} resource', { value: index + 1 })}
                                                                value={series.resource}
                                                                onChange={(value) => setSeries(index, 'resource', value)}
                                                                options={resourceOptions}
                                                            />
                                                        )}
                                                        <Select
                                                            label={t('app.widgetEditor.seriesMetric', 'Series {{value}} metric', { value: index + 1 })}
                                                            value={series.metric}
                                                            onChange={(value) => setSeries(index, 'metric', value)}
                                                            options={metricOptionsFor(series.resource, series.metric)}
                                                        />
                                                        <SharedButton variant="unstyled"
                                                            type="button"
                                                            className="skwe-edit__del"
                                                            title={t('app.widgetEditor.removeSeries', 'Remove series {{value}}', { value: index + 1 })}
                                                            aria-label={t('app.widgetEditor.removeSeries', 'Remove series {{value}}', { value: index + 1 })}
                                                            onClick={() => set(
                                                                'series',
                                                                (cfg.series || []).filter((_, i) => i !== index),
                                                            )}
                                                        >
                                                            <Trash2 size={13} aria-hidden="true" />
                                                        </SharedButton>
                                                    </div>
                                                ))}
                                                <SharedButton variant="unstyled"
                                                    type="button"
                                                    className="skwe-edit__add"
                                                    onClick={() => set('series', [
                                                        ...(cfg.series || []),
                                                        { resource: '$server', metric: 'cpu' },
                                                    ])}
                                                >
                                                    <Plus size={12} aria-hidden="true" /> {t('app.widgetEditor.addSeries', 'Add series')}
                                                </SharedButton>
                                            </div>
                                        </Field>
                                        <Field label={t('app.widgetEditor.legend', 'Legend')} inline>
                                            <Switch
                                                checked={cfg.legend !== false}
                                                aria-label={t('app.widgetEditor.showLegend', 'Show legend')}
                                                onCheckedChange={(checked) => set('legend', checked)}
                                            />
                                        </Field>
                                        <Field label={t('app.widgetEditor.lineStyle', 'Line style')}>
                                            <SegControl
                                                options={LINE_STYLES.map(([value, label]) => ({ value, label }))}
                                                value={cfg.lineStyle || 'smooth'}
                                                onChange={(value) => set('lineStyle', value)}
                                                aria-label={t('app.widgetEditor.lineStyle', 'Line style')}
                                            />
                                        </Field>
                                        <Field label={t('app.widgetEditor.areaFill', 'Area fill')} inline>
                                            <Switch
                                                checked={cfg.fill !== false}
                                                aria-label={t('app.widgetEditor.fillTheAreaUnderEachSeries', 'Fill the area under each series')}
                                                onCheckedChange={(checked) => set('fill', checked)}
                                            />
                                        </Field>
                                    </>
                                )}

                                {kind === 'topn' && (
                                    <>
                                        <Field label={t('app.widgetEditor.dimension', 'Dimension')}>
                                            <SegControl
                                                options={toOptions(TOPN_DIMENSIONS)}
                                                value={cfg.dim || 'servers'}
                                                onChange={(value) => set('dim', value)}
                                            />
                                        </Field>
                                        {/* Top N always ranks remote resources, so it offers the
                                            server-side catalog whatever the board variable is. */}
                                        <Field label={t('app.widgetEditor.metric', 'Metric')}>
                                            <Select
                                                label={t('app.widgetEditor.metric', 'Metric')}
                                                value={cfg.metric || 'cpu'}
                                                onChange={(value) => set('metric', value)}
                                                options={topnMetricOptions(cfg.metric || 'cpu')}
                                            />
                                        </Field>
                                    </>
                                )}

                                {kind === 'table' && (
                                    <Field label={t('common.labels.source', 'Source')}>
                                        <Select
                                            label={t('common.labels.source', 'Source')}
                                            value={cfg.source || 'services'}
                                            onChange={(value) => set('source', value)}
                                            options={TABLE_SOURCES}
                                        />
                                    </Field>
                                )}

                                {kind === 'logs' && (
                                    <>
                                        {multiResource ? (
                                            <Field label={t('common.labels.source', 'Source')}>
                                                <Select
                                                    label={t('app.widgetEditor.logSource', 'Log source')}
                                                    value={cfg.source || '$server'}
                                                    onChange={(value) => set('source', value)}
                                                    options={resourceOptions}
                                                />
                                            </Field>
                                        ) : (
                                            <Field label={t('common.labels.source', 'Source')} hint={t('app.widgetEditor.oneMachineIsConnectedSoThis2', 'One server is connected, so this widget tails it.')}>
                                                <div className="skwe-edit__static">{resolvedResource(cfg.source)}</div>
                                            </Field>
                                        )}
                                        <Field label={t('app.widgetEditor.level', 'Level')}>
                                            <SegControl
                                                options={toOptions(LOG_LEVELS)}
                                                value={cfg.level || 'all'}
                                                onChange={(value) => set('level', value)}
                                            />
                                        </Field>
                                    </>
                                )}

                                {kind === 'alerts' && (
                                    <Field label={t('common.labels.severity', 'Severity')}>
                                        <SegControl
                                            options={toOptions(SEVERITIES)}
                                            value={cfg.severity || 'all'}
                                            onChange={(value) => set('severity', value)}
                                        />
                                    </Field>
                                )}

                                {['table', 'logs', 'deploys', 'feed'].includes(kind) && (
                                    <Field label={countsLines ? t('app.widgetEditor.lines', 'Lines') : t('app.widgetEditor.rows', 'Rows')}>
                                        <Stepper
                                            label={countsLines ? 'lines' : 'rows'}
                                            value={countValue}
                                            onStep={stepCount}
                                        />
                                    </Field>
                                )}

                                {kind === 'actions' && (
                                    <Field label={t('app.widgetEditor.shortcuts', 'Shortcuts')}>
                                        <div className="skwe-edit__checks">
                                            {QUICK_ACTION_OPTIONS.map(([key, label]) => {
                                                const on = (cfg.items || []).includes(key);
                                                return (
                                                    <label className="skwe-edit__check" key={key}>
                                                        <input
                                                            type="checkbox"
                                                            checked={on}
                                                            onChange={() => set(
                                                                'items',
                                                                on
                                                                    ? (cfg.items || []).filter((item) => item !== key)
                                                                    : [...(cfg.items || []), key],
                                                            )}
                                                        />
                                                        {label}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </Field>
                                )}

                                {kind === 'note' && (
                                    <Field label={t('app.widgetEditor.text', 'Text')} hint={t('app.widgetEditor.boldAndCodeAreSupported', '**bold** and `code` are supported.')}>
                                        <textarea
                                            className="skwe-edit__textarea"
                                            aria-label={t('app.widgetEditor.noteText', 'Note text')}
                                            value={cfg.text || ''}
                                            onChange={(event) => set('text', event.target.value)}
                                        />
                                    </Field>
                                )}
                            </Group>
                        )}

                        <Group title={t('app.widgetEditor.layout', 'Layout')}>
                            <Field label={t('common.labels.size', 'Size')} hint={t('app.widgetEditor.cellsOnThe12ColumnBoard', 'Cells on the 12-column board. The preview follows.')}>
                                <div className="skwe-edit__pair">
                                    <Stepper
                                        label="width"
                                        value={widget.w}
                                        suffix="wide"
                                        onStep={(delta) => stepSize('w', delta)}
                                    />
                                    <Stepper
                                        label="height"
                                        value={widget.h}
                                        suffix="tall"
                                        onStep={(delta) => stepSize('h', delta)}
                                    />
                                </div>
                            </Field>
                        </Group>
                    </section>
                </div>

                <div className="skwe-edit__foot">
                    <SharedButton variant="unstyled" type="button" className="btn btn-sm" onClick={onDuplicate}>
                        <Copy size={13} aria-hidden="true" /> {t('app.widgetEditor.duplicate', 'Duplicate')}
                    </SharedButton>
                    <SharedButton variant="danger" type="button" className="btn btn-sm btn-danger" onClick={onRemove}>
                        <Trash2 size={13} aria-hidden="true" /> {t('common.actions.remove', 'Remove')}
                    </SharedButton>
                    <span className="skwe-edit__spacer" />
                    <SharedButton variant="primary" type="button" className="btn btn-sm btn-primary" onClick={onClose}>
                        {t('common.actions.done', 'Done')}
                    </SharedButton>
                </div>
            </div>
        </Drawer>
    );
}

export default WidgetEditor;
