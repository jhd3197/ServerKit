import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ds';
import { useToast } from '@/contexts/useToast.js';
import { toastError } from '@/utils/errorMessage';

// Sites host nginx is serving that no service accounts for. Each row shows
// what discovery found; adopting records the site as it is. Nothing on the
// server is rewritten, which the dialog says in so many words because that is
// the question anyone with a live site asks first.
export default function AdoptSitesDialog({ open, onClose, sites, onAdopted }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [adopting, setAdopting] = useState(null);

    const kindLabel = (site) => ({
        wordpress: t('app.services.adopt.kindWordpress', 'WordPress'),
        php: t('app.services.adopt.kindPhp', 'PHP'),
        static: t('app.services.adopt.kindStatic', 'Static'),
    }[site.app_type] || (site.kind === 'proxy'
        ? t('app.services.adopt.kindProxy', 'Proxied app')
        : t('app.services.adopt.kindRedirect', 'Redirect')));

    async function handleAdopt(site) {
        setAdopting(site.id);
        try {
            const result = await api.adoptHostSite(site.id, { apply: true });
            toast.success(t('app.services.adopt.adopted', {
                name: result?.app?.name || site.primary_domain,
                defaultValue: '{{name}} is now managed. Nothing on the server was changed.',
            }));
            await onAdopted?.(result?.app);
        } catch (err) {
            toastError(toast, t('app.services.adopt.failed', "Couldn't adopt this site."), err);
        } finally {
            setAdopting(null);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            size="lg"
            title={t('app.services.adopt.title', 'Adopt existing sites')}
            footer={(
                <Button type="button" variant="outline" onClick={onClose}>
                    {t('common.actions.close', 'Close')}
                </Button>
            )}
        >
            <p className="sk-modal__subtitle">
                {t('app.services.adopt.intro', 'These sites are served by this server but are not managed here yet, so they have no monitoring, backups or SSL status. Adopting one records it as it is: the nginx config, PHP-FPM pool, database and certificate are left exactly as they are.')}
            </p>

            <ul className="adopt-sites">
                {sites.map((site) => (
                    <li key={site.id} className="adopt-sites__row">
                        <div className="adopt-sites__main">
                            <div className="adopt-sites__head">
                                <span className="adopt-sites__domain">{site.primary_domain}</span>
                                <Pill kind={site.adoptable ? 'cyan' : 'gray'} dot={false}>{kindLabel(site)}</Pill>
                            </div>
                            <dl className="adopt-sites__facts">
                                {site.domains.length > 1 && (
                                    <>
                                        <dt>{t('app.services.adopt.alsoServes', 'Also serves')}</dt>
                                        <dd>{site.domains.slice(1).join(', ')}</dd>
                                    </>
                                )}
                                {site.root && (
                                    <>
                                        <dt>{t('app.services.adopt.root', 'Document root')}</dt>
                                        <dd>{site.root}</dd>
                                    </>
                                )}
                                {site.php && (
                                    <>
                                        <dt>{t('app.services.adopt.php', 'PHP-FPM')}</dt>
                                        <dd>
                                            {site.php.version || t('app.services.adopt.unknownVersion', 'Unknown version')}
                                            {site.php.pool ? ` · ${site.php.pool}` : ''}
                                        </dd>
                                    </>
                                )}
                                {site.upstream && (
                                    <>
                                        <dt>{t('app.services.adopt.upstream', 'Proxies to')}</dt>
                                        <dd>{site.upstream}</dd>
                                    </>
                                )}
                                {site.database && (
                                    <>
                                        <dt>{t('app.services.adopt.database', 'Database')}</dt>
                                        <dd>{site.database.name}</dd>
                                    </>
                                )}
                                <dt>{t('app.services.adopt.certificate', 'Certificate')}</dt>
                                <dd>
                                    {site.ssl.enabled
                                        ? site.ssl.certificate
                                        : t('app.services.adopt.noCertificate', 'None')}
                                </dd>
                                <dt>{t('app.services.adopt.vhost', 'nginx config')}</dt>
                                <dd>{site.vhost_file}</dd>
                            </dl>
                            {!site.adoptable && site.reason && (
                                <p className="adopt-sites__reason">{site.reason}</p>
                            )}
                        </div>
                        {site.adoptable && (
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => handleAdopt(site)}
                                disabled={adopting !== null}
                            >
                                {adopting === site.id
                                    ? t('app.services.adopt.adopting', 'Adopting…')
                                    : t('app.services.adopt.action', 'Adopt')}
                            </Button>
                        )}
                    </li>
                ))}
            </ul>
        </Modal>
    );
}
