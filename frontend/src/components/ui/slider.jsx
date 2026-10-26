import * as React from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { useFieldProps } from '@/components/ui/field-context';
import { cn } from '@/lib/utils';

// Styling lives in styles/components/_controls.scss (.ui-slider*).

/**
 * Pick a value (or a range) on a bounded scale: memory limits, retention
 * days, CPU shares.
 *
 *   <Slider value={days} onChange={setDays} min={1} max={90} unit="days" />
 *   <Slider value={[lo, hi]} onChange={([a, b]) => …} min={0} max={100} />
 *   <Slider value={mb} onChange={setMb} min={256} max={8192} step={256}
 *           marks={[256, 2048, 4096, 8192]} format={(v) => `${v / 1024} GB`} />
 *
 * Passing a number gives a number back; an array gives an array. The current
 * value reads out beside the track (`showValue={false}` hides it). Radix
 * handles the keyboard: arrows step, PageUp/PageDown ×10, Home/End.
 */
const Slider = React.forwardRef(({
    value,
    onChange,
    onCommit,
    min = 0,
    max = 100,
    step = 1,
    unit,
    format,
    marks,
    showValue = true,
    disabled = false,
    className,
    'aria-label': ariaLabel,
    ...props
}, ref) => {
    const fieldProps = useFieldProps(props);
    const isRange = Array.isArray(value);
    const values = isRange ? value : [value ?? min];
    const show = (v) => (format ? format(v) : (unit ? `${v} ${unit}` : String(v)));
    const percent = (v) => ((v - min) / (max - min)) * 100;
    const emit = (handler) => (next) => handler?.(isRange ? next : next[0]);

    return (
        <div className={cn('ui-slider', disabled && 'is-disabled', marks?.length && 'ui-slider--marked', className)}>
            <div className="ui-slider__body">
                <SliderPrimitive.Root
                    ref={ref}
                    className="ui-slider__root"
                    value={values}
                    min={min}
                    max={max}
                    step={step}
                    disabled={disabled}
                    minStepsBetweenThumbs={isRange ? 1 : undefined}
                    onValueChange={emit(onChange)}
                    onValueCommit={emit(onCommit)}
                >
                    <SliderPrimitive.Track className="ui-slider__track">
                        <SliderPrimitive.Range className="ui-slider__range" />
                    </SliderPrimitive.Track>
                    {values.map((v, index) => (
                        <SliderPrimitive.Thumb
                            key={index}
                            className="ui-slider__thumb"
                            id={index === 0 ? fieldProps.id : undefined}
                            aria-label={ariaLabel}
                            aria-describedby={fieldProps['aria-describedby']}
                            aria-valuetext={show(v)}
                        />
                    ))}
                </SliderPrimitive.Root>
                {marks?.length > 0 && (
                    <div className="ui-slider__marks" aria-hidden="true">
                        {marks.map((mark) => (
                            <span key={mark} className="ui-slider__mark" style={{ insetInlineStart: `${percent(mark)}%` }}>
                                {show(mark)}
                            </span>
                        ))}
                    </div>
                )}
            </div>
            {showValue && (
                <output className="ui-slider__value" htmlFor={fieldProps.id}>
                    {values.map(show).join(' – ')}
                </output>
            )}
        </div>
    );
});
Slider.displayName = 'Slider';

export { Slider };
