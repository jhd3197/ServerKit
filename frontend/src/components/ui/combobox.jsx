import * as React from 'react';
import { Check, ChevronsUpDown, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
    Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useFieldProps } from '@/components/ui/field-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Styling lives in styles/components/_controls.scss (.ui-combobox*).

// Chips shown in a multi trigger before the rest collapse into "+N".
const DEFAULT_MAX_CHIPS = 3;

function groupOptions(options) {
    const groups = [];
    const byName = new Map();
    for (const option of options) {
        const name = option.group || '';
        if (!byName.has(name)) {
            const group = { name, options: [] };
            byName.set(name, group);
            groups.push(group);
        }
        byName.get(name).options.push(option);
    }
    return groups;
}

function OptionIcon({ icon: Icon }) {
    if (!Icon) return null;
    if (React.isValidElement(Icon)) return <span className="ui-combobox__option-icon">{Icon}</span>;
    return <Icon className="ui-combobox__option-icon" aria-hidden="true" />;
}

/**
 * Searchable select for one value or many.
 *
 *   <Combobox options={servers} value={id} onChange={setId} placeholder="Pick a server" />
 *   <Combobox multiple options={scopes} value={picked} onChange={setPicked} />
 *   <Combobox multiple creatable options={tags} value={tags} onChange={setTags} />
 *
 * Options are `{ value, label, description?, icon?, group?, disabled? }`;
 * `group` buckets them under a heading in the order they first appear.
 * Single mode closes on pick; multiple stays open and toggles. `creatable`
 * offers the typed text as a new value (calls `onCreate(text)` when given,
 * otherwise adds the text itself). Search matches label, description and
 * value. For server-side search pass `onSearch` and filter `options` yourself.
 */
