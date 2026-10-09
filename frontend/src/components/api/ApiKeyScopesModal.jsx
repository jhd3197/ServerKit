import { useState, useEffect, useMemo } from 'react';
import { ShieldCheck } from 'lucide-react';
import api from '../../services/api';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { useTranslation } from 'react-i18next';

const FULL_ACCESS = '*';

// Fallback catalog used if the API call fails (keeps the picker usable offline /
// in tests). The server-provided catalog is authoritative when available.
const FALLBACK_SCOPES = [
    { key: 'read', labelKey: 'app.apiKeyScopesModal.readAll', label: 'Read (all)', group: 'General', descriptionKey: 'app.apiKeyScopesModal.readOnlyAccessAcrossAllResources', description: 'Read-only access across all resources.' },
    { key: 'write', labelKey: 'app.apiKeyScopesModal.writeAll', label: 'Write (all)', group: 'General', descriptionKey: 'app.apiKeyScopesModal.createAndModifyAccessAcrossAll', description: 'Create and modify access across all resources.' },
    { key: 'apps:read', labelKey: 'app.apiKeyScopesModal.viewApplications', label: 'View services', group: 'Applications', descriptionKey: 'app.apiKeyScopesModal.listAndInspectManagedApplications', description: 'List and inspect managed services.' },
    { key: 'apps:write', labelKey: 'app.apiKeyScopesModal.manageApplications', label: 'Manage services', group: 'Applications', descriptionKey: 'app.apiKeyScopesModal.createUpdateAndDeleteApplications', description: 'Create, update, and delete services.' },
];

/**
 * Reusable scope picker for API keys. Renders checkboxes grouped by `group`
 * plus a "Full access (*)" master toggle. The catalog is fetched from the API
 * (with a static fallback). Controlled via `value` / `onChange`.
 *
 * Props:
 *   value:    string[] currently-selected scope keys (may contain '*').
 *   onChange: (string[]) => void
 */
const ApiKeyScopesModal = ({ value = [], onChange }) => {
    const { t } = useTranslation();
    const [catalog, setCatalog] = useState(FALLBACK_SCOPES);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        api.getApiKeyScopes()
            .then(data => {
                if (active && data?.scopes?.length) setCatalog(data.scopes);
            })
            .catch(() => { /* keep fallback */ })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const fullAccess = value.includes(FULL_ACCESS);

    const groups = useMemo(() => {
        const byGroup = {};
        for (const scope of catalog) {
            (byGroup[scope.group] ||= []).push(scope);
        }
        return Object.entries(byGroup);
    }, [catalog]);

    const toggleFullAccess = (checked) => {
        onChange(checked ? [FULL_ACCESS] : []);
    };

    const toggleScope = (key) => {
        const next = value.filter(s => s !== FULL_ACCESS);
        if (next.includes(key)) {
            onChange(next.filter(s => s !== key));
        } else {
            onChange([...next, key]);
        }
    };

    return (
        <div className="api-key-scopes">
            <div className="api-key-scopes__master">
                <div className="api-key-scopes__master-label">
                    <ShieldCheck size={16} />
                    <div>
                        <span className="api-key-scopes__master-title">{t('app.apiKeyScopesModal.fullAccess', 'Full access (*)')}</span>
                        <span className="api-key-scopes__master-desc">
                            {t('app.apiKeyScopesModal.grantEveryScopeUseSparinglyFor', 'Grant every scope. Use sparingly for trusted automation.')}
                        </span>
                    </div>
                </div>
                <Switch checked={fullAccess} onCheckedChange={toggleFullAccess} />
            </div>

            {loading && (
                <p className="api-key-scopes__loading">{t('app.apiKeyScopesModal.loadingScopes', 'Loading scopes…')}</p>
            )}

            <div className={`api-key-scopes__groups ${fullAccess ? 'is-disabled' : ''}`}>
                {groups.map(([groupName, scopes]) => (
                    <div key={groupName} className="api-key-scopes__group">
                        <h5 className="api-key-scopes__group-title">{groupName}</h5>
                        {scopes.map(scope => (
                            <label key={scope.key} className="api-key-scopes__item">
                                <Checkbox
                                    checked={fullAccess || value.includes(scope.key)}
                                    disabled={fullAccess}
                                    onCheckedChange={() => toggleScope(scope.key)}
                                />
                                <span className="api-key-scopes__item-text">
                                    <span className="api-key-scopes__item-label">{scope.label}</span>
                                    <code className="api-key-scopes__item-key">{scope.key}</code>
                                    {scope.description && (
                                        <span className="api-key-scopes__item-desc">{scope.description}</span>
                                    )}
                                </span>
                            </label>
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ApiKeyScopesModal;
