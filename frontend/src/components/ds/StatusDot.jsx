import { cn } from '@/lib/utils';

// A Pill's dot without the label; the status text rides along as the accessible
// name and tooltip. kind: same vocabulary as Pill.
export function StatusDot({ kind = 'gray', label, className }) {
    return <span role="img" aria-label={label} title={label} className={cn('sk-statusdot', `sk-statusdot--${kind}`, className)} />;
}

export default StatusDot;
