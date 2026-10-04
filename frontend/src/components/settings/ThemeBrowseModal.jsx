import { useEffect, useState } from 'react';
import { Check, Download, Loader2 } from 'lucide-react';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { useTheme } from '../../contexts/useTheme.js';
import { useToast } from '../../contexts/useToast.js';
import api from '../../services/api';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';
import { toastError } from '@/utils/errorMessage';

// Browse & install community themes from the registry (plan 60, Phase 3).
// Offline-tolerant: if the registry is unreachable the panel falls back to the
// bundled index, so this never hard-fails — it just shows fewer (or no) cards.
const ThemeBrowseModal = ({ open, onOpenChange }) => {
    const { t } = useTranslation();
    const { refreshInstalledThemes } = useTheme();
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const [themes, setThemes] = useState([]);
    const [source, setSource] = useState(null);
    const [installing, setInstalling] = useState(null);

    const load = async () => {
        setLoading(true);
        try {
            const data = await api.getThemeRegistry();
            setThemes(Array.isArray(data?.themes) ? data.themes : []);
            setSource(data?.source || null);
        } catch (e) {
            toastError(toast, t('app.themeBrowseModal.couldNotLoadTheThemeRegistry', 'Could not load the theme registry'), e);
            setThemes([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (open) load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const install = async (slug) => {
        setInstalling(slug);
        try {
            await api.installRegistryTheme(slug);
            await refreshInstalledThemes();
            setThemes((prev) => prev.map((themeEntry) => (
                themeEntry.slug === slug ? { ...themeEntry, installed: true } : themeEntry
            )));
            toast.success(t('app.themeBrowseModal.themeInstalledFindItInThe', 'Theme installed. Find it in the gallery.'));
        } catch (e) {
            toastError(toast, t('app.themeBrowseModal.couldNotInstallThatTheme', 'Could not install that theme'), e);
        } finally {
            setInstalling(null);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="theme-browse-modal">
                <DialogHeader>
                    <DialogTitle>{t('app.themeBrowseModal.browseThemes', 'Browse themes')}</DialogTitle>
                    <DialogDescription>
                        {t('app.themeBrowseModal.communityThemesFromTheRegistryInstalling', 'Community themes from the registry. Installing one adds it to your gallery.')}
                    </DialogDescription>
                </DialogHeader>

                {loading ? (
                    <div className="theme-browse__state">
                        <Loader2 className="spin" size={18} /> {t('app.themeBrowseModal.loadingRegistry', 'Loading registry…')}
                    </div>
                ) : themes.length === 0 ? (
                    <div className="theme-browse__state">
                        {t('app.themeBrowseModal.noCommunityThemesAvailableRightNow', 'No community themes available right now.')}
                        {source === 'bundled' && ' (registry offline — showing bundled only)'}
                    </div>
                ) : (
                    <div className="theme-browse__grid">
                        {themes.map((themeEntry) => {
                            const swatches = Array.isArray(themeEntry.preview) ? themeEntry.preview.slice(0, 4) : [];
                            return (
                                <div key={themeEntry.slug} className="theme-browse__card">
                                    <div className="theme-browse__swatches">
                                        {swatches.map((c, i) => (
                                            <span key={i} style={{ background: c }} />
                                        ))}
                                    </div>
                                    <div className="theme-browse__meta">
                                        <span className="theme-browse__name">{themeEntry.name || themeEntry.slug}</span>
                                        {themeEntry.author && <span className="theme-browse__author">by {themeEntry.author}</span>}
                                    </div>
                                    {themeEntry.description && <p className="theme-browse__desc">{themeEntry.description}</p>}
                                    {themeEntry.installed ? (
                                        <span className="theme-browse__installed"><Check size={13} /> {t('app.themeBrowseModal.installed', 'Installed')}</span>
                                    ) : (
                                        <SharedButton variant="unstyled"
                                            type="button"
                                            className="theme-browse__install"
                                            disabled={installing === themeEntry.slug}
                                            onClick={() => install(themeEntry.slug)}
                                        >
                                            {installing === themeEntry.slug
                                                ? <Loader2 className="spin" size={13} />
                                                : <Download size={13} />}
                                            {t('app.themeBrowseModal.install', 'Install')}
                                        </SharedButton>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
};

export default ThemeBrowseModal;
