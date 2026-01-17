import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Sidebar = () => {
    const { user, logout } = useAuth();

    return (
        <aside className="sidebar">
            <div className="brand">
                <div className="brand-logo">
                    <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" fill="none" strokeWidth="2">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                </div>
                ServerKit
            </div>

            <div className="menu-label">Overview</div>
            <nav className="nav">
                <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
                    <svg viewBox="0 0 24 24">
                        <rect x="3" y="3" width="7" height="7"/>
                        <rect x="14" y="3" width="7" height="7"/>
                        <rect x="14" y="14" width="7" height="7"/>
                        <rect x="3" y="14" width="7" height="7"/>
                    </svg>
                    Dashboard
                </NavLink>
            </nav>

            <div className="menu-label">Infrastructure</div>
            <nav className="nav">
                <NavLink to="/domains" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10"/>
                        <line x1="2" y1="12" x2="22" y2="12"/>
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    </svg>
                    Domains & Sites
                </NavLink>
                <NavLink to="/apps" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                        <line x1="12" y1="22.08" x2="12" y2="12"/>
                    </svg>
                    Applications
                </NavLink>
                <NavLink to="/databases" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24">
                        <ellipse cx="12" cy="5" rx="9" ry="3"/>
                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                    </svg>
                    Databases
                </NavLink>
                <NavLink to="/ssl" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                    </svg>
                    SSL Certificates
                </NavLink>
                <NavLink to="/docker" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24">
                        <rect x="2" y="7" width="6" height="6" rx="1"/>
                        <rect x="9" y="7" width="6" height="6" rx="1"/>
                        <rect x="16" y="7" width="6" height="6" rx="1"/>
                        <rect x="2" y="14" width="6" height="6" rx="1"/>
                        <rect x="9" y="14" width="6" height="6" rx="1"/>
                    </svg>
                    Docker
                </NavLink>
            </nav>

            <div className="menu-label">Operations</div>
            <nav className="nav">
                <NavLink to="/files" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    File Manager
                </NavLink>
                <NavLink to="/ftp" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    FTP Server
                </NavLink>
                <NavLink to="/monitoring" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24">
                        <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                    </svg>
                    Monitoring
                </NavLink>
                <NavLink to="/backups" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    Backups
                </NavLink>
            </nav>

            <div className="menu-label">System</div>
            <nav className="nav">
                <NavLink to="/terminal" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24">
                        <path d="M4 17l6-6-6-6M12 19h8"/>
                    </svg>
                    Terminal / Logs
                </NavLink>
                <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    <svg viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                    Settings
                </NavLink>
            </nav>

            <div className="user-profile">
                <div className="avatar">
                    {user?.username?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div style={{ flex: 1, fontSize: '13px' }}>
                    <div style={{ fontWeight: 600 }}>{user?.username || 'User'}</div>
                    <div style={{ color: 'var(--text-tertiary)' }}>{user?.role || 'user'}</div>
                </div>
                <button
                    onClick={logout}
                    style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-tertiary)',
                        padding: '4px'
                    }}
                    title="Logout"
                >
                    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" strokeWidth="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                        <polyline points="16 17 21 12 16 7"/>
                        <line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
