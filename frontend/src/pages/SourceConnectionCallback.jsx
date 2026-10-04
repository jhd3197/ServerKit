import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Github, Gitlab, GitBranch, Loader2 } from 'lucide-react';
import { SiBitbucket } from 'react-icons/si';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

const PROVIDER_LABELS = {
    github: 'GitHub',
    gitlab: 'GitLab',
    bitbucket: 'Bitbucket',
};

const PROVIDER_ICONS = {
    github: Github,
    gitlab: Gitlab,
    bitbucket: SiBitbucket,
};

const SourceConnectionCallback = () => {
    const { t } = useTranslation();
    const { provider } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const toast = useToast();
    const [error, setError] = useState('');
    const didComplete = useRef(false);

    const label = PROVIDER_LABELS[provider] || provider;
    const Icon = PROVIDER_ICONS[provider] || GitBranch;

    useEffect(() => {
        if (didComplete.current) return;
        didComplete.current = true;

        async function completeConnection() {
            const code = searchParams.get('code');
            const state = searchParams.get('state');
            const redirectUri = `${window.location.origin}/connections/callback/${provider}`;
            const returnTo = sessionStorage.getItem('sourceConnectionReturnTo') || '/settings/connections';

            if (!code || !state) {
                setError(`${label} did not return a valid authorization response.`);
                return;
            }

            try {
                await api.completeSourceConnection(provider, code, state, redirectUri);
                sessionStorage.removeItem('sourceConnectionReturnTo');
                toast.success(`${label} connected`);
                navigate(returnTo, { replace: true });
            } catch (err) {
                setError(err.message || `Failed to connect ${label}`);
            }
        }

        completeConnection();
    }, [navigate, provider, searchParams, toast, label]);

    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-logo">
                    <Icon size={32} />
                </div>
                <h1>{t('app.sourceConnectionCallback.connecting', 'Connecting')} {label}</h1>
                {error ? (
                    <>
                        <p className="auth-error">{error}</p>
                        <SharedButton variant="primary" type="button" className="btn btn-primary" onClick={() => navigate('/settings/connections')}>
                            {t('app.sourceConnectionCallback.backToConnections', 'Back to connections')}
                        </SharedButton>
                    </>
                ) : (
                    <div className="sso-loading">
                        <Loader2 size={24} className="spinning" />
                        <p>{t('app.sourceConnectionCallback.finishingProviderAuthorization', 'Finishing provider authorization…')}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SourceConnectionCallback;
