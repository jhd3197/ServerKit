import React, { useState, useEffect } from 'react';
import { X, Trash2, Clock, Layers, GitBranch, Loader } from 'lucide-react';
import api from '../../services/api';

const WorkflowListModal = ({ onLoad, onClose }) => {
    const [workflows, setWorkflows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    useEffect(() => {
        loadWorkflows();
    }, []);

    const loadWorkflows = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await api.getWorkflows();
            setWorkflows(response.workflows || []);
        } catch (err) {
            console.error('Failed to load workflows:', err);
            setError('Failed to load workflows');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (e, workflow) => {
        e.stopPropagation();
        if (!confirm(`Delete workflow "${workflow.name}"?`)) return;

        setDeletingId(workflow.id);
        try {
            await api.deleteWorkflow(workflow.id);
            setWorkflows((prev) => prev.filter((w) => w.id !== workflow.id));
        } catch (err) {
            console.error('Failed to delete workflow:', err);
            setError('Failed to delete workflow');
        } finally {
            setDeletingId(null);
        }
    };

    const handleLoad = async (workflow) => {
        setError(null);
        try {
            const response = await api.getWorkflow(workflow.id);
            if (response && response.nodes !== undefined) {
                onLoad(response);
            } else {
                console.error('Invalid workflow response:', response);
                setError('Invalid workflow data received');
            }
        } catch (err) {
            console.error('Failed to load workflow:', err);
            setError(err.message || 'Failed to load workflow');
        }
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'Unknown';
        const date = new Date(dateStr);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    };

    return (
        <div className="workflow-modal-overlay" onClick={onClose}>
            <div className="workflow-modal" onClick={(e) => e.stopPropagation()}>
                <div className="workflow-modal-header">
                    <h2>Load Workflow</h2>
                    <button className="modal-close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="workflow-modal-content">
                    {loading ? (
                        <div className="workflow-list-loading">
                            <Loader size={24} className="spin" />
                            <span>Loading workflows...</span>
                        </div>
                    ) : error ? (
                        <div className="workflow-list-error">
                            <span>{error}</span>
                            <button onClick={loadWorkflows}>Retry</button>
                        </div>
                    ) : workflows.length === 0 ? (
                        <div className="workflow-list-empty">
                            <Layers size={48} />
                            <p>No saved workflows</p>
                            <span>Create and save a workflow to see it here</span>
                        </div>
                    ) : (
                        <div className="workflow-list">
                            {workflows.map((workflow) => (
                                <div
                                    key={workflow.id}
                                    className="workflow-list-item"
                                    onClick={() => handleLoad(workflow)}
                                >
                                    <div className="workflow-item-main">
                                        <div className="workflow-item-name">{workflow.name}</div>
                                        {workflow.description && (
                                            <div className="workflow-item-desc">{workflow.description}</div>
                                        )}
                                    </div>
                                    <div className="workflow-item-meta">
                                        <div className="workflow-item-stats">
                                            <span className="stat">
                                                <Layers size={14} />
                                                {workflow.node_count || 0} nodes
                                            </span>
                                            <span className="stat">
                                                <GitBranch size={14} />
                                                {workflow.edge_count || 0} connections
                                            </span>
                                        </div>
                                        <div className="workflow-item-date">
                                            <Clock size={14} />
                                            {formatDate(workflow.updated_at)}
                                        </div>
                                    </div>
                                    <button
                                        className="workflow-item-delete"
                                        onClick={(e) => handleDelete(e, workflow)}
                                        disabled={deletingId === workflow.id}
                                        title="Delete workflow"
                                    >
                                        {deletingId === workflow.id ? (
                                            <Loader size={16} className="spin" />
                                        ) : (
                                            <Trash2 size={16} />
                                        )}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WorkflowListModal;
