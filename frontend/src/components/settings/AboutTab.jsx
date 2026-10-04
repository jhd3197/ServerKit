import { useState, useEffect, useRef } from 'react';
import api from '../../services/api';
import {
    Github, FileText, HelpCircle, MessageSquare, Bug, Check, Download, CheckCircle,
    RefreshCw, ExternalLink, Star, X, AlertTriangle
} from 'lucide-react';
import ServerKitLogo from '../ServerKitLogo';
import ErrorState from '../ErrorState';
import { Button } from '@/components/ui/button';
import useSettingFocus from '../../hooks/useSettingFocus';
import { useManagedProfile } from '../../contexts/useManagedProfile';
import ManagedCard from '../ManagedCard';
import { useTranslation } from 'react-i18next';

const STAR_PROMPT_KEY = 'serverkit-star-prompt-dismissed';

const AboutTab = () => {
    const { t } = useTranslation();
    // null until known: a failed read shows "—", never an invented number.
    const [version, setVersion] = useState(null);
    const [versionError, setVersionError] = useState(null);
    const [updateInfo, setUpdateInfo] = useState(null);
    const [checkingUpdate, setCheckingUpdate] = useState(false);
    const [showStarPrompt, setShowStarPrompt] = useState(() => {
        return localStorage.getItem(STAR_PROMPT_KEY) !== 'true';
    });
    // One-click self-update. updatePhase: null (idle) | 'confirm' | 'starting'
    // | 'running' | 'restarting' | 'done' | 'failed' | 'timeout'
    const [updateStatus, setUpdateStatus] = useState(null);
    const [updatePhase, setUpdatePhase] = useState(null);
    const [updateLogTail, setUpdateLogTail] = useState('');
    const [updatedVersion, setUpdatedVersion] = useState(null);
    const [updateError, setUpdateError] = useState(null);
    const cancelledRef = useRef(false);
    const register = useSettingFocus();
    // Updates held by ServerKit Cloud (plan 25): the self-update surface is
    // the managed card in miniature. The panel still updates itself — the
    // card says so.
    const { isControlHeld, profile: managedProfile } = useManagedProfile();
    const updatesManaged = isControlHeld('self-update');

    useEffect(() => () => { cancelledRef.current = true; }, []);

    const fetchVersion = async () => {
        setVersionError(null);
        try {
            const data = await api.getVersion();
            setVersion(data.version || null);
        } catch (err) {
            setVersion(null);
            setVersionError(err);
        }
    };

    useEffect(() => {
        fetchVersion();
    }, []);

    const dismissStarPrompt = () => {
        setShowStarPrompt(false);
        localStorage.setItem(STAR_PROMPT_KEY, 'true');
    };

    const checkForUpdate = async () => {
        setCheckingUpdate(true);
        try {
            const data = await api.checkUpdate();
            setUpdateInfo(data);
            if (data.update_available) {
                // Admin-only capability probe — a 403 just hides the button.
                try {
                    setUpdateStatus(await api.getPanelUpdateStatus());
                } catch {
                    setUpdateStatus(null);
                }
            }
        } catch {
            setUpdateInfo({ error: 'Failed to check for updates' });
        }
        setCheckingUpdate(false);
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const runUpdate = async () => {
        let startVersion = version;
        if (!startVersion) {
            // Without a known starting version the poll below cannot tell the
            // new backend from the old one, so read it once more first.
            try {
                startVersion = (await api.getVersion()).version || null;
            } catch { /* fall back to the running/outcome signals */ }
        }
        setUpdatePhase('starting');
        setUpdateError(null);
        setUpdateLogTail('');
        try {
            await api.startPanelUpdate();
        } catch (error) {
            setUpdatePhase('failed');
            setUpdateError(error?.message || t('app.aboutTab.updateStartFailed', 'Failed to start the update'));
            return;
        }
        setUpdatePhase('running');
        const started = Date.now();
        let notRunningPolls = 0;
        while (!cancelledRef.current && Date.now() - started < 15 * 60 * 1000) {
            await sleep(3000);
            if (cancelledRef.current) return;
            try {
                const st = await api.getPanelUpdateStatus();
                if (st.log?.tail) setUpdateLogTail(st.log.tail);
                if (st.version && startVersion && st.version !== startVersion) {
                    // The backend that answered is already the new version.
                    setUpdatedVersion(st.version);
                    setUpdatePhase('done');
                    return;
                }
                if (st.running) {
                    notRunningPolls = 0;
                    setUpdatePhase('running');
                } else {
                    // Grace for the transient unit not being visible yet;
                    // after that, same-version + not-running means it ended
                    // without switching (rollback or early failure).
                    notRunningPolls += 1;
                    if (st.log?.outcome === 'rolled_back') {
                        setUpdatePhase('failed');
                        setUpdateError(t('app.aboutTab.updateRolledBack', 'The update failed and was rolled back. The previous version is still running.'));
                        return;
                    }
                    if (notRunningPolls >= 5) {
                        setUpdatePhase('failed');
                        setUpdateError(t('app.aboutTab.updateDidNotComplete', 'The update ended without changing the version. Check the update log on the server.'));
                        return;
                    }
                }
            } catch {
                // The panel restarts mid-update — unreachable is expected.
                setUpdatePhase('restarting');
            }
        }
        if (!cancelledRef.current) setUpdatePhase('timeout');
    };

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>{t('app.aboutTab.aboutServerkit', 'About ServerKit')}</h2>
            </div>

            <div {...register('about-version', 'about-card')}>
                <div className="about-logo">
                    <ServerKitLogo width={64} height={64} />
                </div>
                <h3>{t('common.labels.serverKit', 'ServerKit')}</h3>
                <p className="version">{t('common.labels.version', 'Version')} {version || (versionError ? '—' : '…')}</p>
                {versionError && <ErrorState compact error={versionError} onRetry={fetchVersion} />}
                <p className="description">
                    {t('app.aboutTab.aModernLightweightServerManagementPanel', 'A modern, lightweight server management panel for managing services, databases, domains, and more. Built with Flask and React.')}
                </p>

                <div className="update-check">
                    {updatesManaged ? (
                        <ManagedCard capability="updates" profile={managedProfile} compact />
                    ) : !updateInfo ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={checkForUpdate}
                            disabled={checkingUpdate}
                        >
                            {checkingUpdate ? (
                                <><RefreshCw size={14} className="spinning" /> {t('common.checking', 'Checking…')}</>
                            ) : (
                                <><Download size={14} /> {t('app.aboutTab.checkForUpdates', 'Check for updates')}</>
                            )}
                        </Button>
                    ) : updateInfo.error ? (
                        <div className="update-status error">
                            <span>{updateInfo.error}</span>
                            <Button variant="unstyled" type="button" className="btn-link" onClick={checkForUpdate}>{t('common.actions.retry', 'Retry')}</Button>
                        </div>
                    ) : updateInfo.update_available ? (
                        updatePhase === null || updatePhase === 'confirm' ? (
                            <>
                                <div className="update-status available">
                                    <Download size={16} />
                                    <span>{t('app.aboutTab.updateAvailable', 'Update available:')} <strong>v{updateInfo.latest_version}</strong></span>
                                    <a
                                        href={updateInfo.release_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={updateStatus?.capability?.supported ? 'btn btn-secondary btn-sm' : 'btn btn-accent btn-sm'}
                                    >
                                        {t('app.aboutTab.viewRelease', 'View release')} <ExternalLink size={12} />
                                    </a>
                                    {updateStatus?.capability?.supported && updatePhase === null && (
                                        <Button
                                            size="sm"
                                            onClick={() => setUpdatePhase('confirm')}
                                            disabled={updateStatus?.running}
                                        >
                                            <Download size={12} /> {t('app.aboutTab.updateNow', 'Update now')}
                                        </Button>
                                    )}
                                </div>
                                {updatePhase === 'confirm' && (
                                    <div className="update-confirm">
                                        <AlertTriangle size={14} />
                                        <span>{t('app.aboutTab.updateConfirm', 'This updates ServerKit and briefly restarts the panel. Hosted services stay online. If the new version fails to start, it rolls back automatically.')}</span>
                                        <Button size="sm" onClick={runUpdate}>
                                            {t('app.aboutTab.updateNow', 'Update now')}
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => setUpdatePhase(null)}>
                                            {t('common.actions.cancel', 'Cancel')}
                                        </Button>
                                    </div>
                                )}
                                {updateStatus && !updateStatus.capability?.supported && updateStatus.capability?.reason && (
                                    <p className="update-capability-note">{updateStatus.capability.reason}</p>
                                )}
                            </>
                        ) : (
                            <div className="update-progress">
                                {updatePhase === 'done' ? (
                                    <div className="update-status current">
                                        <CheckCircle size={16} />
                                        <span>{t('app.aboutTab.updateComplete', 'Updated to')} <strong>v{updatedVersion}</strong></span>
                                        <Button size="sm" onClick={() => window.location.reload()}>
                                            <RefreshCw size={12} /> {t('app.aboutTab.reloadPanel', 'Reload panel')}
                                        </Button>
                                    </div>
                                ) : updatePhase === 'failed' ? (
                                    <div className="update-status error">
                                        <AlertTriangle size={16} />
                                        <span>{updateError}</span>
                                    </div>
                                ) : updatePhase === 'timeout' ? (
                                    <div className="update-status error">
                                        <AlertTriangle size={16} />
                                        <span>{t('app.aboutTab.updateTimeout', 'The update is taking longer than expected. Check the update log on the server before retrying.')}</span>
                                    </div>
                                ) : (
                                    <div className="update-status running">
                                        <RefreshCw size={16} className="spinning" />
                                        <span>
                                            {updatePhase === 'restarting'
                                                ? t('app.aboutTab.updateRestarting', 'Restarting the panel…')
                                                : t('app.aboutTab.updateRunning', 'Updating ServerKit…')}
                                        </span>
                                    </div>
                                )}
                                {updateLogTail && updatePhase !== 'done' && (
                                    <pre className="update-log">{updateLogTail.trim().split('\n').slice(-12).join('\n')}</pre>
                                )}
                            </div>
                        )
                    ) : (
                        <div className="update-status current">
                            <CheckCircle size={16} />
                            <span>{t('app.aboutTab.youReUpToDate', "You're up to date")}</span>
                        </div>
                    )}
                </div>
            </div>

            {showStarPrompt && (
                <div className="star-prompt-card">
                    <Button variant="unstyled" type="button" className="dismiss-btn" onClick={dismissStarPrompt} title={t('common.actions.dismiss', 'Dismiss')}>
                        <X size={16} />
                    </Button>
                    <div className="star-icon">
                        <Star size={24} />
                    </div>
                    <div className="star-content">
                        <h4>{t('app.aboutTab.enjoyingServerkit', 'Enjoying ServerKit?')}</h4>
                        <p>{t('app.aboutTab.ifYouFindServerkitUsefulConsider', 'If you find ServerKit useful, consider starring the repository on GitHub. It helps others discover the project.')}</p>
                        <a
                            href="https://github.com/jhd3197/ServerKit"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn-accent"
                        >
                            <Star size={16} />
                            {t('app.aboutTab.starOnGithub', 'Star on GitHub')}
                        </a>
                    </div>
                </div>
            )}

            <div className="settings-card">
                <h3>{t('app.aboutTab.features', 'Features')}</h3>
                <ul className="feature-list">
                    <li>
                        <Check size={16} />
                        {t('app.aboutTab.applicationManagementPhpPythonNodeJs', 'Service management (PHP, Python, Node.js, Docker)')}
                    </li>
                    <li>
                        <Check size={16} />
                        {t('app.aboutTab.domainSslCertificateManagement', 'Domain and SSL certificate management')}
                    </li>
                    <li>
                        <Check size={16} />
                        {t('app.aboutTab.databaseManagementMysqlPostgresql', 'Database management (MySQL, PostgreSQL)')}
                    </li>
                    <li>
                        <Check size={16} />
                        {t('app.aboutTab.dockerContainerManagement', 'Docker container management')}
                    </li>
                    <li>
                        <Check size={16} />
                        {t('app.aboutTab.systemMonitoringAlerts', 'System monitoring and alerts')}
                    </li>
                    <li>
                        <Check size={16} />
                        {t('app.aboutTab.automatedBackups', 'Automated backups')}
                    </li>
                    <li>
                        <Check size={16} />
                        {t('app.aboutTab.gitDeploymentWithWebhooks', 'Git deployment with webhooks')}
                    </li>
                </ul>
            </div>

            <div {...register('about-links', 'settings-card')}>
                <h3>{t('app.aboutTab.links', 'Links')}</h3>
                <div className="link-list">
                    <a href="https://github.com/jhd3197/ServerKit" target="_blank" rel="noopener noreferrer" className="link-item">
                        <Github size={18} />
                        {t('app.aboutTab.githubRepository', 'GitHub repository')}
                    </a>
                    <a href="https://github.com/jhd3197/ServerKit#readme" target="_blank" rel="noopener noreferrer" className="link-item">
                        <FileText size={18} />
                        {t('app.aboutTab.documentation', 'Documentation')}
                    </a>
                    <a href="https://github.com/jhd3197/ServerKit/issues" target="_blank" rel="noopener noreferrer" className="link-item">
                        <HelpCircle size={18} />
                        {t('app.aboutTab.supportIssues', 'Support and issues')}
                    </a>
                    <a href="https://github.com/jhd3197/ServerKit/discussions" target="_blank" rel="noopener noreferrer" className="link-item">
                        <MessageSquare size={18} />
                        {t('app.aboutTab.discussions', 'Discussions')}
                    </a>
                    <a href="https://github.com/jhd3197/ServerKit/issues/new" target="_blank" rel="noopener noreferrer" className="link-item">
                        <Bug size={18} />
                        {t('app.aboutTab.reportABug', 'Report a bug')}
                    </a>
                </div>
            </div>

            <div className="settings-card">
                <h3>{t('app.aboutTab.license', 'License')}</h3>
                <p className="license-text">
                    {t('app.aboutTab.serverkitIsOpenSourceSoftwareLicensed', 'ServerKit is open source software licensed under the MIT License.')}
                </p>
            </div>
        </div>
    );
};

export default AboutTab;
