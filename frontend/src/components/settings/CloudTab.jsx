import { useEffect, useState } from 'react';
import { CloudCog, ExternalLink, PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { useManagedProfile } from '../../contexts/useManagedProfile';
import useLabel from '../../i18n/labels';
import { MANAGED_CAPABILITY_MAP } from '../sidebarItems';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';

// Settings › ServerKit Cloud (plan 25 M3): the one place the customer reads
// what ServerKit Cloud holds for them — the connect state, and the managed
// profile with the responsibilities Cloud took over, since when, until when,
// and any active support override. Nothing here can turn the profile off;
// that is done in ServerKit Cloud, and the page says so.
const CloudTab = () => {
    const { t } = useTranslation();
    const label_ = useLabel();
    const { profile, lapsed } = useManagedProfile();
    const [connect, setConnect] = useState(null);
    // Loading and failure are their own states: neither may read as "not
    // connected", which is only true when the status call said so.
    const [connectLoading, setConnectLoading] = useState(true);
    const [connectError, setConnectError] = useState(null);

    const loadConnect = () => {
        setConnectLoading(true);
        setConnectError(null);
        api.getConnectStatus()
            .then(setConnect)
            .catch((err) => setConnectError(err))
            .finally(() => setConnectLoading(false));
    };

    useEffect(() => {
        loadConnect();
    }, []);

    const held = profile?.held_capabilities || [];
    const fmt = (iso) => (iso
        ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : null);

    return (
        <div className="settings-section" data-testid="settings-cloud-tab">
            <div className="section-header">
                <h2>{t('app.settings.cloud.title', 'ServerKit Cloud')}</h2>
            </div>

            <div className="settings-card">
                <h3>
                    <PlugZap size={16} /> {t('app.settings.cloud.connection', 'Connection')}
                </h3>
                {connectLoading ? (
                    <EmptyState loading loadingVariant="form" loadingRows={3} title={t('app.settings.cloud.loadingConnection', 'Loading connection status…')} />
                ) : connectError ? (
                    <ErrorState
                        title={t('app.settings.cloud.couldntLoadConnection', "Couldn't load Cloud connection status")}
                        error={connectError}
                        onRetry={loadConnect}
                    />
                ) : connect ? (
                    <div className="managed-spec-list">
                        <div className="managed-spec-row">
                            <span className="managed-spec-key">{t('app.settings.cloud.state', 'State')}</span>
                            <span className="managed-spec-val" data-testid="cloud-connect-state">{connect.state}</span>
                        </div>
                        {connect.org_slug && (
                            <div className="managed-spec-row">
                                <span className="managed-spec-key">{t('app.settings.cloud.organisation', 'Organisation')}</span>
                                <span className="managed-spec-val">{connect.org_slug}</span>
                            </div>
                        )}
                        {connect.name && (
                            <div className="managed-spec-row">
                                <span className="managed-spec-key">{t('app.settings.cloud.serverName', 'Server name in Cloud')}</span>
                                <span className="managed-spec-val">{connect.name}</span>
                            </div>
                        )}
                    </div>
                ) : (
                    <p className="description">{t('app.settings.cloud.notPaired', 'This panel is not connected to ServerKit Cloud.')}</p>
                )}
            </div>

            <div className="settings-card" data-testid="managed-profile-section">
                <h3>
                    <CloudCog size={16} /> {t('app.settings.cloud.managedProfile', 'Managed profile')}
                </h3>
                {!profile && (
                    <p className="description">
                        {t('app.settings.cloud.noProfile', 'No managed profile. ServerKit Cloud has not taken over any part of this panel — everything you see is yours to run.')}
                    </p>
                )}
                {profile && (
                    <>
                        {lapsed && (
                            <div className="alert alert-warning" role="status">
                                {t('app.settings.cloud.lapsed', 'The profile below lapsed — Cloud has been unreachable past its expiry, so the full panel is back. It returns if Cloud reconnects and re-sends it.')}
                            </div>
                        )}
                        {profile.override && (
                            <div className="alert alert-info" role="status" data-testid="managed-profile-override">
                                {profile.override.reason
                                    ? t('app.settings.cloud.overrideReason', 'Lifted for a support session until {{until}} — {{reason}}. The profile returns on its own afterwards.', { until: fmt(profile.override.until), reason: profile.override.reason })
                                    : t('app.settings.cloud.override', 'Lifted for a support session until {{until}}. The profile returns on its own afterwards.', { until: fmt(profile.override.until) })}
                            </div>
                        )}
                        <p className="description">
                            {t('app.settings.cloud.profileIntro', '{{heldBy}} took over the responsibilities below on {{since}}. Pages they cover show a managed card instead of their tools; every route and API keeps working.', { heldBy: profile.held_by || 'ServerKit Cloud', since: fmt(profile.since) || '—' })}
                        </p>
                        <ul className="feature-list" data-testid="managed-profile-capabilities">
                            {held.map((cap) => {
                                const entry = MANAGED_CAPABILITY_MAP[cap];
                                return (
                                <li key={cap}>
                                    <CloudCog size={16} />
                                    <span>
                                        <strong>{entry ? label_(entry) : cap}</strong>
                                        {entry?.note ? ` — ${label_(entry, 'note')}` : ''}
                                    </span>
                                </li>
                                );
                            })}
                        </ul>
                        <div className="managed-spec-list">
                            <div className="managed-spec-row">
                                <span className="managed-spec-key">{t('app.settings.cloud.policyExpires', 'Policy expires')}</span>
                                <span className="managed-spec-val">{fmt(profile.expires_at) || '—'}</span>
                            </div>
                            <div className="managed-spec-row">
                                <span className="managed-spec-key">{t('app.settings.cloud.policyId', 'Policy')}</span>
                                <span className="managed-spec-val"><code>{profile.policy_id}</code></span>
                            </div>
                        </div>
                        {profile.support_url && (
                            <p>
                                <a className="btn btn-secondary btn-sm" href={profile.support_url}
                                   target="_blank" rel="noreferrer" data-testid="managed-profile-open-cloud">
                                    <ExternalLink size={14} />
                                    {t('app.settings.cloud.openInCloud', 'Open this server in ServerKit Cloud')}
                                </a>
                            </p>
                        )}
                        <p className="description">
                            {t('app.settings.cloud.cannotTurnOff', 'Nothing here turns the profile off — that is done in ServerKit Cloud, or it lifts on its own if Cloud stays unreachable past the expiry.')}
                        </p>
                    </>
                )}
            </div>
        </div>
    );
};

export default CloudTab;
