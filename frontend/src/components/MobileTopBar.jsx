import { Menu, Plus, Search, X } from 'lucide-react';
import { t } from '../i18n/t';
import { useTheme } from '../contexts/useTheme.js';
import ServerKitLogo from './ServerKitLogo';
import NotificationBell from './NotificationBell';
import { Button as SharedButton } from '@/components/ui/button';
import { useRegisteredPrimaryAction } from '../contexts/pagePrimaryAction.js';

// Fixed header shown only on narrow viewports (< 768px). Houses the
// hamburger toggle that opens the sidebar as an off-canvas drawer, since
// the persistent sidebar is hidden at this width. Hidden on desktop via CSS.
const MobileTopBar = ({ navOpen, onToggle }) => {
    const { whiteLabel } = useTheme();
    const primary = useRegisteredPrimaryAction();
    const branded = whiteLabel?.enabled;
    const brandName = branded ? (whiteLabel.brandName || 'Brand') : 'ServerKit';
    const showCustomLogo = branded && whiteLabel.logoData && whiteLabel.mode !== 'text_only';

    return (
        <header className="mobile-topbar">
            <SharedButton variant="unstyled"
                type="button"
                className="mobile-topbar__toggle"
                aria-label={navOpen
                    ? t('nav.closeMenu', 'Close navigation menu')
                    : t('nav.openMenu', 'Open navigation menu')}
                aria-expanded={navOpen}
                aria-controls="primary-navigation"
                onClick={onToggle}
            >
                {navOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
            </SharedButton>
            <div className="mobile-topbar__brand">
                {!branded && (
                    <span className="mobile-topbar__logo">
                        <ServerKitLogo width={26} height={26} />
                    </span>
                )}
                {showCustomLogo && (
                    <span className="mobile-topbar__logo">
                        <img src={whiteLabel.logoData} alt="" />
                    </span>
                )}
                <span className="mobile-topbar__name">{brandName}</span>
            </div>
            <div className="mobile-topbar__actions">
                <SharedButton variant="unstyled"
                    type="button"
                    className="quick-create"
                    title={t('app.mobileSearch.title', 'Search everything (Ctrl K)')}
                    aria-label={t('app.mobileSearch.label', 'Search')}
                    onClick={() => window.dispatchEvent(new CustomEvent('serverkit:open-palette'))}
                >
                    <Search size={16} aria-hidden="true" />
                </SharedButton>
                {primary && (
                    <SharedButton variant="unstyled"
                        type="button"
                        className="quick-create"
                        title={primary.label}
                        aria-label={primary.label}
                        disabled={primary.disabled}
                        onClick={primary.run}
                    >
                        <Plus size={16} />
                    </SharedButton>
                )}
                <NotificationBell />
            </div>
        </header>
    );
};

export default MobileTopBar;
