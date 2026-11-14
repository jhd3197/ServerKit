import { AlertCircle, Check, Redo2, RotateCcw, Save, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../ui/button';

export default function ChangeBar({
    session,
    onSave,
    onDiscard,
    className = '',
}) {
    const { t } = useTranslation();
    const dirtyCount = session.dirtyPaths.length;
    const isSaving = session.saveState === 'saving';
    const classes = ['sk-changebar', className].filter(Boolean).join(' ');

    return (
        <section className={classes} aria-label={t('common.editing.unsavedChanges', 'Unsaved changes')}>
            <div className="sk-changebar__state" role="status" aria-live="polite">
                {session.saveState === 'error' ? <AlertCircle size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                <span>
                    {session.saveState === 'error'
                        ? session.error?.message || String(session.error || '')
                        : session.saveState === 'saved'
                            ? t('common.editing.saved', 'Saved')
                            : t('common.editing.unsavedCount', 'Unsaved changes: {{count}}', { count: dirtyCount })}
                </span>
            </div>
            <div className="sk-changebar__actions">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={session.undo}
                    disabled={!session.canUndo || isSaving}
                    disabledReason={!isSaving ? t('app.changeBar.nothingToUndo', 'Nothing to undo') : undefined}
                >
                    <Undo2 aria-hidden="true" />
                    {t('common.editing.undo', 'Undo')}
                </Button>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={session.redo}
                    disabled={!session.canRedo || isSaving}
                    disabledReason={!isSaving ? t('app.changeBar.nothingToRedo', 'Nothing to redo') : undefined}
                >
                    <Redo2 aria-hidden="true" />
                    {t('common.editing.redo', 'Redo')}
                </Button>
                <span className="sk-changebar__divider" aria-hidden="true" />
                <Button type="button" variant="ghost" size="sm" onClick={onDiscard} disabled={isSaving}>
                    <RotateCcw aria-hidden="true" />
                    {t('common.editing.discard', 'Discard')}
                </Button>
                <Button type="button" size="sm" onClick={onSave} disabled={!session.isDirty || isSaving} disabledReason={!isSaving ? t('app.proxyStackPanel.noChangesToSave', 'No changes to save') : undefined}>
                    <Save aria-hidden="true" />
                    {isSaving
                        ? t('common.editing.saving', 'Saving…')
                        : t('common.editing.save', 'Save')}
                </Button>
            </div>
        </section>
    );
}
