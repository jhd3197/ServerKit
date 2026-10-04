import { useState } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useConfirm } from '../hooks/useConfirm';
import CopyField from './CopyField';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';
import { toastError } from '@/utils/errorMessage';

const PrivateURLSection = ({ app, onUpdate }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const [loading, setLoading] = useState(false);
    const [customSlug, setCustomSlug] = useState('');
    const [editMode, setEditMode] = useState(false);

    const baseUrl = window.location.origin;
    const privateUrl = app.private_slug ? `${baseUrl}/p/${app.private_slug}` : null;

    async function handleEnable(e) {
        e?.preventDefault();
        setLoading(true);
        try {
            await api.enablePrivateUrl(app.id, customSlug || undefined);
            toast.success(t('app.privateURLSection.privateUrlEnabled', 'Private URL enabled'));
            onUpdate();
            setCustomSlug('');
        } catch (error) {
            toastError(toast, t('app.privateURLSection.failedToEnablePrivateUrl', 'Failed to enable private URL'), error);
        } finally {
            setLoading(false);
        }
    }

    async function handleDisable() {
        if (!await confirm({
            title: t('app.privateURLSection.disablePrivateUrl', 'Disable private URL'),
            message: t('app.privateURLSection.disableThePrivateUrlTheCurrent', 'Disable the private URL? The current slug will be released.'),
            confirmText: t('app.privateURLSection.disableUrl', 'Disable URL'),
        })) return;

        setLoading(true);
        try {
            await api.disablePrivateUrl(app.id);
            toast.success(t('app.privateURLSection.privateUrlDisabled', 'Private URL disabled'));
            onUpdate();
        } catch (error) {
            toastError(toast, t('app.privateURLSection.failedToDisablePrivateUrl', 'Failed to disable private URL'), error);
        } finally {
            setLoading(false);
        }
    }

    async function handleRegenerate() {
        if (!await confirm({
            title: t('app.privateURLSection.regeneratePrivateUrl', 'Regenerate private URL'),
            message: t('app.privateURLSection.generateANewRandomSlugThe', 'Generate a new random slug? The old URL will stop working.'),
            confirmText: t('app.privateURLSection.regenerateUrl', 'Regenerate URL'),
        })) return;

        setLoading(true);
        try {
            await api.regeneratePrivateUrl(app.id);
            toast.success(t('app.privateURLSection.privateUrlRegenerated', 'Private URL regenerated'));
            onUpdate();
        } catch (error) {
            toastError(toast, t('app.privateURLSection.failedToRegenerate', 'Failed to regenerate'), error);
        } finally {
            setLoading(false);
        }
    }

    async function handleUpdateSlug(e) {
        e?.preventDefault();
        if (!customSlug) return;

        setLoading(true);
        try {
            await api.updatePrivateUrl(app.id, customSlug);
            toast.success(t('app.privateURLSection.slugUpdated', 'Slug updated'));
            onUpdate();
            setEditMode(false);
            setCustomSlug('');
        } catch (error) {
            toastError(toast, t('app.privateURLSection.failedToUpdateSlug', 'Failed to update slug'), error);
        } finally {
            setLoading(false);
        }
    }

    function handleSlugInput(e) {
        // Only allow lowercase letters, numbers, and hyphens
        const value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
        setCustomSlug(value);
    }

    return (
        <div className="private-url-section">
            <div className="section-header">
                <h3>
                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    {t('app.privateURLSection.privateUrl', 'Private URL')}
                </h3>
            </div>

            {!app.private_url_enabled ? (
                <div className="private-url-disabled">
                    <p className="hint">
                        {t('app.privateURLSection.enableAPrivateShareableUrlFor', 'Enable a private, shareable URL for this service. Private URLs are not publicly indexed and can be shared with specific people.')}
                    </p>
                    <form onSubmit={handleEnable} className="private-url-form">
                        <div className="input-group">
                            <span className="input-prefix">/p/</span>
                            <input
                                type="text"
                                value={customSlug}
                                onChange={handleSlugInput}
                                placeholder={t('app.privateURLSection.customSlugOptional', 'custom-slug (optional)')}
                                className="slug-input"
                                minLength={3}
                                maxLength={50}
                            />
                        </div>
                        <SharedButton variant="primary"
                            type="submit"
                            className="btn btn-primary"
                            disabled={loading}
                        >
                            {loading ? 'Enabling...' : 'Enable Private URL'}
                        </SharedButton>
                    </form>
                    <p className="slug-hint">
                        {t('app.privateURLSection.leaveEmptyToAutoGenerateA', 'Leave empty to auto-generate a random slug, or enter your own custom slug.')}
                    </p>
                </div>
            ) : (
                <div className="private-url-enabled">
                    <div className="private-url-display">
                        <div className="url-box">
                            <CopyField label={t('app.privateURLSection.yourPrivateUrl', 'Your private URL:')} value={privateUrl} />
                        </div>
                        <div className="url-actions">
                            <SharedButton variant="outline" type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={handleRegenerate}
                                disabled={loading}
                                title={t('app.privateURLSection.generateNewRandomSlug', 'Generate new random slug')}
                            >
                                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                                    <polyline points="23 4 23 10 17 10" />
                                    <polyline points="1 20 1 14 7 14" />
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                </svg>
                                {t('app.privateURLSection.regenerate', 'Regenerate')}
                            </SharedButton>
                        </div>
                    </div>

                    {editMode ? (
                        <form onSubmit={handleUpdateSlug} className="slug-edit-form">
                            <div className="input-group">
                                <span className="input-prefix">/p/</span>
                                <input
                                    type="text"
                                    value={customSlug}
                                    onChange={handleSlugInput}
                                    placeholder="new-slug"
                                    className="slug-input"
                                    minLength={3}
                                    maxLength={50}
                                    autoFocus
                                />
                            </div>
                            <SharedButton variant="primary"
                                type="submit"
                                className="btn btn-primary btn-sm"
                                disabled={loading || !customSlug}
                            >
                                {t('common.actions.save', 'Save')}
                            </SharedButton>
                            <SharedButton variant="outline"
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setEditMode(false);
                                    setCustomSlug('');
                                }}
                            >
                                {t('common.actions.cancel', 'Cancel')}
                            </SharedButton>
                        </form>
                    ) : (
                        <SharedButton variant="unstyled" type="button"
                            className="btn-link"
                            onClick={() => setEditMode(true)}
                        >
                            {t('app.privateURLSection.changeSlug', 'Change slug')}
                        </SharedButton>
                    )}

                    <div className="private-url-footer">
                        <SharedButton variant="danger" type="button"
                            className="btn btn-danger btn-sm"
                            onClick={handleDisable}
                            disabled={loading}
                        >
                            {t('app.privateURLSection.disablePrivateUrl3', 'Disable private URL')}
                        </SharedButton>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PrivateURLSection;
