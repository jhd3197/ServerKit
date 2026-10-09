import { useState, useMemo } from 'react';
import { useAuth } from '../../contexts/useAuth.js';
import api from '../../services/api';
import { Check, RotateCcw } from 'lucide-react';
import { sanitizeSvgInner } from '../../utils/sanitizeSvg';
import {
    SIDEBAR_ITEMS,
    SIDEBAR_PRESETS,
    SIDEBAR_CATEGORIES,
    CATEGORY_LABELS
} from '../sidebarItems';
import { Button } from '@/components/ui/button';
import useSettingFocus from '../../hooks/useSettingFocus';
import { useManagedProfile } from '../../contexts/useManagedProfile';
import { useTranslation } from 'react-i18next';
import { translateLabel } from '../../i18n/labels';

const PRESET_ICONS = {
    recommended: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
    full: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
    web: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
    email: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
    devops: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"><rect x="2" y="7" width="6" height="6" rx="1"/><rect x="9" y="7" width="6" height="6" rx="1"/><rect x="16" y="7" width="6" height="6" rx="1"/><rect x="2" y="14" width="6" height="6" rx="1"/><rect x="9" y="14" width="6" height="6" rx="1"/></svg>,
    minimal: <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
};

const SidebarSettings = () => {
    const { t } = useTranslation();
    const { user, updateUser } = useAuth();
    const currentConfig = user?.sidebar_config || { preset: 'recommended', hiddenItems: [] };
    const [preset, setPreset] = useState(currentConfig.preset || 'recommended');
    const [hiddenItems, setHiddenItems] = useState(currentConfig.hiddenItems || []);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);
    const register = useSettingFocus();
    // Items ServerKit Cloud holds under the managed profile (plan 25) are not
    // offered as things to re-add — they left every preset already.
    const { hiddenSidebarIds: managedHidden } = useManagedProfile();

    const toggleableItems = useMemo(
        () => SIDEBAR_ITEMS.filter(item => !item.alwaysVisible && !managedHidden.has(item.id)),
        [managedHidden]
    );

    const activeHidden = preset === 'custom'
        ? hiddenItems
        : (SIDEBAR_PRESETS[preset]?.hiddenItems || []);

    const visibleCount = SIDEBAR_ITEMS.filter(
        item => item.alwaysVisible || !activeHidden.includes(item.id)
    ).length;

    const handlePresetChange = (newPreset) => {
        if (newPreset === preset) return;
        setPreset(newPreset);
        if (newPreset !== 'custom') {
            setHiddenItems(SIDEBAR_PRESETS[newPreset]?.hiddenItems || []);
        }
    };

    const handleToggleItem = (itemId) => {
        // Switching to custom mode when toggling
        if (preset !== 'custom') {
            setPreset('custom');
            // Start from current preset's hidden items
            const currentHidden = SIDEBAR_PRESETS[preset]?.hiddenItems || [];
            const newHidden = currentHidden.includes(itemId)
                ? currentHidden.filter(id => id !== itemId)
                : [...currentHidden, itemId];
            setHiddenItems(newHidden);
        } else {
            setHiddenItems(prev =>
                prev.includes(itemId)
                    ? prev.filter(id => id !== itemId)
                    : [...prev, itemId]
            );
        }
    };

    const handleSave = async () => {
        setSaving(true);
        setMessage(null);
        try {
            const config = { preset, hiddenItems: preset === 'custom' ? hiddenItems : [] };
            await api.updateCurrentUser({ sidebar_config: config });
            await updateUser({ sidebar_config: config });
            setMessage({ type: 'success', text: 'Sidebar preferences saved' });
        } catch (err) {
            setMessage({ type: 'error', text: err.message || 'Failed to save preferences' });
        } finally {
            setSaving(false);
            setTimeout(() => setMessage(null), 3000);
        }
    };

    const handleReset = () => {
        setPreset('recommended');
        setHiddenItems([]);
    };

    const hasChanges = preset !== (currentConfig.preset || 'recommended') ||
        JSON.stringify(hiddenItems) !== JSON.stringify(currentConfig.hiddenItems || []);

    return (
        <div className="sidebar-settings">
            <div {...register('sidebar-view-profiles', 'settings-section')}>
                <h3>{t('app.sidebarSettings.viewProfiles', 'View profiles')}</h3>
                <p className="settings-section-desc">
                    {t('app.sidebarSettings.chooseAPresetOrBuildA', 'Choose a preset or build a custom view. Only visible items appear in your sidebar.')}
                </p>

                <div className="sidebar-presets">
                    {Object.entries(SIDEBAR_PRESETS).map(([key, profile]) => (
                        <Button variant="unstyled" type="button"
                            key={key}
                            className={`sidebar-preset-card ${preset === key ? 'active' : ''}`}
                            onClick={() => handlePresetChange(key)}
                        >
                            <div className="preset-card-icon">
                                {PRESET_ICONS[key]}
                            </div>
                            <div className="preset-card-info">
                                <span className="preset-card-label">{profile.label}</span>
                                <span className="preset-card-desc">{profile.description}</span>
                            </div>
                            {preset === key && (
                                <div className="preset-card-check">
                                    <Check size={16} />
                                </div>
                            )}
                        </Button>
                    ))}
                    <Button variant="unstyled" type="button"
                        className={`sidebar-preset-card ${preset === 'custom' ? 'active' : ''}`}
                        onClick={() => handlePresetChange('custom')}
                    >
                        <div className="preset-card-icon">
                            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor">
                                <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                            </svg>
                        </div>
                        <div className="preset-card-info">
                            <span className="preset-card-label">{t('app.sidebarSettings.custom', 'Custom')}</span>
                            <span className="preset-card-desc">{t('app.sidebarSettings.toggleIndividualItemsOnOff', 'Toggle individual items on/off')}</span>
                        </div>
                        {preset === 'custom' && (
                            <div className="preset-card-check">
                                <Check size={16} />
                            </div>
                        )}
                    </Button>
                </div>
            </div>

            <div {...register('sidebar-items', 'settings-section')}>
                <div className="settings-section-header">
                    <h3>{t('app.sidebarSettings.sidebarItems', 'Sidebar items')}</h3>
                    <span className="sidebar-item-count">{t('app.sidebarSettings.visibleCount', '{{visible}} of {{total}} visible', { visible: visibleCount, total: SIDEBAR_ITEMS.length })}</span>
                </div>
                <p className="settings-section-desc">
                    {preset === 'custom'
                        ? t('app.sidebarSettings.toggleItemsToShowOrHide', 'Toggle items to show or hide them in your sidebar.')
                        : t('app.sidebarSettings.showingItemsForProfile', 'Showing items for the "{{profile}}" profile. Switch to Custom to change items one by one.', { profile: translateLabel(t, SIDEBAR_PRESETS[preset]) || preset })
                    }
                </p>

                <div className="sidebar-items-list">
                    {SIDEBAR_CATEGORIES.map(cat => {
                        const catItems = toggleableItems.filter(item => item.category === cat);
                        if (catItems.length === 0) return null;
                        return (
                            <div key={cat} className="sidebar-items-group">
                                <div className="sidebar-items-group-label">{CATEGORY_LABELS[cat]}</div>
                                {catItems.map(item => {
                                    const isVisible = !activeHidden.includes(item.id);
                                    return (
                                        <label
                                            key={item.id}
                                            className={`sidebar-item-toggle ${!isVisible ? 'hidden-item' : ''}`}
                                        >
                                            <div className="sidebar-item-toggle-info">
                                                <svg className="sidebar-item-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                                    dangerouslySetInnerHTML={{ __html: sanitizeSvgInner(item.icon) }}
                                                />
                                                <span>{item.label}</span>
                                            </div>
                                            <div className={`toggle-switch ${isVisible ? 'on' : ''}`}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    handleToggleItem(item.id);
                                                }}
                                            >
                                                <div className="toggle-knob" />
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="sidebar-settings-actions">
                <Button
                    variant="ghost"
                    onClick={handleReset}
                    disabled={preset === 'recommended' && hiddenItems.length === 0}
                >
                    <RotateCcw size={14} />
                    {t('app.sidebarSettings.resetToDefault', 'Reset to default')}
                </Button>
                <Button
                    variant="default"
                    onClick={handleSave}
                    disabled={saving || !hasChanges}
                >
                    {saving ? t('common.saving', 'Saving…') : t('app.sidebarSettings.saveChanges', 'Save changes')}
                </Button>
            </div>

            {message && (
                <div className={`settings-message ${message.type}`}>
                    {message.type === 'success' && <Check size={14} />}
                    {message.text}
                </div>
            )}
        </div>
    );
};

export default SidebarSettings;
