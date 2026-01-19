import React, { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from '@xyflow/react';
import { X } from 'lucide-react';
import { connectionLabels, connectionColors, getConnectionType } from '../../utils/connectionRules';

const ConnectionEdge = ({
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    source,
    target,
    sourceHandleId,
    selected,
    data,
    markerEnd
}) => {
    const [edgePath, labelX, labelY] = getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        borderRadius: 8
    });

    // Get connection type from data or derive from source/target
    const connectionType = data?.connectionType || getConnectionType(
        data?.sourceType || 'dockerApp',
        data?.targetType || 'dockerApp'
    );

    const label = connectionLabels[connectionType] || 'Connected';
    const color = connectionColors[connectionType] || '#6366f1';

    return (
        <>
            <BaseEdge
                id={id}
                path={edgePath}
                markerEnd={markerEnd}
                style={{
                    stroke: selected ? '#fff' : color,
                    strokeWidth: selected ? 2 : 1.5,
                    filter: selected ? 'drop-shadow(0 0 4px rgba(255,255,255,0.5))' : 'none'
                }}
            />
            <EdgeLabelRenderer>
                <div
                    className={`edge-label ${selected ? 'edge-label-selected' : ''}`}
                    style={{
                        position: 'absolute',
                        transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
                        pointerEvents: 'all',
                        backgroundColor: selected ? '#fff' : color
                    }}
                >
                    <span className="edge-label-text">{label}</span>
                    {selected && data?.onDelete && (
                        <button
                            className="edge-delete-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                data.onDelete(id);
                            }}
                        >
                            <X size={12} />
                        </button>
                    )}
                </div>
            </EdgeLabelRenderer>
        </>
    );
};

export default memo(ConnectionEdge);
