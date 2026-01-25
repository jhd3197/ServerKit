import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Github, Star } from 'lucide-react';

const Sidebar = () => {
    const { user, logout } = useAuth();

    return (
        <aside className="sidebar">
            <div className="brand-section">
                <div className="brand-logo">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2.5">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                    </svg>
                </div>
                <span className="brand-text">ServerKit</span>
            </div>

            <div className="nav-scroll">
                <div className="nav-category">Overview</div>
                <nav className="nav">
                    <NavLink to="/" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} end>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <rect x="3" y="3" width="7" height="7"/>
                            <rect x="14" y="3" width="7" height="7"/>
                            <rect x="14" y="14" width="7" height="7"/>
                            <rect x="3" y="14" width="7" height="7"/>
                        </svg>
                        Dashboard
                    </NavLink>
                </nav>

                <div className="nav-category">Infrastructure</div>
                <nav className="nav">
                    <NavLink to="/servers" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
                            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
                            <line x1="6" y1="6" x2="6.01" y2="6"/>
                            <line x1="6" y1="18" x2="6.01" y2="18"/>
                        </svg>
                        Servers
                    </NavLink>
                    <NavLink to="/domains" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="2" y1="12" x2="22" y2="12"/>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                        </svg>
                        Domains & Sites
                    </NavLink>
                    <NavLink to="/apps" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                            <line x1="12" y1="22.08" x2="12" y2="12"/>
                        </svg>
                        Applications
                    </NavLink>
                    <NavLink to="/wordpress" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                            <path d="M3.5 9h17M3.5 15h17"/>
                        </svg>
                        WordPress
                    </NavLink>
                    <NavLink to="/templates" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <rect x="3" y="3" width="7" height="9"/>
                            <rect x="14" y="3" width="7" height="5"/>
                            <rect x="14" y="12" width="7" height="9"/>
                            <rect x="3" y="16" width="7" height="5"/>
                        </svg>
                        Templates
                    </NavLink>
                    <NavLink to="/workflow" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <circle cx="18" cy="5" r="3"/>
                            <circle cx="6" cy="12" r="3"/>
                            <circle cx="18" cy="19" r="3"/>
                            <path d="M8.59 13.51l6.83 3.98"/>
                            <path d="M15.41 6.51l-6.82 3.98"/>
                        </svg>
                        Workflow Builder
                    </NavLink>
                    <NavLink to="/databases" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <ellipse cx="12" cy="5" rx="9" ry="3"/>
                            <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                            <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                        </svg>
                        Databases
                    </NavLink>
                    <NavLink to="/ssl" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                        SSL Certificates
                    </NavLink>
                    <NavLink to="/docker" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <rect x="2" y="7" width="6" height="6" rx="1"/>
                            <rect x="9" y="7" width="6" height="6" rx="1"/>
                            <rect x="16" y="7" width="6" height="6" rx="1"/>
                            <rect x="2" y="14" width="6" height="6" rx="1"/>
                            <rect x="9" y="14" width="6" height="6" rx="1"/>
                        </svg>
                        Docker
                    </NavLink>
                    <NavLink to="/git" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <circle cx="18" cy="18" r="3"/>
                            <circle cx="6" cy="6" r="3"/>
                            <path d="M6 21V9a9 9 0 0 0 9 9"/>
                        </svg>
                        Git
                    </NavLink>
                </nav>

                <div className="nav-category">Operations</div>
                <nav className="nav">
                    <NavLink to="/files" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        File Manager
                    </NavLink>
                    <NavLink to="/ftp" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        FTP Server
                    </NavLink>
                    <NavLink to="/monitoring" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
                        </svg>
                        Monitoring
                    </NavLink>
                    <NavLink to="/backups" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Backups
                    </NavLink>
                    <NavLink to="/cron" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        Cron Jobs
                    </NavLink>
                    <NavLink to="/security" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            <path d="M12 8v4m0 4h.01"/>
                        </svg>
                        Security
                    </NavLink>
                </nav>

                <div className="nav-category">System</div>
                <nav className="nav">
                    <NavLink to="/terminal" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M4 17l6-6-6-6M12 19h8"/>
                        </svg>
                        Terminal / Logs
                    </NavLink>
                    <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <circle cx="12" cy="12" r="3"/>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                        </svg>
                        Settings
                    </NavLink>
                    <NavLink to="/downloads" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        Downloads
                    </NavLink>
                </nav>
            </div>

            <div className="sidebar-footer">
                <a
                    href="https://github.com/jhd3197/ServerKit"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="promo-btn"
                >
                    <span className="promo-content">
                        <Github size={14} />
                        ServerKit
                    </span>
                    <span className="promo-tag"><Star size={12} /></span>
                </a>

                <div className="user-mini" onClick={logout} title="Click to logout">
                    <div className="user-avatar">
                        {user?.username?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <div className="user-meta">
                        <span className="user-handle">{user?.username || 'User'}</span>
                        <span className="user-status">Online</span>
                    </div>
                </div>
            </div>
        </aside>
    );
};

export default Sidebar;
