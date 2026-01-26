import React, { useState } from 'react';
import { X } from 'lucide-react';

const CreateSiteModal = ({ onClose, onCreate }) => {
    const [formData, setFormData] = useState({
        name: '',
        domain: '',
        adminUser: 'admin',
        adminEmail: '',
        dbName: '',
        createDatabase: true
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    function handleChange(e) {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    }

    function generateDbName(siteName) {
        return `wp_${siteName.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 20)}`;
    }

    function handleNameChange(e) {
        const name = e.target.value;
        setFormData(prev => ({
            ...prev,
            name,
            dbName: prev.dbName || generateDbName(name)
        }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await onCreate({
                name: formData.name,
                domain: formData.domain,
                admin_user: formData.adminUser,
                admin_email: formData.adminEmail,
                db_name: formData.dbName,
                create_database: formData.createDatabase
            });
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to create WordPress site');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Create WordPress Site</h2>
                    <button className="modal-close" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                {error && <div className="error-message">{error}</div>}

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Site Name *</label>
                        <input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleNameChange}
                            placeholder="My WordPress Site"
                            required
                        />
                    </div>

                    <div className="form-group">
                        <label>Domain</label>
                        <input
                            type="text"
                            name="domain"
                            value={formData.domain}
                            onChange={handleChange}
                            placeholder="example.com"
                        />
                        <span className="form-hint">Leave empty to use a local development URL</span>
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label>Admin Username *</label>
                            <input
                                type="text"
                                name="adminUser"
                                value={formData.adminUser}
                                onChange={handleChange}
                                placeholder="admin"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label>Admin Email *</label>
                            <input
                                type="email"
                                name="adminEmail"
                                value={formData.adminEmail}
                                onChange={handleChange}
                                placeholder="admin@example.com"
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Database Name</label>
                        <input
                            type="text"
                            name="dbName"
                            value={formData.dbName}
                            onChange={handleChange}
                            placeholder="wp_mysite"
                        />
                    </div>

                    <div className="form-group">
                        <label className="checkbox-label">
                            <input
                                type="checkbox"
                                name="createDatabase"
                                checked={formData.createDatabase}
                                onChange={handleChange}
                            />
                            <span>Create database automatically</span>
                        </label>
                    </div>

                    <div className="modal-actions">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Creating...' : 'Create Site'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CreateSiteModal;
