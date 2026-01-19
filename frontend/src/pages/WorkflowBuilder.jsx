import React, { useCallback, useMemo, useRef } from 'react';
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
    const { screenToFlowPosition } = useReactFlow();

    const memoizedNodeTypes = useMemo(() => nodeTypes, []);

    const onConnect = useCallback(
        (params) => setEdges((eds) => addEdge(params, eds)),
        [setEdges]
    );

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

    return (
        <div className="workflow-canvas" ref={reactFlowWrapper}>
            <NodePalette onAddNode={addNode} />
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={memoizedNodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                fitView
                panOnScroll
                selectionOnDrag
                panOnDrag={[1, 2]}
                selectNodesOnDrag={false}
                defaultEdgeOptions={{
                    type: 'smoothstep',
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
