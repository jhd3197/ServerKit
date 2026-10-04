import { forwardRef, useMemo, useRef, useCallback, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { severityOf, splitOnMatch } from './logHelpers';

const LogContent = forwardRef(function LogContent({
    content,
    loading,
    emptyMessage,
    showLineNumbers,
    wrapLines,
    searchPattern,
    live = false,
    scrollKey,
}, ref) {
    const { t } = useTranslation();
    const innerRef = useRef(null);
    // Whether the viewer is parked at the bottom (following the tail). Starts
    // true so a freshly opened log lands on its newest line.
    const followRef = useRef(true);

    // Merge our internal ref with the forwarded ref so the parent keeps its
    // direct scroll access (jump-to-end button, etc.) while we manage tailing.
    const setRefs = useCallback((node) => {
        innerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) ref.current = node;
    }, [ref]);

    const lines = useMemo(() => (content ? content.split('\n') : []), [content]);

    // Stop following once the user scrolls up; resume when they return to the
    // bottom — so live updates don't yank them away while reading history.
    const handleScroll = useCallback(() => {
        const el = innerRef.current;
        if (!el) return;
        followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    }, []);

    // New selection (different file / unit / service): jump to the newest line
    // and re-arm follow.
    useLayoutEffect(() => {
        followRef.current = true;
        const el = innerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [scrollKey]);

    // New content while following: stick to the last record.
    useLayoutEffect(() => {
        const el = innerRef.current;
        if (el && followRef.current) el.scrollTop = el.scrollHeight;
    }, [content]);

    if (loading) {
        return <div className="lv-content lv-content-loading">{t('app.logContent.loadingLog', 'Loading log…')}</div>;
    }

    if (!content) {
        return (
            <div className="lv-content lv-content-empty">
                <p>{emptyMessage || t('app.logContent.selectALogFile', 'Select a log file to view its contents.')}</p>
            </div>
        );
    }

    return (
        <div className="lv-content-wrap">
            {live && (
                <span className="lv-live-badge" title={t('app.logContent.followingTheLiveTail', 'Following the live tail')}>
                    <span className="lv-live-dot" />
                    LIVE
                </span>
            )}
            <div
                ref={setRefs}
                onScroll={handleScroll}
                className={`lv-content ${wrapLines ? 'wrap' : 'nowrap'} ${showLineNumbers ? 'with-line-numbers' : ''}`}
            >
                <div className="lv-lines" role="presentation">
                    {lines.map((line, idx) => {
                        const sev = severityOf(line);
                        const segments = searchPattern ? splitOnMatch(line, searchPattern) : null;
                        return (
                            <div key={idx} className={`lv-line ${sev ? `sev-${sev}` : ''}`}>
                                {showLineNumbers && (
                                    <span className="lv-line-no">{idx + 1}</span>
                                )}
                                <span className="lv-line-text">
                                    {segments
                                        ? segments.map((seg, i) =>
                                              seg.match ? (
                                                  <mark key={i} className="lv-match">{seg.text}</mark>
                                              ) : (
                                                  <span key={i}>{seg.text}</span>
                                              )
                                          )
                                        : (line || ' ')}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
});

export default LogContent;