const Combobox = React.forwardRef(({
    options = [],
    value,
    onChange,
    multiple = false,
    creatable = false,
    onCreate,
    onSearch,
    clearable = true,
    placeholder,
    searchPlaceholder,
    emptyMessage,
    loading = false,
    disabled = false,
    size,
    maxChips = DEFAULT_MAX_CHIPS,
    className,
    ...props
}, ref) => {
    const { t } = useTranslation();
    const fieldProps = useFieldProps(props);
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');

    const selectedValues = multiple ? (value || []) : (value == null || value === '' ? [] : [value]);
    const selectedSet = new Set(selectedValues.map(String));
    const byValue = new Map(options.map((option) => [String(option.value), option]));
    const selectedOptions = selectedValues.map((v) => byValue.get(String(v)) || { value: v, label: String(v) });
    const trimmed = query.trim();
    const exactMatch = trimmed && options.some((option) => option.label.toLowerCase() === trimmed.toLowerCase());
    const canCreate = creatable && trimmed && !exactMatch && !selectedSet.has(trimmed);

    const changeQuery = (next) => {
        setQuery(next);
        onSearch?.(next);
    };

    const setOpenState = (next) => {
        setOpen(next);
        if (!next) changeQuery('');
    };

    const toggle = (option) => {
        if (!multiple) {
            onChange?.(option.value);
            setOpenState(false);
            return;
        }
        const key = String(option.value);
        onChange?.(selectedSet.has(key)
            ? selectedValues.filter((v) => String(v) !== key)
            : [...selectedValues, option.value]);
    };

    const create = () => {
        if (onCreate) onCreate(trimmed);
        else if (multiple) onChange?.([...selectedValues, trimmed]);
        else onChange?.(trimmed);
        changeQuery('');
        if (!multiple) setOpenState(false);
    };

    const remove = (option) => {
        onChange?.(selectedValues.filter((v) => String(v) !== String(option.value)));
    };

    const clear = () => onChange?.(multiple ? [] : null);

    const single = !multiple && selectedOptions[0];
    const hiddenCount = Math.max(0, selectedOptions.length - maxChips);
    const showClear = clearable && !disabled && selectedOptions.length > 0;

    return (
        <Popover open={open} onOpenChange={setOpenState}>
            <PopoverAnchor asChild>
                <div
                    className={cn(
                        'ui-combobox',
                        size === 'sm' && 'ui-combobox--sm',
                        multiple && 'ui-combobox--multiple',
                        fieldProps['aria-invalid'] && 'is-invalid',
                        disabled && 'is-disabled',
                        className,
                    )}
                    // The chip row is part of the control: a click on its
                    // empty space opens the list like the trigger does.
                    onClick={(event) => {
                        if (event.target === event.currentTarget && !disabled) setOpenState(true);
                    }}
                >
                    {multiple && selectedOptions.slice(0, maxChips).map((option) => (
                        <span key={String(option.value)} className="ui-combobox__chip">
                            <OptionIcon icon={option.icon} />
                            <span className="ui-combobox__chip-label">{option.label}</span>
                            {!disabled && (
                                <Button variant="unstyled"
                                    type="button"
                                    className="ui-combobox__chip-remove"
                                    aria-label={t('common.controls.removeItem', 'Remove {{label}}', { label: option.label })}
                                    onClick={() => remove(option)}
                                >
                                    <X aria-hidden="true" />
                                </Button>
                            )}
                        </span>
                    ))}
                    {multiple && hiddenCount > 0 && (
                        <span className="ui-combobox__more">
                            {t('common.controls.moreCount', '+{{count}}', { count: hiddenCount })}
                        </span>
                    )}
                    <PopoverTrigger asChild>
                        <Button variant="unstyled"
                            ref={ref}
                            type="button"
                            role="combobox"
                            aria-expanded={open}
                            aria-haspopup="listbox"
                            disabled={disabled}
                            className="ui-combobox__trigger"
                            {...fieldProps}
                        >
                            {single ? (
                                <span className="ui-combobox__value">
                                    <OptionIcon icon={single.icon} />
                                    <span className="ui-combobox__value-label">{single.label}</span>
                                </span>
                            ) : (
                                (!multiple || selectedOptions.length === 0) && (
                                    <span className="ui-combobox__placeholder">
                                        {placeholder || t('common.controls.select', 'Select…')}
                                    </span>
                                )
                            )}
                            <ChevronsUpDown className="ui-combobox__chevron" aria-hidden="true" />
                        </Button>
                    </PopoverTrigger>
                    {showClear && (
                        <Button variant="unstyled"
                            type="button"
                            className="ui-combobox__clear"
                            aria-label={t('common.controls.clearSelection', 'Clear selection')}
                            onClick={clear}
                        >
                            <X aria-hidden="true" />
                        </Button>
                    )}
                </div>
            </PopoverAnchor>
            <PopoverContent className="ui-combobox__panel" align="start" sideOffset={4}>
                <Command shouldFilter={!onSearch} loop>
                    <CommandInput
                        value={query}
                        onValueChange={changeQuery}
                        placeholder={searchPlaceholder || t('common.controls.search', 'Search…')}
                    />
                    <CommandList>
                        {loading && (
                            <div className="ui-combobox__message" role="status">
                                {t('common.state.loading', 'Loading')}
                            </div>
                        )}
                        {!loading && (
                            <CommandEmpty>
                                {emptyMessage || t('common.state.noResults', 'No results found')}
                            </CommandEmpty>
                        )}
                        {groupOptions(options).map((group) => (
                            <CommandGroup key={group.name || '_'} heading={group.name || undefined}>
                                {group.options.map((option) => {
                                    const selected = selectedSet.has(String(option.value));
                                    return (
                                        <CommandItem
                                            key={String(option.value)}
                                            value={String(option.value)}
                                            keywords={[option.label, option.description].filter(Boolean)}
                                            disabled={option.disabled}
                                            onSelect={() => toggle(option)}
                                            className="ui-combobox__option"
                                            data-checked={selected || undefined}
                                        >
                                            {multiple && (
                                                <span className="ui-combobox__checkbox" aria-hidden="true">
                                                    {selected && <Check />}
                                                </span>
                                            )}
                                            <OptionIcon icon={option.icon} />
                                            <span className="ui-combobox__option-copy">
                                                <span>{option.label}</span>
                                                {option.description && <small>{option.description}</small>}
                                            </span>
                                            {!multiple && selected && (
                                                <Check className="ui-combobox__check" aria-hidden="true" />
                                            )}
                                        </CommandItem>
                                    );
                                })}
                            </CommandGroup>
                        ))}
                        {canCreate && (
                            <CommandGroup forceMount>
                                <CommandItem
                                    forceMount
                                    value={`__create__${trimmed}`}
                                    onSelect={create}
                                    className="ui-combobox__option ui-combobox__create"
                                >
                                    <Plus className="ui-combobox__option-icon" aria-hidden="true" />
                                    <span>{t('common.controls.createValue', 'Create “{{value}}”', { value: trimmed })}</span>
                                </CommandItem>
                            </CommandGroup>
                        )}
                    </CommandList>
                    {multiple && selectedOptions.length > 0 && (
                        <div className="ui-combobox__footer">
                            <span>{t('common.controls.selectedCount', '{{count}} selected', { count: selectedOptions.length })}</span>
                            <Button variant="unstyled" type="button" className="ui-combobox__footer-action" onClick={clear}>
                                {t('common.controls.clearAll', 'Clear all')}
                            </Button>
                        </div>
                    )}
                </Command>
            </PopoverContent>
        </Popover>
    );
});
Combobox.displayName = 'Combobox';

export { Combobox };
