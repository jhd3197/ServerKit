import { Maximize2, Minimize2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useNotifications } from '../contexts/useNotifications.js';
import { useOperations } from '../contexts/OperationsContext';
import { useServerkitAI } from '../contexts/useServerkitAI.js';
import { useShellDock } from '../contexts/useShellDock.js';
import { useWalkthroughs } from '../contexts/walkthroughContextValue';
import { Button as SharedButton } from '@/components/ui/button';

// Shared header strip for every shell console panel. Wherever a panel opens
// (Operations, Alerts, Recipes bottom console; Assistant right drawer), the
// same four tabs sit on top so switching surfaces is one click, like moving
// between tabs of a single console rather than four unrelated popovers.
export default function ShellDockTabs({ controls = null, expandable = true }) {
    const { t } = useTranslation();
    const {
        activeTab, openTab, close, expanded, setExpanded,
    } = useShellDock();
    const { activeOperations, attentionOperations } = useOperations();
    const notifications = useNotifications();
    const { activeWalkthrough, activeProgress } = useWalkthroughs();
    const { unread: assistantUnread } = useServerkitAI();

    const operationsBadge = activeOperations.length + attentionOperations.length;
    const tabs = [
        { id: 'ops', label: t('app.operationsDock.title', 'Operations'), badge: operationsBadge || null },
        { id: 'alerts', label: t('app.statusbar.alerts', 'Alerts'), badge: notifications?.unreadCount || null },
        {
            id: 'recipes',
            label: t('app.walkthroughs.title', 'Walkthroughs'),
            badge: activeWalkthrough
                ? `${activeProgress?.count || 0}/${activeProgress?.total || 0}`
                : null,
        },
        { id: 'assistant', label: t('app.ai.assistant', 'Assistant'), badge: assistantUnread || null },
    ];

    return (
        <div className="shell-dock-tabs" role="tablist" aria-label={t('app.statusbar.consolePanels', 'Console panels')}>
            {tabs.map((tab) => (
                <SharedButton variant="unstyled"
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    className={`shell-dock-tabs__tab${activeTab === tab.id ? ' is-active' : ''}`}
                    onClick={() => openTab(tab.id)}
                >
                    {tab.label}
                    {tab.badge ? <span className="shell-dock-tabs__badge">{tab.badge}</span> : null}
                </SharedButton>
            ))}
            <span className="shell-dock-tabs__spacer" />
            {controls}
            {expandable && (
                <SharedButton variant="unstyled"
                    type="button"
                    className="shell-dock-tabs__control"
                    onClick={() => setExpanded(!expanded)}
                    aria-pressed={expanded}
                    aria-label={expanded
                        ? t('app.statusbar.collapsePanel', 'Collapse panel')
                        : t('app.statusbar.expandPanel', 'Expand panel')}
                    title={expanded
                        ? t('app.statusbar.collapsePanel', 'Collapse panel')
                        : t('app.statusbar.expandPanel', 'Expand panel')}
                >
                    {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                </SharedButton>
            )}
            <SharedButton variant="unstyled"
                type="button"
                className="shell-dock-tabs__control"
                onClick={close}
                aria-label={t('common.actions.close', 'Close')}
                title={t('app.statusbar.closeEsc', 'Close (Esc)')}
            >
                <X size={15} />
            </SharedButton>
        </div>
    );
}
