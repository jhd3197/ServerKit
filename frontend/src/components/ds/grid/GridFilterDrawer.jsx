import { useState } from 'react';
import { Filter, Layers, X, Plus, History, GripVertical } from 'lucide-react';
import { Drawer } from '../Drawer';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import {
    OPS, applyFilters, byKey, columnLabel, coerceValue, emptyValueFor,
    isDecorative, isFilterable, isSortable, optionsFor,
} from './fields';

// Two panes behind one drawer, because they are the two halves of "what am I
// looking at": FILTERS decides which rows, FIELDS decides which columns (and in
// what order, at what density, with which detail line). The header menu is the
// fast path for one column; this is the whole picture at once.
//
// The pane switch IS the drawer's header: a title saying "Filters and fields"
// above tabs reading "Filters" and "Fields" only repeated them. The footer
// answers the question a filter always raises: how many rows are left.
export function GridFilterDrawer({
    open, onOpenChange, columns, rows, cfg, grid, noun = 'rows',
    // Hosts whose table auto-sizes its columns and has no sub-detail line
    // (i.e. <DataTable> rather than <DataGrid>) switch these off — a control
    // that cannot change anything is worse than a missing one.
    showRowDetail = true,
    showDensity = true,
}) {
    const { t } = useTranslation();
    const [tab, setTab] = useState('filters');
    const [dragging, setDragging] = useState(null);

    const map = byKey(columns);
    const rules = cfg.filters.rules;
    const filterable = columns.filter(isFilterable);
    // A rule can outlive its column's filterability (a saved view from before
    // a column changed shape); those are skipped everywhere below.
    const liveRules = rules.filter((rule) => isFilterable(map.get(rule.field)));
    const allRows = rows || [];
    const total = allRows.length;
    const matching = applyFilters(allRows, cfg.filters, columns).length;
    const singular = noun.replace(/s$/, '');
    const nounFor = (count) => (count === 1 ? singular : noun);
    // Action / chevron columns have no name and nothing to toggle, so they are
    // neither listed nor counted.
    const namedColumns = columns.filter((column) => !isDecorative(column));
    const shownCount = cfg.cols.filter((key) => !isDecorative(map.get(key))).length;
    const hiddenCount = namedColumns.length - shownCount;

    const patchRule = (id, patch) => grid.setRules(
        rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );

    // Visible columns first (in their real order), then the hidden ones — so
    // dragging inside the list and toggling a switch are the same mental model.
    const ordered = [...cfg.cols, ...columns.map((c) => c.key).filter((k) => !cfg.cols.includes(k))];
    const allKeys = columns.map((c) => c.key);

    const moveTo = (from, to) => {
        const list = [...ordered];
        const [moved] = list.splice(from, 1);
        list.splice(to, 0, moved);
        grid.setColumnOrder(list.filter((k) => cfg.cols.includes(k)));
    };

    const valueEditor = (rule) => {
        const column = map.get(rule.field);
        if (!column) return null;
        if (column.type === 'bool') {
            return (
                <Select
                    value={String(rule.value)}
                    onValueChange={(v) => patchRule(rule.id, { value: v === 'true' })}
                >
                    <SelectTrigger size="sm" className="sk-gridrule__sel" aria-label={t('common.labels.value', 'Value')}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="true">On</SelectItem>
                        <SelectItem value="false">{t('app.gridFilterDrawer.off', 'Off')}</SelectItem>
                    </SelectContent>
                </Select>
            );
        }
        if (column.type === 'enum') {
            const selected = Array.isArray(rule.value) ? rule.value : [];
            return (
                <div className="sk-gridrule__enum">
                    {optionsFor(rows, column).map((option) => {
                        const on = selected.includes(option);
                        return (
                            <Button variant="unstyled"
                                key={option}
                                type="button"
                                className={cn('sk-gridrule__tag', on && 'is-on')}
                                onClick={() => patchRule(rule.id, {
                                    value: on ? selected.filter((v) => v !== option) : [...selected, option],
                                })}
                            >
                                {option}
                            </Button>
                        );
                    })}
                </div>
            );
        }
        return (
            <input
                type={column.type === 'num' ? 'number' : column.type === 'date' ? 'date' : 'text'}
                value={rule.value ?? ''}
                placeholder="value"
                aria-label={t('common.labels.value', 'Value')}
                onChange={(e) => patchRule(rule.id, { value: coerceValue(column.type, e.target.value) })}
            />
        );
    };

    const panes = [
        { key: 'filters', icon: Filter, label: t('app.gridFilterDrawer.filters', 'Filters'), count: liveRules.length || null },
        {
            key: 'fields',
            icon: Layers,
            label: t('app.gridFilterDrawer.fieldsTab', 'Fields'),
            // Only worth a badge when something is hidden.
            count: hiddenCount > 0 ? `${shownCount}/${namedColumns.length}` : null,
        },
    ];

    return (
        <Drawer
            open={open}
            onOpenChange={onOpenChange}
            title={t('app.gridFilterDrawer.filtersFields', 'Filters and fields')}
            headless
            width={470}
            flush
            className="sk-griddrawer"
        >
            <div className="sk-griddrawer__head">
                <div className="sk-gridseg sk-griddrawer__switch" role="tablist" aria-label={t('app.gridFilterDrawer.filtersFields', 'Filters and fields')}>
                    {panes.map(({ key, icon: Icon, label, count }) => (
                        <Button variant="unstyled"
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={tab === key}
                            className={cn(tab === key && 'is-on')}
                            onClick={() => setTab(key)}
                        >
                            <Icon size={14} aria-hidden="true" />{label}
                            {count != null && <span className="sk-griddrawer__n">{count}</span>}
                        </Button>
                    ))}
                </div>
            </div>

            <div className="sk-griddrawer__body">
                {tab === 'filters' && (
                    <div className="sk-gridsec">
                        {liveRules.length === 0 ? (
                            <div className="sk-gridstart">
                                <p className="sk-gridstart__lead">
                                    {t('app.gridFilterDrawer.nothingFiltered', {
                                        count: total,
                                        noun: nounFor(total),
                                        defaultValue_one: 'The only {{noun}} is showing.',
                                        defaultValue_other: 'All {{count}} {{noun}} are showing.',
                                    })}
                                </p>
                                {filterable.length > 0 && (
                                    <>
                                        <div className="sk-gridsec__t">{t('app.gridFilterDrawer.filterBy', 'Filter by')}</div>
                                        <div className="sk-gridsec__tags">
                                            {filterable.map((column) => (
                                                <Button variant="unstyled"
                                                    key={column.key}
                                                    type="button"
                                                    className="sk-gridrule__tag sk-gridstart__field"
                                                    onClick={() => grid.addRule([column])}
                                                >
                                                    <Plus size={12} aria-hidden="true" />{columnLabel(column)}
                                                </Button>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        ) : (
                            <>
                                {liveRules.map((rule, i) => {
                                    const column = map.get(rule.field);
                                    return (
                                        <div key={rule.id}>
                                            {i > 0 && (
                                                // The word between two conditions is the switch for how
                                                // they combine; it applies to the whole list.
                                                <div className="sk-gridrule__join">
                                                    <div className="sk-gridseg" role="group" aria-label={t('app.gridFilterDrawer.combine', 'How conditions combine')}>
                                                        {[
                                                            ['all', t('app.gridFilterDrawer.and', 'and')],
                                                            ['any', t('app.gridFilterDrawer.or', 'or')],
                                                        ].map(([value, text]) => (
                                                            <Button variant="unstyled"
                                                                key={value}
                                                                type="button"
                                                                aria-pressed={cfg.filters.match === value}
                                                                className={cn(cfg.filters.match === value && 'is-on')}
                                                                onClick={() => grid.setMatch(value)}
                                                            >
                                                                {text}
                                                            </Button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            <div className="sk-gridrule">
                                                <Select
                                                    value={rule.field}
                                                    onValueChange={(key) => {
                                                        const next = map.get(key);
                                                        patchRule(rule.id, {
                                                            field: next.key,
                                                            op: OPS[next.type][0][0],
                                                            value: emptyValueFor(next.type),
                                                        });
                                                    }}
                                                >
                                                    <SelectTrigger size="sm" className="sk-gridrule__sel" aria-label={t('app.gridFilterDrawer.field', 'Field')}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {filterable.map((c) => (
                                                            <SelectItem key={c.key} value={c.key}>{columnLabel(c)}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Select
                                                    value={rule.op}
                                                    onValueChange={(op) => patchRule(rule.id, { op })}
                                                >
                                                    <SelectTrigger size="sm" className="sk-gridrule__sel" aria-label={t('app.gridFilterDrawer.operator', 'Operator')}>
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {OPS[column.type].map(([op, text]) => (
                                                            <SelectItem key={op} value={op}>{text}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                                <Button variant="unstyled"
                                                    type="button"
                                                    className="sk-gridrule__del"
                                                    onClick={() => grid.removeRule(rule.id)}
                                                    aria-label={t('app.gridFilterDrawer.removeCondition', 'Remove condition')}
                                                >
                                                    <X size={14} />
                                                </Button>
                                                <div className="sk-gridrule__value">{valueEditor(rule)}</div>
                                            </div>
                                        </div>
                                    );
                                })}
                                <Button variant="unstyled" type="button" className="sk-gridsec__add" onClick={() => grid.addRule(columns)}>
                                    <Plus size={13} aria-hidden="true" />{t('app.gridFilterDrawer.addCondition', 'Add condition')}
                                </Button>
                            </>
                        )}
                    </div>
                )}

                {tab === 'fields' && (
                    <>
                        <div className="sk-gridsec">
                            <div className="sk-gridsec__head">
                                <div className="sk-gridsec__t">{t('app.gridFilterDrawer.columns', 'Columns')}</div>
                                <span className="sk-gridsec__meta">
                                    {t('app.gridFilterDrawer.shownOf', '{{shown}} of {{total}} shown', { shown: shownCount, total: namedColumns.length })}
                                </span>
                            </div>
                            {ordered.map((key, i) => {
                                const column = map.get(key);
                                if (!column || isDecorative(column)) return null;
                                const on = cfg.cols.includes(key);
                                const locked = !!column.locked || column.hideable === false;
                                return (
                                    <div
                                        key={key}
                                        draggable={!locked && on}
                                        className={cn('sk-gridcol', !on && 'is-off', locked && 'is-locked', dragging === i && 'is-drag')}
                                        onDragStart={() => setDragging(i)}
                                        onDragEnd={() => setDragging(null)}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            if (dragging != null && dragging !== i) { moveTo(dragging, i); setDragging(i); }
                                        }}
                                    >
                                        <span className="sk-gridcol__grip"><GripVertical size={13} /></span>
                                        <span className="sk-gridcol__nm">{columnLabel(column)}</span>
                                        {locked
                                            ? <span className="sk-gridcol__lock">{t('app.gridFilterDrawer.pinned', 'pinned')}</span>
                                            : (
                                                <Switch
                                                    checked={on}
                                                    onCheckedChange={() => grid.toggleColumn(key, allKeys)}
                                                    aria-label={t('app.gridFilterDrawer.show', 'Show {{value}}', { value: columnLabel(column) })}
                                                />
                                            )}
                                    </div>
                                );
                            })}
                        </div>

                        {(showRowDetail || showDensity) && (
                        <div className="sk-gridsec">
                            {showRowDetail && (
                            <>
                            <div className="sk-gridsec__head"><div className="sk-gridsec__t">{t('app.gridFilterDrawer.rowDetail', 'Row detail')}</div></div>
                            <p className="sk-gridsec__hint">{t('app.gridFilterDrawer.extraFieldsPrintedUnderTheFirst', 'Extra fields printed under the first column.')}</p>
                            <div className="sk-gridsec__tags">
                                {columns.filter((c) => !c.locked && isSortable(c)).map((c) => {
                                    const on = cfg.sub.includes(c.key);
                                    return (
                                        <Button variant="unstyled"
                                            key={c.key}
                                            type="button"
                                            className={cn('sk-gridrule__tag', on && 'is-on')}
                                            onClick={() => grid.setSub(
                                                on ? cfg.sub.filter((k) => k !== c.key) : [...cfg.sub, c.key],
                                            )}
                                        >
                                            {columnLabel(c)}
                                        </Button>
                                    );
                                })}
                            </div>
                            </>
                            )}

                            {showDensity && (
                            <>
                            <div className={`sk-gridsec__head${showRowDetail ? ' sk-gridsec__head--separated' : ''}`}>
                                <div className="sk-gridsec__t">{t('app.gridFilterDrawer.density', 'Density')}</div>
                            </div>
                            <div className="sk-gridseg sk-gridseg--wide">
                                {[['cozy', 'Cozy'], ['compact', 'Compact']].map(([value, text]) => (
                                    <Button variant="unstyled"
                                        key={value}
                                        type="button"
                                        className={cn(cfg.density === value && 'is-on')}
                                        onClick={() => grid.setDensity(value)}
                                    >
                                        {text}
                                    </Button>
                                ))}
                            </div>
                            </>
                            )}
                        </div>
                        )}
                    </>
                )}
            </div>

            <div className="sk-griddrawer__foot">
                {/* What the filters leave: the number this drawer exists to change. */}
                <span className="sk-griddrawer__count" role="status">
                    {matching === total
                        ? t('app.gridFilterDrawer.countAll', '{{count}} {{noun}}', { count: total, noun: nounFor(total) })
                        : t('app.gridFilterDrawer.countOf', '{{matching}} of {{total}} {{noun}}', { matching, total, noun: nounFor(total) })}
                </span>
                <span className="sk-griddrawer__sp" />
                <Button variant="ghost" size="sm" onClick={grid.resetToView}>
                    <History size={14} /> {t('app.gridFilterDrawer.reset', 'Reset')}
                </Button>
                <Button size="sm" onClick={() => onOpenChange(false)}>{t('common.actions.done', 'Done')}</Button>
            </div>
        </Drawer>
    );
}

export default GridFilterDrawer;
