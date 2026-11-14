import { Children, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Grid2x2, History, LayoutGrid, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '@/services/api';
import { useAuth } from '@/contexts/useAuth';
import { useToast } from '@/contexts/useToast';
import useEditingSession from '@/hooks/useEditingSession';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { usePolling } from '@/hooks/usePolling';
import { Button } from '@/components/ui/button';
import ChangeBar from '@/components/ds/ChangeBar';
import { DashGrid } from '@/components/dashboard/grid/DashGrid';
import { WidgetLibrary } from '@/components/dashboard/grid/WidgetLibrary';
import { WidgetEditor } from '@/components/dashboard/grid/WidgetEditor';
import { WidgetFullscreen } from '@/components/dashboard/grid/WidgetFullscreen';
import { GRID_GAP, GRID_ROW, compact, findFreeSpot, nextWidgetId, pushDown } from '@/components/dashboard/grid/layout';
import { useWidgetTypes, getWidgetType } from '@/components/dashboard/widgets/registry';
import { toastError } from '@/utils/errorMessage';

// The Overview tab of an entity detail page, laid out on the dashboard's widget
// grid: the same frames, library, editor and fullscreen view, with the page's
// own cards available as blocks next to the dashboard's widgets.
//
//   <OverviewBoard kind="server" entityId={server.id} widgetTypes={['stat', 'note']}>
//       <OverviewSection id="info" title="Server information" w={6} h={3}>
//           …the card…
//       </OverviewSection>
//   </OverviewBoard>
//
// A user has one layout per kind (every server page shares their server
// layout; the page's own entity is the board's variable), stored on the server
// like a dashboard. Until they save one, the layout is the sections in the
// order the page declares them.

// ?layout=edit puts the board in edit mode, so the page's menu can link to it.
const EDIT_PARAM = 'layout';
const EDIT_VALUE = 'edit';

// How often dashboard widgets on the board re-read their data.
const REFRESH_MS = 15000;
// Time range the board's metric widgets read. Fixed for now: the page has no
// range picker of its own.
const BOARD_RANGE = '1h';

// The board's rows are half a dashboard row tall: page blocks vary a lot in
// height, and a full row (88px) is too coarse a step for them. Two half rows
// plus the gap between them are exactly one dashboard row, so a dashboard
// widget keeps its size here at twice its row count.
const ROWS_PER_DASHBOARD_ROW = 2;
const BOARD_ROW = (GRID_ROW - GRID_GAP) / ROWS_PER_DASHBOARD_ROW;

const SECTION_TYPE_PREFIX = 'overview.';
const sectionTypeId = (kind, id) => `${SECTION_TYPE_PREFIX}${kind}.${id}`;
const isSectionWidget = (widget) => String(widget?.type || '').startsWith(SECTION_TYPE_PREFIX);

// Declares one block of the page. Renders nothing itself: OverviewBoard reads
// its props and mounts the children where the layout places the block.
//   id, title, icon, w (of 12 columns), h (board rows, see BOARD_ROW)
//   placed  in the default layout unless false
//   lead    placed ahead of the board's leading dashboard widgets (a notice)
export function OverviewSection() {
    return null;
}

// A section's frame body. The section's content lives in a host element the
// board renders into once; the frame only adopts that element, so moving,
// resizing or opening a block fullscreen never remounts the card inside it.
function SectionWidget({ widget, ctx }) {
    const slotRef = useRef(null);
    const host = ctx.sectionHosts.get(widget.cfg?.section);
    const { adoptVersion, releaseSection } = ctx;

    // Take the section's element whenever it is free to take (first mount, or
    // after another frame showing the same section let go of it).
    useEffect(() => {
        const slot = slotRef.current;
        if (slot && host && host.parentNode !== slot) slot.appendChild(host);
    }, [host, adoptVersion]);

    // Hand it back only when this frame really goes away.
    useEffect(() => {
        if (!host) return undefined;
        return () => releaseSection(host);
    }, [host, releaseSection]);

    return <div className="sk-overview-section" ref={slotRef} data-empty={ctx.emptyLabel} />;
}

const NO_WIDGET_TYPES = [];
const NO_LEADING_WIDGETS = [];

//   widgetTypes  ids of dashboard widget types offered on this board
//   leading      dashboard widgets placed ahead of the sections in the default
//                layout: [{ type, w, h, cfg }], h in board rows
// Pass both as module-level constants: they define the board, they are not state.
export function OverviewBoard({
    kind, entityId, entityLabel, widgetTypes = NO_WIDGET_TYPES, leading = NO_LEADING_WIDGETS, children,
}) {
    const sections = Children.toArray(children).filter(isValidElement).map((child) => child.props);
    return (
        <OverviewBoardInner
            key={kind}
            kind={kind}
            entityId={entityId}
            entityLabel={entityLabel}
            widgetTypeIds={widgetTypes}
            leading={leading}
            sections={sections}
        />
    );
}

function OverviewBoardInner({ kind, entityId, entityLabel, widgetTypeIds, leading, sections }) {
    const { t } = useTranslation();
    const toast = useToast();
    const navigate = useNavigate();
    const { isAdmin } = useAuth();
    const [query, setQuery] = useSearchParams();
    const edit = query.get(EDIT_PARAM) === EDIT_VALUE;

    // ---- section hosts ------------------------------------------------------
    // One detached element per section, created once and kept for the life of
    // the board. Sections that are not on the grid wait in the hidden park.
    const hostsRef = useRef(new Map());
    const parkRef = useRef(null);
    const sectionIds = sections.map((section) => section.id);
    sectionIds.forEach((id) => {
        if (!hostsRef.current.has(id)) {
            const host = document.createElement('div');
            host.className = 'sk-overview-section__host';
            hostsRef.current.set(id, host);
        }
    });
    const sectionKey = sectionIds.join('|');
    // Everything about the sections that shapes the board (not their content,
    // which re-renders through the portals below on every pass).
    const sectionSignature = sections
        .map((section) => [section.id, section.title, section.w, section.h, section.placed, section.lead].join(':'))
        .join('|');
    // The same descriptors object for as long as the signature holds, so the
    // memos below depend on a real value instead of re-running every render.
    const metaRef = useRef({ signature: null, meta: [] });
    if (metaRef.current.signature !== sectionSignature) {
        metaRef.current = {
            signature: sectionSignature,
            meta: sections.map(({ id, title, icon, w, h, placed, lead }) => ({ id, title, icon, w, h, placed, lead })),
        };
    }
    const sectionMeta = metaRef.current.meta;

    const [adoptVersion, setAdoptVersion] = useState(0);
    const releaseSection = useCallback((host) => {
        // Park the element, then let any frame that still wants it take it back
        // (closing fullscreen returns the block to its frame on the grid).
        if (parkRef.current && host.parentNode !== parkRef.current) parkRef.current.appendChild(host);
        setAdoptVersion((version) => version + 1);
    }, []);

    // Which sections currently render something. A card that hides itself (no
    // traffic yet, feature not applicable) simply leaves the layout.
    const [present, setPresent] = useState(() => new Set());
    useEffect(() => {
        const park = parkRef.current;
        const observers = [];
        const measure = () => {
            const next = new Set();
            hostsRef.current.forEach((host, id) => { if (host.childElementCount > 0) next.add(id); });
            setPresent((current) => (
                current.size === next.size && [...next].every((id) => current.has(id)) ? current : next
            ));
        };
        hostsRef.current.forEach((host) => {
            if (!host.parentNode && park) park.appendChild(host);
            const observer = new MutationObserver(measure);
            observer.observe(host, { childList: true });
            observers.push(observer);
        });
        measure();
        return () => observers.forEach((observer) => observer.disconnect());
    }, [sectionKey]);

    // ---- widget types -------------------------------------------------------
    const registered = useWidgetTypes();
    const types = useMemo(() => {
        const sectionTypes = sectionMeta.map((section) => ({
            id: sectionTypeId(kind, section.id),
            name: section.title,
            icon: section.icon || LayoutGrid,
            cat: 'Overview',
            desc: section.title,
            w: section.w || 6,
            h: section.h || 3,
            min: [3, 2],
            defaultCfg: { section: section.id },
            component: SectionWidget,
            section: section.id,
        }));
        // Dashboard widgets keep their size on the finer rows.
        const shared = registered.filter((type) => widgetTypeIds.includes(type.id)).map((type) => ({
            ...type,
            h: type.h * ROWS_PER_DASHBOARD_ROW,
            min: [type.min?.[0] ?? 2, (type.min?.[1] ?? 1) * ROWS_PER_DASHBOARD_ROW],
        }));
        return [...sectionTypes, ...shared];
    }, [kind, sectionMeta, registered, widgetTypeIds]);

    const defaults = useMemo(() => {
        const widgets = [];
        const place = (type, w, h, cfg) => {
            widgets.push({ i: nextWidgetId(widgets), type, ...findFreeSpot(widgets, w, h), w, h, cfg });
        };
        const placeSection = (section) => place(
            sectionTypeId(kind, section.id), section.w || 6, section.h || 3, { section: section.id },
        );
        const placed = sectionMeta.filter((section) => section.placed !== false);
        placed.filter((section) => section.lead).forEach(placeSection);
        leading.forEach((item) => place(item.type, item.w, item.h, { ...item.cfg }));
        placed.filter((section) => !section.lead).forEach(placeSection);
        return widgets;
    }, [kind, sectionMeta, leading]);

    // Drop anything a saved layout references that this page no longer offers.
    const sanitize = useCallback(
        (widgets) => widgets.filter((widget) => getWidgetType(types, widget.type)),
        [types],
    );

    // ---- persistence --------------------------------------------------------
    // `board` is the saved row, null while the user is on the shipped layout,
    // undefined until the first read returns.
    const [board, setBoard] = useState(undefined);
    useEffect(() => {
        let cancelled = false;
        api.getOverviewBoard(kind)
            .then((saved) => { if (!cancelled) setBoard(saved); })
            // A failed read must not hide the page: fall back to the default layout.
            .catch(() => { if (!cancelled) setBoard(null); });
        return () => { cancelled = true; };
    }, [kind]);
    const saved = useMemo(
        () => (board?.widgets ? sanitize(board.widgets) : defaults),
        [board, defaults, sanitize],
    );

    // ---- editing ------------------------------------------------------------
    const editing = useEditingSession({ baseline: [] });
    const { draft, isDirty, reset: resetEditing, save: saveEditing, transaction } = editing;
    const [selectedId, setSelectedId] = useState(null);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [fullscreen, setFullscreen] = useState(null);
    const [tick, setTick] = useState(0);
    usePolling(() => setTick((value) => value + 1), REFRESH_MS, { immediate: false });

    // Entering edit mode starts a fresh draft from what is on screen.
    const wasEditing = useRef(false);
    useEffect(() => {
        if (edit && !wasEditing.current && board !== undefined) resetEditing(saved);
        wasEditing.current = edit && board !== undefined;
    }, [edit, board, saved, resetEditing]);

    const setEditing = useCallback((on) => {
        const next = new URLSearchParams(query);
        if (on) next.set(EDIT_PARAM, EDIT_VALUE);
        else next.delete(EDIT_PARAM);
        setQuery(next, { replace: true });
        if (!on) { setSelectedId(null); setLibraryOpen(false); }
    }, [query, setQuery]);

    const { requestLeave } = useUnsavedChangesGuard({
        isDirty: edit && isDirty,
        confirmOptions: {
            title: t('app.overviewBoard.discardTitle', 'Discard layout changes?'),
            message: t('app.overviewBoard.discardMessage', 'Your saved overview layout stays as it was.'),
            confirmText: t('common.actions.discard', 'Discard'),
        },
    });

    const discard = useCallback(async () => {
        if (isDirty && !(await requestLeave())) return;
        setEditing(false);
    }, [isDirty, requestLeave, setEditing]);

    const save = useCallback(async () => {
        try {
            await saveEditing(async (widgets) => {
                // Saving the shipped layout means "no layout of my own": drop
                // the saved row so later changes to the default still reach
                // this user, instead of pinning them to today's copy of it.
                if (JSON.stringify(widgets) === JSON.stringify(defaults)) {
                    if (board?.id) await api.deleteDashboard(board.id);
                    setBoard(null);
                    return widgets;
                }
                const stored = await api.saveOverviewBoard(kind, widgets);
                setBoard(stored);
                return stored?.widgets || widgets;
            });
            setEditing(false);
            toast.success(t('app.overviewBoard.saved', 'Overview layout saved'));
        } catch (err) {
            toastError(toast, t('app.overviewBoard.couldNotSave', "Couldn't save the overview layout."), err);
        }
    }, [board, defaults, kind, saveEditing, setEditing, t, toast]);

    const restoreDefaults = useCallback(() => transaction(defaults), [defaults, transaction]);

    const widgets = edit ? draft : saved;
    const selected = widgets.find((widget) => widget.i === selectedId) || null;

    // Out of edit mode, blocks with nothing to show leave the layout and the
    // rest close the gap. In edit mode every block stays where it was put.
    const shown = useMemo(() => {
        if (edit) return widgets;
        const visible = widgets.filter((widget) => !isSectionWidget(widget) || present.has(widget.cfg?.section));
        if (visible.length === widgets.length) return widgets;
        // Re-place the remaining blocks in reading order, keeping their sizes:
        // floating them straight up would leave a hole beside a block whose
        // neighbour is the one that went away.
        const placed = [];
        [...visible].sort((a, b) => a.y - b.y || a.x - b.x).forEach((widget) => {
            placed.push({ ...widget, ...findFreeSpot(placed, widget.w, widget.h) });
        });
        return placed;
    }, [edit, widgets, present]);

    const startEditing = useCallback(() => { if (!edit) setEditing(true); }, [edit, setEditing]);

    const addWidget = (type) => {
        const widget = {
            i: nextWidgetId(widgets),
            type: type.id,
            ...findFreeSpot(widgets, type.w, type.h),
            w: type.w,
            h: type.h,
            cfg: structuredClone(type.defaultCfg || {}),
        };
        transaction(compact([...widgets, widget]));
        setLibraryOpen(false);
        setSelectedId(widget.i);
    };
    const removeWidget = (widget) => {
        transaction(compact(widgets.filter((item) => item.i !== widget.i)));
        setSelectedId(null);
    };
    const duplicateWidget = (widget) => {
        // A page block exists once; only dashboard widgets can be duplicated.
        if (isSectionWidget(widget)) return;
        const copy = { ...structuredClone(widget), i: nextWidgetId(widgets), ...findFreeSpot(widgets, widget.w, widget.h) };
        transaction([...widgets, copy]);
        setSelectedId(copy.i);
    };
    const onWidgetMenu = (action, widget) => {
        if (action === 'full') { setFullscreen(widget); return; }
        // The other actions change the layout, so they open edit mode first.
        // The draft is seeded from the saved layout on the next render, so only
        // "configure" can be applied straight away; the rest are edit-mode only.
        if (!edit) { startEditing(); if (action === 'config') setSelectedId(widget.i); return; }
        if (action === 'config') setSelectedId(widget.i);
        if (action === 'del') removeWidget(widget);
        if (action === 'dup') duplicateWidget(widget);
    };

    const ctx = useMemo(() => ({
        range: BOARD_RANGE,
        tick,
        // Dashboard widgets bound to `$server` read this page's server.
        serverVar: kind === 'server' ? entityId : undefined,
        isAdmin,
        navigate,
        types,
        entity: { kind, id: entityId },
        sectionHosts: hostsRef.current,
        adoptVersion,
        releaseSection,
        emptyLabel: t('app.overviewBoard.nothingToShow', 'Nothing to show here right now.'),
    }), [tick, kind, entityId, isAdmin, navigate, types, adoptVersion, releaseSection, t]);

    // Page blocks already on the board are not offered again.
    const placedSections = new Set(widgets.filter(isSectionWidget).map((widget) => widget.cfg?.section));
    const libraryTypes = types.filter((type) => !type.section || !placedSections.has(type.section));
    const resources = kind === 'server' ? [{ id: entityId, label: entityLabel || String(entityId), kind: 'server' }] : [];

    return (
        <div className={`sk-overview-board${edit ? ' is-editing' : ''}`}>
            {/* Every section renders exactly once, into its own host element. */}
            {sections.map((section) => createPortal(section.children, hostsRef.current.get(section.id), section.id))}
            <div ref={parkRef} hidden />

            {edit && (
                <>
                    <div className="sk-overview-board__bar">
                        <Button variant="unstyled" type="button" className="skw-barbtn" onClick={() => setLibraryOpen(true)}>
                            <Plus size={14} /> {t('app.overviewBoard.addBlock', 'Add block')}
                        </Button>
                        <Button variant="unstyled" type="button" className="skw-barbtn" onClick={restoreDefaults}>
                            <History size={14} /> {t('app.overviewBoard.restoreDefault', 'Restore default layout')}
                        </Button>
                    </div>
                    <div className="skw-hint">
                        <Grid2x2 size={13} aria-hidden="true" /> {t('app.overviewBoard.editHint', 'Drag headers to move · drag the corner to resize · this layout applies to every {{kind}} page for your account', { kind })}
                    </div>
                </>
            )}

            {board !== undefined && (
                <DashGrid
                    rowHeight={BOARD_ROW}
                    widgets={shown}
                    edit={edit}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onChange={transaction}
                    ctx={ctx}
                    onWidgetMenu={onWidgetMenu}
                />
            )}

            {edit && <ChangeBar session={editing} onDiscard={discard} onSave={save} />}

            {edit && libraryOpen && (
                <WidgetLibrary types={libraryTypes} onAdd={addWidget} onClose={() => setLibraryOpen(false)} />
            )}
            {edit && selected && (
                <WidgetEditor
                    widget={selected}
                    type={getWidgetType(types, selected.type)}
                    ctx={ctx}
                    resources={resources}
                    onChange={(next) => transaction(pushDown(widgets, next))}
                    onClose={() => setSelectedId(null)}
                    onDuplicate={() => duplicateWidget(selected)}
                    onRemove={() => removeWidget(selected)}
                />
            )}
            {fullscreen && (
                <WidgetFullscreen
                    widget={fullscreen}
                    type={getWidgetType(types, fullscreen.type)}
                    ctx={ctx}
                    onClose={() => setFullscreen(null)}
                />
            )}
        </div>
    );
}
