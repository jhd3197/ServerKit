import { Skeleton } from './Skeleton';

/**
 * PageSkeleton — a loading placeholder shaped like the page that is loading.
 *
 * The point of a skeleton is to predict the layout that is about to appear, so
 * arrival is a fill-in rather than a jump. One generic shape reused everywhere
 * cannot do that: it mispredicts on every page but the one it was drawn for,
 * which is worse than honest, because it promises a layout that never comes.
 *
 * So this is a set of layout archetypes. Pick the one whose shape the page
 * actually has:
 *
 *   panel    generic card + lines (the historical default; a safe fallback)
 *   table    toolbar, column header, N rows — list/index pages
 *   feed     grouped rows with a leading status glyph — activity streams
 *   cards    a responsive grid of equal cards — catalogs, galleries
 *   detail   entity header, stat strip, two content panels
 *   console  toolbar + monospace lines of ragged width — logs, terminals
 *   form     label/field pairs, then a footer action
 *   chart    stat tiles above a plot area — monitoring, telemetry
 *   tree     a narrow rail beside a content pane — file/db explorers
 *   split    a wide content column beside a narrower sidebar
 *
 * `rows` tunes the repeat count for the variants that repeat (table, feed,
 * cards, console, form, tree). Every variant is driven by SCSS in
 * `styles/components/_skeleton.scss`, so widths stay responsive rather than
 * being guessed in pixels here.
 *
 * For a pixel-exact skeleton of one specific region, prefer captured bones —
 * `npm run capture:skeletons` measures the real DOM and SkeletonBoundary
 * replays it. These archetypes are the broad-coverage answer for the ~30 pages
 * that will never be worth capturing individually.
 */

// A deterministic ragged width, so repeated lines look like text rather than a
// row of identical bars — and so they don't reshuffle on every render the way
// Math.random() would.
const raggedWidth = (i, spread = [92, 74, 88, 62, 96, 70, 84, 58]) => `${spread[i % spread.length]}%`;

const range = (n) => Array.from({ length: n }, (_, i) => i);

