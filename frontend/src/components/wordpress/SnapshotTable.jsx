import React, { useState } from 'react';
import { Download, RotateCcw, Trash2, GitCommit, Tag } from 'lucide-react';
import { ConfirmDialog } from '../ConfirmDialog';

const SnapshotTable = ({ snapshots, onRestore, onDelete, loading = false }) => {
    const [actionLoading, setActionLoading] = useState({});
    const [confirmRestore, setConfirmRestore] = useState(null);
    const [confirmDelete, setConfirmDelete] = useState(null);

    function formatBytes(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function formatDate(dateString) {
        if (!dateString) return '-';
        return new Date(dateString).toLocaleString();
    }

    async function handleRestore(snapshot) {
        setConfirmRestore(null);
        setActionLoading(prev => ({ ...prev, [`restore-${snapshot.id}`]: true }));
        try {
            await onRestore?.(snapshot.id);
        } finally {
            setActionLoading(prev => ({ ...prev, [`restore-${snapshot.id}`]: false }));
        }
    }

    async function handleDelete(snapshot) {
        setConfirmDelete(null);
        setActionLoading(prev => ({ ...prev, [`delete-${snapshot.id}`]: true }));
        try {
            await onDelete?.(snapshot.id);
        } finally {
            setActionLoading(prev => ({ ...prev, [`delete-${snapshot.id}`]: false }));
        }
    }

    if (loading) {
        return <div className="loading">Loading snapshots...</div>;
    }

    if (!snapshots || snapshots.length === 0) {
        return (
            <div className="empty-state-small">
                <p>No database snapshots yet.</p>
                <p className="hint">Create a snapshot to backup your database.</p>
            </div>
        );
    }

    return (
        <table className="docker-table wp-snapshot-table">
            <thead>
                <tr>
                    <th>Snapshot</th>
                    <th>Size</th>
                    <th>Created</th>
                    <th>Git Context</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
            </thead>
            <tbody>
                {snapshots.map(snapshot => (
                    <tr key={snapshot.id}>
                        <td>
                            <div className="snapshot-name-cell">
                                <span className="snapshot-name">{snapshot.name}</span>
                                {snapshot.tag && (
                                    <span className="snapshot-tag">
                                        <Tag size={10} /> {snapshot.tag}
                                    </span>
                                )}
                                {snapshot.description && (
                                    <span className="snapshot-desc">{snapshot.description}</span>
                                )}
                            </div>
                        </td>
                        <td>
                            <span className="mono">{formatBytes(snapshot.size_bytes)}</span>
                            {snapshot.compressed && (
                                <span className="compressed-badge" title="Compressed">gz</span>
                            )}
                        </td>
                        <td>{formatDate(snapshot.created_at)}</td>
                        <td>
                            {snapshot.commit_sha ? (
                                <div className="git-context">
                                    <GitCommit size={12} />
                                    <span className="mono">{snapshot.commit_sha.substring(0, 7)}</span>
                                    {snapshot.commit_message && (
                                        <span className="commit-msg" title={snapshot.commit_message}>
                                            {snapshot.commit_message.substring(0, 30)}
                                            {snapshot.commit_message.length > 30 && '...'}
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <span className="text-muted">-</span>
                            )}
                        </td>
                        <td className="docker-actions-cell">
                            <button
                                className="docker-icon-action"
                                title="Restore"
                                onClick={() => setConfirmRestore(snapshot)}
                                disabled={actionLoading[`restore-${snapshot.id}`]}
                            >
                                <RotateCcw size={14} />
                            </button>
                            <button
                                className="docker-icon-action"
                                title="Delete"
                                onClick={() => setConfirmDelete(snapshot)}
                                disabled={actionLoading[`delete-${snapshot.id}`]}
                                style={{ color: '#EF4444' }}
                            >
                                <Trash2 size={14} />
                            </button>
                        </td>
                    </tr>
                ))}
            </tbody>

            <ConfirmDialog
                isOpen={!!confirmRestore}
                title="Restore Database Snapshot"
                message={`Restore database from "${confirmRestore?.name}"?`}
                details={
                    <ul>
                        <li><strong>Warning:</strong> This will overwrite your current database</li>
                        <li>Snapshot size: <code>{formatBytes(confirmRestore?.size_bytes)}</code></li>
                        <li>Created: {formatDate(confirmRestore?.created_at)}</li>
                        {confirmRestore?.commit_sha && (
                            <li>Git commit: <code>{confirmRestore.commit_sha.substring(0, 7)}</code></li>
                        )}
                    </ul>
                }
                confirmText="Restore Snapshot"
                variant="warning"
                onConfirm={() => handleRestore(confirmRestore)}
                onCancel={() => setConfirmRestore(null)}
            />

            <ConfirmDialog
                isOpen={!!confirmDelete}
                title="Delete Snapshot"
                message={`Delete snapshot "${confirmDelete?.name}"?`}
                details={
                    <ul>
                        <li>This snapshot will be permanently deleted</li>
                        <li>This action cannot be undone</li>
                    </ul>
                }
                confirmText="Delete Snapshot"
                variant="danger"
                onConfirm={() => handleDelete(confirmDelete)}
                onCancel={() => setConfirmDelete(null)}
            />
        </table>
    );
};

export default SnapshotTable;
