import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Global quick-create (the "+" button beside the brand). It used to carry its
// own little dropdown; now it opens the command palette, whose empty state
// leads with the Create tile grid (see data/createItems.js) plus recipes and
// search — one door for every "new thing" flow. DashboardLayout listens for
// the event because the palette's open state lives there.
export function QuickCreate({ className, variant = 'icon' }) {
    const { t } = useTranslation();
    // 'icon' — compact square button (mobile top bar). 'header' — the accent
    // create button beside the ServerKit mark and GitHub star.
    const header = variant === 'header';
    return (
        <SharedButton variant="unstyled"
            type="button"
            className={cn('quick-create', header && 'quick-create--header', className)}
            title={t('app.quickCreate.createOrSearch', 'Create or search (Ctrl K)')}
            aria-label={t('app.quickCreate.createNew2', 'Create new')}
            onClick={() => window.dispatchEvent(new CustomEvent('serverkit:open-palette'))}
        >
            <Plus size={header ? 15 : 16} />
        </SharedButton>
    );
}

export default QuickCreate;
