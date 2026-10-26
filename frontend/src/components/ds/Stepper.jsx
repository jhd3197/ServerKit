import { AlertTriangle, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Styling lives in styles/components/_controls.scss (.sk-stepper*).

// Read after the label by screen readers; the marker alone is visual only.
function statusCopy(t, status) {
    if (status === 'complete') return t('common.controls.stepComplete', 'Completed');
    if (status === 'current') return t('common.controls.stepCurrent', 'Current step');
    if (status === 'error') return t('common.controls.stepError', 'Needs attention');
    return t('common.controls.stepUpcoming', 'Not started');
}

function statusOf(step, index, current) {
    if (step.status) return step.status;
    if (index < current) return 'complete';
    if (index === current) return 'current';
    return 'upcoming';
}

/**
 * Progress through an ordered flow: setup, onboarding, a multi-page form, a
 * deploy pipeline.
 *
 *   <Stepper current={1} steps={[
 *     { id: 'source', label: 'Source' },
 *     { id: 'build', label: 'Build', description: 'Buildpack detected' },
 *     { id: 'deploy', label: 'Deploy' },
 *   ]} />
 *
 * Status comes from `current` (before = complete, at = current, after =
 * upcoming) unless a step sets its own `status` ('error' for a failed one).
 * With `onStepClick`, completed steps become buttons to go back to; the
 * current and later steps stay inert so a flow cannot be skipped ahead.
 */
export function Stepper({
    steps = [],
    current = 0,
    orientation = 'horizontal',
    onStepClick,
    className,
    'aria-label': ariaLabel,
}) {
    const { t } = useTranslation();
    return (
        <ol
            className={cn('sk-stepper', `sk-stepper--${orientation}`, className)}
            aria-label={ariaLabel || t('common.controls.progress', 'Progress')}
        >
            {steps.map((step, index) => {
                const status = statusOf(step, index, current);
                const clickable = onStepClick && status === 'complete';
                const marker = (
                    <>
                        <span className="sk-stepper__marker" aria-hidden="true">
                            {status === 'complete' && <Check />}
                            {status === 'error' && <AlertTriangle />}
                            {(status === 'current' || status === 'upcoming') && index + 1}
                        </span>
                        <span className="sk-stepper__copy">
                            <span className="sk-stepper__label">{step.label}</span>
                            {step.description && <span className="sk-stepper__description">{step.description}</span>}
                            <span className="sr-only">{statusCopy(t, status)}</span>
                        </span>
                    </>
                );
                return (
                    <li
                        key={step.id ?? index}
                        className={cn('sk-stepper__step', `is-${status}`)}
                        aria-current={status === 'current' ? 'step' : undefined}
                    >
                        {clickable ? (
                            <Button variant="unstyled" type="button" className="sk-stepper__target" onClick={() => onStepClick(index, step)}>
                                {marker}
                            </Button>
                        ) : (
                            <div className="sk-stepper__target">{marker}</div>
                        )}
                        {index < steps.length - 1 && <span className="sk-stepper__connector" aria-hidden="true" />}
                    </li>
                );
            })}
        </ol>
    );
}

export default Stepper;
