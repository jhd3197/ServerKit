import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t } from '@/i18n/t';
import { errorReason } from '@/utils/errorMessage';

/**
 * Consistent error state for pages and panels. Shows an icon, title, message,
 * and optional retry action.
 *
 *   <ErrorState
 *     title="Failed to load servers"
 *     message="The backend returned an error. Please try again."
 *     onRetry={loadData}
 *   />
 */
export function ErrorState({
    title = t('common.error.failedToLoad', 'Failed to load'),
    message,
    error,
    onRetry,
    compact = false,
    className = '',
}) {
    const errorMessage = message || errorReason(error)
        || t('common.error.loadingData', 'An error occurred while loading data');

    if (compact) {
        return (
            <div className={`error-state-compact ${className}`.trim()} role="alert">
                <AlertTriangle size={16} />
                <span>{errorMessage}</span>
                {onRetry && (
                    <Button variant="ghost" size="sm" onClick={onRetry}>
                        <RefreshCw size={14} /> {t('common.actions.retry', 'Retry')}
                    </Button>
                )}
            </div>
        );
    }

    return (
        <div className={`sk-error-state ${className}`.trim()} role="alert">
            <div className="sk-error-state__icon">
                <AlertTriangle size={32} />
            </div>
            <h3 className="sk-error-state__title">{title}</h3>
            {errorMessage && <p className="sk-error-state__message">{errorMessage}</p>}
            {onRetry && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                    <RefreshCw size={14} /> {t('common.actions.tryAgain', 'Try again')}
                </Button>
            )}
        </div>
    );
}

export default ErrorState;
