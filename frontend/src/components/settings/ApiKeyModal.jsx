import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import Modal from '../Modal';
import ApiKeyScopesModal from '../api/ApiKeyScopesModal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import CopyField from '../CopyField';
import { useTranslation } from 'react-i18next';

const TIER_OPTIONS = [
    { value: 'standard', labelKey: 'app.apiKeyModal.standard', label: 'Standard', desc: '100 req/min' },
    { value: 'elevated', labelKey: 'app.apiKeyModal.elevated', label: 'Elevated', desc: '500 req/min' },
    { value: 'unlimited', labelKey: 'app.apiKeyModal.unlimited', label: 'Unlimited', desc: '5000 req/min' },
];

const ApiKeyModal = ({ onClose, onSubmit, createdKey }) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [scopes, setScopes] = useState(['*']);
    const [tier, setTier] = useState('standard');
    const [expiresAt, setExpiresAt] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setSaving(true);
        try {
            await onSubmit({
                name: name.trim(),
                scopes,
                tier,
                expires_at: expiresAt || null,
            });
        } finally {
            setSaving(false);
        }
    };

    // Show created key view
    if (createdKey) {
        return (
            <Modal open={true} onClose={onClose} title={t('app.apiKeyModal.apiKeyCreated', 'API key created')} className="api-key-modal">
                        <div className="api-key-modal__warning">
                            <AlertTriangle size={16} />
                            <span>{t('app.apiKeyModal.copyThisKeyNowItWill', 'Copy this key now. It will not be shown again.')}</span>
                        </div>
                        <CopyField value={createdKey} label={t('app.apiKeyModal.apiKey', 'API key')} secret />
                    <div className="modal-footer">
                        <Button variant="default" onClick={onClose}>{t('common.actions.done', 'Done')}</Button>
                    </div>
            </Modal>
        );
    }

    return (
        <Modal open={true} onClose={onClose} title={t('app.apiKeyModal.createApiKey', 'Create API key')} className="api-key-modal">
                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        <div className="form-group">
                            <Label>{t('common.labels.name', 'Name')}</Label>
                            <Input
                                type="text"
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder={t('app.apiKeyModal.eGCiCdPipelineMonitoring', 'e.g. CI/CD Pipeline, Monitoring Script')}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <Label>{t('app.apiKeyModal.tier', 'Tier')}</Label>
                            <div className="api-key-modal__tiers">
                                {TIER_OPTIONS.map(t => (
                                    <Button variant="unstyled"
                                        key={t.value}
                                        type="button"
                                        className={`api-key-modal__tier-btn ${tier === t.value ? 'active' : ''}`}
                                        onClick={() => setTier(t.value)}
                                    >
                                        <span className="api-key-modal__tier-label">{t.label}</span>
                                        <span className="api-key-modal__tier-desc">{t.desc}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>

                        <div className="form-group">
                            <Label>{t('app.apiKeyModal.scopes', 'Scopes')}</Label>
                            <ApiKeyScopesModal value={scopes} onChange={setScopes} />
                        </div>

                        <div className="form-group">
                            <Label>{t('app.apiKeyModal.expirationOptional', 'Expiration (optional)')}</Label>
                            <Input
                                type="datetime-local"
                                value={expiresAt}
                                onChange={e => setExpiresAt(e.target.value)}
                            />
                            <span className="form-help">{t('app.apiKeyModal.leaveEmptyForNoExpiration', 'Leave empty for no expiration')}</span>
                        </div>
                    </div>
                    <div className="modal-footer">
                        <Button type="button" variant="outline" onClick={onClose}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button type="submit" variant="default" disabled={saving || !name.trim()}>
                            {saving ? 'Creating...' : 'Create Key'}
                        </Button>
                    </div>
                </form>
        </Modal>
    );
};

export default ApiKeyModal;
