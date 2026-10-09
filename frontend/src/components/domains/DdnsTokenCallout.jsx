// One-time Dynamic DNS token callout — the update token is only returned once on
// create/regenerate, so we surface it prominently with the ready-to-use update URL.
// Shared by the Domains drawer's per-record "Make dynamic" flow.
import { AlertTriangle } from 'lucide-react';
import CopyButton from '../CopyButton';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

export default function DdnsTokenCallout({ host, onDismiss }) {
    const { t } = useTranslation();
    // The public, token-authenticated endpoint a router/cron calls on IP change.
    const updateUrl = `${window.location.origin}/api/v1/ddns/update?token=${host.token}`;

    return (
        <div className="ddns-token-callout">
            <div className="ddns-token-callout__head">
                <AlertTriangle size={16} />
                <span>
                    {t('app.ddnsTokenCallout.tokenFor', 'Token for')} <strong>{host.hostname || host.record_name}</strong> {t('app.ddnsTokenCallout.shownOnceSaveItNow', '(shown once). Save it now.')}
                </span>
                {onDismiss && (
                    <SharedButton variant="unstyled" type="button" className="ddns-token-callout__close" onClick={onDismiss} aria-label={t('common.actions.dismiss', 'Dismiss')}>
                        &times;
                    </SharedButton>
                )}
            </div>

            <div className="ddns-token-callout__row">
                <span className="ddns-token-callout__label">{t('app.ddnsTokenCallout.token', 'Token')}</span>
                <code className="ddns-token-callout__value">{host.token}</code>
                <CopyButton value={host.token} label={t('app.ddnsTokenCallout.copyToken', 'Copy token')} size="sm" variant="outline" />
            </div>

            <div className="ddns-token-callout__row">
                <span className="ddns-token-callout__label">{t('app.ddnsTokenCallout.updateUrl', 'Update URL')}</span>
                <code className="ddns-token-callout__value">{updateUrl}</code>
                <CopyButton value={updateUrl} label={t('app.ddnsTokenCallout.copyUrl', 'Copy URL')} size="sm" variant="outline" />
            </div>
        </div>
    );
}
