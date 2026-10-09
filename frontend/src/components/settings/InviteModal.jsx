import { useState, useEffect } from 'react';
import api from '../../services/api';
import PermissionEditor from './PermissionEditor';
import Modal from '../Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import CopyField from '../CopyField';
import { useTranslation } from 'react-i18next';

const InviteModal = ({ onClose, onCreated }) => {
    const { t } = useTranslation();
    const [email, setEmail] = useState('');
    const [role, setRole] = useState('developer');
    const [expiryDays, setExpiryDays] = useState(7);
    const [showPermissions, setShowPermissions] = useState(false);
    const [permissions, setPermissions] = useState({});
    const [templates, setTemplates] = useState({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [result, setResult] = useState(null);

    useEffect(() => {
        api.getPermissionTemplates().then(data => {
            setTemplates(data.templates || {});
            if (data.templates?.developer) {
                setPermissions(data.templates.developer);
            }
        }).catch(() => {});
    }, []);

    function handleRoleChange(newRole) {
        setRole(newRole);
        if (templates[newRole]) {
            setPermissions(templates[newRole]);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const data = {
                role,
                expires_in_days: expiryDays === 0 ? null : expiryDays,
            };
            if (email.trim()) data.email = email.trim();
            if (showPermissions && role !== 'admin') {
                data.permissions = permissions;
            }

            const response = await api.createInvitation(data);
            setResult(response);
            window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
                detail: { type: 'invitation-created' },
            }));
            if (onCreated) onCreated();
        } catch (err) {
            setError(err.message || 'Failed to create invitation');
        } finally {
            setLoading(false);
        }
    }

    function signalLinkCopied() {
        window.dispatchEvent(new CustomEvent('serverkit:walkthrough-signal', {
            detail: { type: 'invitation-link-copied' },
        }));
    }

    // Show result screen after creation
    if (result) {
        return (
            <Modal open={true} onClose={onClose} title={t('app.inviteModal.invitationCreated', 'Invitation created')} size="md">
                        <p>{t('app.inviteModal.shareThisInvitationLink', 'Share this invitation link:')}</p>
                        <div data-walkthrough="invite-result">
                            <CopyField value={result.invite_url} onCopy={signalLinkCopied} />
                        </div>
                        {result.email_sent && (
                            <p className="text-success invite-result-note">
                                {t('app.inviteModal.invitationEmailSentTo', 'Invitation email sent to')} {result.invitation.email}
                            </p>
                        )}
                        {result.email_error && (
                            <p className="text-warning invite-result-note">
                                {t('app.inviteModal.emailCouldNotBeSent', 'Email could not be sent:')} {result.email_error}
                            </p>
                        )}
                    <div className="modal-footer">
                        <Button variant="default" onClick={onClose}>{t('common.actions.done', 'Done')}</Button>
                    </div>
            </Modal>
        );
    }

    return (
        <Modal open={true} onClose={onClose} title={t('app.inviteModal.inviteUser', 'Invite user')} size="md">
                <form onSubmit={handleSubmit} data-walkthrough="invite-form">
                    <div className="modal-body">
                        {error && <div className="error-message">{error}</div>}

                        <div className="form-group">
                            <Label htmlFor="invite-email">{t('app.inviteModal.emailOptional', 'Email (optional)')}</Label>
                            <Input
                                type="email"
                                id="invite-email"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder={t('app.inviteModal.userExampleComLeaveBlankFor', 'user@example.com (leave blank for link-only)')}
                            />
                            <span className="form-help">
                                {t('app.inviteModal.ifProvidedAnInvitationEmailWill', 'If provided, an invitation email will be sent. Otherwise, share the link manually.')}
                            </span>
                        </div>

                        <div className="form-row">
                            <div className="form-group">
                                <Label htmlFor="invite-role">{t('app.inviteModal.role', 'Role')}</Label>
                                <Select value={role} onValueChange={handleRoleChange}>
                                    <SelectTrigger id="invite-role">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="admin">{t('app.inviteModal.admin', 'Admin')}</SelectItem>
                                        <SelectItem value="developer">{t('app.inviteModal.developer', 'Developer')}</SelectItem>
                                        <SelectItem value="viewer">{t('app.inviteModal.viewer', 'Viewer')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="form-group">
                                <Label htmlFor="invite-expiry">{t('app.inviteModal.expires', 'Expires')}</Label>
                                <Select
                                    value={String(expiryDays)}
                                    onValueChange={(val) => setExpiryDays(Number(val))}
                                >
                                    <SelectTrigger id="invite-expiry">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1">{t('app.inviteModal.1Day', '1 day')}</SelectItem>
                                        <SelectItem value="3">{t('app.inviteModal.3Days', '3 days')}</SelectItem>
                                        <SelectItem value="7">{t('app.inviteModal.7Days', '7 days')}</SelectItem>
                                        <SelectItem value="30">{t('app.inviteModal.30Days', '30 days')}</SelectItem>
                                        <SelectItem value="0">{t('app.inviteModal.never', 'Never')}</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {role !== 'admin' && (
                            <div className="customize-permissions-section">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        if (!showPermissions && templates[role]) {
                                            setPermissions(templates[role]);
                                        }
                                        setShowPermissions(!showPermissions);
                                    }}
                                >
                                    {showPermissions ? t('app.inviteModal.hide', 'Hide') : t('app.inviteModal.customize', 'Customize')} {t('common.labels.permissions', 'Permissions')}
                                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2" className="invite-caret">
                                        {showPermissions
                                            ? <polyline points="18 15 12 9 6 15"/>
                                            : <polyline points="6 9 12 15 18 9"/>
                                        }
                                    </svg>
                                </Button>
                                {showPermissions && (
                                    <PermissionEditor
                                        permissions={permissions}
                                        onChange={setPermissions}
                                    />
                                )}
                            </div>
                        )}
                    </div>

                    <div className="modal-footer">
                        <Button type="button" variant="ghost" onClick={onClose}>{t('common.actions.cancel', 'Cancel')}</Button>
                        <Button type="submit" variant="default" disabled={loading} data-walkthrough="invite-submit">
                            {loading ? t('app.inviteModal.creating', 'Creating…') : t('app.inviteModal.createInvitation', 'Create invitation')}
                        </Button>
                    </div>
                </form>
        </Modal>
    );
};

export default InviteModal;
