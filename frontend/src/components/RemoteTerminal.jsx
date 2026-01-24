import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import api from '../services/api';
import { useSocket } from '../contexts/SocketContext';

/**
 * RemoteTerminal - Interactive terminal component for remote server access
 *
 * Props:
 *   serverId: string - The server ID to connect to
 *   onClose: function - Called when terminal is closed
 */
export default function RemoteTerminal({ serverId, onClose }) {
    const terminalRef = useRef(null);
    const terminalInstance = useRef(null);
    const fitAddon = useRef(null);
    const [sessionId, setSessionId] = useState(null);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState(null);
    const [shellName, setShellName] = useState('');
    const { socket, connected: socketConnected } = useSocket();

    // Initialize terminal
    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
                background: '#1e1e1e',
                foreground: '#d4d4d4',
                cursor: '#ffffff',
                cursorAccent: '#1e1e1e',
                selection: 'rgba(255, 255, 255, 0.3)',
                black: '#000000',
                red: '#cd3131',
                green: '#0dbc79',
                yellow: '#e5e510',
                blue: '#2472c8',
                magenta: '#bc3fbc',
                cyan: '#11a8cd',
                white: '#e5e5e5',
                brightBlack: '#666666',
                brightRed: '#f14c4c',
                brightGreen: '#23d18b',
                brightYellow: '#f5f543',
                brightBlue: '#3b8eea',
                brightMagenta: '#d670d6',
                brightCyan: '#29b8db',
                brightWhite: '#ffffff'
            },
            allowProposedApi: true
        });

        const fit = new FitAddon();
        const webLinks = new WebLinksAddon();

        term.loadAddon(fit);
        term.loadAddon(webLinks);
        term.open(terminalRef.current);

        // Fit terminal to container
        setTimeout(() => fit.fit(), 0);

        terminalInstance.current = term;
        fitAddon.current = fit;

        // Handle window resize
        const handleResize = () => {
            if (fitAddon.current) {
                fitAddon.current.fit();
            }
        };
        window.addEventListener('resize', handleResize);

        // Write welcome message
        term.writeln('\x1b[1;36mServerKit Remote Terminal\x1b[0m');
        term.writeln('Connecting to server...');
        term.writeln('');

        return () => {
            window.removeEventListener('resize', handleResize);
            term.dispose();
        };
    }, []);

    // Create terminal session
    useEffect(() => {
        if (!terminalInstance.current || !serverId) return;

        const createSession = async () => {
            try {
                const term = terminalInstance.current;
                const cols = term.cols;
                const rows = term.rows;

                const result = await api.createTerminalSession(serverId, cols, rows);

                if (!result.success) {
                    throw new Error(result.error || 'Failed to create terminal session');
                }

                setSessionId(result.session_id);
                setShellName(result.shell || 'shell');
                setConnected(true);

                term.writeln(`\x1b[1;32mConnected to ${result.shell}\x1b[0m`);
                term.writeln('');

            } catch (err) {
                console.error('Failed to create terminal session:', err);
                setError(err.message);
                if (terminalInstance.current) {
                    terminalInstance.current.writeln(`\x1b[1;31mError: ${err.message}\x1b[0m`);
                }
            }
        };

        createSession();
    }, [serverId]);

    // Handle terminal input
    useEffect(() => {
        if (!terminalInstance.current || !sessionId || !connected) return;

        const term = terminalInstance.current;

        // Handle user input
        const inputDisposable = term.onData(async (data) => {
            try {
                // Encode data as base64
                const encoded = btoa(data);
                await api.sendTerminalInput(sessionId, encoded);
            } catch (err) {
                console.error('Failed to send terminal input:', err);
            }
        });

        // Handle resize
        const resizeDisposable = term.onResize(async ({ cols, rows }) => {
            try {
                await api.resizeTerminal(sessionId, cols, rows);
            } catch (err) {
                console.error('Failed to resize terminal:', err);
            }
        });

        return () => {
            inputDisposable.dispose();
            resizeDisposable.dispose();
        };
    }, [sessionId, connected]);

    // Listen for terminal output via WebSocket
    useEffect(() => {
        if (!socket || !sessionId || !socketConnected) return;

        const channel = `terminal:${sessionId}`;

        const handleTerminalData = (data) => {
            if (!terminalInstance.current) return;

            if (data.type === 'output' && data.data) {
                // Decode base64 output
                try {
                    const decoded = atob(data.data);
                    terminalInstance.current.write(decoded);
                } catch (err) {
                    console.error('Failed to decode terminal output:', err);
                }
            } else if (data.type === 'closed') {
                terminalInstance.current.writeln('');
                terminalInstance.current.writeln('\x1b[1;33mSession closed\x1b[0m');
                setConnected(false);
            }
        };

        socket.on(channel, handleTerminalData);

        return () => {
            socket.off(channel, handleTerminalData);
        };
    }, [socket, sessionId, socketConnected]);

    // Cleanup session on unmount
    useEffect(() => {
        return () => {
            if (sessionId) {
                api.closeTerminalSession(sessionId).catch(console.error);
            }
        };
    }, [sessionId]);

    // Handle close button
    const handleClose = useCallback(async () => {
        if (sessionId) {
            try {
                await api.closeTerminalSession(sessionId);
            } catch (err) {
                console.error('Error closing session:', err);
            }
        }
        onClose?.();
    }, [sessionId, onClose]);

    // Focus terminal on click
    const handleClick = () => {
        terminalInstance.current?.focus();
    };

    return (
        <div className="remote-terminal-container">
            <div className="terminal-header">
                <div className="terminal-title">
                    <span className={`terminal-status ${connected ? 'connected' : 'disconnected'}`} />
                    <span>{shellName || 'Terminal'}</span>
                    {sessionId && <span className="session-id">({sessionId})</span>}
                </div>
                <div className="terminal-actions">
                    <button
                        className="terminal-close-btn"
                        onClick={handleClose}
                        title="Close terminal"
                    >
                        &times;
                    </button>
                </div>
            </div>
            <div
                ref={terminalRef}
                className="terminal-content"
                onClick={handleClick}
            />
            {error && (
                <div className="terminal-error">
                    {error}
                </div>
            )}
            <style>{`
                .remote-terminal-container {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: #1e1e1e;
                    border-radius: 6px;
                    overflow: hidden;
                }

                .terminal-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 12px;
                    background: #252526;
                    border-bottom: 1px solid #3c3c3c;
                }

                .terminal-title {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: #cccccc;
                    font-size: 13px;
                }

                .terminal-status {
                    width: 8px;
                    height: 8px;
                    border-radius: 50%;
                    background: #666;
                }

                .terminal-status.connected {
                    background: #0dbc79;
                }

                .terminal-status.disconnected {
                    background: #cd3131;
                }

                .session-id {
                    color: #666;
                    font-size: 11px;
                }

                .terminal-actions {
                    display: flex;
                    gap: 4px;
                }

                .terminal-close-btn {
                    background: none;
                    border: none;
                    color: #cccccc;
                    font-size: 18px;
                    cursor: pointer;
                    padding: 2px 6px;
                    border-radius: 4px;
                }

                .terminal-close-btn:hover {
                    background: #3c3c3c;
                }

                .terminal-content {
                    flex: 1;
                    padding: 8px;
                }

                .terminal-content .xterm {
                    height: 100%;
                }

                .terminal-error {
                    padding: 8px 12px;
                    background: #5a1d1d;
                    color: #f48771;
                    font-size: 13px;
                }
            `}</style>
        </div>
    );
}
