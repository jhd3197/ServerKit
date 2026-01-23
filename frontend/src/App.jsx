import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/Toast';
import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import Setup from './pages/Setup';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import Docker from './pages/Docker';
import Databases from './pages/Databases';
import Domains from './pages/Domains';
import Monitoring from './pages/Monitoring';
import Backups from './pages/Backups';
import Terminal from './pages/Terminal';
import Settings from './pages/Settings';
import FileManager from './pages/FileManager';
import FTPServer from './pages/FTPServer';
// Firewall is now part of Security page
import Git from './pages/Git';
import CronJobs from './pages/CronJobs';
import Security from './pages/Security';
import Templates from './pages/Templates';
import WorkflowBuilder from './pages/WorkflowBuilder';
import Servers from './pages/Servers';
import ServerDetail from './pages/ServerDetail';
import Downloads from './pages/Downloads';

// Page title mapping
const PAGE_TITLES = {
    '/': 'Dashboard',
    '/login': 'Login',
    '/register': 'Register',
    '/setup': 'Setup',
    '/apps': 'Applications',
    '/templates': 'Templates',
    '/workflow': 'Workflow Builder',
    '/domains': 'Domains',
    '/databases': 'Databases',
    '/ssl': 'SSL Certificates',
    '/docker': 'Docker',
    '/servers': 'Servers',
    '/downloads': 'Downloads',
    '/git': 'Git Repositories',
    '/files': 'File Manager',
    '/ftp': 'FTP Server',
    '/monitoring': 'Monitoring',
    '/backups': 'Backups',
    '/cron': 'Cron Jobs',
    '/security': 'Security',
    '/terminal': 'Terminal',
    '/settings': 'Settings',
};

function PageTitleUpdater() {
    const location = useLocation();

    useEffect(() => {
        const path = location.pathname;
        let title = PAGE_TITLES[path];

        // Handle dynamic routes
        if (!title) {
            if (path.startsWith('/apps/')) title = 'Application Details';
            else if (path.startsWith('/servers/')) title = 'Server Details';
            else title = 'ServerKit';
        }

        document.title = title ? `${title} | ServerKit` : 'ServerKit';
    }, [location]);

    return null;
}

function PrivateRoute({ children }) {
    const { isAuthenticated, loading, needsSetup } = useAuth();

    if (loading) {
        return <div className="loading">Loading...</div>;
    }

    // If setup is needed, redirect to setup
    if (needsSetup) {
        return <Navigate to="/setup" />;
    }

    return isAuthenticated ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
    const { isAuthenticated, loading, needsSetup } = useAuth();

    if (loading) {
        return <div className="loading">Loading...</div>;
    }

    // If setup is needed, redirect to setup
    if (needsSetup) {
        return <Navigate to="/setup" />;
    }

    return isAuthenticated ? <Navigate to="/" /> : children;
}

function SetupRoute({ children }) {
    const { loading, needsSetup, isAuthenticated } = useAuth();

    if (loading) {
        return <div className="loading">Loading...</div>;
    }

    // If setup is not needed, redirect appropriately
    if (!needsSetup) {
        return isAuthenticated ? <Navigate to="/" /> : <Navigate to="/login" />;
    }

    return children;
}

function AppRoutes() {
    const { registrationEnabled } = useAuth();

    return (
        <Routes>
            <Route path="/setup" element={
                <SetupRoute>
                    <Setup />
                </SetupRoute>
            } />
            <Route path="/login" element={
                <PublicRoute>
                    <Login />
                </PublicRoute>
            } />
            {registrationEnabled && (
                <Route path="/register" element={
                    <PublicRoute>
                        <Register />
                    </PublicRoute>
                } />
            )}
            <Route path="/" element={
                <PrivateRoute>
                    <DashboardLayout />
                </PrivateRoute>
            }>
                <Route index element={<Dashboard />} />
                <Route path="apps" element={<Applications />} />
                <Route path="apps/:id" element={<ApplicationDetail />} />
                <Route path="templates" element={<Templates />} />
                <Route path="workflow" element={<WorkflowBuilder />} />
                <Route path="domains" element={<Domains />} />
                <Route path="databases" element={<Databases />} />
                <Route path="ssl" element={<div className="page">SSL Certificates</div>} />
                <Route path="docker" element={<Docker />} />
                <Route path="servers" element={<Servers />} />
                <Route path="servers/:id" element={<ServerDetail />} />
                <Route path="servers/:id/docker" element={<ServerDetail />} />
                <Route path="downloads" element={<Downloads />} />
                <Route path="firewall" element={<Navigate to="/security" replace />} />
                <Route path="git" element={<Git />} />
                <Route path="files" element={<FileManager />} />
                <Route path="ftp" element={<FTPServer />} />
                <Route path="monitoring" element={<Monitoring />} />
                <Route path="backups" element={<Backups />} />
                <Route path="cron" element={<CronJobs />} />
                <Route path="security" element={<Security />} />
                <Route path="terminal" element={<Terminal />} />
                <Route path="settings" element={<Settings />} />
            </Route>
        </Routes>
    );
}

function App() {
    return (
        <Router>
            <PageTitleUpdater />
            <AuthProvider>
                <ToastProvider>
                    <AppRoutes />
                    <ToastContainer />
                </ToastProvider>
            </AuthProvider>
        </Router>
    );
}

export default App;
