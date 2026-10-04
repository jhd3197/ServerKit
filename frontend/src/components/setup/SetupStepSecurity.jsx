import { useState, useEffect } from 'react';
import { ShieldCheck, Download, AlertTriangle, Check, Loader } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import api from '../../services/api';
import CopyField from '../CopyField';
import { downloadBlob } from '@/utils/downloadBlob';
import { useTranslation } from 'react-i18next';

// Enrolment is a three-beat flow. Offer is the default so someone who just
// wants a dashboard is one click from moving on — 2FA is offered here because
// this is the only moment we know the operator is at a keyboard with their
// phone, not because it is mandatory.
const STAGE_OFFER = 'offer';
const STAGE_ENROLL = 'enroll';
const STAGE_CODES = 'codes';
const STAGE_ALREADY = 'already';

const CODE_LENGTH = 6;

const SetupStepSecurity = ({ onComplete }) => {
    const { t } = useTranslation();
    const [stage, setStage] = useState(STAGE_OFFER);
    const [setupData, setSetupData] = useState(null);
    const [code, setCode] = useState('');
    const [backupCodes, setBackupCodes] = useState([]);
    const [savedCodes, setSavedCodes] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    // Stepping back to Capacity and forward again re-mounts this step, but the
    // enrolment already landed server-side — re-offering it would just 400.
    useEffect(() => {
        let active = true;
        api.get2FAStatus()
            .then((status) => {
                if (active && status?.enabled) setStage(STAGE_ALREADY);
            })
            .catch(() => {
                // Status is a convenience; the offer path still works without it.
            });
        return () => {
            active = false;
        };
    }, []);

    async function handleEnable() {
        setBusy(true);
        setError('');
        try {
            const data = await api.initiate2FASetup();
            setSetupData(data);
            setStage(STAGE_ENROLL);
        } catch (err) {
            setError(err.message || 'Could not start two-factor setup.');
        } finally {
            setBusy(false);
        }
    }

    async function handleConfirm() {
        if (code.length !== CODE_LENGTH) {
            setError(`Enter the ${CODE_LENGTH}-digit code from your app.`);
            return;
        }
        setBusy(true);
        setError('');
        try {
            const result = await api.confirm2FASetup(code);
            setBackupCodes(result.backup_codes || []);
            setStage(STAGE_CODES);
        } catch (err) {
            setError(err.message || 'That code did not match. Try the next one.');
        } finally {
            setBusy(false);
        }
    }

    function downloadCodes() {
        const body = [
            'ServerKit backup codes',
            '',
            'Each code works once, in place of your authenticator app.',
            'Store them somewhere you can reach without this server.',
            '',
            ...backupCodes,
        ].join('\n');

        downloadBlob(body, 'serverkit-backup-codes.txt');
        setSavedCodes(true);
    }

    if (stage === STAGE_ALREADY) {
        return (
            <div className="wizard-step">
                <h2 className="wizard-step-title">{t('app.setupStepSecurity.twoFactorIsOn', 'Two-factor authentication is on')}</h2>
                <p className="wizard-step-description">
                    {t('app.setupStepSecurity.thisAccountAlreadyHasTwoFactor', 'This account already has two-factor authentication enabled. You can regenerate backup codes or turn it off from Settings.')}
                </p>

                <div className="security-offer">
                    <div className="security-offer__icon">
                        <ShieldCheck size={28} />
                    </div>
                    <div className="security-offer__body">
                        <div className="security-offer__title">
                            {t('app.setupStepSecurity.twoFactorAuthenticationActive', 'Two-factor authentication active')}
                        </div>
                        <p className="security-offer__desc">
                            {t('app.setupStepSecurity.youLlBeAskedForA', 'You\'ll be asked for a code from your authenticator app the next time you sign in.')}
                        </p>
                    </div>
                </div>

                <div className="wizard-nav wizard-nav--flush">
                    <Button variant="unstyled"
                        type="button"
                        className="btn-wizard-next"
                        onClick={() => onComplete(true)}
                    >
                        {t('common.actions.continue', 'Continue')}
                    </Button>
                </div>
            </div>
        );
    }

    if (stage === STAGE_OFFER) {
        return (
            <div className="wizard-step">
                <h2 className="wizard-step-title">{t('app.setupStepSecurity.protectThisAccount', 'Protect this account')}</h2>
                <p className="wizard-step-description">
                    {t('app.setupStepSecurity.thisPanelCanRestartServicesOpen', 'This panel can restart services, open firewall ports and read your databases. Two-factor authentication means a stolen password alone is not enough to do any of that.')}
                </p>

                <div className="security-offer">
                    <div className="security-offer__icon">
                        <ShieldCheck size={28} />
                    </div>
                    <div className="security-offer__body">
                        <div className="security-offer__title">
                            {t('app.setupStepSecurity.twoFactorAuthentication', 'Two-factor authentication')}
                        </div>
                        <p className="security-offer__desc">
                            {t('app.setupStepSecurity.takesAboutThirtySecondsWithAny', "Takes about thirty seconds with any authenticator app, such as 1Password, Aegis or Google Authenticator. You'll get backup codes in case you lose the device.")}
                        </p>
                    </div>
                </div>

                {error && (
                    <div className="tier-warning">
                        <AlertTriangle size={20} className="tier-warning-icon" />
                        <div className="tier-warning-text">{error}</div>
                    </div>
                )}

                <div className="wizard-nav wizard-nav--flush">
                    <Button variant="ghost" onClick={() => onComplete(false)} disabled={busy}>
                        {t('app.setupStepSecurity.skipForNow', 'Skip for now')}
                    </Button>
                    <Button variant="unstyled"
                        type="button"
                        className="btn-wizard-next"
                        onClick={handleEnable}
                        disabled={busy}
                    >
                        {busy ? 'Starting...' : 'Enable two-factor'}
                    </Button>
                </div>
            </div>
        );
    }

    if (stage === STAGE_ENROLL) {
        return (
            <div className="wizard-step">
                <h2 className="wizard-step-title">{t('app.setupStepSecurity.scanThisCode', 'Scan this code')}</h2>
                <p className="wizard-step-description">
                    {t('app.setupStepSecurity.openYourAuthenticatorAppScanThe', 'Open your authenticator app, scan the QR code, then enter the six-digit code it shows.')}
                </p>

                <div className="security-enroll">
                    {setupData?.qr_code ? (
                        <img
                            src={setupData.qr_code}
                            alt={t('app.setupStepSecurity.twoFactorQrCode', '2FA QR code')}
                            className="security-enroll__qr"
                        />
                    ) : (
                        <div className="security-enroll__qr security-enroll__qr--empty">
                            <Loader size={20} className="spin" />
                        </div>
                    )}

                    <div className="security-enroll__manual">
                        <div className="security-enroll__manual-label">
                            {t('app.setupStepSecurity.canTScanEnterThisKey', 'Can\'t scan? Enter this key instead:')}
                        </div>
                        <CopyField value={setupData?.secret} secret />
                    </div>
                </div>

                <div className="security-enroll__verify">
                    <Input
                        value={code}
                        onChange={(e) =>
                            setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
                        }
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleConfirm();
                        }}
                        placeholder="000000"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        className="security-enroll__input"
                        aria-label={t('app.setupStepSecurity.sixDigitVerificationCode', 'Six-digit verification code')}
                    />
                </div>

                {error && (
                    <div className="tier-warning">
                        <AlertTriangle size={20} className="tier-warning-icon" />
                        <div className="tier-warning-text">{error}</div>
                    </div>
                )}

                <div className="wizard-nav wizard-nav--flush">
                    <Button variant="ghost" onClick={() => onComplete(false)} disabled={busy}>
                        {t('app.setupStepSecurity.skipForNow', 'Skip for now')}
                    </Button>
                    <Button variant="unstyled"
                        type="button"
                        className="btn-wizard-next"
                        onClick={handleConfirm}
                        disabled={busy || code.length !== CODE_LENGTH}
                    >
                        {busy ? 'Verifying...' : 'Verify and enable'}
                    </Button>
                </div>
            </div>
        );
    }

    // STAGE_CODES — shown exactly once. The backend will not reissue these.
    return (
        <div className="wizard-step">
            <h2 className="wizard-step-title">{t('app.setupStepSecurity.saveYourBackupCodes', 'Save your backup codes')}</h2>
            <p className="wizard-step-description">
                {t('app.setupStepSecurity.theseAreShownOnceAndNever', 'These are shown once and never again. Each works a single time if you lose your authenticator. Keep them somewhere that does not depend on this server being reachable.')}
            </p>

            <CopyField
                className="security-codes__list"
                value={backupCodes.join('\n')}
                multiline
                onCopy={() => setSavedCodes(true)}
            />

            <div className="security-codes__actions">
                <Button variant="outline" onClick={downloadCodes}>
                    <Download size={15} />
                    {t('common.actions.download', 'Download')}
                </Button>
                {savedCodes && (
                    <span className="security-codes__saved">
                        <Check size={15} />
                        {t('app.setupStepSecurity.saved', 'Saved')}
                    </span>
                )}
            </div>

            <div className="wizard-nav wizard-nav--flush">
                <Button variant="unstyled"
                    type="button"
                    className="btn-wizard-next"
                    onClick={() => onComplete(true)}
                >
                    {savedCodes ? 'Continue' : 'I have saved these'}
                </Button>
            </div>
        </div>
    );
};

export default SetupStepSecurity;
