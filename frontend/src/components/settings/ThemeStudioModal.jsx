import { useEffect, useMemo, useState } from 'react';
import { Download, Save, Github } from 'lucide-react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { SegControl } from '@/components/ds';
import { useTheme } from '../../contexts/useTheme.js';
import { useAuth } from '../../contexts/useAuth.js';
import { useToast } from '../../contexts/useToast.js';
import { TOKEN_GROUPS, GROUP_LABELS, TOKEN_TYPE, sanitizeTokens } from '../../data/themeTokens';
import { DEFAULT_THEME_SLUG, BUNDLED_THEME_MAP } from '../../data/bundledThemes';
import api from '../../services/api';
import { downloadBlob } from '@/utils/downloadBlob';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

const REGISTRY_REPO = 'https://github.com/jhd3197/serverkit-themes';

const slugify = (s) => String(s || '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Seed the editor from a theme's tokens for the given mode; fall back to the
// stock default so every picker starts with a real value.
function seedTokens(theme, mode) {
    const stock = BUNDLED_THEME_MAP[DEFAULT_THEME_SLUG]?.tokens?.[mode] || {};
    const from = theme?.tokens?.[mode] || {};
    return { ...stock, ...from };
}

// Theme Studio (plan 60, Phase 4) — the "SDK" for a data format is docs +
// tooling. Edit colors over the LIVE panel (every change applies instantly via
// the skin preview), start from any installed theme, then Export a valid
// theme.json, Save it into this panel, or Submit it to the registry.
const ThemeStudioModal = ({ open, onOpenChange }) => {
    const { t } = useTranslation();
    const { availableThemes, previewSkin, clearPreview, refreshInstalledThemes, setSkin } = useTheme();
    const { user } = useAuth();
    const toast = useToast();
    const isAdmin = user?.role === 'admin';

    const [name, setName] = useState('My Theme');
    const [slug, setSlug] = useState('my-theme');
    const [slugTouched, setSlugTouched] = useState(false);
    const [base, setBase] = useState('dark');
    const [editMode, setEditMode] = useState('dark');
    const [accent, setAccent] = useState('#6d7cff');
    const [darkTokens, setDarkTokens] = useState(() => seedTokens(null, 'dark'));
    const [lightTokens, setLightTokens] = useState(() => seedTokens(null, 'light'));
    const [saving, setSaving] = useState(false);

    const activeTokens = editMode === 'light' ? lightTokens : darkTokens;
    const setActiveTokens = editMode === 'light' ? setLightTokens : setDarkTokens;

    // Build the in-progress theme object (used for live preview + export).
    const workingTheme = useMemo(() => ({
        schema_version: 1,
        slug: slug || 'my-theme',
        name: name || 'My Theme',
        author: user?.username || '',
        version: '1.0.0',
        base,
        tokens: { dark: sanitizeTokens(darkTokens), light: sanitizeTokens(lightTokens) },
        accent,
        preview: [
            activeTokens['--bg-body'] || '#101218',
            activeTokens['--surface'] || '#161922',
            accent || '#6d7cff',
            activeTokens['--text'] || '#e9ebf0',
        ],
    }), [slug, name, base, darkTokens, lightTokens, accent, activeTokens, user]);

    // Live-apply the in-progress theme while the studio is open.
    useEffect(() => {
        if (open) previewSkin(workingTheme);
        return () => { if (open) clearPreview(); };
    }, [open, workingTheme, previewSkin, clearPreview]);

    const startFrom = (fromSlug) => {
        const theme = availableThemes.find((t) => t.slug === fromSlug);
        if (!theme) return;
        setDarkTokens(seedTokens(theme, 'dark'));
        setLightTokens(seedTokens(theme, 'light'));
        if (theme.base) setBase(theme.base);
        if (theme.accent) setAccent(theme.accent);
    };

    const onNameChange = (v) => {
        setName(v);
        if (!slugTouched) setSlug(slugify(v));
    };

    const setToken = (token, value) => setActiveTokens((prev) => ({ ...prev, [token]: value }));

    const download = () => {
        downloadBlob(JSON.stringify(workingTheme, null, 2), `${workingTheme.slug || 'theme'}.json`, { type: 'application/json' });
        toast.success(t('app.themeStudioModal.themeJsonDownloaded', 'theme.json downloaded'));
    };

    const saveToPanel = async () => {
        if (workingTheme.slug === DEFAULT_THEME_SLUG) {
            toast.error(t('app.themeStudioModal.defaultIsReservedChooseAnotherSlug', "'default' is reserved. Choose another slug"));
            return;
        }
        setSaving(true);
        try {
            const saved = await api.importTheme(workingTheme, { source: 'studio' });
            await refreshInstalledThemes();
            if (saved?.slug) setSkin(saved.slug);
            toast.success(t('app.themeStudioModal.savedToThisPanel', 'Saved "{{value}}" to this panel', { value: saved?.name }));
            onOpenChange(false);
        } catch (e) {
            toastError(toast, t('app.themeStudioModal.couldNotSaveTheTheme', "Couldn't save the theme."), e);
        } finally {
            setSaving(false);
        }
    };

    const submitToRegistry = () => {
        const filename = `themes/${workingTheme.slug || 'my-theme'}/theme.json`;
        const value = encodeURIComponent(JSON.stringify(workingTheme, null, 2));
        // GitHub "create new file" deep-link, prefilled with the theme.
        const url = `${REGISTRY_REPO}/new/main?filename=${encodeURIComponent(filename)}&value=${value}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="theme-studio">
                <DialogHeader>
                    <DialogTitle>{t('app.themeStudioModal.themeStudio', 'Theme studio')}</DialogTitle>
                    <DialogDescription>
                        {t('app.themeStudioModal.editColorsOverTheLivePanel', 'Edit colors over the live panel. Export a shareable theme.json, save it here, or submit it to the registry.')}
                    </DialogDescription>
                </DialogHeader>

                <div className="theme-studio__top">
                    <label className="theme-studio__field">
                        <span>{t('common.labels.name', 'Name')}</span>
                        <input value={name} onChange={(e) => onNameChange(e.target.value)} />
                    </label>
                    <label className="theme-studio__field">
                        <span>{t('app.themeStudioModal.slug', 'Slug')}</span>
                        <input
                            value={slug}
                            onChange={(e) => { setSlug(slugify(e.target.value)); setSlugTouched(true); }}
                        />
                    </label>
                    <div className="theme-studio__field">
                        <span id="theme-studio-base">{t('app.themeStudioModal.base', 'Base')}</span>
                        <SegControl
                            aria-labelledby="theme-studio-base"
                            value={base}
                            onChange={setBase}
                            options={['dark', 'light']}
                        />
                    </div>
                    <div className="theme-studio__field">
                        <span id="theme-studio-start">{t('app.themeStudioModal.startFrom', 'Start from')}</span>
                        {/* An action, not a setting: the value resets so the same theme can be picked again. */}
                        <Select value="" onValueChange={startFrom}>
                            <SelectTrigger aria-labelledby="theme-studio-start">
                                <SelectValue placeholder={t('app.themeStudioModal.choose', 'Choose…')} />
                            </SelectTrigger>
                            <SelectContent>
                                {availableThemes.map((theme) => (
                                    <SelectItem key={theme.slug} value={theme.slug}>{theme.name || theme.slug}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="theme-studio__modebar">
                    <div className="theme-studio__accent">
                        <span>{t('app.themeStudioModal.accent', 'Accent')}</span>
                        <input type="color" value={accent} onChange={(e) => setAccent(e.target.value)} />
                    </div>
                    <div className="theme-studio__modes">
                        <Button variant="unstyled"
                            type="button"
                            className={editMode === 'dark' ? 'active' : ''}
                            onClick={() => setEditMode('dark')}
                        >{t('app.themeStudioModal.darkTokens', 'Dark tokens')}</Button>
                        <Button variant="unstyled"
                            type="button"
                            className={editMode === 'light' ? 'active' : ''}
                            onClick={() => setEditMode('light')}
                        >{t('app.themeStudioModal.lightTokens', 'Light tokens')}</Button>
                    </div>
                </div>

                <div className="theme-studio__groups">
                    {Object.entries(TOKEN_GROUPS).map(([group, tokens]) => (
                        <div key={group} className="theme-studio__group">
                            <h4>{GROUP_LABELS[group]}</h4>
                            <div className="theme-studio__tokens">
                                {tokens.map((token) => {
                                    const isColor = TOKEN_TYPE[token] === 'color';
                                    const value = activeTokens[token] ?? '';
                                    return (
                                        <div key={token} className="theme-studio__token">
                                            <label>{token}</label>
                                            <div className="theme-studio__token-input">
                                                {isColor && /^#([0-9a-fA-F]{6})$/.test(value) && (
                                                    <input
                                                        type="color"
                                                        value={value}
                                                        onChange={(e) => setToken(token, e.target.value)}
                                                    />
                                                )}
                                                <input
                                                    type="text"
                                                    value={value}
                                                    placeholder="unset"
                                                    onChange={(e) => setToken(token, e.target.value)}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                <div className="theme-studio__footer">
                    <Button variant="outline" size="sm" onClick={download}>
                        <Download size={14} /> {t('app.themeStudioModal.exportThemeJson', 'Export theme.json')}
                    </Button>
                    <Button variant="outline" size="sm" onClick={submitToRegistry}>
                        <Github size={14} /> {t('app.themeStudioModal.submitToRegistry', 'Submit to registry')}
                    </Button>
                    {isAdmin && (
                        <Button size="sm" onClick={saveToPanel} disabled={saving}>
                            <Save size={14} /> {saving ? t('common.saving', 'Saving…') : t('app.themeStudioModal.saveToThisPanel', 'Save to this panel')}
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default ThemeStudioModal;
