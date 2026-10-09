import { cn } from '@/lib/utils';
import { initials } from './utils';

// Initial avatar: a neutral square with the first letter of `name`. Pass
// `gradient` only for a real brand colour; a per-name rainbow down a list is
// decoration, not identity. `label` overrides the letter.
export function ServiceTile({ name = '', size = 38, label, gradient, className, style, ...props }) {
    return (
        <span
            className={cn('sk-tile', className)}
            style={{
                width: size,
                height: size,
                fontSize: Math.round(size * 0.4),
                ...(gradient ? { background: gradient, color: '#fff' } : null),
                ...style,
            }}
            {...props}
        >
            {label || initials(name)}
        </span>
    );
}

export default ServiceTile;
