import { useTranslation } from 'react-i18next';
import DataTable from '../ds/DataTable';
import DataTableFooter from '../ds/DataTableFooter';
import ListToolbar from '../ds/ListToolbar';
import { Button } from '../ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/select';
import { useEffectiveEnvironment } from './useEffectiveEnvironment';
import InfoTip from '@/components/InfoTip';

export default function EffectiveEnvironment({ appId }) {
    const { t } = useTranslation();
    const { services, service, selectService, data, loading, error, refresh } = useEffectiveEnvironment(appId);
    const scopes = {
        local: t('effectiveEnv.local', 'Local variables'),
        workspace: t('effectiveEnv.workspace', 'Workspace'),
        project: t('effectiveEnv.project', 'Project'),
        environment: t('effectiveEnv.environment', 'Environment'),
        resource: t('effectiveEnv.resource', 'Attached group'),
        direct: t('effectiveEnv.resource', 'Attached group'),
    };
    const source = row => [scopes[row.source_scope] || row.source_scope, row.group_name].filter(Boolean).join(' / ');
    const rows = data?.env_vars || [];
    const columns = [
        { key: 'key', header: t('effectiveEnv.key', 'Key'), sortable: true, render: row => <code>{row.key}</code> },
        { key: 'source_scope', header: t('effectiveEnv.source', 'Winning source'), render: source },
        { key: 'overrides', header: t('effectiveEnv.overrides', 'Overrides inherited source'), render: row => row.overrides ? source(row.overrides) : '—' },
        { key: 'target_service', header: t('effectiveEnv.target', 'Target service'), render: row => row.target_service || t('effectiveEnv.allServices', 'All services') },
        { key: 'is_reference', header: t('effectiveEnv.value', 'Value'), render: row => row.is_reference ? t('effectiveEnv.reference', 'Reference · resolved at deployment') : t('effectiveEnv.hidden', 'Hidden') },
    ];
    return <div className="env-vars-container">
        <p className="hint">{t('effectiveEnv.explanationShort', 'Managed variables for the next deploy.')} <InfoTip>{t('effectiveEnv.explanation', 'Managed variables for the next deployment or restart, not a live container inspection. Image and Compose-file variables are not included. Values are hidden, including references and interpolated secrets.')}</InfoTip></p>
        <ListToolbar tools={<Button variant="outline" onClick={refresh} disabled={loading}>{t('effectiveEnv.refresh', 'Refresh')}</Button>}>
            {services.length > 0 ? <Select value={service || ''} onValueChange={selectService}>
                <SelectTrigger aria-label={t('effectiveEnv.service', 'Compose service')}><SelectValue /></SelectTrigger>
                <SelectContent>{services.map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
            </Select> : !loading && !error && <span className="hint">{t('effectiveEnv.unfiltered', 'No Compose services discovered; showing configuration without a service filter.')}</span>}
        </ListToolbar>
        {loading ? <p role="status">{t('effectiveEnv.loading', 'Loading effective environment…')}</p>
            : error ? <p role="alert" className="error-message">{t('effectiveEnv.error', 'Could not load the effective environment. Retry with Refresh.')}</p>
                : <>
                    {data?.complete === false && <p role="alert" className="error-message">{t('effectiveEnv.incomplete', 'Incomplete: inherited variables could not be resolved. Only local configuration is shown; override information may be missing.')}</p>}
                    <DataTable columns={columns} data={rows} keyField="key"
                        emptyTitle={data?.complete === false ? t('effectiveEnv.incompleteTitle', 'Inherited configuration unavailable') : t('effectiveEnv.empty', 'No managed variables')}
                        emptyMessage={data?.complete === false ? t('effectiveEnv.incompleteEmpty', 'No local variables to show. Refresh to retry inherited configuration.') : t('effectiveEnv.emptyMessage', 'No local or inherited variables apply to this selection.')}
                        footer={<DataTableFooter shown={rows.length} total={rows.length} />} />
                </>}
    </div>;
}
