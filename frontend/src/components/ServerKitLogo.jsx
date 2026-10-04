import { useId } from 'react';
import { useTranslation } from 'react-i18next';

const ServerKitLogo = ({ width = 64, height = 64, className = '' }) => {
    const { t } = useTranslation();
    // Unique per instance: multiple logos render at once (sidebar + mobile top
    // bar + auth screens). A shared gradient id collides in the DOM, and
    // url(#id) resolves to the first match — which can be a hidden 0x0 instance
    // whose objectBoundingBox gradient has no coordinate space, painting the
    // glyph as nothing. A unique id keeps each logo bound to its own gradient.
    const rawId = useId();
    const gradId = `skBrandGradient-${rawId.replace(/:/g, '')}`;

    // Gradient tile + white 2-bar server glyph — matches the sidebar brand mark
    // (.brand-logo in _sidebar.scss: linear-gradient(--accent-bright, --accent)
    // tile with a white lucide `Server` icon) and the per-install favicon, so the
    // brand reads the same in the sidebar, auth screens, wizards and the tab icon.
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 32 32"
            width={width}
            height={height}
            className={className}
            role="img"
            aria-label={t('app.serverKitLogo.serverkitLogo', 'ServerKit logo')}
            fill="none"
        >
            <defs>
                <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="var(--accent-bright, #6d7cff)" />
                    <stop offset="100%" stopColor="var(--accent, #5a67e8)" />
                </linearGradient>
            </defs>
            <rect width="32" height="32" rx="7" fill={`url(#${gradId})`} />
            <g
                transform="translate(6 6) scale(0.8333)"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
                <line x1="6" y1="6" x2="6.01" y2="6" />
                <line x1="6" y1="18" x2="6.01" y2="18" />
            </g>
        </svg>
    );
};

export default ServerKitLogo;
