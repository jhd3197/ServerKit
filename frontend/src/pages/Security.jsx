import { useState, useEffect } from 'react';
import useTabParam from '../hooks/useTabParam';
import api from '../services/api';
import {
    OverviewTab,
    FirewallTab,
    SSHKeysTab,
    IPListsTab,
    IntegrityTab,
    AuditTab,
    EventsTab,
    SecurityConfigTab,
} from '../components/security';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { useTranslation } from 'react-i18next';

// Core tabs only. The install-gated tools (fail2ban, malware scanner,
// quarantine, vulnerability scan, auto-updates) are security extensions now:
// they contribute their own tabs + group routes, which mount beside these and
// win over the /security/:tab fallback when installed.
const VALID_TABS = ['overview', 'firewall', 'ssh-keys', 'ip-lists', 'integrity', 'audit', 'events', 'settings'];

const Security = () => {
    const { t } = useTranslation();

    const [activeTab, setActiveTab] = useTabParam('/security', VALID_TABS);
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
        loadStatus();
    }, []);

    async function loadStatus() {
        try {
            const data = await api.getSecurityStatus();
            setStatus(data);
            setLoadError(null);
        } catch (err) {
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }

    // Re-pull the status feed — passed to the Overview so a one-click fix
    // (enable integrity, …) reflects in the posture immediately.
    async function reload() {
        await loadStatus();
    }

    if (loading) {
        return (
            <div className="sk-tabgroup__inner security-page">
                <EmptyState loading loadingVariant="detail" title={t('app.security.loadingSecurityStatus', 'Loading security status…')} />
            </div>
        );
    }

    return (
        <div className="sk-tabgroup__inner security-page">
            <div className="tab-content">
                {/* The status feed backs the posture shown across the section,
                    so its failure is visible on every tab, not only Overview. */}
                {activeTab !== 'overview' && loadError && (
                    <ErrorState
                        compact
                        message={t('app.security.couldntLoadSecurityStatusReason', "Couldn't load security status. {{reason}}", { reason: loadError.message })}
                        onRetry={reload}
                    />
                )}
                {activeTab === 'overview' && (loadError && !status ? (
                    <ErrorState
                        title={t('app.security.couldntLoadSecurityStatus', "Couldn't load security status.")}
                        error={loadError}
                        onRetry={reload}
                    />
                ) : (
                    <>
                        {loadError && <ErrorState compact error={loadError} onRetry={reload} />}
                        <OverviewTab status={status} onRefresh={reload} onNavigateTab={setActiveTab} />
                    </>
                ))}
                {activeTab === 'firewall' && <FirewallTab />}
                {activeTab === 'ssh-keys' && <SSHKeysTab />}
                {activeTab === 'ip-lists' && <IPListsTab />}
                {activeTab === 'integrity' && <IntegrityTab />}
                {activeTab === 'audit' && <AuditTab />}
                {activeTab === 'events' && <EventsTab />}
                {activeTab === 'settings' && <SecurityConfigTab />}
            </div>
        </div>
    );
};

export default Security;
