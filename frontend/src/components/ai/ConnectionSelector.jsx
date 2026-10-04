import { FormField } from '../FormField';
import { useServerkitAI } from '../../contexts/useServerkitAI';
import { useTranslation } from 'react-i18next';
import ModelBinding from './ModelBinding';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../ui/select';

// Radix Select reserves '' for "no selection"; automatic routing is '' to the
// AI context, so it travels as a sentinel inside the control.
const AUTO_PROFILE = '__auto';

export default function ConnectionSelector() {
    const { t } = useTranslation();
    const { connections, selectedConnection, selectedModel, selectConnection, selectModel,
        profile, workflow, selectProfile, selectWorkflow, activeId, isStreaming } = useServerkitAI();
    if (activeId || !connections.length) return null;
    return (
        <div className="sk-ai-task-selector">
          <div className="sk-ai-connection-selector">
            <FormField htmlFor="ai-chat-workflow" label={t('ai.tasks.task', 'Task')}>
                <Select value={workflow} disabled={isStreaming} onValueChange={selectWorkflow}>
                    <SelectTrigger id="ai-chat-workflow"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="chat">{t('ai.tasks.chat', 'Chat')}</SelectItem>
                        <SelectItem value="summarize">{t('ai.tasks.summarize', 'Summarize')}</SelectItem>
                        <SelectItem value="extract">{t('ai.tasks.extract', 'Extract structured facts')}</SelectItem>
                        <SelectItem value="diagnose">{t('ai.tasks.diagnose', 'Read-only diagnosis')}</SelectItem>
                    </SelectContent>
                </Select>
            </FormField>
            <FormField htmlFor="ai-chat-profile" label={t('ai.tasks.role', 'Model role')}>
                <Select value={profile || AUTO_PROFILE} disabled={isStreaming}
                    onValueChange={(v) => selectProfile(v === AUTO_PROFILE ? '' : v)}>
                    <SelectTrigger id="ai-chat-profile"><SelectValue /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value={AUTO_PROFILE}>{t('ai.tasks.automatic', 'Task default / automatic routing')}</SelectItem>
                        <SelectItem value="utility">{t('ai.management.utility', 'Utility')}</SelectItem>
                        <SelectItem value="standard">{t('ai.management.standard', 'Standard')}</SelectItem>
                        <SelectItem value="advanced">{t('ai.management.advanced', 'Advanced')}</SelectItem>
                    </SelectContent>
                </Select>
            </FormField>
          </div>
          <details><summary>{t('ai.tasks.override', 'Override connection and model')}</summary>
            <ModelBinding id="ai-chat" value={selectedConnection ? { connection_id: selectedConnection, model: selectedModel } : null}
                connections={connections} disabled={isStreaming} allowInherit inheritLabel={t('ai.tasks.useTaskModel', 'Use selected task model')} onChange={(next) => { selectConnection(next?.connection_id || ''); selectModel(next?.model || ''); }} />
          </details>
        </div>
    );
}
