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
| 17 | Resource Node Types | pending | Create node types for Docker apps, databases, domains |
| 18 | Node Configuration Panels | pending | Side panels for configuring each node type |
| 19 | Connection Logic | pending | Define and validate connections between nodes |
| 20 | Workflow Save/Load | pending | Save workflows to backend, load existing infrastructure |
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

## Phase 17: Resource Node Types
**Goal**: Create visual node types for Docker apps, databases, and domains

### Tasks
1. Design node visual styles (icons, colors, shapes)
2. Create DockerAppNode component
3. Create DatabaseNode component
4. Create DomainNode component
5. Create ServiceNode component (for future expandability)
6. Add node palette/toolbar for adding nodes

### Success Criteria
- [ ] Each resource type has distinct visual node
- [ ] Nodes display key info (name, status, type)
- [ ] Node palette allows adding new nodes
- [ ] Nodes are draggable on canvas

---

## Phase 18: Node Configuration Panels
**Goal**: Create side panels for configuring each node type

### Tasks
1. Create sliding panel component
2. Adapt existing Docker app form to panel
3. Adapt existing database form to panel
4. Adapt existing domain form to panel
5. Wire panel open/close to node selection
6. Handle form validation in panels

### Success Criteria
- [ ] Clicking node opens config panel
- [ ] Panel contains appropriate form for node type
- [ ] Form changes reflect in node display
- [ ] Panel can be closed/dismissed

---

## Phase 19: Connection Logic
**Goal**: Define and validate connections between nodes

### Tasks
1. Define valid connection types (app→db, domain→app, etc.)
2. Implement connection validation rules
3. Add visual feedback for valid/invalid connections
4. Show connection metadata (port, protocol)
5. Allow connection deletion
6. Implement connection click to edit

### Success Criteria
- [ ] Can only create valid connections
- [ ] Invalid connections show error feedback
- [ ] Connections display relevant metadata
- [ ] Can edit and delete connections

---

## Phase 20: Workflow Save/Load
**Goal**: Persist workflows and load existing infrastructure as workflows

### Tasks
1. Define workflow JSON schema
2. Create backend API for workflow CRUD
3. Save workflow state to backend
4. Load workflow from backend
5. Import existing infrastructure as workflow
6. Add workflow list/manager

### Success Criteria
- [ ] Workflows save to database
- [ ] Workflows load correctly
- [ ] Existing apps/DBs appear as nodes
- [ ] Can manage multiple workflows

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
