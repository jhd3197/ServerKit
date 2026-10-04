import { useMemo, useState } from 'react';
import { LayoutGrid, Plus } from 'lucide-react';
import { Drawer, SearchField } from '@/components/ds';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Registry entries carry a lucide component in `icon`. Guard against a type
// that shipped without one (or with a plain string) so the card still renders.
const iconOf = (type) => {
    const candidate = type?.icon;
    const usable = typeof candidate === 'function' || (candidate && typeof candidate === 'object');
    return usable ? candidate : LayoutGrid;
};

// Thumbnail palette. These are literal swatch colours inside an inline SVG
// preview, so they read the same design tokens the real widgets do.
const T_ACC = 'var(--accent-bright)';
const T_GRN = 'var(--green)';
const T_AMB = 'var(--amber)';
const T_CYN = 'var(--cyan)';
const T_RED = 'var(--red)';
const T_LINE = 'var(--border-strong)';
const T_DIM = 'var(--surface-3)';
const T_INK = '#0a0c11';

/**
 * Tiny abstract preview of what a widget type looks like once placed. Purely
 * decorative — the card's name and description carry the meaning.
 */
function WidgetThumb({ type }) {
    const box = (kids) => (
        <svg
            viewBox="0 0 132 68"
            preserveAspectRatio="xMidYMid meet"
            className="skw-lib__thumb-svg"
            aria-hidden="true"
            focusable="false"
        >
            {kids}
        </svg>
    );
    const bars = (values, colour) => values.map((value, i) => (
        <rect key={i} x="10" y={10 + i * 13} width={value} height="6" rx="3" fill={i ? T_DIM : colour} />
    ));
    const lines = (count, y0 = 10, gap = 12) => Array.from({ length: count }, (_, i) => (
        <rect key={i} x="10" y={y0 + i * gap} width={i % 2 ? 96 : 112} height="5" rx="2.5" fill={T_DIM} />
    ));
    const spark = (colour, y = 44, h = 16) => {
        const points = [0, 6, 3, 11, 7, 14, 9, 17, 12, 20, 8, 25, 14, 28, 11, 33]
            .map((value, i) => `${10 + i * 7.6},${y + h - (value / 28) * h}`)
            .join(' ');
        return <polyline points={points} fill="none" stroke={colour} strokeWidth="2" strokeLinejoin="round" />;
    };

    switch (type) {
        case 'stat':
            return box(
                <>
                    <rect x="10" y="10" width="46" height="15" rx="3" fill={T_ACC} opacity=".85" />
                    <rect x="10" y="30" width="30" height="5" rx="2.5" fill={T_DIM} />
                    {spark(T_ACC)}
                </>,
            );
        case 'timeseries':
            return box(
                <>
                    <path d="M8 52 L28 40 L46 46 L64 26 L84 34 L102 18 L124 26 L124 60 L8 60 Z" fill={T_ACC} opacity=".16" />
                    <path d="M8 52 L28 40 L46 46 L64 26 L84 34 L102 18 L124 26" fill="none" stroke={T_ACC} strokeWidth="2" strokeLinejoin="round" />
                    <path d="M8 58 L28 52 L46 54 L64 44 L84 50 L102 42 L124 46" fill="none" stroke={T_GRN} strokeWidth="2" strokeLinejoin="round" />
                    <g fill={T_DIM}>
                        <rect x="8" y="8" width="20" height="4" rx="2" />
                        <rect x="32" y="8" width="14" height="4" rx="2" />
                    </g>
                </>,
            );
        case 'gauge':
            return box(
                <>
                    <path d="M28 52 A38 38 0 0 1 104 52" fill="none" stroke={T_DIM} strokeWidth="9" strokeLinecap="round" />
                    <path d="M28 52 A38 38 0 0 1 96 30" fill="none" stroke={T_GRN} strokeWidth="9" strokeLinecap="round" />
                    <rect x="52" y="42" width="28" height="9" rx="3" fill={T_GRN} opacity=".8" />
                </>,
            );
        case 'topn':
            return box(
                <>
                    {bars([84, 66, 50, 34], T_CYN)}
                    <rect x="10" y="10" width="84" height="6" rx="3" fill={T_CYN} />
                </>,
            );
        case 'table':
            return box(
                <>
                    <rect x="0" y="0" width="132" height="14" fill={T_DIM} opacity=".7" />
                    {[0, 1, 2].map((i) => (
                        <g key={i}>
                            <rect x="10" y={22 + i * 14} width="34" height="5" rx="2.5" fill={i ? T_DIM : T_LINE} />
                            <rect x="52" y={22 + i * 14} width="26" height="5" rx="2.5" fill={T_DIM} />
                            <rect x="86" y={22 + i * 14} width="18" height="5" rx="2.5" fill={i === 1 ? T_GRN : T_DIM} />
                        </g>
                    ))}
                </>,
            );
        case 'logs':
            return box(
                <>
                    <rect x="0" y="0" width="132" height="68" fill={T_INK} />
                    {[112, 92, 120, 74, 104, 86].map((width, i) => (
                        <g key={i}>
                            <rect x="8" y={9 + i * 10} width="14" height="4" rx="2" fill={T_LINE} />
                            <rect x="26" y={9 + i * 10} width={width - 26} height="4" rx="2" fill={i === 3 ? T_RED : i === 4 ? T_AMB : T_DIM} />
                        </g>
                    ))}
                </>,
            );
        case 'deploys':
            return box(
                <>
                    {[0, 1, 2].map((i) => (
                        <g key={i}>
                            <rect x="10" y={10 + i * 20} width="40" height="5" rx="2.5" fill={T_LINE} />
                            {[0, 1, 2, 3, 4, 5].map((j) => (
                                <rect
                                    key={j}
                                    x={10 + j * 20}
                                    y={19 + i * 20}
                                    width="16"
                                    height="4"
                                    rx="2"
                                    fill={j < 4 - i ? (i === 1 ? T_RED : T_GRN) : T_DIM}
                                />
                            ))}
                        </g>
                    ))}
                </>,
            );
        case 'alerts':
            return box(
                <>
                    {[T_RED, T_AMB, T_CYN].map((colour, i) => (
                        <g key={i}>
                            <circle cx="14" cy={16 + i * 18} r="4" fill={colour} />
                            <rect x="24" y={13 + i * 18} width="70" height="5" rx="2.5" fill={T_LINE} />
                            <rect x="100" y={13 + i * 18} width="22" height="5" rx="2.5" fill={T_DIM} />
                        </g>
                    ))}
                </>,
            );
        case 'status':
            return box(
                <>
                    {Array.from({ length: 8 }, (_, i) => {
                        const colour = i === 3 ? T_AMB : i === 6 ? T_RED : T_GRN;
                        return (
                            <g key={i}>
                                <rect x={8 + (i % 4) * 32} y={10 + Math.floor(i / 4) * 28} width="28" height="22" rx="4" fill={T_DIM} />
                                <circle cx={15 + (i % 4) * 32} cy={18 + Math.floor(i / 4) * 28} r="3" fill={colour} />
                                <rect x={12 + (i % 4) * 32} y={25 + Math.floor(i / 4) * 28} width="18" height="3" rx="1.5" fill={T_LINE} />
                            </g>
                        );
                    })}
                </>,
            );
        case 'feed':
            return box(
                <>
                    {[0, 1, 2].map((i) => (
                        <g key={i}>
                            <circle cx="15" cy={16 + i * 19} r="6" fill={T_DIM} />
                            <rect x="28" y={11 + i * 19} width="94" height="5" rx="2.5" fill={T_LINE} />
                            <rect x="28" y={20 + i * 19} width="40" height="4" rx="2" fill={T_DIM} />
                        </g>
                    ))}
                </>,
            );
        case 'actions':
            return box(
                <>
                    {[0, 1, 2].map((i) => (
                        <g key={i}>
                            <rect x="10" y={9 + i * 19} width="112" height="15" rx="5" fill={T_DIM} />
                            <rect x="18" y={14 + i * 19} width="46" height="5" rx="2.5" fill={T_LINE} />
                            <rect x="104" y={13 + i * 19} width="10" height="7" rx="2" fill={T_ACC} opacity=".7" />
                        </g>
                    ))}
                </>,
            );
        case 'specs':
            return box(
                <>
                    {[0, 1, 2, 3].map((i) => (
                        <g key={i}>
                            <rect x="10" y={11 + i * 15} width="34" height="5" rx="2.5" fill={T_DIM} />
                            <rect x="70" y={11 + i * 15} width="52" height="5" rx="2.5" fill={T_LINE} />
                        </g>
                    ))}
                </>,
            );
        case 'note':
            return box(
                <>
                    {lines(4, 12, 14)}
                    <rect x="10" y="12" width="42" height="5" rx="2.5" fill={T_ACC} opacity=".7" />
                </>,
            );
        default:
            return box(<rect x="10" y="10" width="112" height="48" rx="6" fill={T_DIM} />);
    }
}

