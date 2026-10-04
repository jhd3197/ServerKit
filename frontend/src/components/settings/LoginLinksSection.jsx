import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import CopyField from '../CopyField';
import { useTranslation } from 'react-i18next';

const TTL_OPTIONS = [15, 30, 60];

/**
 * Admin card for one-time login links: mint a single-use, short-lived
 * sign-in URL (optionally IP-bound), reveal it once, list + revoke.
 */
const LoginLinksSection = ({ users, currentUserId }) => {
    const { t } = useTranslation();
    const [links, setLinks] = useState([]);
    const [error, setError] = useState('');
    const [minting, setMinting] = useState(false);

    // Mint form
    const [userId, setUserId] = useState(currentUserId || '');
    const [ttl, setTtl] = useState(15);
    const [bindIp, setBindIp] = useState(false);
    const [boundIp, setBoundIp] = useState('');

    // Reveal-once state
    const [minted, setMinted] = useState(null);

    const loadLinks = useCallback(async () => {
        try {
            const data = await api.getLoginLinks();
            setLinks(data.links || []);
        } catch (err) {
            setError(err.message || 'Failed to load sign-in links');
        }
    }, []);

    useEffect(() => {
        loadLinks();
    }, [loadLinks]);

    useEffect(() => {
        if (currentUserId && !userId) setUserId(currentUserId);
    }, [currentUserId, userId]);

    async function handleMint(e) {
        e.preventDefault();
        setError('');
        setMinting(true);
        setMinted(null);
        try {
            const body = { user_id: Number(userId), ttl_minutes: ttl };
            if (bindIp && boundIp.trim()) body.bound_ip = boundIp.trim();
            const res = await api.mintLoginLink(body);
            setMinted({
                url: `${window.location.origin}${res.url}`,
                expiresAt: res.expires_at,
            });
            await loadLinks();
        } catch (err) {
            setError(err.message || 'Failed to create sign-in link');
        } finally {
            setMinting(false);
        }
    }

    async function handleRevoke(id) {
        setError('');
        try {
            await api.revokeLoginLink(id);
            await loadLinks();
        } catch (err) {
            setError(err.message || 'Failed to revoke sign-in link');
        }
    }

    function formatExpiry(dateString) {
        if (!dateString) return '—';
        return new Date(`${dateString}Z`).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    return (
        <div className="login-links">
            <div className="tab-header">
                <div className="tab-header-content">
                    <h3>{t('app.loginLinksSection.oneTimeLoginLinks', 'One-time sign-in links')}</h3>
                    <p>
                        {t('app.loginLinksSection.mintASingleUseSignIn', 'Mint a single-use sign-in URL for a user. The link is shown once, expires automatically, and can be bound to one IP.')}
                    </p>
                </div>
            </div>

            {error && <div className="error-message">{error}</div>}

            <form className="login-links__form" onSubmit={handleMint}>
                <label className="login-links__field">
                    <span>{t('common.labels.user', 'User')}</span>
                    <Select value={userId === '' || userId == null ? undefined : String(userId)} onValueChange={setUserId}>
                        <SelectTrigger aria-label={t('common.labels.user', 'User')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {(users || []).map((u) => (
                                <SelectItem key={u.id} value={String(u.id)}>
                                    {u.username}{u.id === currentUserId ? ' (you)' : ''}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </label>

                <label className="login-links__field">
                    <span>{t('app.loginLinksSection.expiresIn', 'Expires in')}</span>
                    <Select value={String(ttl)} onValueChange={(value) => setTtl(Number(value))}>
                        <SelectTrigger aria-label={t('app.loginLinksSection.expiresIn', 'Expires in')}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {TTL_OPTIONS.map((minutes) => (
                                <SelectItem key={minutes} value={String(minutes)}>{minutes} minutes</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </label>

                <label className="login-links__bind">
                    <input
                        type="checkbox"
                        checked={bindIp}
                        onChange={(e) => setBindIp(e.target.checked)}
                    />
                    <span>{t('app.loginLinksSection.bindToAnIp', 'Bind to an IP')}</span>
                </label>

                {bindIp && (
                    <label className="login-links__field">
                        <span>{t('app.loginLinksSection.allowedIp', 'Allowed IP')}</span>
                        <input
                            type="text"
                            value={boundIp}
                            onChange={(e) => setBoundIp(e.target.value)}
                            placeholder={t('app.loginLinksSection.eG20301137', 'e.g. 203.0.113.7')}
                        />
                    </label>
                )}

                <Button type="submit" variant="secondary" disabled={minting || !userId}>
                    {minting ? t('app.loginLinksSection.generating', 'Generating…') : t('app.loginLinksSection.generateLink', 'Generate link')}
                </Button>
            </form>

            {bindIp && (
                <p className="login-links__note">
                    {t('app.loginLinksSection.theLinkWillOnlyWorkFrom', "The link will only work from the IP entered above. Use the recipient's public IP, not your own.")}
                </p>
            )}

            {minted && (
                <div className="login-links__reveal">
                    <p className="login-links__reveal-title">
                        {t('app.loginLinksSection.copyThisUrlNowItWill', 'Copy this URL now. It will not be shown again.')}
                    </p>
                    <CopyField value={minted.url} />
                </div>
            )}

            {links.length > 0 && (
                <ul className="login-links__list">
                    {links.map((link) => (
                        <li key={link.id} className="login-links__item">
                            <div className="login-links__item-info">
                                <span className="login-links__item-user">{link.username}</span>
                                <span className="login-links__item-meta">
                                    expires {formatExpiry(link.expires_at)}
                                    {link.bound_ip ? ` · bound to ${link.bound_ip}` : ''}
                                    {link.created_by ? ` · by ${link.created_by}` : ''}
                                </span>
                            </div>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRevoke(link.id)}
                            >
                                {t('app.loginLinksSection.revoke', 'Revoke')}
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default LoginLinksSection;
