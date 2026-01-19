# Phase 17: Resource Node Types - Execution Plan

## Goal
Create visual node types for Docker apps, databases, and domains with detailed displays showing resource-specific information.

## Prerequisites
- Phase 16 completed (React Flow canvas foundation)
- BaseNode component exists with basic structure
- Workflow styles in place

## Tasks

### Task 1: Create DockerAppNode Component
**File**: `frontend/src/components/workflow/nodes/DockerAppNode.jsx`

Create a specialized node for Docker applications displaying:
- App name and image tag
- Status indicator (running/stopped/error) with animated dot
- Port mappings display
- Memory/CPU stats preview
- Multiple handles: input (left), output (right), database (bottom)

Node data structure:
```js
{
  name: 'my-app',
  image: 'nginx:latest',
  status: 'running',
  ports: ['80:80', '443:443'],
  memory: '256MB'
}
```

### Task 2: Create DatabaseNode Component
**File**: `frontend/src/components/workflow/nodes/DatabaseNode.jsx`

Create a specialized node for databases displaying:
- Database name
- Type badge (MySQL, PostgreSQL, MongoDB, Redis)
- Status indicator
- Connection info preview (host:port)
- Size/storage info
- Handles: input only (left) - databases receive connections

Node data structure:
```js
{
  name: 'main-db',
  type: 'mysql',
  status: 'running',
  host: 'localhost',
  port: 3306,
  size: '1.2GB'
}
```

### Task 3: Create DomainNode Component
**File**: `frontend/src/components/workflow/nodes/DomainNode.jsx`

Create a specialized node for domains displaying:
- Domain name (prominently)
- SSL status badge (valid/expired/none)
- DNS status indicator
- Linked app preview (if connected)
- Handles: output only (right) - domains connect TO apps

Node data structure:
```js
{
  name: 'example.com',
  ssl: 'valid',
  sslExpiry: '2026-12-31',
  dnsStatus: 'propagated'
}
```

### Task 4: Create ServiceNode Component
**File**: `frontend/src/components/workflow/nodes/ServiceNode.jsx`

Create a generic service node for future extensibility:
- Service name
- Type/icon configurable
- Generic status display
- Flexible handles (configurable)
- Useful for Redis, cache layers, queues, etc.

Node data structure:
```js
{
  name: 'redis-cache',
  type: 'service',
  serviceType: 'redis',
  status: 'running'
}
```

### Task 5: Register Node Types and Update Canvas
**File**: `frontend/src/pages/WorkflowBuilder.jsx`

- Import all new node components
- Register them in nodeTypes object
- Update addNode function to create proper node types
- Each node type uses its own component

### Task 6: Enhance Node Toolbar/Palette
**File**: `frontend/src/pages/WorkflowBuilder.jsx`

Upgrade toolbar to a collapsible palette:
- Category headers (Compute, Storage, Network)
- Docker App under Compute
- Database nodes under Storage (with sub-options for MySQL, PostgreSQL, etc.)
- Domain under Network
- Service under Compute
- Drag-to-canvas support (optional enhancement)

### Task 7: Add Node-Specific Styles
**File**: `frontend/src/styles/pages/_workflow.less`

Add styles for each node type:
- Type-specific color schemes (already defined, enhance)
- Status indicator animations (pulsing dot)
- Database type badges
- SSL status badges
- Port mapping pills
- Handle positioning for multi-handle nodes

## Success Criteria
- [ ] Each resource type has distinct visual node
- [ ] Nodes display key info (name, status, type-specific details)
- [ ] Node palette allows adding specific node types
- [ ] Nodes are draggable on canvas
- [ ] Build passes without errors

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/components/workflow/nodes/DockerAppNode.jsx` | Create | Docker app node |
| `frontend/src/components/workflow/nodes/DatabaseNode.jsx` | Create | Database node |
| `frontend/src/components/workflow/nodes/DomainNode.jsx` | Create | Domain node |
| `frontend/src/components/workflow/nodes/ServiceNode.jsx` | Create | Generic service node |
| `frontend/src/pages/WorkflowBuilder.jsx` | Modify | Register nodes, update toolbar |
| `frontend/src/styles/pages/_workflow.less` | Modify | Add node-specific styles |

## Technical Notes

- All node components must be memoized with `React.memo()`
- Node components receive `{ data, selected }` props from React Flow
- Use Handle from @xyflow/react for connection points
- Handles can have IDs for specific connection types
- Lucide React for all icons (consistency with app)

## Estimated Commits
- feat(17-1): Create DockerAppNode component
- feat(17-2): Create DatabaseNode component
- feat(17-3): Create DomainNode component
- feat(17-4): Create ServiceNode component
- feat(17-5): Register node types in WorkflowBuilder
- feat(17-6): Enhance node palette with categories
- feat(17-7): Add node-specific styles
