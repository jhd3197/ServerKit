import { cn } from '@/lib/utils';

const TONES = new Set(['accent', 'success', 'warning', 'danger', 'info']);

/**
 * Determinate or indeterminate progress, announced as a progressbar.
 *
 *   <ProgressBar percent={48} label="Disk" valueText="48 of 100 GB" />
 *   <ProgressBar percent={92} tone="danger" size="md" />
 *   <ProgressBar indeterminate label="Pulling image" />
 *
 * `label` names it for screen readers (pass `aria-labelledby` instead when a
 * visible label sits next to it). `tone` picks a semantic colour; `color` is
 * the legacy raw-colour escape hatch and wins when both are set.
 */
export function ProgressBar({
    percent = 0,
    tone,
    color,
    size = 'sm',
    indeterminate = false,
    label,
    valueText,
    className = '',
    ...props
}) {
    const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
    const fillStyle = indeterminate
        ? (color ? { background: color } : undefined)
        : { width: `${clamped}%`, ...(color && { background: color }) };
    return (
        <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={indeterminate ? undefined : 0}
            aria-valuemax={indeterminate ? undefined : 100}
            aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
            aria-valuetext={valueText}
            aria-busy={indeterminate || undefined}
            className={cn(
                'progress-bar',
                size === 'md' && 'progress-bar--md',
                TONES.has(tone) && `progress-bar--${tone}`,
                indeterminate && 'progress-bar--indeterminate',
                className,
            )}
            {...props}
        >
            <div className="progress-fill" style={fillStyle} />
        </div>
    );
}

export default ProgressBar;
