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
import { Server, Database, Globe } from 'lucide-react';
import BaseNode from '../components/workflow/BaseNode';

const initialNodes = [];
const initialEdges = [];

const nodeTypes = {
    base: BaseNode
};

let nodeId = 0;
const getId = () => `node_${nodeId++}`;

const NodeToolbar = ({ onAddNode }) => {
    return (
        <div className="workflow-toolbar">
            <button
                className="workflow-toolbar-btn toolbar-btn-docker"
                onClick={() => onAddNode('docker')}
            >
                <Server size={16} />
                Docker App
            </button>
            <button
                className="workflow-toolbar-btn toolbar-btn-database"
                onClick={() => onAddNode('database')}
            >
                <Database size={16} />
                Database
            </button>
            <button
                className="workflow-toolbar-btn toolbar-btn-domain"
                onClick={() => onAddNode('domain')}
            >
                <Globe size={16} />
                Domain
            </button>
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

    const addNode = useCallback((nodeType) => {
        const newNode = {
            id: getId(),
            type: 'base',
            position: screenToFlowPosition({
                x: window.innerWidth / 2 - 90,
                y: window.innerHeight / 2 - 50
            }),
            data: {
                label: `New ${nodeType.charAt(0).toUpperCase() + nodeType.slice(1)}`,
                nodeType: nodeType
            }
        };
        setNodes((nds) => [...nds, newNode]);
    }, [screenToFlowPosition, setNodes]);

    return (
        <div className="workflow-canvas" ref={reactFlowWrapper}>
            <NodeToolbar onAddNode={addNode} />
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
                    nodeColor="#6366f1"
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
