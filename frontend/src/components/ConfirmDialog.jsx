import React from 'react';
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
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'danger',
    onConfirm,
    onCancel
}) {
    if (!isOpen) return null;

    const Icon = iconMap[variant] || AlertTriangle;

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal confirm-dialog" onClick={e => e.stopPropagation()}>
                <div className="confirm-dialog-content">
                    <div className={`confirm-dialog-icon confirm-dialog-icon-${variant}`}>
                        <Icon size={32} />
                    </div>
                    <h2 className="confirm-dialog-title">{title}</h2>
                    <p className="confirm-dialog-message">{message}</p>
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
                        onClick={onConfirm}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ConfirmDialog;
