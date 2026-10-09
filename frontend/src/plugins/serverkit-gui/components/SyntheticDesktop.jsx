import React, { useEffect, useState } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'serverkit-sdk';

// Synthetic desktop refresh cadence.
const SYNTHETIC_REFRESH_MS = 4000;


/**
 * Fake desktop UI rendered from agent data, used when the host has no
 * display server. Each "window" is just data the agent already exposes.
 */
export default function SyntheticDesktop({  serverId, fetchJson }) {
    const { t } = useTranslation();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const load = () => {
            fetchJson(`/api/v1/server-gui/${serverId}/synthetic`)
                .then(d => { if (!cancelled) setData(d); })
                .catch(err => { if (!cancelled) setError(err.message); });
        };
        load();
        return () => { cancelled = true; };
    }, [serverId, fetchJson]);

    usePolling(
        () => fetchJson(`/api/v1/server-gui/${serverId}/synthetic`)
            .then(setData)
            .catch((err) => setError(err.message)),
        SYNTHETIC_REFRESH_MS,
        { immediate: false },
    );

    if (error) return <div className="sk-gui__banner sk-gui__banner--error">{error}</div>;
    if (!data) return <div className="sk-gui__loading">{t('gui.loadingSynthetic', 'Loading synthetic desktop…')}</div>;

    return (
        <div className="sk-synth">
            <div className="sk-synth__wallpaper">
                <div className="sk-synth__hostname">{data.hostname || 'host'}</div>
                <div className="sk-synth__windows">
                    {data.windows?.map(w => <SynthWindow key={w.id} win={w} />)}
                </div>
            </div>

            <div className="sk-synth__taskbar">
                <span className="sk-synth__start">≡</span>
                {data.taskbar?.map(t => (
                    <span key={t.id} className="sk-synth__task" title={t.name}>
                        {t.name}
                    </span>
                ))}
                <span className="sk-synth__clock">
                    {new Date().toLocaleTimeString()}
                </span>
            </div>
        </div>
    );
}

function SynthWindow({ win }) {
    return (
        <div className="sk-synth__window">
            <div className="sk-synth__titlebar">
                <span className="sk-synth__title">{win.title}</span>
                <span className="sk-synth__controls">— □ ×</span>
            </div>
            <div className="sk-synth__body">
                <WindowBody body={win.body} />
            </div>
        </div>
    );
}

function WindowBody({ body }) {
    const { t } = useTranslation();
    if (Array.isArray(body)) {
        return (
            <ul className="sk-synth__list">
                {body.map((row, i) => (
                    <li key={i}>
                        <span>{row.name}</span>
                        <span>{row.cpu != null ? t('gui.cpuPercent', '{{value}}% CPU', { value: row.cpu.toFixed?.(1) ?? row.cpu }) : ''}</span>
                        <span>{row.mem != null ? t('gui.memPercent', '{{value}}% memory', { value: row.mem.toFixed?.(1) ?? row.mem }) : ''}</span>
                    </li>
                ))}
            </ul>
        );
    }
    if (body && typeof body === 'object') {
        return (
            <dl className="sk-synth__kv">
                {Object.entries(body).map(([k, v]) => (
                    <React.Fragment key={k}>
                        <dt>{k}</dt>
                        <dd>{String(v)}</dd>
                    </React.Fragment>
                ))}
            </dl>
        );
    }
    return <div>{String(body ?? '')}</div>;
}
