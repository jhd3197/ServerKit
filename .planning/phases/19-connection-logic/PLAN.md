# Phase 19: Connection Logic - Execution Plan

## Goal
Define and validate connections between nodes, with visual feedback for valid/invalid connections and the ability to view, edit, and delete connections.

## Prerequisites
- Phase 18 completed (Node Configuration Panels)
- Node components have defined handles:
  - DockerAppNode: input (left), output (right), database (bottom)
  - DatabaseNode: input (left) only
  - DomainNode: output (right) only
  - ServiceNode: input (left), output (right)

## Connection Rules

Valid connection types:
| Source Node | Source Handle | Target Node | Target Handle | Meaning |
|-------------|---------------|-------------|---------------|---------|
| domain | output | dockerApp | input | Domain routes to app |
| dockerApp | database | database | input | App connects to database |
| dockerApp | output | dockerApp | input | App-to-app connection |
| service | output | dockerApp | input | Service connects to app |
| service | output | database | input | Service connects to database |

Invalid connections:
- Database to anything (no source handles)
- Anything to domain (no target handles)
- Self-connections

## Tasks

### Task 1: Create Connection Validation Utility
**File**: `frontend/src/utils/connectionRules.js`

Create validation logic for connections:
- `isValidConnection(connection, nodes)` - returns boolean
- `getConnectionError(connection, nodes)` - returns error message or null
- Define connection rules matrix
- Check source/target node types and handle IDs

### Task 2: Implement isValidConnection Callback
**File**: `frontend/src/pages/WorkflowBuilder.jsx`

Wire validation to ReactFlow:
- Import connection validation utility
- Pass `isValidConnection` prop to ReactFlow
- This prevents invalid connections from being created

### Task 3: Add Visual Feedback for Connection Attempts
**File**: `frontend/src/pages/WorkflowBuilder.jsx`

Show feedback during drag:
- Use `onConnectStart` and `onConnectEnd` callbacks
- Track connecting state
- Show visual indicator when hovering over invalid targets
- Add toast/tooltip for why connection is invalid

### Task 4: Create Custom Edge Component
**File**: `frontend/src/components/workflow/ConnectionEdge.jsx`

Custom edge with metadata display:
- Extend smoothstep edge
- Show connection type label on hover
- Delete button on selection
- Different colors by connection type

### Task 5: Add Edge Click to Select
**File**: `frontend/src/pages/WorkflowBuilder.jsx`

Enable edge selection and deletion:
- Track selectedEdge state
- onEdgeClick handler
- Delete key handler for selected edge
- Context menu option for delete

### Task 6: Add Connection Styles
**File**: `frontend/src/styles/pages/_workflow.less`

Style the connection system:
- Valid connection hover glow on handles
- Invalid connection red highlight
- Selected edge styling
- Connection type colors
- Edge label styling

## Success Criteria
- [ ] Can only create valid connections
- [ ] Invalid connections show error feedback
- [ ] Connections display relevant metadata
- [ ] Can edit and delete connections

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/utils/connectionRules.js` | Create | Connection validation logic |
| `frontend/src/components/workflow/ConnectionEdge.jsx` | Create | Custom edge component |
| `frontend/src/pages/WorkflowBuilder.jsx` | Modify | Wire validation, selection, deletion |
| `frontend/src/styles/pages/_workflow.less` | Modify | Connection styles |

## Technical Notes

- React Flow `isValidConnection` prop receives `{ source, target, sourceHandle, targetHandle }`
- Custom edges receive `{ id, source, target, sourceHandle, targetHandle, selected, data }`
- Use `onEdgesChange` for edge deletion (filter by id)
- Edge types must be registered like node types
- Consider edge data for storing connection metadata (protocol, port)

## Estimated Commits
- feat(19-1): Create connection validation utility
- feat(19-2): Wire isValidConnection to WorkflowBuilder
- feat(19-3): Add visual feedback for connection attempts
- feat(19-4): Create custom ConnectionEdge component
- feat(19-5): Add edge selection and deletion
- feat(19-6): Add connection styles
