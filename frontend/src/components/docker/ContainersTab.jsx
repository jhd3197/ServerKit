import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { statusKind } from '@/components/ds/status';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../hooks/useConfirm';
import LogToolbar from '../log-viewer/LogToolbar';
import LogContent from '../log-viewer/LogContent';
import EmptyState from '../EmptyState';
import Modal from '@/components/Modal';
import { Drawer, DataTable, DataTableFooter, Pill, SearchField } from '@/components/ds';
import {
    useTableChrome, GridViewPicker, GridChips, GridFilterButton,
    GridToolsMenu, GridFilterDrawer, GridBulkBar,
} from '@/components/ds/grid';
import { formatRelativeTime } from '@/utils/time';
import { useTableSort } from '@/hooks/useTableSort';
import { useColumnVisibility } from '@/hooks/useColumnVisibility';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
    Box, X, Trash2, Play, Square, RotateCw,
    Terminal as TerminalLucide, FileText, Activity, Clock3, Copy,
    Database, Gauge, Package, Server as ServerIcon, Lock,
} from 'lucide-react';
import {
    useServer,
    unwrapRemoteData,
    formatPorts,
    normalizeListResponse,
    shortId,
    getContainerId,
    getContainerName,
    getContainerImage,
    getContainerStatus,
    isContainerRunning,
    isProtectedContainer,
    getContainerStatusLabel,
    containerHue,
    getContainerProjectName,
} from './dockerHelpers';
import { ContainerResourceBars } from './dockerShared';
import { copyToClipboard } from '@/utils/clipboard';
import { downloadBlob } from '@/utils/downloadBlob';
import { usePolling } from '@/hooks/usePolling';
import { useTranslation } from 'react-i18next';

// Container stats cadence.
const STATS_REFRESH_MS = 10000;
// Container log tail cadence while auto-refresh is on.
const LOG_TAIL_MS = 3000;


// Action Buttons
export const RunContainerButton = () => {
    const { t } = useTranslation();
    const [showModal, setShowModal] = useState(false);
    const { isRemote } = useServer();
    return (
        <>
            <Button
                onClick={() => setShowModal(true)}
                disabled={isRemote}
                title={isRemote ? t('app.containersTab.runningNewContainersIsOnlyAvailable', 'Running new containers is only available on the local Docker target right now') : t('app.containersTab.runContainer', 'Run container')}
            >
                <span>+</span> {t('app.containersTab.runContainer2', 'Run Container')}
            </Button>
            {showModal && <RunContainerModal onClose={() => setShowModal(false)} onCreated={() => window.location.reload()} />}
        </>
    );
};

// Docker reports health inside the `docker ps` STATUS STRING — "Up 3 hours
// (healthy)", "Up 2 minutes (health: starting)", "Up 6 days (unhealthy)" —
// there is no health field on the list endpoint (see
// docker_service.list_containers). Deriving it here is what turns "is anything
// failing its healthcheck" into a column, and therefore into a saved view,
// instead of something you squint at in the muted status line. 'None' is a real
// answer, not a gap: it means no HEALTHCHECK is declared, so nothing is
// watching that container at all.
const HEALTH_LABELS = ['Unhealthy', 'Starting', 'None', 'Healthy'];
const HEALTH_RANK = { Unhealthy: 0, Starting: 1, None: 2, Healthy: 3 };

const containerHealth = (container) => {
    const status = getContainerStatus(container).toLowerCase();
    // Negative case first. '(unhealthy)' does not contain '(healthy)' — the
    // paren is what keeps them apart — but testing in this order means the
    // check never depends on noticing that again.
    if (status.includes('(unhealthy)')) return 'Unhealthy';
    if (status.includes('health: starting')) return 'Starting';
    if (status.includes('(healthy)')) return 'Healthy';
    return 'None';
};

// Built-in views. The All / Running / Stopped chip row that used to sit in the
// toolbar was three column rules wearing a segmented control; every bucket it
// offered is a preset here.
//
// Every preset carries `showAll: true`. The list endpoint is asked for
// running-only containers when "Include stopped" is off, so a view about
// stopped containers would otherwise be a preset that can only ever match zero
// rows — the rows it wants were never fetched. The chrome applies the `page`
// bag before the rules, so switching to one of these refetches first.
const NO_RULES = { match: 'all', rules: [] };
const PAGE_ALL = { showAll: true, search: '' };

const BUILTIN_VIEWS = [
    {
        // The everyday list: what is actually up right now.
        name: 'Running',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'dc1', field: 'status', op: 'any', value: ['Running'] }],
            },
            page: PAGE_ALL,
        },
    },
    {
        // "is none of Running" rather than a list of Exited/Created, so paused,
        // restarting and dead land here too instead of falling through both
        // buckets the way they did under the old chip row. Newest first: the
        // container that just failed to start is the one you came here for.
        // Resources is hidden — a stopped container has no reading, so the
        // column would be a wall of empty bars.
        name: 'Not running',
        state: {
            sorts: [{ key: 'created', direction: 'desc' }],
            hiddenKeys: ['resources'],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [{ id: 'dc2', field: 'status', op: 'none', value: ['Running'] }],
            },
            page: PAGE_ALL,
        },
    },
    {
        // Running containers whose healthcheck is not passing — failing, still
        // starting, or absent entirely. "is none of Healthy" covers all three
        // in one rule, and the Running clause is what keeps every stopped
        // container (which reports no health by definition) out of it.
        // Sorted by the health rank, so genuinely unhealthy tops the list.
        name: 'Unhealthy or unwatched',
        state: {
            sorts: [{ key: 'health', direction: 'asc' }],
            hiddenKeys: ['created'],
            groupBy: null,
            columnFilters: {
                match: 'all',
                rules: [
                    { id: 'dc3', field: 'status', op: 'any', value: ['Running'] },
                    { id: 'dc4', field: 'health', op: 'none', value: ['Healthy'] },
                ],
            },
            page: PAGE_ALL,
        },
    },
    {
        // No rules at all: everything, bucketed by the image it runs. This is
        // how you spot the three containers still on last month's tag.
        name: 'By image',
        state: {
            sorts: [{ key: 'name', direction: 'asc' }],
            hiddenKeys: [],
            groupBy: 'image',
            columnFilters: NO_RULES,
            page: PAGE_ALL,
        },
    },
    {
        // The way back out of any of the above.
        name: 'Everything, newest first',
        state: {
            sorts: [{ key: 'created', direction: 'desc' }],
            hiddenKeys: [],
            groupBy: null,
            columnFilters: NO_RULES,
            page: PAGE_ALL,
        },
    },
];

