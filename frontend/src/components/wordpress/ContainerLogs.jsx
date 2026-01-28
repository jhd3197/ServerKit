import React, { useState, useEffect, useRef } from 'react';
import { Terminal, X, Download } from 'lucide-react';
import wordpressApi from '../../services/wordpress';

const ContainerLogs = ({ projectId, envId, onClose }) => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [service, setService] = useState('wordpress');
    const [lines, setLines] = useState(100);
    const [autoScroll, setAutoScroll] = useState(true);
    const logsEndRef = useRef(null);
    const containerRef = useRef(null);

    useEffect(() => {
        loadLogs();
    }, [projectId, envId, service, lines]);

    useEffect(() => {
        if (autoScroll && logsEndRef.current) {
            logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, autoScroll]);

    async function loadLogs() {
        setLoading(true);
        try {
            const data = await wordpressApi.getEnvironmentLogs(projectId, envId, { service, lines });
            setLogs(data.logs || []);
        } catch (err) {
            console.error('Failed to load logs:', err);
            setLogs([`Error loading logs: ${err.message}`]);
        } finally {
            setLoading(false);
        }
    }

    function handleScroll() {
        if (!containerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
    }

    function handleDownload() {
        const text = logs.join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `env-${envId}-${service}-logs.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    return (
        <div className="container-logs-panel">
            <div className="container-logs-header">
                <div className="container-logs-title">
                    <Terminal size={16} />
                    <span>Container Logs</span>
                </div>
                <div className="container-logs-controls">
                    <select
                        value={service}
                        onChange={e => setService(e.target.value)}
                        className="logs-service-select"
                    >
                        <option value="wordpress">WordPress</option>
                        <option value="db">MySQL</option>
                    </select>
                    <select
                        value={lines}
                        onChange={e => setLines(Number(e.target.value))}
                        className="logs-lines-select"
                    >
                        <option value={50}>50 lines</option>
                        <option value={100}>100 lines</option>
                        <option value={500}>500 lines</option>
                    </select>
                    <button className="btn btn-ghost btn-sm" onClick={loadLogs} title="Refresh">
                        <RefreshIcon />
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={handleDownload} title="Download">
                        <Download size={14} />
                    </button>
                    {onClose && (
                        <button className="btn btn-ghost btn-sm" onClick={onClose}>
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>
            <div
                className="container-logs-body"
                ref={containerRef}
                onScroll={handleScroll}
            >
                {loading ? (
                    <div className="logs-loading">Loading logs...</div>
                ) : logs.length === 0 ? (
                    <div className="logs-empty">No logs available.</div>
                ) : (
                    <pre className="logs-content">
                        {logs.map((line, i) => (
                            <div key={i} className="log-line">{line}</div>
                        ))}
                        <div ref={logsEndRef} />
                    </pre>
                )}
            </div>
        </div>
    );
};

function RefreshIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
    );
}

export default ContainerLogs;
