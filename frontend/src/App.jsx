import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ToastContainer } from './components/Toast';
import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
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
import PHP from './pages/PHP';
import Firewall from './pages/Firewall';
import CronJobs from './pages/CronJobs';
import Security from './pages/Security';

function PrivateRoute({ children }) {
    const { isAuthenticated, loading } = useAuth();

    if (loading) {
        return <div className="loading">Loading...</div>;
    }

    return isAuthenticated ? children : <Navigate to="/login" />;
}

function PublicRoute({ children }) {
    const { isAuthenticated, loading } = useAuth();

    if (loading) {
        return <div className="loading">Loading...</div>;
    }

    return isAuthenticated ? <Navigate to="/" /> : children;
}

function AppRoutes() {
    return (
        <Routes>
            <Route path="/login" element={
                <PublicRoute>
                    <Login />
                </PublicRoute>
            } />
            <Route path="/register" element={
                <PublicRoute>
                    <Register />
                </PublicRoute>
            } />
            <Route path="/" element={
                <PrivateRoute>
                    <DashboardLayout />
                </PrivateRoute>
            }>
                <Route index element={<Dashboard />} />
                <Route path="apps" element={<Applications />} />
                <Route path="apps/:id" element={<ApplicationDetail />} />
                <Route path="domains" element={<Domains />} />
                <Route path="databases" element={<Databases />} />
                <Route path="ssl" element={<div className="page">SSL Certificates</div>} />
                <Route path="docker" element={<Docker />} />
                <Route path="php" element={<PHP />} />
                <Route path="firewall" element={<Firewall />} />
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
