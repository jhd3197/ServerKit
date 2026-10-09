import { useMemo, useState } from 'react';
import { Check, ChevronDown, Server } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from './ui/button';
import {
    Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from './ui/command';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { useResourceOptions } from '../hooks/useResourceOptions';
import { normalizeResourceRef, resourceKey } from '../utils/resourceRefs';

const normalizeList = (options) => options.map(normalizeResourceRef).filter(Boolean);
const allowOption = () => true;
const preserveOption = (option) => option;

export default function ResourcePicker({
    value,
    onChange,
    types,
    scope,
    capabilities,
    staticOptions = [],
    filterOption = allowOption,
    decorateOption = preserveOption,
    icon: ResourceIcon = Server,
    showCapabilities = false,
    disabled = false,
    label,
    placeholder,
    searchPlaceholder,
    emptyMessage,
    className = '',
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const search = useResourceOptions({
        types,
        scope,
        capabilities,
        query,
        enabled: open,
    });
    const normalizedStatic = useMemo(
        () => normalizeList(staticOptions).map(decorateOption),
        [decorateOption, staticOptions],
    );
    const normalizedValue = useMemo(() => {
        const normalized = normalizeResourceRef(value);
        return normalized ? decorateOption(normalized) : null;
    }, [decorateOption, value]);
    const normalizedQuery = query.trim().toLowerCase();
    const visibleStatic = normalizedStatic.filter((option) => (
        filterOption(option)
        && (!normalizedQuery || `${option.label} ${option.sublabel}`.toLowerCase().includes(normalizedQuery))
    ));
    const visibleGroups = search.groups
        .map((group) => ({
            ...group,
            options: group.options.map(decorateOption).filter(filterOption),
        }))
        .filter((group) => group.options.length);
    const hasOptions = visibleStatic.length > 0
        || visibleGroups.some((group) => group.options.length > 0);

    const select = (option) => {
        if ((types || []).includes(option.type)) search.recordSelection(option);
        onChange(option);
        setOpen(false);
        setQuery('');
    };

    const renderOption = (option) => {
        const selected = normalizedValue
            && resourceKey(normalizedValue) === resourceKey(option);
        return (
            <CommandItem
                key={resourceKey(option)}
                value={resourceKey(option)}
                onSelect={() => select(option)}
            >
                <ResourceIcon className="sk-resource-picker__option-icon" aria-hidden="true" />
                <span className="sk-resource-picker__option-copy">
                    <span>{option.label}</span>
                    {option.sublabel && <small>{option.sublabel}</small>}
                </span>
                {option.status && (
                    <span className={`sk-state sk-state--${option.status}`}>{option.status}</span>
                )}
                {showCapabilities && option.capabilities.slice(0, 2).map((capability) => (
                    <span className="sk-tag" key={capability}>{capability}</span>
                ))}
                {selected && <Check className="sk-resource-picker__check" aria-hidden="true" />}
            </CommandItem>
        );
    };

    const triggerLabel = normalizedValue?.label || placeholder;
    const triggerClassName = ['sk-resource-picker__trigger', className]
        .filter(Boolean).join(' ');

    return (
        <Popover open={open} onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) setQuery('');
        }}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className={triggerClassName}
                    disabled={disabled}
                    aria-label={label}
                    aria-expanded={open}
                >
                    <ResourceIcon aria-hidden="true" />
                    <span>{triggerLabel}</span>
                    <ChevronDown className="sk-resource-picker__chevron" aria-hidden="true" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="sk-resource-picker__popover" align="start">
                <Command shouldFilter={false} label={label}>
                    <CommandInput
                        value={query}
                        onValueChange={setQuery}
                        placeholder={searchPlaceholder}
                    />
                    <CommandList>
                        {visibleStatic.length > 0 && (
                            <CommandGroup>{visibleStatic.map(renderOption)}</CommandGroup>
                        )}
                        {visibleGroups.map((group) => (
                            <CommandGroup key={group.id}>{group.options.map(renderOption)}</CommandGroup>
                        ))}
                        {search.isLoading && (
                            <div className="sk-resource-picker__message" role="status">
                                {t('common.state.loading', 'Loading')}
                            </div>
                        )}
                        {search.isError && (
                            <div className="sk-resource-picker__message sk-resource-picker__message--error" role="alert">
                                {t('common.error.failedToLoad', "Couldn't load this.")}
                            </div>
                        )}
                        {!search.isLoading && !search.isError && !hasOptions && (
                            <CommandEmpty>
                                {emptyMessage || t('common.state.noResults', 'No results found')}
                            </CommandEmpty>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
