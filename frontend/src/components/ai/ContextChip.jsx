import { MapPin } from 'lucide-react';
import { useServerkitAI } from '../../contexts/useServerkitAI.js';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Shows the page the assistant is aware of, and lets the user toggle whether
// that context is attached to the next message. Assistant mode only.
const ContextChip = () => {
    const { t } = useTranslation();
    const { mode, pageContext, includeContext, setIncludeContext } = useServerkitAI();
    if (mode !== 'assistant') return null;

    return (
        <SharedButton variant="unstyled"
            type="button"
            className={`sk-ai-context-chip${includeContext ? ' is-on' : ' is-off'}`}
            aria-pressed={includeContext}
            title={includeContext
                ? t('app.contextChip.theAssistantCanReadLiveData', 'The assistant can read live data for this page and call ServerKit tools. Click to detach.')
                : t('app.contextChip.pageContextIsDetachedClickTo', 'Page context is detached. Click to attach.')}
            onClick={() => setIncludeContext(!includeContext)}
        >
            <MapPin size={13} />
            <span>{includeContext ? t('app.contextChip.askingAbout', 'Asking about: {{label}}', { label: pageContext.label }) : t('app.contextChip.noPageContext', 'No page context')}</span>
        </SharedButton>
    );
};

export default ContextChip;
