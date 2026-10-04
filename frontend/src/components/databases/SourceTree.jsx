import { ChevronRight, ChevronDown, Table2, Loader2, MoreHorizontal, Plus, Download } from 'lucide-react';
import { EngineIcon } from '../icons/DatabaseBrands';
import EngineGlyph from './EngineGlyph';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Icon per node kind / engine. Brand glyphs come from DatabaseBrands; tint comes
// from `.is-<engine>` in SCSS (the brand icons use currentColor). An engine
// installed from a template carries its catalog entry in `iconEntry`, so it can
// fall back to the template's own icon when we ship no brand glyph for it.
function NodeIcon({ node }) {
    if (node.iconEntry) return <EngineGlyph entry={node.iconEntry} size={15} />;
    if (node.kind === 'engine' || node.kind === 'database') {
        return <EngineIcon engine={node.engine} size={15} />;
    }
    if (node.kind === 'app') return <EngineIcon engine="docker" size={15} />;
    if (node.kind === 'table') return <Table2 size={14} aria-hidden="true" />;
    return <EngineIcon engine={node.engine} size={15} />;
}

const STATUS_LABEL = {
    active: 'Running',
    inactive: 'Stopped',
    missing: 'Not installed',
    installing: 'Installing',
    failed: 'Failed',
};

function matches(node, filter) {
    return !filter || node.label.toLowerCase().includes(filter.toLowerCase());
}

// What a node counts, so the number beside it is never ambiguous. Children are
// apps under the Docker root, databases under any other engine, tables under a
// database.
function countNoun(node) {
    if (node.kind === 'database') return 'tables';
    if (node.kind === 'engine' && node.engine === 'docker') return 'apps';
    return 'databases';
}

// "Nothing here" is a normal fact and must never read like a failure. Each kind
// gets its own words rather than a shared "Empty".
function emptyLabel(node) {
    if (node.kind === 'database') return 'No tables yet';
    if (node.kind === 'app') return 'No databases';
    if (node.kind === 'engine' && node.engine === 'docker') return 'No Docker services';
    return 'No databases yet';
}

