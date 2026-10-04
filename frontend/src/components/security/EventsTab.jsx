import { useState, useEffect } from 'react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import ErrorState from '@/components/ErrorState';
import { Feed, FeedItem } from '@/components/ds';
import { useTranslation } from 'react-i18next';
import { CardHeader as SharedCardHeader, CardContent as SharedCardContent, Card as SharedCard } from '@/components/ui/card';

const EventsTab = () => {
    const { t } = useTranslation();
    const [events, setEvents] = useState([]);
    const [failedLogins, setFailedLogins] = useState(null);
    const [loading, setLoading] = useState(true);
    const [eventsError, setEventsError] = useState(null);
    const [failedLoginsError, setFailedLoginsError] = useState(null);

    useEffect(() => {
        loadEvents();
        loadFailedLogins();
    }, []);

    async function loadEvents() {
        try {
            const data = await api.getSecurityEvents(50);
            setEvents(data.events || []);
            setEventsError(null);
        } catch (err) {
            console.error('Failed to load security events:', err);
            setEventsError(err);
        } finally {
            setLoading(false);
        }
    }

    async function loadFailedLogins() {
        try {
            const data = await api.getFailedLogins(24);
            setFailedLogins(data);
            setFailedLoginsError(null);
        } catch (err) {
            console.error('Failed to load failed logins:', err);
            setFailedLoginsError(err);
        }
    }

    function getEventTone(type) {
        if (type.includes('malware')) return 'red';
        if (type.includes('integrity')) return 'amber';
        return 'cyan';
    }

    function getEventIcon(type) {
        if (type.includes('malware')) {
            return <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" strokeWidth="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>;
        }
        if (type.includes('integrity')) {
            return <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
        }
        return <svg viewBox="0 0 24 24" width="15" height="15" stroke="currentColor" fill="none" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    }

    return (
        <div className="events-tab">
            {failedLoginsError && (
                <ErrorState
                    compact
                    error={failedLoginsError}
                    onRetry={loadFailedLogins}
                />
            )}
            {failedLogins && (
                <div className={`card ${failedLogins.alert_triggered ? 'card-warning' : ''}`}>
                    <SharedCardHeader variant="legacy" className="card-header">
                        <h3>{t('app.eventsTab.failedLoginAttempts24h', 'Failed login attempts (24h)')}</h3>
                        <Button variant="outline" size="sm" onClick={loadFailedLogins}>{t('common.actions.refresh', 'Refresh')}</Button>
                    </SharedCardHeader>
                    <SharedCardContent variant="legacy" className="card-body">
                        <div className="failed-login-summary">
                            <span className={`count ${failedLogins.alert_triggered ? 'danger' : ''}`}>
                                {failedLogins.failed_attempts}
                            </span>
                            <span className="label">{t('app.eventsTab.failedAttemptsThreshold', 'failed attempts · threshold')} {failedLogins.threshold}</span>
                        </div>
                        {failedLogins.recent_failures?.length > 0 && (
                            <details className="recent-failures">
                                <summary>{t('app.eventsTab.viewRecentFailures', 'View recent failures')}</summary>
                                <pre>{failedLogins.recent_failures.join('\n')}</pre>
                            </details>
                        )}
                    </SharedCardContent>
                </div>
            )}

            <SharedCard variant="legacy" className="card">
                <SharedCardHeader variant="legacy" className="card-header">
                    <h3>{t('app.eventsTab.securityEvents', 'Security events')}</h3>
                    <Button variant="outline" size="sm" onClick={loadEvents}>{t('common.actions.refresh', 'Refresh')}</Button>
                </SharedCardHeader>
                <SharedCardContent variant="legacy" className="card-body">
                    {loading ? (
                        <div className="loading-sm">{t('common.loading', 'Loading…')}</div>
                    ) : eventsError && events.length === 0 ? (
                        <ErrorState
                            title={t('app.eventsTab.couldntLoadSecurityEvents', "Couldn't load security events")}
                            error={eventsError}
                            onRetry={loadEvents}
                        />
                    ) : events.length === 0 ? (
                        <p className="text-muted">{t('app.eventsTab.noSecurityEventsRecorded', 'No security events recorded.')}</p>
                    ) : (
                        <>
                        {eventsError && <ErrorState compact error={eventsError} onRetry={loadEvents} />}
                        <Feed className="sec-feed">
                            {events.map((event, index) => (
                                <FeedItem
                                    key={index}
                                    icon={getEventIcon(event.type)}
                                    tone={getEventTone(event.type)}
                                    time={new Date(event.timestamp).toLocaleString()}
                                >
                                    {event.message}
                                </FeedItem>
                            ))}
                        </Feed>
                        </>
                    )}
                </SharedCardContent>
            </SharedCard>
        </div>
    );
};

export default EventsTab;
