import { useRef, useState } from 'react';
import { Paperclip, Send, Square } from 'lucide-react';
import { useServerkitAI } from '../../contexts/useServerkitAI.js';
import { useTranslation } from 'react-i18next';
import ResourcePicker from '../ResourcePicker';
import { Button } from '../ui/button';
import { MAX_AI_ATTACHMENTS } from '../../lib/ai/attachments';
import AttachmentChip from './AttachmentChip';

const ATTACHMENT_TYPES = ['service', 'server', 'project', 'environment', 'domain'];

const Composer = () => {
    const { t } = useTranslation();
    const {
        send,
        stop,
        isStreaming,
        providerConfigured,
        enabled,
        attachments,
        addAttachment,
        removeAttachment,
    } = useServerkitAI();
    const [value, setValue] = useState('');
    const textareaRef = useRef(null);

    const submit = () => {
        const text = value.trim();
        if (!text || isStreaming) return;
        send(text);
        setValue('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';
    };

    const onKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
        }
    };

    const onInput = (e) => {
        setValue(e.target.value);
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    };

    return (
        <div className="sk-ai-composer">
            {attachments.length > 0 && (
                <div className="sk-ai-composer__attachments">
                    {attachments.map((attachment) => (
                        <AttachmentChip
                            key={`${attachment.type}:${attachment.runKind || ''}:${attachment.id}`}
                            attachment={attachment}
                            onRemove={removeAttachment}
                        />
                    ))}
                </div>
            )}
            <div className="sk-ai-composer__main">
                <ResourcePicker
                    value={null}
                    onChange={addAttachment}
                    types={ATTACHMENT_TYPES}
                    icon={Paperclip}
                    disabled={!providerConfigured || isStreaming || attachments.length >= MAX_AI_ATTACHMENTS}
                    className="sk-ai-composer__attach"
                    label={t('app.composer.attachResource', 'Attach a resource')}
                    placeholder={t('app.composer.attach', 'Attach')}
                    searchPlaceholder={t('app.composer.searchResources', 'Search resources…')}
                    emptyMessage={t('app.composer.noResources', 'No accessible resources found')}
                />
                <textarea
                    ref={textareaRef}
                    className="sk-ai-composer__input"
                    rows={1}
                    placeholder={providerConfigured ? t('app.composer.askAboutYourServers', 'Ask about your servers…') : !enabled ? t('ai.settings.disabled', 'Assistant disabled') : t('app.composer.assistantNotConfigured', 'Assistant not configured')}
                    value={value}
                    disabled={!providerConfigured}
                    onChange={onInput}
                    onKeyDown={onKeyDown}
                    aria-label={t('app.composer.messageTheAssistant', 'Message the assistant')}
                />
                {isStreaming ? (
                    <Button type="button" className="sk-ai-composer__btn sk-ai-composer__btn--stop" onClick={stop} aria-label={t('common.actions.stop', 'Stop')}>
                        <Square size={16} />
                    </Button>
                ) : (
                    <Button
                        type="button"
                        className="sk-ai-composer__btn"
                        onClick={submit}
                        disabled={!providerConfigured || !value.trim()}
                        disabledReason={!providerConfigured ? t('app.composer.setUpTheAssistantFirst', 'Set up the assistant first') : t('app.composer.typeAMessageFirst', 'Type a message first')}
                        aria-label={t('app.composer.send', 'Send')}
                    >
                        <Send size={16} />
                    </Button>
                )}
            </div>
        </div>
    );
};

export default Composer;
