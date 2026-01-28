import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Check, ArrowLeft } from 'lucide-react';
import ServerKitLogo from '../assets/ServerKitLogo.svg';
import SetupStepAccount from '../components/setup/SetupStepAccount';
import SetupStepIntent from '../components/setup/SetupStepIntent';
import SetupStepTier from '../components/setup/SetupStepTier';
import SetupStepSummary from '../components/setup/SetupStepSummary';

const TOTAL_STEPS = 4;

const STEP_TITLES = [
    'Account',
    'Use Cases',
    'Resources',
    'Summary',
];

const Setup = () => {
    const { isAuthenticated, completeOnboarding } = useAuth();
    const navigate = useNavigate();

    const [currentStep, setCurrentStep] = useState(1);
    const [accountInfo, setAccountInfo] = useState(null);
    const [useCases, setUseCases] = useState([]);

    // If user is already authenticated (e.g. page refresh mid-wizard), skip to step 2
    useEffect(() => {
        if (isAuthenticated && currentStep === 1) {
            setCurrentStep(2);
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

    function handleTierComplete() {
        setCurrentStep(4);
    }

    async function handleFinish() {
        await completeOnboarding(useCases);
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
                    <SetupStepTier
                        useCases={useCases}
                        onComplete={handleTierComplete}
                    />
                );
            case 4:
                return (
                    <SetupStepSummary
                        accountInfo={accountInfo}
                        useCases={useCases}
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
                    <img
                        className="wizard-logo"
                        src={ServerKitLogo}
                        alt="ServerKit"
                        width="48"
                        height="48"
                    />
                    <h1>Welcome to ServerKit</h1>
                    <p>Let's get your server ready</p>
                </div>

                {renderProgressBar()}

                {currentStep > 2 && (
                    <button
                        className="btn-wizard-prev"
                        onClick={handleBack}
                        style={{ marginBottom: 16 }}
                    >
                        <ArrowLeft size={16} />
                        Back
                    </button>
                )}

                {renderStep()}
            </div>
        </div>
    );
};

export default Setup;
