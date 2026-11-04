import { useEffect, useRef, useState, useCallback } from 'react';
// Imported from the SDK exactly as a third-party extension would:
// these resolve to the HOST's i18next instance and format door, so this
// extension follows the panel's language and locale with no wiring of its own.
import { useTranslation, useFormat } from 'serverkit-sdk';
import SyntheticDesktop from './SyntheticDesktop.jsx';
import { Button as SharedButton } from 'serverkit-sdk';
import { storageKey } from '../../../services/tunnelBase';

const FRAME_INTERVAL_MS_DEFAULT = 700;
const STORAGE_KEY = 'sk-gui:prefs';

const MODES = {
    AUTO: 'auto',
    SCREENSHOT: 'screenshot',
    SYNTHETIC: 'synthetic',
};

function loadPrefs() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        return {};
    }
}

function savePrefs(prefs) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

/**
 * Top-level desktop view. Picks between screenshot streaming and synthetic
 * desktop based on user preference and what the agent reports.
 */
export default function ServerGui({ api, serverId }) {
    const { t } = useTranslation();
    const initial = loadPrefs();
    const [mode, setMode] = useState(initial.mode || MODES.AUTO);
    const [intervalMs, setIntervalMs] = useState(initial.intervalMs || FRAME_INTERVAL_MS_DEFAULT);
    const [scale, setScale] = useState(initial.scale ?? 0.75);
    const [quality, setQuality] = useState(initial.quality ?? 70);
    const [caps, setCaps] = useState(null);
    const [error, setError] = useState(null);

    const baseUrl = `/api/v1/server-gui/${serverId}`;

    // Persist prefs whenever any of them changes.
    useEffect(() => {
        savePrefs({ mode, intervalMs, scale, quality });
    }, [mode, intervalMs, scale, quality]);

    const fetchJson = useCallback(async (path) => {
        if (api && typeof api.request === 'function') {
            return api.request(path);
        }
        const token = localStorage.getItem(storageKey('access_token'));
        const r = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    }, [api]);

    // Probe capabilities once — drives auto mode and the toolbar caption.
    useEffect(() => {
        let cancelled = false;
        setCaps(null);
        setError(null);
        fetchJson(`${baseUrl}/capabilities`)
            .then(d => { if (!cancelled) setCaps(d); })
            .catch(e => { if (!cancelled) setError(e.message); });
        return () => { cancelled = true; };
    }, [baseUrl, fetchJson]);

    // Resolve the active mode: AUTO defers to capabilities.
    const effectiveMode = (() => {
        if (mode === MODES.SCREENSHOT) return MODES.SCREENSHOT;
        if (mode === MODES.SYNTHETIC) return MODES.SYNTHETIC;
        if (!caps) return null;
        return caps.capability === 'none' ? MODES.SYNTHETIC : MODES.SCREENSHOT;
    })();

    return (
        <div className="sk-gui">
            <Toolbar
                caps={caps}
                mode={mode}
                onModeChange={setMode}
                intervalMs={intervalMs}
                onIntervalChange={setIntervalMs}
                scale={scale}
                onScaleChange={setScale}
                quality={quality}
                onQualityChange={setQuality}
                effectiveMode={effectiveMode}
            />

            {error && <div className="sk-gui__banner sk-gui__banner--error">{error}</div>}

            {!caps && !error && (
                <div className="sk-gui__loading">{t('gui.probing', 'Probing display capability…')}</div>
            )}

            {effectiveMode === MODES.SCREENSHOT && caps && (
                <ScreenshotView
                    baseUrl={baseUrl}
                    fetchJson={fetchJson}
                    intervalMs={intervalMs}
                    scale={scale}
                    quality={quality}
                />
            )}

            {effectiveMode === MODES.SYNTHETIC && (
                <SyntheticDesktop
                    api={api}
                    serverId={serverId}
                    fetchJson={fetchJson}
                />
            )}
        </div>
    );
}

