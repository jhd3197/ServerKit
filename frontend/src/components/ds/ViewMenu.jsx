import { useState } from 'react';
import { LayoutList, Star, Trash2, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useToast } from '@/contexts/useToast.js';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Saved-view picker (CRM style: Twenty view switcher / Frappe view dropdown).
// Lists built-in views plus the user's saved views for the page; clicking a
// row applies it, the star toggles the per-user default, and the footer saves
// the table's current state as a new view. The trigger shows the active
// view's name.
//
//   const views = useTableViews({ page, builtinViews, capture, apply });
//   <ViewMenu views={views} />
export function ViewMenu({ views, className }) {
    const { t } = useTranslation();
    const {
        builtinViews, userViews, activeView, isDirty,
        applyView, saveView, updateActiveView, toggleDefault, removeView, resetView,
    } = views;
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        const trimmed = name.trim();
        if (!trimmed || saving) return;
        setSaving(true);
        try {
            await saveView(trimmed);
            setName('');
            toast.success(t('app.viewMenu.viewSaved', 'View "{{trimmed}}" saved', { trimmed: trimmed }));
        } catch (err) {
            toastError(toast, t('app.viewMenu.couldNotSaveTheView', "Couldn't save the view."), err);
        } finally {
            setSaving(false);
        }
    };

    const handleUpdate = async () => {
        try {
            await updateActiveView();
            toast.success(t('app.viewMenu.viewUpdated', 'View "{{name}}" updated', { name: activeView.name }));
        } catch (err) {
            toastError(toast, t('app.viewMenu.couldNotUpdateTheView', "Couldn't update the view."), err);
        }
    };

    const handleDelete = async (view) => {
        try {
            await removeView(view);
            toast.success(t('app.viewMenu.viewDeleted', 'View "{{name}}" deleted', { name: view.name }));
        } catch (err) {
            toastError(toast, t('app.viewMenu.couldNotDeleteTheView', "Couldn't delete the view."), err);
        }
    };

    const isActive = (view) => activeView && activeView.name === view.name
        && activeView.builtin === !!view.builtin;

    const row = (view) => (
        <div
            key={view.builtin ? `b-${view.name}` : `u-${view.id}`}
            className={cn('sk-viewmenu__row', isActive(view) && 'is-active')}
        >
            <Button variant="unstyled"
                type="button"
                className="sk-viewmenu__apply"
                onClick={() => { applyView(view); setOpen(false); }}
            >
                {isActive(view) && <Check size={13} aria-hidden="true" />}
                <span className="sk-viewmenu__name">{view.name}</span>
            </Button>
            {!view.builtin && (
                <>
                    <Button variant="unstyled"
                        type="button"
                        className={cn('sk-viewmenu__star', view.is_default && 'is-on')}
                        onClick={() => toggleDefault(view)}
                        title={view.is_default ? t('app.viewMenu.removeAsDefault', 'Remove as default') : t('app.viewMenu.setAsDefaultView', 'Set as default view')}
                        aria-label={view.is_default ? t('app.viewMenu.removeAsDefault', 'Remove as default') : t('app.viewMenu.setAsDefaultView', 'Set as default view')}
                        aria-pressed={view.is_default}
                    >
                        <Star size={13} />
                    </Button>
                    <Button variant="unstyled"
                        type="button"
                        className="sk-viewmenu__delete"
                        onClick={() => handleDelete(view)}
                        title={t('app.viewMenu.delete', 'Delete "{{name}}"', { name: view.name })}
                        aria-label={t('app.viewMenu.deleteView', 'Delete view {{name}}', { name: view.name })}
                    >
                        <Trash2 size={13} />
                    </Button>
                </>
            )}
        </div>
    );

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn('sk-filter-btn', activeView && 'sk-filter-btn--active', className)}
                >
                    <LayoutList aria-hidden="true" />
                    {activeView ? activeView.name : t('app.viewMenu.views', 'Views')}
                    {isDirty && <span className="sk-viewmenu__dot" title={t('app.viewMenu.modifiedNotSavedToThisView', 'Modified (not saved to this view)')} />}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="sk-tablemenu sk-viewmenu">
                {builtinViews.length > 0 && (
                    <>
                        <div className="sk-tablemenu__title">{t('app.viewMenu.builtIn', 'Built in')}</div>
                        <div className="sk-tablemenu__list">{builtinViews.map(row)}</div>
                    </>
                )}
                <div className="sk-tablemenu__title">{t('app.viewMenu.savedViews', 'Saved views')}</div>
                {userViews.length === 0 ? (
                    <div className="sk-tablemenu__empty">
                        {t('app.viewMenu.noSavedViewsYetTuneThe', 'No saved views yet. Tune the table, then save it below.')}
                    </div>
                ) : (
                    <div className="sk-tablemenu__list">{userViews.map(row)}</div>
                )}
                {isDirty && activeView && (
                    <div className="sk-viewmenu__update">
                        {!activeView.builtin && (
                            <Button variant="ghost" size="sm" onClick={handleUpdate}>
                                {t('app.viewMenu.update', 'Update "')}{activeView.name}{t('app.viewMenu.withChanges', '" with changes')}
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={resetView}>
                            {t('app.viewMenu.resetToSaved', 'Reset to saved')}
                        </Button>
                    </div>
                )}
                <div className="sk-viewmenu__save">
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                        placeholder={t('app.viewMenu.saveCurrentAs', 'Save current as…')}
                        aria-label={t('app.viewMenu.newViewName', 'New view name')}
                        maxLength={120}
                    />
                    <Button size="sm" onClick={handleSave} disabled={!name.trim() || saving}>
                        {t('common.actions.save', 'Save')}
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default ViewMenu;