// Containers Tab
const ContainersTab = ({ onStatsChange }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const { confirm: confirmContainer } = useConfirm();
    const [containers, setContainers] = useState([]);
    const [containerStats, setContainerStats] = useState({});
    const [loading, setLoading] = useState(true);
    const [showAll, setShowAll] = useState(true);
    const [selectedContainer, setSelectedContainer] = useState(null);
    const [logsContainer, setLogsContainer] = useState(null);
    const [execContainer, setExecContainer] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    // Native DataTable header sorting (the old <select> + direction button is
    // gone). Default keeps the previous behavior: running containers first.
    const { sorts, setSorts } = useTableSort({
        defaultSorts: [{ key: 'status', direction: 'asc' }],
        storageKey: 'serverkit-table-docker-containers-sort',
    });
    // Health is off by default. On a typical host almost every row reads "No
    // healthcheck", so the column spent its width restating that the image
    // never declared one — and Status already says "(healthy)" for the few that
    // do. It is one click away in the column menu, and the "Unhealthy or
    // unwatched" view turns it back on, which is where it actually says
    // something.
    const {
        hiddenKeys, setHiddenKeys,
    } = useColumnVisibility({
        defaultHidden: ['health'],
        storageKey: 'serverkit-table-docker-containers-cols',
    });
    const [picked, setPicked] = useState([]);
    const [bulkBusy, setBulkBusy] = useState(false);
    // Not persisted on its own: a grouping worth keeping is a saved view.
    const [groupBy, setGroupBy] = useState(null);
    const statsRequestSeq = useRef(0);

    useEffect(() => {
        loadContainers();
    }, [showAll, serverId]); // eslint-disable-line react-hooks/exhaustive-deps

    const fetchContainerStats = useCallback(async (container) => {
        const containerId = getContainerId(container);
        if (!containerId) return null;

        if (isRemote) {
            const result = await api.getRemoteContainerStats(serverId, containerId);
            const payload = unwrapRemoteData(result);
            return payload?.stats || payload;
        }

        const statsData = await api.getContainerStats(containerId);
        return statsData.stats;
    }, [isRemote, serverId]);

    const refreshContainerStats = useCallback(async (containerList, requestSeq = statsRequestSeq.current) => {
        const runningContainers = containerList.filter(isContainerRunning);
        if (runningContainers.length === 0) return;

        if (!isRemote) {
            const containerIds = runningContainers.map(getContainerId).filter(Boolean);
            if (containerIds.length === 0) return;

            const resolveStats = (statsMap, container) => {
                const containerId = getContainerId(container);
                const containerName = getContainerName(container);
                return statsMap[containerId] ||
                    statsMap[containerName] ||
                    statsMap[`/${containerName}`] ||
                    null;
            };

            try {
                const statsData = await api.getContainersStats(containerIds);
                if (requestSeq !== statsRequestSeq.current) return;
                const statsMap = statsData?.stats || {};
                setContainerStats(prev => {
                    const next = { ...prev };
                    runningContainers.forEach(container => {
                        next[getContainerId(container)] = resolveStats(statsMap, container);
                    });
                    return next;
                });
            } catch {
                if (requestSeq !== statsRequestSeq.current) return;
                setContainerStats(prev => {
                    const next = { ...prev };
                    runningContainers.forEach(container => {
                        next[getContainerId(container)] = null;
                    });
                    return next;
                });
            }
            return;
        }

        await Promise.all(runningContainers.map(async (container) => {
            const containerId = getContainerId(container);
            try {
                const stats = await fetchContainerStats(container);
                if (requestSeq !== statsRequestSeq.current || !stats) return;
                setContainerStats(prev => ({ ...prev, [containerId]: stats }));
            } catch {
                if (requestSeq !== statsRequestSeq.current) return;
                setContainerStats(prev => ({ ...prev, [containerId]: null }));
            }
        }));
    }, [fetchContainerStats, isRemote]);

    usePolling(
        () => refreshContainerStats(containers, statsRequestSeq.current),
        STATS_REFRESH_MS,
        { enabled: !loading && containers.length > 0, immediate: false },
    );

    async function loadContainers() {
        setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteContainers(serverId, showAll);
                data = { containers: normalizeListResponse(result, 'containers') };
            } else {
                data = await api.getContainers(showAll);
            }
            const containerList = data.containers || [];
            const requestSeq = ++statsRequestSeq.current;
            setContainers(containerList);
            setContainerStats({});
            setSelectedContainer(prev => {
                if (!containerList.length || !prev) return null;
                return containerList.find(c => getContainerId(c) === getContainerId(prev)) || null;
            });
            setLoading(false);
            refreshContainerStats(containerList, requestSeq);
        } catch (err) {
            console.error('Failed to load containers:', err);
            setLoading(false);
        }
    }

    async function handleAction(containerId, action) {
        try {
            if (action === 'start') {
                if (isRemote) {
                    await api.startRemoteContainer(serverId, containerId);
                } else {
                    await api.startContainer(containerId);
                }
                toast.success(t('app.containersTab.containerStarted', 'Container started'));
            } else if (action === 'stop') {
                if (isRemote) {
                    await api.stopRemoteContainer(serverId, containerId);
                } else {
                    await api.stopContainer(containerId);
                }
                toast.success(t('app.containersTab.containerStopped', 'Container stopped'));
            } else if (action === 'restart') {
                if (isRemote) {
                    await api.restartRemoteContainer(serverId, containerId);
                } else {
                    await api.restartContainer(containerId);
                }
                toast.success(t('app.containersTab.containerRestarted', 'Container restarted'));
            } else if (action === 'remove') {
                const removeConfirmed = await confirmContainer({ titleKey: 'app.containersTab.removeContainer', title: 'Remove Container', messageKey: 'app.containersTab.removeThisContainer', message: 'Remove this container?' });
                if (!removeConfirmed) return;
                if (isRemote) {
                    await api.removeRemoteContainer(serverId, containerId, true);
                } else {
                    await api.removeContainer(containerId, true);
                }
                toast.success(t('app.containersTab.containerRemoved', 'Container removed'));
            }
            loadContainers();
            onStatsChange?.();
        } catch (err) {
            console.error(`Failed to ${action} container:`, err);
            toast.error(err.message || t('app.containersTab.failedToContainer', 'Failed to {{action}} container', { action: action }));
        }
    }

    // Logs and Exec are full-screen portal surfaces. Close the inspector in
    // the same render that opens either one so its higher Docker-specific
    // layer cannot cover the shared Drawer/Dialog portal.
    const openContainerLogs = useCallback((container) => {
        setSelectedContainer(null);
        setExecContainer(null);
        setLogsContainer(container);
    }, []);

    const openContainerExec = useCallback((container) => {
        setSelectedContainer(null);
        setLogsContainer(null);
        setExecContainer(container);
    }, []);

    const toggleRow = useCallback((key, on) => {
        setPicked((prev) => (on ? [...new Set([...prev, key])] : prev.filter((k) => k !== key)));
    }, []);

    // Runs the same per-container call the row buttons run, one at a time so a
    // single failure is reported against the container that failed rather than
    // aborting the rest of the selection.
    async function handleBulkAction(action) {
        const targets = containers.filter((c) => picked.includes(getContainerId(c)));
        const actionable = targets.filter((c) => !isProtectedContainer(c));
        const skipped = targets.length - actionable.length;
        if (!actionable.length) {
            toast.error(skipped ? t('app.containersTab.onlySystemContainersWereSelected', 'Only system containers were selected') : t('app.containersTab.nothingSelected', 'Nothing selected'));
            return;
        }

        setBulkBusy(true);
        let ok = 0;
        const failed = [];
        for (const container of actionable) {
            const id = getContainerId(container);
            try {
                if (isRemote) {
                    if (action === 'start') await api.startRemoteContainer(serverId, id);
                    else if (action === 'stop') await api.stopRemoteContainer(serverId, id);
                    else await api.restartRemoteContainer(serverId, id);
                } else if (action === 'start') await api.startContainer(id);
                else if (action === 'stop') await api.stopContainer(id);
                else await api.restartContainer(id);
                ok += 1;
            } catch {
                failed.push(container.name || id);
            }
        }
        setBulkBusy(false);

        if (failed.length) {
            toast.error(`${failed.length} failed: ${failed.slice(0, 3).join(', ')}${failed.length > 3 ? '…' : ''}`);
        } else {
            const verb = action === 'start'
                ? t('app.containersTab.started', 'started')
                : action === 'stop'
                    ? t('app.containersTab.stopped', 'stopped')
                    : t('app.containersTab.restarted', 'restarted');
            toast.success(skipped
                ? t('app.containersTab.bulkActionDoneWithSkipped', '{{count}} containers {{verb}} · {{skipped}} system containers skipped', { count: ok, verb: verb, skipped: skipped })
                : t('app.containersTab.bulkActionDone', '{{count}} containers {{verb}}', { count: ok, verb: verb }));
        }
        setPicked([]);
        loadContainers();
        onStatsChange?.();
    }

    function parseStats(stats) {
        if (!stats) return { cpu: 0, memory: 0, available: false };
        const source = stats.stats || stats;
        const parsePercent = (value) => {
            if (typeof value === 'number') return value;
            if (value === null || value === undefined) return 0;
            return parseFloat(String(value).replace('%', '')) || 0;
        };

        const cpu = parsePercent(source.CPUPerc ?? source.cpu_percent ?? source.cpu?.percent);
        const memory = parsePercent(source.MemPerc ?? source.memory_percent ?? source.memory?.percent);

        return { cpu, memory, available: true };
    }

    // Search only. The running/stopped split used to live here as a chip
    // filter; it is a column rule now, applied inside the table.
    const filteredContainers = useMemo(() => {
        const search = searchTerm.toLowerCase();
        if (!search) return containers;
        return containers.filter(c => (
            getContainerName(c).toLowerCase().includes(search) ||
            getContainerId(c).toLowerCase().includes(search) ||
            getContainerImage(c).toLowerCase().includes(search)
        ));
    }, [containers, searchTerm]);

    // Declared after `filteredContainers` because it closes over it: a
    // useCallback dep array is evaluated during render, so referencing the
    // const from above it is a temporal-dead-zone crash, not a lint nit.
    const toggleAll = useCallback((on, keys) => {
        // DataTable passes no key list when the header box is clicked; fall
        // back to everything currently on screen.
        const set = keys ?? filteredContainers.map((c) => getContainerId(c));
        setPicked((prev) => (on ? [...new Set([...prev, ...set])] : prev.filter((k) => !set.includes(k))));
    }, [filteredContainers]);

    const selectedStats = selectedContainer
        ? parseStats(containerStats[getContainerId(selectedContainer)])
        : { cpu: 0, memory: 0, available: false };

    // CPU% is the headline number behind the Resources column. A container with
    // no reading yet is null, NOT 0, so it sorts last and no numeric rule
    // claims it — see the missing-value guard on lt/gt in ds/grid/fields.js.
    const cpuPercent = (container) => {
        const stats = parseStats(containerStats[getContainerId(container)]);
        return stats.available ? stats.cpu : null;
    };

    // DataTable columns. Cell markup and classNames are identical to the
    // hand-rolled table they replace, so _docker.scss keeps applying
    // (.dx-manager-table, .dx-name-stack, .dx-status-pill, .dx-row-actions...).
    //
    // Two accessors per column on purpose: `value` is what the column menu, the
    // filter rules and the export read (ds/grid/fields.js), `sortValue` is what
    // DataTable's sorter reads. Declaring only one gets the other from the
    // wrong place — and where `sortValue` is a rank NUMBER (Status, Health)
    // that would type the column `num` and make every string rule below match
    // exactly nothing.
    const columns = [
        {
            key: 'name',
            headerKey: 'common.labels.name', header: 'Name',
            sortable: true,
            hideable: false,
            type: 'text',
            value: (container) => getContainerName(container),
            sortValue: (container) => getContainerName(container),
            render: (container) => {
                const isRunning = isContainerRunning(container);
                return (
                    <div className="dx-name-stack">
                        <span className="dx-name-line">
                            {/* hue-hashed per-container identity dot (demo .dot-ico);
                                dims when stopped — status itself lives in the Status pill */}
                            <span
                                className={`dx-status-dot ${isRunning ? 'running' : 'stopped'}`}
                                style={{
                                    background: `hsl(${containerHue(getContainerName(container))} 60% 60%)`,
                                    boxShadow: isRunning
                                        ? `0 0 6px hsl(${containerHue(getContainerName(container))} 60% 60% / 0.55)`
                                        : 'none',
                                    opacity: isRunning ? 1 : 0.4,
                                }}
                            />
                            <span title={getContainerName(container)}>{getContainerName(container)}</span>
                        </span>
                        <span className="dx-muted-line mono">{shortId(getContainerId(container))}</span>
                    </div>
                );
            },
        },
        {
            key: 'image',
            headerKey: 'app.containersTab.image', header: 'Image',
            sortable: true,
            type: 'text',
            // Grouping is the whole point of the "By image" view. `groupValue`
            // has to be spelled out as well: DataTable's grouper falls back to
            // row[key], and the remote agent spells the field `Image`.
            groupable: true,
            value: (container) => getContainerImage(container),
            groupValue: (container) => getContainerImage(container),
            sortValue: (container) => getContainerImage(container),
            render: (container) => (
                <span className="dx-code-pill" title={getContainerImage(container)}>
                    {getContainerImage(container)}
                </span>
            ),
        },
        {
            key: 'status',
            headerKey: 'common.labels.status', header: 'Status',
            sortable: true,
            // The pill's own text IS the filterable value, so a preset that
            // says 'Running' reads exactly the way the row does. No enumOrder:
            // the label falls through to the raw state for anything past
            // running/exited/created, and a fixed list would hide 'paused' or
            // 'dead' from the pick-list on the one host that has them.
            type: 'enum',
            value: (container) => getContainerStatusLabel(container),
            // Running first on asc, matching the old default sort.
            sortValue: (container) => (isContainerRunning(container) ? 0 : 1),
            render: (container) => (
                <>
                    <span className={`dx-status-pill ${isContainerRunning(container) ? 'running' : 'stopped'}`}>
                        {getContainerStatusLabel(container)}
                    </span>
                    <span className="dx-muted-line">{getContainerStatus(container)}</span>
                </>
            ),
        },
        {
            key: 'health',
            headerKey: 'app.containersTab.health', header: 'Health',
            sortable: true,
            type: 'enum',
            // A closed set of four labels this file produces, so the pick-list
            // can be ordered by severity instead of alphabetically.
            enumOrder: HEALTH_LABELS,
            value: containerHealth,
            sortValue: (container) => HEALTH_RANK[containerHealth(container)],
            render: (container) => {
                const health = containerHealth(container);
                // Spelled out rather than shown as 'None': the absence of a
                // healthcheck is a fact about the image, not a missing reading.
                if (health === 'None') return <span className="dx-muted-line">{t('app.containersTab.noHealthcheck', 'No healthcheck')}</span>;
                return <Pill kind={statusKind(health)} dot={false}>{health}</Pill>;
            },
        },
        {
            key: 'ports',
            headerKey: 'app.containersTab.ports', header: 'Ports',
            sortable: false,
            // Filterable even though it is not sortable: "which containers are
            // published to the host" is a `contains ->` away. The accessor has
            // to be formatPorts — the raw field is a string on the local
            // transport and an array of objects on the remote one.
            type: 'text',
            value: (container) => formatPorts(container.ports).join(', '),
            render: (container) => {
                const ports = formatPorts(container.ports);
                return (
                    <div className="dx-port-list">
                        {ports.slice(0, 2).map((port, i) => (
                            <span key={i} className={`dx-port-pill ${port === '-' ? 'is-empty' : ''}`}>{port}</span>
                        ))}
                        {ports.length > 2 && <span className="dx-port-more">+{ports.length - 2}</span>}
                    </div>
                );
            },
        },
        {
            key: 'resources',
            headerKey: 'app.containersTab.resources', header: 'Resources',
            sortable: true,
            // Two labelled bars need a floor, or the column collapses to the
            // width of its truncated header on a narrow viewport.
            width: 150,
            // Declared, not inferred: on a host where everything is stopped no
            // row has a reading at all, and an all-null sample infers no type —
            // the column would offer filtering on a busy host and not on an
            // idle one.
            type: 'num',
            unit: '%',
            value: cpuPercent,
            sortValue: cpuPercent,
            render: (container) => (
                <ContainerResourceBars
                    stats={parseStats(containerStats[getContainerId(container)])}
                    muted={!isContainerRunning(container)}
                />
            ),
        },
        {
            key: 'created',
            headerKey: 'common.labels.created', header: 'Created',
            sortable: true,
            // Declared: `sortValue` is epoch ms, and letting that number type
            // the column would offer "is under 1754…" instead of a date picker.
            // The raw value is docker's CreatedAt ("2026-08-12 09:12:33 -0400
            // EDT"), which both Date.parse and the rule engine read.
            type: 'date',
            width: 110,
            value: (container) => container.created || container.CreatedAt || null,
            sortValue: (container) => {
                const parsed = Date.parse(container.created || container.CreatedAt || '');
                return Number.isNaN(parsed) ? null : parsed;
            },
            // Docker hands back "2026-08-12 09:12:33 -0400 EDT" — 29 characters
            // of which the last 14 are never what you came to read. Shown as an
            // age, with the full stamp on hover; the filter still works on the
            // real date because `value` is untouched.
            render: (container) => {
                const raw = container.created || container.CreatedAt || '';
                const parsed = Date.parse(raw);
                if (Number.isNaN(parsed)) return <span className="dx-muted-line">-</span>;
                return (
                    <span className="dx-muted-line" title={raw}>
                        {formatRelativeTime(new Date(parsed).toISOString())}
                    </span>
                );
            },
        },
        {
            key: '__actions',
            header: '',
            sortable: false,
            hideable: false,
            // Fixed: the actions used to sit in an auto-width column, so a long
            // Created value pushed its own text underneath them.
            width: 132,
            className: 'text-right',
            render: (container) => {
                const containerId = getContainerId(container);
                const isRunning = isContainerRunning(container);
                const isProtected = isProtectedContainer(container);
                return (
                    <div className="dx-row-actions" onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="dx-row-action" onClick={() => openContainerLogs(container)} title={t('common.labels.logs', 'Logs')}>
                            <FileText size={13} />
                        </button>
                        {isRunning && !isRemote && (
                            <button type="button" className="dx-row-action" onClick={() => openContainerExec(container)} title={t('app.containersTab.exec', 'Exec')}>
                                <TerminalLucide size={13} />
                            </button>
                        )}
                        {isProtected ? (
                            <span className="dx-row-protected" title={t('app.containersTab.serverkitSystemContainerManagedByThe', 'ServerKit system container — managed by the panel, lifecycle controls are disabled')}>
                                <Lock size={11} /> {t('common.labels.system', 'System')}
                            </span>
                        ) : isRunning ? (
                            <>
                                <button type="button" className="dx-row-action" onClick={() => handleAction(containerId, 'restart')} title={t('common.actions.restart', 'Restart')}>
                                    <RotateCw size={13} />
                                </button>
                                <button type="button" className="dx-row-action is-danger" onClick={() => handleAction(containerId, 'stop')} title={t('common.actions.stop', 'Stop')}>
                                    <Square size={13} />
                                </button>
                            </>
                        ) : (
                            <>
                                <button type="button" className="dx-row-action is-success" onClick={() => handleAction(containerId, 'start')} title={t('common.actions.start', 'Start')}>
                                    <Play size={13} />
                                </button>
                                <button type="button" className="dx-row-action is-danger" onClick={() => handleAction(containerId, 'remove')} title={t('common.actions.remove', 'Remove')}>
                                    <Trash2 size={13} />
                                </button>
                            </>
                        )}
                    </div>
                );
            },
        },
    ];

    // The page-private half of a saved view. `showAll` belongs in it because it
    // is not a filter over the rows on screen — it changes the REQUEST
    // (`docker ps` vs `docker ps -a`), so a view that wants stopped containers
    // has to be able to ask for them.
    const viewPageState = useMemo(() => ({ showAll, search: searchTerm }), [showAll, searchTerm]);
    const applyViewPageState = useCallback((saved) => {
        if (saved.showAll !== undefined) setShowAll(!!saved.showAll);
        if (saved.search !== undefined) setSearchTerm(saved.search);
    }, []);

    // The only table on the /docker route (the other tabs render lists of their
    // own resources, not a second grid over these rows), so no urlScope.
    const chrome = useTableChrome({
        columns,
        rows: filteredContainers,
        viewPageKey: 'docker-containers',
        builtinViews: BUILTIN_VIEWS,
        noun: 'containers',
        sorts,
        setSorts,
        hiddenKeys,
        setHiddenKeys,
        groupBy,
        setGroupBy,
        pageState: viewPageState,
        applyPage: applyViewPageState,
    });

    if (loading) {
        return (
            <div className="dx-tab-pane">
                <div className="docker-loading">{t('app.containersTab.loadingContainers', 'Loading containers…')}</div>
            </div>
        );
    }

    return (
        <div className="dx-tab-pane dx-containers-pane">
            {/* One row of chrome. The view name is this pane's heading and
                everything that acts on the table — the fetch scope, the search,
                the filter, the "⋮" — rides the same line. This pane is inside
                the Docker page's tab group, whose top bar belongs to that page,
                so the chrome stays here rather than being hoisted (see
                useTopbarChrome). Refresh is not repeated as an icon: it is in
                the "⋮" with the other table-wide actions. */}
            <GridViewPicker
                views={chrome.views}
                label="containers"
                onCreate={chrome.createView}
                actions={(
                    <>
                        <label className="dx-toggle">
                            <input
                                type="checkbox"
                                checked={showAll}
                                onChange={(e) => setShowAll(e.target.checked)}
                            />
                            <span>{t('app.containersTab.includeStopped', 'Include stopped')}</span>
                        </label>
                        <SearchField
                            value={searchTerm}
                            onSearch={setSearchTerm}
                            placeholder={t('app.containersTab.filterNameImageOrId', 'Filter name, image, or ID…')}
                        />
                        <GridFilterButton
                            count={chrome.filterCount}
                            onClick={() => chrome.setDrawerOpen(true)}
                        />
                        <GridToolsMenu {...chrome.toolsProps} onRefresh={loadContainers} />
                    </>
                )}
            />

            <GridChips {...chrome.chipProps} />

            {/* Restart/stop/start across a selection. Remove is deliberately
                absent: bulk-deleting containers from a checkbox is a mistake
                you cannot undo, and the per-row action already asks. Protected
                system containers are skipped, not silently failed. */}
            <GridBulkBar count={picked.length} noun="container" onClear={() => setPicked([])}>
                <button type="button" onClick={() => handleBulkAction('restart')} disabled={bulkBusy}>
                    <RotateCw size={13} /> {t('common.actions.restart', 'Restart')}
                </button>
                <button type="button" onClick={() => handleBulkAction('stop')} disabled={bulkBusy}>
                    <Square size={13} /> {t('common.actions.stop', 'Stop')}
                </button>
                <button type="button" onClick={() => handleBulkAction('start')} disabled={bulkBusy}>
                    <Play size={13} /> {t('common.actions.start', 'Start')}
                </button>
            </GridBulkBar>

            {/* Only the SEARCH can empty the pane outright. A column rule that
                matches nothing keeps the table mounted — the header menu that
                undoes it lives in the header. */}
            {filteredContainers.length === 0 ? (
                <EmptyState
                    icon={Box}
                    title={containers.length === 0 ? t('app.containersTab.noContainers', 'No containers') : t('app.containersTab.noMatchingContainers', 'No matching containers')}
                    description={containers.length === 0
                        ? t('app.containersTab.runYourFirstContainerToSee', 'Run your first container to see it here.')
                        : t('app.containersTab.noContainersMatchTheCurrentSearch', 'No containers match the current search.')}
                />
            ) : (
                <div className="dx-manager-layout">
                    <section className="dx-resource-list">
                        <DataTable
                            {...chrome.tableProps}
                            columns={chrome.columns}
                            data={filteredContainers}
                            keyField={(container) => getContainerId(container)}
                            sorts={sorts}
                            onSortsChange={setSorts}
                            groupBy={groupBy}
                            onGroupByChange={setGroupBy}
                            selectable
                            selectedKeys={picked}
                            onToggleRow={toggleRow}
                            onToggleAll={toggleAll}
                            onRowClick={(container) => setSelectedContainer(container)}
                            rowClassName={(container) => (
                                `${isContainerRunning(container) ? 'is-running' : 'is-stopped'} ${getContainerId(selectedContainer) === getContainerId(container) ? 'is-selected' : ''}`
                            )}
                            className="dx-table-wrap"
                            tableClassName="dx-manager-table"
                            footer={(
                                <DataTableFooter
                                    shown={chrome.shownCount}
                                    total={containers.length}
                                    noun="container"
                                />
                            )}
                        />
                    </section>
                </div>
            )}

            {selectedContainer && (
                <ContainerInspector
                    container={selectedContainer}
                    stats={selectedStats}
                    onAction={handleAction}
                    onOpenLogs={openContainerLogs}
                    onOpenExec={openContainerExec}
                    onClose={() => setSelectedContainer(null)}
                />
            )}

            {logsContainer && (
                <ContainerLogsModal
                    container={logsContainer}
                    onClose={() => setLogsContainer(null)}
                />
            )}

            {execContainer && (
                <ContainerExecModal
                    container={execContainer}
                    onClose={() => setExecContainer(null)}
                />
            )}

            {/* The pane's only filter affordance beyond the per-column menus:
                there is no server-side filter drawer here, just the fetch-scope
                checkbox and the search. */}
            <GridFilterDrawer {...chrome.drawerProps} />
        </div>
    );
};

