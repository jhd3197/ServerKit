import { SiNginx, SiTraefikproxy, SiCaddy } from 'react-icons/si';
import { t } from '../../i18n/t';

// The three proxy choices as logo tiles with a one-line caption each.
export default function ProxyLogoTiles() {
    const items = [
        { Icon: SiNginx, name: 'Nginx', sub: t('app.proxyLogoTiles.hostDefault', 'Host default') },
        { Icon: SiTraefikproxy, name: 'Traefik', sub: t('app.proxyLogoTiles.dockerStack', 'Docker stack') },
        { Icon: SiCaddy, name: 'Caddy', sub: t('app.proxyLogoTiles.dockerStack', 'Docker stack') },
    ];
    return (
        <ul className="logo-tile-row">
            {items.map(({ Icon, name, sub }) => (
                <li key={name} className="logo-tile-row__item">
                    <span className="logo-tile-row__tile"><Icon aria-hidden="true" /></span>
                    <span>{name}</span>
                    <span>{sub}</span>
                </li>
            ))}
        </ul>
    );
}
