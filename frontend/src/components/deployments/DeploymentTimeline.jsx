import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Box,
    Clock,
    FileDiff,
    GitBranch,
    History,
    RotateCcw,
    ScrollText,
} from 'lucide-react';
import api from '../../services/api';
import EmptyState from '@/components/EmptyState';
import { ListToolbar, Pill, SegControl } from '@/components/ds';
import { Button } from '@/components/ui/button';
import ConfigDiffModal from './ConfigDiffModal';
import { useTranslation } from 'react-i18next';

function formatTime(iso) {
    if (!iso) return '';
    try {
        return new Date(iso).toLocaleString();
    } catch {
        return iso;
    }
}

function snapshotChanged(summary) {
    if (!summary) return false;
    const normalized = summary.toLowerCase();
    return !(normalized === 'no config changes' || normalized === 'initial config snapshot');
}

function AppDeploymentTimeline({ appId }) {
    const { t } = useTranslation();
    const [snapshots, setSnapshots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeDiff, setActiveDiff] = useState(null);

    const loadSnapshots = useCallback(async () => {
        try {
            setLoading(true);
            const res = await api.getAppSnapshots(appId);
            setSnapshots(res.snapshots || []);
            setError(null);
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [appId]);

    useEffect(() => {
        loadSnapshots();
    }, [loadSnapshots]);

    if (loading) {
        return <div className="deploy-timeline__loading">{t('app.deploymentTimeline.loadingDeploymentTimeline', 'Loading deployment timeline…')}</div>;
    }

    if (error) {
        return <div className="alert alert-danger">{error}</div>;
    }

    if (snapshots.length === 0) {
        return (
            <div className="deploy-timeline deploy-timeline--empty">
                <Clock size={20} />
                <p>{t('app.deploymentTimeline.noConfigCheckpointsYetOneIs', 'No restore points yet. One is captured before each deployment.')}</p>
            </div>
        );
    }

    return (
        <div className="deploy-timeline">
            <ol className="deploy-timeline__list">
                {snapshots.map((snap, index) => {
                    const cfg = snap.config || {};
                    const changed = snapshotChanged(snap.summary);
                    const isLatest = index === 0;
                    return (
                        <li key={snap.id} className="deploy-timeline__item">
                            <span
                                className={
                                    'deploy-timeline__marker'
                                    + (isLatest ? ' deploy-timeline__marker--current' : '')
                                }
                                aria-hidden="true"
                            />
                            <div className="deploy-timeline__card">
                                <div className="deploy-timeline__row">
                                    <div className="deploy-timeline__meta">
                                        {isLatest && <Pill kind="green">{t('common.labels.current', 'Current')}</Pill>}
                                        {changed && (
                                            <Pill kind="amber" dot={false}>
                                                {t('app.deploymentTimeline.configChanged', 'Config changed')}
                                            </Pill>
                                        )}
                                        <span className="deploy-timeline__time">
                                            <Clock size={13} /> {formatTime(snap.created_at)}
                                        </span>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setActiveDiff({ snapId: snap.id })}
                                    >
                                        <FileDiff size={14} /> {t('app.deploymentTimeline.viewDiff', 'View diff')}
                                    </Button>
                                </div>

                                <div className="deploy-timeline__details">
                                    {cfg.image_tag && (
                                        <span className="deploy-timeline__chip">
                                            <Box size={13} /> {cfg.image_tag}
                                        </span>
                                    )}
                                    {cfg.build_method && (
                                        <span className="deploy-timeline__chip">
                                            <GitBranch size={13} /> {cfg.build_method}
                                        </span>
                                    )}
                                    {cfg.env_keys && (
                                        <span className="deploy-timeline__chip">
                                            {t('app.deploymentTimeline.envVarCount', '{{count}} env vars', {
                                                count: cfg.env_keys.length,
                                            })}
                                        </span>
                                    )}
                                </div>

                                {snap.summary && (
                                    <p className="deploy-timeline__summary">{snap.summary}</p>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ol>

            {activeDiff && (
                <ConfigDiffModal
                    appId={appId}
                    snapId={activeDiff.snapId}
                    onClose={() => setActiveDiff(null)}
                    onRestored={() => {
                        setActiveDiff(null);
                        loadSnapshots();
                    }}
                />
            )}
        </div>
    );
}

function eventTitle(event, t) {
    if (event.type === 'restore_point') {
        return event.label || t('app.deploymentTimeline.environmentRestorePoint', 'Environment restore point');
    }
    if (event.type === 'deployment_snapshot') {
        return event.application_name
            ? t('app.deploymentTimeline.deploymentCheckpointFor', 'Deployment restore point for {{name}}', { name: event.application_name })
            : t('app.deploymentTimeline.deploymentCheckpoint', 'Deployment restore point');
    }
    return String(event.action || t('app.deploymentTimeline.auditEvent', 'Audit event'))
        .replaceAll('.', ' ')
        .replaceAll('_', ' ');
}

function eventKind(event, t) {
    if (event.type === 'restore_point') return t('app.deploymentTimeline.restorePoint', 'Restore point');
    if (event.type === 'deployment_snapshot') return t('app.deploymentTimeline.deployment', 'Deployment');
    return t('app.deploymentTimeline.audit', 'Audit');
}

function eventPillKind(type) {
    if (type === 'restore_point') return 'violet';
    if (type === 'deployment_snapshot') return 'cyan';
    return 'gray';
}

function humanizeToken(value) {
    const text = String(value || '').replaceAll('_', ' ').trim();
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function EventIcon({ type }) {
    if (type === 'restore_point') return <RotateCcw size={15} />;
    if (type === 'deployment_snapshot') return <Box size={15} />;
    return <ScrollText size={15} />;
}

function ServerTimelineEvent({ event, onReview }) {
    const { t } = useTranslation();
    const detailEntries = Object.entries(event.details || {}).slice(0, 4);
    return (
        <li className={`deploy-timeline__item deploy-timeline__item--${event.type}`}>
            <span className={`deploy-timeline__marker deploy-timeline__marker--${event.type}`} aria-hidden="true">
                <EventIcon type={event.type} />
            </span>
            <article className="deploy-timeline__card">
                <div className="deploy-timeline__row">
                    <div className="deploy-timeline__meta">
                        <Pill kind={eventPillKind(event.type)} dot={false}>{eventKind(event, t)}</Pill>
                        <span className="deploy-timeline__time">
                            <Clock size={13} /> {formatTime(event.created_at)}
                        </span>
                    </div>
                    {event.type !== 'audit' && (
                        <Button variant="outline" size="sm" onClick={() => onReview(event)}>
                            <FileDiff size={14} />
                            {event.type === 'restore_point'
                                ? t('app.deploymentTimeline.previewRestore', 'Preview restore')
                                : t('app.deploymentTimeline.viewDiff', 'View diff')}
                        </Button>
                    )}
                </div>

                <div className="deploy-timeline__event-heading">
                    <h3>{eventTitle(event, t)}</h3>
                    {event.actor_username && (
                        <span>{t('app.deploymentTimeline.byActor', 'by {{actor}}', { actor: event.actor_username })}</span>
                    )}
                </div>

                {event.type === 'restore_point' && (
                    <>
                        <div className="deploy-timeline__details">
                            <span className="deploy-timeline__chip">{humanizeToken(event.scope_type)}</span>
                            <span className="deploy-timeline__chip">{humanizeToken(event.trigger)}</span>
                        </div>
                        {event.coverage?.length > 0 && (
                            <p className="deploy-timeline__coverage-note">
                                {t('app.deploymentTimeline.coverageLimitCount', '{{count}} coverage limits', {
                                    count: event.coverage.length,
                                })}
                            </p>
                        )}
                    </>
                )}

                {event.type === 'deployment_snapshot' && event.summary && (
                    <p className="deploy-timeline__summary">{event.summary}</p>
                )}

                {event.type === 'audit' && (
                    <div className="deploy-timeline__details">
                        {event.target_type && (
                            <span className="deploy-timeline__chip">{event.target_type}</span>
                        )}
                        {detailEntries.map(([key, value]) => (
                            <span key={key} className="deploy-timeline__chip">
                                {key.replaceAll('_', ' ')}: {String(value)}
                            </span>
                        ))}
                    </div>
                )}
            </article>
        </li>
    );
}

function ServerActivityTimeline({ serverId, refreshKey = 0 }) {
    const { t } = useTranslation();
    const [filter, setFilter] = useState('all');
    const [events, setEvents] = useState([]);
    const [nextCursor, setNextCursor] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(null);
    const [activeDiff, setActiveDiff] = useState(null);
    const requestGeneration = useRef(0);

    const selectedTypes = filter === 'all' ? [] : [filter];

    const loadPage = useCallback(async ({ before = null, append = false } = {}) => {
        const generation = ++requestGeneration.current;
        try {
            if (append) setLoadingMore(true);
            else setLoading(true);
            const res = await api.getServerTimeline(serverId, {
                types: filter === 'all' ? [] : [filter],
                before,
                limit: 30,
            });
            if (generation !== requestGeneration.current) return;
            setEvents((current) => append ? [...current, ...(res.events || [])] : (res.events || []));
            setNextCursor(res.next_cursor || null);
            setError(null);
        } catch (err) {
            if (generation === requestGeneration.current) setError(err.message);
        } finally {
            if (generation === requestGeneration.current) {
                setLoading(false);
                setLoadingMore(false);
            }
        }
    }, [filter, serverId]);

    useEffect(() => {
        setEvents([]);
        setNextCursor(null);
        loadPage();
    }, [loadPage, refreshKey]);

    const filterOptions = [
        { value: 'all', label: t('common.labels.all', 'All') },
        { value: 'restore_point', label: t('app.deploymentTimeline.restorePoints', 'Restore points') },
        { value: 'deployment_snapshot', label: t('app.deploymentTimeline.deployments', 'Deployments') },
        { value: 'audit', label: t('app.deploymentTimeline.audit', 'Audit') },
    ];

    function openEvent(event) {
        if (event.type === 'restore_point') {
            setActiveDiff({ restorePointId: event.source_id, restorePoint: event });
        } else if (event.type === 'deployment_snapshot') {
            setActiveDiff({ appId: event.application_id, snapId: event.source_id });
        }
    }

    if (loading) {
        return (
            <div className="deploy-timeline deploy-timeline--server">
                <ListToolbar
                    filters={<SegControl options={filterOptions} value={filter} onChange={setFilter} />}
                />
                <EmptyState loading loadingVariant="feed" title={t('app.deploymentTimeline.loadingServerTimeline', 'Loading server timeline')} />
            </div>
        );
    }

    return (
        <div className="deploy-timeline deploy-timeline--server">
            <ListToolbar
                filters={<SegControl options={filterOptions} value={filter} onChange={setFilter} />}
                tools={(
                    <span className="deploy-timeline__count">
                        {t('app.deploymentTimeline.eventCount', '{{count}} events', { count: events.length })}
                    </span>
                )}
            />

            {error && (
                <div className="deploy-timeline__error alert alert-danger">
                    <span>{error}</span>
                    <Button variant="outline" size="sm" onClick={() => loadPage()}>
                        {t('common.actions.retry', 'Retry')}
                    </Button>
                </div>
            )}

            {!error && events.length === 0 && (
                <EmptyState
                    icon={History}
                    title={t('app.deploymentTimeline.noServerEvents', 'No timeline events yet')}
                    description={selectedTypes.length
                        ? t('app.deploymentTimeline.noFilteredEvents', 'No events match this timeline filter.')
                        : t('app.deploymentTimeline.noServerEventsDescription', 'Restore points, deployments, and server audit activity will appear here.')}
                    size="lg"
                />
            )}

            {events.length > 0 && (
                <ol className="deploy-timeline__list">
                    {events.map((event) => (
                        <ServerTimelineEvent key={event.id} event={event} onReview={openEvent} />
                    ))}
                </ol>
            )}

            {nextCursor && (
                <div className="deploy-timeline__footer">
                    <Button
                        variant="outline"
                        onClick={() => loadPage({ before: nextCursor, append: true })}
                        disabled={loadingMore}
                    >
                        {loadingMore
                            ? t('common.state.loading', 'Loading')
                            : t('common.actions.loadMore', 'Load more')}
                    </Button>
                </div>
            )}

            {activeDiff && (
                <ConfigDiffModal
                    {...activeDiff}
                    onClose={() => setActiveDiff(null)}
                    onRestored={() => {
                        setActiveDiff(null);
                        setEvents([]);
                        setNextCursor(null);
                        loadPage();
                    }}
                />
            )}
        </div>
    );
}

const DeploymentTimeline = ({ appId, serverId, refreshKey = 0 }) => {
    if (serverId) {
        return <ServerActivityTimeline serverId={serverId} refreshKey={refreshKey} />;
    }
    return <AppDeploymentTimeline appId={appId} />;
};

export default DeploymentTimeline;
