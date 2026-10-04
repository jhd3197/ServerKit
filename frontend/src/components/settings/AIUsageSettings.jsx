import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import useFormat from '../../hooks/useFormat';
import { FormField } from '../FormField';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/select';
import { DataTable } from '../ds/DataTable';
import { DataTableFooter } from '../ds/DataTableFooter';
import EmptyState from '../EmptyState';
import { CardHeader } from '../ui/card';
import { Drawer } from '../ds/Drawer';

// Radix Select cannot hold an empty value; this stands in for "no filter".
const ALL = '__all';

export default function AIUsageSettings({ connections }) {
    const { t } = useTranslation();
    const { formatNumber, formatDateTime } = useFormat();
    const [filters, setFilters] = useState({ days: '30', profile: '', connection_id: '', user_id: '', workspace_id: '' });
    const [applied, setApplied] = useState(filters);
    const [data, setData] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [group, setGroup] = useState('model');
    const [offset, setOffset] = useState(0);
    const [revision, setRevision] = useState(0);
    const [selected, setSelected] = useState(null);
    useEffect(() => {
        let active = true; setBusy(true); setError('');
        api.aiGetUsage({ ...applied, offset }).then((result) => { if (active) setData(result); }).catch((e) => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [applied, offset, revision]);
    const money = (amount) => t('ai.usage.usd', '{{amount}} USD', { amount: formatNumber(amount, { maximumFractionDigits: 4 }) });
    const connectionName = (id) => connections.find((item) => item.id === id)?.name || id;
    const groups = {
        model: t('ai.usage.byModel', 'Model'), profile: t('ai.usage.byRole', 'Task role'),
        daily: t('ai.usage.byDay', 'Day'), connection_id: t('ai.usage.byConnection', 'Connection'),
        user_id: t('ai.usage.byUser', 'User'), workspace_id: t('ai.usage.byWorkspace', 'Workspace'),
    };
    return <section className="settings-card sk-ai-usage">
        <CardHeader variant="legacy"><div><h3>{t('ai.usage.title', 'AI usage')}</h3><p>{t('ai.usage.hint', 'Per-run accounting across chats, task roles, and provider attempts. Totals include the entire filtered period.')}</p></div>
            <Button variant="outline" disabled={busy} onClick={() => setRevision((value) => value + 1)}>{t('common.actions.refresh', 'Refresh')}</Button>
        </CardHeader>
        <div className="ai-connections__fields">
            <FormField htmlFor="ai-usage-days" label={t('ai.usage.period', 'Period')}>
                <Select value={filters.days} onValueChange={(days) => setFilters({ ...filters, days })}>
                    <SelectTrigger id="ai-usage-days"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="1">{t('ai.usage.day', 'Last 24 hours')}</SelectItem>
                        <SelectItem value="7">{t('ai.usage.week', 'Last 7 days')}</SelectItem>
                        <SelectItem value="30">{t('ai.usage.month', 'Last 30 days')}</SelectItem>
                        <SelectItem value="90">{t('ai.usage.quarter', 'Last 90 days')}</SelectItem>
                    </SelectContent>
                </Select>
            </FormField>
            <FormField htmlFor="ai-usage-role" label={groups.profile}>
                <Select value={filters.profile || ALL} onValueChange={(value) => setFilters({ ...filters, profile: value === ALL ? '' : value })}>
                    <SelectTrigger id="ai-usage-role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>{t('ai.usage.allRoles', 'All task roles')}</SelectItem>
                        <SelectItem value="utility">{t('ai.management.utility', 'Utility')}</SelectItem>
                        <SelectItem value="standard">{t('ai.management.standard', 'Standard')}</SelectItem>
                        <SelectItem value="advanced">{t('ai.management.advanced', 'Advanced')}</SelectItem>
                    </SelectContent>
                </Select>
            </FormField>
            <FormField htmlFor="ai-usage-connection" label={groups.connection_id}>
                <Select value={filters.connection_id ? String(filters.connection_id) : ALL} onValueChange={(value) => setFilters({ ...filters, connection_id: value === ALL ? '' : value })}>
                    <SelectTrigger id="ai-usage-connection"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ALL}>{t('ai.usage.allConnections', 'All connections')}</SelectItem>
                        {connections.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.name}</SelectItem>)}
                    </SelectContent>
                </Select>
            </FormField>
            {['user_id', 'workspace_id'].map((key) => <FormField key={key} htmlFor={`ai-usage-${key}`} label={groups[key]} hint={t('ai.usage.idFilter', 'Optional numeric ID')}><Input id={`ai-usage-${key}`} type="number" min="1" value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} /></FormField>)}
        </div>
        <div className="settings-actions settings-actions--footer"><Button variant="outline" disabled={busy} onClick={() => { setOffset(0); setApplied({ ...filters }); }}>{t('ai.usage.apply', 'Apply filters')}</Button></div>
        {error && <p className="error-message" role="alert">{error}</p>}
        {busy && <EmptyState loading title={t('common.loading', 'Loading…')} />}
        {!busy && data?.totals && <>
            <div className="stat-strip">
                <div className="stat-strip__item"><span>{t('ai.usage.cost', 'Known cost')}</span><strong>{money(data.totals.cost)}</strong></div>
                <div className="stat-strip__item"><span>{t('ai.usage.tokens', 'Tokens')}</span><strong>{formatNumber(data.totals.tokens)}</strong></div>
                <div className="stat-strip__item"><span>{t('ai.usage.runs', 'Runs')}</span><strong>{formatNumber(data.totals.runs)}</strong></div>
                <div className="stat-strip__item"><span>{t('ai.usage.errors', 'Stopped / failed')}</span><strong>{formatNumber(data.totals.errors)}</strong></div>
            </div>
            <p className="settings-hint">{t('ai.usage.unknowns', '{{count}} runs have unknown or partial pricing. Known cost is not a complete billing total.', { count: data.totals.unknown_cost_runs })}</p>
            <p className="settings-hint">{t('ai.usage.latency', 'Average run duration: {{seconds}} seconds', { seconds: formatNumber(data.totals.average_duration_ms / 1000, { maximumFractionDigits: 1 }) })}</p>
            {(data.allowances || []).map((item) => <p key={item.scope}>{t('ai.usage.allowance', '{{scope}} monthly allowance: {{remaining}} remaining of {{limit}}', { scope: item.scope, remaining: money(item.remaining), limit: money(item.limit) })}</p>)}
            <FormField htmlFor="ai-usage-group" label={t('ai.usage.breakdown', 'Cost breakdown')}>
                <Select value={group} onValueChange={setGroup}>
                    <SelectTrigger id="ai-usage-group"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {Object.entries(groups).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
                    </SelectContent>
                </Select>
            </FormField>
            <DataTable data={data.groups[group] || []} keyField="label" columns={[
                { key: 'label', header: groups[group], render: (item) => group === 'connection_id' ? connectionName(item.label) : item.label },
                { key: 'runs', header: t('ai.usage.runs', 'Runs') },
                { key: 'tokens', header: t('ai.usage.tokens', 'Tokens'), render: (item) => formatNumber(item.tokens) },
                { key: 'cost', header: t('ai.usage.cost', 'Known cost'), render: (item) => money(item.cost) },
            ]} emptyTitle={t('ai.usage.empty', 'No AI runs in this period')} />
            <h4>{t('ai.usage.recent', 'Run details')}</h4>
            <DataTable data={data.runs} columns={[
                { key: 'created_at', header: t('ai.usage.when', 'Started'), render: (run) => formatDateTime(run.created_at) },
                { key: 'model', header: groups.model }, { key: 'profile', header: groups.profile },
                { key: 'status', header: t('ai.usage.outcome', 'Outcome') },
                { key: 'cost', header: t('ai.usage.cost', 'Known cost'), render: (run) => run.usage.cost_source === 'unknown' ? t('ai.usage.unknown', 'Unknown') : money(run.cost) },
                { key: 'details', header: '', sortable: false, render: (run) => <Button variant="ghost" onClick={() => setSelected(run)}>{t('ai.usage.details', 'Details')}</Button> },
            ]} emptyTitle={t('ai.usage.empty', 'No AI runs in this period')} />
            <DataTableFooter shown={data.runs.length} total={data.totals.runs} page={Math.floor(offset / 50) + 1}
                totalPages={Math.max(1, Math.ceil(data.totals.runs / 50))} onPageChange={(page) => setOffset((page - 1) * 50)} />
            <Drawer open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }} width={640} title={t('ai.usage.details', 'Details')}>
              {selected && <>
                <strong>{selected.model}</strong><p>{selected.reason}</p>
                <p>{t('ai.usage.source', 'Cost source: {{source}}', { source: selected.usage.cost_source })}</p>
                <DataTable data={(selected.usage.attempts || []).map((item, index) => ({ ...item, id: index }))} columns={[
                    { key: 'connection_id', header: groups.connection_id, render: (item) => connectionName(item.connection_id) },
                    { key: 'model', header: groups.model }, { key: 'status', header: t('ai.usage.outcome', 'Outcome') },
                    { key: 'total_tokens', header: t('ai.usage.tokens', 'Tokens') },
                ]} emptyTitle={t('ai.usage.noAttempts', 'No provider attempts were recorded')} />
                <Button variant="ghost" onClick={() => setSelected(null)}>{t('common.actions.close', 'Close')}</Button>
              </>}
            </Drawer>
        </>}
    </section>;
}
