import { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import api from '../services/api';
import socketService from '../services/socket';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

/**
 * RemoteTerminal - Interactive terminal component for remote server access
 *
 * Props:
 *   serverId: string - The server ID to connect to
 *   onClose: function - Called when terminal is closed
 */
export default function RemoteTerminal({ serverId, onClose }) {
    const { t } = useTranslation();
    const terminalRef = useRef(null);
    const terminalInstance = useRef(null);
    const fitAddon = useRef(null);
    const attemptedForServer = useRef(null);
    const [sessionId, setSessionId] = useState(null);
    const [connected, setConnected] = useState(false);
    const [error, setError] = useState(null);
    const [shellName, setShellName] = useState('');

    // Initialize terminal
    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            // Redesign palette (xterm needs literal hex — keep in sync with
            // the .terminal-content well in _logs-drawer.scss).
            theme: {
                background: '#0a0b0e',
                foreground: '#c4cdda',
                cursor: '#8b93ff',
                cursorAccent: '#0a0b0e',
                selectionBackground: 'rgba(109, 124, 255, 0.35)',
                black: '#1c2029',
                red: '#fb6f6f',
                green: '#3ddc97',
                yellow: '#f5b945',
                blue: '#6d7cff',
                magenta: '#b07bf5',
                cyan: '#49c7f0',
                white: '#c4cdda',
                brightBlack: '#646b7a',
                brightRed: '#ff9292',
                brightGreen: '#6ae8b2',
                brightYellow: '#ffd075',
                brightBlue: '#8b93ff',
                brightMagenta: '#c79bf8',
                brightCyan: '#74d9f5',
                brightWhite: '#e9ebf0'
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
        if (attemptedForServer.current === serverId) return;
        attemptedForServer.current = serverId;

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
            }
        };

        createSession();
    }, [serverId]);

    // Handle terminal input. Keystrokes MUST be serialized: each send is its
    // own HTTP POST, and parallel POSTs can reach the agent out of order,
    // scrambling fast typing. Queue input and flush sequentially, coalescing
    // whatever arrived while the previous chunk was in flight.
    const inputQueue = useRef('');
    const inputSending = useRef(false);

    useEffect(() => {
        if (!terminalInstance.current || !sessionId || !connected) return;

        const term = terminalInstance.current;
        inputQueue.current = '';

        const flushInput = async () => {
            if (inputSending.current) return;
            inputSending.current = true;
            try {
                while (inputQueue.current) {
                    const chunk = inputQueue.current;
                    inputQueue.current = '';
                    await api.sendTerminalInput(sessionId, btoa(chunk));
                }
            } catch (err) {
                console.error('Failed to send terminal input:', err);
                inputQueue.current = '';
            } finally {
                inputSending.current = false;
            }
            // drain anything that raced the flag reset
            if (inputQueue.current) flushInput();
        };

        const inputDisposable = term.onData((data) => {
            inputQueue.current += data;
            flushInput();
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

    // Listen for terminal output: the agent streams base64 PTY data on the
    // channel `terminal:<session_id>`, which the agent gateway rebroadcasts as
    // `server_stream` events into a room we join via subscribe_terminal.
    useEffect(() => {
        if (!sessionId) return;

        socketService.connect();
        const sock = socketService.socket;
        if (!sock) return;

        const channel = `terminal:${sessionId}`;

        const handleStream = (msg) => {
            if (msg?.channel !== channel || !terminalInstance.current) return;
            const payload = msg.data || {};
            if (payload.type === 'output' && payload.data) {
                try {
                    terminalInstance.current.write(atob(payload.data));
                } catch (err) {
                    console.error('Failed to decode terminal output:', err);
                }
            } else if (payload.type === 'closed') {
                terminalInstance.current.writeln('');
                terminalInstance.current.writeln('\x1b[1;33mSession closed\x1b[0m');
                setConnected(false);
            }
        };
        const subscribe = () => sock.emit('subscribe_terminal', { session_id: sessionId });

        sock.on('server_stream', handleStream);
        sock.on('connect', subscribe); // re-join the room after reconnects
        if (sock.connected) subscribe();

        return () => {
            sock.off('server_stream', handleStream);
            sock.off('connect', subscribe);
            if (sock.connected) sock.emit('unsubscribe_terminal', { session_id: sessionId });
        };
    }, [sessionId]);

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
                <span className="terminal-ico">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                        <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
                    </svg>
                </span>
                <div className="terminal-titles">
                    <div className="terminal-title">
                        <span className={`terminal-status ${connected ? 'connected' : 'disconnected'}`} />
                        <span>{shellName || t('app.remoteTerminal.terminal', 'Terminal')}</span>
                    </div>
                    {sessionId && <span className="session-id">{sessionId}</span>}
                </div>
                <div className="terminal-actions">
                    <SharedButton variant="unstyled" type="button"
                        className="terminal-close-btn"
                        onClick={handleClose}
                        title={t('app.remoteTerminal.closeTerminal', 'Close terminal')}
                    >
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </SharedButton>
                </div>
            </div>
            <div
                ref={terminalRef}
                className="terminal-content"
                onClick={handleClick}
            />
            {error && (
                <div className="terminal-alert">
                    {error}
                </div>
            )}
        </div>
    );
}
