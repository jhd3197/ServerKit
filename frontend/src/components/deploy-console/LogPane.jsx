import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { scrollBehavior } from '@/utils/reducedMotion';
import { Button as SharedButton } from '@/components/ui/button';

// How many slices the severity map is divided into. Enough to resolve a single
// error in a long log without rendering a node per line.
const MAP_BUCKETS = 150;

// Worst-wins ranking: a slice holding one error among 200 info lines must show
// as an error, because finding that error is the entire point of the map.
const SEVERITY_RANK = { error: 4, warn: 3, warning: 3, info: 2, debug: 1 };

// Below this a scrollbar is already enough to see everything.
const MAP_MIN_LINES = 40;

// Monospace console surface. Auto-scrolls while "follow" is on; disengages when
// the user scrolls up and re-engages via a "Jump to live" chip. Lines carry a
// data-step attribute so the step rail can scroll a step into view.
//
// Alongside the log runs a severity map — the coloured strip that makes a
// failure findable in a few thousand lines: each slice is painted by the worst
// level it contains, the current viewport is outlined on it, and clicking or
// dragging jumps straight there.
export default function LogPane({
    lines, wrap, timestamps, follow, onFollowChange, scrollToStep,
    scrollTarget, stepNames = [],
}) {
    const { t } = useTranslation();
    const paneRef = useRef(null);
    const endRef = useRef(null);
    const [showJump, setShowJump] = useState(false);
    const [view, setView] = useState({ top: 0, height: 100 });
    const [collapsed, setCollapsed] = useState(() => new Set());
    const [activeLine, setActiveLine] = useState(null);

    // Consecutive runs of the same step become one collapsible section. Runs,
    // not a group-by: if output ever interleaves, the transcript still reads in
    // the order it happened rather than being silently reordered.
    const sections = useMemo(() => {
        const out = [];
        lines.forEach((ln, i) => {
            const step = ln.step_index ?? null;
            const last = out[out.length - 1];
            if (!last || last.step !== step) {
                out.push({ step, key: `${step ?? 'x'}-${i}`, rows: [], errors: 0, warns: 0 });
            }
            const section = out[out.length - 1];
            section.rows.push({ ln, i });
            const level = ln.level || 'info';
            if (level === 'error') section.errors += 1;
            else if (level === 'warn' || level === 'warning') section.warns += 1;
        });
        return out;
    }, [lines]);

    // One section is just the log — headers would be pure chrome.
    const showSections = sections.length > 1;

    const stepName = useCallback((step) => {
        if (step == null) return 'Output';
        const match = stepNames.find((s) => s.index === step);
        return match?.name || `Step ${step}`;
    }, [stepNames]);

    const toggleSection = (key) => setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
    });

    const buckets = useMemo(() => {
        const out = new Array(MAP_BUCKETS).fill(null);
        if (!lines.length) return out;
        lines.forEach((ln, i) => {
            const slot = Math.min(MAP_BUCKETS - 1, Math.floor((i / lines.length) * MAP_BUCKETS));
            const level = ln.level || 'info';
            if (out[slot] == null
                || (SEVERITY_RANK[level] || 0) > (SEVERITY_RANK[out[slot]] || 0)) {
                out[slot] = level;
            }
        });
        return out;
    }, [lines]);

    const showMap = lines.length >= MAP_MIN_LINES;

    // Follow: keep pinned to the bottom as new lines arrive.
    useEffect(() => {
        if (follow && paneRef.current) {
            paneRef.current.scrollTop = paneRef.current.scrollHeight;
            setShowJump(false);
        }
    }, [lines, follow]);

    // Scroll a given step's first line into view when the rail is clicked.
    useEffect(() => {
        if (scrollToStep == null || !paneRef.current) return;
        const el = paneRef.current.querySelector(`[data-step="${scrollToStep}"]`);
        if (el) el.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    }, [scrollToStep]);

    // Jump to a specific line — prev/next navigation, and the first error when
    // a deploy has failed. Centred rather than top-aligned so the lines that
    // led up to it are visible too, which is usually where the cause is.
    useEffect(() => {
        if (!scrollTarget || !paneRef.current) return;
        const el = paneRef.current.querySelector(`[data-line="${scrollTarget.index}"]`);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
        setActiveLine(scrollTarget.index);
    }, [scrollTarget]);

    const onScroll = () => {
        const pane = paneRef.current;
        if (!pane) return;
        const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
        if (!atBottom && follow) onFollowChange(false);
        setShowJump(!atBottom);
        const { scrollTop, scrollHeight, clientHeight } = pane;
        setView({
            top: scrollHeight ? (scrollTop / scrollHeight) * 100 : 0,
            // A floor, so the marker stays grabbable on a very long log.
            height: scrollHeight ? Math.max(3, (clientHeight / scrollHeight) * 100) : 100,
        });
    };

    // Keep the viewport marker honest as lines stream in and the log grows.
    useEffect(() => {
        const pane = paneRef.current;
        if (!pane || !pane.scrollHeight) return;
        setView({
            top: (pane.scrollTop / pane.scrollHeight) * 100,
            height: Math.max(3, (pane.clientHeight / pane.scrollHeight) * 100),
        });
    }, [lines]);

    // Click or drag anywhere on the map to go there.
    const mapScrub = useCallback((clientY, element) => {
        const pane = paneRef.current;
        if (!pane) return;
        const rect = element.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
        pane.scrollTop = ratio * pane.scrollHeight - pane.clientHeight / 2;
        onFollowChange(false);
    }, [onFollowChange]);

    const onMapDown = (event) => {
        const element = event.currentTarget;
        mapScrub(event.clientY, element);
        const move = (moveEvent) => mapScrub(moveEvent.clientY, element);
        const up = () => {
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
    };

    const jumpToLive = () => {
        onFollowChange(true);
        if (paneRef.current) paneRef.current.scrollTop = paneRef.current.scrollHeight;
        setShowJump(false);
    };

    return (
        <div className={`deploy-console__logwrap${showMap ? ' deploy-console__logwrap--mapped' : ''}`}>
            <div
                ref={paneRef}
                className={`deploy-console__log ${wrap ? 'deploy-console__log--wrap' : ''}`}
                onScroll={onScroll}
                role="log"
                aria-live="polite"
            >
                {lines.length === 0 ? (
                    <div className="deploy-console__log-empty">{t('app.logPane.waitingForOutput', 'Waiting for output…')}</div>
                ) : (
                    sections.map((section) => {
                        const isShut = collapsed.has(section.key);
                        return (
                            <div className="deploy-console__sec" key={section.key}>
                                {showSections && (
                                    <SharedButton variant="unstyled"
                                        type="button"
                                        className={`deploy-console__sec-head ${isShut ? 'is-shut' : ''}`}
                                        data-step={section.step ?? undefined}
                                        onClick={() => toggleSection(section.key)}
                                        aria-expanded={!isShut}
                                    >
                                        {isShut ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                        <span className="deploy-console__sec-name">{stepName(section.step)}</span>
                                        <span className="deploy-console__sec-meta">
                                            {section.rows.length} line{section.rows.length === 1 ? '' : 's'}
                                            {section.errors > 0 && (
                                                <b className="deploy-console__sec-err"> · {section.errors} error{section.errors === 1 ? '' : 's'}</b>
                                            )}
                                            {section.warns > 0 && ` · ${section.warns} warning${section.warns === 1 ? '' : 's'}`}
                                        </span>
                                    </SharedButton>
                                )}
                                {!isShut && section.rows.map(({ ln, i }) => {
                                    const ts = timestamps && ln.ts
                                        ? new Date(ln.ts).toLocaleTimeString()
                                        : (timestamps && ln.created_at ? new Date(ln.created_at).toLocaleTimeString() : '');
                                    return (
                                        <div
                                            key={ln.id ?? `i${i}`}
                                            data-line={i}
                                            className={`deploy-console__line deploy-console__line--${ln.level || 'info'}${activeLine === i ? ' is-current' : ''}`}
                                        >
                                            {timestamps && <span className="deploy-console__line-ts">{ts}</span>}
                                            <span className="deploy-console__line-msg">{ln.message}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })
                )}
                <div ref={endRef} />
            </div>
            {showMap && (
                <div
                    className="deploy-console__map"
                    onMouseDown={onMapDown}
                    title={t('app.logPane.logSeverityClickOrDragTo', 'Log severity: click or drag to jump')}
                >
                    {buckets.map((level, i) => (
                        <i
                            key={i}
                            aria-hidden="true"
                            className={`deploy-console__map-tick${level ? ` deploy-console__map-tick--${level}` : ''}`}
                        />
                    ))}
                    <div
                        className="deploy-console__map-view"
                        style={{ top: `${view.top}%`, height: `${view.height}%` }}
                    />
                </div>
            )}
            {showJump && (
                <SharedButton variant="unstyled" type="button" className="deploy-console__jump" onClick={jumpToLive}>
                    <ArrowDown size={14} /> {t('app.logPane.jumpToLive', 'Jump to live')}
                </SharedButton>
            )}
        </div>
    );
}
