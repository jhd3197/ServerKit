import { ArrowDown, Sparkles } from 'lucide-react';
import { useServerkitAI } from '../../contexts/useServerkitAI.js';
import { useContributions } from '../../plugins/contributions';
import useAutoScroll from '../../hooks/ai/useAutoScroll';
import Message from './Message';
import TypingIndicator from './TypingIndicator';
import ConfirmActionCard from './ConfirmActionCard';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

const routeMatches = (pattern, route) => {
    if (!pattern || pattern === '*') return true;
    if (pattern === route) return true;
    return route.startsWith(pattern.replace(/\/?\*$/, ''));
};

const MessageList = () => {
    const { t } = useTranslation();
    const {
        messages, isStreaming, pageContext, mode, ask, enabled, providerConfigured, pendingConfirm,
    } = useServerkitAI();
    const contributions = useContributions();
    const { ref, isPinned, checkPinned, scrollToBottom } = useAutoScroll([messages, isStreaming]);

    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    const showTyping = isStreaming
        && lastAssistant
        && !lastAssistant.content
        && !(lastAssistant.toolCalls || []).length
        && !pendingConfirm;

    const isEmpty = messages.length === 0;
    // Core per-page prompts + any plugin-contributed prompts matching this route.
    const corePrompts = (pageContext.suggestedPrompts || []).map((p) => ({ label: p, prompt: p }));
    const pluginPrompts = (contributions.ai?.suggested_prompts || [])
        .filter((p) => p && p.prompt && routeMatches(p.route, pageContext.route))
        .map((p) => ({ label: p.label || p.prompt, prompt: p.prompt }));
    const suggestions = mode === 'assistant' ? [...corePrompts, ...pluginPrompts] : [];

    return (
        <div className="sk-ai-messages" ref={ref} onScroll={checkPinned} aria-live="polite">
            {isEmpty ? (
                <div className="sk-ai-empty">
                    <div className="sk-ai-empty__icon"><Sparkles size={22} /></div>
                    <h3 className="sk-ai-empty__title">{t('app.messageList.serverkitAi', 'ServerKit AI')}</h3>
                    <p className="sk-ai-empty__sub">{t('app.messageList.askAboutThisPage', 'Ask about this page, or anything on this server.')}</p>
                    {!providerConfigured ? (
                        <p className="sk-ai-empty__hint">
                            {!enabled ? t('ai.settings.disabledHelp', 'The assistant is disabled. An admin can enable it in') : t('app.messageList.theAssistantIsnTConfiguredYet', 'The assistant isn\'t configured yet. An admin can set a provider in')}
                            {' '}{t('app.messageList.settingsAiAssistant', 'Settings → AI assistant.')}
                        </p>
                    ) : (
                        <div className="sk-ai-empty__prompts">
                            {suggestions.map((p) => (
                                <SharedButton variant="unstyled"
                                    key={p.label}
                                    type="button"
                                    className="sk-ai-suggested"
                                    onClick={() => ask(p.prompt, { open: true })}
                                >
                                    {p.label}
                                </SharedButton>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <>
                    {messages.map((m) => <Message key={m.id} message={m} />)}
                    {showTyping ? <TypingIndicator label={lastAssistant?.thinking ? t('app.messageList.thinking', 'Thinking…') : null} /> : null}
                    <ConfirmActionCard />
                </>
            )}

            {!isPinned && !isEmpty ? (
                <SharedButton variant="unstyled" type="button" className="sk-ai-jump" onClick={scrollToBottom} aria-label={t('app.messageList.jumpToLatest', 'Jump to latest')}>
                    <ArrowDown size={16} />
                </SharedButton>
            ) : null}
        </div>
    );
};

export default MessageList;
