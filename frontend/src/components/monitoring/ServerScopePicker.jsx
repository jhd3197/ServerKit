import { Check, ChevronDown, Server as ServerIcon, HardDrive } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useState } from 'react';
import { HOST_SCOPE } from './useMonitorScope';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Top-bar control that picks which host every Monitoring section describes.
// Hidden entirely when nothing is paired — with one machine there is no choice
// to make, and an inert dropdown is worse than no dropdown.
export default function ServerScopePicker({ scope, servers, onChange, label }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    if (!servers.length) return null;

    const pick = (value) => { onChange(value); setOpen(false); };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <SharedButton variant="unstyled" type="button" className="mon-scope" aria-label={t('app.serverScopePicker.chooseWhichServerToMonitor', 'Choose which server to monitor')}>
                    <span className="mon-scope__ico">
                        {scope === HOST_SCOPE ? <HardDrive size={14} /> : <ServerIcon size={14} />}
                    </span>
                    <span className="mon-scope__label">{label}</span>
                    <ChevronDown size={14} className="mon-scope__chev" />
                </SharedButton>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={6} className="ui-popover-content mon-scope__menu">
                <SharedButton variant="unstyled"
                    type="button"
                    className={`mon-scope__item${scope === HOST_SCOPE ? ' is-on' : ''}`}
                    onClick={() => pick(HOST_SCOPE)}
                >
                    <HardDrive size={14} />
                    <span>
                        {t('app.serverScopePicker.thisServer', 'This server')}
                        <small>{t('app.serverScopePicker.theMachineRunningThePanel', 'The panel server')}</small>
                    </span>
                    {scope === HOST_SCOPE && <Check size={14} />}
                </SharedButton>
                <div className="mon-scope__sep" />
                {servers.map((s) => (
                    <SharedButton variant="unstyled"
                        key={s.id}
                        type="button"
                        className={`mon-scope__item${String(scope) === String(s.id) ? ' is-on' : ''}`}
                        onClick={() => pick(s.id)}
                    >
                        <ServerIcon size={14} />
                        <span>
                            {s.name}
                            <small>{s.hostname || s.ip_address || s.status || 'agent'}</small>
                        </span>
                        {String(scope) === String(s.id) && <Check size={14} />}
                    </SharedButton>
                ))}
            </PopoverContent>
        </Popover>
    );
}
