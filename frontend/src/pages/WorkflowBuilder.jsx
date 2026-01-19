import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { Server, Database, Globe, Box } from 'lucide-react';
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

const NodePalette = ({ onAddNode }) => {
    return (
        <div className="workflow-palette">
            <div className="palette-section">
                <div className="palette-header">Compute</div>
                <button
                    className="palette-item palette-item-docker"
                    onClick={() => onAddNode('dockerApp', { name: 'New App', status: 'stopped' })}
                >
                    <Server size={16} />
                    <span>Docker App</span>
                </button>
                <button
                    className="palette-item palette-item-service"
                    onClick={() => onAddNode('service', { name: 'New Service', status: 'stopped' })}
                >
                    <Box size={16} />
                    <span>Service</span>
                </button>
            </div>

            <div className="palette-section">
                <div className="palette-header">Storage</div>
                <button
                    className="palette-item palette-item-database"
                    onClick={() => onAddNode('database', { name: 'New Database', type: 'mysql', status: 'stopped' })}
                >
                    <Database size={16} />
                    <span>MySQL</span>
                </button>
                <button
                    className="palette-item palette-item-database"
                    onClick={() => onAddNode('database', { name: 'New Database', type: 'postgresql', status: 'stopped' })}
                >
                    <Database size={16} />
                    <span>PostgreSQL</span>
                </button>
                <button
                    className="palette-item palette-item-database"
                    onClick={() => onAddNode('database', { name: 'New Database', type: 'mongodb', status: 'stopped' })}
                >
                    <Database size={16} />
                    <span>MongoDB</span>
                </button>
                <button
                    className="palette-item palette-item-database"
                    onClick={() => onAddNode('database', { name: 'Cache', type: 'redis', status: 'stopped' })}
                >
                    <Database size={16} />
                    <span>Redis</span>
                </button>
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
    const { screenToFlowPosition } = useReactFlow();

    const memoizedNodeTypes = useMemo(() => nodeTypes, []);
    const memoizedEdgeTypes = useMemo(() => edgeTypes, []);

    // Validate connections before allowing them
    const isValidConnection = useCallback((connection) => {
        return checkValidConnection(connection, nodes);
    }, [nodes]);

    // Delete edge by ID
    const deleteEdge = useCallback((edgeId) => {
        setEdges((eds) => eds.filter((e) => e.id !== edgeId));
        setSelectedEdge(null);
    }, [setEdges]);

    const onConnect = useCallback(
        (params) => {
            // Double-check validation on connect
            if (checkValidConnection(params, nodes)) {
                // Find source and target node types
                const sourceNode = nodes.find(n => n.id === params.source);
                const targetNode = nodes.find(n => n.id === params.target);
                const connectionType = getConnectionType(sourceNode?.type, targetNode?.type);

                // Create edge with metadata
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
        // Show error if connection was attempted but failed validation
        if (connectionState.isValid === false && connectionState.toNode) {
            const error = getConnectionError({
                source: connectionState.fromNode?.id,
                target: connectionState.toNode?.id,
                sourceHandle: connectionState.fromHandle?.id,
                targetHandle: connectionState.toHandle?.id
            }, nodes);
            if (error) {
                setConnectionError(error);
                // Clear error after 3 seconds
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

    // Handle Delete key press for selected edge
    const handleKeyDown = useCallback((event) => {
        if ((event.key === 'Delete' || event.key === 'Backspace') && selectedEdge) {
            deleteEdge(selectedEdge.id);
        }
    }, [selectedEdge, deleteEdge]);

    // Attach keydown listener
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

        // Update selectedNode reference to reflect changes
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
            <NodePalette onAddNode={addNode} />
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
        </div>
    );
};

const WorkflowBuilder = () => {
    return (
        <div className="workflow-page">
            <div className="page-header">
                <h1>Workflow Builder</h1>
                <p className="page-subtitle">
                    Visual orchestration for your infrastructure
                </p>
            </div>
            <ReactFlowProvider>
                <WorkflowCanvas />
            </ReactFlowProvider>
        </div>
    );
};

export default WorkflowBuilder;
