import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    useNodesState,
    useEdgesState,
    useReactFlow,
    addEdge,
    Background,
    Controls,
    MiniMap
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Server, Database, Globe, Box, Save, FolderOpen, Plus, RefreshCw, Play, Layout, Eye } from 'lucide-react';
import api from '../services/api';
import WorkflowListModal from '../components/workflow/WorkflowListModal';
import DeploymentProgressModal from '../components/workflow/DeploymentProgressModal';
import DockerAppNode from '../components/workflow/nodes/DockerAppNode';
import DatabaseNode from '../components/workflow/nodes/DatabaseNode';
import DomainNode from '../components/workflow/nodes/DomainNode';
import ServiceNode from '../components/workflow/nodes/ServiceNode';
import DockerAppConfigPanel from '../components/workflow/panels/DockerAppConfigPanel';
import DatabaseConfigPanel from '../components/workflow/panels/DatabaseConfigPanel';
import DomainConfigPanel from '../components/workflow/panels/DomainConfigPanel';
import ServiceConfigPanel from '../components/workflow/panels/ServiceConfigPanel';
import { isValidConnection as checkValidConnection, getConnectionError, getConnectionType } from '../utils/connectionRules';
import ConnectionEdge from '../components/workflow/ConnectionEdge';

const initialNodes = [];
const initialEdges = [];

const nodeTypes = {
    dockerApp: DockerAppNode,
    database: DatabaseNode,
    domain: DomainNode,
    service: ServiceNode
};

const nodeColorMap = {
    dockerApp: '#2496ed',
    database: '#f59e0b',
    domain: '#10b981',
    service: '#6366f1'
};

const edgeTypes = {
    connection: ConnectionEdge
};

let nodeId = 0;
const getId = () => `node_${nodeId++}`;

