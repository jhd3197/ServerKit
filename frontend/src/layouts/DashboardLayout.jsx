import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';

const DashboardLayout = () => {
    return (
        <div className="dashboard-layout">
            <Sidebar />
            <main className="main-content">
                <div className="header">
                    <h2>Dashboard</h2>
                </div>
                <Outlet />
            </main>
        </div>
    );
};

export default DashboardLayout;
