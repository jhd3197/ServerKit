import { Button } from '@/components/ui/button';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Accessible icon-only button. Always provide a descriptive label; it is the
 * aria-label and the tooltip (a real one, shown on hover and keyboard focus,
 * unlike `title`). `title` overrides the tooltip text; `shortcut` adds a key
 * hint to it.
 *
 *   <IconButton icon={<RefreshCw size={16} />} label="Refresh" onClick={load} />
 */
export function IconButton({
    icon,
    label,
    onClick,
    variant = 'ghost',
    size = 'sm',
    className,
    title,
    shortcut,
    disabled,
    ...props
}) {
    return (
        <Tip content={title || label} shortcut={shortcut}>
            <Button
                type="button"
                variant={variant}
                size="icon"
                className={cn('icon-button', size === 'sm' && 'btn-sm', className)}
                onClick={onClick}
                disabled={disabled}
                aria-label={label}
                {...props}
            >
                {icon}
            </Button>
        </Tip>
    );
}

export default IconButton;
