import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

// Release-signature verdict shared by the registry detail modal and the manual
// install consent card. `signature.status`: 'verified' (ed25519 signature
// checked against a publisher key this panel pins), 'untrusted_key',
// 'invalid', or anything else = unsigned.
export default function SignatureBadge({ signature, className }) {
    const { t } = useTranslation();
    const status = signature?.status || 'unsigned';
    const signer = signature?.publisher || signature?.key_id;
    if (status === 'verified') {
        return (
            <Badge
                variant="success"
                className={className}
                title={t('app.signatureBadge.verifiedHint', 'Release zip is signed; the panel verifies the ed25519 signature at install')}
            >
                <ShieldCheck aria-hidden="true" />
                {t('app.signatureBadge.signed', 'Signed')}{signer ? ` · ${signer}` : ''}
            </Badge>
        );
    }
    if (status === 'untrusted_key') {
        return (
            <Badge
                variant="warning"
                className={className}
                title={signer ? t('app.signatureBadge.unknownSignerHint', "Signed with publisher key '{{key}}', which this panel does not pin", { key: signer }) : undefined}
            >
                <ShieldAlert aria-hidden="true" />
                {t('app.signatureBadge.unknownSigner', 'Unknown signer')}
            </Badge>
        );
    }
    if (status === 'invalid') {
        return (
            <Badge variant="destructive" className={className}>
                <ShieldAlert aria-hidden="true" />
                {t('app.signatureBadge.invalid', 'Signature invalid')}
            </Badge>
        );
    }
    return (
        <Badge
            variant="warning"
            className={className}
            title={t('app.signatureBadge.unsignedHint', 'This release carries no publisher signature')}
        >
            <ShieldAlert aria-hidden="true" />
            {t('app.signatureBadge.unsigned', 'Unsigned')}
        </Badge>
    );
}
