# ServerKit Enhancement Roadmap

---

## Completed Milestones

### [Milestone 1: Infrastructure Fixes, Private URLs & UI Polish](./milestones/v1.0-ROADMAP.md) (v1.0)
Completed 2026-01-19 | 9 phases | 109 commits | +14,667/-2,836 lines

### [Milestone 2: Multi-Environment WordPress & Community Features](./milestones/v1.1-ROADMAP.md) (v1.1)
Completed 2026-01-19 | 5 phases | Multi-environment app linking, shared DB support, GitHub integration

---

## Current Milestone

> **Milestone 3**: Visual Workflow Builder
> **Version**: v1.2
> **Started**: 2026-01-19
> **Status**: In Progress

**Goal**: Create a visual, flow-based interface for orchestrating Docker apps, databases, and domain connections - an alternative "v2" way to manage infrastructure visually using a node-based editor.

---

## Phase Overview

| Phase | Name | Status | Goal |
|-------|------|--------|------|
| 16 | Workflow Canvas Foundation | **completed** | React Flow canvas with pan/zoom, node rendering, connection system |
| 17 | Resource Node Types | **completed** | Create node types for Docker apps, databases, domains |
| 18 | Node Configuration Panels | **completed** | Side panels for configuring each node type |
| 19 | Connection Logic | **completed** | Define and validate connections between nodes |
| 20 | Workflow Save/Load | **completed** | Save workflows to backend, load existing infrastructure |
| 21 | Deploy from Workflow | pending | Execute workflow to create/update actual resources |

---

## Phase 16: Workflow Canvas Foundation ✓
**Goal**: Set up React Flow canvas with pan/zoom, basic node rendering, and connection system

**Status**: Completed 2026-01-19

### What Was Built
- Installed @xyflow/react (React Flow) library
- Created WorkflowBuilder page with canvas at /workflow
- Added Background, Controls, and MiniMap components
- Created BaseNode component with connection handles
- Added node toolbar for adding Docker/Database/Domain nodes
- Comprehensive LESS styles for workflow UI

### Success Criteria
- [x] Canvas renders with pan/zoom
- [x] Can add placeholder nodes
- [x] Can draw connections between nodes
- [x] Minimap shows overview

[Full Summary](./phases/16-workflow-canvas-foundation/SUMMARY.md)

---

## Phase 17: Resource Node Types ✓
**Goal**: Create visual node types for Docker apps, databases, and domains

**Status**: Completed 2026-01-19

### What Was Built
- DockerAppNode with status, ports, memory display, multi-handles
- DatabaseNode with type badges (MySQL, PostgreSQL, MongoDB, Redis)
- DomainNode with SSL/DNS status badges
- ServiceNode for future extensibility (Redis, Memcached, RabbitMQ)
- Categorized palette (Compute, Storage, Network)
- Node-specific styles with animated status indicators

### Success Criteria
- [x] Each resource type has distinct visual node
- [x] Nodes display key info (name, status, type)
- [x] Node palette allows adding new nodes
- [x] Nodes are draggable on canvas

[Full Summary](./phases/17-resource-node-types/SUMMARY.md)

---

## Phase 18: Node Configuration Panels ✓
**Goal**: Create side panels for configuring each node type

**Status**: Completed 2026-01-19

### What Was Built
- ConfigPanel base component with slide animation
- DockerAppConfigPanel with ports list and memory input
- DatabaseConfigPanel with type-aware default ports
- DomainConfigPanel with SSL/DNS status fields
- ServiceConfigPanel with service type selector
- Panel wiring in WorkflowBuilder with real-time updates

### Success Criteria
- [x] Clicking node opens config panel
- [x] Panel contains appropriate form for node type
- [x] Form changes reflect in node display
- [x] Panel can be closed/dismissed

[Full Summary](./phases/18-node-configuration-panels/SUMMARY.md)

---

## Phase 19: Connection Logic ✓
**Goal**: Define and validate connections between nodes

**Status**: Completed 2026-01-19

### What Was Built
- Connection validation utility with rules matrix
- isValidConnection callback preventing invalid connections
- Error toast for invalid connection attempts
- Custom ConnectionEdge with labels and delete button
- Edge selection and deletion (Delete/Backspace keys)
- Connection styles with hover/selected states

### Success Criteria
- [x] Can only create valid connections
- [x] Invalid connections show error feedback
- [x] Connections display relevant metadata
- [x] Can edit and delete connections

[Full Summary](./phases/19-connection-logic/SUMMARY.md)

---

## Phase 20: Workflow Save/Load ✓
**Goal**: Persist workflows and load existing infrastructure as workflows

**Status**: Completed 2026-01-19

### What Was Built
- Created Workflow SQLAlchemy model with nodes/edges/viewport as JSON
- Created CRUD API endpoints (GET/POST/PUT/DELETE /workflows)
- Registered workflows blueprint at /api/v1/workflows
- Added frontend API methods
- Added workflow toolbar with name input, New/Load/Import/Save buttons
- Created WorkflowListModal for loading saved workflows
- Added import existing infrastructure feature

### Success Criteria
- [x] Workflows save to database
- [x] Workflows load correctly
- [x] Existing apps/DBs appear as nodes
- [x] Can manage multiple workflows

[Full Summary](./phases/20-workflow-save-load/SUMMARY.md)

---

## Phase 21: Deploy from Workflow
**Goal**: Execute workflow to create/update actual resources

### Tasks
1. Implement workflow execution engine
2. Create resources from nodes (calls existing APIs)
3. Establish connections (configure relationships)
4. Show deployment progress/status
5. Handle deployment errors gracefully
6. Add rollback capability for failed deploys

### Success Criteria
- [ ] Can deploy new infrastructure from workflow
- [ ] Existing resources update correctly
- [ ] Progress visible during deployment
- [ ] Errors handled with clear feedback

---

## Dependencies

```
Phase 16 (Canvas) ────────────► Phase 17 (Nodes)
                                      │
                                      ▼
Phase 17 ─────────────────────► Phase 18 (Panels)
                                      │
                                      ▼
Phase 18 ─────────────────────► Phase 19 (Connections)
                                      │
                                      ▼
Phase 19 ─────────────────────► Phase 20 (Save/Load)
                                      │
                                      ▼
Phase 20 ─────────────────────► Phase 21 (Deploy)
```

---

## Notes

- This is a UI-layer feature - reuses all existing backend APIs
- React Flow is the recommended library for node-based editors
- Consider localStorage for autosave during development
- Start simple - MVP is canvas + nodes + basic connections
- Full deployment can be phased (start with import existing)

---

## Estimated Complexity

| Phase | Complexity | Files Changed |
|-------|------------|---------------|
| 16 | Medium | 4-6 (new page, canvas setup) |
| 17 | Medium | 5-8 (node components) |
| 18 | Medium | 4-6 (panel components) |
| 19 | Medium | 3-5 (validation logic) |
| 20 | High | 6-8 (backend + frontend) |
| 21 | High | 5-7 (execution engine) |
