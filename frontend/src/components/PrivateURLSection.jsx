import React, { useState } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const PrivateURLSection = ({ app, onUpdate }) => {
    const toast = useToast();
    const [loading, setLoading] = useState(false);
    const [customSlug, setCustomSlug] = useState('');
    const [editMode, setEditMode] = useState(false);

    const baseUrl = window.location.origin;
    const privateUrl = app.private_slug ? `${baseUrl}/p/${app.private_slug}` : null;

    async function handleEnable(e) {
        e?.preventDefault();
        setLoading(true);
        try {
            await api.enablePrivateUrl(app.id, customSlug || undefined);
            toast.success('Private URL enabled');
            onUpdate();
            setCustomSlug('');
        } catch (error) {
            toast.error(error.message || 'Failed to enable private URL');
        } finally {
            setLoading(false);
        }
    }

    async function handleDisable() {
        if (!confirm('Disable private URL? The current slug will be released.')) return;

        setLoading(true);
        try {
            await api.disablePrivateUrl(app.id);
            toast.success('Private URL disabled');
            onUpdate();
        } catch (error) {
            toast.error(error.message || 'Failed to disable private URL');
        } finally {
            setLoading(false);
        }
    }

    async function handleRegenerate() {
        if (!confirm('Generate a new random slug? The old URL will stop working.')) return;

        setLoading(true);
        try {
            await api.regeneratePrivateUrl(app.id);
            toast.success('Private URL regenerated');
            onUpdate();
        } catch (error) {
            toast.error(error.message || 'Failed to regenerate');
        } finally {
            setLoading(false);
        }
    }

    async function handleUpdateSlug(e) {
        e?.preventDefault();
        if (!customSlug) return;

        setLoading(true);
        try {
            await api.updatePrivateUrl(app.id, customSlug);
            toast.success('Slug updated');
            onUpdate();
            setEditMode(false);
            setCustomSlug('');
        } catch (error) {
            toast.error(error.message || 'Failed to update slug');
        } finally {
            setLoading(false);
        }
    }

    function copyToClipboard() {
        navigator.clipboard.writeText(privateUrl);
        toast.success('URL copied to clipboard');
    }

    function handleSlugInput(e) {
        // Only allow lowercase letters, numbers, and hyphens
        const value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
        setCustomSlug(value);
    }

    return (
        <div className="private-url-section">
            <div className="section-header">
                <h3>
                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                    Private URL
                </h3>
            </div>

            {!app.private_url_enabled ? (
                <div className="private-url-disabled">
                    <p className="hint">
                        Enable a private, shareable URL for this application.
                        Private URLs are not publicly indexed and can be shared with specific people.
                    </p>
                    <form onSubmit={handleEnable} className="private-url-form">
                        <div className="input-group">
                            <span className="input-prefix">/p/</span>
                            <input
                                type="text"
                                value={customSlug}
                                onChange={handleSlugInput}
                                placeholder="custom-slug (optional)"
                                className="slug-input"
                                minLength={3}
                                maxLength={50}
                            />
                        </div>
                        <button
                            type="submit"
                            className="btn btn-primary"
                            disabled={loading}
                        >
                            {loading ? 'Enabling...' : 'Enable Private URL'}
                        </button>
                    </form>
                    <p className="slug-hint">
                        Leave empty to auto-generate a random slug, or enter your own custom slug.
                    </p>
                </div>
            ) : (
                <div className="private-url-enabled">
                    <div className="private-url-display">
                        <div className="url-box">
                            <span className="url-label">Your private URL:</span>
                            <code className="url-value">{privateUrl}</code>
                        </div>
                        <div className="url-actions">
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={copyToClipboard}
                                title="Copy to clipboard"
                            >
                                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                </svg>
                                Copy
                            </button>
                            <button
                                className="btn btn-secondary btn-sm"
                                onClick={handleRegenerate}
                                disabled={loading}
                                title="Generate new random slug"
                            >
                                <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
                                    <polyline points="23 4 23 10 17 10" />
                                    <polyline points="1 20 1 14 7 14" />
                                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                                </svg>
                                Regenerate
                            </button>
                        </div>
                    </div>

                    {editMode ? (
                        <form onSubmit={handleUpdateSlug} className="slug-edit-form">
                            <div className="input-group">
                                <span className="input-prefix">/p/</span>
                                <input
                                    type="text"
                                    value={customSlug}
                                    onChange={handleSlugInput}
                                    placeholder="new-slug"
                                    className="slug-input"
                                    minLength={3}
                                    maxLength={50}
                                    autoFocus
                                />
                            </div>
                            <button
                                type="submit"
                                className="btn btn-primary btn-sm"
                                disabled={loading || !customSlug}
                            >
                                Save
                            </button>
                            <button
                                type="button"
                                className="btn btn-secondary btn-sm"
                                onClick={() => {
                                    setEditMode(false);
                                    setCustomSlug('');
                                }}
                            >
                                Cancel
                            </button>
                        </form>
                    ) : (
                        <button
                            className="btn-link"
                            onClick={() => setEditMode(true)}
                        >
                            Change slug
                        </button>
                    )}

                    <div className="private-url-footer">
                        <button
                            className="btn btn-danger btn-sm"
                            onClick={handleDisable}
                            disabled={loading}
                        >
                            Disable Private URL
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PrivateURLSection;
