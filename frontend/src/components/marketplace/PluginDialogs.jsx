import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import {
    Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from '@/components/ui/select';
import { toastError } from '@/utils/errorMessage';

// Config editor for an installed plugin (#49). Fields come from the manifest's
// config_schema (top-level keys, or JSON-schema `properties`); values persist
// via PUT /plugins/<id>/config and the plugin reads them on the backend via
// plugins_sdk.config(slug).
export const PluginConfigDialog = ({ plugin, onClose }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const [values, setValues] = useState(null);
    const [saving, setSaving] = useState(false);

    const schema = plugin.config_schema || {};
    const fields = schema.properties && typeof schema.properties === 'object'
        ? schema.properties
        : schema;

    useEffect(() => {
        api.getPluginConfig(plugin.id)
            .then((data) => setValues(data.config || {}))
            .catch(() => setValues({}));
    }, [plugin.id]);

    const setField = (key, v) => setValues((prev) => ({ ...prev, [key]: v }));

    const save = async () => {
        setSaving(true);
        try {
            await api.updatePluginConfig(plugin.id, values || {});
            toast.success(t('app.marketplace.extensionConfigurationSaved', 'Extension settings saved'));
            onClose();
        } catch (err) {
            toastError(toast, t('app.marketplace.failedToSaveConfiguration', "Couldn't save the settings."), err);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={t('app.marketplace.configure2', 'Configure {{displayname}}', { displayname: plugin.display_name })}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" onClick={onClose}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button onClick={save} disabled={saving || values === null}>
                        {saving ? t('common.saving', 'Saving…') : t('common.actions.save', 'Save')}
                    </Button>
                </>
            }
        >
            {values === null ? (
                <p className="text-muted">{t('common.loading', 'Loading…')}</p>
            ) : (
                <div className="plugin-config-form">
                    {Object.entries(fields).map(([key, spec]) => {
                        const s = spec && typeof spec === 'object' ? spec : {};
                        const type = s.type || 'string';
                        const isNumber = type === 'number' || type === 'integer';
                        const value = values[key] ?? s.default ?? (type === 'boolean' ? false : '');
                        return (
                            <label key={key} className="plugin-config-form__field">
                                <span className="plugin-config-form__label">{s.title || key}</span>
                                {type === 'boolean' ? (
                                    <input
                                        type="checkbox"
                                        checked={Boolean(value)}
                                        onChange={(e) => setField(key, e.target.checked)}
                                    />
                                ) : Array.isArray(s.enum) ? (
                                    // Radix items need non-empty string values; the
                                    // original (possibly numeric) enum entry is restored on change.
                                    <Select
                                        value={value === '' ? '' : String(value)}
                                        onValueChange={(v) => setField(
                                            key,
                                            s.enum.find((opt) => String(opt) === v) ?? v,
                                        )}
                                    >
                                        <SelectTrigger aria-label={s.title || key}>
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {s.enum.filter((opt) => String(opt) !== '').map((opt) => (
                                                <SelectItem key={String(opt)} value={String(opt)}>{String(opt)}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <input
                                        className="ui-input"
                                        type={isNumber ? 'number' : (s.secret ? 'password' : 'text')}
                                        value={value}
                                        onChange={(e) => setField(
                                            key,
                                            isNumber
                                                ? (e.target.value === '' ? '' : Number(e.target.value))
                                                : e.target.value
                                        )}
                                    />
                                )}
                                {s.description && (
                                    <span className="plugin-config-form__hint text-muted">{s.description}</span>
                                )}
                            </label>
                        );
                    })}
                    {Object.keys(fields).length === 0 && (
                        <p className="text-muted">{t('app.marketplace.thisExtensionDeclaresNoConfigurationFields', 'This extension has no settings.')}</p>
                    )}
                </div>
            )}
        </Modal>
    );
};

// Data-policy dialog for plugin uninstall. Keeping data (default) leaves the
// extension's tables intact for a later reinstall; purging drops them.
export const PluginUninstallDialog = ({ plugin, onCancel, onConfirm }) => {
    const { t } = useTranslation();
    return (
        <Modal
            open
            onClose={onCancel}
            title={t('app.marketplace.uninstall', 'Uninstall {{displayname}}?', { displayname: plugin.display_name })}
            size="sm"
            footer={
                <>
                    <Button variant="ghost" onClick={onCancel}>{t('common.actions.cancel', 'Cancel')}</Button>
                    <Button variant="outline" onClick={() => onConfirm(false)}>{t('app.marketplace.keepData', 'Keep data')}</Button>
                    <Button variant="destructive" onClick={() => onConfirm(true)}>{t('app.marketplace.purgeData', 'Delete data')}</Button>
                </>
            }
        >
            <div className="plugin-uninstall-dialog">
                <p>{t('app.marketplace.removingThisExtensionStopsItsRoutes', 'Uninstalling this extension stops its routes and UI contributions.')}</p>
                <p className="text-muted">
                    <strong>{t('app.marketplace.keepData', 'Keep data')}</strong> {t('app.marketplace.leavesTheExtensionSDatabaseTables', 'leaves the extension\'s database tables intact so you can reinstall later.')} <strong>{t('app.marketplace.purgeData', 'Delete data')}</strong> {t('app.marketplace.permanentlyDropsTheExtensionSTables', 'permanently drops the extension\'s tables and cannot be undone.')}
                </p>
            </div>
        </Modal>
    );
};
