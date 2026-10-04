import { useContext, useState } from 'react';
import { AlertTriangle, RefreshCw, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import { AIContext } from '../../contexts/useServerkitAI.js';
import { CopyButton } from '@/components/CopyButton';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Pinned failure card (plan 51 §1.1): failed step name, the one-line error, a
// plain-language hint when a heuristic matched, actions (Retry / Copy / Ask AI)
// and the persisted failure tail behind a disclosure.
//
// The tail is collapsed by default. It used to be open, which cost ~250px above
// the fold and pushed the live log into a strip — while showing the same output
// that is already in the log below. Now that a failed deploy scrolls itself to
// the offending line and the severity map marks it, the duplicate is worth
// having on demand rather than always.
export default function ErrorCard({ failedStepName, failureTail, hint, errorMessage, onRetry, retrying }) {
    const { t } = useTranslation();
    const [showTail, setShowTail] = useState(false);
    // Read the AI drawer context directly (null when no AIProvider is mounted),
    // so the hook is called unconditionally and the "Ask AI" button degrades
    // gracefully.
    const ai = useContext(AIContext);

    const tailText = Array.isArray(failureTail) ? failureTail.join('\n') : (failureTail || '');
    const tailLines = tailText ? tailText.split('\n') : [];

    const errorReport = [
        failedStepName ? `Failed step: ${failedStepName}` : null,
        errorMessage ? `Error: ${errorMessage}` : null,
        tailText ? `\n${tailText}` : null,
    ].filter(Boolean).join('\n');

    const askAI = () => {
        if (!ai?.open) return;
        const prompt = [
            'A deployment on my server failed. Here is the failing step and the tail',
            'of the build output — explain what went wrong and how to fix it:\n',
            failedStepName ? `Failed step: ${failedStepName}` : '',
            errorMessage ? `Error: ${errorMessage}` : '',
            tailText ? `\nOutput:\n${tailText}` : '',
        ].join('\n');
        ai.open(prompt);
    };

    return (
        <div className="deploy-console__error" role="alert">
            <div className="deploy-console__error-head">
                <AlertTriangle size={18} />
                <div>
                    <strong>{t('app.errorCard.deploymentFailed', 'Deployment failed')}{failedStepName ? ` at "${failedStepName}"` : ''}</strong>
                    {errorMessage && <p className="deploy-console__error-msg">{errorMessage}</p>}
                </div>
            </div>

            {hint && (
                <p className="deploy-console__error-hint">
                    <Sparkles size={14} /> {hint}
                </p>
            )}

            {showTail && tailText && (
                <pre className="deploy-console__error-tail">{tailText}</pre>
            )}

            <div className="deploy-console__error-actions">
                <SharedButton variant="unstyled" type="button" className="deploy-console__btn deploy-console__btn--primary" onClick={onRetry} disabled={retrying}>
                    <RefreshCw size={14} className={retrying ? 'deploy-console__spin' : ''} />
                    {retrying ? 'Retrying…' : 'Retry deploy'}
                </SharedButton>
                <CopyButton
                    value={errorReport}
                    variant="unstyled"
                    size="default"
                    className="deploy-console__btn"
                    label={t('app.errorCard.copyError', 'Copy error')}
                    copiedLabel={t('app.copyField.copied', 'Copied')}
                >
                    {t('app.errorCard.copyError', 'Copy error')}
                </CopyButton>
                {ai?.open && (
                    <SharedButton variant="unstyled" type="button" className="deploy-console__btn" onClick={askAI}>
                        <Sparkles size={14} /> {t('app.errorCard.askAi', 'Ask AI')}
                    </SharedButton>
                )}
                {tailLines.length > 0 && (
                    <SharedButton variant="unstyled"
                        type="button"
                        className="deploy-console__error-toggle"
                        onClick={() => setShowTail((v) => !v)}
                        aria-expanded={showTail}
                    >
                        {showTail ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        {showTail
                            ? 'Hide output'
                            : `Show output (${tailLines.length} line${tailLines.length === 1 ? '' : 's'})`}
                    </SharedButton>
                )}
            </div>
        </div>
    );
}
