import { useTranslation } from 'react-i18next';
import ServerKitLogo from '../../../components/ServerKitLogo';
import { useAuth } from '../../../contexts/useAuth.js';

// Split auth layout: a branded hero panel beside the form card. The hero is
// hidden on small screens (the card just centers), so it stays usable on mobile.
export default function SplitHeroLayout({ children }) {
    const { t } = useTranslation();
    const { publicTitle } = useAuth();
    return (
        <div className="auth-container auth-split">
            <aside className="auth-split__hero" aria-hidden="true">
                <div className="auth-split__brand">
                    <ServerKitLogo width={56} height={56} />
                    <span className="auth-split__name">{publicTitle || t('auth.controlPanel', 'Control panel')}</span>
                </div>
            </aside>
            <div className="auth-card auth-split__card">{children}</div>
        </div>
    );
}
