import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/i18n/t';

/**
 * The one card for things you browse to install or deploy: extensions,
 * templates, database engines, server templates. Anything you operate
 * (servers, services, containers, sites) is a table row, not a card.
 *
 *   <CatalogGrid>
 *     <CatalogCard
 *       icon={<img src={logo} alt="" />}
 *       title="Grafana"
 *       sub="v10.2 · by ServerKit"
 *       tag="Monitoring"
 *       description="Dashboards for every metric you already collect."
 *       facts=":3000 · 256 MB RAM"
 *       action={<Button size="sm">Deploy</Button>}
 *       onClick={() => openDetail(entry)}
 *     />
 *   </CatalogGrid>
 *
 * One tag, one action. Version, author and counts go in `sub` / `facts` as
 * plain text rather than as more badges.
 */
export function CatalogCard({
    icon,
    title,
    sub,
    tag,
    description,
    facts,
    action,
    featured = false,
    onClick,
    className,
    as: Tag = 'li',
}) {
    const handleKeyDown = onClick
        ? (event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick(event);
            }
        }
        : undefined;

    return (
        <Tag
            className={cn('sk-catalog-card', onClick && 'is-clickable', className)}
            onClick={onClick}
            onKeyDown={handleKeyDown}
            role={onClick ? 'button' : undefined}
            tabIndex={onClick ? 0 : undefined}
        >
            <div className="sk-catalog-card__head">
                {icon && <span className="sk-catalog-card__icon">{icon}</span>}
                <span className="sk-catalog-card__id">
                    <span className="sk-catalog-card__title">
                        {title}
                        {featured && (
                            <Star
                                size={12}
                                className="sk-catalog-card__featured"
                                aria-label={t('app.catalogCard.featured', 'Featured')}
                            />
                        )}
                    </span>
                    {sub && <span className="sk-catalog-card__sub">{sub}</span>}
                </span>
                {tag && <span className="sk-catalog-card__tag">{tag}</span>}
            </div>
            {description && <p className="sk-catalog-card__desc">{description}</p>}
            {(facts || action) && (
                <div className="sk-catalog-card__foot">
                    <span className="sk-catalog-card__facts">{facts}</span>
                    {action && (
                        // Clicking the action must not also open the card.
                        <span className="sk-catalog-card__action" onClick={(e) => e.stopPropagation()}>
                            {action}
                        </span>
                    )}
                </div>
            )}
        </Tag>
    );
}

export function CatalogGrid({ children, className, as: Tag = 'ul' }) {
    return <Tag className={cn('sk-catalog-grid', className)}>{children}</Tag>;
}

export default CatalogCard;
