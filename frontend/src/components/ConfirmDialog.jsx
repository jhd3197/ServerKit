import React, { useState, useEffect } from 'react';
import { AlertTriangle, Info, AlertCircle } from 'lucide-react';

const iconMap = {
    danger: AlertTriangle,
    warning: AlertCircle,
    info: Info
};

export function ConfirmDialog({
    isOpen,
    title,
    message,
    details,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'danger',
    requireConfirmation,
    confirmationPlaceholder,
    onConfirm,
    onCancel
}) {
    const [inputValue, setInputValue] = useState('');

    // Reset input when dialog opens/closes
    useEffect(() => {
        if (isOpen) {
            setInputValue('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const Icon = iconMap[variant] || AlertTriangle;
    const isConfirmDisabled = requireConfirmation && inputValue !== requireConfirmation;

    function handleConfirm() {
        if (!isConfirmDisabled) {
            onConfirm();
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter' && !isConfirmDisabled) {
            handleConfirm();
        }
    }

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal confirm-dialog" onClick={e => e.stopPropagation()}>
                <div className="confirm-dialog-content">
                    <div className={`confirm-dialog-icon confirm-dialog-icon-${variant}`}>
                        <Icon size={32} />
                    </div>
                    <h2 className="confirm-dialog-title">{title}</h2>
                    <p className="confirm-dialog-message">{message}</p>
                    {details && (
                        <div className="confirm-dialog-details">
                            {details}
                        </div>
                    )}
                    {requireConfirmation && (
                        <div className="confirm-dialog-input">
                            <label>
                                Type <strong>{requireConfirmation}</strong> to confirm:
                            </label>
                            <input
                                type="text"
                                value={inputValue}
                                onChange={(e) => setInputValue(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={confirmationPlaceholder || requireConfirmation}
                                autoFocus
                            />
                        </div>
                    )}
                </div>
                <div className="confirm-dialog-actions">
                    <button
                        className="btn btn-secondary"
                        onClick={onCancel}
                    >
                        {cancelText}
                    </button>
                    <button
                        className={`btn btn-${variant === 'danger' ? 'danger' : 'primary'}`}
                        onClick={handleConfirm}
                        disabled={isConfirmDisabled}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ConfirmDialog;