function Toolbar({
    caps, mode, onModeChange,
    intervalMs, onIntervalChange,
    scale, onScaleChange,
    quality, onQualityChange,
    effectiveMode,
}) {
    const { t } = useTranslation();
    const screenshotDisabled = caps && caps.capability === 'none';

    return (
        <div className="sk-gui__toolbar">
            <div className="sk-gui__mode">
                <ModeBtn
                    label={t('gui.mode.auto', 'Auto')}
                    active={mode === MODES.AUTO}
                    onClick={() => onModeChange(MODES.AUTO)}
                />
                <ModeBtn
                    label={t('gui.mode.screenshot', 'Screenshot')}
                    active={mode === MODES.SCREENSHOT}
                    disabled={screenshotDisabled}
                    title={screenshotDisabled
                        ? t('gui.mode.unavailable', 'Unavailable: {{reason}}', {
                            reason: caps.reason || t('gui.mode.noDisplay', 'no display'),
                        })
                        : ''}
                    onClick={() => onModeChange(MODES.SCREENSHOT)}
                />
                <ModeBtn
                    label={t('gui.mode.synthetic', 'Synthetic')}
                    active={mode === MODES.SYNTHETIC}
                    onClick={() => onModeChange(MODES.SYNTHETIC)}
                />
            </div>

            <span className="sk-gui__cap">
                {caps ? (
                    <>
                        {caps.capability === 'none'
                            ? `headless${caps.reason ? ` · ${caps.reason}` : ''}`
                            : `${caps.capability}${caps.resolution ? ` · ${caps.resolution}` : ''}`}
                        {effectiveMode && effectiveMode !== mode && mode === MODES.AUTO && (
                            <span className="sk-gui__cap-active"> → {effectiveMode}</span>
                        )}
                    </>
                ) : '—'}
            </span>

            {effectiveMode === MODES.SCREENSHOT && (
                <>
                    <label className="sk-gui__field">
                        {t('gui.toolbar.rate', 'Rate')}
                        <select value={intervalMs} onChange={e => onIntervalChange(Number(e.target.value))}>
                            <option value={2000}>{t('gui.fps', '{{rate}} fps', { rate: 0.5 })}</option>
                            <option value={1000}>{t('gui.fps', '{{rate}} fps', { rate: 1 })}</option>
                            <option value={700}>{t('gui.fps', '{{rate}} fps', { rate: 1.5 })}</option>
                            <option value={500}>{t('gui.fps', '{{rate}} fps', { rate: 2 })}</option>
                            <option value={300}>{t('gui.fps', '{{rate}} fps', { rate: 3 })}</option>
                        </select>
                    </label>
                    <label className="sk-gui__field">
                        {t('gui.toolbar.scale', 'Scale')}
                        <select value={scale} onChange={e => onScaleChange(Number(e.target.value))}>
                            <option value={0.5}>50%</option>
                            <option value={0.75}>75%</option>
                            <option value={1}>100%</option>
                        </select>
                    </label>
                    <label className="sk-gui__field">
                        {t('gui.toolbar.quality', 'Quality')}
                        <input
                            type="range"
                            min="20"
                            max="95"
                            value={quality}
                            onChange={e => onQualityChange(Number(e.target.value))}
                        />
                        <span className="sk-gui__field-num">{quality}</span>
                    </label>
                </>
            )}
        </div>
    );
}

function ModeBtn({ label, active, disabled, title, onClick }) {
    return (
        <SharedButton variant="unstyled"
            type="button"
            title={title}
            disabled={disabled}
            onClick={onClick}
            className={`sk-gui__mode-btn ${active ? 'sk-gui__mode-btn--active' : ''}`}
        >
            {label}
        </SharedButton>
    );
}

function ScreenshotView({ baseUrl, fetchJson, intervalMs, scale, quality }) {
    const { t } = useTranslation();
    const { formatTime } = useFormat();
    const [frame, setFrame] = useState(null);
    const [error, setError] = useState(null);
    const [paused, setPaused] = useState(false);
    const inflight = useRef(false);

    useEffect(() => {
        if (paused) return undefined;
        let cancelled = false;
        const timer = { id: null };

        const tick = async () => {
            if (cancelled || inflight.current) return;
            inflight.current = true;
            try {
                const data = await fetchJson(
                    `${baseUrl}/frame?scale=${scale}&quality=${quality}&format=jpeg`
                );
                if (cancelled) return;
                setFrame(data);
                setError(null);
            } catch (e) {
                if (cancelled) return;
                setError(e.message);
            } finally {
                inflight.current = false;
            }
        };

        tick();
        timer.id = setInterval(tick, intervalMs);
        return () => {
            cancelled = true;
            if (timer.id) clearInterval(timer.id);
        };
    }, [baseUrl, fetchJson, intervalMs, scale, quality, paused]);

    const imgSrc = frame
        ? `data:image/${frame.format || 'jpeg'};base64,${frame.image_base64}`
        : null;

    return (
        <div className="sk-gui__viewport">
            <SharedButton variant="unstyled" type="button"
                className="sk-gui__viewport-btn"
                onClick={() => setPaused(p => !p)}
            >
                {paused ? t('gui.resume', 'Resume') : t('gui.pause', 'Pause')}
            </SharedButton>
            {error && <div className="sk-gui__banner sk-gui__banner--error">{error}</div>}
            {imgSrc ? (
                <img className="sk-gui__frame" src={imgSrc} alt={t('gui.frameAlt', 'Remote desktop frame')} />
            ) : (
                <div className="sk-gui__loading">{t('gui.waitingFirstFrame', 'Waiting for first frame…')}</div>
            )}
            {frame?.captured_at && (
                <div className="sk-gui__stamp">
                    {frame.width}×{frame.height} · {formatTime(frame.captured_at, { seconds: true })}
                </div>
            )}
        </div>
    );
}
