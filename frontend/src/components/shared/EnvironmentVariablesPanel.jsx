import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

/**
 * Read-mostly facade showing the *resolved* shared variables for a resource —
 * i.e. the merged effective set from every shared variable group attached to it.
 * Secret values arrive pre-masked from the backend; this panel never reveals
 * them. Editing happens in SharedVariableGroups (the group is the source of
 * truth); this surface is the read-side facade meant to be embedded on a
 * resource's detail page.
 *
 * Deliberately NOT converged onto components/EnvironmentVariables.jsx (the
 * app's own env-var editor) or SharedVariableGroups (the group editor). Those
 * two own a stored row — it has an id, you create/edit/delete it, and a saved
 * view over it means something. A row here is a computed merge result: no id,
 * no owner, nothing to act on, and it exists only to answer "where did this
 * value come from and does it actually win". Same word, three data shapes.
 *
 * Provenance: when the hierarchical resolver is available, each variable shows
 * which scope it won at (workspace < project < environment < direct attachment).
 * For applications we also cross-check the app's LOCAL env vars: shared groups
 * ARE injected into the container at deploy, but the app's own local env vars
 * take precedence, so when the same key exists locally the local value is what
 * actually applies — we flag that collision.
 *
 * Props:
 *   resourceType  one of SharedResourceService.RESOURCE_TYPES
 *   resourceId    the resource's id (number or string)
 */

// Ordered lowest → highest precedence. Used for the legend and the badge label.
const SCOPE_ORDER = ['workspace', 'project', 'environment', 'direct', 'resource'];
const SCOPE_LABELS = {
    workspace: 'Workspace',
    project: 'Project',
    environment: 'Environment',
    direct: 'Direct',
    resource: 'Direct',
};

