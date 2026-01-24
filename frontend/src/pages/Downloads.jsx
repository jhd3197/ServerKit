import React, { useState, useEffect } from 'react';
import api from '../services/api';

// Platform icons as SVG components
const LinuxIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="platform-icon">
        <path d="M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.468v.018c0 .138.033.267.094.4.063.135.155.2.258.274-.246-.006-.33-.025-.416-.135-.09-.132-.132-.298-.138-.468v-.006c-.014-.2.02-.402.074-.6.054-.2.128-.4.232-.535.104-.133.244-.2.388-.2zm-.869.19c-.135.057-.264.134-.372.2a2.645 2.645 0 00-.298.274c-.132.135-.264.298-.4.398a.71.71 0 01-.118.067c.034-.135.092-.269.16-.402.065-.134.146-.267.232-.4.09-.132.194-.265.3-.332a.882.882 0 01.494-.132h.002zm3.086 2.932c-.02.066-.034.135-.034.2v.066c.014.066.027.2.027.265.014.066.014.2.014.265 0 .066-.014.132-.014.2-.014.132-.04.2-.055.265l-.015.002a.193.193 0 00-.054-.006l-.03.002h-.028c-.014 0-.014 0-.028.002l-.028.002h-.028c-.014 0-.014.002-.029.002h-.056c-.014.002-.014.002-.028.002h-.056c-.014.002-.028.002-.042.002h-.014c-.016 0-.029-.002-.043-.002a.256.256 0 01-.057-.004h-.014a.25.25 0 01-.071-.014h-.014a.146.146 0 01-.057-.029h-.014c-.014-.014-.028-.014-.043-.029-.014-.014-.028-.014-.043-.029h-.014c-.014-.014-.028-.028-.043-.043l-.014-.014a.189.189 0 01-.028-.043l-.015-.014c0-.014-.014-.028-.014-.043l-.014-.014c0-.014-.014-.029-.014-.043l-.015-.029a.17.17 0 01-.014-.042l-.014-.029a.17.17 0 01-.014-.042c-.014-.072-.028-.2-.028-.265-.014-.066-.014-.2-.014-.265 0-.066.014-.2.028-.265.014-.066.028-.135.042-.2.028-.066.056-.2.085-.265.014-.066.056-.132.085-.2.028-.066.07-.132.098-.2.028-.065.07-.132.098-.2.042-.066.085-.132.127-.198.029-.066.085-.132.127-.198.043-.066.085-.132.127-.198.043-.066.099-.132.155-.2.057-.066.098-.132.156-.2.056-.066.112-.132.168-.198.057-.066.113-.132.17-.198a2.37 2.37 0 01.183-.198l.183-.2c.057-.066.127-.132.184-.198l.09-.1c.074-.068.143-.134.214-.2.07-.066.14-.132.212-.198.07-.066.143-.132.214-.198.07-.066.142-.132.214-.2.07-.066.156-.132.226-.2.071-.066.156-.132.226-.2.072-.066.156-.132.227-.2.07-.066.155-.132.226-.2l.112-.1a4.98 4.98 0 01.23-.2l.226-.2c.07-.068.155-.134.226-.2l.056-.05a.17.17 0 01.084-.068l.043-.014c.028-.014.056-.014.098-.014h.042l.042.014c.028 0 .042.014.07.028.029.014.057.028.085.043l.042.043.042.042c.014.014.028.043.042.057l.028.042.028.043.014.042c.014.014.014.043.014.057v.042c.014.014.014.043.014.057v.042c0 .014 0 .043-.014.057v.042c0 .014-.014.043-.014.057l-.014.042c-.014.014-.014.043-.028.057l-.028.042c-.014.014-.014.028-.028.043l-.028.042-.042.043-.042.042-.042.028-.057.029c-.014.014-.028.014-.042.028h-.057l-.042.014h-.098l-.057-.014h-.028l-.042-.014-.043-.014a.127.127 0 01-.042-.028c-.014 0-.028-.014-.043-.028l-.042-.029-.043-.042-.028-.043-.028-.042c-.014-.014-.014-.029-.028-.043-.014-.014-.014-.028-.014-.042-.014-.014-.014-.029-.014-.043v-.042c0-.014 0-.029-.014-.043v-.042c0-.014.014-.029.014-.043V8.73c.014-.014.014-.028.014-.042.014-.014.014-.029.028-.043l.028-.042c.014-.014.014-.028.028-.042l.042-.043.043-.028.042-.029.043-.028a.262.262 0 01.085-.028l.042-.014h.057c.014 0 .028 0 .042.014h.043l.042.014.043.014.042.029c.014.014.028.014.043.028l.042.029c.014.014.028.028.043.042l.028.043.028.042c.014.014.014.028.028.043l.014.042.014.043v.042c.014.014.014.028.014.043v.042c0 .014 0 .028-.014.042v.043c0 .014-.014.028-.014.042-.014.014-.014.029-.014.043l-.028.042-.028.042c-.014.014-.014.029-.028.043l-.042.042-.043.043c-.014.014-.028.028-.042.028l-.043.029c-.014.014-.028.014-.042.028l-.043.028-.042.014-.043.014h-.084c-.014 0-.028-.014-.042-.014l-.043-.014c-.014-.014-.028-.014-.042-.028l-.043-.029-.042-.042-.028-.043-.029-.042c-.014-.014-.014-.028-.028-.042-.014-.014-.014-.029-.014-.043l-.014-.042v-.043c0-.014-.014-.028-.014-.042v-.086c0-.014.014-.028.014-.042v-.043c.014-.014.014-.029.014-.043.014-.014.014-.028.028-.042l.029-.042c.014-.014.014-.028.028-.043l.042-.042.043-.028.042-.029c.014-.014.028-.014.043-.028l.042-.029.043-.014.042-.014h.085c.014 0 .028.014.042.014l.043.014c.014.014.028.014.042.029l.043.028.042.043.029.042.028.043c.014.014.014.028.028.042l.014.043.014.042v.043c.014.014.014.028.014.042v.086c0 .014-.014.028-.014.042v.043c0 .014-.014.028-.014.042-.014.014-.014.029-.028.043l-.028.042c-.014.014-.014.028-.029.042l-.042.043-.042.028-.043.029c-.014.014-.028.014-.042.028l-.043.029-.042.014-.043.014h-.085c-.014 0-.028-.014-.042-.014z" />
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

const CopyIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
);

const CheckIcon = () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20,6 9,17 4,12" />
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
    const [versionInfo, setVersionInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [copiedCommand, setCopiedCommand] = useState(null);

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

    const copyToClipboard = async (text, commandId) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedCommand(commandId);
            setTimeout(() => setCopiedCommand(null), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const getBaseUrl = () => {
        // Get the base URL for the API
        if (import.meta.env.PROD) {
            return window.location.origin;
        }
        return import.meta.env.VITE_API_URL?.replace('/api/v1', '') || 'http://localhost:5000';
    };

    const platforms = [
        {
            id: 'linux-amd64',
            name: 'Linux',
            arch: 'x64 (amd64)',
            icon: LinuxIcon,
            os: 'linux',
            archKey: 'amd64',
            command: `curl -fsSL ${getBaseUrl()}/api/servers/install.sh | sudo bash -s -- --token "YOUR_TOKEN" --server "${getBaseUrl()}"`,
        },
        {
            id: 'linux-arm64',
            name: 'Linux',
            arch: 'ARM64',
            icon: LinuxIcon,
            os: 'linux',
            archKey: 'arm64',
            command: `curl -fsSL ${getBaseUrl()}/api/servers/install.sh | sudo bash -s -- --token "YOUR_TOKEN" --server "${getBaseUrl()}"`,
        },
        {
            id: 'windows-amd64',
            name: 'Windows',
            arch: 'x64 (amd64)',
            icon: WindowsIcon,
            os: 'windows',
            archKey: 'amd64',
            command: `irm ${getBaseUrl()}/api/servers/install.ps1 | iex; Install-ServerKitAgent -Token "YOUR_TOKEN" -Server "${getBaseUrl()}"`,
        },
    ];

    const handleDownload = (os, arch) => {
        const url = versionInfo?.downloads?.[`${os}-${arch}`];
        if (url) {
            window.open(url, '_blank');
        }
    };

    if (loading) {
        return (
            <div className="page downloads-page">
                <div className="page-header">
                    <h1>Downloads</h1>
                </div>
                <div className="loading-container">
                    <div className="loading-spinner"></div>
                    <p>Loading version information...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="page downloads-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>ServerKit Agent Downloads</h1>
                    <p className="page-subtitle">
                        Download and install the ServerKit Agent on your servers to enable remote management.
                    </p>
                </div>
                <button className="btn btn-secondary" onClick={fetchVersionInfo}>
                    <RefreshIcon />
                    Refresh
                </button>
            </div>

            {error && (
                <div className="alert alert-error">
                    <p>{error}</p>
                    <button onClick={fetchVersionInfo}>Try Again</button>
                </div>
            )}

            {versionInfo && (
                <>
                    <div className="version-banner">
                        <div className="version-info">
                            <span className="version-label">Latest Version</span>
                            <span className="version-number">v{versionInfo.version}</span>
                        </div>
                        <div className="version-meta">
                            <span>Released: {new Date(versionInfo.published_at).toLocaleDateString()}</span>
                            {versionInfo.release_notes_url && (
                                <a
                                    href={versionInfo.release_notes_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="release-notes-link"
                                >
                                    View Release Notes
                                </a>
                            )}
                        </div>
                    </div>

                    <section className="downloads-section">
                        <h2>Direct Downloads</h2>
                        <p className="section-description">
                            Download the agent binary for your platform. After downloading, follow the installation instructions below.
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
                                        <div className="platform-header">
                                            <Icon />
                                            <div className="platform-info">
                                                <h3>{platform.name}</h3>
                                                <span className="platform-arch">{platform.arch}</span>
                                            </div>
                                        </div>
                                        <button
                                            className="btn btn-primary download-btn"
                                            onClick={() => handleDownload(platform.os, platform.archKey)}
                                            disabled={!isAvailable}
                                        >
                                            <DownloadIcon />
                                            {isAvailable ? 'Download' : 'Not Available'}
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <section className="downloads-section">
                        <h2>Quick Install Commands</h2>
                        <p className="section-description">
                            Use these one-liner commands to download and install the agent. Replace <code>YOUR_TOKEN</code> with your server's registration token.
                        </p>

                        <div className="install-commands">
                            <div className="command-block">
                                <div className="command-header">
                                    <LinuxIcon />
                                    <h3>Linux (Bash)</h3>
                                </div>
                                <div className="command-content">
                                    <pre>
                                        <code>{platforms[0].command}</code>
                                    </pre>
                                    <button
                                        className="copy-btn"
                                        onClick={() => copyToClipboard(platforms[0].command, 'linux')}
                                        title="Copy to clipboard"
                                    >
                                        {copiedCommand === 'linux' ? <CheckIcon /> : <CopyIcon />}
                                    </button>
                                </div>
                            </div>

                            <div className="command-block">
                                <div className="command-header">
                                    <WindowsIcon />
                                    <h3>Windows (PowerShell)</h3>
                                </div>
                                <div className="command-content">
                                    <pre>
                                        <code>{platforms[2].command}</code>
                                    </pre>
                                    <button
                                        className="copy-btn"
                                        onClick={() => copyToClipboard(platforms[2].command, 'windows')}
                                        title="Copy to clipboard"
                                    >
                                        {copiedCommand === 'windows' ? <CheckIcon /> : <CopyIcon />}
                                    </button>
                                </div>
                                <p className="command-note">Run PowerShell as Administrator</p>
                            </div>
                        </div>
                    </section>

                    <section className="downloads-section">
                        <h2>Manual Installation</h2>
                        <div className="manual-steps">
                            <div className="step">
                                <div className="step-number">1</div>
                                <div className="step-content">
                                    <h4>Download the Agent</h4>
                                    <p>Download the appropriate binary for your platform from the downloads above.</p>
                                </div>
                            </div>
                            <div className="step">
                                <div className="step-number">2</div>
                                <div className="step-content">
                                    <h4>Extract and Install</h4>
                                    <p>
                                        <strong>Linux:</strong> Extract with <code>tar -xzf serverkit-agent-*.tar.gz</code> and move to <code>/usr/local/bin/</code>
                                    </p>
                                    <p>
                                        <strong>Windows:</strong> Extract the ZIP and move to <code>C:\Program Files\ServerKit\</code>
                                    </p>
                                </div>
                            </div>
                            <div className="step">
                                <div className="step-number">3</div>
                                <div className="step-content">
                                    <h4>Register the Agent</h4>
                                    <p>Run the registration command with your token:</p>
                                    <pre><code>serverkit-agent register --token "YOUR_TOKEN" --server "{getBaseUrl()}"</code></pre>
                                </div>
                            </div>
                            <div className="step">
                                <div className="step-number">4</div>
                                <div className="step-content">
                                    <h4>Start the Agent</h4>
                                    <p>Start the agent service:</p>
                                    <pre><code>serverkit-agent start</code></pre>
                                    <p className="step-note">Or use systemd/Windows Service for automatic startup</p>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="downloads-section">
                        <h2>Verification</h2>
                        <p className="section-description">
                            Verify your download using the SHA256 checksums:
                        </p>
                        {versionInfo.checksums_url && (
                            <a
                                href={versionInfo.checksums_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-secondary"
                            >
                                <DownloadIcon />
                                Download Checksums
                            </a>
                        )}
                        <div className="verification-command">
                            <pre><code>sha256sum -c checksums.txt</code></pre>
                        </div>
                    </section>
                </>
            )}
        </div>
    );
}

export default Downloads;