const maskEnvValue = (entry) => {
    const [key, ...rest] = String(entry).split('=');
    if (!rest.length) return entry;
    if (/pass|secret|token|key|credential/i.test(key)) {
        return `${key}=****`;
    }
    return entry;
};

const ContainerInspector = ({ container, stats, onAction, onOpenLogs, onOpenExec, onClose }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { serverId, isRemote } = useServer();
    const [details, setDetails] = useState(null);
    const [loading, setLoading] = useState(false);
    const [activeSection, setActiveSection] = useState('overview');
    const containerId = container ? getContainerId(container) : '';

    useEffect(() => {
        let mounted = true;
        let loadingTimer;

        async function loadDetails() {
            if (!container) {
                setDetails(null);
                return;
            }

            setLoading(true);
            loadingTimer = window.setTimeout(() => {
                if (mounted) setLoading(false);
            }, 2500);
            setActiveSection('overview');
            try {
                let data;
                if (isRemote) {
                    data = unwrapRemoteData(await api.getRemoteContainer(serverId, containerId));
                } else {
                    const result = await api.getContainer(containerId);
                    data = result.container || result;
                }
                if (mounted) setDetails(data || null);
            } catch (err) {
                console.error('Failed to inspect container:', err);
                if (mounted) setDetails(null);
            } finally {
                window.clearTimeout(loadingTimer);
                if (mounted) setLoading(false);
            }
        }

        loadDetails();
        return () => {
            mounted = false;
            window.clearTimeout(loadingTimer);
        };
    }, [container, containerId, serverId, isRemote]);

    if (!container) {
        return null;
    }

    const isRunning = isContainerRunning(container);
    const isProtected = isProtectedContainer(container);
    const ports = formatPorts(container.ports);
    const envVars = details?.Config?.Env || [];
    const mounts = details?.Mounts || [];
    const networks = Object.entries(details?.NetworkSettings?.Networks || {});
    const labels = details?.Config?.Labels || {};
    const restartPolicy = details?.HostConfig?.RestartPolicy?.Name || '-';
    const health = details?.State?.Health?.Status || getContainerStatusLabel(container);
    const projectName = getContainerProjectName(container, details);

    async function copyContainerId() {
        if (await copyToClipboard(containerId)) toast.success(t('app.containersTab.containerIdCopied', 'Container ID copied'));
        else toast.error(t('app.containersTab.couldNotCopyContainerId', 'Could not copy container ID'));
    }

    return (
        <>
        <div className="dx-drawer-backdrop" onClick={onClose} />
        <aside className="dx-inspector dx-inspector-drawer">
            <div className="dx-inspector-header">
                <div className="dx-inspector-icon">
                    <Box size={18} />
                </div>
                <div className="dx-inspector-title">
                    <h3 title={getContainerName(container)}>{getContainerName(container)}</h3>
                    <span>{shortId(containerId)}</span>
                </div>
                <button type="button" className="dx-row-action" onClick={copyContainerId} title={t('app.containersTab.copyContainerId', 'Copy container ID')}>
                    <Copy size={13} />
                </button>
                <button type="button" className="dx-row-action" onClick={onClose} title={t('app.containersTab.closeDetails', 'Close details')}>
                    <X size={13} />
                </button>
            </div>

            <div className="dx-inspector-status">
                <span className={`dx-status-pill ${isRunning ? 'running' : 'stopped'}`}>
                    {getContainerStatusLabel(container)}
                </span>
                <span>{health}</span>
            </div>

            <div className="dx-inspector-actions">
                <button type="button" className="dx-action-btn" onClick={() => onOpenLogs(container)}>
                    <FileText size={13} /> {t('common.labels.logs', 'Logs')}
                </button>
                {isRunning && !isRemote && (
                    <button type="button" className="dx-action-btn" onClick={() => onOpenExec(container)}>
                        <TerminalLucide size={13} /> {t('app.containersTab.exec', 'Exec')}
                    </button>
                )}
                {isProtected ? (
                    <span className="dx-action-protected" title={t('app.containersTab.serverkitSystemContainerManagedByThe', 'ServerKit system container — managed by the panel, lifecycle controls are disabled')}>
                        <Lock size={13} /> {t('app.containersTab.systemContainer', 'System container')}
                    </span>
                ) : isRunning ? (
                    <>
                        <button type="button" className="dx-action-btn" onClick={() => onAction(containerId, 'restart')}>
                            <RotateCw size={13} /> {t('common.actions.restart', 'Restart')}
                        </button>
                        <button type="button" className="dx-action-btn is-danger" onClick={() => onAction(containerId, 'stop')}>
                            <Square size={13} /> {t('common.actions.stop', 'Stop')}
                        </button>
                    </>
                ) : (
                    <>
                        <button type="button" className="dx-action-btn is-success" onClick={() => onAction(containerId, 'start')}>
                            <Play size={13} /> {t('common.actions.start', 'Start')}
                        </button>
                        <button type="button" className="dx-action-btn is-danger" onClick={() => onAction(containerId, 'remove')}>
                            <Trash2 size={13} /> {t('common.actions.remove', 'Remove')}
                        </button>
                    </>
                )}
            </div>

            <div className="dx-inspector-tabs">
                {['overview', 'ports', 'mounts', 'env'].map(section => (
                    <button type="button"
                        key={section}
                        className={activeSection === section ? 'active' : ''}
                        onClick={() => setActiveSection(section)}
                    >
                        {section}
                    </button>
                ))}
            </div>

            <div className="dx-inspector-body">
                {loading && <div className="dx-inspector-loading">{t('app.containersTab.inspectingContainer', 'Inspecting container…')}</div>}

                {activeSection === 'overview' && (
                    <>
                        <ContainerResourceBars stats={stats} muted={!isRunning} />
                        <div className="dx-detail-grid">
                            <div><span>{t('app.containersTab.image', 'Image')}</span><strong title={getContainerImage(container)}>{getContainerImage(container)}</strong></div>
                            <div><span>{t('common.labels.project', 'Project')}</span><strong>{projectName}</strong></div>
                            <div><span>{t('common.actions.restart', 'Restart')}</span><strong>{restartPolicy}</strong></div>
                            <div><span>{t('common.labels.created', 'Created')}</span><strong>{container.created || container.CreatedAt || '-'}</strong></div>
                        </div>
                        <div className="dx-section-title"><Gauge size={13} /> {t('app.containersTab.runtime', 'Runtime')}</div>
                        <div className="dx-details-list">
                            <span>{t('common.labels.status', 'Status')}</span><code>{getContainerStatus(container)}</code>
                            <span>PID</span><code>{details?.State?.Pid || '-'}</code>
                            <span>{t('app.containersTab.platform', 'Platform')}</span><code>{details?.Platform || details?.Os || '-'}</code>
                            <span>{t('app.containersTab.driver', 'Driver')}</span><code>{details?.Driver || '-'}</code>
                        </div>
                    </>
                )}

                {activeSection === 'ports' && (
                    <>
                        <div className="dx-section-title"><Activity size={13} /> {t('app.containersTab.publishedPorts', 'Published ports')}</div>
                        <div className="dx-inspector-list">
                            {ports.map((port, index) => (
                                <code key={index} className={port === '-' ? 'is-empty' : ''}>{port}</code>
                            ))}
                        </div>
                        <div className="dx-section-title"><ServerIcon size={13} /> {t('app.containersTab.networks', 'Networks')}</div>
                        <div className="dx-details-list">
                            {networks.length === 0 ? (
                                <>
                                    <span>{t('app.containersTab.networks', 'Networks')}</span><code>-</code>
                                </>
                            ) : networks.map(([name, network]) => (
                                <React.Fragment key={name}>
                                    <span>{name}</span>
                                    <code>{network?.IPAddress || network?.Gateway || '-'}</code>
                                </React.Fragment>
                            ))}
                        </div>
                    </>
                )}

                {activeSection === 'mounts' && (
                    <>
                        <div className="dx-section-title"><Database size={13} /> {t('app.containersTab.mountsAndVolumes', 'Mounts and volumes')}</div>
                        <div className="dx-inspector-list">
                            {mounts.length === 0 ? (
                                <code className="is-empty">{t('app.containersTab.noMounts', 'No mounts')}</code>
                            ) : mounts.map((mount, index) => (
                                <code key={index}>
                                    {mount.Name || mount.Source || '-'} -&gt; {mount.Destination || '-'}
                                </code>
                            ))}
                        </div>
                    </>
                )}

                {activeSection === 'env' && (
                    <>
                        <div className="dx-section-title"><Package size={13} /> {t('app.containersTab.environment', 'Environment')}</div>
                        <div className="dx-inspector-list">
                            {envVars.length === 0 ? (
                                <code className="is-empty">{t('app.containersTab.noEnvironmentVariables', 'No environment variables')}</code>
                            ) : envVars.slice(0, 24).map((entry, index) => (
                                <code key={index}>{maskEnvValue(entry)}</code>
                            ))}
                            {envVars.length > 24 && <code>+{envVars.length - 24} {t('app.containersTab.moreVariables', 'more variables')}</code>}
                        </div>
                        <div className="dx-section-title"><Clock3 size={13} /> {t('app.containersTab.labels', 'Labels')}</div>
                        <div className="dx-details-list">
                            {Object.keys(labels).length === 0 ? (
                                <>
                                    <span>{t('app.containersTab.labels', 'Labels')}</span><code>-</code>
                                </>
                            ) : Object.entries(labels).slice(0, 12).map(([key, value]) => (
                                <React.Fragment key={key}>
                                    <span title={key}>{key}</span>
                                    <code title={value}>{value}</code>
                                </React.Fragment>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </aside>
        </>
    );
};

const RunContainerModal = ({ onClose, onCreated }) => {
    const { t } = useTranslation();
    const [formData, setFormData] = useState({
        image: '',
        name: '',
        ports: '',
        volumes: '',
        env: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    function handleChange(e) {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const data = {
                image: formData.image,
                name: formData.name || undefined,
                ports: formData.ports ? formData.ports.split(',').map(p => p.trim()) : [],
                volumes: formData.volumes ? formData.volumes.split(',').map(v => v.trim()) : [],
                env: formData.env ? Object.fromEntries(
                    formData.env.split('\n').filter(l => l.includes('=')).map(l => {
                        const [key, ...rest] = l.split('=');
                        return [key.trim(), rest.join('=').trim()];
                    })
                ) : {},
            };

            await api.runContainer(data);
            onCreated();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to run container');
        } finally {
            setLoading(false);
        }
    }

    return (
        <Modal open onClose={onClose} title={t('app.containersTab.runContainer2', 'Run Container')} size="md">
            {error && <div className="error-message">{error}</div>}

            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>{t('app.containersTab.image3', 'Image *')}</label>
                    <Input
                        type="text"
                        name="image"
                        value={formData.image}
                        onChange={handleChange}
                        placeholder="nginx:latest"
                        required
                    />
                </div>

                <div className="form-group">
                    <label>{t('app.containersTab.containerName', 'Container Name')}</label>
                    <Input
                        type="text"
                        name="name"
                        value={formData.name}
                        onChange={handleChange}
                        placeholder="my-container"
                    />
                </div>

                <div className="form-group">
                    <label>{t('app.containersTab.portsCommaSeparated', 'Ports (comma-separated)')}</label>
                    <Input
                        type="text"
                        name="ports"
                        value={formData.ports}
                        onChange={handleChange}
                        placeholder="8080:80, 443:443"
                    />
                </div>

                <div className="form-group">
                    <label>{t('app.containersTab.volumesCommaSeparated', 'Volumes (comma-separated)')}</label>
                    <Input
                        type="text"
                        name="volumes"
                        value={formData.volumes}
                        onChange={handleChange}
                        placeholder="/host/path:/container/path"
                    />
                </div>

                <div className="form-group">
                    <label>{t('app.containersTab.environmentVariablesOnePerLineKey', 'Environment Variables (one per line, KEY=value)')}</label>
                    <Textarea
                        name="env"
                        value={formData.env}
                        onChange={handleChange}
                        placeholder={t('app.containersTab.nodeEnvProductionApiKeyXxx', 'NODE_ENV=production\nAPI_KEY=xxx')}
                        rows={4}
                    />
                </div>

                <div className="modal-actions">
                    <Button type="button" variant="outline" onClick={onClose}>
                        {t('common.actions.cancel', 'Cancel')}
                    </Button>
                    <Button type="submit" disabled={loading}>
                        {loading ? 'Running...' : 'Run Container'}
                    </Button>
                </div>
            </form>
        </Modal>
    );
};

const ContainerLogsModal = ({ container, onClose }) => {
    const { t } = useTranslation();
    const { serverId, isRemote } = useServer();
    const containerId = getContainerId(container);
    const [logs, setLogs] = useState('');
    const [loading, setLoading] = useState(true);
    const [tail, setTail] = useState(200);
    const [searchPattern, setSearchPattern] = useState('');
    const [appliedSearch, setAppliedSearch] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [showLineNumbers, setShowLineNumbers] = useState(true);
    const [wrapLines, setWrapLines] = useState(true);
    const contentRef = useRef(null);

    useEffect(() => {
        loadLogs();
    }, [container, tail]); // eslint-disable-line

    usePolling(() => loadLogs(false), LOG_TAIL_MS, {
        enabled: autoRefresh,
        immediate: false,
    });

    async function loadLogs(showSpinner = true) {
        if (showSpinner) setLoading(true);
        try {
            let data;
            if (isRemote) {
                const result = await api.getRemoteContainerLogs(serverId, containerId, tail);
                data = unwrapRemoteData(result);
            } else {
                data = await api.getContainerLogs(containerId, tail);
            }
            setLogs(data.logs || '');
            if (autoRefresh && contentRef.current) {
                contentRef.current.scrollTop = contentRef.current.scrollHeight;
            }
        } catch (err) {
            setLogs('Failed to load logs: ' + (err.message || 'Unknown error'));
        } finally {
            setLoading(false);
        }
    }

    function handleDownload() {
        if (!logs) return;
        downloadBlob(logs, `${container.name}-${Date.now()}.log`);
    }

    return (
        // The shared DS drawer. (The container INSPECTOR next door stays on the
        // `dx-*` classes — that is the Docker workspace's own language.)
        <Drawer
            open
            onOpenChange={(open) => { if (!open) onClose(); }}
            title={getContainerName(container)}
            subtitle={`${getContainerImage(container)} · ${shortId(containerId)}`}
            icon={<Box size={18} />}
            width={520}
            flush
        >
                <div className="preview-drawer-meta">
                    <div className="meta-item">
                        <span className="meta-label">{t('common.labels.status', 'Status')}</span>
                        <span className="meta-value">{getContainerStatus(container)}</span>
                    </div>
                    <div className="meta-item">
                        <span className="meta-label">{t('app.containersTab.image', 'Image')}</span>
                        <span className="meta-value mono">{getContainerImage(container)}</span>
                    </div>
                    <div className="meta-item meta-item-wide">
                        <span className="meta-label">ID</span>
                        <span className="meta-value mono">{containerId}</span>
                    </div>
                    {container.ports && container.ports.length > 0 && (
                        <div className="meta-item meta-item-wide">
                            <span className="meta-label">{t('app.containersTab.ports', 'Ports')}</span>
                            <span className="meta-value mono">{formatPorts(container.ports).join(', ')}</span>
                        </div>
                    )}
                </div>

                <LogToolbar
                    searchPattern={searchPattern}
                    onSearchChange={setSearchPattern}
                    onSearchSubmit={() => setAppliedSearch(searchPattern)}
                    onSearchClear={() => { setSearchPattern(''); setAppliedSearch(''); }}
                    lineCount={tail}
                    onLineCountChange={(n) => setTail(n)}
                    autoRefresh={autoRefresh}
                    onAutoRefreshToggle={() => setAutoRefresh(!autoRefresh)}
                    showLineNumbers={showLineNumbers}
                    onToggleLineNumbers={() => setShowLineNumbers(!showLineNumbers)}
                    wrapLines={wrapLines}
                    onToggleWrap={() => setWrapLines(!wrapLines)}
                    isFullscreen={false}
                    onToggleFullscreen={() => {}}
                    onRefresh={() => loadLogs()}
                    onDownload={handleDownload}
                    onClear={() => {}}
                    onScrollToBottom={() => {
                        if (contentRef.current) contentRef.current.scrollTop = contentRef.current.scrollHeight;
                    }}
                    canAct={true}
                />

                <div className="preview-drawer-body">
                    <LogContent
                        ref={contentRef}
                        content={logs}
                        loading={loading}
                        emptyMessage={t('app.containersTab.noLogOutput', 'No log output.')}
                        showLineNumbers={showLineNumbers}
                        wrapLines={wrapLines}
                        searchPattern={appliedSearch}
                    />
                </div>
        </Drawer>
    );
};

const ContainerExecModal = ({ container, onClose }) => {
    const { t } = useTranslation();
    const containerId = getContainerId(container);
    const [command, setCommand] = useState('');
    const [output, setOutput] = useState([]);
    const [loading, setLoading] = useState(false);
    const [history, setHistory] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const outputRef = React.useRef(null);
    const inputRef = React.useRef(null);

    useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
        }
    }, []);

    useEffect(() => {
        if (outputRef.current) {
            outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
    }, [output]);

    async function executeCommand(e) {
        e.preventDefault();
        if (!command.trim() || loading) return;

        const cmd = command.trim();
        setOutput(prev => [...prev, { type: 'command', text: `$ ${cmd}` }]);
        setHistory(prev => [cmd, ...prev.slice(0, 49)]);
        setHistoryIndex(-1);
        setCommand('');
        setLoading(true);

        try {
            const result = await api.execContainer(containerId, cmd);
            const stdout = result.output ?? result.stdout;
            const stderr = result.error ?? result.stderr;
            const exitCode = result.exit_code ?? result.return_code;
            if (stdout) {
                setOutput(prev => [...prev, { type: 'output', text: stdout }]);
            }
            if (stderr) {
                setOutput(prev => [...prev, { type: 'error', text: stderr }]);
            }
            if (exitCode !== undefined && exitCode !== 0) {
                setOutput(prev => [...prev, { type: 'info', text: `Exit code: ${exitCode}` }]);
            }
        } catch (err) {
            setOutput(prev => [...prev, { type: 'error', text: err.message || 'Failed to execute command' }]);
        } finally {
            setLoading(false);
            if (inputRef.current) {
                inputRef.current.focus();
            }
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (history.length > 0 && historyIndex < history.length - 1) {
                const newIndex = historyIndex + 1;
                setHistoryIndex(newIndex);
                setCommand(history[newIndex]);
            }
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                setCommand(history[newIndex]);
            } else if (historyIndex === 0) {
                setHistoryIndex(-1);
                setCommand('');
            }
        }
    }

    function clearOutput() {
        setOutput([]);
    }

    return (
        <Modal open onClose={onClose} title={t('app.containersTab.exec3', 'Exec: {{value}}', { value: getContainerName(container) })} size="lg">
            <div className="modal-body exec-modal-body">
                <div className="exec-output" ref={outputRef}>
                    {output.length === 0 ? (
                        <div className="exec-welcome">
                            <p>{t('app.containersTab.executeCommandsInContainer', 'Execute commands in container')} <code>{getContainerName(container)}</code></p>
                            <p className="text-muted">{t('app.containersTab.typeACommandAndPressEnter', 'Type a command and press Enter')}</p>
                        </div>
                    ) : (
                        output.map((line, idx) => (
                            <div key={idx} className={`exec-line exec-${line.type}`}>
                                <pre>{line.text}</pre>
                            </div>
                        ))
                    )}
                    {loading && (
                        <div className="exec-line exec-loading">
                            <span className="spinner-inline"></span> {t('app.containersTab.running', 'Running…')}
                        </div>
                    )}
                </div>
                <form onSubmit={executeCommand} className="exec-input-form">
                    <span className="exec-prompt">$</span>
                    <input
                        ref={inputRef}
                        type="text"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={t('app.containersTab.enterCommand', 'Enter command…')}
                        className="exec-input"
                        disabled={loading}
                        autoComplete="off"
                        spellCheck="false"
                    />
                    <Button type="submit" size="sm" disabled={loading || !command.trim()}>
                        {t('app.containersTab.run', 'Run')}
                    </Button>
                </form>
            </div>
            <div className="modal-actions">
                <Button variant="outline" onClick={clearOutput}>{t('common.actions.clear', 'Clear')}</Button>
                <Button onClick={onClose}>{t('common.actions.close', 'Close')}</Button>
            </div>
        </Modal>
    );
};

export default ContainersTab;
