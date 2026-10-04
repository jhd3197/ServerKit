import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, History, Download, Eraser, Lock, Unlock, Clock } from 'lucide-react';
import { useToast } from '../../contexts/useToast.js';
import { runQuery, connKey } from './dbAdapter';
import ResultsGrid from './ResultsGrid';
import SqlEditor from './SqlEditor';
import { downloadBlob } from '@/utils/downloadBlob';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

const HISTORY_KEY = 'serverkit_query_history';
const MAX_HISTORY = 50;

// Platform-aware run shortcut. Operators run ServerKit from Linux/Windows far more
// often than macOS, so default the modifier label to Ctrl and only show ⌘ on Mac.
const IS_MAC = typeof navigator !== 'undefined'
    && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';

// One SQL console bound to a single connection. Owns its editor text, results,
// readonly flag, and per-connection history. `active` gates keyboard handling so
// background (hidden) consoles don't steal Ctrl+Enter.
export default function ConsoleTab({ conn, tabId, active, isAdmin, initialQuery = '', onStatus }) {
    const { t } = useTranslation();
    const toast = useToast();
    const editorRef = useRef(null);
    const key = connKey(conn);

    const [query, setQuery] = useState(initialQuery);
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [readonly, setReadonly] = useState(true);
    const [history, setHistory] = useState([]);
    const [showHistory, setShowHistory] = useState(false);

    useEffect(() => {
        try {
            const stored = localStorage.getItem(HISTORY_KEY);
            if (stored) setHistory(JSON.parse(stored)[key] || []);
        } catch { /* ignore corrupt history */ }
    }, [key]);

    useEffect(() => {
        if (active && editorRef.current) editorRef.current.focus();
    }, [active]);

    const report = useCallback(() => {
        onStatus?.(tabId, {
            connText: `${conn.dbType} · ${conn.name || conn.path?.split('/').pop() || conn.container}`,
            readonly,
            rowCount: results?.row_count,
            execTime: results?.execution_time,
            truncated: results?.truncated,
            totalRows: results?.total_rows,
        });
    }, [onStatus, tabId, conn, readonly, results]);

    useEffect(() => { if (active) report(); }, [active, report]);

    function saveToHistory(sql) {
        try {
            const stored = localStorage.getItem(HISTORY_KEY);
            const all = stored ? JSON.parse(stored) : {};
            const list = (all[key] || []).filter((h) => h.query !== sql);
            list.unshift({ query: sql, timestamp: new Date().toISOString() });
            all[key] = list.slice(0, MAX_HISTORY);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
            setHistory(all[key]);
        } catch { /* storage full / blocked — non-fatal */ }
    }

    async function execute() {
        const sql = query.trim();
        if (!sql) { setError('Enter a query to run.'); return; }
        setLoading(true);
        setError('');
        setResults(null);
        try {
            const result = await runQuery(conn, sql, readonly);
            if (result.success) {
                setResults(result);
                saveToHistory(sql);
                toast.success(t('app.consoleTab.rowS', '{{rowcount}} row{{value}} · {{executiontime}}s', { rowcount: result.row_count, value: result.row_count === 1 ? '' : 's', executiontime: result.execution_time }));
            } else {
                setError(result.error || 'Query failed.');
            }
        } catch (err) {
            setError(err.message || 'Failed to execute query.');
        } finally {
            setLoading(false);
        }
    }

    function handleKeyDown(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            execute();
        }
    }

    function exportCsv() {
        if (!results?.columns || !results?.rows) return;
        const esc = (v) => {
            if (v === null) return '';
            const s = String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [
            results.columns.map(esc).join(','),
            ...results.rows.map((r) => r.map(esc).join(',')),
        ].join('\n');
        downloadBlob(csv, `${conn.name || 'query'}_${new Date().toISOString().slice(0, 10)}.csv`, { type: 'text/csv' });
        toast.success(t('app.consoleTab.exportedResultsToCsv', 'Exported results to CSV'));
    }

    return (
        <div className="dbx-console">
            <div className="dbx-console-toolbar">
                <SharedButton variant="unstyled"
                    type="button"
                    className="dbx-run"
                    onClick={execute}
                    disabled={loading || !query.trim()}
                    title={t('app.consoleTab.runQueryEnter', 'Run query ({{MODKEY}}+Enter)', { MODKEY: MOD_KEY })}
                >
                    <Play size={14} aria-hidden="true" />
                    {loading ? 'Running…' : 'Run'}
                    <kbd>{MOD_KEY} ↵</kbd>
                </SharedButton>

                {isAdmin && (
                    <SharedButton variant="unstyled"
                        type="button"
                        className={`dbx-toggle ${readonly ? '' : 'is-write'}`}
                        onClick={() => setReadonly((r) => !r)}
                        aria-pressed={!readonly}
                        title={readonly ? t('app.consoleTab.readOnlyOnlySelectShowDescribe', 'Read-only: only SELECT / SHOW / DESCRIBE') : t('app.consoleTab.writesEnabledBeCareful', 'Writes enabled: be careful')}
                    >
                        {readonly ? <Lock size={13} aria-hidden="true" /> : <Unlock size={13} aria-hidden="true" />}
                        {readonly ? 'Read-only' : 'Writes on'}
                    </SharedButton>
                )}

                <div className="dbx-console-toolbar-spacer" />

                <SharedButton variant="unstyled"
                    type="button"
                    className={`dbx-chip ${showHistory ? 'is-active' : ''}`}
                    onClick={() => setShowHistory((s) => !s)}
                    aria-pressed={showHistory}
                >
                    <History size={14} aria-hidden="true" /> {t('app.consoleTab.history', 'History')}
                </SharedButton>
                <SharedButton variant="unstyled" type="button" className="dbx-chip" onClick={() => { setQuery(''); editorRef.current?.focus(); }}>
                    <Eraser size={14} aria-hidden="true" /> {t('common.actions.clear', 'Clear')}
                </SharedButton>
                <SharedButton variant="unstyled" type="button" className="dbx-chip" onClick={exportCsv} disabled={!results?.rows?.length}>
                    <Download size={14} aria-hidden="true" /> {t('app.consoleTab.export', 'Export')}
                </SharedButton>
            </div>

            <div className="dbx-console-split">
                <div className="dbx-editor-wrap">
                    <SqlEditor
                        ref={editorRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('app.consoleTab.selectFromQuerying', 'SELECT * FROM … (querying {{value}})', { value: conn.name || conn.path || conn.container })}
                        ariaLabel="SQL editor"
                    />
                    {readonly && (
                        <span className="dbx-editor-badge">
                            <Lock size={11} aria-hidden="true" /> {t('app.consoleTab.readOnly', 'Read-only')}
                        </span>
                    )}
                </div>

                {showHistory && (
                    <aside className="dbx-history" aria-label={t('app.consoleTab.queryHistory', 'Query history')}>
                        <div className="dbx-history-head">{t('app.consoleTab.recentQueries', 'Recent queries')}</div>
                        {history.length === 0 ? (
                            <p className="dbx-history-empty">{t('app.consoleTab.noQueriesYet', 'No queries yet.')}</p>
                        ) : (
                            <ul>
                                {history.map((item, idx) => (
                                    <li key={idx}>
                                        <SharedButton variant="unstyled"
                                            type="button"
                                            onClick={() => { setQuery(item.query); setShowHistory(false); editorRef.current?.focus(); }}
                                        >
                                            <code>{item.query}</code>
                                            <span className="dbx-history-time">
                                                <Clock size={11} aria-hidden="true" />
                                                {new Date(item.timestamp).toLocaleString()}
                                            </span>
                                        </SharedButton>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </aside>
                )}
            </div>

            <div className="dbx-results">
                {(results || loading || error) ? (
                    // No count strip above the grid: the status bar at the foot
                    // of the explorer already reports rows, truncation and
                    // execution time for whichever tab is active, and this was
                    // the same three facts a second time.
                    <ResultsGrid
                        columns={results?.columns}
                        rows={results?.rows}
                        loading={loading}
                        error={error}
                        emptyTitle="Query ran"
                        emptyDescription="No rows returned."
                    />
                ) : (
                    <div className="dbx-console-hint">
                        <p>{t('app.consoleTab.writeSqlAboveAndPress', 'Write SQL above and press')} <kbd>{MOD_KEY}</kbd> + <kbd>{t('app.consoleTab.enter', 'Enter')}</kbd> {t('app.consoleTab.toRun', 'to run.')}</p>
                    </div>
                )}
            </div>
        </div>
    );
}
