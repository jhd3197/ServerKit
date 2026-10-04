import { useState } from 'react';
import { statusKind } from '@/components/ds/status';
import { ClipboardCheck } from 'lucide-react';
import api from '../../services/api';
import EmptyState from '@/components/EmptyState';
import ErrorState from '@/components/ErrorState';
import { Button } from '@/components/ui/button';
import { ScoreGauge } from '@/components/ds';
import { useTranslation } from 'react-i18next';
import { Card as SharedCard, CardHeader as SharedCardHeader, CardContent as SharedCardContent } from '@/components/ui/card';


const scoreColor = (score) => {
    if (score >= 80) return 'var(--green)';
    if (score >= 60) return 'var(--accent-bright)';
    if (score >= 40) return 'var(--amber)';
    return 'var(--red)';
};

const AuditTab = () => {
    const { t } = useTranslation();
    const [audit, setAudit] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const runAudit = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.generateSecurityAudit();
            setAudit(data.audit);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="audit-tab">
            <SharedCard variant="legacy" className="card">
                <SharedCardHeader variant="legacy" className="card-header">
                    <h3>{t('app.auditTab.securityAudit', 'Security audit')}</h3>
                    <Button variant="default" onClick={runAudit} disabled={loading}>
                        {loading ? 'Running Audit...' : 'Run Audit'}
                    </Button>
                </SharedCardHeader>
                <SharedCardContent variant="legacy" className="card-body">
                    {error && !loading && (
                        <ErrorState
                            title={t('app.auditTab.couldntRunAudit', "Couldn't run the security audit")}
                            error={error}
                            onRetry={runAudit}
                            compact={!!audit}
                        />
                    )}

                    {!audit && !loading && !error && (
                        <EmptyState
                            icon={ClipboardCheck}
                            title={t('app.auditTab.runASecurityAuditToCheck', 'Run a security audit to check your server\'s configuration.')}
                        />
                    )}

                    {loading && (
                        <div className="loading-state">
                            <div className="spinner"></div>
                            <p>{t('app.auditTab.runningSecurityAudit', 'Running security audit…')}</p>
                        </div>
                    )}

                    {audit && !loading && (
                        <div className="audit-results">
                            <div className="sec-audit-score">
                                <ScoreGauge
                                    value={audit.score}
                                    size={120}
                                    stroke={10}
                                    color={scoreColor(audit.score)}
                                    label={t('app.auditTab.securityScore', 'security score')}
                                />
                                <div className="sec-audit-meta">{t('app.auditTab.generated', 'Generated')} {new Date(audit.generated_at).toLocaleString()}</div>
                            </div>

                            {Object.entries(audit.services || {}).map(([service, data]) => (
                                <div key={service} className="audit-section">
                                    <h4>{service.toUpperCase()}</h4>
                                    <div className="sec-finding-list">
                                        {data.findings?.map((finding, idx) => (
                                            <div key={idx} className="sec-finding">
                                                <span className={`sec-state sec-state--${statusKind(finding.severity)}`}>
                                                    {finding.severity}
                                                </span>
                                                <span className="sec-finding__msg">{finding.message}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            {audit.recommendations?.length > 0 && (
                                <div className="audit-section recommendations">
                                    <h4>{t('app.auditTab.recommendations', 'Recommendations')}</h4>
                                    <ul>
                                        {audit.recommendations.map((rec, idx) => (
                                            <li key={idx}>{rec}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    )}
                </SharedCardContent>
            </SharedCard>
        </div>
    );
};

export default AuditTab;
