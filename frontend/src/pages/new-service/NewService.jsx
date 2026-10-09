import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Check, Link2, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import DocsLink from '@/components/DocsLink';
import { useNewServiceForm } from './useNewServiceForm';
import SourceStep from './SourceStep';
import ConnectStep from './ConnectStep';
import ReviewStep from './ReviewStep';
import { useTranslation } from 'react-i18next';

const STEPS = [
    { n: 1, labelKey: 'common.labels.source', label: 'Source' },
    { n: 2, labelKey: 'app.newService.connect', label: 'Connect' },
    { n: 3, labelKey: 'app.newService.review', label: 'Review' },
];

// New Service — a real three-step wizard (plan 43 Phase 3). Step state and
// submit live in the form hook; each step is a presentational component.
const NewService = () => {
    const { t } = useTranslation();
    const form = useNewServiceForm();
    const { step, setStep, submitting, canSubmit, canProceedFromConnect, handleSubmit } = form;

    useEffect(() => {
        if (step === 3) {
            window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                detail: { type: 'service-review-ready' },
            }));
        }
    }, [step]);

    useTopbarActions(() =>
        <>
            <DocsLink to="deploySources" />
            <Button type="button" variant="outline" size="sm" asChild>
                <Link to="/settings/connections">
                    <Link2 size={16} />
                    {t('app.newService.connections', 'Connections')}
                </Link>
            </Button>
        </>,
        []
    );

    return (
        <div className="sk-tabgroup__inner new-service-page" data-walkthrough="new-service">
            {/* Slim stepper header */}
            <nav className="new-service-page__stepper" aria-label={t('app.newService.progress', 'Progress')}>
                {STEPS.map(({ n, label }) => {
                    const state = step === n ? 'current' : step > n ? 'done' : 'todo';
                    return (
                        <Button variant="unstyled"
                            key={n}
                            type="button"
                            className={`new-service-page__stepper-item new-service-page__stepper-item--${state}`}
                            onClick={() => { if (step > n) setStep(n); }}
                            disabled={step < n}
                            aria-current={step === n ? 'step' : undefined}
                        >
                            <span className="new-service-page__stepper-dot">
                                {step > n ? <Check size={14} /> : n}
                            </span>
                            <span className="new-service-page__stepper-label">{label}</span>
                        </Button>
                    );
                })}
            </nav>

            <form className="new-service-page__wizard-col" onSubmit={handleSubmit}>
                {step === 1 && <SourceStep form={form} />}
                {step === 2 && <ConnectStep form={form} />}
                {step === 3 && <ReviewStep form={form} />}

                {/* Footer nav — Source advances on card click, so it shows only Cancel. */}
                <div className="new-service-page__footer">
                    {step === 1 ? (
                        <Button type="button" variant="outline" asChild>
                            <Link to="/services">{t('common.actions.cancel', 'Cancel')}</Link>
                        </Button>
                    ) : (
                        <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                            {t('common.actions.back', 'Back')}
                        </Button>
                    )}

                    {step === 2 && (
                        <Button
                            type="button"
                            onClick={() => setStep(3)}
                            disabled={!canProceedFromConnect}
                        >
                            {t('common.actions.continue', 'Continue')}
                        </Button>
                    )}
                    {step === 3 && (
                        <Button type="submit" data-walkthrough="service-submit" disabled={!canSubmit || submitting}>
                            <Rocket size={16} />
                            {submitting
                                ? (form.sourceMode === 'local' ? t('app.newService.registering', 'Registering…') : form.sourceMode === 'upload' ? t('app.newService.uploading', 'Uploading…') : t('app.newService.deploying', 'Deploying…'))
                                : (form.sourceMode === 'local' ? t('app.newService.registerService', 'Register service') : form.sourceMode === 'upload' ? t('app.newService.uploadAndDeploy', 'Upload & deploy') : t('app.newService.deployService', 'Deploy service'))}
                        </Button>
                    )}
                </div>
            </form>
        </div>
    );
};

export default NewService;