function TableSkeleton({ rows }) {
    return (
        <div className="sk-page sk-page--table">
            <div className="sk-page__toolbar">
                <Skeleton variant="block" width={220} height={34} radius={9} />
                <Skeleton variant="block" width={150} height={34} radius={9} />
                <Skeleton variant="block" width={230} height={34} radius={9} className="sk-page__push" />
            </div>
            <div className="sk-page__table">
                <div className="sk-page__thead">
                    {range(5).map((i) => (
                        <Skeleton key={i} variant="line" height={9} width={i === 0 ? '55%' : '40%'} />
                    ))}
                </div>
                {range(rows).map((r) => (
                    <div className="sk-page__trow" key={r}>
                        <div className="sk-page__cell sk-page__cell--lead">
                            <Skeleton variant="block" width={30} height={30} radius={8} />
                            <div className="skeleton-stack">
                                <Skeleton variant="line" width={raggedWidth(r)} />
                                <Skeleton variant="line" width="38%" height={9} />
                            </div>
                        </div>
                        {range(4).map((c) => (
                            <Skeleton key={c} variant="line" width={raggedWidth(r + c + 1)} />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function FeedSkeleton({ rows }) {
    // Two groups, so the group headings that a real feed shows are predicted too.
    const groups = [Math.ceil(rows / 2), Math.floor(rows / 2)].filter(Boolean);
    return (
        <div className="sk-page sk-page--feed">
            <div className="sk-page__toolbar">
                <Skeleton variant="block" width={300} height={34} radius={9} />
                <Skeleton variant="block" width={160} height={34} radius={9} />
            </div>
            {groups.map((count, g) => (
                <div className="sk-page__group" key={g}>
                    <Skeleton variant="line" width={70} height={9} />
                    {range(count).map((r) => (
                        <div className="sk-page__feedrow" key={r}>
                            <Skeleton variant="circle" width={16} height={16} />
                            <div className="skeleton-stack">
                                <Skeleton variant="line" width={raggedWidth(r + g)} height={13} />
                                <Skeleton variant="line" width="46%" height={9} />
                            </div>
                            <div className="sk-page__ticks">
                                {range(6).map((t) => <Skeleton key={t} variant="block" width={7} height={15} radius={2} />)}
                            </div>
                            <Skeleton variant="line" width={70} height={10} />
                            <Skeleton variant="line" width={54} height={10} />
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}

function CardsSkeleton({ rows }) {
    return (
        <div className="sk-page sk-page--cards">
            {range(rows).map((c) => (
                <div className="sk-page__card" key={c}>
                    <div className="sk-page__card-top">
                        <Skeleton variant="block" width={42} height={42} radius={11} />
                        <div className="skeleton-stack">
                            <Skeleton variant="line" width="62%" height={14} />
                            <Skeleton variant="line" width="34%" height={9} />
                        </div>
                    </div>
                    <Skeleton variant="line" width="100%" />
                    <Skeleton variant="line" width={raggedWidth(c)} />
                    <div className="sk-page__card-tags">
                        <Skeleton variant="block" width={58} height={18} radius={5} />
                        <Skeleton variant="block" width={44} height={18} radius={5} />
                        <Skeleton variant="block" width={50} height={18} radius={5} />
                    </div>
                </div>
            ))}
        </div>
    );
}

function DetailSkeleton() {
    return (
        <div className="sk-page sk-page--detail">
            <div className="sk-page__hero">
                <Skeleton variant="block" width={52} height={52} radius={13} />
                <div className="skeleton-stack">
                    <Skeleton variant="title" width="26%" />
                    <Skeleton variant="line" width="40%" height={10} />
                </div>
                <Skeleton variant="block" width={92} height={30} radius={8} />
            </div>
            <div className="sk-page__stats">
                {range(4).map((i) => (
                    <div className="sk-page__stat" key={i}>
                        <Skeleton variant="line" width="52%" height={9} />
                        <Skeleton variant="line" width="70%" height={20} />
                    </div>
                ))}
            </div>
            <div className="sk-page__panels">
                {range(2).map((p) => (
                    <div className="sk-page__panel" key={p}>
                        <Skeleton variant="line" width="30%" height={13} />
                        {range(4).map((i) => (
                            <div className="sk-page__kv" key={i}>
                                <Skeleton variant="line" width={88} height={10} />
                                <Skeleton variant="line" width={raggedWidth(p + i)} height={10} />
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

function ConsoleSkeleton({ rows }) {
    return (
        <div className="sk-page sk-page--console">
            <div className="sk-page__conbar">
                <Skeleton variant="block" width={70} height={26} radius={7} />
                <Skeleton variant="block" width={60} height={26} radius={7} />
                <Skeleton variant="block" width={96} height={26} radius={7} />
                <Skeleton variant="block" width={190} height={26} radius={7} className="sk-page__push" />
            </div>
            <div className="sk-page__lines">
                {range(rows).map((i) => (
                    <div className="sk-page__logline" key={i}>
                        <Skeleton variant="line" width={54} height={9} />
                        <Skeleton variant="line" width={raggedWidth(i, [88, 64, 96, 46, 78, 92, 58, 70, 84, 52])} height={9} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function FormSkeleton({ rows }) {
    return (
        <div className="sk-page sk-page--form">
            {range(rows).map((i) => (
                <div className="sk-page__field" key={i}>
                    <Skeleton variant="line" width={raggedWidth(i, [110, 140, 96, 128])} height={10} />
                    <Skeleton variant="block" height={36} radius={8} />
                </div>
            ))}
            <div className="sk-page__formfoot">
                <Skeleton variant="block" width={84} height={34} radius={8} />
                <Skeleton variant="block" width={120} height={34} radius={8} />
            </div>
        </div>
    );
}

function ChartSkeleton() {
    // Bars of varied height read as a plot rather than a grey slab.
    const bars = [38, 62, 45, 78, 55, 88, 40, 70, 52, 95, 60, 74, 48, 83, 58, 66];
    return (
        <div className="sk-page sk-page--chart">
            <div className="sk-page__stats">
                {range(4).map((i) => (
                    <div className="sk-page__stat" key={i}>
                        <Skeleton variant="line" width="50%" height={9} />
                        <Skeleton variant="line" width="66%" height={22} />
                    </div>
                ))}
            </div>
            <div className="sk-page__plot">
                <div className="sk-page__plot-bars">
                    {bars.map((h, i) => (
                        <Skeleton key={i} variant="block" height={`${h}%`} radius={3} />
                    ))}
                </div>
                <div className="sk-page__plot-axis">
                    {range(6).map((i) => <Skeleton key={i} variant="line" width={38} height={8} />)}
                </div>
            </div>
        </div>
    );
}

function TreeSkeleton({ rows }) {
    return (
        <div className="sk-page sk-page--tree">
            <div className="sk-page__rail">
                <Skeleton variant="block" height={32} radius={8} />
                {range(rows).map((i) => (
                    <div className="sk-page__twig" key={i}>
                        <Skeleton variant="block" width={14} height={14} radius={4} />
                        <Skeleton variant="line" width={raggedWidth(i, [70, 88, 56, 78, 64, 92])} height={10} />
                    </div>
                ))}
            </div>
            <div className="sk-page__pane">
                <Skeleton variant="block" height={34} radius={8} />
                <div className="sk-page__lines">
                    {range(Math.max(rows, 8)).map((i) => (
                        <Skeleton key={i} variant="line" width={raggedWidth(i, [92, 70, 84, 58, 96, 66])} height={10} />
                    ))}
                </div>
            </div>
        </div>
    );
}

function SplitSkeleton({ rows }) {
    return (
        <div className="sk-page sk-page--split">
            <div className="sk-page__main">
                {range(rows).map((i) => (
                    <div className="sk-page__panel" key={i}>
                        <Skeleton variant="line" width="34%" height={13} />
                        <Skeleton variant="line" width="100%" />
                        <Skeleton variant="line" width={raggedWidth(i)} />
                    </div>
                ))}
            </div>
            <div className="sk-page__aside">
                {range(3).map((i) => (
                    <div className="sk-page__panel" key={i}>
                        <Skeleton variant="line" width="52%" height={11} />
                        <Skeleton variant="line" width="86%" height={10} />
                    </div>
                ))}
            </div>
        </div>
    );
}

function PanelSkeleton() {
    return (
        <div className="skeleton-panel">
            <div className="skeleton-panel__head">
                <Skeleton variant="avatar" />
                <div className="skeleton-panel__head-text">
                    <Skeleton variant="title" width="42%" />
                    <Skeleton variant="line" width="26%" />
                </div>
            </div>
            <div className="skeleton-panel__cards">
                <Skeleton variant="card" />
                <Skeleton variant="card" />
                <Skeleton variant="card" />
            </div>
            <div className="skeleton-panel__rows">
                <Skeleton variant="line" width="100%" />
                <Skeleton variant="line" width="92%" />
                <Skeleton variant="line" width="76%" />
            </div>
        </div>
    );
}

const VARIANTS = {
    panel: PanelSkeleton,
    table: TableSkeleton,
    feed: FeedSkeleton,
    cards: CardsSkeleton,
    detail: DetailSkeleton,
    console: ConsoleSkeleton,
    form: FormSkeleton,
    chart: ChartSkeleton,
    tree: TreeSkeleton,
    split: SplitSkeleton,
};

// Sensible repeat counts per variant — enough to fill a viewport without
// animating dozens of nodes.
const DEFAULT_ROWS = {
    table: 6, feed: 5, cards: 8, console: 12, form: 5, tree: 9, split: 3,
};

export function PageSkeleton({ variant = 'panel', rows, className = '' }) {
    const Variant = VARIANTS[variant] || PanelSkeleton;
    const count = rows ?? DEFAULT_ROWS[variant] ?? 4;
    return (
        <div className={`sk-page-wrap ${className}`.trim()} aria-hidden="true">
            <Variant rows={count} />
        </div>
    );
}

export default PageSkeleton;
