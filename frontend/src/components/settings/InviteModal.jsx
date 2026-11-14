import { useState, useEffect, useId } from 'react';
import api from '../../services/api';
import PermissionEditor from './PermissionEditor';
import Modal from '../Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FormField, FormRow } from '../FormField';
import useFieldErrors from '../../hooks/useFieldErrors';
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
    const fieldId = useId();
    // Email is optional; only a value that is present must look like an address.
    const fe = useFieldErrors({
        email: !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
            ? null
            : t('common.validation.emailInvalid', 'Enter a valid email address.'),
    }, fieldId);

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
        if (!fe.attempt()) return;
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
            if (fe.fromServer(err)) return;
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
                <form onSubmit={handleSubmit} noValidate data-walkthrough="invite-form">
                    <div className="modal-body">
                        {error && <div className="error-message">{error}</div>}

                        <FormField
                            label={t('app.inviteModal.emailOptional', 'Email (optional)')}
                            htmlFor={`${fieldId}-email`}
                            hint={t('app.inviteModal.ifProvidedAnInvitationEmailWill', 'If provided, an invitation email will be sent. Otherwise, share the link manually.')}
                            error={fe.error('email')}
                        >
                            <Input
                                type="email"
                                id={`${fieldId}-email`}
                                value={email}
                                onChange={e => { fe.clear('email'); setEmail(e.target.value); }}
                                onBlur={() => fe.touch('email')}
                                placeholder={t('app.inviteModal.userExampleComLeaveBlankFor', 'user@example.com (leave blank for link-only)')}
                            />
                        </FormField>

                        <FormRow>
                            <FormField label={t('app.inviteModal.role', 'Role')} htmlFor="invite-role">
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
                            </FormField>

                            <FormField label={t('app.inviteModal.expires', 'Expires')} htmlFor="invite-expiry">
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
                            </FormField>
                        </FormRow>

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
