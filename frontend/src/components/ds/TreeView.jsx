import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, File, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

// Styling lives in styles/components/_controls.scss (.sk-tree*).

// Typeahead: keystrokes within this window extend one search string.
const TYPEAHEAD_RESET_MS = 500;

// Flatten the expanded part of the tree into visible rows, in reading order.
function visibleRows(nodes, expanded, level = 1, parentId = null, rows = []) {
    nodes.forEach((node, index) => {
        const hasChildren = Boolean(node.children?.length) || node.hasChildren;
        rows.push({ node, level, parentId, hasChildren, posinset: index + 1, setsize: nodes.length });
        if (hasChildren && expanded.has(node.id) && node.children) {
            visibleRows(node.children, expanded, level + 1, node.id, rows);
        }
    });
    return rows;
}

/**
 * Hierarchical list: files, DNS zones, config trees, resource groups.
 *
 *   <TreeView nodes={tree} selectedId={path} onSelect={(node) => open(node)} />
 *
 * Nodes are `{ id, label, icon?, children?, hasChildren?, meta?, disabled? }`.
 * `hasChildren` without `children` marks a lazy branch: expanding it calls
 * `onLoadChildren(node)` (return a promise; the caller then supplies the
 * children) and shows a spinner meanwhile. Expansion is internal unless
 * `expandedIds` + `onExpandedChange` control it.
 *
 * Keyboard (WAI tree pattern): ↑/↓ move, → opens or steps into a branch,
 * ← closes or steps out to the parent, Home/End, Enter/Space select, `*`
 * opens every sibling, and typing jumps to the next matching label.
 */
