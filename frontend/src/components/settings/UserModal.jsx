import React, { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const UserModal = ({ user, onSave, onClose }) => {
    const [formData, setFormData] = useState({
        email: '',
        username: '',
        password: '',
        confirmPassword: '',
        role: 'developer',
        is_active: true
    });
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { user: currentUser } = useAuth();

    const isEditing = !!user;
    const isSelf = user?.id === currentUser?.id;

    useEffect(() => {
        if (user) {
            setFormData({
                email: user.email || '',
                username: user.username || '',
                password: '',
                confirmPassword: '',
                role: user.role || 'developer',
                is_active: user.is_active !== false
            });
        }
    }, [user]);

    function handleChange(e) {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');

        // Validation
        if (!formData.email || !formData.username) {
            setError('Email and username are required');
            return;
        }

        if (!isEditing && !formData.password) {
            setError('Password is required for new users');
            return;
        }

        if (formData.password && formData.password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        if (formData.password && formData.password !== formData.confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        setLoading(true);

        try {
            const userData = {
                email: formData.email,
                username: formData.username,
                role: formData.role,
                is_active: formData.is_active
            };

            // Only include password if it's been set
            if (formData.password) {
                userData.password = formData.password;
            }

            await onSave(userData);
        } catch (err) {
            setError(err.message || 'Failed to save user');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay">
            <div className="modal modal-md">
                <div className="modal-header">
                    <h3>{isEditing ? 'Edit User' : 'Add New User'}</h3>
                    <button className="modal-close" onClick={onClose}>
                        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="modal-body">
                        {error && <div className="error-message">{error}</div>}

                        <div className="form-group">
                            <label htmlFor="email">Email</label>
                            <input
                                type="email"
                                id="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                placeholder="user@example.com"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="username">Username</label>
                            <input
                                type="text"
                                id="username"
                                name="username"
                                value={formData.username}
                                onChange={handleChange}
                                placeholder="Enter username"
                                required
                            />
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <label htmlFor="password">
                                    {isEditing ? 'New Password (leave blank to keep current)' : 'Password'}
                                </label>
                                <input
                                    type="password"
                                    id="password"
                                    name="password"
                                    value={formData.password}
                                    onChange={handleChange}
                                    placeholder={isEditing ? 'Leave blank to keep current' : 'At least 8 characters'}
                                    required={!isEditing}
                                />
                            </div>

                            <div className="form-group">
                                <label htmlFor="confirmPassword">Confirm Password</label>
                                <input
                                    type="password"
                                    id="confirmPassword"
                                    name="confirmPassword"
                                    value={formData.confirmPassword}
                                    onChange={handleChange}
                                    placeholder="Confirm password"
                                    required={!!formData.password}
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="role">Role</label>
                            <select
                                id="role"
                                name="role"
                                value={formData.role}
                                onChange={handleChange}
                                disabled={isSelf}
                            >
                                <option value="admin">Admin - Full access</option>
                                <option value="developer">Developer - Manage apps and deployments</option>
                                <option value="viewer">Viewer - Read-only access</option>
                            </select>
                            {isSelf && (
                                <span className="form-help">You cannot change your own role</span>
                            )}
                        </div>

                        <div className="form-group">
                            <label className="checkbox-label">
                                <input
                                    type="checkbox"
                                    name="is_active"
                                    checked={formData.is_active}
                                    onChange={handleChange}
                                    disabled={isSelf}
                                />
                                <span className="checkbox-text">Account is active</span>
                            </label>
                            {isSelf && (
                                <span className="form-help">You cannot deactivate your own account</span>
                            )}
                        </div>

                        <div className="role-descriptions">
                            <h4>Role Permissions</h4>
                            <div className="role-item">
                                <span className="role-name">Admin</span>
                                <span className="role-desc">Full system access including user management and settings</span>
                            </div>
                            <div className="role-item">
                                <span className="role-name">Developer</span>
                                <span className="role-desc">Manage applications, deployments, databases, and domains</span>
                            </div>
                            <div className="role-item">
                                <span className="role-name">Viewer</span>
                                <span className="role-desc">Read-only access to dashboards and logs</span>
                            </div>
                        </div>
                    </div>

                    <div className="modal-footer">
                        <button type="button" className="btn btn-ghost" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={loading}>
                            {loading ? 'Saving...' : (isEditing ? 'Save Changes' : 'Create User')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default UserModal;
