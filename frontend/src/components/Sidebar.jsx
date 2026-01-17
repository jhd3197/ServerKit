import React from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard, Users, Settings } from 'lucide-react';

const Sidebar = () => {
    return (
        <div className="sidebar">
            <div className="sidebar-header">Admin</div>
            <nav>
                <Link to="/" className="nav-link">
                    <LayoutDashboard size={20} />
                    Dashboard
                </Link>
                <Link to="/users" className="nav-link">
                    <Users size={20} />
                    Users
                </Link>
                <Link to="/settings" className="nav-link">
                    <Settings size={20} />
                    Settings
                </Link>
            </nav>
        </div>
    );
};

export default Sidebar;
