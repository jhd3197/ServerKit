import { CheckCircle2, DownloadCloud, ArrowUpCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { CatalogCard } from '@/components/ds';
import { ExtensionCover } from './ExtensionCover';
import { titleCase } from './extensionCatalog';

// Trust as a plain-text fact on the card: only the two states that carry
// information (a hash-bound review, or a registry entry nobody reviewed).
// Built-in entries never carry a trust field, so they show nothing.
const TrustFact = ({ entry }) => {
    const { t } = useTranslation();
    if (entry.trust === 'reviewed') {
        const review = entry.review || {};
        const title = review.reviewer && review.date
            ? `Reviewed by ${review.reviewer} on ${review.date}`
            : 'Reviewed by the ServerKit maintainers';
        return <span title={title}>{t('app.marketplace.reviewed', 'Reviewed')}</span>;
    }
    if (entry.trust === 'unreviewed' && entry.source === 'registry') {
        return <span>{t('app.marketplace.unreviewed', 'Unreviewed')}</span>;
    }
    return null;
};

export const CatalogExtensionCard = ({ entry, update, busy, installing, onInstall, onUpdate, onOpenDetail }) => {
    const { t } = useTranslation();
    const category = entry.category || 'utility';
    const isLocal = entry.source === 'local';
    const installedLabel = entry.status && entry.status !== 'active'
        ? titleCase(entry.status)
        : t('app.marketplace.installed', 'Installed');
    const hasTrustFact = entry.trust === 'reviewed'
        || (entry.trust === 'unreviewed' && entry.source === 'registry');
    const canUpdate = Boolean(update?.update_available && update.compatible !== false);

    let action;
    if (!entry.installed) {
        action = (
            <Button variant="outline" size="sm" disabled={installing} onClick={() => onInstall(entry.installKey)}>
                <DownloadCloud aria-hidden="true" />
                {installing
                    ? t('app.marketplace.installing', 'Installing…')
                    : t('app.marketplace.install', 'Install')}
            </Button>
        );
    } else if (canUpdate) {
        action = (
            <Button size="sm" disabled={busy} onClick={() => onUpdate(update)}>
                <ArrowUpCircle aria-hidden="true" />
                {busy ? t('app.marketplace.updating', 'Updating…') : t('app.marketplace.updateTo', 'Update v{{version}}', { version: update.available_version })}
            </Button>
        );
    } else {
        action = (
            <span className="marketplace-installed-label">
                <CheckCircle2 aria-hidden="true" />
                {installedLabel}
            </span>
        );
    }

    return (
        <CatalogCard
            className="sk-catalog-card--inline-action"
            icon={<ExtensionCover base="sk-catalog-card__art" entry={entry} category={category} brandSize={20} />}
            title={entry.displayName}
            sub={t('app.marketplace.versionByAuthor', 'v{{version}} · by {{author}}', {
                version: entry.version,
                author: entry.author || 'ServerKit',
            })}
            tag={titleCase(category)}
            featured={entry.featured}
            description={entry.description}
            facts={(isLocal || hasTrustFact) && (
                <>
                    {isLocal && t('app.marketplace.builtIn', 'Built-in')}
                    {isLocal && hasTrustFact && ' · '}
                    <TrustFact entry={entry} />
                </>
            )}
            onClick={() => onOpenDetail(entry)}
            action={action}
        />
    );
};

export default CatalogExtensionCard;
