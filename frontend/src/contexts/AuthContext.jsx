import { useCallback, useState, useEffect } from 'react';
import api from '../services/api';
import { inTunnel, storageKey } from '../services/tunnelBase.js';
import { presetForUseCases } from '../components/sidebarItems';

import { AuthContext } from './useAuth.js';

// /auth/setup-status -> context state. One mapping for the first load and
// every refresh: two hand-kept copies had already drifted (the refresh one
// dropped defaultLanguage).
function toSetupStatus(status) {
    return {
        needsSetup: status.needs_setup,
        registrationEnabled: status.registration_enabled,
        setupCodeRequired: !!status.setup_code_required,
        ssoProviders: status.sso_providers || [],
        passwordLoginEnabled: status.password_login_enabled !== false,
        panelTitle: status.panel_title || import.meta.env.VITE_PANEL_TITLE || 'ServerKit',
        publicTitle: status.public_title || 'Control Panel',
        loginLayout: status.login_layout || 'centered',
        defaultLanguage: status.default_language || null,
        needsMigration: status.needs_migration || false,
        migrationInfo: status.migration_info || null,
        checked: true
    };
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [setupStatus, setSetupStatus] = useState({
        needsSetup: false,
        registrationEnabled: false,
        // A fresh panel's first registration needs the server's setup code.
        setupCodeRequired: false,
        ssoProviders: [],
        passwordLoginEnabled: true,
        // Build-time default until the pre-auth fetch resolves (avoids a title flash
        // for forks that brand at build time via VITE_PANEL_TITLE).
        panelTitle: import.meta.env.VITE_PANEL_TITLE || 'ServerKit',
        publicTitle: 'Control Panel',
        loginLayout: 'centered',
        // Panel-wide default language for the pre-auth screens.
        // null = not fetched yet, so the browser language does not win a race
        // against a panel that has an opinion.
        defaultLanguage: null,
        needsMigration: false,
        migrationInfo: null,
        checked: false
    });

    const checkAuth = useCallback(async () => {
        let token = localStorage.getItem(storageKey('access_token'));
        if (!token && inTunnel) {
            // Opened from ServerKit Cloud: the relay brought a grant that says
            // who is asking. If this panel has a user with that email, sign
            // them in; otherwise the normal login page shows.
            try {
                const data = await api.connectSession();
                if (data?.access_token) token = data.access_token;
            } catch {
                // No matching user, or a grant this panel does not accept.
            }
        }
        if (token) {
            try {
                const data = await api.getCurrentUser();
                setUser(data.user);
            } catch (error) {
                // Only a 401 means the session is gone. A restarting backend
                // (502, "database is locked") or a dropped connection must not
                // delete a refresh token that is still good.
                if (error.status === 401) api.clearTokens();
                else console.error('Auth check failed:', error);
            }
        }
        setLoading(false);
    }, []);

    const checkSetupStatus = useCallback(async function checkSetupStatus(retries = 3) {
        try {
            setSetupStatus(toSetupStatus(await api.getSetupStatus()));

            // Always check auth — user may be mid-onboarding wizard with valid session
            await checkAuth();
        } catch (error) {
            console.error('Setup status check failed:', error);
            // Backend may not be ready yet — retry before falling back
            if (retries > 0) {
                await new Promise(r => setTimeout(r, 2000));
                return checkSetupStatus(retries - 1);
            }
            // Exhausted retries — assume fresh install so user isn't locked out
            setSetupStatus(prev => ({
                ...prev,
                needsSetup: true,
                registrationEnabled: true,
                setupCodeRequired: true,
                checked: true
            }));
            await checkAuth();
        }
    }, [checkAuth]);

    useEffect(() => {
        checkSetupStatus();
    }, [checkSetupStatus]);

    useEffect(() => {
        const handleAuthExpired = () => setUser(null);
        window.addEventListener('serverkit:auth-expired', handleAuthExpired);
        return () => window.removeEventListener('serverkit:auth-expired', handleAuthExpired);
    }, []);


    async function refreshSetupStatus() {
        try {
            setSetupStatus(toSetupStatus(await api.getSetupStatus()));
        } catch (error) {
            console.error('Failed to refresh setup status:', error);
        }
    }

    async function login(email, password) {
        const data = await api.login(email, password);
        setUser(data.user);
        return data;
    }

    async function register(email, username, password, inviteToken, setupCode) {
        const data = await api.register(email, username, password, inviteToken, setupCode);
        setUser(data.user);
        return data;
    }

    async function completeOnboarding(useCases, installedExtensions = [], sidebarPreset = null, securityPosture = 'minimal') {
        await api.completeOnboarding(useCases, installedExtensions, securityPosture);
        // Tailor the initial sidebar so a fresh install opens focused instead of
        // showing every item. The Summary step passes an explicit profile (which
        // it pre-selects from the use cases and the user may override); fall back
        // to deriving it here for any caller that doesn't. Best-effort: if it
        // fails, the sidebar just falls back to the "Recommended" default.
        try {
            const preset = sidebarPreset || presetForUseCases(useCases);
            const sidebar_config = { preset, hiddenItems: [] };
            const res = await api.updateCurrentUser({ sidebar_config });
            if (res?.user) setUser(res.user);
        } catch {
            /* ignore — sidebar preset is a non-critical nicety */
        }
        setSetupStatus(prev => ({
            ...prev,
            needsSetup: false,
            registrationEnabled: false,
            setupCodeRequired: false,
            checked: true
        }));
    }

    async function logout() {
        try {
            await api.logout();
        } catch (err) {
            console.error('Server sign-out failed:', err);
        } finally {
            setUser(null);
        }
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

    function hasPermission(feature, level = 'read') {
        if (!user) return false;
        if (user.role === 'admin') return true;
        const perms = user.permissions || {};
        const featurePerms = perms[feature] || {};
        return !!featurePerms[level];
    }

    const value = {
        user,
        setUser,
        loading,
        login,
        register,
        completeOnboarding,
        logout,
        updateUser,
        refreshUser,
        refreshSetupStatus,
        hasPermission,
        isAuthenticated: !!user,
        isAdmin: user?.role === 'admin',
        isDeveloper: user?.role === 'admin' || user?.role === 'developer',
        isViewer: !!user?.role,
        setupStatus,
        needsSetup: setupStatus.needsSetup,
        needsMigration: setupStatus.needsMigration,
        migrationInfo: setupStatus.migrationInfo,
        registrationEnabled: setupStatus.registrationEnabled,
        setupCodeRequired: setupStatus.setupCodeRequired,
        ssoProviders: setupStatus.ssoProviders,
        passwordLoginEnabled: setupStatus.passwordLoginEnabled,
        panelTitle: setupStatus.panelTitle,
        publicTitle: setupStatus.publicTitle,
        loginLayout: setupStatus.loginLayout,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
