// Recent DNS activity for a single DNS-provider connection. Renders the
// provider change-log (GET /dns/changes?config_id=…) so a user can see exactly
// what ServerKit pushed to their Cloudflare account — action, record, and the
// result of each sync. Lazily loads when expanded.
import { useCallback, useEffect, useState } from 'react';
import ErrorState from '../../ErrorState';
import { Activity } from 'lucide-react';
import api from '../../../services/api';
import { timeAgo } from '../../../utils/time';
import { useTranslation } from 'react-i18next';
import { DataTable } from '@/components/ds';

// result → Badge-like pill tone. ok=green, error=red, conflict=amber, skipped=muted.
const RESULT_TONE = {
    ok: 'ok',
    error: 'danger',
    conflict: 'warn',
    skipped: 'neutral',
};

// The provider change log: newest first as the API returns it, read-only.
const ACTIVITY_COLUMNS = [
    {
        key: 'created_at',
        headerKey: 'common.labels.time', header: 'Time',
        cellClassName: 'sk-cell-dim dns-activity__time',
        render: (c) => <span title={c.created_at}>{timeAgo(c.created_at)}</span>,
    },
    {
        key: 'action',
        headerKey: 'common.labels.action', header: 'Action',
        render: (c) => (
            <span className={`dns-activity__action dns-activity__action--${c.action}`}>{c.action}</span>
        ),
    },
    {
        key: 'record',
        headerKey: 'app.dnsActivity.record', header: 'Record',
        render: (c) => (
            <div className="dns-activity__record">
                <span className={`dns-rtype dns-rtype--${(c.record_type || '').toLowerCase()}`}>{c.record_type}</span>
                <span className="dns-activity__name">{c.name}</span>
                {c.error && <span className="dns-activity__error">{c.error}</span>}
            </div>
        ),
    },
    {
        key: 'result',
        headerKey: 'app.dnsActivity.result', header: 'Result',
        render: (c) => (
            <span className={`conn-pill conn-pill--${RESULT_TONE[c.result] || 'neutral'}`}>{c.result}</span>
        ),
    },
];

export default function DnsActivity({ configId, limit = 25 }) {
    const { t } = useTranslation();
    const [changes, setChanges] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await api.getDnsChanges({ configId, limit });
            setChanges(data.changes || []);
        } catch (err) {
            setError(err);
        } finally {
            setLoading(false);
        }
    }, [configId, limit]);

    useEffect(() => { load(); }, [load]);

    if (loading) {
        return <div className="dns-activity__status">{t('app.dnsActivity.loadingRecentChanges', 'Loading recent changes…')}</div>;
    }

    if (error) {
        return <ErrorState compact error={error} onRetry={load} />;
    }

    if (changes.length === 0) {
        return (
            <div className="dns-activity__empty">
                <Activity size={16} />
                <span>{t('app.dnsActivity.noDnsChangesYet', 'No DNS changes yet')}</span>
            </div>
        );
    }

    return (
        <div className="dns-activity">
            <DataTable
                columns={ACTIVITY_COLUMNS}
                data={changes}
                keyField="id"
                sortable={false}
                columnMenu={false}
                // The connection row is the frame; the change log scrolls in it.
                className="sk-dtable-wrap--flush sk-dtable-wrap--sticky dns-activity__table-wrap"
            />
        </div>
    );
}
