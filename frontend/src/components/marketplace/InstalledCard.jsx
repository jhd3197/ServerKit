import { AlertTriangle, ArrowUpCircle, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CatalogCard, StatusDot } from '@/components/ds';
import { statusKind, statusLabel } from '@/components/ds/status';
import SignatureBadge from './SignatureBadge';
import { ExtensionCover } from './ExtensionCover';
import { isUpdatable } from './extensionUpdates';


// One installed extension as a dense catalog card: status dot, version, update
// badge + one-click Update, everything else behind (i) and the "…" menu.
export default function InstalledCard({
    plugin, update, busy, onToggle, onUpdate, onUninstall, onConfigure, onInspectPermissions,
}) {
    const { t } = useTranslation();
    const isBusy = Boolean(busy);
    const canUpdate = isUpdatable(update);
    const isActive = plugin.status === 'active';
    const configurable = plugin.config_schema && typeof plugin.config_schema === 'object'
        && Object.keys(plugin.config_schema).length > 0;
    const permissions = Array.isArray(plugin.permissions) ? plugin.permissions : [];
    const entry = { installKey: plugin.slug };

    const info = (
        <div className="marketplace-info">
            {plugin.description && <p>{plugin.description}</p>}
            {plugin.error_message && <p className="marketplace-info__error">{plugin.error_message}</p>}
            <p className="marketplace-info__meta">
                {plugin.source_type === 'builtin' ? t('app.marketplace.builtIn', 'Built-in') : plugin.source_type === 'registry' ? t('app.marketplace.registry', 'Registry') : t('app.marketplace.manual', 'Manual')}{plugin.author ? ` · ${plugin.author}` : ''}
                {plugin.has_backend ? ` · ${t('app.marketplace.backend', 'Backend')}` : ''}
                {plugin.has_frontend ? ` · ${t('app.marketplace.frontend', 'Frontend')}` : ''}
            </p>
            {plugin.signature && <SignatureBadge signature={plugin.signature} />}
            {permissions.length > 0 && (
                <div className="tip-chip-row">
                    {permissions.map((p) => <span key={p} className="tip-chip">{p}</span>)}
                </div>
            )}
        </div>
    );

    return (
        <CatalogCard
            className={plugin.status === 'error' ? 'marketplace-card--error' : undefined}
            icon={<ExtensionCover base="sk-catalog-card__art" entry={entry} category={plugin.category || 'utility'} brandSize={20} />}
            title={plugin.display_name}
            sub={(
                <span className="marketplace-card__sub">
                    <StatusDot kind={statusKind(plugin.status)} label={statusLabel(plugin.status)} />
                    v{plugin.version}
                </span>
            )}
            tag={plugin.status === 'error' && (
                <AlertTriangle size={14} className="marketplace-card__err" aria-label={t('app.marketplace.error', 'Error')} />
            )}
            description={info}
            facts={update?.update_available && (
                <Badge variant={canUpdate ? 'info' : 'outline'} className="plugin-update-badge">
                    <ArrowUpCircle aria-hidden="true" />
                    {t('app.marketplace.updateTo', 'Update v{{version}}', { version: update.available_version })}
                </Badge>
            )}
            action={(
                <>
                    {canUpdate && (
                        <Button size="sm" disabled={isBusy} onClick={() => onUpdate(plugin.id)}>
                            {busy === 'update' ? t('app.marketplace.updating', 'Updating…') : t('app.marketplace.update', 'Update')}
                        </Button>
                    )}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" disabled={isBusy} aria-label={t('app.marketplace.actions', 'Actions')}>
                                <MoreHorizontal aria-hidden="true" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => onToggle(plugin)}>
                                {isActive ? t('common.actions.disable', 'Disable') : t('common.actions.enable', 'Enable')}
                            </DropdownMenuItem>
                            {configurable && (
                                <DropdownMenuItem onSelect={() => onConfigure(plugin)}>
                                    {t('app.marketplace.configure', 'Configure')}
                                </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => onInspectPermissions(plugin)}>
                                {t('common.labels.permissions', 'Permissions')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => onUninstall(plugin)}>
                                {t('common.actions.uninstall', 'Uninstall')}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </>
            )}
        />
    );
}
