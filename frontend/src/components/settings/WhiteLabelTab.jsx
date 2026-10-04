import { useRef } from 'react';
import { useTheme } from '../../contexts/useTheme.js';
import { Star, X, Layers, Image, Type, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import useSettingFocus from '../../hooks/useSettingFocus';
import { useTranslation } from 'react-i18next';

const WHITELABEL_MODES = [
    { id: 'image_text', labelKey: 'app.whiteLabelTab.logoText', label: 'Logo + text', icon: Layers, desc: 'Mini logo with brand name' },
    { id: 'image_full', labelKey: 'app.whiteLabelTab.fullWidthLogo', label: 'Full-width logo', icon: Image, desc: 'Banner image only' },
    { id: 'text_only', labelKey: 'app.whiteLabelTab.textOnly', label: 'Text only', icon: Type, desc: 'Just the brand name' },
];

const WhiteLabelTab = () => {
    const { t } = useTranslation();
    const { whiteLabel, setWhiteLabel } = useTheme();
    const logoInputRef = useRef(null);
    const register = useSettingFocus();

    return (
        <div className="settings-section">
            <div className="section-header">
                <h2>{t('app.whiteLabelTab.whiteLabel', 'White label')}</h2>
            </div>

            <div {...register('whitelabel-branding', 'settings-card')}>
                <h3>{t('app.whiteLabelTab.customBranding', 'Custom branding')}</h3>
                <p>{t('app.whiteLabelTab.replaceTheSidebarLogoNameAnd', 'Replace the sidebar logo, name, and GitHub star link.')}</p>

                <div className="settings-row">
                    <div className="settings-label">
                        <Label>{t('app.whiteLabelTab.enableCustomBranding', 'Enable custom branding')}</Label>
                        <span className="settings-hint">{t('app.whiteLabelTab.replacesTheSidebarLogoNameAnd', 'Replaces the sidebar logo, name, and GitHub star link.')}</span>
                    </div>
                    <div className="settings-control">
                        <Switch
                            checked={whiteLabel.enabled}
                            onCheckedChange={(checked) => setWhiteLabel({ enabled: checked })}
                        />
                    </div>
                </div>

                {whiteLabel.enabled && (
                    <>
                        <div className="whitelabel-modes">
                            {WHITELABEL_MODES.map(({ id, label, icon: Icon, desc }) => (
                                <Button variant="unstyled" type="button"
                                    key={id}
                                    className={`whitelabel-mode${whiteLabel.mode === id ? ' active' : ''}`}
                                    onClick={() => setWhiteLabel({ mode: id })}
                                >
                                    <Icon size={20} />
                                    <span className="whitelabel-mode__label">{label}</span>
                                    <span className="whitelabel-mode__desc">{desc}</span>
                                </Button>
                            ))}
                        </div>

                        <div className="whitelabel-fields">
                            {whiteLabel.mode !== 'image_full' && (
                                <div className="form-group">
                                    <Label>{t('app.whiteLabelTab.brandName', 'Brand name')}</Label>
                                    <Input
                                        type="text"
                                        value={whiteLabel.brandName}
                                        onChange={(e) => setWhiteLabel({ brandName: e.target.value })}
                                        placeholder={t('app.whiteLabelTab.myBrand', 'My brand')}
                                        maxLength={30}
                                    />
                                </div>
                            )}

                            {whiteLabel.mode !== 'text_only' && (
                                <div className="form-group">
                                    <Label>{t('app.whiteLabelTab.logoImage', 'Logo image')}</Label>
                                    <div className="whitelabel-upload" onClick={() => logoInputRef.current?.click()}>
                                        {whiteLabel.logoData ? (
                                            <div className="whitelabel-logo-preview">
                                                <img src={whiteLabel.logoData} alt={t('app.whiteLabelTab.logoPreview', 'Logo preview')} />
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={(e) => { e.stopPropagation(); setWhiteLabel({ logoData: '' }); }}
                                                >
                                                    <X size={12} /> {t('common.actions.remove', 'Remove')}
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="whitelabel-upload__placeholder">
                                                <Upload size={20} />
                                                <span>{t('app.whiteLabelTab.clickToUploadLogo', 'Click to upload logo')}</span>
                                                <span className="whitelabel-upload__hint">{t('app.whiteLabelTab.pngJpgSvgMax200kb', 'PNG, JPG, SVG (max 200 KB)')}</span>
                                            </div>
                                        )}
                                        <input
                                            ref={logoInputRef}
                                            type="file"
                                            accept="image/png,image/jpeg,image/svg+xml,image/webp"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;
                                                if (file.size > 200 * 1024) {
                                                    alert(t('app.whiteLabelTab.imageMustBeUnder200kb', 'Image must be under 200 KB'));
                                                    return;
                                                }
                                                const reader = new FileReader();
                                                reader.onload = (ev) => setWhiteLabel({ logoData: ev.target.result });
                                                reader.readAsDataURL(file);
                                                e.target.value = '';
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="whitelabel-preview">
                            <span className="whitelabel-preview__label">{t('app.whiteLabelTab.preview', 'Preview')}</span>
                            <div className="whitelabel-preview__box">
                                {whiteLabel.mode === 'image_full' ? (
                                    <div className="brand-custom-banner">
                                        {whiteLabel.logoData ? (
                                            <img src={whiteLabel.logoData} alt={t('app.whiteLabelTab.preview', 'Preview')} />
                                        ) : (
                                            <Layers size={24} />
                                        )}
                                    </div>
                                ) : whiteLabel.mode === 'text_only' ? (
                                    <span className="brand-custom-text">
                                        {whiteLabel.brandName || 'Brand'}
                                    </span>
                                ) : (
                                    <>
                                        <div className="brand-custom-logo">
                                            {whiteLabel.logoData ? (
                                                <img src={whiteLabel.logoData} alt={t('app.whiteLabelTab.preview', 'Preview')} />
                                            ) : (
                                                <Layers size={16} />
                                            )}
                                        </div>
                                        <span className="brand-custom-text">
                                            {whiteLabel.brandName || 'Brand'}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>

                        <div className="whitelabel-star-prompt">
                            <div className="star-icon">
                                <Star size={22} />
                            </div>
                            <div className="star-content">
                                <h4>{t('app.whiteLabelTab.supportServerkit', 'Support ServerKit')}</h4>
                                <p>
                                    {t('app.whiteLabelTab.byUsingCustomBrandingTheGithub', 'By using custom branding, the GitHub star link is hidden from the sidebar. If ServerKit is useful to you, please consider starring the project. It helps the community grow.')}
                                </p>
                                <a
                                    href="https://github.com/jhd3197/ServerKit"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-primary btn-sm"
                                >
                                    <Star size={14} />
                                    {t('app.whiteLabelTab.starOnGithub', 'Star on GitHub')}
                                </a>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default WhiteLabelTab;
