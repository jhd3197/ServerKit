import React, { useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

const ConfigPanel = ({
    isOpen,
    title,
    icon: Icon,
    headerColor = '#6366f1',
    onClose,
    children,
    footer
}) => {
    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Escape' && isOpen) {
            onClose();
        }
    }, [isOpen, onClose]);

    useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    return (
        <div className={`config-panel ${isOpen ? 'open' : ''}`}>
            <div className="config-panel-header" style={{ borderColor: headerColor }}>
                <div className="config-panel-title">
                    {Icon && (
                        <div className="config-panel-icon" style={{ backgroundColor: headerColor }}>
                            <Icon size={18} />
                        </div>
                    )}
                    <h3>{title}</h3>
                </div>
                <button className="config-panel-close" onClick={onClose}>
                    <X size={18} />
                </button>
            </div>

            <div className="config-panel-body">
                {children}
            </div>

            {footer && (
                <div className="config-panel-footer">
                    {footer}
                </div>
            )}
        </div>
    );
};

export default ConfigPanel;
