import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard';

function App() {
    return (
        <Router>
            <Routes>
                <Route path="/" element={<DashboardLayout />}>
                    <Route index element={<Dashboard />} />
                    <Route path="users" element={<div>Users Page</div>} />
                    <Route path="settings" element={<div>Settings Page</div>} />
                </Route>
            </Routes>
        </Router>
    );
}

export default App;
