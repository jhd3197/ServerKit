import { useState, useEffect } from 'react';
import api from '../services/api';
import { Button } from '@/components/ui/button';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import CopyField from '../components/CopyField';
import { scrollBehavior } from '@/utils/reducedMotion';
import { useTranslation } from 'react-i18next';

// Platform icons as SVG components
const LinuxIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="platform-icon">
        {/* Tux body */}
        <ellipse cx="12" cy="14" rx="7" ry="8" />
        {/* Head */}
        <circle cx="12" cy="5.5" r="3.5" />
        {/* Left eye */}
        <circle cx="10.5" cy="5" r="0.7" fill="currentColor" stroke="none" />
        {/* Right eye */}
        <circle cx="13.5" cy="5" r="0.7" fill="currentColor" stroke="none" />
        {/* Beak */}
        <ellipse cx="12" cy="6.5" rx="1.2" ry="0.5" fill="currentColor" stroke="none" />
        {/* Belly */}
        <ellipse cx="12" cy="15" rx="4" ry="5.5" />
        {/* Left foot */}
        <path d="M7 21c-1.5 0.5-2.5 1-2 1.5s2.5 0.5 4 0" />
        {/* Right foot */}
        <path d="M17 21c1.5 0.5 2.5 1 2 1.5s-2.5 0.5-4 0" />
    </svg>
);

const WindowsIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="platform-icon">
        <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.9-1.801" />
    </svg>
);

const DownloadIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7,10 12,15 17,10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);

const RefreshIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="23,4 23,10 17,10" />
        <polyline points="1,20 1,14 7,14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
);

