import { Link } from 'react-router-dom';
import PageLayout from '@/layouts/PageLayout';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// One anatomy for entity detail pages (services, servers):
//
//   top bar    Parent / Name  [star]                         [actions]
//   identity   [tile] Name [status] [badges]
//              meta line · meta line
//   tabs       [Overview] [Logs] …                          [Settings]
//   content
//
// Feature pages own their data, actions and tab bodies; this module owns the
// frame so the two pages cannot drift apart again.
export function DetailPage({ className, topbarClassName, icon, parentTo, parentLabel, name, favorite, actions, children }) {
    return (
        <PageLayout
            className={cn('sk-detail-page', className)}
            topbarClassName={topbarClassName}
            contentClassName="sk-detail-body"
            icon={icon}
            title={(
                <span className="sk-detail-crumbs">
                    <Link to={parentTo}>{parentLabel}</Link>
                    <span aria-hidden="true">/</span>
                    <span aria-current="page">{name}</span>
                </span>
            )}
            meta={favorite}
            actions={actions}
        >
            {children}
        </PageLayout>
    );
}

// The entity's name, state and key facts, directly under the top bar.
export function DetailIdentity({ avatar, name, badges, meta, description }) {
    return (
        <header className="sk-detail-identity">
            {avatar}
            <div className="sk-detail-identity__body">
                <div className="sk-detail-identity__title">
                    <h2>{name}</h2>
                    {badges}
                </div>
                {meta && <div className="sk-detail-identity__meta">{meta}</div>}
                {description && <p className="sk-detail-identity__description">{description}</p>}
            </div>
        </header>
    );
}

// Separator between facts on the identity meta line.
export function DetailMetaSep() {
    return <span className="sk-detail-identity__sep" aria-hidden="true">·</span>;
}

// The tab strip under the identity. `items`: [{ id, label, icon, badge }].
// Settings always sits at the far end of the strip.
export function DetailTabs({ items, value, onValueChange, ariaLabel, children }) {
    return (
        <Tabs className="sk-detail-tabs" value={value} onValueChange={onValueChange}>
            <TabsList aria-label={ariaLabel}>
                {items.map(({ id, label, icon: Icon, badge }) => (
                    <TabsTrigger key={id} value={id} className={id === 'settings' ? 'sk-detail-tabs__end' : undefined}>
                        {Icon && <Icon size={14} aria-hidden="true" />}
                        {label}
                        {badge ? <span className="tab-badge">{badge}</span> : null}
                    </TabsTrigger>
                ))}
            </TabsList>
            <div className="sk-detail-tabs__content">{children}</div>
        </Tabs>
    );
}
