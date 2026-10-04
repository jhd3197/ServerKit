import { useState } from 'react';
import {
    ChevronDown, Star, Copy, Trash2, Plus, MoreVertical, Check, History, AlertTriangle,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// The saved-view selector, rendered as the page's own heading rather than yet
// another toolbar button — the view IS what you are looking at, so its name is
// the largest thing on the page and clicking it swaps the whole grid config.
//
// Built-in views ship in code; "My views" are the user's own, persisted through
// /api/v1/views by useTableViews. A modified view shows an asterisk plus an
// inline Save / Reset strip, so tweaking a built-in never silently destroys it.
//
// `actions` is the table's own chrome — search, the filter button and the "⋮".
// They belong on the SAME line as the view name, and this is the ONLY row of
// chrome a table gets. A page that owns a top bar hoists that same node up
// there instead (see useTopbarChrome) and passes nothing here; an inner or sub
// table, which has no top bar of its own, passes it and keeps it inline.
//
// There is deliberately no row count. It was rendered twice on every page that
// also had a toolbar underneath — once next to the view name, once on the right
// of the second bar — and the footer already says how many rows there are,
// under the rows it is counting.
export function GridViewPicker({ views, counts, onCreate, label = 'items', actions }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [menuFor, setMenuFor] = useState(null);
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    const [fromCurrent, setFromCurrent] = useState(true);

    const active = views.activeView;
    const activeName = active?.name || `All ${label}`;
    const builtins = views.builtinViews || [];
    const mine = views.userViews || [];

    const pick = (view) => { views.applyView(view); setOpen(false); setMenuFor(null); };

    const submitNew = () => {
        if (!name.trim()) return;
        onCreate(name.trim(), fromCurrent);
        setName('');
        setCreating(false);
        setOpen(false);
    };

    const renderRow = (view) => {
        const key = view.builtin ? `builtin:${view.name}` : `user:${view.id}`;
        const isActive = active && (active.builtin ? active.name === view.name : active.id === view.id);
        return (
            <div key={key} className={cn('sk-viewpick__row', isActive && 'is-on')}>
                <SharedButton variant="unstyled" type="button" className="sk-viewpick__rowmain" onClick={() => pick(view)}>
                    <span className="sk-viewpick__dot" data-builtin={view.builtin ? 'true' : 'false'} />
                    <span className="sk-viewpick__nm">{view.name}</span>
                    {view.is_default && <Star size={11} className="sk-viewpick__star" />}
                    {counts && <span className="sk-viewpick__n">{counts(view)}</span>}
                </SharedButton>
                {!view.builtin && (
                    <Popover
                        open={menuFor === key}
                        onOpenChange={(o) => setMenuFor(o ? key : null)}
                    >
                        <PopoverTrigger asChild>
                            <SharedButton variant="unstyled" type="button" className="sk-viewpick__cog" aria-label={`${view.name} options`}>
                                <MoreVertical size={14} />
                            </SharedButton>
                        </PopoverTrigger>
                        <PopoverContent align="end" sideOffset={4} className="ui-popover-panel sk-gridmenu">
                            <SharedButton variant="unstyled"
                                type="button"
                                className="sk-gridmenu__opt"
                                onClick={() => { views.toggleDefault(view); setMenuFor(null); }}
                            >
                                <Star size={13} />{view.is_default ? 'Unset as default' : 'Make default'}
                            </SharedButton>
                            <SharedButton variant="unstyled"
                                type="button"
                                className="sk-gridmenu__opt"
                                onClick={() => { pick(view); onCreate(`${view.name} copy`, true); setMenuFor(null); }}
                            >
                                <Copy size={13} />{t('app.gridViewPicker.duplicateView', 'Duplicate view')}
                            </SharedButton>
                            <div className="sk-gridmenu__sep" />
                            <SharedButton variant="unstyled"
                                type="button"
                                className="sk-gridmenu__opt is-danger"
                                onClick={() => { views.removeView(view); setMenuFor(null); }}
                            >
                                <Trash2 size={13} />{t('app.gridViewPicker.deleteView', 'Delete view')}
                            </SharedButton>
                        </PopoverContent>
                    </Popover>
                )}
            </div>
        );
    };

    return (
        <div className="sk-viewbar">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <SharedButton variant="unstyled" type="button" className={cn('sk-viewpick', open && 'is-open')}>
                        <span className="sk-viewpick__title">{activeName}</span>
                        {views.isDirty && <span className="sk-viewpick__ast">*</span>}
                        <ChevronDown size={16} />
                    </SharedButton>
                </PopoverTrigger>
                <PopoverContent align="start" sideOffset={6} className="ui-popover-panel sk-gridmenu sk-viewpick__menu">
                    {!!builtins.length && <div className="sk-gridmenu__head">{t('app.gridViewPicker.builtIn', 'Built in')}</div>}
                    {builtins.map(renderRow)}
                    <div className="sk-gridmenu__head">{t('app.gridViewPicker.myViews', 'My views')}</div>
                    {mine.length ? mine.map(renderRow) : (
                        <div className="sk-gridmenu__note">
                            {t('app.gridViewPicker.noPersonalViewsYetTuneThe', 'No personal views yet. Tune the grid, then save it here.')}
                        </div>
                    )}
                    <div className="sk-gridmenu__sep" />
                    {creating ? (
                        <>
                            <div className="sk-gridmenu__mini sk-gridmenu__mini--input">
                                <input
                                    autoFocus
                                    value={name}
                                    placeholder={t('app.gridViewPicker.eGCloudflareProd', 'e.g. Cloudflare prod')}
                                    onChange={(e) => setName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') submitNew();
                                        if (e.key === 'Escape') setCreating(false);
                                    }}
                                />
                            </div>
                            <SharedButton variant="unstyled"
                                type="button"
                                className={cn('sk-gridmenu__opt', fromCurrent && 'is-on')}
                                onClick={() => setFromCurrent((v) => !v)}
                            >
                                <span className="sk-gridmenu__box"><Check size={11} /></span>
                                {t('app.gridViewPicker.startFromCurrentFiltersColumns', 'Start from current filters and columns')}
                            </SharedButton>
                            <div className="sk-gridmenu__foot">
                                <SharedButton variant="unstyled" type="button" onClick={() => setCreating(false)}>{t('common.actions.cancel', 'Cancel')}</SharedButton>
                                <SharedButton variant="unstyled" type="button" className="is-primary" disabled={!name.trim()} onClick={submitNew}>
                                    {t('common.actions.create', 'Create')}
                                </SharedButton>
                            </div>
                        </>
                    ) : (
                        <SharedButton variant="unstyled" type="button" className="sk-gridmenu__opt" onClick={() => setCreating(true)}>
                            <Plus size={13} />{t('app.gridViewPicker.saveCurrentView', 'Save current view…')}
                        </SharedButton>
                    )}
                </PopoverContent>
            </Popover>

            {views.isDirty && (
                <div className="sk-viewbar__dirty">
                    <AlertTriangle size={13} />
                    {t('app.gridViewPicker.unsaved', 'Unsaved')}
                    <SharedButton variant="unstyled" type="button" onClick={views.resetView}>
                        <History size={12} />{t('app.gridViewPicker.reset', 'Reset')}
                    </SharedButton>
                    <SharedButton variant="unstyled"
                        type="button"
                        className="is-primary"
                        onClick={() => {
                            if (active && !active.builtin) views.updateActiveView();
                            else setOpen(true);
                        }}
                    >
                        {active && !active.builtin ? 'Save' : 'Save as…'}
                    </SharedButton>
                </div>
            )}

            {actions && <div className="sk-viewbar__actions">{actions}</div>}
        </div>
    );
}

export default GridViewPicker;
