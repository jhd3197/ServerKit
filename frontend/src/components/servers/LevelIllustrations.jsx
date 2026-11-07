// Small inline illustrations for the permission-level cards. They use
// currentColor plus the panel accent variables, so they follow the theme.
const common = {
    viewBox: '0 0 96 56',
    height: 56,
    'aria-hidden': true,
    focusable: 'false',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
};

const Monitor = () => (
    <svg {...common}>
        <path d="M8 24c9-12 21-18 40-18s31 6 40 18c-9 12-21 18-40 18S17 36 8 24z" opacity=".45" />
        <circle cx="48" cy="24" r="9" opacity=".45" />
        <path d="M4 48h22l6-10 8 16 7-12 5 6h40" stroke="var(--accent, currentColor)" />
    </svg>
);

const Protect = () => (
    <svg {...common}>
        <path d="M48 4l28 8v16c0 13-10 21-28 26-18-5-28-13-28-26V12z" opacity=".45" />
        <path d="M34 22h28M34 30h28M34 38h28M48 22v8M41 30v8M55 30v8" opacity=".5" />
        <path d="M39 29l7 7 13-14" stroke="var(--accent, currentColor)" strokeWidth={3} />
    </svg>
);

const Full = () => (
    <svg {...common}>
        <rect x="8" y="6" width="80" height="44" rx="5" opacity=".45" />
        <path d="M8 16h80" opacity=".45" />
        <path d="M16 26l7 6-7 6" stroke="var(--accent, currentColor)" />
        <path d="M28 40h10" opacity=".5" />
        <circle cx="62" cy="31" r="6" stroke="var(--accent, currentColor)" />
        <path d="M68 31h16M78 31v6M84 31v4" stroke="var(--accent, currentColor)" />
    </svg>
);

const ILLUSTRATIONS = { monitor: Monitor, protect: Protect, full: Full };

const LevelIllustration = ({ level }) => {
    const Svg = ILLUSTRATIONS[level] || Monitor;
    return <Svg />;
};

export default LevelIllustration;
