# Phase 18: Node Configuration Panels - Execution Plan

## Goal
Create sliding side panels for configuring each node type when selected on the workflow canvas. Changes in the panel should update the node display in real-time.

## Prerequisites
- Phase 17 completed (DockerAppNode, DatabaseNode, DomainNode, ServiceNode)
- WorkflowBuilder page with node types registered
- Existing form patterns (_forms.less, _modals.less)

## Tasks

### Task 1: Create ConfigPanel Base Component
**File**: `frontend/src/components/workflow/ConfigPanel.jsx`

Create a reusable sliding panel component:
- Slides in from right side of canvas
- Header with node type icon, title, and close button
- Scrollable body for form content
- Footer with action buttons (optional)
- Handles escape key to close
- Transition animation (slide + fade)

Props:
```js
{
  isOpen: boolean,
  title: string,
  icon: ReactNode,
  headerColor: string,
  onClose: function,
  children: ReactNode,
  footer: ReactNode (optional)
}
```

### Task 2: Create DockerAppConfigPanel
**File**: `frontend/src/components/workflow/panels/DockerAppConfigPanel.jsx`

Configuration panel for Docker app nodes:
- Name input
- Image input with placeholder (e.g., nginx:latest)
- Status selector (running/stopped)
- Ports input (add/remove port mappings)
- Memory limit input
- Environment variables (key-value pairs)
- Calls onChange with updated data

Fields match node data structure:
```js
{ name, image, status, ports: [], memory }
```

### Task 3: Create DatabaseConfigPanel
**File**: `frontend/src/components/workflow/panels/DatabaseConfigPanel.jsx`

Configuration panel for database nodes:
- Name input
- Type selector (mysql, postgresql, mongodb, redis)
- Host input (default: localhost)
- Port input (default varies by type)
- Size display (read-only preview)
- Status selector

Fields match node data structure:
```js
{ name, type, status, host, port, size }
```

### Task 4: Create DomainConfigPanel
**File**: `frontend/src/components/workflow/panels/DomainConfigPanel.jsx`

Configuration panel for domain nodes:
- Domain name input (with validation hint)
- SSL status selector (none, valid, expired)
- SSL expiry date picker (when ssl=valid)
- DNS status selector (pending, propagated)

Fields match node data structure:
```js
{ name, ssl, sslExpiry, dnsStatus }
```

### Task 5: Create ServiceConfigPanel
**File**: `frontend/src/components/workflow/panels/ServiceConfigPanel.jsx`

Configuration panel for service nodes:
- Name input
- Service type selector (redis, memcached, rabbitmq, queue)
- Port input
- Description textarea
- Status selector

Fields match node data structure:
```js
{ name, serviceType, port, description, status }
```

### Task 6: Wire Panel to Node Selection
**File**: `frontend/src/pages/WorkflowBuilder.jsx`

Integrate panels with canvas:
- Track selectedNode state
- Listen to onNodeClick event from ReactFlow
- Open appropriate panel based on node type
- Pass node data to panel
- Handle panel onChange to update node data via setNodes
- Handle panel close (deselect node or just close panel)

### Task 7: Add Panel Styles
**File**: `frontend/src/styles/pages/_workflow.less`

Add styles for configuration panels:
- Fixed position on right side of canvas
- Slide-in animation from right
- Panel header with type-specific border color
- Form group styling within panels
- Port/env-var list styling
- Panel shadow and backdrop

## Success Criteria
- [ ] Clicking node opens config panel
- [ ] Panel contains appropriate form for node type
- [ ] Form changes reflect in node display immediately
- [ ] Panel can be closed/dismissed
- [ ] Build passes without errors

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/components/workflow/ConfigPanel.jsx` | Create | Base panel component |
| `frontend/src/components/workflow/panels/DockerAppConfigPanel.jsx` | Create | Docker config form |
| `frontend/src/components/workflow/panels/DatabaseConfigPanel.jsx` | Create | Database config form |
| `frontend/src/components/workflow/panels/DomainConfigPanel.jsx` | Create | Domain config form |
| `frontend/src/components/workflow/panels/ServiceConfigPanel.jsx` | Create | Service config form |
| `frontend/src/pages/WorkflowBuilder.jsx` | Modify | Wire selection to panels |
| `frontend/src/styles/pages/_workflow.less` | Modify | Panel styles |

## Technical Notes

- Use existing form patterns from _forms.less (form-group, input styles)
- Panel should not block canvas interaction when closed
- Node selection in React Flow: use `onNodeClick` callback
- Update node data: use `setNodes` with functional update
- Panel animates with CSS transitions, not JS
- Consider keyboard navigation (Escape to close)

## Estimated Commits
- feat(18-1): Create ConfigPanel base component
- feat(18-2): Create DockerAppConfigPanel
- feat(18-3): Create DatabaseConfigPanel
- feat(18-4): Create DomainConfigPanel
- feat(18-5): Create ServiceConfigPanel
- feat(18-6): Wire panel to node selection in WorkflowBuilder
- feat(18-7): Add configuration panel styles
