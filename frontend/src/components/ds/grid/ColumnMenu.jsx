import { useState } from 'react';
import {
    ArrowUp, ArrowDown, Rows3, Check, Filter, Search,
    ChevronLeft, ChevronRight, EyeOff,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import {
    OPS, columnLabel, coerceValue, isFilterable, isGroupable, isSortable,
    optionsFor, ruleId, valueCounts,
} from './fields';
import { Button as SharedButton } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

// The per-column header menu — one popover that owns everything you can do to
// a column, so a toolbar stops being a parking lot of Sort/Columns/Group
// buttons three clicks away from the column they act on:
//
//   Sort A→Z / Z→A            (low→high / high→low for numbers and dates)
//   Group by this field       (enum + bool columns)
//   Filter by <label>         (type-aware: checkbox list, or operator + value)
//   Move left / Move right
//   Hide this field
//
// The props are a FLAT, state-model-agnostic contract on purpose: <DataTable>
// drives it from a `sorts[]` array + `hiddenKeys`, <DataGrid> drives it from a
// single `cfg` object, and neither has to know about the other. Radix Popover
// does the portalling and collision flipping, so a menu on the last column
// needs none of the "align right when near the edge" guesswork.
export function ColumnMenu({
    column,
    rows,               // the UNFILTERED set — option counts must not collapse
                        // to zero as you tick boxes in this very menu
    sortDir = null,     // 'asc' | 'desc' | null — this column's current sort
    grouped = false,
    rule = null,        // this column's active filter rule, if any
    canMoveLeft = false,
    canMoveRight = false,
    canHide = true,
    onSort,
    onToggleGroup,
    onPutRule,
    onMove,
    onHide,
    open,
    onOpenChange,
}) {
    const { t } = useTranslation();
    const label = columnLabel(column);
    const type = column.type;
    const isEnumish = type === 'enum' || type === 'bool';
    const filterable = isFilterable(column) && !!onPutRule;

    const [draft, setDraft] = useState(
        rule && !isEnumish ? String(rule.value ?? '') : '',
    );

    const ordered = type === 'num' || type === 'date';
    const counts = isEnumish ? valueCounts(rows, column) : null;
    const options = isEnumish ? optionsFor(rows, column) : [];
    const picked = rule?.op === 'any' || rule?.op === 'none' ? rule.value : [];

    const writeRule = (next) => onPutRule(column.key, next);

    const toggleOption = (option) => {
        if (type === 'bool') {
            const on = rule && String(rule.value) === option;
            writeRule(on ? null : {
                id: rule?.id || ruleId(), field: column.key, op: 'is', value: option === 'true',
            });
            return;
        }
        const next = picked.includes(option)
            ? picked.filter((v) => v !== option)
            : [...picked, option];
        writeRule(next.length ? {
            id: rule?.id || ruleId(),
            field: column.key,
            op: rule?.op || 'any',
            value: next,
        } : null);
    };

    const writeValue = (raw, op) => {
        setDraft(raw);
        writeRule(raw === '' ? null : {
            id: rule?.id || ruleId(),
            field: column.key,
            op: op || rule?.op || OPS[type][0][0],
            value: coerceValue(type, raw),
        });
    };

    const canSort = isSortable(column) && !!onSort;
    const canGroup = isGroupable(column) && !!onToggleGroup;
    const canMove = !!onMove && (canMoveLeft || canMoveRight);
    const canHideHere = canHide && !!onHide && !column.locked && column.hideable !== false;

    // Nothing to offer (a decorative column) — render no trigger at all rather
    // than an empty popover.
    if (!canSort && !canGroup && !filterable && !canMove && !canHideHere) return null;

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <SharedButton variant="unstyled"
                    type="button"
                    className="sk-colmenu-btn"
                    aria-label={t('app.columnMenu.columnOptions', '{{label}} column options', { label: label })}
                    onClick={(e) => { e.stopPropagation(); }}
                >
                    <span className="sk-colmenu-btn__dots" aria-hidden="true" />
                </SharedButton>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={6}
                collisionPadding={12}
                className="ui-popover-panel sk-gridmenu"
                onClick={(e) => e.stopPropagation()}
            >
                {canSort && (
                    <>
                        <SharedButton variant="unstyled"
                            type="button"
                            className={cn('sk-gridmenu__opt', sortDir === 'asc' && 'is-on')}
                            onClick={() => { onSort(column.key, 'asc'); onOpenChange(false); }}
                        >
                            <ArrowUp size={13} />
                            {ordered ? 'Sort low to high' : 'Sort A to Z'}
                        </SharedButton>
                        <SharedButton variant="unstyled"
                            type="button"
                            className={cn('sk-gridmenu__opt', sortDir === 'desc' && 'is-on')}
                            onClick={() => { onSort(column.key, 'desc'); onOpenChange(false); }}
                        >
                            <ArrowDown size={13} />
                            {ordered ? 'Sort high to low' : 'Sort Z to A'}
                        </SharedButton>
                    </>
                )}

                {canGroup && (
                    <SharedButton variant="unstyled"
                        type="button"
                        className={cn('sk-gridmenu__opt', grouped && 'is-on')}
                        onClick={() => { onToggleGroup(column.key); onOpenChange(false); }}
                    >
                        <Rows3 size={13} />
                        {grouped ? 'Remove grouping' : 'Group by this field'}
                    </SharedButton>
                )}

                {filterable && (
                    <>
                        {(canSort || canGroup) && <div className="sk-gridmenu__sep" />}
                        <div className="sk-gridmenu__head">{`Filter by ${label}`}</div>

                        {isEnumish ? (
                            <div className="sk-gridmenu__scroll">
                                {type === 'enum' && (
                                    <Select
                                        value={rule?.op || 'any'}
                                        onValueChange={(op) => rule && writeRule({ ...rule, op })}
                                    >
                                        <SelectTrigger
                                            size="sm"
                                            className="sk-gridmenu__op"
                                            aria-label={t('app.columnMenu.filterOperator', '{{label}} filter operator', { label: label })}
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {OPS.enum.map(([op, text]) => (
                                                <SelectItem key={op} value={op}>{text}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                )}
                                {options.map((option) => {
                                    const on = type === 'bool'
                                        ? !!rule && String(rule.value) === option
                                        : picked.includes(option);
                                    const text = type === 'bool' ? (option === 'true' ? 'On' : 'Off') : option;
                                    return (
                                        <SharedButton variant="unstyled"
                                            key={option}
                                            type="button"
                                            className={cn('sk-gridmenu__opt', on && 'is-on')}
                                            onClick={() => toggleOption(option)}
                                            aria-pressed={on}
                                        >
                                            <span className="sk-gridmenu__box"><Check size={11} /></span>
                                            <span className="sk-gridmenu__val">{text}</span>
                                            <span className="sk-gridmenu__rest">{counts.get(option) || 0}</span>
                                        </SharedButton>
                                    );
                                })}
                            </div>
                        ) : (
                            <>
                                <Select
                                    value={rule?.op || OPS[type][0][0]}
                                    onValueChange={(op) => writeValue(draft, op)}
                                >
                                    <SelectTrigger
                                        size="sm"
                                        className="sk-gridmenu__op"
                                        aria-label={t('app.columnMenu.filterOperator', '{{label}} filter operator', { label: label })}
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {OPS[type].map(([op, text]) => (
                                            <SelectItem key={op} value={op}>{text}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <div className="sk-gridmenu__mini sk-gridmenu__mini--input">
                                    {type === 'num' ? <Filter size={13} /> : <Search size={13} />}
                                    <input
                                        autoFocus
                                        type={type === 'num' ? 'number' : type === 'date' ? 'date' : 'text'}
                                        value={draft}
                                        placeholder={type === 'num' ? 'value' : t('app.columnMenu.enterValue', 'Enter value')}
                                        aria-label={t('app.columnMenu.filterValue', '{{label}} filter value', { label: label })}
                                        onChange={(e) => writeValue(e.target.value)}
                                    />
                                </div>
                                {!!column.quick?.length && (
                                    <div className="sk-gridmenu__quick">
                                        {column.quick.map((q) => (
                                            <SharedButton variant="unstyled"
                                                key={q.label}
                                                type="button"
                                                onClick={() => writeValue(String(q.value), q.op)}
                                            >
                                                {q.label}
                                            </SharedButton>
                                        ))}
                                    </div>
                                )}
                            </>
                        )}
                    </>
                )}

                {(canMove || canHideHere) && <div className="sk-gridmenu__sep" />}
                {canMove && (
                    <>
                        <SharedButton variant="unstyled"
                            type="button"
                            className="sk-gridmenu__opt"
                            disabled={!canMoveLeft}
                            onClick={() => { onMove(column.key, -1); onOpenChange(false); }}
                        >
                            <ChevronLeft size={13} />{t('app.columnMenu.moveLeft', 'Move left')}
                        </SharedButton>
                        <SharedButton variant="unstyled"
                            type="button"
                            className="sk-gridmenu__opt"
                            disabled={!canMoveRight}
                            onClick={() => { onMove(column.key, 1); onOpenChange(false); }}
                        >
                            <ChevronRight size={13} />{t('app.columnMenu.moveRight', 'Move right')}
                        </SharedButton>
                    </>
                )}
                {canHideHere && (
                    <SharedButton variant="unstyled"
                        type="button"
                        className="sk-gridmenu__opt"
                        onClick={() => { onHide(column.key); onOpenChange(false); }}
                    >
                        <EyeOff size={13} />{t('app.columnMenu.hideThisField', 'Hide this field')}
                    </SharedButton>
                )}

                {filterable && (
                    <div className="sk-gridmenu__foot">
                        <SharedButton variant="unstyled"
                            type="button"
                            onClick={() => { writeRule(null); setDraft(''); }}
                            disabled={!rule}
                        >
                            {t('app.columnMenu.clearFilter', 'Clear filter')}
                        </SharedButton>
                        <SharedButton variant="unstyled" type="button" className="is-primary" onClick={() => onOpenChange(false)}>
                            {t('common.actions.done', 'Done')}
                        </SharedButton>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}

export default ColumnMenu;
