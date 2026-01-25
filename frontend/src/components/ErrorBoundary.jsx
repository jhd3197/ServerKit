import React, { Component } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

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
        console.error('ErrorBoundary caught an error:', error, errorInfo);
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        this.props.onRetry?.();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="error-boundary">
                    <div className="error-boundary-icon">
                        <AlertTriangle size={32} />
                    </div>
                    <h3>Something went wrong</h3>
                    <p className="error-boundary-message">
                        {this.state.error?.message || 'An unexpected error occurred'}
                    </p>
                    <button className="btn btn-primary" onClick={this.handleRetry}>
                        <RefreshCw size={14} />
                        Try Again
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}

// Functional component for displaying API/fetch errors
export function ErrorState({
    title = 'Failed to load',
    message,
    error,
    onRetry,
    compact = false
}) {
    const errorMessage = message || error?.message || 'An error occurred while loading data';

    if (compact) {
        return (
            <div className="error-state-compact">
                <AlertTriangle size={16} />
                <span>{errorMessage}</span>
                {onRetry && (
                    <button className="btn btn-ghost btn-sm" onClick={onRetry}>
                        <RefreshCw size={14} /> Retry
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className="error-state">
            <div className="error-state-icon">
                <AlertTriangle size={32} />
            </div>
            <h3 className="error-state-title">{title}</h3>
            <p className="error-state-message">{errorMessage}</p>
            {onRetry && (
                <button className="btn btn-primary" onClick={onRetry}>
                    <RefreshCw size={14} />
                    Try Again
                </button>
            )}
        </div>
    );
}

export default ErrorBoundary;
