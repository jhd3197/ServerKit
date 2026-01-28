import React, { useState } from 'react';
import { Square, Play, RefreshCw, ArrowDownLeft, X } from 'lucide-react';
import Spinner from '../Spinner';

const BulkActionsBar = ({ selectedIds, environments, prodId, onClear, onExecute, api }) => {
    const [executing, setExecuting] = useState(false);
    const [confirmAction, setConfirmAction] = useState(null);

    if (!selectedIds || selectedIds.length === 0) return null;

    const selectedNames = selectedIds.map(id => {
        const env = environments.find(e => e.id === id);
        return env?.name || `#${id}`;
    });

    async function handleAction(action) {
        if (action === 'stop' || action === 'sync') {
            setConfirmAction(action);
            return;
        }
        await executeAction(action);
    }

    async function executeAction(action) {
        setExecuting(true);
        setConfirmAction(null);
        try {
            await onExecute(action, selectedIds);
        } finally {
            setExecuting(false);
        }
    }

    return (
        <div className="bulk-actions-bar">
            {confirmAction ? (
                <div className="bulk-actions-confirm">
                    <span>
                        {confirmAction === 'stop' && `Stop ${selectedIds.length} environment(s)?`}
                        {confirmAction === 'sync' && `Sync ${selectedIds.length} environment(s) from production?`}
                    </span>
                    <button
                        className="btn btn-primary btn-sm"
                        onClick={() => executeAction(confirmAction)}
                        disabled={executing}
                    >
                        {executing ? <Spinner size="sm" /> : 'Confirm'}
                    </button>
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setConfirmAction(null)}
                        disabled={executing}
                    >
                        Cancel
                    </button>
                </div>
            ) : (
                <>
                    <div className="bulk-actions-info">
                        <span className="bulk-actions-count">{selectedIds.length}</span>
                        <span>selected</span>
                    </div>

                    <div className="bulk-actions-buttons">
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleAction('start')}
                            disabled={executing}
                            title="Start Selected"
                        >
                            <Play size={12} />
                            Start
                        </button>
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleAction('stop')}
                            disabled={executing}
                            title="Stop Selected"
                        >
                            <Square size={12} />
                            Stop
                        </button>
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleAction('restart')}
                            disabled={executing}
                            title="Restart Selected"
                        >
                            <RefreshCw size={12} />
                            Restart
                        </button>
                        <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleAction('sync')}
                            disabled={executing}
                            title="Sync from Production"
                        >
                            <ArrowDownLeft size={12} />
                            Sync from Prod
                        </button>
                    </div>

                    <button
                        className="btn btn-ghost btn-sm bulk-actions-clear"
                        onClick={onClear}
                    >
                        <X size={12} />
                    </button>
                </>
            )}
        </div>
    );
};

export default BulkActionsBar;
