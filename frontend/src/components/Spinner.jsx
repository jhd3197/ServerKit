import React from 'react';

export function Spinner({ size = 'md', className = '' }) {
    const sizeClasses = {
        sm: 'spinner-sm',
        md: 'spinner-md',
        lg: 'spinner-lg'
    };

    return (
        <div className={`spinner ${sizeClasses[size] || 'spinner-md'} ${className}`}>
            <div className="spinner-ring"></div>
        </div>
    );
}

export function LoadingState({ text = 'Loading...' }) {
    return (
        <div className="loading-state">
            <Spinner size="lg" />
            <span>{text}</span>
        </div>
    );
}

export default Spinner;
