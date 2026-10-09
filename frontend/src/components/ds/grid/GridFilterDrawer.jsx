import { useState } from 'react';
import { Filter, Layers, X, Plus, History, GripVertical } from 'lucide-react';
import { Drawer } from '../Drawer';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import {
    OPS, byKey, columnLabel, coerceValue, emptyValueFor,
    isFilterable, isSortable, optionsFor,
} from './fields';

// Two panes behind one drawer, because they are the two halves of "what am I
// looking at": FILTERS decides which rows, FIELDS decides which columns (and in
// what order, at what density, with which detail line). The header menu is the
// fast path for one column; this is the whole picture at once.
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

    return (
        <Drawer
            open={open}
            onOpenChange={onOpenChange}
            title={t('app.gridFilterDrawer.filtersFields', 'Filters and fields')}
            subtitle={`${t('app.gridFilterDrawer.conditions', { count: rules.length, defaultValue_one: '1 condition', defaultValue_other: '{{count}} conditions' })} · ${t('app.gridFilterDrawer.fieldsShown', { count: cfg.cols.length, defaultValue_one: '1 field shown', defaultValue_other: '{{count}} fields shown' })}`}
            icon={<Filter size={18} />}
            iconColor="var(--accent-bright)"
            width={470}
            flush
            className="sk-griddrawer"
        >
            <div className="sk-griddrawer__tabs">
                {[['filters', Filter, 'Filters', rules.length], ['fields', Layers, 'Fields', cfg.cols.length]]
                    .map(([key, Icon, text, n]) => (
                        <Button variant="unstyled"
                            key={key}
                            type="button"
                            className={cn(tab === key && 'is-on')}
                            onClick={() => setTab(key)}
                        >
                            <Icon size={14} />{text}<span className="n">{n}</span>
                        </Button>
                    ))}
            </div>

            <div className="sk-griddrawer__body">
                {tab === 'filters' && (
                    <div className="sk-gridsec">
                        <div className="sk-gridsec__head">
                            <div className="sk-gridsec__t">{t('app.gridFilterDrawer.conditions', 'Conditions')}</div>
                            <Button variant="unstyled" type="button" className="sk-gridsec__add" onClick={() => grid.addRule(columns)}>
                                <Plus size={13} />{t('app.gridFilterDrawer.addCondition', 'Add condition')}
                            </Button>
                        </div>

                        <div className="sk-gridmatch">
                            {t('app.gridFilterDrawer.match', 'Match')}
                            <div className="sk-gridseg">
                                {['all', 'any'].map((value) => (
                                    <Button variant="unstyled"
                                        key={value}
                                        type="button"
                                        className={cn(cfg.filters.match === value && 'is-on')}
                                        onClick={() => grid.setMatch(value)}
                                    >
                                        {value}
                                    </Button>
                                ))}
                            </div>
                            {t('app.gridFilterDrawer.ofTheFollowing', 'of the following')}
                        </div>

                        {rules.length === 0 && (
                            <div className="sk-gridsec__none">
                                {t('app.gridFilterDrawer.noConditionsThisViewShowsEvery', 'No conditions. This view shows every')} {noun.replace(/s$/, '')}.
                            </div>
                        )}

                        {rules.map((rule, i) => {
                            const column = map.get(rule.field);
                            // A rule can outlive its column's filterability — a
                            // saved view from before a column changed shape, or
                            // a column whose data went empty. Skip it rather
                            // than look up OPS[undefined] and crash the drawer.
                            if (!column || !isFilterable(column)) return null;
                            return (
                                <div key={rule.id}>
                                    {i > 0 && (
                                        <div className="sk-gridrule__join">
                                            {cfg.filters.match === 'all' ? 'and' : 'or'}
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
                    </div>
                )}

                {tab === 'fields' && (
                    <>
                        <div className="sk-gridsec">
                            <div className="sk-gridsec__head">
                                <div className="sk-gridsec__t">{t('app.gridFilterDrawer.fields', 'Fields ·')} {cfg.cols.length} shown</div>
                            </div>
                            {ordered.map((key, i) => {
                                const column = map.get(key);
                                if (!column) return null;
                                const on = cfg.cols.includes(key);
                                const locked = !!column.locked || column.hideable === false;
                                return (
                                    <div
                                        key={key}
                                        draggable={!locked && on}
                                        className={cn('sk-gridcol', !on && 'is-off', dragging === i && 'is-drag')}
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
                                            ? <span className="sk-gridcol__lock">pinned</span>
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
                <Button variant="ghost" size="sm" onClick={grid.resetToView}>
                    <History size={14} /> {t('app.gridFilterDrawer.reset', 'Reset')}
                </Button>
                <span className="sk-griddrawer__sp" />
                <Button size="sm" onClick={() => onOpenChange(false)}>{t('common.actions.done', 'Done')}</Button>
            </div>
        </Drawer>
    );
}

export default GridFilterDrawer;