const NodePalette = ({ onAddNode, templates, onAddFromTemplate, existingApps, onAddExistingApp }) => {
    const [showTemplates, setShowTemplates] = useState(false);
    const [showExistingApps, setShowExistingApps] = useState(false);

    return (
        <div className="workflow-palette">
            <div className="palette-section">
                <div className="palette-header">Add Application</div>
                <button
                    className="palette-item palette-item-docker"
                    onClick={() => setShowTemplates(!showTemplates)}
                >
                    <Plus size={16} />
                    <span>From Template</span>
                </button>
                {showTemplates && templates.length > 0 && (
                    <div className="palette-submenu">
                        {templates.map((template) => (
                            <button
                                key={template.id}
                                className="palette-subitem"
                                onClick={() => {
                                    onAddFromTemplate(template);
                                    setShowTemplates(false);
                                }}
                            >
                                {template.name}
                            </button>
                        ))}
                    </div>
                )}
                {showTemplates && templates.length === 0 && (
                    <div className="palette-empty">No templates available</div>
                )}

                {existingApps.length > 0 && (
                    <>
                        <button
                            className="palette-item palette-item-service"
                            onClick={() => setShowExistingApps(!showExistingApps)}
                        >
                            <Server size={16} />
                            <span>Existing App</span>
                        </button>
                        {showExistingApps && (
                            <div className="palette-submenu">
                                {existingApps.map((app) => (
                                    <button
                                        key={app.id}
                                        className="palette-subitem"
                                        onClick={() => {
                                            onAddExistingApp(app);
                                            setShowExistingApps(false);
                                        }}
                                    >
                                        {app.name}
                                        <span className={`status-badge status-${app.status}`}>
                                            {app.status}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </>
                )}
            </div>

            <div className="palette-section">
                <div className="palette-header">Network</div>
                <button
                    className="palette-item palette-item-domain"
                    onClick={() => onAddNode('domain', { name: 'example.com', ssl: 'none', dnsStatus: 'pending' })}
                >
                    <Globe size={16} />
                    <span>Domain</span>
                </button>
            </div>

            <div className="palette-section palette-section-info">
                <div className="palette-hint">
                    Tip: Click "Server Overview" to see all your infrastructure with connections
                </div>
            </div>
        </div>
    );
};

const WorkflowCanvas = () => {
    const reactFlowWrapper = useRef(null);
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
    const [selectedNode, setSelectedNode] = useState(null);
    const [selectedEdge, setSelectedEdge] = useState(null);
    const [connectionError, setConnectionError] = useState(null);
    const { screenToFlowPosition, getViewport, setViewport, fitView } = useReactFlow();

    // Workflow state
    const [currentWorkflow, setCurrentWorkflow] = useState(null);
    const [workflowName, setWorkflowName] = useState('Untitled Workflow');
    const [isSaving, setIsSaving] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [showLoadModal, setShowLoadModal] = useState(false);
    const [saveMessage, setSaveMessage] = useState(null);

    // Server data state
    const [templates, setTemplates] = useState([]);
    const [allApps, setAllApps] = useState([]);
    const [appsInView, setAppsInView] = useState(new Set());

    // Deployment state
    const [isDeploying, setIsDeploying] = useState(false);
    const [showDeployModal, setShowDeployModal] = useState(false);
    const [deploymentResults, setDeploymentResults] = useState(null);

    const memoizedNodeTypes = useMemo(() => nodeTypes, []);
    const memoizedEdgeTypes = useMemo(() => edgeTypes, []);

    // Delete edge by ID
    const deleteEdge = useCallback((edgeId) => {
        setEdges((eds) => eds.filter((e) => e.id !== edgeId));
        setSelectedEdge(null);
    }, [setEdges]);

    // Fetch templates on mount
    useEffect(() => {
        const fetchTemplates = async () => {
            try {
                const response = await api.getTemplates();
                setTemplates(response.templates || []);
            } catch (error) {
                console.error('Failed to fetch templates:', error);
            }
        };
        fetchTemplates();
    }, []);

    // Fetch all apps for the existing apps list
    useEffect(() => {
        const fetchApps = async () => {
            try {
                const response = await api.getApps();
                setAllApps(response.apps || []);
            } catch (error) {
                console.error('Failed to fetch apps:', error);
            }
        };
        fetchApps();
    }, []);

    // Get apps not currently in the view
    const existingAppsNotInView = useMemo(() => {
        return allApps.filter(app => !appsInView.has(app.id));
    }, [allApps, appsInView]);

    // Load server overview - all infrastructure with connections
    const loadServerOverview = useCallback(async () => {
        setIsLoading(true);
        setSaveMessage(null);

        try {
            const [appsResponse, domainsResponse] = await Promise.all([
                api.getApps().catch(() => ({ apps: [] })),
                api.getDomains().catch(() => ({ domains: [] }))
            ]);

            const apps = appsResponse.apps || [];
            const domains = domainsResponse.domains || [];

            // Fetch databases for each Docker app in parallel
            const appDatabasePromises = apps
                .filter(app => app.app_type === 'docker')
                .map(app => api.getAppDatabases(app.id).catch(() => ({ databases: [] })));
            const appDatabaseResults = await Promise.all(appDatabasePromises);

            // Create a map of app_id to databases
            const appDatabasesMap = {};
            apps.filter(app => app.app_type === 'docker').forEach((app, index) => {
                appDatabasesMap[app.id] = appDatabaseResults[index]?.databases || [];
            });

            if (apps.length === 0 && domains.length === 0) {
                setSaveMessage('No infrastructure found - create an app first!');
                setTimeout(() => setSaveMessage(null), 4000);
                setIsLoading(false);
                return;
            }

            const importedNodes = [];
            const importedEdges = [];
            const appNodeIds = {};
            const domainNodeIds = {};

            // Layout configuration
            const GRID_SPACING_X = 320;
            const GRID_SPACING_Y = 180;
            const COLS = 3;
            const DOMAIN_OFFSET_Y = 150;

            // Reset node ID counter
            nodeId = 0;

            // Create app nodes
            apps.forEach((app, index) => {
                const col = index % COLS;
                const row = Math.floor(index / COLS);
                const nodeIdStr = getId();
                appNodeIds[app.id] = nodeIdStr;

                importedNodes.push({
                    id: nodeIdStr,
                    type: 'dockerApp',
                    position: {
                        x: 150 + col * GRID_SPACING_X,
                        y: 200 + row * GRID_SPACING_Y
                    },
                    data: {
                        name: app.name,
                        appId: app.id,
                        status: app.status || 'stopped',
                        port: app.port,
                        appType: app.app_type,
                        template: app.docker_image || app.app_type,
                        privateUrl: app.private_url_enabled ? `/p/${app.private_slug}` : null,
                        domains: app.domains || [],
                        isReal: true
                    }
                });
            });

            // Create domain nodes positioned above their connected apps
            const processedDomains = new Set();
            apps.forEach((app) => {
                if (app.domains && app.domains.length > 0) {
                    app.domains.forEach((domain, domIdx) => {
                        if (processedDomains.has(domain.id)) return;
                        processedDomains.add(domain.id);

                        const appNodeId = appNodeIds[app.id];
                        const appNode = importedNodes.find(n => n.id === appNodeId);
                        const domainNodeId = getId();
                        domainNodeIds[domain.id] = domainNodeId;

                        // Position domain above its app
                        importedNodes.push({
                            id: domainNodeId,
                            type: 'domain',
                            position: {
                                x: appNode.position.x + (domIdx * 80),
                                y: appNode.position.y - DOMAIN_OFFSET_Y
                            },
                            data: {
                                name: domain.name,
                                domainId: domain.id,
                                ssl: domain.ssl_enabled ? 'active' : 'none',
                                dnsStatus: 'propagated',
                                connectedAppId: app.id,
                                isReal: true
                            }
                        });

                        // Create edge from domain to app
                        importedEdges.push({
                            id: `edge_${domainNodeId}_${appNodeId}`,
                            source: domainNodeId,
                            target: appNodeId,
                            sourceHandle: 'output',
                            targetHandle: 'input',
                            type: 'connection',
                            animated: true,
                            data: {
                                sourceType: 'domain',
                                targetType: 'dockerApp',
                                connectionType: 'routes',
                                onDelete: deleteEdge
                            }
                        });
                    });
                }
            });

            // Add orphan domains (not connected to any app)
            const orphanDomains = domains.filter(d => !processedDomains.has(d.id));
            const appsRows = Math.ceil(apps.length / COLS);
            orphanDomains.forEach((domain, index) => {
                const col = index % COLS;
                const row = appsRows + 1 + Math.floor(index / COLS);
                const domainNodeId = getId();

                importedNodes.push({
                    id: domainNodeId,
                    type: 'domain',
                    position: {
                        x: 150 + col * GRID_SPACING_X,
                        y: 200 + row * GRID_SPACING_Y
                    },
                    data: {
                        name: domain.name,
                        domainId: domain.id,
                        ssl: domain.ssl_enabled ? 'active' : 'none',
                        dnsStatus: 'pending',
                        isOrphan: true,
                        isReal: true
                    }
                });
            });

            // Create database nodes below apps that have databases
            const DATABASE_OFFSET_Y = 180;
            let databaseCount = 0;
            apps.forEach((app) => {
                const databases = appDatabasesMap[app.id] || [];
                if (databases.length > 0) {
                    const appNodeId = appNodeIds[app.id];
                    const appNode = importedNodes.find(n => n.id === appNodeId);

                    databases.forEach((db, dbIdx) => {
                        const dbNodeId = getId();
                        databaseCount++;

                        // Position database below its app
                        importedNodes.push({
                            id: dbNodeId,
                            type: 'database',
                            position: {
                                x: appNode.position.x + (dbIdx * 200),
                                y: appNode.position.y + DATABASE_OFFSET_Y
                            },
                            data: {
                                name: db.database || db.name || 'Database',
                                type: db.type || 'mysql',
                                host: db.container || db.host || 'localhost',
                                port: db.port || '3306',
                                status: 'running',
                                connectedAppId: app.id,
                                containerName: db.container,
                                isReal: true
                            }
                        });

                        // Create edge from app's database handle to database node
                        importedEdges.push({
                            id: `edge_${appNodeId}_${dbNodeId}`,
                            source: appNodeId,
                            target: dbNodeId,
                            sourceHandle: 'database',
                            targetHandle: 'input',
                            type: 'connection',
                            animated: true,
                            data: {
                                sourceType: 'dockerApp',
                                targetType: 'database',
                                connectionType: 'uses',
                                onDelete: deleteEdge
                            }
                        });
                    });
                }
            });

            // Update state
            setNodes(importedNodes);
            setEdges(importedEdges);
            setAppsInView(new Set(apps.map(a => a.id)));
            setCurrentWorkflow(null);
            setWorkflowName('Server Overview');

            // Fit view after a short delay
            setTimeout(() => fitView({ padding: 0.2 }), 100);

            const dbMessage = databaseCount > 0 ? `, ${databaseCount} databases` : '';
            setSaveMessage(`Loaded ${apps.length} apps, ${domains.length} domains${dbMessage}`);
            setTimeout(() => setSaveMessage(null), 3000);

        } catch (error) {
            console.error('Failed to load server overview:', error);
            setSaveMessage('Failed to load infrastructure');
            setTimeout(() => setSaveMessage(null), 3000);
        } finally {
            setIsLoading(false);
        }
    }, [setNodes, setEdges, deleteEdge, fitView]);

    // Auto-load server overview on mount
    useEffect(() => {
        loadServerOverview();
    }, []);

    // Validate connections before allowing them
    const isValidConnection = useCallback((connection) => {
        return checkValidConnection(connection, nodes);
    }, [nodes]);

    // Save workflow
    const saveWorkflow = useCallback(async () => {
        setIsSaving(true);
        setSaveMessage(null);

        try {
            const viewport = getViewport();
            const serializableNodes = nodes.map(({ id, type, position, data }) => ({
                id, type, position,
                data: { ...data }
            }));
            const serializableEdges = edges.map(({ id, source, target, sourceHandle, targetHandle, type, animated, data }) => ({
                id, source, target, sourceHandle, targetHandle, type, animated,
                data: data ? { sourceType: data.sourceType, targetType: data.targetType, connectionType: data.connectionType } : undefined
            }));

            const workflowData = {
                name: workflowName,
                nodes: serializableNodes,
                edges: serializableEdges,
                viewport
            };

            if (currentWorkflow) {
                await api.updateWorkflow(currentWorkflow.id, workflowData);
                setSaveMessage('View saved');
            } else {
                const response = await api.createWorkflow(workflowData);
                setCurrentWorkflow(response.workflow);
                setSaveMessage('View created');
            }

            setTimeout(() => setSaveMessage(null), 3000);
        } catch (error) {
            console.error('Failed to save workflow:', error);
            setSaveMessage('Failed to save');
            setTimeout(() => setSaveMessage(null), 3000);
        } finally {
            setIsSaving(false);
        }
    }, [nodes, edges, workflowName, currentWorkflow, getViewport]);

    // Load workflow
    const loadWorkflow = useCallback((workflow) => {
        if (!workflow) return;

        setIsLoading(true);
        setShowLoadModal(false);

        try {
            const loadedNodes = (workflow.nodes || []).map((node) => ({
                ...node,
                data: { ...node.data }
            }));

            const loadedEdges = (workflow.edges || []).map((edge) => ({
                ...edge,
                data: {
                    ...(edge.data || {}),
                    onDelete: deleteEdge
                }
            }));

            const maxNodeId = loadedNodes.reduce((max, node) => {
                const numId = parseInt(node.id.replace('node_', ''), 10);
                return isNaN(numId) ? max : Math.max(max, numId);
            }, 0);
            nodeId = maxNodeId + 1;

            // Track which apps are in view
            const appIds = new Set();
            loadedNodes.forEach(node => {
                if (node.data?.appId) appIds.add(node.data.appId);
            });
            setAppsInView(appIds);

            setNodes(loadedNodes);
            setEdges(loadedEdges);
            setWorkflowName(workflow.name || 'Untitled Workflow');
            setCurrentWorkflow(workflow);

            if (workflow.viewport) {
                setTimeout(() => setViewport(workflow.viewport), 50);
            }

            setSaveMessage(`Loaded: ${workflow.name}`);
            setTimeout(() => setSaveMessage(null), 3000);
        } catch (error) {
            console.error('Failed to load workflow:', error);
            setSaveMessage('Failed to load');
            setTimeout(() => setSaveMessage(null), 3000);
        } finally {
            setIsLoading(false);
        }
    }, [setNodes, setEdges, setViewport, deleteEdge]);

    // Create new workflow
    const newWorkflow = useCallback(() => {
        setNodes([]);
        setEdges([]);
        setCurrentWorkflow(null);
        setWorkflowName('Custom View');
        setAppsInView(new Set());
        nodeId = 0;
    }, [setNodes, setEdges]);

    // Add node from template (placeholder - would create app via API)
    const addFromTemplate = useCallback((template) => {
        setSaveMessage(`To create from "${template.name}", use the Applications page`);
        setTimeout(() => setSaveMessage(null), 4000);
    }, []);

    // Add existing app to view
    const addExistingApp = useCallback((app) => {
        const newNode = {
            id: getId(),
            type: 'dockerApp',
            position: screenToFlowPosition({
                x: window.innerWidth / 2 - 90,
                y: window.innerHeight / 2 - 50
            }),
            data: {
                name: app.name,
                appId: app.id,
                status: app.status || 'stopped',
                port: app.port,
                appType: app.app_type,
                template: app.docker_image || app.app_type,
                privateUrl: app.private_url_enabled ? `/p/${app.private_slug}` : null,
                domains: app.domains || [],
                isReal: true
            }
        };

        setNodes((nds) => [...nds, newNode]);
        setAppsInView((prev) => new Set([...prev, app.id]));

        // Add edges for connected domains if they're in view
        if (app.domains && app.domains.length > 0) {
            app.domains.forEach(domain => {
                // Find if domain node exists
                const domainNode = nodes.find(n => n.data?.domainId === domain.id);
                if (domainNode) {
                    const newEdge = {
                        id: `edge_${domainNode.id}_${newNode.id}`,
                        source: domainNode.id,
                        target: newNode.id,
                        sourceHandle: 'output',
                        targetHandle: 'input',
                        type: 'connection',
                        animated: true,
                        data: {
                            sourceType: 'domain',
                            targetType: 'dockerApp',
                            connectionType: 'routes',
                            onDelete: deleteEdge
                        }
                    };
                    setEdges((eds) => [...eds, newEdge]);
                }
            });
        }
    }, [screenToFlowPosition, setNodes, setEdges, nodes, deleteEdge]);

    // Deploy workflow
    const deployWorkflow = useCallback(async () => {
        if (!currentWorkflow) {
            setSaveMessage('Save as custom view first');
            setTimeout(() => setSaveMessage(null), 3000);
            return;
        }

        if (nodes.length === 0) {
            setSaveMessage('No nodes to deploy');
            setTimeout(() => setSaveMessage(null), 3000);
            return;
        }

        setIsDeploying(true);
        setShowDeployModal(true);
        setDeploymentResults(null);

        try {
            const viewport = getViewport();
            const serializableNodes = nodes.map(({ id, type, position, data }) => ({
                id, type, position,
                data: { ...data }
            }));
            const serializableEdges = edges.map(({ id, source, target, sourceHandle, targetHandle, type, animated, data }) => ({
                id, source, target, sourceHandle, targetHandle, type, animated,
                data: data ? { sourceType: data.sourceType, targetType: data.targetType, connectionType: data.connectionType } : undefined
            }));

            await api.updateWorkflow(currentWorkflow.id, {
                name: workflowName,
                nodes: serializableNodes,
                edges: serializableEdges,
                viewport
            });

            const result = await api.deployWorkflow(currentWorkflow.id);
            setDeploymentResults(result);

            if (result.workflow && result.workflow.nodes) {
                const updatedNodes = result.workflow.nodes.map((node) => ({
                    ...node,
                    data: { ...node.data }
                }));

                const maxNodeId = updatedNodes.reduce((max, node) => {
                    const numId = parseInt(node.id.replace('node_', ''), 10);
                    return isNaN(numId) ? max : Math.max(max, numId);
                }, 0);
                nodeId = maxNodeId + 1;

                setNodes(updatedNodes);
                setCurrentWorkflow(result.workflow);
            }

        } catch (error) {
            console.error('Failed to deploy workflow:', error);
            setDeploymentResults({
                success: false,
                error: error.message || 'Deployment failed',
                results: [],
                errors: [{ error: error.message || 'Deployment failed' }]
            });
        } finally {
            setIsDeploying(false);
        }
    }, [currentWorkflow, nodes, edges, workflowName, getViewport, setNodes]);

    const onConnect = useCallback(
        (params) => {
            if (checkValidConnection(params, nodes)) {
                const sourceNode = nodes.find(n => n.id === params.source);
                const targetNode = nodes.find(n => n.id === params.target);
                const connectionType = getConnectionType(sourceNode?.type, targetNode?.type);

                const newEdge = {
                    ...params,
                    type: 'connection',
                    animated: true,
                    data: {
                        sourceType: sourceNode?.type,
                        targetType: targetNode?.type,
                        connectionType,
                        onDelete: deleteEdge
                    }
                };
                setEdges((eds) => addEdge(newEdge, eds));
                setConnectionError(null);
            }
        },
        [setEdges, nodes, deleteEdge]
    );

    const onConnectStart = useCallback(() => {
        setConnectionError(null);
    }, []);

    const onConnectEnd = useCallback((event, connectionState) => {
        if (connectionState.isValid === false && connectionState.toNode) {
            const error = getConnectionError({
                source: connectionState.fromNode?.id,
                target: connectionState.toNode?.id,
                sourceHandle: connectionState.fromHandle?.id,
                targetHandle: connectionState.toHandle?.id
            }, nodes);
            if (error) {
                setConnectionError(error);
                setTimeout(() => setConnectionError(null), 3000);
            }
        }
    }, [nodes]);

    const addNode = useCallback((nodeType, defaultData = {}) => {
        const newNode = {
            id: getId(),
            type: nodeType,
            position: screenToFlowPosition({
                x: window.innerWidth / 2 - 90,
                y: window.innerHeight / 2 - 50
            }),
            data: defaultData
        };
        setNodes((nds) => [...nds, newNode]);
    }, [screenToFlowPosition, setNodes]);

    const getNodeColor = useCallback((node) => {
        return nodeColorMap[node.type] || '#6366f1';
    }, []);

    const handleNodeClick = useCallback((event, node) => {
        setSelectedNode(node);
        setSelectedEdge(null);
    }, []);

    const handleEdgeClick = useCallback((event, edge) => {
        setSelectedEdge(edge);
        setSelectedNode(null);
    }, []);

    const handlePaneClick = useCallback(() => {
        setSelectedNode(null);
        setSelectedEdge(null);
    }, []);

    const handleKeyDown = useCallback((event) => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdge) {
            deleteEdge(selectedEdge.id);
        }
    }, [selectedEdge, deleteEdge]);

    React.useEffect(() => {
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleKeyDown]);

    const handlePanelClose = useCallback(() => {
        setSelectedNode(null);
    }, []);

    const handleNodeDataChange = useCallback((newData) => {
        if (!selectedNode) return;

        setNodes((nds) =>
            nds.map((node) =>
                node.id === selectedNode.id
                    ? { ...node, data: newData }
                    : node
            )
        );

        setSelectedNode((prev) => prev ? { ...prev, data: newData } : null);
    }, [selectedNode, setNodes]);

    const renderConfigPanel = () => {
        if (!selectedNode) return null;

        const panelProps = {
            node: selectedNode,
            onChange: handleNodeDataChange,
            onClose: handlePanelClose
        };

        switch (selectedNode.type) {
            case 'dockerApp':
                return <DockerAppConfigPanel {...panelProps} />;
            case 'database':
                return <DatabaseConfigPanel {...panelProps} />;
            case 'domain':
                return <DomainConfigPanel {...panelProps} />;
            case 'service':
                return <ServiceConfigPanel {...panelProps} />;
            default:
                return null;
        }
    };

    return (
        <div className="workflow-canvas" ref={reactFlowWrapper}>
            <div className="workflow-toolbar">
                <div className="toolbar-left">
                    <input
                        type="text"
                        className="workflow-name-input"
                        value={workflowName}
                        onChange={(e) => setWorkflowName(e.target.value)}
                        placeholder="View name..."
                    />
                    {currentWorkflow && (
                        <span className="workflow-id-badge">Saved View</span>
                    )}
                </div>
                <div className="toolbar-right">
                    <button
                        className="toolbar-btn toolbar-btn-overview"
                        onClick={loadServerOverview}
                        disabled={isLoading}
                        title="Load full server infrastructure"
                    >
                        <Eye size={16} />
                        <span>{isLoading ? 'Loading...' : 'Server Overview'}</span>
                    </button>
                    <button
                        className="toolbar-btn"
                        onClick={newWorkflow}
                        title="New custom view"
                    >
                        <Plus size={16} />
                        <span>New View</span>
                    </button>
                    <button
                        className="toolbar-btn"
                        onClick={() => setShowLoadModal(true)}
                        title="Load saved view"
                    >
                        <FolderOpen size={16} />
                        <span>Load</span>
                    </button>
                    <button
                        className="toolbar-btn toolbar-btn-primary"
                        onClick={saveWorkflow}
                        disabled={isSaving}
                        title="Save current view"
                    >
                        <Save size={16} />
                        <span>{isSaving ? 'Saving...' : 'Save View'}</span>
                    </button>
                </div>
                {saveMessage && (
                    <div className="toolbar-message">{saveMessage}</div>
                )}
            </div>
            <NodePalette
                onAddNode={addNode}
                templates={templates}
                onAddFromTemplate={addFromTemplate}
                existingApps={existingAppsNotInView}
                onAddExistingApp={addExistingApp}
            />
            {connectionError && (
                <div className="connection-error-toast">
                    {connectionError}
                </div>
            )}
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={memoizedNodeTypes}
                edgeTypes={memoizedEdgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onConnectStart={onConnectStart}
                onConnectEnd={onConnectEnd}
                isValidConnection={isValidConnection}
                onNodeClick={handleNodeClick}
                onEdgeClick={handleEdgeClick}
                onPaneClick={handlePaneClick}
                fitView
                panOnScroll
                selectionOnDrag
                panOnDrag={[1, 2]}
                selectNodesOnDrag={false}
                defaultEdgeOptions={{
                    type: 'connection',
                    animated: true
                }}
            >
                <Background
                    variant="dots"
                    gap={20}
                    size={1}
                    color="#333"
                />
                <Controls
                    showZoom={true}
                    showFitView={true}
                    showInteractive={false}
                />
                <MiniMap
                    nodeColor={getNodeColor}
                    maskColor="rgba(0, 0, 0, 0.8)"
                    style={{
                        backgroundColor: '#1a1a1e'
                    }}
                />
            </ReactFlow>
            {renderConfigPanel()}
            {showLoadModal && (
                <WorkflowListModal
                    onLoad={loadWorkflow}
                    onClose={() => setShowLoadModal(false)}
                />
            )}
            {showDeployModal && (
                <DeploymentProgressModal
                    isDeploying={isDeploying}
                    results={deploymentResults}
                    nodes={nodes}
                    onClose={() => setShowDeployModal(false)}
                />
            )}
        </div>
    );
};

const WorkflowBuilder = () => {
    return (
        <div className="workflow-page fullscreen">
            <ReactFlowProvider>
                <WorkflowCanvas />
            </ReactFlowProvider>
        </div>
    );
};

export default WorkflowBuilder;
