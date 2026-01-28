import React, { useState, useRef, useEffect } from 'react';
import { Terminal, Play, Clock, X } from 'lucide-react';
import Spinner from '../Spinner';

const QUICK_COMMANDS = [
    { label: 'Plugin List', command: 'wp plugin list --format=table' },
    { label: 'Cache Flush', command: 'wp cache flush' },
    { label: 'DB Check', command: 'wp db check' },
    { label: 'Site URL', command: 'wp option get siteurl' },
];

const HISTORY_KEY = 'wp_cli_history';
const MAX_HISTORY = 50;

const WpCliTerminal = ({ environment, prodId, onClose, api }) => {
    const [command, setCommand] = useState('');
    const [output, setOutput] = useState([]);
    const [executing, setExecuting] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historyIndex, setHistoryIndex] = useState(-1);

    const inputRef = useRef(null);
    const outputRef = useRef(null);

    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [output]);

    function saveToHistory(cmd) {
        const updated = [cmd, ...history.filter(h => h !== cmd)].slice(0, MAX_HISTORY);
        localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    }

    async function executeCommand(cmd) {
        if (!cmd.trim()) return;

        const cmdStr = cmd.trim();
        setCommand('');
        setExecuting(true);
        saveToHistory(cmdStr);
        setHistoryIndex(-1);

        setOutput(prev => [...prev, { type: 'command', text: cmdStr }]);

        try {
            const result = await api.executeWpCli(prodId, environment.id, cmdStr);
            if (result.success) {
                setOutput(prev => [...prev, { type: 'output', text: result.output || '(no output)' }]);
            } else {
                setOutput(prev => [...prev, { type: 'error', text: result.error || 'Command failed' }]);
            }
        } catch (err) {
            setOutput(prev => [...prev, { type: 'error', text: err.message || 'Execution failed' }]);
        } finally {
            setExecuting(false);
            inputRef.current?.focus();
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter' && !executing) {
            executeCommand(command);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (history.length > 0) {
                const newIndex = Math.min(historyIndex + 1, history.length - 1);
                setHistoryIndex(newIndex);
                setCommand(history[newIndex]);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setCommand(history[newIndex]);
            } else {
                setHistoryIndex(-1);
                setCommand('');
            }
        }
    }

    const envName = environment?.name || 'Environment';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal wpcli-terminal-modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>
                        <Terminal size={18} />
                        WP-CLI - {envName}
                    </h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="wpcli-quick-actions">
                    {QUICK_COMMANDS.map(qc => (
                        <button
                            key={qc.command}
                            className="btn btn-ghost btn-sm"
                            onClick={() => executeCommand(qc.command)}
                            disabled={executing}
                        >
                            {qc.label}
                        </button>
                    ))}
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setShowHistory(!showHistory)}
                        title="Command history"
                    >
                        <Clock size={12} />
                    </button>
                </div>

                {showHistory && history.length > 0 && (
                    <div className="wpcli-history">
                        {history.slice(0, 10).map((cmd, i) => (
                            <button
                                key={i}
                                className="wpcli-history-item"
                                onClick={() => {
                                    setCommand(cmd);
                                    setShowHistory(false);
                                    inputRef.current?.focus();
                                }}
                            >
                                <code>{cmd}</code>
                            </button>
                        ))}
                    </div>
                )}

                <div className="wpcli-output" ref={outputRef}>
                    {output.length === 0 && (
                        <div className="wpcli-output-empty">
                            Enter a WP-CLI command below or use the quick actions above.
                        </div>
                    )}
                    {output.map((entry, i) => (
                        <div key={i} className={`wpcli-output-entry ${entry.type}`}>
                            {entry.type === 'command' && (
                                <div className="wpcli-output-command">
                                    <span className="wpcli-prompt">$</span>
                                    <code>{entry.text}</code>
                                </div>
                            )}
                            {entry.type === 'output' && (
                                <pre className="wpcli-output-text">{entry.text}</pre>
                            )}
                            {entry.type === 'error' && (
                                <pre className="wpcli-output-error">{entry.text}</pre>
                            )}
                        </div>
                    ))}
                    {executing && (
                        <div className="wpcli-executing">
                            <Spinner size="sm" />
                            <span>Executing...</span>
                        </div>
                    )}
                </div>

                <div className="wpcli-input-row">
                    <span className="wpcli-prompt">$</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={command}
                        onChange={e => setCommand(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="wp plugin list --format=table"
                        disabled={executing}
                        className="wpcli-input"
                    />
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => executeCommand(command)}
                        disabled={executing || !command.trim()}
                    >
                        <Play size={12} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default WpCliTerminal;