export function TreeView({
    nodes = [],
    selectedId,
    onSelect,
    expandedIds,
    defaultExpandedIds = [],
    onExpandedChange,
    onLoadChildren,
    className,
    'aria-label': ariaLabel,
}) {
    const { t } = useTranslation();
    const [ownExpanded, setOwnExpanded] = useState(() => new Set(defaultExpandedIds));
    const expanded = useMemo(() => (expandedIds ? new Set(expandedIds) : ownExpanded), [expandedIds, ownExpanded]);
    const [loading, setLoading] = useState(() => new Set());
    const [focusedId, setFocusedId] = useState(null);
    const rowRefs = useRef(new Map());
    const typeahead = useRef({ text: '', timer: null });
    const focusWithin = useRef(false);

    const rows = useMemo(() => visibleRows(nodes, expanded), [nodes, expanded]);
    const activeId = rows.some((row) => row.node.id === focusedId)
        ? focusedId
        : (rows.find((row) => row.node.id === selectedId) || rows[0])?.node.id;

    useEffect(() => () => clearTimeout(typeahead.current.timer), []);
    useEffect(() => {
        if (focusWithin.current && activeId != null) rowRefs.current.get(activeId)?.focus();
    }, [activeId]);

    const setExpanded = useCallback((next) => {
        if (!expandedIds) setOwnExpanded(next);
        onExpandedChange?.([...next]);
    }, [expandedIds, onExpandedChange]);

    const expand = async (node) => {
        if (expanded.has(node.id)) return;
        setExpanded(new Set(expanded).add(node.id));
        if (!node.children && node.hasChildren && onLoadChildren) {
            setLoading((prev) => new Set(prev).add(node.id));
            try {
                await onLoadChildren(node);
            } finally {
                setLoading((prev) => { const next = new Set(prev); next.delete(node.id); return next; });
            }
        }
    };

    const collapse = (node) => {
        if (!expanded.has(node.id)) return;
        const next = new Set(expanded);
        next.delete(node.id);
        setExpanded(next);
    };

    const toggle = (row) => (expanded.has(row.node.id) ? collapse(row.node) : expand(row.node));

    const select = (row) => {
        if (row.node.disabled) return;
        setFocusedId(row.node.id);
        onSelect?.(row.node);
    };

    const handleKeyDown = (event) => {
        const index = rows.findIndex((row) => row.node.id === activeId);
        const row = rows[index];
        if (!row) return;
        const focus = (target) => { if (target) setFocusedId(target.node.id); };
        const keyActions = {
            ArrowDown: () => focus(rows[index + 1]),
            ArrowUp: () => focus(rows[index - 1]),
            Home: () => focus(rows[0]),
            End: () => focus(rows[rows.length - 1]),
            ArrowRight: () => {
                if (!row.hasChildren) return;
                if (!expanded.has(row.node.id)) expand(row.node);
                else if (rows[index + 1]?.parentId === row.node.id) focus(rows[index + 1]);
            },
            ArrowLeft: () => {
                if (row.hasChildren && expanded.has(row.node.id)) collapse(row.node);
                else focus(rows.find((candidate) => candidate.node.id === row.parentId));
            },
            Enter: () => select(row),
            ' ': () => select(row),
            '*': () => {
                const siblings = rows.filter((candidate) => candidate.parentId === row.parentId && candidate.hasChildren);
                siblings.forEach((sibling) => expand(sibling.node));
            },
        };
        const action = keyActions[event.key];
        if (action) {
            event.preventDefault();
            action();
            return;
        }
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const state = typeahead.current;
            clearTimeout(state.timer);
            state.text += event.key.toLowerCase();
            state.timer = setTimeout(() => { state.text = ''; }, TYPEAHEAD_RESET_MS);
            const ordered = [...rows.slice(index + 1), ...rows.slice(0, index + 1)];
            const searchFrom = state.text.length === 1 ? ordered : [row, ...ordered];
            focus(searchFrom.find((candidate) => String(candidate.node.label).toLowerCase().startsWith(state.text)));
        }
    };

    return (
        <ul
            role="tree"
            aria-label={ariaLabel || t('common.controls.tree', 'Tree')}
            className={cn('sk-tree', className)}
            onKeyDown={handleKeyDown}
            onFocus={() => { focusWithin.current = true; }}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) focusWithin.current = false;
            }}
        >
            {rows.map((row) => {
                const { node } = row;
                const isOpen = expanded.has(node.id);
                const isLoading = loading.has(node.id);
                const selected = node.id === selectedId;
                const DefaultIcon = row.hasChildren ? (isOpen ? FolderOpen : Folder) : File;
                const Icon = node.icon || DefaultIcon;
                return (
                    <li
                        key={node.id}
                        ref={(element) => {
                            if (element) rowRefs.current.set(node.id, element);
                            else rowRefs.current.delete(node.id);
                        }}
                        role="treeitem"
                        tabIndex={node.id === activeId ? 0 : -1}
                        aria-level={row.level}
                        aria-posinset={row.posinset}
                        aria-setsize={row.setsize}
                        aria-expanded={row.hasChildren ? isOpen : undefined}
                        aria-selected={selected}
                        aria-disabled={node.disabled || undefined}
                        aria-busy={isLoading || undefined}
                        className={cn('sk-tree__row', selected && 'is-selected', node.disabled && 'is-disabled')}
                        style={{ '--sk-tree-level': row.level - 1 }}
                        onClick={() => { select(row); }}
                        onDoubleClick={() => { if (row.hasChildren) toggle(row); }}
                    >
                        <span
                            className={cn('sk-tree__toggle', !row.hasChildren && 'is-leaf', isOpen && 'is-open')}
                            aria-hidden="true"
                            onClick={(event) => {
                                if (!row.hasChildren) return;
                                event.stopPropagation();
                                setFocusedId(node.id);
                                toggle(row);
                            }}
                        >
                            {isLoading ? <Loader2 className="sk-tree__spinner" /> : row.hasChildren && <ChevronRight />}
                        </span>
                        <Icon className="sk-tree__icon" aria-hidden="true" />
                        <span className="sk-tree__label">{node.label}</span>
                        {node.meta && <span className="sk-tree__meta">{node.meta}</span>}
                    </li>
                );
            })}
        </ul>
    );
}

export default TreeView;
