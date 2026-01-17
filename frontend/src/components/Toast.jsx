import React from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

const iconMap = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertTriangle,
    info: Info
};

function ToastItem({ toast, onDismiss }) {
    const Icon = iconMap[toast.type] || Info;

    return (
        <div className={`toast toast-${toast.type}`}>
            <div className="toast-icon">
                <Icon size={18} />
            </div>
            <div className="toast-message">{toast.message}</div>
            <button className="toast-dismiss" onClick={() => onDismiss(toast.id)}>
                <X size={14} />
            </button>
        </div>
    );
}

export function ToastContainer() {
    const { toasts, removeToast } = useToast();

    if (toasts.length === 0) return null;

    return (
        <div className="toast-container">
            {toasts.map((toast) => (
                <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
            ))}
        </div>
    );
}

export default ToastContainer;
