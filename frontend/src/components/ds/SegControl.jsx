import { useRef } from 'react';
import { useScrollTabs } from '@/hooks/useScrollTabs';
import { cn } from '@/lib/utils';
import { Button as SharedButton } from '@/components/ui/button';

// Segmented toggle. Replaces native <select> / filter-chip clusters.
// options: array of strings, or { value, label, icon?, count? } objects.
export function SegControl({ options = [], value, onChange, className, ...props }) {
    const items = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
    const ref = useRef(null);
    useScrollTabs(ref);
    return (
        <div ref={ref} className={cn('sk-seg sk-tabscroll', className)} role="tablist" {...props}>
            {items.map((o) => (
                <SharedButton variant="unstyled"
                    key={o.value}
                    type="button"
                    role="tab"
                    aria-selected={value === o.value}
                    className={cn('sk-seg__btn', value === o.value && 'is-on')}
                    onClick={() => onChange?.(o.value)}
                >
                    {o.icon}
                    {o.label}
                    {o.count != null && <span className="sk-seg__count">{o.count}</span>}
                </SharedButton>
            ))}
        </div>
    );
}

export default SegControl;
