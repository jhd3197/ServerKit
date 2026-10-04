import { useState } from 'react';
import { Check, Star, Trash2 } from 'lucide-react';
import { useTheme } from '../../contexts/useTheme.js';
import { useAuth } from '../../contexts/useAuth.js';
import { useToast } from '../../contexts/useToast.js';
import { DEFAULT_THEME_SLUG } from '../../data/bundledThemes';
import api from '../../services/api';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';
import { toastError } from '@/utils/errorMessage';

// Theme Gallery — cards for every selectable skin (bundled seeds + installed).
// Apply is instant (tokens are already local); hovering previews live and
// leaving restores the selected skin. Admins can additionally set the panel
// default (what login/setup and new users get) and remove installed themes.
const ThemeGallery = () => {
    const { t } = useTranslation();
    const {
        availableThemes, skin, setSkin, previewSkin, clearPreview,
        panelDefaultSlug, refreshInstalledThemes, refreshPanelDefault,
    } = useTheme();
    const { user } = useAuth();
    const toast = useToast();
    const isAdmin = user?.role === 'admin';
    const [busy, setBusy] = useState(null);

    const setDefault = async (slug) => {
        setBusy(slug);
        try {
            await api.setDefaultTheme(slug);
            await refreshPanelDefault();
            toast.success(t('app.themeGallery.panelDefaultThemeUpdated', 'Panel default theme updated'));
        } catch (e) {
            toastError(toast, t('app.themeGallery.couldNotSetTheDefaultTheme', "Couldn't set the default theme."), e);
        } finally {
            setBusy(null);
        }
    };

    const removeTheme = async (slug) => {
        setBusy(slug);
        try {
            await api.deleteTheme(slug);
            await Promise.all([refreshInstalledThemes(), refreshPanelDefault()]);
            toast.success(t('app.themeGallery.themeRemoved', 'Theme removed'));
        } catch (e) {
            toastError(toast, t('app.themeGallery.couldNotRemoveTheTheme', "Couldn't remove the theme."), e);
        } finally {
            setBusy(null);
        }
    };

    const select = (slug) => setSkin(slug);

    return (
        <div className="theme-gallery">
            {availableThemes.map((themeEntry) => {
                const isDefault = themeEntry.slug === DEFAULT_THEME_SLUG;
                const active = skin === themeEntry.slug;
                const isPanelDefault = themeEntry.slug === panelDefaultSlug;
                const removable = themeEntry.installed && !themeEntry.builtin && !isDefault;
                const swatches = Array.isArray(themeEntry.preview) ? themeEntry.preview.slice(0, 4) : [];
                return (
                    <div
                        key={themeEntry.slug}
                        role="button"
                        tabIndex={0}
                        className={`theme-card${active ? ' theme-card--active' : ''}`}
                        onClick={() => select(themeEntry.slug)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(themeEntry.slug); }
                        }}
                        onMouseEnter={() => previewSkin(isDefault ? null : themeEntry)}
                        onMouseLeave={clearPreview}
                        onFocus={() => previewSkin(isDefault ? null : themeEntry)}
                        onBlur={clearPreview}
                    >
                        <div className="theme-card__swatches">
                            {swatches.map((color, i) => (
                                <span
                                    key={i}
                                    className="theme-card__swatch"
                                    style={{ background: color }}
                                />
                            ))}
                        </div>
                        <div className="theme-card__meta">
                            <span className="theme-card__name">{themeEntry.name || themeEntry.slug}</span>
                            {themeEntry.base && <span className="theme-card__base">{themeEntry.base}</span>}
                        </div>
                        {themeEntry.description && (
                            <p className="theme-card__desc">{themeEntry.description}</p>
                        )}
                        <div className="theme-card__footer">
                            {active && (
                                <span className="theme-card__applied">
                                    <Check size={13} /> {t('app.themeGallery.applied', 'Applied')}
                                </span>
                            )}
                            {isPanelDefault && (
                                <span className="theme-card__default" title={t('app.themeGallery.defaultForTheWholePanel', 'Default for the whole panel')}>
                                    <Star size={12} /> {t('app.themeGallery.panelDefault', 'Panel default')}
                                </span>
                            )}
                        </div>
                        {isAdmin && (
                            <div className="theme-card__admin">
                                {!isPanelDefault && (
                                    <SharedButton variant="unstyled"
                                        type="button"
                                        className="theme-card__admin-btn"
                                        disabled={busy === themeEntry.slug}
                                        onClick={(e) => { e.stopPropagation(); setDefault(themeEntry.slug); }}
                                    >
                                        <Star size={12} /> {t('app.themeGallery.setDefault', 'Set default')}
                                    </SharedButton>
                                )}
                                {removable && (
                                    <SharedButton variant="unstyled"
                                        type="button"
                                        className="theme-card__admin-btn theme-card__admin-btn--danger"
                                        disabled={busy === themeEntry.slug}
                                        onClick={(e) => { e.stopPropagation(); removeTheme(themeEntry.slug); }}
                                    >
                                        <Trash2 size={12} /> {t('common.actions.remove', 'Remove')}
                                    </SharedButton>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export default ThemeGallery;
