import Markdown from './Markdown';
import ToolCallCard from './ToolCallCard';
import AttachmentChip from './AttachmentChip';
import { useTranslation } from 'react-i18next';
import useFormat from '../../hooks/useFormat';

const Message = ({ message }) => {
    const { t } = useTranslation();
    const { formatNumber } = useFormat();
    const money = (amount) => t('ai.usage.usd', '{{amount}} USD', { amount: formatNumber(amount, { maximumFractionDigits: 4 }) });
    const usage = message.usage;
    if (message.role === 'user') {
        return (
            <div className="sk-ai-message sk-ai-message--user">
                {(message.attachments || []).length > 0 && (
                    <div className="sk-ai-message__attachments">
                        {message.attachments.map((attachment) => (
                            <AttachmentChip
                                key={`${attachment.type}:${attachment.runKind || ''}:${attachment.id}`}
                                attachment={attachment}
                            />
                        ))}
                    </div>
                )}
                <div className="sk-ai-message__bubble">{message.content}</div>
            </div>
        );
    }

    return (
        <div className="sk-ai-message sk-ai-message--assistant">
            {(message.toolCalls || []).map((tc) => (
                <ToolCallCard key={tc.id} call={tc} />
            ))}
            {message.content ? <Markdown text={message.content} /> : null}
            {message.status === 'error' ? (
                <div className="sk-ai-message__error">{message.error || t('app.message.somethingWentWrong', 'Something went wrong.')}</div>
            ) : null}
            {usage?.run_id && <details className="sk-ai-message__usage">
                <summary>{usage.model} · {formatNumber(usage.total_tokens || 0)} {t('ai.usage.tokens', 'Tokens')} · {usage.cost_source === 'unknown' ? t('ai.usage.unknown', 'Unknown') : money(usage.cost || 0)}</summary>
                <p>{usage.reason}</p>
                <p>{t('ai.usage.runSummary', '{{profile}} · {{calls}} provider calls · {{errors}} errors · {{seconds}} seconds', { profile: usage.profile, calls: usage.call_count, errors: usage.errors, seconds: formatNumber((usage.duration_ms || 0) / 1000, { maximumFractionDigits: 1 }) })}</p>
                <p>{t('ai.usage.source', 'Cost source: {{source}}', { source: usage.cost_source })}</p>
                {usage.budget?.cost_remaining != null && <p>{t('ai.usage.costRemaining', 'Conversation cost allowance remaining: {{amount}}', { amount: money(usage.budget.cost_remaining) })}</p>}
                {usage.budget?.tokens_remaining != null && <p>{t('ai.usage.tokensRemaining', 'Conversation tokens remaining: {{count}}', { count: usage.budget.tokens_remaining })}</p>}
                {usage.budget?.exceeded && <p role="status">{t('ai.usage.budgetWarning', 'The conversation allowance has been reached. Further calls follow the configured budget policy.')}</p>}
            </details>}
        </div>
    );
};

export default Message;
