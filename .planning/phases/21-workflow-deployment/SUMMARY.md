# Phase 21: Deploy from Workflow - Summary

## Completed: 2026-01-19

## Goal
Execute workflow to create/update actual infrastructure resources by converting visual nodes and edges into real Docker apps, databases, and domain configurations.

## What Was Built

### Backend - Workflow Deployment Service
**File**: `backend/app/services/workflow_service.py`

Created comprehensive deployment orchestration service:
- `deploy_workflow()` - Main entry point that deploys all nodes in order
- `get_deployment_order()` - Topological sort: databases → apps → domains
- `deploy_node()` - Routes to type-specific deployment
- `deploy_database()` - Creates MySQL/PostgreSQL databases with users
- `deploy_docker_app()` - Creates Application records and docker-compose files
- `deploy_domain()` - Creates Domain records linked to apps, configures nginx
- `update_nodes_with_ids()` - Updates workflow nodes with created resource IDs

Key features:
- Non-atomic deployment (partial success allowed)
- Automatic database credential generation
- Environment variable injection for app-to-database connections
- Nginx auto-configuration for domains

### Backend - Deploy API Endpoint
**File**: `backend/app/api/workflows.py`

Added `POST /workflows/{id}/deploy` endpoint:
- Calls WorkflowService.deploy_workflow()
- Returns detailed results per node
- Returns updated workflow with resource IDs
- Proper error handling (404, 403, partial failures)

### Frontend - Deploy Workflow
**File**: `frontend/src/services/api.js`

Added `deployWorkflow(id)` API method.

### Frontend - Deploy UI
**File**: `frontend/src/pages/WorkflowBuilder.jsx`

Added deployment functionality:
- Deploy button in toolbar (green, shows "Deploy")
- Button disabled until workflow is saved and has nodes
- `deployWorkflow()` function that:
  - Saves current state first
  - Calls deploy API
  - Updates nodes with returned resource IDs
  - Opens progress modal

### Frontend - DeploymentProgressModal Component
**File**: `frontend/src/components/workflow/DeploymentProgressModal.jsx`

Progress modal showing:
- Loading state while deploying
- Summary banner (success/errors count)
- Per-node status list with icons
- Success/error/pending states per node
- Link to resource for successful deployments
- Error details section
- Done/Close button

### Frontend - Deployment Styles
**File**: `frontend/src/styles/pages/_workflow.less`

Added styles for:
- Deploy button (green theme)
- Deployment modal overlay and container
- Loading spinner state
- Summary banners (success/error)
- Result items with status icons
- Error list styling
- Deployed node indicator

## Commits

| Commit | Message |
|--------|---------|
| bead238 | feat(21-1): Create workflow deployment service |
| 83ba62b | feat(21-2): Add workflow deploy API endpoint |
| 1964383 | feat(21-3): Add frontend deploy API method |
| c5fb178 | feat(21-4): Add deploy button and progress UI |
| 6f37795 | feat(21-5): Create DeploymentProgressModal component |
| 643b5d1 | feat(21-7): Add deployment styles |

Note: Task 6 (Update nodes with deployed resource IDs) was implemented as part of Task 4's deployWorkflow function.

## Technical Decisions

### Deployment Order
Databases → Docker Apps → Domains ensures dependencies are met:
1. Databases have no dependencies
2. Apps may connect to databases (need DB credentials)
3. Domains link to apps (need app to exist first)

### Non-Atomic Deployment
- Allows partial success
- Continues deploying even if one node fails
- Returns detailed results for each node
- User can re-deploy to retry failed nodes

### Resource ID Tracking
- DockerApp: `node.data.appId`
- Domain: `node.data.domainId`
- Database: `node.data.deployed` + `node.data.dbName`

### Database Handling
- MySQL/PostgreSQL create actual databases
- MongoDB/Redis should be Docker containers (future enhancement)
- Auto-generates secure passwords
- Creates database user with same name as database

## Files Changed

| File | Action | Lines |
|------|--------|-------|
| `backend/app/services/workflow_service.py` | Created | +588 |
| `backend/app/api/workflows.py` | Modified | +39 |
| `frontend/src/services/api.js` | Modified | +6 |
| `frontend/src/pages/WorkflowBuilder.jsx` | Modified | +96 |
| `frontend/src/components/workflow/DeploymentProgressModal.jsx` | Created | +149 |
| `frontend/src/styles/pages/_workflow.less` | Modified | +303 |

## Success Criteria

- [x] Can deploy new infrastructure from workflow
- [x] Existing resources update correctly (when node has appId/domainId)
- [x] Progress visible during deployment
- [x] Errors handled with clear feedback
- [x] Node IDs update after deployment
- [x] Deployed nodes tracked via data.deployed flag

## Future Enhancements

1. **Start containers after deploy** - Currently only creates, doesn't start
2. **MongoDB/Redis as containers** - Treat as Docker apps not databases
3. **Rollback on failure** - Option to undo partial deployments
4. **Real-time progress** - WebSocket for live status updates
5. **Deploy diff** - Show what will change before deploying
