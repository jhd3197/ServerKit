import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/useAuth.js';
import { Check, ArrowLeft } from 'lucide-react';
import ServerKitLogo from '../components/ServerKitLogo';
import SetupStepAccount from '../components/setup/SetupStepAccount';
import SetupStepIntent from '../components/setup/SetupStepIntent';
import SetupStepCapacity from '../components/setup/SetupStepCapacity';
import SetupStepSecurity from '../components/setup/SetupStepSecurity';
import SetupStepSummary from '../components/setup/SetupStepSummary';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

const TOTAL_STEPS = 5;

const STEP_TITLES = [
    'Account',
    'Use Cases',
    'Capacity',
    'Security',
    'Summary',
];

const Setup = () => {
    const { t } = useTranslation();
    const { isAuthenticated, completeOnboarding, publicTitle } = useAuth();
    const navigate = useNavigate();

    const [currentStep, setCurrentStep] = useState(1);
    const [accountInfo, setAccountInfo] = useState(null);
    const [useCases, setUseCases] = useState([]);
    const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

    // If user is already authenticated (e.g. page refresh mid-wizard), skip to step 2
    useEffect(() => {
        if (isAuthenticated) {
            setCurrentStep(step => step === 1 ? 2 : step);
        }
    }, [isAuthenticated]);

    function handleAccountComplete(info) {
        setAccountInfo(info);
        setCurrentStep(2);
    }

    function handleIntentComplete(selections) {
        setUseCases(selections);
        setCurrentStep(3);
    }

    function handleCapacityComplete() {
        setCurrentStep(4);
    }

    function handleSecurityComplete(enabled) {
        setTwoFactorEnabled(Boolean(enabled));
        setCurrentStep(5);
    }

    async function handleFinish(installedExtensions = [], sidebarPreset = null, securityPosture = 'minimal') {
        await completeOnboarding(useCases, installedExtensions, sidebarPreset, securityPosture);
        navigate('/');
    }

    function handleBack() {
        if (currentStep > 2) {
            setCurrentStep(currentStep - 1);
        }
    }

    function renderProgressBar() {
        const items = [];
        for (let i = 1; i <= TOTAL_STEPS; i++) {
            if (i > 1) {
                items.push(
                    <div
                        key={`line-${i}`}
                        className={`wizard-progress-line${i <= currentStep ? ' active' : ''}`}
                    />
                );
            }
            let stepClass = 'wizard-progress-step';
            if (i < currentStep) stepClass += ' completed';
            else if (i === currentStep) stepClass += ' active';

            items.push(
                <div key={`step-${i}`} className={stepClass} title={STEP_TITLES[i - 1]}>
                    {i < currentStep ? <Check size={16} /> : i}
                </div>
            );
        }
        return <div className="wizard-progress">{items}</div>;
    }

    function renderStep() {
        switch (currentStep) {
            case 1:
                return <SetupStepAccount onComplete={handleAccountComplete} />;
            case 2:
                return (
                    <SetupStepIntent
                        selections={useCases}
                        onComplete={handleIntentComplete}
                    />
                );
            case 3:
                return (
                    <SetupStepCapacity
                        useCases={useCases}
                        onComplete={handleCapacityComplete}
                    />
                );
            case 4:
                return <SetupStepSecurity onComplete={handleSecurityComplete} />;
            case 5:
                return (
                    <SetupStepSummary
                        accountInfo={accountInfo}
                        useCases={useCases}
                        twoFactorEnabled={twoFactorEnabled}
                        onFinish={handleFinish}
                    />
                );
            default:
                return null;
        }
    }

    return (
        <div className="setup-wizard">
            <div className="wizard-card">
                <div className="wizard-header">
                    <ServerKitLogo className="wizard-logo" width={48} height={48} />
                    <h1>{t('setup.welcome', 'Welcome to {{panel}}', { panel: publicTitle })}</h1>
                    <p>{t('setup.subtitle', 'Set up your server')}</p>
                </div>

                {renderProgressBar()}

                {currentStep > 2 && (
                    <Button
                        variant="ghost"
                        className="btn-wizard-prev setup-back-action"
                        onClick={handleBack}
                    >
                        <ArrowLeft size={16} />
                        {t('common.actions.back', 'Back')}
                    </Button>
                )}

                {renderStep()}
            </div>
        </div>
    );
};

export default Setup;
