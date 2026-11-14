import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePagePrimaryAction } from '../contexts/pagePrimaryAction.js';

// A page's primary create button: compact icon + short label on desktop (the
// full text rides in title/aria-label), and it registers the same action with
// the mobile header "+", which takes over at the width where this button hides
// (.sk-topbar__primary). Pass `to` instead of onClick to navigate.
// `iconOnly` drops the visible label, e.g. for pages with a tight icon bar.
// `disabledReason` (a prerequisite, not a pending request) is shown on both this
// button and the header "+".
export function PagePrimaryButton({ id, label, shortLabel, icon: Icon = Plus, onClick, to, disabled = false, disabledReason, iconOnly = false }) {
    const navigate = useNavigate();
    const run = to ? () => navigate(to) : onClick;
    usePagePrimaryAction({ id, label, onClick: run, disabled, disabledReason });

    return (
        <Button
            size={iconOnly ? 'icon' : 'sm'}
            variant={iconOnly ? 'ghost' : 'default'}
            className="sk-topbar__primary"
            title={label}
            aria-label={label}
            disabled={disabled}
            disabledReason={disabledReason}
            onClick={run}
        >
            <Icon size={15} aria-hidden="true" />
            {!iconOnly && (shortLabel || label)}
        </Button>
    );
}

export default PagePrimaryButton;
