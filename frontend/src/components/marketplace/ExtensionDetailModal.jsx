import { CheckCircle2, DownloadCloud, ExternalLink, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import SignatureBadge from '@/components/marketplace/SignatureBadge';
import { ExtensionCover } from './ExtensionCover';
import { sourceBadgeVariant, titleCase } from './extensionCatalog';

// Trust badge derived from the registry's hash-bound review stamp. 'reviewed'
// shows who/when in the tooltip; 'unreviewed' warns on registry entries
// (built-in entries never carry a trust field).
const TrustBadge = ({ entry }) => {
    const { t } = useTranslation();
    if (entry.trust === 'reviewed') {
        const review = entry.review || {};
        const title = review.reviewer && review.date
            ? `Reviewed by ${review.reviewer} on ${review.date}`
            : 'Reviewed by the ServerKit maintainers';
        return (
            <Badge variant="success" title={title}>
                <ShieldCheck aria-hidden="true" /> {t('app.marketplace.reviewed', 'Reviewed')}
            </Badge>
        );
    }
    if (entry.trust === 'unreviewed' && entry.source === 'registry') {
        return <Badge variant="warning">{t('app.marketplace.unreviewed', 'Unreviewed')}</Badge>;
    }
    return null;
};


export const ExtensionDetailModal = ({ entry, installing, statusVariant, onClose, onInstall }) => {
    const { t } = useTranslation();
    const category = entry.category || 'utility';
    const isLocal = entry.source === 'local';
    const screenshots = entry.screenshots || [];
    const permissions = Array.isArray(entry.permissions) ? entry.permissions : [];
    const configKeys = entry.configSchema && typeof entry.configSchema === 'object'
        ? Object.keys(entry.configSchema)
        : [];
    const installedLabel = entry.status && entry.status !== 'active'
        ? titleCase(entry.status)
        : 'Installed';

    return (
        <Modal open onClose={onClose} title={entry.displayName} size="lg">
            <div className="extension-detail">
                <ExtensionCover base="extension-detail__cover" entry={entry} category={category} brandSize={46} />
                <div className="extension-detail__header">
                    <div className="extension-detail__heading">
                        <div className="extension-detail__badges">
                            {entry.firstParty && (
                                <Badge variant="secondary" className="extension-firstparty">{t('app.marketplace.byServerkit2', 'by ServerKit')}</Badge>
                            )}
                            <TrustBadge entry={entry} />
                            {entry.source === 'registry' && (
                                <SignatureBadge signature={{
                                    status: entry.signed ? (entry.publisherTrusted ? 'verified' : 'untrusted_key') : 'unsigned',
                                    key_id: entry.publisherKeyId,
                                }} />
                            )}
                            <Badge variant={sourceBadgeVariant(entry.source)}>{entry.sourceLabel}</Badge>
                            <Badge variant="outline">{titleCase(category)}</Badge>
                        </div>
                        <div className="extension-detail__meta">
                            <span>v{entry.version}</span>
                            {entry.author && <span>by {entry.author}</span>}
                            <span>{isLocal ? 'built-in' : entry.extensionType}</span>
                            {entry.repo && (
                                <a
                                    href={entry.repo}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="extension-detail__repo-link"
                                >
                                    <ExternalLink aria-hidden="true" />
                                    {t('app.marketplace.sourceRepo', 'Source repo')}
                                </a>
                            )}
                        </div>
                    </div>
                </div>

                <p className="extension-detail__desc">{entry.description}</p>

                {permissions.length > 0 && (
                    <div className="extension-detail__consent">
                        <p className="extension-detail__section-label">{t('app.marketplace.thisExtensionRequests', 'This extension requests:')}</p>
                        <div className="extension-detail__chips">
                            {permissions.map((permission) => (
                                <Badge key={permission} variant="outline">{permission}</Badge>
                            ))}
                        </div>
                    </div>
                )}

                {configKeys.length > 0 && (
                    <div className="extension-detail__config">
                        <p className="extension-detail__section-label">{t('app.marketplace.configuration', 'Settings')}</p>
                        <ul className="extension-detail__config-list">
                            {configKeys.map((key) => (
                                <li key={key}><code>{key}</code></li>
                            ))}
                        </ul>
                    </div>
                )}

                {screenshots.length > 0 && (
                    <div className="extension-detail__gallery" aria-label={t('app.marketplace.screenshots', 'Screenshots')}>
                        {screenshots.map((src, index) => (
                            <img
                                key={src}
                                src={src}
                                alt={`${entry.displayName} screenshot ${index + 1}`}
                                className="extension-detail__shot"
                                loading="lazy"
                            />
                        ))}
                    </div>
                )}

                <div className="extension-detail__actions">
                    {entry.installed ? (
                        <Badge variant={isLocal ? statusVariant(entry.status) : 'success'}>
                            <CheckCircle2 aria-hidden="true" />
                            {installedLabel}
                        </Badge>
                    ) : (
                        <Button disabled={installing} onClick={onInstall}>
                            <DownloadCloud aria-hidden="true" />
                            {installing ? t('app.marketplace.installing', 'Installing…') : t('app.marketplace.install', 'Install')}
                        </Button>
                    )}
                </div>
            </div>
        </Modal>
    );
};


export default ExtensionDetailModal;
