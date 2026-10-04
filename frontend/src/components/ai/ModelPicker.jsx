import { useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverTrigger, PopoverContent } from '../ui/popover';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/select';
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '../ui/command';

// Model IDs are opaque: preserve gateway aliases (including slashes) verbatim.
export default function ModelPicker({ id, value, models, onChange, disabled }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('all');
    const choices = [...new Map(models.map((model) => {
        const item = typeof model === 'string' ? { id: model } : model;
        return [item.id, item];
    })).values()].filter((model) => filter === 'all' || model[filter] === true);
    return (
        <div className="sk-model-picker">
            <Input id={id} value={value} maxLength={256} disabled={disabled}
                onChange={(event) => onChange(event.target.value)}
                placeholder={t('ai.connections.modelPlaceholder', 'Model ID or gateway routing alias')} />
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button type="button" variant="outline" disabled={disabled || !models.length}
                        aria-expanded={open} aria-haspopup="dialog">
                        <ChevronsUpDown size={16} />
                        {t('ai.connections.browseModels', 'Browse models ({{count}})', { count: models.length })}
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="sk-model-picker__menu"
                    aria-label={t('ai.connections.chooseModel', 'Choose a model')}>
                    <Command>
                        <CommandInput placeholder={t('ai.connections.searchModels', 'Search models…')} />
                        <div className="sk-model-picker__filters">
                            <label htmlFor={`${id}-filter`}>{t('ai.models.capability', 'Capability')}</label>
                            <Select value={filter} onValueChange={setFilter}>
                                <SelectTrigger id={`${id}-filter`}><SelectValue /></SelectTrigger>
                                {/* The list portals out of the DOM but React still bubbles its
                                    keys to the Command root, where Enter would pick a model. */}
                                <SelectContent onKeyDown={(event) => event.stopPropagation()}>
                                    <SelectItem value="all">{t('ai.models.all', 'All models')}</SelectItem>
                                    <SelectItem value="tools">{t('ai.models.tools', 'Tool calling')}</SelectItem>
                                    <SelectItem value="vision">{t('ai.models.vision', 'Vision')}</SelectItem>
                                    <SelectItem value="reasoning">{t('ai.models.reasoning', 'Reasoning')}</SelectItem>
                                    <SelectItem value="structured">{t('ai.models.structured', 'Structured output')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <CommandList>
                            <CommandEmpty>{t('ai.connections.noModels', 'No matching models. Enter a model ID manually.')}</CommandEmpty>
                            {choices.map((model) => (
                                <CommandItem key={model.id} value={model.id} onSelect={() => { onChange(model.id); setOpen(false); }}>
                                    <span className="sk-model-picker__name">{model.id}
                                        <small>{model.context_window ? t('ai.models.context', '{{count}} token context', { count: model.context_window }) : t('ai.models.unknownContext', 'Context unknown')}
                                            {' · '}{model.pricing ? t('ai.models.prices', '{{input}} USD input / {{output}} USD output per 1M tokens', { input: model.pricing.input, output: model.pricing.output }) : t('ai.models.unknownPrice', 'Pricing unknown')}
                                        </small>
                                        <small>{[
                                            model.tools && t('ai.models.tools', 'Tool calling'), model.vision && t('ai.models.vision', 'Vision'),
                                            model.structured && t('ai.models.structured', 'Structured output'), model.reasoning && t('ai.models.reasoning', 'Reasoning'),
                                            model.max_output_tokens && t('ai.models.outputLimit', '{{count}} maximum output tokens', { count: model.max_output_tokens }),
                                        ].filter(Boolean).join(' · ')}</small>
                                    </span>
                                    {value === model.id && <Check size={16} />}
                                </CommandItem>
                            ))}
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
}
