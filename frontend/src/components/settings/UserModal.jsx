import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/useAuth.js';
import api from '../../services/api';
import PermissionEditor from './PermissionEditor';
import Modal from '../Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import FormField, { FormRow } from '../FormField';
import useForm from '../../hooks/useForm';
import { userPayload, validateUser, valuesForUser } from './userForm';
import { useTranslation } from 'react-i18next';

const UserModal = ({ user, onSave, onClose }) => {
    const { t } = useTranslation();
    const [permissions, setPermissions] = useState({});
    const [showPermissions, setShowPermissions] = useState(false);
    const [templates, setTemplates] = useState({});
    const { user: currentUser } = useAuth();

    const isEditing = !!user;
    const isSelf = user?.id === currentUser?.id;
    const form = useForm({
        initialValues: valuesForUser(user),
        validate: (values) => validateUser(values, { isEditing }),
        onSubmit: async (values) => {
            await onSave(userPayload(values, {
                permissions,
                includePermissions: showPermissions,
            }));
        },
    });
    const resetForm = form.reset;

    useEffect(() => {
        resetForm(valuesForUser(user));
        const nextPermissions = user?.permissions || {};
        setPermissions(nextPermissions);
        // Show permissions section if user has custom permissions set
        setShowPermissions(Object.keys(nextPermissions).length > 0);
    }, [user, resetForm]);

    useEffect(() => {
        api.getPermissionTemplates().then(data => {
            setTemplates(data.templates || {});
        }).catch(() => {});
    }, []);

    function handleRoleChange(newRole) {
        form.setValue('role', newRole);
        if (templates[newRole]) {
            setPermissions(templates[newRole]);
        }
    }

    return (
        <Modal open={true} onClose={onClose} title={isEditing ? t('app.userModal.editUser', 'Edit user') : t('app.userModal.addNewUser', 'New user')} size="md">
                <form onSubmit={form.handleSubmit}>
                    <div className="modal-body">
                        {form.submitError && <div className="error-message" role="alert">{form.submitError}</div>}

                        <FormField label={t('app.userModal.email', 'Email')} htmlFor="email" required error={form.getFieldError('email')}>
                            <Input
                                {...form.getFieldProps('email')}
                                type="email"
                                id="email"
                                placeholder="user@example.com"
                                required
                            />
                        </FormField>

                        <FormField label={t('common.labels.username', 'Username')} htmlFor="username" required error={form.getFieldError('username')}>
                            <Input
                                {...form.getFieldProps('username')}
                                type="text"
                                id="username"
                                placeholder={t('app.userModal.enterUsername', 'Enter username')}
                                required
                            />
                        </FormField>

                        <FormRow>
                            <FormField
                                label={isEditing ? t('app.userModal.newPasswordLeaveBlankToKeep', 'New password (leave blank to keep current)') : t('common.labels.password', 'Password')}
                                htmlFor="password"
                                required={!isEditing}
                                error={form.getFieldError('password')}
                            >
                                <Input
                                    {...form.getFieldProps('password')}
                                    type="password"
                                    id="password"
                                    placeholder={isEditing ? t('app.userModal.leaveBlankToKeepCurrent', 'Leave blank to keep current') : t('app.userModal.atLeast8Characters', 'At least 8 characters')}
                                    required={!isEditing}
                                />
                            </FormField>

                            <FormField
                                label={t('app.userModal.confirmPassword', 'Confirm password')}
                                htmlFor="confirmPassword"
                                required={Boolean(form.values.password)}
                                error={form.getFieldError('confirmPassword')}
                            >
                                <Input
                                    {...form.getFieldProps('confirmPassword')}
                                    type="password"
                                    id="confirmPassword"
                                    placeholder={t('app.userModal.confirmPassword2', 'Confirm password')}
                                    required={Boolean(form.values.password)}
                                />
                            </FormField>
                        </FormRow>

                        <div className="form-group">
                            <Label htmlFor="role">{t('app.userModal.role', 'Role')}</Label>
                            <Select
                                value={form.values.role}
                                onValueChange={handleRoleChange}
                                disabled={isSelf}
                            >
                                <SelectTrigger id="role">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="admin">{t('app.userModal.adminFullAccess', 'Admin - full access')}</SelectItem>
                                    <SelectItem value="developer">{t('app.userModal.developerManageAppsAndDeployments', 'Developer - manage services and deployments')}</SelectItem>
                                    <SelectItem value="viewer">{t('app.userModal.viewerReadOnlyAccess', 'Viewer - read-only access')}</SelectItem>
                                </SelectContent>
                            </Select>
                            {isSelf && (
                                <span className="form-help">{t('app.userModal.youCannotChangeYourOwnRole', 'You cannot change your own role')}</span>
                            )}
                        </div>

                        <div className="form-group">
                            <label className="checkbox-label">
                                <Checkbox
                                    name="is_active"
                                    checked={form.values.is_active}
                                    onCheckedChange={(checked) => form.setValue('is_active', Boolean(checked))}
                                    disabled={isSelf}
                                />
                                <span className="checkbox-text">{t('app.userModal.accountIsActive', 'Account is active')}</span>
                            </label>
                            {isSelf && (
                                <span className="form-help">{t('app.userModal.youCannotDeactivateYourOwnAccount', 'You cannot deactivate your own account')}</span>
                            )}
                        </div>

                        <div className="role-descriptions">
                            <h4>{t('app.userModal.rolePermissions', 'Role permissions')}</h4>
                            <div className="role-item">
                                <span className="role-name">{t('app.userModal.admin', 'Admin')}</span>
                                <span className="role-desc">{t('app.userModal.fullSystemAccessIncludingUserManagement', 'Full system access including user management and settings')}</span>
                            </div>
                            <div className="role-item">
                                <span className="role-name">{t('app.userModal.developer', 'Developer')}</span>
                                <span className="role-desc">{t('app.userModal.manageApplicationsDeploymentsDatabasesAndDomains', 'Manage services, deployments, databases, and domains')}</span>
                            </div>
                            <div className="role-item">
                                <span className="role-name">{t('app.userModal.viewer', 'Viewer')}</span>
                                <span className="role-desc">{t('app.userModal.readOnlyAccessToDashboardsAnd', 'Read-only access to dashboards and logs')}</span>
                            </div>
                        </div>

                        {form.values.role !== 'admin' && (
                            <div className="customize-permissions-section">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        if (!showPermissions && templates[form.values.role]) {
                                            setPermissions(templates[form.values.role]);
                                        }
                                        setShowPermissions(!showPermissions);
                                    }}
                                >
                                    {showPermissions ? 'Hide' : 'Customize'} {t('common.labels.permissions', 'Permissions')}
                                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" fill="none" strokeWidth="2">
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
                        <Button type="button" variant="ghost" onClick={onClose}>
                            {t('common.actions.cancel', 'Cancel')}
                        </Button>
                        <Button type="submit" variant="default" disabled={form.isSubmitting}>
                            {form.isSubmitting ? 'Saving...' : (isEditing ? 'Save Changes' : 'Create user')}
                        </Button>
                    </div>
                </form>
        </Modal>
    );
};

export default UserModal;