/**
 * "Add a widget" drawer: search + category chips over a grid of preview cards.
 * Picking a card hands the widget type back to the board, which decides where
 * to place it.
 */
export function WidgetLibrary({ types = [], onAdd, onClose }) {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState(null);

    // Derived from the live type list so plugin-contributed categories show up
    // without a second source of truth.
    const categories = useMemo(
        () => [...new Set(types.map((type) => type.cat).filter(Boolean))],
        [types],
    );

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return types.filter((type) => {
            if (category && type.cat !== category) return false;
            if (!needle) return true;
            return `${type.name} ${type.desc || ''}`.toLowerCase().includes(needle);
        });
    }, [types, query, category]);

    return (
        <Drawer
            flush
            open
            onOpenChange={(next) => { if (!next) onClose?.(); }}
            title={t('app.widgetLibrary.addAWidget', 'Add a widget')}
            subtitle={t('app.widgetLibrary.typesDragToRepositionAfterAdding', '{{length}} types · drag to reposition after adding', { length: types.length })}
            icon={<LayoutGrid size={18} />}
            width={720}
            className="skw-lib"
        >
            <div className="skw-lib__filters">
                <SearchField
                    className="skw-lib__search"
                    value={query}
                    onSearch={setQuery}
                    placeholder={t('app.widgetLibrary.searchWidgets', 'Search widgets…')}
                />
                <div className="skw-lib__chips">
                    <SharedButton variant="unstyled"
                        type="button"
                        className={`skw-lib__chip${category ? '' : ' skw-lib__chip--on'}`}
                        aria-pressed={!category}
                        onClick={() => setCategory(null)}
                    >
                        {t('common.labels.all', 'All')}
                    </SharedButton>
                    {categories.map((name) => (
                        <SharedButton variant="unstyled"
                            key={name}
                            type="button"
                            className={`skw-lib__chip${category === name ? ' skw-lib__chip--on' : ''}`}
                            aria-pressed={category === name}
                            onClick={() => setCategory(category === name ? null : name)}
                        >
                            {name}
                        </SharedButton>
                    ))}
                </div>
            </div>

            <div className="skw-lib__grid">
                {visible.map((type) => {
                    const Icon = iconOf(type);
                    const add = () => onAdd?.(type);
                    return (
                        // Kept as a div (not a <button>) so the ported card CSS,
                        // which nests block-level rows, still applies; role +
                        // key handling give it the same keyboard behaviour.
                        <div
                            className="skw-lib__card"
                            key={type.id}
                            role="button"
                            tabIndex={0}
                            aria-label={t('app.widgetLibrary.addWidget', 'Add {{name}} widget', { name: type.name })}
                            onClick={add}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    add();
                                }
                            }}
                        >
                            <div className="skw-lib__thumb">
                                <WidgetThumb type={type.id} />
                                <span className="skw-lib__add">
                                    <Plus size={14} aria-hidden="true" />
                                    {t('common.actions.add', 'Add')}
                                </span>
                            </div>
                            <div className="skw-lib__meta">
                                <div className="skw-lib__name">
                                    <span className="skw-lib__icon"><Icon size={13} aria-hidden="true" /></span>
                                    {type.name}
                                    <span className="skw-lib__size">{type.w}×{type.h}</span>
                                </div>
                                <div className="skw-lib__desc">{type.desc}</div>
                            </div>
                        </div>
                    );
                })}
                {visible.length === 0 && (
                    <div className="skw-lib__empty">{t('app.widgetLibrary.noWidgetsMatch', 'No widgets match.')}</div>
                )}
            </div>
        </Drawer>
    );
}

export default WidgetLibrary;
