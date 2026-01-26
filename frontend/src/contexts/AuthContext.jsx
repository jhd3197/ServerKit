import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [setupStatus, setSetupStatus] = useState({
        needsSetup: false,
        registrationEnabled: false,
        checked: false
    });

    useEffect(() => {
        checkSetupStatus();
    }, []);

    async function checkSetupStatus() {
        try {
            const status = await api.getSetupStatus();
            setSetupStatus({
                needsSetup: status.needs_setup,
                registrationEnabled: status.registration_enabled,
                checked: true
            });

            // If setup is complete, check authentication
            if (!status.needs_setup) {
                await checkAuth();
            } else {
                setLoading(false);
            }
        } catch (error) {
            console.error('Setup status check failed:', error);
            // Fallback to checking auth directly
            await checkAuth();
        }
    }

    async function checkAuth() {
        const token = localStorage.getItem('access_token');
        if (token) {
            try {
                const data = await api.getCurrentUser();
                setUser(data.user);
            } catch (error) {
                console.error('Auth check failed:', error);
                api.clearTokens();
            }
        }
        setLoading(false);
    }

    async function refreshSetupStatus() {
        try {
            const status = await api.getSetupStatus();
            setSetupStatus({
                needsSetup: status.needs_setup,
                registrationEnabled: status.registration_enabled,
                checked: true
            });
        } catch (error) {
            console.error('Failed to refresh setup status:', error);
        }
    }

    async function login(email, password) {
        const data = await api.login(email, password);
        setUser(data.user);
        return data;
    }

    async function register(email, username, password) {
        const data = await api.register(email, username, password);
        setUser(data.user);
        // After first registration, setup is complete - update status
        setSetupStatus({
            needsSetup: false,
            registrationEnabled: false,
            checked: true
        });
        return data;
    }

    function logout() {
        api.logout();
        setUser(null);
    }

    async function updateUser(data) {
        const response = await api.updateCurrentUser(data);
        setUser(response.user);
        return response;
    }

    async function refreshUser() {
        const data = await api.getCurrentUser();
        setUser(data.user);
        return data.user;
    }

    const value = {
        user,
        setUser,
        loading,
        login,
        register,
        logout,
        updateUser,
        refreshUser,
        refreshSetupStatus,
        isAuthenticated: !!user,
        isAdmin: user?.role === 'admin',
        isDeveloper: user?.role === 'admin' || user?.role === 'developer',
        isViewer: !!user?.role,
        setupStatus,
        needsSetup: setupStatus.needsSetup,
        registrationEnabled: setupStatus.registrationEnabled,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
