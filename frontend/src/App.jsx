import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import Applications from './pages/Applications';
import ApplicationDetail from './pages/ApplicationDetail';
import Docker from './pages/Docker';
import Databases from './pages/Databases';

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
                <Route path="domains" element={<div className="page">Domains & Sites</div>} />
                <Route path="databases" element={<Databases />} />
                <Route path="ssl" element={<div className="page">SSL Certificates</div>} />
                <Route path="docker" element={<Docker />} />
                <Route path="terminal" element={<div className="page">Terminal / Logs</div>} />
                <Route path="settings" element={<div className="page">Settings</div>} />
            </Route>
        </Routes>
    );
}

function App() {
    return (
        <Router>
            <AuthProvider>
                <AppRoutes />
            </AuthProvider>
        </Router>
    );
}

export default App;