function TreeRow({ node, depth, expanded, childrenCache, loading, activeKey, selectedId, filter, handlers }) {
    const { t } = useTranslation();
    const isOpen = expanded.has(node.id);
    const isLoading = loading.has(node.id);
    const kids = childrenCache.get(node.id);
    // Error cache entries are either the legacy 'error' sentinel or
    // `{ __error: message }` carrying a specific reason (e.g. a dead container).
    const errorMsg = kids === 'error'
        ? "Couldn't load. Right-click to retry."
        : (kids && !Array.isArray(kids) && kids.__error) || null;
    const hadError = errorMsg != null;
    const childNodes = Array.isArray(kids) ? kids : [];
    const visibleChildren = childNodes.filter((c) => c.expandable || matches(c, filter));
    // Counted off children we actually hold. A node nobody has opened has no
    // count — which is honest — and an empty one says so in words below instead
    // of wearing a "0".
    const childCount = Array.isArray(kids) && kids.length > 0 ? kids.length : null;
    const canInstall = Boolean(node.installers?.length && handlers.onInstall);

    return (
        <li className="dbx-tree-node" role="none">
            <div
                className={`dbx-tree-row is-${node.engine || node.kind}`
                    + (selectedId === node.id ? ' is-selected' : '')
                    + (activeKey && activeKey === node.id ? ' is-active' : '')}
                style={{ paddingLeft: `${depth * 14 + 6}px` }}
                role="treeitem"
                aria-expanded={node.expandable ? isOpen : undefined}
                aria-selected={selectedId === node.id}
                tabIndex={0}
                onClick={() => handlers.onActivate(node)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlers.onActivate(node); }
                    if (e.key === 'ArrowRight' && node.expandable && !isOpen) handlers.onToggle(node);
                    if (e.key === 'ArrowLeft' && node.expandable && isOpen) handlers.onToggle(node);
                }}
                onContextMenu={(e) => handlers.onContext(e, node)}
            >
                {node.expandable ? (
                    <SharedButton variant="unstyled"
                        type="button"
                        className="dbx-tree-chevron"
                        onClick={(e) => { e.stopPropagation(); handlers.onToggle(node); }}
                        aria-label={isOpen ? t('app.sourceTree.collapse', 'Collapse') : t('app.sourceTree.expand', 'Expand')}
                        tabIndex={-1}
                    >
                        {isLoading
                            ? <Loader2 size={13} className="dbx-spin" aria-hidden="true" />
                            : isOpen ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                    </SharedButton>
                ) : (
                    <span className="dbx-tree-chevron dbx-tree-chevron--leaf" aria-hidden="true" />
                )}

                <span className="dbx-tree-icon"><NodeIcon node={node} /></span>
                {/* Rows carry status, counts and actions, so the name is the
                    first thing to lose width — keep it recoverable on hover. */}
                <span className="dbx-tree-label" title={node.label}>{node.label}</span>

                {node.kind === 'database' && node.source === 'docker' && (
                    <span className="dbx-tree-source" title={node.appName ? t('app.sourceTree.dockerContainer', 'Docker container · {{appName}}', { appName: node.appName }) : t('app.sourceTree.dockerContainer2', 'Docker container')}>
                        <EngineIcon engine="docker" size={11} />
                        {node.appName || 'docker'}
                    </span>
                )}

                {node.kind === 'engine' && node.status && node.status !== 'available' && (
                    <span className={`dbx-tree-status is-${node.status}`} title={STATUS_LABEL[node.status]}>
                        {node.status === 'installing'
                            ? <Loader2 size={11} className="dbx-spin" aria-hidden="true" />
                            : <span className="dbx-status-dot" aria-hidden="true" />}
                        {/* A running engine's version says more than the word
                            "Running" the green dot already carries. */}
                        {node.status === 'active' && node.version
                            ? `v${node.version}`
                            : STATUS_LABEL[node.status]}
                    </span>
                )}

                {/* A not-installed engine is a dead end only if we make it one.
                    Unlike the row's other buttons this one keeps its place in the
                    tab order: it is the only way out of the state it announces. */}
                {canInstall && (
                    <SharedButton variant="unstyled"
                        type="button"
                        className="dbx-tree-install-btn"
                        onClick={(e) => { e.stopPropagation(); handlers.onInstall(node); }}
                        aria-label={t('app.sourceTree.isNotInstalledInstallIt', '{{label}} is not installed. Install it', { label: node.label })}
                        title={t('app.sourceTree.install', 'Install {{label}}', { label: node.label })}
                    >
                        <Download size={11} aria-hidden="true" /> {t('app.sourceTree.install2', 'Install')}
                    </SharedButton>
                )}
                {!canInstall && node.installHint && (
                    <span className="dbx-tree-hint">{node.installHint}</span>
                )}

                {node.kind === 'table' && node.rows != null && (
                    <span className="dbx-tree-badge">{node.rows.toLocaleString()}</span>
                )}
                {node.kind === 'database' && node.sizeText && (
                    <span className="dbx-tree-badge">{node.sizeText}</span>
                )}
                {node.kind !== 'table' && childCount != null && (
                    <span className="dbx-tree-count" title={`${childCount} ${countNoun(node)}`}>
                        {childCount}
                    </span>
                )}

                {node.canCreate && handlers.onCreateChild && (
                    <SharedButton variant="unstyled"
                        type="button"
                        className="dbx-tree-add"
                        onClick={(e) => { e.stopPropagation(); handlers.onCreateChild(node); }}
                        aria-label={t('app.sourceTree.createADatabaseIn', 'New database in {{label}}', { label: node.label })}
                        title={t('app.sourceTree.createADatabase', 'New database')}
                        tabIndex={-1}
                    >
                        <Plus size={12} aria-hidden="true" />
                    </SharedButton>
                )}

                <SharedButton variant="unstyled"
                    type="button"
                    className="dbx-tree-more"
                    onClick={(e) => { e.stopPropagation(); handlers.onContext(e, node); }}
                    aria-label={t('common.labels.actions', 'Actions')}
                    tabIndex={-1}
                >
                    <MoreHorizontal size={14} aria-hidden="true" />
                </SharedButton>
            </div>

            {node.expandable && isOpen && (
                <ul className="dbx-tree-children" role="group">
                    {isLoading && childNodes.length === 0 && (
                        <li className="dbx-tree-leaf-msg" style={{ paddingLeft: `${(depth + 1) * 14 + 22}px` }}>{t('common.loading', 'Loading…')}</li>
                    )}
                    {hadError && (
                        <li className="dbx-tree-leaf-msg is-error" style={{ paddingLeft: `${(depth + 1) * 14 + 22}px` }}>
                            {errorMsg}
                        </li>
                    )}
                    {!isLoading && !hadError && childNodes.length === 0 && (
                        <li className="dbx-tree-leaf-msg" style={{ paddingLeft: `${(depth + 1) * 14 + 22}px` }}>
                            {canInstall ? (
                                <SharedButton variant="unstyled"
                                    type="button"
                                    className="dbx-tree-leaf-link"
                                    onClick={() => handlers.onInstall(node)}
                                >
                                    {t('app.sourceTree.notInstalledInstall', 'Not installed. Install')} {node.label}
                                </SharedButton>
                            ) : emptyLabel(node)}
                        </li>
                    )}
                    {visibleChildren.map((child) => (
                        <TreeRow
                            key={child.id}
                            node={child}
                            depth={depth + 1}
                            expanded={expanded}
                            childrenCache={childrenCache}
                            loading={loading}
                            activeKey={activeKey}
                            selectedId={selectedId}
                            filter={filter}
                            handlers={handlers}
                        />
                    ))}
                    {!isLoading && !hadError && childNodes.length > 0 && visibleChildren.length === 0 && (
                        <li className="dbx-tree-leaf-msg" style={{ paddingLeft: `${(depth + 1) * 14 + 22}px` }}>{t('app.sourceTree.noMatch', 'No match')}</li>
                    )}
                </ul>
            )}
        </li>
    );
}

export default function SourceTree({ roots, expanded, childrenCache, loading, activeKey, selectedId, filter, handlers }) {
    const { t } = useTranslation();
    return (
        <ul className="dbx-tree" role="tree" aria-label={t('app.sourceTree.databaseSources', 'Database sources')}>
            {roots.map((node) => (
                <TreeRow
                    key={node.id}
                    node={node}
                    depth={0}
                    expanded={expanded}
                    childrenCache={childrenCache}
                    loading={loading}
                    activeKey={activeKey}
                    selectedId={selectedId}
                    filter={filter}
                    handlers={handlers}
                />
            ))}
        </ul>
    );
}
