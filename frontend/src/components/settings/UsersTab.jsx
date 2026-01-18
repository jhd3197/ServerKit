import React, { useState, useEffect } from 'react';
import api from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';
import UserModal from './UserModal';

const UsersTab = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showModal, setShowModal] = useState(false);
    const [editingUser, setEditingUser] = useState(null);
    const [deleteConfirm, setDeleteConfirm] = useState(null);
    const { user: currentUser } = useAuth();

    useEffect(() => {
        loadUsers();
    }, []);

    async function loadUsers() {
        try {
            setLoading(true);
            const data = await api.getUsers();
            setUsers(data.users);
            setError('');
        } catch (err) {
            setError(err.message || 'Failed to load users');
        } finally {
            setLoading(false);
        }
    }

    function handleAddUser() {
        setEditingUser(null);
        setShowModal(true);
    }

    function handleEditUser(user) {
        setEditingUser(user);
        setShowModal(true);
    }

    function handleCloseModal() {
        setShowModal(false);
        setEditingUser(null);
    }

    async function handleSaveUser(userData) {
        try {
            if (editingUser) {
                await api.updateUser(editingUser.id, userData);
            } else {
                await api.createUser(userData);
            }
            await loadUsers();
            handleCloseModal();
        } catch (err) {
            throw err;
        }
    }

    async function handleDeleteUser(user) {
        try {
            await api.deleteUser(user.id);
            setDeleteConfirm(null);
            await loadUsers();
        } catch (err) {
            setError(err.message || 'Failed to delete user');
        }
    }

    async function handleToggleActive(user) {
        try {
            await api.updateUser(user.id, { is_active: !user.is_active });
            await loadUsers();
        } catch (err) {
            setError(err.message || 'Failed to update user status');
        }
    }

    function getRoleBadgeClass(role) {
        switch (role) {
            case 'admin':
                return 'badge-danger';
            case 'developer':
                return 'badge-primary';
            case 'viewer':
                return 'badge-secondary';
            default:
                return 'badge-secondary';
        }
    }

    function formatDate(dateString) {
        if (!dateString) return 'Never';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    if (loading) {
        return (
            <div className="users-tab">
                <div className="loading-state">Loading users...</div>
            </div>
        );
    }

    return (
        <div className="users-tab">
            <div className="tab-header">
                <div className="tab-header-content">
                    <h3>User Management</h3>
                    <p>Manage user accounts and permissions</p>
                </div>
                <button className="btn btn-primary" onClick={handleAddUser}>
                    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Add User
                </button>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="users-table-container">
                <table className="users-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Role</th>
                            <th>Status</th>
                            <th>Last Login</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map(user => (
                            <tr key={user.id} className={!user.is_active ? 'inactive' : ''}>
                                <td className="user-info">
                                    <div className="user-avatar">
                                        {user.username.charAt(0).toUpperCase()}
                                    </div>
                                    <div className="user-details">
                                        <span className="username">
                                            {user.username}
                                            {user.id === currentUser?.id && (
                                                <span className="you-badge">You</span>
                                            )}
                                        </span>
                                        <span className="email">{user.email}</span>
                                    </div>
                                </td>
                                <td>
                                    <span className={`badge ${getRoleBadgeClass(user.role)}`}>
                                        {user.role}
                                    </span>
                                </td>
                                <td>
                                    <span className={`status-badge ${user.is_active ? 'active' : 'inactive'}`}>
                                        {user.is_active ? 'Active' : 'Disabled'}
                                    </span>
                                </td>
                                <td className="date-cell">{formatDate(user.last_login_at)}</td>
                                <td className="date-cell">{formatDate(user.created_at)}</td>
                                <td className="actions-cell">
                                    <button
                                        className="btn btn-sm btn-ghost"
                                        onClick={() => handleEditUser(user)}
                                        title="Edit user"
                                    >
                                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                        </svg>
                                    </button>
                                    {user.id !== currentUser?.id && (
                                        <>
                                            <button
                                                className={`btn btn-sm btn-ghost ${user.is_active ? 'text-warning' : 'text-success'}`}
                                                onClick={() => handleToggleActive(user)}
                                                title={user.is_active ? 'Disable user' : 'Enable user'}
                                            >
                                                {user.is_active ? (
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
                                                className="btn btn-sm btn-ghost text-danger"
                                                onClick={() => setDeleteConfirm(user)}
                                                title="Delete user"
                                            >
                                                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                                                    <polyline points="3 6 5 6 21 6"/>
                                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                                </svg>
                                            </button>
                                        </>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {showModal && (
                <UserModal
                    user={editingUser}
                    onSave={handleSaveUser}
                    onClose={handleCloseModal}
                />
            )}

            {deleteConfirm && (
                <div className="modal-overlay">
                    <div className="modal modal-sm">
                        <div className="modal-header">
                            <h3>Delete User</h3>
                            <button className="modal-close" onClick={() => setDeleteConfirm(null)}>
                                <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                                    <line x1="18" y1="6" x2="6" y2="18"/>
                                    <line x1="6" y1="6" x2="18" y2="18"/>
                                </svg>
                            </button>
                        </div>
                        <div className="modal-body">
                            <p>Are you sure you want to delete <strong>{deleteConfirm.username}</strong>?</p>
                            <p className="text-muted">This action cannot be undone.</p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-ghost" onClick={() => setDeleteConfirm(null)}>
                                Cancel
                            </button>
                            <button className="btn btn-danger" onClick={() => handleDeleteUser(deleteConfirm)}>
                                Delete User
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default UsersTab;
