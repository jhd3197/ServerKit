import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const HISTORY_KEY = 'serverkit_query_history';
const MAX_HISTORY = 50;

const QueryRunner = ({ database, dbType, onClose }) => {
    const toast = useToast();
    const textareaRef = useRef(null);

    const [query, setQuery] = useState('');
    const [results, setResults] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [readonly, setReadonly] = useState(true);
    const [tables, setTables] = useState([]);
    const [selectedTable, setSelectedTable] = useState(null);
    const [tableStructure, setTableStructure] = useState(null);
    const [history, setHistory] = useState([]);
    const [showHistory, setShowHistory] = useState(false);
    const [sortConfig, setSortConfig] = useState({ column: null, direction: 'asc' });
    const [isAdmin, setIsAdmin] = useState(false);

    useEffect(() => {
        loadTables();
        loadHistory();
        checkAdminStatus();

        // Focus textarea on mount
        if (textareaRef.current) {
            textareaRef.current.focus();
        }
    }, []);

    async function checkAdminStatus() {
        try {
            const user = await api.getCurrentUser();
            setIsAdmin(user.role === 'admin');
        } catch (err) {
            console.error('Failed to check admin status:', err);
        }
    }

    async function loadTables() {
        try {
            let data;
            if (dbType === 'mysql') {
                data = await api.getMySQLTables(database.name);
            } else if (dbType === 'postgresql') {
                data = await api.getPostgreSQLTables(database.name);
            } else if (dbType === 'sqlite') {
                data = await api.getSQLiteTables(database.path);
            } else if (dbType === 'docker') {
                data = await api.getDockerDatabaseTables(database.container, database.name, database.password);
            }
            setTables(data?.tables || []);
        } catch (err) {
            console.error('Failed to load tables:', err);
        }
    }

    function loadHistory() {
        try {
            const stored = localStorage.getItem(HISTORY_KEY);
            if (stored) {
                const allHistory = JSON.parse(stored);
                const dbKey = dbType === 'sqlite' ? database.path : database.name;
                setHistory(allHistory[dbKey] || []);
            }
        } catch (err) {
            console.error('Failed to load query history:', err);
        }
    }

    function saveToHistory(sql) {
        try {
            const stored = localStorage.getItem(HISTORY_KEY);
            const allHistory = stored ? JSON.parse(stored) : {};
            const dbKey = dbType === 'sqlite' ? database.path : database.name;

            const dbHistory = allHistory[dbKey] || [];
            // Remove duplicate if exists
            const filtered = dbHistory.filter(h => h.query !== sql);
            // Add to front
            filtered.unshift({
                query: sql,
                timestamp: new Date().toISOString()
            });
            // Limit size
            allHistory[dbKey] = filtered.slice(0, MAX_HISTORY);

            localStorage.setItem(HISTORY_KEY, JSON.stringify(allHistory));
            setHistory(allHistory[dbKey]);
        } catch (err) {
            console.error('Failed to save query history:', err);
        }
    }

    async function executeQuery() {
        if (!query.trim()) {
            setError('Please enter a query');
            return;
        }

        setLoading(true);
        setError('');
        setResults(null);

        try {
            let result;
            if (dbType === 'mysql') {
                result = await api.executeMySQLQuery(database.name, query, readonly);
            } else if (dbType === 'postgresql') {
                result = await api.executePostgreSQLQuery(database.name, query, readonly);
            } else if (dbType === 'sqlite') {
                result = await api.executeSQLiteQuery(database.path, query, readonly);
            } else if (dbType === 'docker') {
                result = await api.executeDockerQuery(database.container, database.name, query, database.password, readonly);
            }

            if (result.success) {
                setResults(result);
                saveToHistory(query);
                toast.success(`Query executed in ${result.execution_time}s (${result.row_count} rows)`);
            } else {
                setError(result.error || 'Query execution failed');
            }
        } catch (err) {
            setError(err.message || 'Failed to execute query');
        } finally {
            setLoading(false);
        }
    }

    async function loadTableStructure(table) {
        setSelectedTable(table);
        try {
            let result;
            if (dbType === 'mysql') {
                result = await api.getMySQLTableStructure(database.name, table.name);
            } else if (dbType === 'postgresql') {
                result = await api.getPostgreSQLTableStructure(database.name, table.name);
            } else if (dbType === 'sqlite') {
                result = await api.getSQLiteTableStructure(database.path, table.name);
            }
            if (result.success) {
                setTableStructure(result.columns);
            }
        } catch (err) {
            console.error('Failed to load table structure:', err);
        }
    }

    function insertTableName(tableName) {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newQuery = query.substring(0, start) + tableName + query.substring(end);
        setQuery(newQuery);

        // Restore focus and position cursor after table name
        setTimeout(() => {
            textarea.focus();
            textarea.setSelectionRange(start + tableName.length, start + tableName.length);
        }, 0);
    }

    function insertSelectAll(tableName) {
        setQuery(`SELECT * FROM ${tableName} LIMIT 100;`);
        if (textareaRef.current) {
            textareaRef.current.focus();
        }
    }

    function handleKeyDown(e) {
        // Ctrl+Enter or Cmd+Enter to execute
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            executeQuery();
        }
    }

    function handleSort(columnIndex) {
        setSortConfig(prev => ({
            column: columnIndex,
            direction: prev.column === columnIndex && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    }

    function getSortedRows() {
        if (!results?.rows || sortConfig.column === null) {
            return results?.rows || [];
        }

        return [...results.rows].sort((a, b) => {
            const aVal = a[sortConfig.column];
            const bVal = b[sortConfig.column];

            // Handle nulls
            if (aVal === null && bVal === null) return 0;
            if (aVal === null) return 1;
            if (bVal === null) return -1;

            // Try numeric comparison
            const aNum = Number(aVal);
            const bNum = Number(bVal);
            if (!isNaN(aNum) && !isNaN(bNum)) {
                return sortConfig.direction === 'asc' ? aNum - bNum : bNum - aNum;
            }

            // String comparison
            const comparison = String(aVal).localeCompare(String(bVal));
            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });
    }

    function exportToCSV() {
        if (!results?.columns || !results?.rows) return;

        const escape = (val) => {
            if (val === null) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const header = results.columns.map(escape).join(',');
        const rows = results.rows.map(row => row.map(escape).join(','));
        const csv = [header, ...rows].join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `query_results_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);

        toast.success('Results exported to CSV');
    }

    const dbName = dbType === 'sqlite' ? database.name : database.name;

    return (
        <div className="modal-overlay query-runner-overlay" onClick={onClose}>
            <div className="query-runner-modal" onClick={e => e.stopPropagation()}>
                <div className="query-runner-header">
                    <div className="query-runner-title">
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                            <polyline points="16 18 22 12 16 6"/>
                            <polyline points="8 6 2 12 8 18"/>
                        </svg>
                        <span>Query Runner - {dbName}</span>
                        <span className={`db-type-badge ${dbType}`}>
                            {dbType === 'mysql' ? 'MySQL' : dbType === 'postgresql' ? 'PostgreSQL' : dbType === 'docker' ? 'Docker MySQL' : 'SQLite'}
                        </span>
                    </div>
                    <div className="query-runner-actions">
                        {isAdmin && (
                            <label className="readonly-toggle">
                                <input
                                    type="checkbox"
                                    checked={!readonly}
                                    onChange={(e) => setReadonly(!e.target.checked)}
                                />
                                <span>Allow write queries</span>
                            </label>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => setShowHistory(!showHistory)}>
                            History
                        </button>
                        <button className="modal-close" onClick={onClose}>&times;</button>
                    </div>
                </div>

                <div className="query-runner-body">
                    <div className="query-runner-sidebar">
                        <div className="sidebar-section">
                            <h4>Tables ({tables.length})</h4>
                            <div className="tables-list">
                                {tables.map(table => (
                                    <div
                                        key={table.name}
                                        className={`table-item ${selectedTable?.name === table.name ? 'selected' : ''}`}
                                        onClick={() => loadTableStructure(table)}
                                    >
                                        <span className="table-name" title={table.name}>{table.name}</span>
                                        <span className="table-rows">{table.rows}</span>
                                    </div>
                                ))}
                                {tables.length === 0 && (
                                    <p className="hint">No tables found</p>
                                )}
                            </div>
                        </div>

                        {selectedTable && tableStructure && (
                            <div className="sidebar-section">
                                <h4>
                                    {selectedTable.name}
                                    <button
                                        className="btn-icon"
                                        title="SELECT * FROM table"
                                        onClick={() => insertSelectAll(selectedTable.name)}
                                    >
                                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                                            <polyline points="9 11 12 14 22 4"/>
                                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
                                        </svg>
                                    </button>
                                </h4>
                                <div className="columns-list">
                                    {tableStructure.map(col => (
                                        <div
                                            key={col.name}
                                            className="column-item"
                                            onClick={() => insertTableName(col.name)}
                                            title={`${col.type}${col.nullable ? '' : ' NOT NULL'}${col.key === 'PRI' || col.primary_key ? ' PRIMARY KEY' : ''}`}
                                        >
                                            <span className="column-name">{col.name}</span>
                                            <span className="column-type">{col.type}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="query-runner-main">
                        <div className="query-editor">
                            <textarea
                                ref={textareaRef}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Enter your SQL query here... (Ctrl+Enter to execute)"
                                spellCheck={false}
                            />
                            <div className="query-actions">
                                <div className="query-hints">
                                    {readonly && (
                                        <span className="hint">
                                            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                            </svg>
                                            Readonly mode - only SELECT, SHOW, DESCRIBE allowed
                                        </span>
                                    )}
                                </div>
                                <button
                                    className="btn btn-primary"
                                    onClick={executeQuery}
                                    disabled={loading || !query.trim()}
                                >
                                    {loading ? 'Executing...' : 'Execute (Ctrl+Enter)'}
                                </button>
                            </div>
                        </div>

                        {error && (
                            <div className="query-error">
                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <line x1="15" y1="9" x2="9" y2="15"/>
                                    <line x1="9" y1="9" x2="15" y2="15"/>
                                </svg>
                                {error}
                            </div>
                        )}

                        {results && (
                            <div className="query-results">
                                <div className="results-header">
                                    <span className="results-info">
                                        {results.row_count} row{results.row_count !== 1 ? 's' : ''}
                                        {results.truncated && ` (truncated from ${results.total_rows})`}
                                        {' - '}{results.execution_time}s
                                    </span>
                                    <button
                                        className="btn btn-secondary btn-sm"
                                        onClick={exportToCSV}
                                        disabled={!results.rows?.length}
                                    >
                                        Export CSV
                                    </button>
                                </div>

                                {results.columns?.length > 0 ? (
                                    <div className="results-table-container">
                                        <table className="results-table">
                                            <thead>
                                                <tr>
                                                    {results.columns.map((col, idx) => (
                                                        <th
                                                            key={idx}
                                                            onClick={() => handleSort(idx)}
                                                            className={sortConfig.column === idx ? `sorted-${sortConfig.direction}` : ''}
                                                        >
                                                            {col}
                                                            {sortConfig.column === idx && (
                                                                <span className="sort-indicator">
                                                                    {sortConfig.direction === 'asc' ? ' ▲' : ' ▼'}
                                                                </span>
                                                            )}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {getSortedRows().map((row, rowIdx) => (
                                                    <tr key={rowIdx}>
                                                        {row.map((cell, cellIdx) => (
                                                            <td key={cellIdx} className={cell === null ? 'null-value' : ''}>
                                                                {cell === null ? 'NULL' : String(cell)}
                                                            </td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <p className="hint">Query executed successfully. No results to display.</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {showHistory && (
                    <div className="query-history-panel">
                        <div className="history-header">
                            <h4>Query History</h4>
                            <button className="modal-close" onClick={() => setShowHistory(false)}>&times;</button>
                        </div>
                        <div className="history-list">
                            {history.length === 0 ? (
                                <p className="hint">No query history</p>
                            ) : (
                                history.map((item, idx) => (
                                    <div
                                        key={idx}
                                        className="history-item"
                                        onClick={() => {
                                            setQuery(item.query);
                                            setShowHistory(false);
                                            if (textareaRef.current) {
                                                textareaRef.current.focus();
                                            }
                                        }}
                                    >
                                        <code>{item.query}</code>
                                        <span className="history-time">
                                            {new Date(item.timestamp).toLocaleString()}
                                        </span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default QueryRunner;
