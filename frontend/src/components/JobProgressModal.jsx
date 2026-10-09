import { useCallback, useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import { Button } from '@/components/ui/button';
import { rooms, SOCKET_EVENTS } from '@/constants/events';
import { useServerStream } from '@/hooks/useServerStream';
import { scrollBehavior } from '@/utils/reducedMotion';
import { useTranslation } from 'react-i18next';

// Subscribes to a remote agent's job:<id> stream channel and renders
// the live log output. Used by PackagesTab and ServicesTab for
// long-running install / upgrade / journal-follow operations.
//
// The agent emits {phase, lines[], message, percent, exit_code, error}
// events on the channel. The panel re-broadcasts those over Socket.IO
// as `server_stream` events into room `server_<serverId>_<channel>`.
// We join the room on mount, listen for matching server_stream events,
// and surface a "done" phase as success/error in the footer.
export default function JobProgressModal({
    open,
    serverId,
    channel,
    title = 'Working…',
    onClose,
    onComplete,
}) {
    const { t } = useTranslation();
    const [lines, setLines] = useState([]);
    const [done, setDone] = useState(null); // null | { exitCode, error, extra }
    const logEndRef = useRef(null);

    const onStream = useCallback((msg) => {
        if (msg?.channel !== channel) return;
        const ev = msg.data || {};
        if (Array.isArray(ev.lines) && ev.lines.length) {
            setLines((prev) => [...prev, ...ev.lines]);
        } else if (ev.message) {
            setLines((prev) => [...prev, ev.message]);
        }
        if (ev.phase === 'done') {
            const exitCode = typeof ev.exit_code === 'number' ? ev.exit_code : null;
            setDone({
                exitCode,
                error: ev.error || '',
                extra: ev.extra || null,
            });
            if (onComplete) onComplete(ev);
        }
    }, [channel, onComplete]);

    useServerStream(
        serverId && channel ? rooms.serverChannel(serverId, channel) : null,
        SOCKET_EVENTS.SERVER_STREAM,
        onStream,
        { enabled: open },
    );

    // Reset state on close so the next job starts fresh.
    useEffect(() => {
        if (!open) {
            setLines([]);
            setDone(null);
        }
    }, [open]);

    // Auto-scroll to the bottom as new lines arrive.
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: scrollBehavior() });
    }, [lines.length]);

    const success = done && done.exitCode === 0 && !done.error;
    const failure = done && !success;

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={title}
            size="xl"
            footer={
                <div className="flex items-center gap-3 w-full">
                    <div className="flex-1">
                        {!done && <span className="text-muted-foreground text-sm">{t('app.jobProgressModal.streamingProgress', 'Streaming progress…')}</span>}
                        {success && <span className="text-success text-sm">{t('app.jobProgressModal.completedSuccessfully', 'Completed')}</span>}
                        {failure && (
                            <span className="text-destructive text-sm">
                                {t('common.state.failed', 'Failed')}{done.exitCode !== null ? ` ${t('app.jobProgressModal.exitCode', '(exit {{code}})', { code: done.exitCode })}` : ''}
                                {done.error ? `: ${done.error}` : ''}
                            </span>
                        )}
                    </div>
                    <Button variant="outline" onClick={onClose} disabled={!done}>
                        {done ? t('common.actions.close', 'Close') : t('app.jobProgressModal.working', 'Working…')}
                    </Button>
                </div>
            }
        >
            <div className="job-progress-modal">
                {lines.length === 0 && !done && (
                    <p className="text-muted-foreground text-sm">{t('app.jobProgressModal.waitingForTheAgentToBegin', 'Waiting for the agent to begin…')}</p>
                )}
                {lines.length > 0 && (
                    <pre className="job-progress-modal__log">
                        {lines.join('\n')}
                        <div ref={logEndRef} />
                    </pre>
                )}
            </div>
        </Modal>
    );
}
