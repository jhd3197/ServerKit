# Phase 21: Deploy from Workflow - Execution Plan

## Goal
Execute workflow to create/update actual infrastructure resources. Convert visual workflow nodes and edges into real Docker apps, databases, and domain configurations by calling existing backend APIs.

## Prerequisites
- Phase 20 completed (Workflow Save/Load)
- Existing APIs for Docker apps, domains, databases
- Workflow with nodes (dockerApp, database, domain) and edges (connections)

## Architecture

### Deployment Flow
```
1. User clicks "Deploy" button
2. Frontend sends workflow to new deploy endpoint
3. Backend parses workflow nodes/edges
4. Backend executes in dependency order:
   - Databases first (no dependencies)
   - Docker apps second (may depend on databases)
   - Domains last (depend on apps)
5. For each node:
   - If node has appId/domainId → update existing resource
   - If no ID → create new resource
6. Return deployment status with created resource IDs
7. Frontend updates nodes with new IDs
```

### Node Data Schema (from config panels)

**DockerApp Node**:
```json
{
  "name": "my-app",
  "image": "nginx:latest",
  "status": "stopped",
  "ports": ["8080:80"],
  "memory": "512MB",
  "appId": null  // Set after creation
}
```

**Database Node**:
```json
{
  "name": "my-database",
  "type": "mysql|postgresql|mongodb|redis",
  "status": "stopped",
  "host": "localhost",
  "port": 3306,
  "dbId": null  // For tracking (not in current DB model)
}
```

**Domain Node**:
```json
{
  "name": "example.com",
  "ssl": "none|valid|expired",
  "dnsStatus": "pending|propagated",
  "domainId": null  // Set after creation
}
```

### Edge Semantics (from connectionRules.js)
- `domain → dockerApp`: Domain routes to app (create domain linked to app)
- `dockerApp → database`: App uses database (store connection info in app env)
- `dockerApp → dockerApp`: App-to-app networking (Docker network link)
- `service → dockerApp`: Service provides to app
- `service → database`: Service uses database

## Tasks

### Task 1: Create Workflow Deployment Backend Service
**File**: `backend/app/services/workflow_service.py`

Create service to orchestrate workflow deployment:
```python
class WorkflowService:
    @staticmethod
    def deploy_workflow(workflow_id, user_id):
        """Deploy all resources from a workflow."""
        # 1. Load workflow
        # 2. Parse nodes and edges
        # 3. Determine deployment order (topological sort)
        # 4. Deploy each node
        # 5. Return results with created IDs

    @staticmethod
    def deploy_node(node, edges, user_id, created_resources):
        """Deploy a single node based on type."""

    @staticmethod
    def deploy_docker_app(node_data, user_id):
        """Create/update Docker app from node data."""

    @staticmethod
    def deploy_database(node_data, user_id):
        """Create database from node data (standalone MySQL/PostgreSQL)."""

    @staticmethod
    def deploy_domain(node_data, app_id, user_id):
        """Create/update domain linked to app."""

    @staticmethod
    def get_deployment_order(nodes, edges):
        """Topological sort: databases → apps → domains."""
```

### Task 2: Create Workflow Deployment API Endpoint
**File**: `backend/app/api/workflows.py`

Add deployment endpoint:
```python
@workflows_bp.route('/<int:workflow_id>/deploy', methods=['POST'])
@jwt_required()
def deploy_workflow(workflow_id):
    """Deploy all resources from a workflow.

    Returns:
        {
            "message": "Deployment completed",
            "results": [
                {"nodeId": "node_1", "type": "dockerApp", "success": true, "resourceId": 5},
                {"nodeId": "node_2", "type": "domain", "success": true, "resourceId": 12},
                ...
            ],
            "errors": [],
            "workflow": {...updated workflow with resource IDs...}
        }
    """
```

### Task 3: Add Frontend Deploy API Method
**File**: `frontend/src/services/api.js`

Add deploy workflow method:
```javascript
async deployWorkflow(id) {
    return this.request(`/workflows/${id}/deploy`, {
        method: 'POST'
    });
}
```

### Task 4: Add Deploy Button and Progress UI
**File**: `frontend/src/pages/WorkflowBuilder.jsx`

Add deployment controls:
- Deploy button in toolbar (only enabled when workflow is saved)
- Deployment confirmation modal
- Progress indicator during deployment
- Success/error feedback with resource links
- Auto-update node IDs after successful deployment

### Task 5: Create DeploymentProgressModal Component
**File**: `frontend/src/components/workflow/DeploymentProgressModal.jsx`

Modal showing deployment progress:
- List of nodes being deployed
- Status per node (pending/deploying/success/error)
- Real-time progress updates
- Error details if any fail
- Links to created resources on success
- Close button when complete

### Task 6: Update Nodes with Deployed Resource IDs
**File**: `frontend/src/pages/WorkflowBuilder.jsx`

After successful deployment:
- Update node data with created resource IDs (appId, domainId)
- Change node status to reflect actual status
- Save updated workflow to persist IDs
- Show visual indicator that nodes are deployed

### Task 7: Add Deployment Styles
**File**: `frontend/src/styles/pages/_workflow.less`

Styles for deployment UI:
- Deploy button styling
- Progress modal styles
- Node deployment status indicators
- Success/error visual feedback

## Success Criteria
- [ ] Can deploy new infrastructure from workflow
- [ ] Existing resources update correctly (when node has appId/domainId)
- [ ] Progress visible during deployment
- [ ] Errors handled with clear feedback
- [ ] Node IDs update after deployment
- [ ] Deployed nodes show deployed status

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `backend/app/services/workflow_service.py` | Create | Deployment orchestration |
| `backend/app/api/workflows.py` | Modify | Add deploy endpoint |
| `frontend/src/services/api.js` | Modify | Add deployWorkflow method |
| `frontend/src/pages/WorkflowBuilder.jsx` | Modify | Deploy button and logic |
| `frontend/src/components/workflow/DeploymentProgressModal.jsx` | Create | Progress UI |
| `frontend/src/styles/pages/_workflow.less` | Modify | Deployment styles |

## Technical Notes

### Deployment Order Algorithm
```
1. Separate nodes by type: databases, apps, domains
2. Deploy databases first (no dependencies)
3. Deploy apps second:
   - For each app, check edges for database connections
   - Pass database info to app creation (env vars)
4. Deploy domains last:
   - Find connected app from edges
   - Create domain linked to app
```

### Error Handling Strategy
- Deployment is **not** atomic (partial success allowed)
- Track success/failure per node
- Continue deploying other nodes if one fails
- Return detailed results for each node
- User can re-deploy to retry failed nodes

### Node ID Tracking
- After creation, store resource ID in node data:
  - DockerApp: `node.data.appId`
  - Domain: `node.data.domainId`
  - Database: Track by name (databases don't have IDs in current model)
- On re-deploy, check for existing ID to update vs create

### Database Handling Note
- Current system doesn't have a Database model like Application
- For MVP: Create database using existing `/databases/mysql` API
- Store connection info in connected app's environment variables
- Consider: Add Database model in future for better tracking

## Estimated Commits
- feat(21-1): Create workflow deployment service
- feat(21-2): Add workflow deploy API endpoint
- feat(21-3): Add frontend deploy API method
- feat(21-4): Add deploy button and progress UI
- feat(21-5): Create DeploymentProgressModal component
- feat(21-6): Update nodes with deployed resource IDs
- feat(21-7): Add deployment styles
