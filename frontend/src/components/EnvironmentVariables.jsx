import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const EnvironmentVariables = ({ appId }) => {
    const toast = useToast();
    const [envVars, setEnvVars] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    // Form state
    const [newKey, setNewKey] = useState('');
    const [newValue, setNewValue] = useState('');
    const [newIsSecret, setNewIsSecret] = useState(false);
    const [newDescription, setNewDescription] = useState('');

    // UI state
    const [showValues, setShowValues] = useState({});
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [showImportModal, setShowImportModal] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [importContent, setImportContent] = useState('');
    const [importOverwrite, setImportOverwrite] = useState(true);
    const [history, setHistory] = useState([]);
    const [filter, setFilter] = useState('');

    const fileInputRef = useRef(null);

    useEffect(() => {
        loadEnvVars();
    }, [appId]);

    async function loadEnvVars() {
        try {
            setLoading(true);
            const data = await api.getEnvVars(appId);
            setEnvVars(data.env_vars || []);
        } catch (err) {
            toast.error('Failed to load environment variables');
            console.error('Failed to load env vars:', err);
        } finally {
            setLoading(false);
        }
    }

    async function handleAdd(e) {
        e.preventDefault();
        if (!newKey.trim()) {
            toast.error('Key is required');
            return;
        }

        setSaving(true);
        try {
            await api.createEnvVar(appId, newKey.trim(), newValue, newIsSecret, newDescription || null);
            toast.success('Environment variable added');
            setNewKey('');
            setNewValue('');
            setNewIsSecret(false);
            setNewDescription('');
            loadEnvVars();
        } catch (err) {
            toast.error(err.message || 'Failed to add environment variable');
        } finally {
            setSaving(false);
        }
    }

    async function handleUpdate(key) {
        if (editingId === null) return;

        setSaving(true);
        try {
            await api.updateEnvVar(appId, key, { value: editValue });
            toast.success('Environment variable updated');
            setEditingId(null);
            setEditValue('');
            loadEnvVars();
        } catch (err) {
            toast.error(err.message || 'Failed to update environment variable');
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete(key) {
        if (!confirm(`Delete environment variable "${key}"?`)) return;

        try {
            await api.deleteEnvVar(appId, key);
            toast.success('Environment variable deleted');
            loadEnvVars();
        } catch (err) {
            toast.error(err.message || 'Failed to delete environment variable');
        }
    }

    async function handleToggleSecret(envVar) {
        try {
            await api.updateEnvVar(appId, envVar.key, { is_secret: !envVar.is_secret });
            loadEnvVars();
        } catch (err) {
            toast.error('Failed to update');
        }
    }

    function toggleShowValue(id) {
        setShowValues(prev => ({ ...prev, [id]: !prev[id] }));
    }

    function startEditing(envVar) {
        setEditingId(envVar.id);
        setEditValue(envVar.value);
    }

    function cancelEditing() {
        setEditingId(null);
        setEditValue('');
    }

    async function handleExport(includeSecrets = true) {
        try {
            const data = await api.exportEnvFile(appId, includeSecrets);
            // Download as file
            const blob = new Blob([data.content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = data.filename || 'app.env';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast.success('Environment file exported');
        } catch (err) {
            toast.error('Failed to export');
        }
    }

    async function handleImport() {
        if (!importContent.trim()) {
            toast.error('Please paste .env content');
            return;
        }

        setSaving(true);
        try {
            const result = await api.importEnvFile(appId, importContent, importOverwrite);
            toast.success(`${result.count} variables imported`);
            setShowImportModal(false);
            setImportContent('');
            loadEnvVars();
        } catch (err) {
            toast.error(err.message || 'Failed to import');
        } finally {
            setSaving(false);
        }
    }

    function handleFileUpload(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            setImportContent(event.target.result);
        };
        reader.readAsText(file);
    }

    async function handleShowHistory() {
        try {
            const data = await api.getEnvVarHistory(appId);
            setHistory(data.history || []);
            setShowHistoryModal(true);
        } catch (err) {
            toast.error('Failed to load history');
        }
    }

    async function handleClearAll() {
        if (!confirm('Delete ALL environment variables? This cannot be undone.')) return;
        if (!confirm('Are you absolutely sure?')) return;

        try {
            await api.clearEnvVars(appId);
            toast.success('All environment variables cleared');
            loadEnvVars();
        } catch (err) {
            toast.error('Failed to clear');
        }
    }

    function copyToClipboard(value) {
        navigator.clipboard.writeText(value);
        toast.success('Copied to clipboard');
    }

    // Filter env vars
    const filteredEnvVars = filter
        ? envVars.filter(ev =>
            ev.key.toLowerCase().includes(filter.toLowerCase()) ||
            (ev.description && ev.description.toLowerCase().includes(filter.toLowerCase()))
          )
        : envVars;

    if (loading) {
        return <div className="loading">Loading environment variables...</div>;
    }

    return (
        <div className="env-vars-container">
            <div className="section-header">
                <h3>Environment Variables</h3>
                <div className="header-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => setShowImportModal(true)}>
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
                        </svg>
                        Import
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => handleExport(true)}>
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                        </svg>
                        Export
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={handleShowHistory}>
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        History
                    </button>
                </div>
            </div>

            <p className="hint">
                Environment variables are encrypted at rest. Changes require app restart to take effect.
            </p>

            {/* Add new variable form */}
            <form className="env-add-form" onSubmit={handleAdd}>
                <div className="env-form-row">
                    <input
                        type="text"
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                        placeholder="KEY_NAME"
                        className="env-key-input"
                    />
                    <input
                        type={newIsSecret ? 'password' : 'text'}
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        placeholder="value"
                        className="env-value-input"
                    />
                    <label className="env-secret-toggle" title="Mark as secret">
                        <input
                            type="checkbox"
                            checked={newIsSecret}
                            onChange={(e) => setNewIsSecret(e.target.checked)}
                        />
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                    </label>
                    <button type="submit" className="btn btn-primary" disabled={saving}>
                        Add
                    </button>
                </div>
                <input
                    type="text"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Optional description..."
                    className="env-description-input"
                />
            </form>

            {/* Filter */}
            {envVars.length > 5 && (
                <div className="env-filter">
                    <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Filter variables..."
                    />
                    {filter && (
                        <button className="filter-clear" onClick={() => setFilter('')}>&times;</button>
                    )}
                </div>
            )}

            {/* Variables list */}
            {filteredEnvVars.length === 0 ? (
                <div className="env-empty">
                    {filter ? 'No matching variables' : 'No environment variables defined yet'}
                </div>
            ) : (
                <div className="env-list">
                    {filteredEnvVars.map(envVar => (
                        <div key={envVar.id} className={`env-item ${envVar.is_secret ? 'is-secret' : ''}`}>
                            <div className="env-item-header">
                                <span className="env-key">
                                    {envVar.key}
                                    {envVar.is_secret && (
                                        <span className="secret-badge" title="Secret value">
                                            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" fill="none" strokeWidth="2">
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                            </svg>
                                        </span>
                                    )}
                                </span>
                                <div className="env-item-actions">
                                    <button
                                        className="btn-icon"
                                        onClick={() => toggleShowValue(envVar.id)}
                                        title={showValues[envVar.id] ? 'Hide value' : 'Show value'}
                                    >
                                        {showValues[envVar.id] ? (
                                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                                                <line x1="1" y1="1" x2="23" y2="23"/>
                                            </svg>
                                        ) : (
                                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                                                <circle cx="12" cy="12" r="3"/>
                                            </svg>
                                        )}
                                    </button>
                                    <button
                                        className="btn-icon"
                                        onClick={() => copyToClipboard(envVar.value)}
                                        title="Copy value"
                                    >
                                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                        </svg>
                                    </button>
                                    <button
                                        className="btn-icon"
                                        onClick={() => startEditing(envVar)}
                                        title="Edit"
                                    >
                                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                        </svg>
                                    </button>
                                    <button
                                        className="btn-icon"
                                        onClick={() => handleToggleSecret(envVar)}
                                        title={envVar.is_secret ? 'Mark as non-secret' : 'Mark as secret'}
                                    >
                                        {envVar.is_secret ? (
                                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                                <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                                            </svg>
                                        ) : (
                                            <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                                                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                                            </svg>
                                        )}
                                    </button>
                                    <button
                                        className="btn-icon btn-danger"
                                        onClick={() => handleDelete(envVar.key)}
                                        title="Delete"
                                    >
                                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                            <polyline points="3 6 5 6 21 6"/>
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>

                            {editingId === envVar.id ? (
                                <div className="env-edit-row">
                                    <input
                                        type="text"
                                        value={editValue}
                                        onChange={(e) => setEditValue(e.target.value)}
                                        autoFocus
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleUpdate(envVar.key);
                                            if (e.key === 'Escape') cancelEditing();
                                        }}
                                    />
                                    <button className="btn btn-primary btn-sm" onClick={() => handleUpdate(envVar.key)}>
                                        Save
                                    </button>
                                    <button className="btn btn-secondary btn-sm" onClick={cancelEditing}>
                                        Cancel
                                    </button>
                                </div>
                            ) : (
                                <div className="env-value">
                                    {showValues[envVar.id] ? envVar.value : '••••••••••••'}
                                </div>
                            )}

                            {envVar.description && (
                                <div className="env-description">{envVar.description}</div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Footer actions */}
            {envVars.length > 0 && (
                <div className="env-footer">
                    <span className="env-count">{envVars.length} variable{envVars.length !== 1 ? 's' : ''}</span>
                    <button className="btn btn-danger btn-sm" onClick={handleClearAll}>
                        Clear All
                    </button>
                </div>
            )}

            {/* Import Modal */}
            {showImportModal && (
                <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Import Environment Variables</h2>
                            <button className="modal-close" onClick={() => setShowImportModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <p className="hint">Paste your .env file content below or upload a file.</p>

                            <div className="import-file-upload">
                                <input
                                    type="file"
                                    ref={fileInputRef}
                                    accept=".env,.txt"
                                    onChange={handleFileUpload}
                                    style={{ display: 'none' }}
                                />
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    Choose File
                                </button>
                            </div>

                            <textarea
                                value={importContent}
                                onChange={(e) => setImportContent(e.target.value)}
                                placeholder="DATABASE_URL=postgres://...&#10;API_KEY=your-api-key&#10;DEBUG=false"
                                rows={10}
                                className="import-textarea"
                            />

                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    checked={importOverwrite}
                                    onChange={(e) => setImportOverwrite(e.target.checked)}
                                />
                                <span>Overwrite existing variables with same keys</span>
                            </label>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowImportModal(false)}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={handleImport} disabled={saving}>
                                {saving ? 'Importing...' : 'Import'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* History Modal */}
            {showHistoryModal && (
                <div className="modal-overlay" onClick={() => setShowHistoryModal(false)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Change History</h2>
                            <button className="modal-close" onClick={() => setShowHistoryModal(false)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            {history.length === 0 ? (
                                <p className="hint">No changes recorded yet.</p>
                            ) : (
                                <table className="table">
                                    <thead>
                                        <tr>
                                            <th>Key</th>
                                            <th>Action</th>
                                            <th>Changed At</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {history.map((h, idx) => (
                                            <tr key={idx}>
                                                <td className="mono">{h.key}</td>
                                                <td>
                                                    <span className={`badge badge-${h.action === 'created' ? 'success' : h.action === 'deleted' ? 'danger' : 'warning'}`}>
                                                        {h.action}
                                                    </span>
                                                </td>
                                                <td>{new Date(h.changed_at).toLocaleString()}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowHistoryModal(false)}>
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default EnvironmentVariables;
