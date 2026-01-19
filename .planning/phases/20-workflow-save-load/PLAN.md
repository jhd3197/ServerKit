# Phase 20: Workflow Save/Load - Execution Plan

## Goal
Persist workflows to database and enable loading existing infrastructure as workflow nodes. Users can save, load, and manage multiple workflows.

## Prerequisites
- Phase 19 completed (Connection Logic)
- Backend uses Flask + SQLAlchemy
- Existing model patterns (Application, Domain)
- Frontend API service pattern

## Tasks

### Task 1: Create Workflow Model
**File**: `backend/app/models/workflow.py`

Create SQLAlchemy model for workflows:
```python
class Workflow(db.Model):
    id = Integer, primary_key
    name = String(100), not null
    description = Text, nullable
    nodes = Text  # JSON string of nodes
    edges = Text  # JSON string of edges
    viewport = Text  # JSON string {x, y, zoom}
    created_at = DateTime
    updated_at = DateTime
    user_id = ForeignKey(users.id)
```

### Task 2: Create Workflow API Endpoints
**File**: `backend/app/api/workflows.py`

CRUD endpoints:
- `GET /workflows` - List all workflows for user
- `GET /workflows/<id>` - Get single workflow
- `POST /workflows` - Create new workflow
- `PUT /workflows/<id>` - Update workflow
- `DELETE /workflows/<id>` - Delete workflow

### Task 3: Register Workflow Blueprint
**File**: `backend/app/__init__.py`

Register the workflows blueprint:
- Import workflows_bp
- Register with prefix `/api/v1/workflows`

### Task 4: Add Frontend API Methods
**File**: `frontend/src/services/api.js`

Add workflow API methods:
- `getWorkflows()` - List workflows
- `getWorkflow(id)` - Get single workflow
- `createWorkflow(data)` - Create workflow
- `updateWorkflow(id, data)` - Update workflow
- `deleteWorkflow(id)` - Delete workflow

### Task 5: Add Save/Load UI to WorkflowBuilder
**File**: `frontend/src/pages/WorkflowBuilder.jsx`

Add toolbar with save/load:
- Save button (creates/updates workflow)
- Load button (opens modal with workflow list)
- Workflow name input
- Auto-save to localStorage (optional)
- useReactFlow for getNodes/getEdges/getViewport

### Task 6: Create Workflow List Modal
**File**: `frontend/src/components/workflow/WorkflowListModal.jsx`

Modal for managing workflows:
- List of saved workflows with name, date
- Click to load workflow
- Delete button per workflow
- Search/filter (optional)

### Task 7: Add Import Existing Infrastructure
**File**: `frontend/src/pages/WorkflowBuilder.jsx`

Button to import existing apps/DBs/domains as nodes:
- Fetch apps from `/apps`
- Fetch databases from `/databases`
- Fetch domains from `/domains`
- Position nodes in grid layout
- Create workflow from imported data

## Success Criteria
- [ ] Workflows save to database
- [ ] Workflows load correctly
- [ ] Existing apps/DBs appear as nodes
- [ ] Can manage multiple workflows

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `backend/app/models/workflow.py` | Create | Workflow model |
| `backend/app/models/__init__.py` | Modify | Export Workflow |
| `backend/app/api/workflows.py` | Create | CRUD endpoints |
| `backend/app/__init__.py` | Modify | Register blueprint |
| `frontend/src/services/api.js` | Modify | Add API methods |
| `frontend/src/pages/WorkflowBuilder.jsx` | Modify | Save/load UI |
| `frontend/src/components/workflow/WorkflowListModal.jsx` | Create | Workflow list |

## Technical Notes

- Workflow nodes/edges stored as JSON strings in database
- Use `useReactFlow` hook for `getNodes()`, `getEdges()`, `getViewport()`, `setNodes()`, `setEdges()`, `setViewport()`
- Import infrastructure creates nodes from existing data but doesn't deploy
- Consider auto-save to localStorage on changes
- Workflow list should show preview of node count

## Estimated Commits
- feat(20-1): Create Workflow model
- feat(20-2): Create workflow API endpoints
- feat(20-3): Register workflow blueprint
- feat(20-4): Add frontend workflow API methods
- feat(20-5): Add save/load UI to WorkflowBuilder
- feat(20-6): Create WorkflowListModal
- feat(20-7): Add import existing infrastructure
