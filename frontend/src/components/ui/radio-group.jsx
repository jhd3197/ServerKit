import * as React from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from '@/lib/utils';

// Styling lives in styles/components/_controls.scss (.ui-radio*).

/**
 * One choice from a short, visible list — when the options deserve to be
 * read side by side. Longer lists are a Select; two or three terse options in
 * a toolbar are a SegControl.
 *
 *   <RadioGroup value={strategy} onValueChange={setStrategy} options={[
 *     { value: 'rolling', label: 'Rolling', description: 'Replace one at a time' },
 *     { value: 'recreate', label: 'Recreate', description: 'Stop all, then start' },
 *   ]} />
 *   <RadioGroup variant="card" orientation="horizontal" … />
 *
 * Arrow keys move and select (roving focus, one tab stop) — that is Radix.
 */
const RadioGroup = React.forwardRef(({
    options = [],
    variant = 'default',
    orientation = 'vertical',
    className,
    ...props
}, ref) => {
    const baseId = React.useId();
    return (
        <RadioGroupPrimitive.Root
            ref={ref}
            orientation={orientation}
            className={cn(
                'ui-radio-group',
                `ui-radio-group--${orientation}`,
                variant === 'card' && 'ui-radio-group--card',
                className,
            )}
            {...props}
        >
            {options.map((option) => {
                const id = `${baseId}${option.value}`;
                const descriptionId = option.description ? `${id}-description` : undefined;
                const Icon = option.icon;
                return (
                    <label
                        key={option.value}
                        htmlFor={id}
                        className={cn('ui-radio', option.disabled && 'is-disabled')}
                    >
                        <RadioGroupPrimitive.Item
                            id={id}
                            value={option.value}
                            disabled={option.disabled}
                            aria-describedby={descriptionId}
                            className="ui-radio__control"
                        >
                            <RadioGroupPrimitive.Indicator className="ui-radio__dot" />
                        </RadioGroupPrimitive.Item>
                        {Icon && <Icon className="ui-radio__icon" aria-hidden="true" />}
                        <span className="ui-radio__copy">
                            <span className="ui-radio__label">{option.label}</span>
                            {option.description && (
                                <span id={descriptionId} className="ui-radio__description">{option.description}</span>
                            )}
                        </span>
                    </label>
                );
            })}
        </RadioGroupPrimitive.Root>
    );
});
RadioGroup.displayName = 'RadioGroup';

export { RadioGroup };
