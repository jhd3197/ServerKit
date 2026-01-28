import React, { useState, useEffect } from 'react';
import { GitCompare, Check, X, Minus, RefreshCw } from 'lucide-react';
import wordpressApi from '../../services/wordpress';
import Spinner from '../Spinner';

const CompareView = ({ projectId, envA, envB, onClose }) => {
    const [comparison, setComparison] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        loadComparison();
    }, [envA?.id, envB?.id]);

    async function loadComparison() {
        if (!envA?.id || !envB?.id) return;

        setLoading(true);
        setError(null);
        try {
            const data = await wordpressApi.compareEnvironments(projectId, envA.id, envB.id);
            setComparison(data);
        } catch (err) {
            setError(err.message || 'Failed to compare environments');
        } finally {
            setLoading(false);
        }
    }

    const envAType = envA?.environment_type || 'production';
    const envBType = envB?.environment_type || 'development';

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-xl" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>
                        <GitCompare size={18} style={{ marginRight: 8, verticalAlign: -3 }} />
                        Compare Environments
                    </h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                <div className="compare-header">
                    <div className={`compare-env-pill ${envAType}`}>
                        <span className="compare-env-type">{envAType}</span>
                        <span className="compare-env-name">{envA?.name || 'Environment A'}</span>
                    </div>
                    <GitCompare size={16} className="compare-vs-icon" />
                    <div className={`compare-env-pill ${envBType}`}>
                        <span className="compare-env-type">{envBType}</span>
                        <span className="compare-env-name">{envB?.name || 'Environment B'}</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={loadComparison} disabled={loading}>
                        <RefreshCw size={14} />
                    </button>
                </div>

                <div className="compare-body">
                    {loading && (
                        <div className="compare-loading">
                            <Spinner size="md" />
                            <span>Comparing environments...</span>
                        </div>
                    )}

                    {error && (
                        <div className="compare-error">
                            <p>{error}</p>
                            <button className="btn btn-primary btn-sm" onClick={loadComparison}>
                                Retry
                            </button>
                        </div>
                    )}

                    {!loading && !error && comparison && (
                        <>
                            {/* Version Comparison */}
                            <CompareSection title="Versions">
                                <CompareRow
                                    label="WordPress"
                                    valueA={comparison.env_a?.wp_version}
                                    valueB={comparison.env_b?.wp_version}
                                />
                                <CompareRow
                                    label="PHP"
                                    valueA={comparison.env_a?.php_version}
                                    valueB={comparison.env_b?.php_version}
                                />
                                <CompareRow
                                    label="Active Theme"
                                    valueA={comparison.env_a?.active_theme}
                                    valueB={comparison.env_b?.active_theme}
                                />
                            </CompareSection>

                            {/* Plugins Comparison */}
                            {comparison.plugins && (
                                <CompareSection
                                    title="Plugins"
                                    summary={getPluginSummary(comparison.plugins)}
                                >
                                    {comparison.plugins.map(plugin => (
                                        <CompareRow
                                            key={plugin.name}
                                            label={plugin.name}
                                            valueA={plugin.version_a || (plugin.in_a ? 'Installed' : null)}
                                            valueB={plugin.version_b || (plugin.in_b ? 'Installed' : null)}
                                            status={plugin.status}
                                        />
                                    ))}
                                    {comparison.plugins.length === 0 && (
                                        <div className="compare-empty-row">No plugin data available</div>
                                    )}
                                </CompareSection>
                            )}

                            {/* Themes Comparison */}
                            {comparison.themes && (
                                <CompareSection
                                    title="Themes"
                                    summary={getThemeSummary(comparison.themes)}
                                >
                                    {comparison.themes.map(theme => (
                                        <CompareRow
                                            key={theme.name}
                                            label={theme.name}
                                            valueA={theme.version_a || (theme.in_a ? 'Installed' : null)}
                                            valueB={theme.version_b || (theme.in_b ? 'Installed' : null)}
                                            status={theme.status}
                                        />
                                    ))}
                                    {comparison.themes.length === 0 && (
                                        <div className="compare-empty-row">No theme data available</div>
                                    )}
                                </CompareSection>
                            )}
                        </>
                    )}
                </div>

                <div className="modal-actions">
                    <button className="btn btn-secondary" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

const CompareSection = ({ title, summary, children }) => (
    <div className="compare-section">
        <div className="compare-section-header">
            <h4>{title}</h4>
            {summary && <span className="compare-section-summary">{summary}</span>}
        </div>
        <div className="compare-table">
            {children}
        </div>
    </div>
);

const CompareRow = ({ label, valueA, valueB, status }) => {
    const match = valueA === valueB && valueA != null;
    const onlyA = valueA && !valueB;
    const onlyB = !valueA && valueB;
    const different = valueA && valueB && valueA !== valueB;

    let statusClass = 'match';
    let StatusIcon = Check;
    if (different || status === 'different') {
        statusClass = 'different';
        StatusIcon = X;
    } else if (onlyA || status === 'only_a') {
        statusClass = 'only-a';
        StatusIcon = Minus;
    } else if (onlyB || status === 'only_b') {
        statusClass = 'only-b';
        StatusIcon = Minus;
    }

    return (
        <div className={`compare-row ${statusClass}`}>
            <div className="compare-row-label">
                <StatusIcon size={12} className="compare-row-icon" />
                {label}
            </div>
            <div className="compare-row-value-a">
                {valueA || <span className="compare-na">--</span>}
            </div>
            <div className="compare-row-value-b">
                {valueB || <span className="compare-na">--</span>}
            </div>
        </div>
    );
};

function getPluginSummary(plugins) {
    const match = plugins.filter(p => p.status === 'match').length;
    const diff = plugins.filter(p => p.status === 'different').length;
    const onlyA = plugins.filter(p => p.status === 'only_a').length;
    const onlyB = plugins.filter(p => p.status === 'only_b').length;
    const parts = [];
    if (match) parts.push(`${match} matching`);
    if (diff) parts.push(`${diff} different`);
    if (onlyA) parts.push(`${onlyA} only in A`);
    if (onlyB) parts.push(`${onlyB} only in B`);
    return parts.join(', ');
}

function getThemeSummary(themes) {
    const match = themes.filter(t => t.status === 'match').length;
    const diff = themes.filter(t => t.status === 'different').length;
    const onlyA = themes.filter(t => t.status === 'only_a').length;
    const onlyB = themes.filter(t => t.status === 'only_b').length;
    const parts = [];
    if (match) parts.push(`${match} matching`);
    if (diff) parts.push(`${diff} different`);
    if (onlyA) parts.push(`${onlyA} only in A`);
    if (onlyB) parts.push(`${onlyB} only in B`);
    return parts.join(', ');
}

export default CompareView;
