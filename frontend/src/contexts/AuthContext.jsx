import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        checkAuth();
    }, []);

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

    async function login(email, password) {
        const data = await api.login(email, password);
        setUser(data.user);
        return data;
    }

    async function register(email, username, password) {
        const data = await api.register(email, username, password);
        setUser(data.user);
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
        loading,
        login,
        register,
        logout,
        updateUser,
        refreshUser,
        isAuthenticated: !!user,
        isAdmin: user?.role === 'admin',
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
