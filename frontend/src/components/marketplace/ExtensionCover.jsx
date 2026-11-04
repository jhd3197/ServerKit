import { useState } from 'react';
import { sanitizeSvgInner } from '../../utils/sanitizeSvg';
import { ExtensionBrandMark } from '../icons/ExtensionBrands';
import { hasBrandMark, extensionCoverStyle } from '../icons/extensionBrandData';
import { resolveExtensionIcon } from '../icons/ExtensionIcons';
import { getCategoryIcon } from './extensionCatalog';

// Cover banner + artwork with a deterministic fallback chain:
// registry logo image -> bundled illustrated icon -> Simple Icons brand mark ->
// manifest icon SVG -> category lucide glyph. Image artwork (logo or bundled
// icon) sits on a clean light tile at one shared size; the white brand-mark /
// glyph fallbacks keep the deterministic gradient so they stay legible. The
// tile is chosen from what actually renders, so a registry logo that fails to
// load falls back to the gradient instead of a white glyph on white. `base` is
// the cover class ('sk-catalog-card__art' for the compact catalog-card icon,
// 'extension-detail__cover' for the modal banner); both share this component.
export const ExtensionCover = ({ base, entry, category, brandSize = 34, children }) => {
    const [logoFailed, setLogoFailed] = useState(false);
    const rasterIcon = resolveExtensionIcon(entry.installKey, category);
    const imageSrc = entry.logo && !logoFailed ? entry.logo : rasterIcon;

    if (imageSrc) {
        return (
            <div className={`${base} ${base}--icon`}>
                <img
                    src={imageSrc}
                    loading="lazy"
                    alt=""
                    aria-hidden="true"
                    className="extension-card__icon"
                    onError={imageSrc === entry.logo ? () => setLogoFailed(true) : undefined}
                />
                {children}
            </div>
        );
    }
    return (
        <div className={base} style={extensionCoverStyle(entry.installKey, category)}>
            <ExtensionGlyph entry={entry} category={category} brandSize={brandSize} />
            {children}
        </div>
    );
};

const ExtensionGlyph = ({ entry, category, brandSize }) => {
    const Icon = getCategoryIcon(category);
    const iconSvg = entry.icon ? sanitizeSvgInner(entry.icon) : '';

    if (hasBrandMark(entry.installKey)) {
        return (
            <ExtensionBrandMark
                slug={entry.installKey}
                size={brandSize}
                className="extension-card__brand"
            />
        );
    }
    if (iconSvg) {
        return (
            <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
                focusable="false"
                className="extension-card__glyph"
                /* sink-safe: iconSvg = sanitizeSvgInner(entry.icon) above */
                dangerouslySetInnerHTML={{ __html: iconSvg }}
            />
        );
    }
    return <Icon aria-hidden="true" className="extension-card__glyph" />;
};


export default ExtensionCover;
