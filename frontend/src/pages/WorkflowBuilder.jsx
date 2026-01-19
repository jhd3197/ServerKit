import React, { useCallback } from 'react';
import {
    ReactFlow,
    ReactFlowProvider,
    useNodesState,
    useEdgesState,
    addEdge,
    Background,
    Controls,
    MiniMap
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

const initialNodes = [];
const initialEdges = [];

const WorkflowCanvas = () => {
    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
    const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

    const onConnect = useCallback(
        (params) => setEdges((eds) => addEdge(params, eds)),
        [setEdges]
    );

    return (
        <div className="workflow-canvas">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                fitView
                panOnScroll
                selectionOnDrag
                panOnDrag={[1, 2]}
                selectNodesOnDrag={false}
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
