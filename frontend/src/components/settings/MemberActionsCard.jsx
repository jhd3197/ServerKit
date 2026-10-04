import { useEffect, useState } from 'react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

// Admin control for the member-action escape hatch (plan 19 Phase 5 / plan 29 #13).
// Curated, parameterized actions a workspace member may run for an app they can
// reach (no free text ever reaches a shell; every run is audit-logged). On by
// default — this surface just makes the flag visible so an operator can turn the
// whole thing off. The templates are deliberately conservative, so the default
// stays ON.

const MemberActionsCard = () => {
    const { t } = useTranslation();
    const [enabled, setEnabled] = useState(true);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        api.getSystemSettings()
            .then((data) => {
                if (data.security_member_actions_enabled != null) {
                    setEnabled(Boolean(data.security_member_actions_enabled));
                }
            })
            .catch(() => { /* leave default */ })
            .finally(() => setLoading(false));
    }, []);

    async function handleSave() {
        setSaving(true);
        setMessage(null);
        try {
            await api.updateSystemSettings({ security_member_actions_enabled: enabled });
            setMessage({ type: 'success', text: 'Member actions setting saved.' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to save setting' });
        } finally {
            setSaving(false);
            setTimeout(() => setMessage(null), 6000);
        }
    }

    if (loading) return null;

    return (
        <div className="settings-card">
            <h3>{t('app.memberActionsCard.memberActions', 'Member actions')}</h3>
            <p className="form-help form-help--flush">
                {t('app.memberActionsCard.letWorkspaceMembersRunASmall', "Let workspace members run a small set of curated, parameterized actions (like adjusting a service's backup frequency) for services they can reach. Every action is validated against a fixed schema and audit-logged, so no free text ever reaches the server shell. Turn this off to disable the whole member-action surface.")}
            </p>

            <div className="form-group">
                <label className="member-check-label">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => setEnabled(e.target.checked)}
                    />
                    <span>{t('app.memberActionsCard.allowMembersToRunCuratedActions', 'Allow members to run curated actions')}</span>
                </label>
            </div>

            <div className="form-actions">
                <Button variant="default" onClick={handleSave} disabled={saving}>
                    {saving ? t('common.saving', 'Saving…') : t('common.actions.save', 'Save')}
                </Button>
                {message && (
                    <span className={`timezone-message timezone-message--inline ${message.type}`}>
                        {message.text}
                    </span>
                )}
            </div>
        </div>
    );
};

export default MemberActionsCard;
