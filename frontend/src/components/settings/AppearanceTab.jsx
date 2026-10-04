import { useRef, useState } from 'react';
import { useTheme } from '../../contexts/useTheme.js';
import { useAuth } from '../../contexts/useAuth.js';
import { useToast } from '../../contexts/useToast.js';
import { Link } from 'react-router-dom';
import { RotateCcw, Upload, Store, Sparkles, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';

import useSettingFocus from '../../hooks/useSettingFocus';
import LanguageSelector from './LanguageSelector';
import ThemeGallery from './ThemeGallery';
import ThemeBrowseModal from './ThemeBrowseModal';
import ThemeStudioModal from './ThemeStudioModal';
import api from '../../services/api';
import { useTranslation } from 'react-i18next';

const ACCENT_PRESETS = [
    { labelKey: 'app.appearanceTab.indigo', label: 'Indigo', color: '#6366f1' },
    { labelKey: 'app.appearanceTab.ocean', label: 'Ocean', color: '#0ea5e9' },
    { labelKey: 'app.appearanceTab.forest', label: 'Forest', color: '#10b981' },
    { labelKey: 'app.appearanceTab.sunset', label: 'Sunset', color: '#f97316' },
    { labelKey: 'app.appearanceTab.rose', label: 'Rose', color: '#f43f5e' },
    { labelKey: 'app.appearanceTab.violet', label: 'Violet', color: '#8b5cf6' },
    { labelKey: 'app.appearanceTab.amber', label: 'Amber', color: '#f59e0b' },
    { labelKey: 'app.appearanceTab.cyan', label: 'Cyan', color: '#06b6d4' },
];

const AppearanceTab = () => {
    const { t } = useTranslation();
    const {
        theme, setTheme, accentColor, setAccentColor, hasCustomAccent, resetAccentColor,
        refreshInstalledThemes, setSkin,
    } = useTheme();
    const { user } = useAuth();
    const toast = useToast();
    const register = useSettingFocus();
    const fileInputRef = useRef(null);
    const [browseOpen, setBrowseOpen] = useState(false);
    const [studioOpen, setStudioOpen] = useState(false);
    const isAdmin = user?.role === 'admin';

    const onImportFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';               // allow re-selecting the same file
        if (!file) return;
        try {
            const imported = await api.importThemeFile(file);
            await refreshInstalledThemes();
            if (imported?.slug) setSkin(imported.slug);
            toast.success(t('app.appearanceTab.importedTheme', 'Imported theme "{{value}}"', { value: imported?.name || imported?.slug }));
        } catch (err) {
            toast.error(err?.message || t('app.appearanceTab.couldNotImportThatThemeJson', 'Could not import that theme.json'));
        }
    };

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>{t('app.appearanceTab.appearance', 'Appearance')}</h2>
            </div>

            <LanguageSelector />

            <div {...register('appearance-theme', 'settings-card')}>
                <h3>{t('app.appearanceTab.theme', 'Theme')}</h3>
                <p>{t('app.appearanceTab.selectYourPreferredColorScheme', 'Select your preferred color scheme')}</p>
                <div className="theme-options">
                    <Button variant="unstyled" type="button"
                        className={`theme-option ${theme === 'dark' ? 'active' : ''}`}
                        onClick={() => setTheme('dark')}
                    >
                        <div className="theme-preview dark">
                            <div className="preview-sidebar"></div>
                            <div className="preview-content">
                                <div className="preview-card"></div>
                                <div className="preview-card"></div>
                            </div>
                        </div>
                        <span>{t('app.appearanceTab.dark', 'Dark')}</span>
                    </Button>
                    <Button variant="unstyled" type="button"
                        className={`theme-option ${theme === 'light' ? 'active' : ''}`}
                        onClick={() => setTheme('light')}
                    >
                        <div className="theme-preview light">
                            <div className="preview-sidebar"></div>
                            <div className="preview-content">
                                <div className="preview-card"></div>
                                <div className="preview-card"></div>
                            </div>
                        </div>
                        <span>{t('app.appearanceTab.light', 'Light')}</span>
                    </Button>
                    <Button variant="unstyled" type="button"
                        className={`theme-option ${theme === 'system' ? 'active' : ''}`}
                        onClick={() => setTheme('system')}
                    >
                        <div className="theme-preview system">
                            <div className="preview-sidebar"></div>
                            <div className="preview-content">
                                <div className="preview-card"></div>
                                <div className="preview-card"></div>
                            </div>
                        </div>
                        <span>{t('common.labels.system', 'System')}</span>
                    </Button>
                </div>
            </div>

            <div {...register('appearance-theme-gallery', 'settings-card')}>
                <div className="theme-gallery-header">
                    <div>
                        <h3>{t('app.appearanceTab.theme', 'Theme')}</h3>
                        <p>{t('app.appearanceTab.pickAColorThemeAppliesInstantly', 'Pick a color theme. Applies instantly and stays your personal choice; the dark/light toggle above still works on top of it.')}</p>
                    </div>
                    <div className="theme-gallery-actions">
                        <Button variant="outline" size="sm" onClick={() => setStudioOpen(true)}>
                            <Sparkles size={14} />
                            {t('app.appearanceTab.createTheme', 'Create theme')}
                        </Button>
                        {isAdmin && (
                            <>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="application/json,.json"
                                    className="hidden"
                                    onChange={onImportFile}
                                />
                                <Button variant="outline" size="sm" onClick={() => setBrowseOpen(true)}>
                                    <Store size={14} />
                                    {t('app.appearanceTab.browseThemes', 'Browse themes')}
                                </Button>
                                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                                    <Upload size={14} />
                                    {t('app.appearanceTab.importThemeJson', 'Import theme.json')}
                                </Button>
                            </>
                        )}
                    </div>
                </div>
                <ThemeGallery />
                <ThemeBrowseModal open={browseOpen} onOpenChange={setBrowseOpen} />
                <ThemeStudioModal open={studioOpen} onOpenChange={setStudioOpen} />
            </div>

            <div {...register('appearance-accent-color', 'settings-card')}>
                <h3>{t('app.appearanceTab.accentColor', 'Accent Color')}</h3>
                <p>{t('app.appearanceTab.chooseThePrimaryAccentColorUsed', 'Choose the primary accent color used across the interface')}</p>
                <div className="accent-presets">
                    {ACCENT_PRESETS.map(({ label, color }) => (
                        <Button variant="unstyled" type="button"
                            key={color}
                            className={`accent-preset${accentColor === color ? ' active' : ''}`}
                            onClick={() => setAccentColor(color)}
                        >
                            <span className="accent-swatch" style={{ background: color }} />
                            <span className="accent-label">{label}</span>
                        </Button>
                    ))}
                </div>
                <div className="accent-custom">
                    <label className="accent-custom-label">{t('app.appearanceTab.customColor', 'Custom color')}</label>
                    <div className="accent-custom-row">
                        <input
                            type="color"
                            className="accent-custom-input"
                            value={accentColor}
                            onChange={(e) => setAccentColor(e.target.value)}
                        />
                        <span className="accent-custom-hex">{accentColor.toUpperCase()}</span>
                        {hasCustomAccent && (
                            <Button variant="unstyled"
                                type="button"
                                className="accent-custom-reset"
                                onClick={resetAccentColor}
                                title={t('app.appearanceTab.useTheThemeSAccent', 'Use the theme\'s accent')}
                            >
                                <RotateCcw size={13} /> {t('app.appearanceTab.useThemeAccent', 'Use theme accent')}
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            <div {...register('appearance-widgets', 'settings-card')}>
                <h3>{t('app.appearanceTab.dashboardWidgets', 'Dashboard Widgets')}</h3>
                <p>
                    {t('app.appearanceTab.widgetsAreArrangedOnTheDashboard', 'Widgets are arranged on the dashboard itself now — add, move, resize and configure them in place, across as many boards as you need.')}
                </p>
                <Button variant="outline" size="sm" asChild>
                    <Link to="/">
                        <LayoutGrid size={14} />
                        {t('app.appearanceTab.editDashboards', 'Edit dashboards')}
                    </Link>
                </Button>
            </div>

        </div>
    );
};

export default AppearanceTab;
