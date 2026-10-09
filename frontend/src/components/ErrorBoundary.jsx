import { Component } from 'react';
import api from '../services/api';
import { t } from '../i18n/t';
import ErrorState from './ErrorState';

// Class-based Error Boundary for catching React errors
export class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ errorInfo });
        // React already emits caught render failures in production. Keep the
        // extra component-stack log for local debugging without duplicating
        // the production console error users see.
        if (import.meta.env.DEV) {
            console.error('ErrorBoundary caught an error:', error, errorInfo);
        }
        // Fire-and-forget report to the backend error tracker. Wrapped so
        // reporting can NEVER throw inside the boundary — reportClientError
        // already swallows network failures; this guards payload assembly.
        try {
            api.reportClientError({
                message: error?.message || 'Unknown error',
                exception_type: error?.name,
                traceback: error?.stack,
                endpoint: window.location.pathname,
                context: {
                    componentStack: errorInfo?.componentStack?.slice(0, 2000),
                    userAgent: navigator.userAgent,
                },
            });
        } catch { /* reporting must never break the boundary */ }
    }

    componentDidUpdate(prevProps) {
        if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ hasError: false, error: null, errorInfo: null });
        }
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        this.props.onRetry?.();
    };

    render() {
        if (this.state.hasError) {
            return (
                <ErrorState
                    title={t('common.error.title', "This page couldn't load. Try again, or check the server logs.")}
                    message={t('common.error.unexpected', 'The page hit an unexpected error.')}
                    onRetry={this.handleRetry}
                />
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
