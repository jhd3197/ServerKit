import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import api from '../services/api';

const MIN_PORT = 1;
const MAX_PORT = 65535;
const PRIVILEGED_LIMIT = 1024;
// Wait for typing to settle before asking the server about a port.
const CHECK_DELAY_MS = 350;

/**
 * The one port input.
 *
 *   <PortField value={port} onChange={setPort} />                  // host port, checked
 *   <PortField value={cport} onChange={setCport} host={false} />    // container port
 *
 * Host ports (the default) are checked against the server as you type and
 * say who holds a taken one ("Used by shop-api"), with a one-click next free
 * port. `ownerAppId` marks the app being edited, so its own port reads as
 * its own rather than taken. Container ports only get range checks: they
 * live inside the container and never collide on the host.
 *
 * onChange receives a number, or '' while the field is empty.
 */
export default function PortField({
    value,
    onChange,
    host = true,
    ownerAppId = null,
    allowPrivileged = false,
    suggestFrom = 8000,
    placeholder = '8080',
    disabled = false,
    required = false,
    id,
    className,
}) {
    const { t } = useTranslation();
    const fallbackId = useId();
    const [check, setCheck] = useState(null);
    const [suggestion, setSuggestion] = useState(null);

    const raw = value === '' || value == null ? '' : String(value);
    const port = raw === '' ? null : Number(raw);
    const inRange = port != null && Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT;
    const privileged = inRange && port < PRIVILEGED_LIMIT;

    useEffect(() => {
        setCheck(null);
        setSuggestion(null);
        if (!host || !inRange || (privileged && !allowPrivileged)) return undefined;
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const res = await api.checkPort(port);
                if (cancelled) return;
                setCheck(res);
                if (!res.free && !(ownerAppId != null && res.holder?.id === ownerAppId)) {
                    const next = await api.suggestPort(Math.max(port + 1, suggestFrom));
                    if (!cancelled) setSuggestion(next?.port ?? null);
                }
            } catch {
                // The check is advisory; the deploy still validates the port.
            }
        }, CHECK_DELAY_MS);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [host, port, inRange, privileged, allowPrivileged, ownerAppId, suggestFrom]);

    const ownPort = check?.holder && ownerAppId != null && check.holder.id === ownerAppId;
    let status = null;
    if (raw !== '' && !inRange) {
        status = { tone: 'error', text: t('app.portField.range', 'Ports run from 1 to 65535.') };
    } else if (privileged && !allowPrivileged) {
        status = { tone: 'error', text: t('app.portField.privileged', 'Ports below 1024 need root. Use 1024 or higher.') };
    } else if (check && ownPort) {
        status = { text: t('app.portField.ownPort', 'This service already uses {{port}}.', { port }) };
    } else if (check?.holder?.kind === 'app') {
        status = { tone: 'error', text: t('app.portField.usedByApp', 'Used by {{name}}.', { name: check.holder.name }) };
    } else if (check?.holder) {
        status = { tone: 'error', text: t('app.portField.usedByContainer', 'A running container already maps {{port}}.', { port }) };
    } else if (check && !check.free) {
        status = { tone: 'error', text: t('app.portField.bound', 'Something outside ServerKit is listening on {{port}}.', { port }) };
    } else if (check?.free) {
        status = { text: t('app.portField.free', '{{port}} is free.', { port }) };
    }

    return (
        <div className={cn('sk-port-field', className)}>
            <Input
                id={id || fallbackId}
                type="number"
                inputMode="numeric"
                min={allowPrivileged ? MIN_PORT : (host ? PRIVILEGED_LIMIT : MIN_PORT)}
                max={MAX_PORT}
                step={1}
                value={raw}
                onChange={(e) => onChange?.(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder={placeholder}
                disabled={disabled}
                required={required}
                aria-invalid={status?.tone === 'error'}
                className="sk-port-field__input"
            />
            {status && (
                <p className={cn('sk-port-field__status', status.tone === 'error' && 'is-error')}>
                    {status.text}
                    {suggestion && !ownPort && (
                        <Button
                            type="button"
                            variant="link"
                            size="sm"
                            className="sk-port-field__suggest"
                            onClick={() => onChange?.(suggestion)}
                            disabled={disabled}
                        >
                            {t('app.portField.useSuggestion', 'Use {{port}}', { port: suggestion })}
                        </Button>
                    )}
                </p>
            )}
        </div>
    );
}
