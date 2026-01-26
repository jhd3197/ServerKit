import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

const ResourceTierContext = createContext(null);

export function ResourceTierProvider({ children }) {
    const { isAuthenticated, isAdmin } = useAuth();
    const [tierInfo, setTierInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (isAuthenticated && isAdmin) {
            fetchTierInfo();
        } else {
            setLoading(false);
        }
    }, [isAuthenticated, isAdmin]);

    async function fetchTierInfo(forceRefresh = false) {
        try {
            setLoading(true);
            setError(null);
            const endpoint = forceRefresh
                ? '/system/resource-tier?refresh=true'
                : '/system/resource-tier';
            const data = await api.request(endpoint);
            setTierInfo(data);
        } catch (err) {
            console.error('Failed to fetch resource tier:', err);
            setError(err.message || 'Failed to fetch resource tier');
        } finally {
            setLoading(false);
        }
    }

    async function refresh() {
        return fetchTierInfo(true);
    }

    const value = {
        tier: tierInfo?.tier || null,
        specs: tierInfo?.specs || null,
        features: tierInfo?.features || {},
        cached: tierInfo?.cached || false,
        loading,
        error,
        refresh,
        canCreateWordPress: tierInfo?.features?.wordpress_create ?? true,
        isLiteTier: tierInfo?.tier === 'lite',
        isStandardTier: tierInfo?.tier === 'standard',
        isPerformanceTier: tierInfo?.tier === 'performance',
    };

    return (
        <ResourceTierContext.Provider value={value}>
            {children}
        </ResourceTierContext.Provider>
    );
}

export function useResourceTier() {
    const context = useContext(ResourceTierContext);
    if (!context) {
        throw new Error('useResourceTier must be used within a ResourceTierProvider');
    }
    return context;
}
