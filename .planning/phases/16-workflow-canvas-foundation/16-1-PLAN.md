# Phase 16: Workflow Canvas Foundation

## Objective
Set up React Flow canvas with pan/zoom, basic node rendering, and connection system to establish the foundation for the visual workflow builder.

## Execution Context
- **Phase**: 16 of Milestone 3
- **Type**: New Feature (frontend only)
- **Dependencies**: None (greenfield feature)
- **Estimated Scope**: Medium (new page, new library, multiple components)

## Context

### Project Patterns Observed
- Pages are in `frontend/src/pages/*.jsx`
- Components in `frontend/src/components/*.jsx`
- Styles in `frontend/src/styles/` using LESS
- Routes defined in `frontend/src/App.jsx`
- Sidebar navigation in `frontend/src/components/Sidebar.jsx`
- Uses React 18, Vite, Lucide React icons

### Library Choice: React Flow
React Flow (@xyflow/react) is the recommended library for node-based editors:
- Excellent documentation and TypeScript support
- Built-in pan/zoom, minimap, controls
- Custom node and edge support
- Widely used (n8n, Stripe, etc.)

## Tasks

### Task 1: Install React Flow
**Goal**: Add React Flow library to the project

1. Install `@xyflow/react` package
2. Add to package.json dependencies
3. Verify installation with build

**Files**: `frontend/package.json`

### Task 2: Create WorkflowBuilder Page
**Goal**: Create the main page component with React Flow canvas

1. Create `frontend/src/pages/WorkflowBuilder.jsx`
2. Set up ReactFlow provider and canvas
3. Initialize with empty nodes/edges state
4. Add basic container styling

**Files**: `frontend/src/pages/WorkflowBuilder.jsx`

### Task 3: Add Route and Navigation
**Goal**: Wire up the new page in the app

1. Add route in `frontend/src/App.jsx` for `/workflow`
2. Add sidebar link in `frontend/src/components/Sidebar.jsx`
3. Use a workflow/flow icon (GitBranch or similar from Lucide)
4. Place under "Infrastructure" section

**Files**: `frontend/src/App.jsx`, `frontend/src/components/Sidebar.jsx`

### Task 4: Implement Canvas Controls
**Goal**: Add pan/zoom controls and minimap

1. Add React Flow Background component (dots or grid pattern)
2. Add Controls component (zoom in/out/fit buttons)
3. Add MiniMap component for overview
4. Configure pan/zoom behavior

**Files**: `frontend/src/pages/WorkflowBuilder.jsx`

### Task 5: Create Basic Node Component
**Goal**: Create a placeholder custom node for testing

1. Create `frontend/src/components/workflow/BaseNode.jsx`
2. Style with card-like appearance matching app theme
3. Add connection handles (source/target)
4. Test adding nodes to canvas

**Files**: `frontend/src/components/workflow/BaseNode.jsx`, `frontend/src/pages/WorkflowBuilder.jsx`

### Task 6: Create Workflow Styles
**Goal**: Add LESS styles for the workflow builder

1. Create `frontend/src/styles/pages/_workflow.less`
2. Style the canvas container (full height, dark background)
3. Style the controls and minimap
4. Import in `frontend/src/styles/main.less`

**Files**: `frontend/src/styles/pages/_workflow.less`, `frontend/src/styles/main.less`

### Task 7: Add Node Toolbar
**Goal**: Create toolbar for adding nodes to canvas

1. Create floating toolbar/palette component
2. Add buttons for adding different node types (placeholder)
3. Implement add node on click (places in center of viewport)
4. Style to match app design

**Files**: `frontend/src/pages/WorkflowBuilder.jsx`

## Verification

After completing all tasks:
- [ ] `npm run build` passes without errors
- [ ] `/workflow` route accessible
- [ ] Sidebar shows "Workflow Builder" link
- [ ] Canvas renders with background grid
- [ ] Can pan and zoom the canvas
- [ ] Controls (zoom buttons) visible and working
- [ ] MiniMap shows canvas overview
- [ ] Can add placeholder nodes via toolbar
- [ ] Nodes are draggable
- [ ] Can draw connections between nodes

## Success Criteria

- [ ] Canvas renders with pan/zoom
- [ ] Can add placeholder nodes
- [ ] Can draw connections between nodes
- [ ] Minimap shows overview

## Output

| File | Type |
|------|------|
| `frontend/package.json` | Modified |
| `frontend/src/pages/WorkflowBuilder.jsx` | New |
| `frontend/src/components/workflow/BaseNode.jsx` | New |
| `frontend/src/styles/pages/_workflow.less` | New |
| `frontend/src/styles/main.less` | Modified |
| `frontend/src/App.jsx` | Modified |
| `frontend/src/components/Sidebar.jsx` | Modified |

## Notes

- React Flow uses `@xyflow/react` package name (renamed from `react-flow-renderer`)
- Nodes require unique `id` field
- Custom nodes must be registered in `nodeTypes` prop
- Connection handles need `Position` enum from React Flow
- Use `useNodesState` and `useEdgesState` hooks for state management
