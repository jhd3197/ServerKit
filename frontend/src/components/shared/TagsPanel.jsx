import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

/**
 * Reusable polymorphic tags panel for any resource.
 *
 * Props:
 *   resourceType  one of SharedResourceService.RESOURCE_TYPES
 *   resourceId    the resource's id (number or string)
 *   readOnly      hide the add/remove controls (default false)
 */
const TagsPanel = ({ resourceType, resourceId, readOnly = false }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [tags, setTags] = useState([]);
    const [loading, setLoading] = useState(true);
    const [newTag, setNewTag] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!resourceType || resourceId == null) return;
        try {
            setLoading(true);
            const data = await api.listResourceTags(resourceType, resourceId);
            setTags(data.tags || []);
        } catch (err) {
            console.error('Failed to load tags:', err);
        } finally {
            setLoading(false);
        }
    }, [resourceType, resourceId]);

    useEffect(() => { load(); }, [load]);

    async function handleAdd(e) {
        e.preventDefault();
        const value = newTag.trim();
        if (!value) return;
        setSaving(true);
        try {
            await api.addResourceTag(resourceType, resourceId, value);
            setNewTag('');
            load();
        } catch (err) {
            toastError(toast, t('app.tagsPanel.failedToAddTag', "Couldn't add the tag."), err);
        } finally {
            setSaving(false);
        }
    }

    async function handleRemove(tag) {
        try {
            await api.removeResourceTag(resourceType, resourceId, tag);
            setTags((prev) => prev.filter((t) => t.tag !== tag));
        } catch (err) {
            toastError(toast, t('app.tagsPanel.failedToRemoveTag', "Couldn't remove the tag."), err);
        }
    }

    return (
        <div className="shared-tags">
            <div className="shared-tags__list">
                {loading ? (
                    <span className="shared-tags__hint">{t('common.loading', 'Loading…')}</span>
                ) : tags.length === 0 ? (
                    <span className="shared-tags__hint">{t('app.tagsPanel.noTagsYet', 'No tags yet')}</span>
                ) : (
                    tags.map((tag) => (
                        <span key={tag.id} className="shared-tag">
                            <span className="shared-tag__label">{tag.tag}</span>
                            {!readOnly && (
                                <Button variant="unstyled"
                                    type="button"
                                    className="shared-tag__remove"
                                    onClick={() => handleRemove(tag.tag)}
                                    aria-label={t('app.tagsPanel.removeTag', 'Remove tag {{tag}}', { tag: tag.tag })}
                                    title={t('app.tagsPanel.removeTag2', 'Remove tag')}
                                >
                                    &times;
                                </Button>
                            )}
                        </span>
                    ))
                )}
            </div>

            {!readOnly && (
                <form className="shared-tags__add" onSubmit={handleAdd}>
                    <Input
                        type="text"
                        value={newTag}
                        onChange={(e) => setNewTag(e.target.value)}
                        placeholder={t('app.tagsPanel.addATag', 'Add a tag…')}
                        className="shared-tags__input"
                    />
                    <Button type="submit" size="sm" disabled={saving || !newTag.trim()}>
                        {t('common.actions.add', 'Add')}
                    </Button>
                </form>
            )}
        </div>
    );
};

export default TagsPanel;