function Downloads() {
    const { t } = useTranslation();
    const [versionInfo, setVersionInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        fetchVersionInfo();
    }, []);

    const fetchVersionInfo = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getAgentVersion();
            setVersionInfo(data);
        } catch (err) {
            setError(err.message || 'Failed to fetch version information');
        } finally {
            setLoading(false);
        }
    };

    const getBaseUrl = () => {
        // Get the base URL for the API
        if (import.meta.env.PROD) {
            return window.location.origin;
        }
        return import.meta.env.VITE_API_URL?.replace('/api/v1', '') || window.location.origin;
    };

    const platforms = [
        {
            id: 'linux-amd64',
            name: 'Linux',
            arch: 'x64 (amd64)',
            icon: LinuxIcon,
            os: 'linux',
            archKey: 'amd64',
            // Download-then-run: `curl … | sudo bash` reports bash's exit status,
            // so a failed download exits 0 and installs nothing silently (#101).
            command: `curl -fsSL ${getBaseUrl()}/api/v1/servers/install.sh -o /tmp/serverkit-agent-install.sh && sudo bash /tmp/serverkit-agent-install.sh --token "YOUR_TOKEN" --server "${getBaseUrl()}"`,
        },
        {
            id: 'linux-arm64',
            name: 'Linux',
            arch: 'ARM64',
            icon: LinuxIcon,
            os: 'linux',
            archKey: 'arm64',
            command: `curl -fsSL ${getBaseUrl()}/api/v1/servers/install.sh -o /tmp/serverkit-agent-install.sh && sudo bash /tmp/serverkit-agent-install.sh --token "YOUR_TOKEN" --server "${getBaseUrl()}"`,
        },
        {
            id: 'windows-amd64',
            name: 'Windows',
            arch: 'x64 (amd64)',
            icon: WindowsIcon,
            os: 'windows',
            archKey: 'amd64',
            command: `irm ${getBaseUrl()}/api/v1/servers/install.ps1 | iex; Install-ServerKitAgent -Token "YOUR_TOKEN" -Server "${getBaseUrl()}"`,
        },
    ];

    const handleDownload = (os, arch) => {
        const url = versionInfo?.downloads?.[`${os}-${arch}`];
        if (url) {
            window.open(url, '_blank');
        }
    };

    useTopbarActions(() =>
        <>
            <Button size="sm" variant="outline" onClick={fetchVersionInfo}>
                <RefreshIcon />
                {t('common.actions.refresh', 'Refresh')}
            </Button>
        </>,
        [],
    );

    if (loading) {
        return (
            <div className="sk-tabgroup__inner downloads-page">
                <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p>{t('app.downloads.loadingVersionInformation', 'Loading version information…')}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="sk-tabgroup__inner downloads-page">
            {error && (
                <div className="alert alert-error">
                    <p>{error}</p>
                    <Button variant="unstyled" type="button" onClick={fetchVersionInfo}>{t('app.downloads.tryAgain', 'Try again')}</Button>
                </div>
            )}

            {versionInfo && (
                <>
                    <div className="version-banner">
                        <div className="version-info">
                            <span className="version-label">{t('app.downloads.latestVersion', 'Latest version')}</span>
                            <span className="version-number">v{versionInfo.version}</span>
                            <span className="version-date">{t('app.downloads.released', 'Released')} {new Date(versionInfo.published_at).toLocaleDateString()}</span>
                        </div>
                        <div className="version-actions">
                            {versionInfo.release_notes_url && (
                                <a
                                    href={versionInfo.release_notes_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-banner-outline"
                                >
                                    {t('app.downloads.releaseNotes', 'Release notes')}
                                </a>
                            )}
                            <a href="#downloads" className="btn btn-banner-primary" onClick={(e) => {
                                e.preventDefault();
                                document.querySelector('.download-cards')?.scrollIntoView({ behavior: scrollBehavior() });
                            }}>
                                <DownloadIcon />
                                {t('app.downloads.downloadNow', 'Download now')}
                            </a>
                        </div>
                    </div>

                    <section className="downloads-section">
                        <h2>{t('app.downloads.directDownloads', 'Direct downloads')}</h2>
                        <p className="section-description">
                            {t('app.downloads.downloadTheAgentBinaryForYour', 'Download the agent binary for your platform. After downloading, follow the installation instructions below.')}
                        </p>

                        <div className="download-cards">
                            {platforms.map((platform) => {
                                const Icon = platform.icon;
                                const downloadUrl = versionInfo.downloads?.[platform.id];
                                const isAvailable = !!downloadUrl;

                                return (
                                    <div
                                        key={platform.id}
                                        className={`download-card ${!isAvailable ? 'unavailable' : ''}`}
                                    >
                                        <div className="platform-icon-wrapper">
                                            <Icon />
                                        </div>
                                        <div className="platform-info">
                                            <h3>{platform.name}</h3>
                                            <span className="platform-arch">{platform.arch}</span>
                                        </div>
                                        <Button
                                            className="download-btn"
                                            onClick={() => handleDownload(platform.os, platform.archKey)}
                                            disabled={!isAvailable}
                                        >
                                            <DownloadIcon />
                                            {isAvailable ? 'Download' : 'Not Available'}
                                        </Button>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <section className="downloads-section">
                        <h2>{t('app.downloads.quickInstallCommands', 'Quick install commands')}</h2>
                        <p className="section-description">
                            {t('app.downloads.useTheseOneLinerCommandsTo', 'Use these one-liner commands to download and install the agent. Replace')} <code>YOUR_TOKEN</code> {t('app.downloads.withTheServerRegistrationToken', 'with the server registration token.')}
                        </p>

                        <div className="install-commands">
                            <div className="command-block">
                                <div className="command-header">
                                    <LinuxIcon />
                                    <h3>{t('app.downloads.linuxBash', 'Linux (Bash)')}</h3>
                                </div>
                                <div className="command-content">
                                    <CopyField value={platforms[0].command} multiline />
                                </div>
                            </div>

                            <div className="command-block">
                                <div className="command-header">
                                    <WindowsIcon />
                                    <h3>{t('app.downloads.windowsPowershell', 'Windows (PowerShell)')}</h3>
                                </div>
                                <div className="command-content">
                                    <CopyField value={platforms[2].command} multiline />
                                </div>
                                <p className="command-note">{t('app.downloads.runPowershellAsAdministrator', 'Run PowerShell as administrator')}</p>
                            </div>
                        </div>
                    </section>

                    <section className="downloads-section">
                        <h2>{t('app.downloads.manualInstallation', 'Manual installation')}</h2>
                        <div className="manual-steps">
                            <div className="step">
                                <div className="step-number">1</div>
                                <div className="step-content">
                                    <h4>{t('app.downloads.downloadTheAgent', 'Download the agent')}</h4>
                                    <p>{t('app.downloads.downloadTheAppropriateBinaryForYour', 'Download the appropriate binary for your platform from the downloads above.')}</p>
                                </div>
                            </div>
                            <div className="step">
                                <div className="step-number">2</div>
                                <div className="step-content">
                                    <h4>{t('app.downloads.extractAndInstall', 'Extract and install')}</h4>
                                    <p>
                                        <strong>{t('app.downloads.linux', 'Linux:')}</strong> {t('app.downloads.extractWith', 'Extract with')} <code>{t('app.downloads.tarXzfServerkitAgentTarGz', 'tar -xzf serverkit-agent-*.tar.gz')}</code> {t('app.downloads.andMoveTo', 'and move to')} <code>/usr/local/bin/</code>
                                    </p>
                                    <p>
                                        <strong>{t('app.downloads.windows', 'Windows:')}</strong> {t('app.downloads.extractTheZipAndMoveTo', 'Extract the ZIP and move to')} <code>{t('app.downloads.cProgramFilesServerkit', 'C:\\Program Files\\ServerKit\\')}</code>
                                    </p>
                                </div>
                            </div>
                            <div className="step">
                                <div className="step-number">3</div>
                                <div className="step-content">
                                    <h4>{t('app.downloads.registerTheAgent', 'Register the agent')}</h4>
                                    <p>{t('app.downloads.runTheRegistrationCommandWithYour', 'Run the registration command with your token:')}</p>
                                    <CopyField value={`serverkit-agent register --token "YOUR_TOKEN" --server "${getBaseUrl()}"`} multiline />
                                </div>
                            </div>
                            <div className="step">
                                <div className="step-number">4</div>
                                <div className="step-content">
                                    <h4>{t('app.downloads.startTheAgent', 'Start the agent')}</h4>
                                    <p>{t('app.downloads.startTheAgentService', 'Start the agent service:')}</p>
                                    <CopyField value={t('app.downloads.serverkitAgentStart', 'serverkit-agent start')} />
                                    <p className="step-note">{t('app.downloads.orUseSystemdWindowsServiceFor', 'Or use systemd/Windows Service for automatic startup')}</p>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="downloads-section">
                        <h2>{t('app.downloads.verification', 'Verification')}</h2>
                        <p className="section-description">
                            {t('app.downloads.verifyYourDownloadUsingTheSha256', 'Verify your download using the SHA256 checksums:')}
                        </p>
                        {versionInfo.checksums_url && (
                            <Button variant="outline" asChild>
                                <a
                                    href={versionInfo.checksums_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <DownloadIcon />
                                    {t('app.downloads.downloadChecksums', 'Download checksums')}
                                </a>
                            </Button>
                        )}
                        <div className="verification-command">
                            <CopyField value={t('app.downloads.sha256sumCChecksumsTxt', 'sha256sum -c checksums.txt')} />
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}

export default Downloads;