const EnvironmentVariablesPanel = ({ resourceType, resourceId }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [variables, setVariables] = useState([]);
    const [groups, setGroups] = useState([]);
    // Set of LOCAL env-var keys (applications only). When a resolved shared
    // variable shares a key with this set, the local value wins at runtime.
    const [localKeys, setLocalKeys] = useState(null);
    const [hierarchical, setHierarchical] = useState(false);
    const [loading, setLoading] = useState(true);

    const [filter, setFilter] = useState('');

    const load = useCallback(async () => {
        if (!resourceType || resourceId == null) return;
        setLoading(true);

        // 1) Resolve shared variables. Prefer the hierarchical endpoint (carries
        //    a `source_scope` provenance marker); fall back to the flat resolver
        //    if it is unavailable so the panel never crashes.
        let resolved = [];
        let attachedGroups = [];
        let isHierarchical = false;
        try {
            const data = await api.getResolvedVariablesHierarchical(resourceType, resourceId);
            resolved = data.variables || [];
            isHierarchical = true;
        } catch {
            try {
                const data = await api.getResolvedVariables(resourceType, resourceId);
                resolved = data.variables || [];
                attachedGroups = data.groups || [];
            } catch (err) {
                toastError(toast, t('app.environmentVariablesPanel.failedToLoadSharedVariables', "Couldn't load shared variables."), err);
                console.error('Failed to load resolved variables:', err);
            }
        }

        // The hierarchical endpoint doesn't return the attached-group list; only
        // fetch it when we don't already have it (keeps the count accurate).
        if (isHierarchical) {
            try {
                const flat = await api.getResolvedVariables(resourceType, resourceId);
                attachedGroups = flat.groups || [];
            } catch {
                attachedGroups = [];
            }
        }

        // 2) For applications, fetch LOCAL env-var keys so we can flag conflicts.
        //    Masked — keys only, no values. Graceful on failure.
        let keys = null;
        if (resourceType === 'application') {
            try {
                const envData = await api.getEnvVars(resourceId, true);
                const rows = envData.env_vars || [];
                keys = new Set(rows.map((r) => r.key));
            } catch (err) {
                console.error('Failed to load local env vars:', err);
                keys = null;
            }
        }

        setVariables(resolved);
        setGroups(attachedGroups);
        setLocalKeys(keys);
        setHierarchical(isHierarchical);
        setLoading(false);
    }, [resourceType, resourceId, toast, t]);

    useEffect(() => { load(); }, [load]);

    const filtered = filter
        ? variables.filter((v) => v.key.toLowerCase().includes(filter.toLowerCase()))
        : variables;

    if (loading) {
        return <div className="shared-vars-panel shared-vars-panel--loading">{t('app.environmentVariablesPanel.loadingSharedVariables', 'Loading shared variables…')}</div>;
    }

    const showProvenance = hierarchical && variables.some((v) => v.source_scope);

    return (
        <div className="shared-vars-panel">
            <div className="shared-vars-panel__header">
                <h3>{t('app.environmentVariablesPanel.sharedVariables', 'Shared variables')}</h3>
                <span className="shared-vars-panel__count">
                    {t('app.environmentVariablesPanel.resolvedCount', '{{count}} resolved', { count: variables.length })} · {t('app.environmentVariablesPanel.groupCount', { count: groups.length, defaultValue_one: '1 group', defaultValue_other: '{{count}} groups' })}
                </span>
            </div>

            <p className="shared-vars-panel__hint">
                {t('app.environmentVariablesPanel.effectiveVariablesMergedFromEveryShared', 'Effective variables merged from every shared group attached to this resource. More specific scopes override broader ones on key collisions. Secret values are masked.')}
            </p>

            {showProvenance && (
                <div className="shared-vars-legend" aria-label={t('app.environmentVariablesPanel.precedenceOrder', 'Precedence order')}>
                    <span className="shared-vars-legend__label">{t('app.environmentVariablesPanel.precedence', 'Precedence')}</span>
                    {['workspace', 'project', 'environment', 'direct'].map((scope, i, arr) => (
                        <span key={scope} className="shared-vars-legend__item">
                            <span className={`scope-badge scope-badge--${scope}`}>
                                {SCOPE_LABELS[scope]}
                            </span>
                            {i < arr.length - 1 && (
                                <span className="shared-vars-legend__lt" aria-hidden="true">&lt;</span>
                            )}
                        </span>
                    ))}
                    <span className="shared-vars-legend__note">{t('app.environmentVariablesPanel.rightmostWins', '(rightmost wins)')}</span>
                </div>
            )}

            {resourceType === 'application' && localKeys && (
                <p className="shared-vars-panel__hint shared-vars-panel__hint--note">
                    {t('app.environmentVariablesPanel.sharedVariablesAreInjectedIntoThe', "Shared variables are injected into the container at deploy. The service's own Environment variables tab takes precedence, so where a key also exists locally the local value is what the container uses.")}
                </p>
            )}

            {variables.length > 5 && (
                <div className="shared-vars-panel__filter">
                    <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder={t('app.environmentVariablesPanel.filterVariables', 'Filter variables…')}
                    />
                </div>
            )}

            {filtered.length === 0 ? (
                <div className="shared-vars-panel__empty">
                    {filter
                        ? 'No matching variables'
                        : 'No shared variable groups attached to this resource yet.'}
                </div>
            ) : (
                <table className="shared-vars-table">
                    <thead>
                        <tr>
                            <th>{t('common.labels.key', 'Key')}</th>
                            <th>{t('common.labels.value', 'Value')}</th>
                            <th>{t('common.labels.source', 'Source')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.map((v) => {
                            const scope = v.source_scope;
                            const conflict = !!(localKeys && localKeys.has(v.key));
                            return (
                                <tr
                                    key={v.key}
                                    className={`${v.is_secret ? 'is-secret' : ''} ${conflict ? 'has-conflict' : ''}`.trim()}
                                >
                                    <td className="shared-vars-table__key">
                                        {v.key}
                                        {conflict && (
                                            <span
                                                className="conflict-badge"
                                                title={t('app.environmentVariablesPanel.thisKeyIsAlsoSetOn', "This key is also set on the service's Environment variables tab. The local value is what the container uses; the shared value is overridden.")}
                                            >
                                                {t('app.environmentVariablesPanel.setLocallyLocalValueApplies', 'Set locally (local value applies)')}
                                            </span>
                                        )}
                                    </td>
                                    <td className="shared-vars-table__value">{v.value}</td>
                                    <td className="shared-vars-table__group">
                                        {scope && SCOPE_ORDER.includes(scope) && (
                                            <span className={`scope-badge scope-badge--${scope}`}>
                                                {SCOPE_LABELS[scope]}
                                            </span>
                                        )}
                                        <span className="shared-vars-table__group-name">
                                            {v.group_name || '—'}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
        </div>
    );
};

export default EnvironmentVariablesPanel;
