# Phase 8: Applications UI Polish

## Objective
Improve the applications list and management pages with better status visibility, quick actions, sorting, and bulk operations.

## Context

### Current State
- Applications list at `frontend/src/pages/Applications.jsx`
  - Shows app name, type, domains, status badge
  - Has start/stop/restart actions inline
  - CreateAppModal for new apps
  - Private URL indicator already added (Phase 5)
- Application detail at `frontend/src/pages/ApplicationDetail.jsx`
  - Tab-based navigation (overview, logs, deploy, domains, etc.)
  - Environment variables component
  - Routing diagnostics
- Styles in `frontend/src/styles/pages/_applications.less`

### Key Files
- `frontend/src/pages/Applications.jsx` - List page
- `frontend/src/pages/ApplicationDetail.jsx` - Detail page
- `frontend/src/styles/pages/_applications.less` - Styles
- `frontend/src/services/api.js` - API methods

### What Works Well
- Basic app list with status badges
- Quick actions (start/stop/restart)
- Domain links
- Tab organization in detail

### What Needs Improvement
- No sorting options
- No bulk selection/actions
- No view mode toggle (grid/list)
- Status colors could be more prominent
- No confirmation for destructive actions
- Action buttons lack icons

---

## Tasks

### Task 1: Add Lucide Icons and Improve Action Buttons
**Goal**: Replace inline SVGs with Lucide icons, add icons to action buttons

**Files to modify**:
- `frontend/src/pages/Applications.jsx`

**Implementation**:
1. Import Lucide icons: `Play, Square, RotateCcw, Settings, Plus, Package, Grid, List`
2. Replace inline SVGs with Lucide components
3. Add icons to Start/Stop/Restart/Manage buttons
4. Improve "New Application" button with Plus icon

**Verification**: All buttons have consistent icons

---

### Task 2: Add Sorting Options to Applications List
**Goal**: Allow sorting apps by name, status, type, or creation date

**Files to modify**:
- `frontend/src/pages/Applications.jsx`
- `frontend/src/styles/pages/_applications.less`

**Implementation**:
1. Add sort state: `sortBy` (name-asc, name-desc, status, type, created)
2. Add sort dropdown in header area
3. Implement `sortApps()` function
4. Sort by running first for status sort
5. Style dropdown to match design system

**Verification**: Sorting changes list order correctly

---

### Task 3: Add Grid/List View Toggle
**Goal**: Allow users to switch between compact list and card grid views

**Files to modify**:
- `frontend/src/pages/Applications.jsx`
- `frontend/src/styles/pages/_applications.less`

**Implementation**:
1. Add `viewMode` state: 'list' | 'grid'
2. Add toggle buttons (Grid/List icons)
3. Create card-style layout for grid view
4. Keep existing row layout for list view
5. Persist preference in localStorage

**Verification**: Toggle switches between views, preference persists

---

### Task 4: Add Bulk Selection and Actions
**Goal**: Allow selecting multiple apps for bulk start/stop/restart/delete

**Files to modify**:
- `frontend/src/pages/Applications.jsx`
- `frontend/src/styles/pages/_applications.less`

**Implementation**:
1. Add `selectedApps` state (Set of app IDs)
2. Add checkbox to each app row/card
3. Add "Select All" checkbox in header
4. Show bulk action bar when apps selected
5. Implement bulk start/stop/restart handlers
6. Add confirmation modal for bulk delete
7. Style selected state and action bar

**Verification**: Can select multiple apps and perform bulk actions

---

### Task 5: Add Confirmation Modal Component
**Goal**: Create reusable confirmation dialog for destructive actions

**Files to modify**:
- `frontend/src/pages/Applications.jsx` (inline component)
- `frontend/src/styles/pages/_applications.less`

**Implementation**:
1. Create `ConfirmModal` component with:
   - Title, message, confirmText, cancelText props
   - Danger variant for destructive actions
   - Loading state for async confirm
2. Use for bulk delete confirmation
3. Use for individual app delete
4. Style with warning colors for danger variant

**Verification**: Destructive actions require confirmation

---

### Task 6: Improve Status Indicators
**Goal**: Make app status more visually prominent

**Files to modify**:
- `frontend/src/pages/Applications.jsx`
- `frontend/src/styles/pages/_applications.less`

**Implementation**:
1. Larger status badges with background color
2. Animated pulse for "running" status
3. Add port info to status area (e.g., "Running on :8080")
4. Show "Starting..." or "Stopping..." during transitions
5. Error status with tooltip showing error message

**Verification**: Status clearly visible, transitions shown

---

### Task 7: Add Search Filter to Applications List
**Goal**: Allow filtering apps by name

**Files to modify**:
- `frontend/src/pages/Applications.jsx`
- `frontend/src/styles/pages/_applications.less`

**Implementation**:
1. Add search input to header
2. Filter apps by name (case-insensitive)
3. Show "No apps match" message when filtered empty
4. Add Search icon and clear button (like Templates page)

**Verification**: Search filters list correctly

---

### Task 8: Improve App Cards with More Info
**Goal**: Show more useful info in app cards/rows

**Files to modify**:
- `frontend/src/pages/Applications.jsx`
- `frontend/src/styles/pages/_applications.less`

**Implementation**:
1. Show main port in status area
2. Show domain count badge if multiple domains
3. Show "Last deployed" timestamp if available
4. Show container count for Docker apps
5. Improve type badge styling (like template version badges)

**Verification**: Cards show relevant info at a glance

---

## Verification

After completing all tasks:
1. Apps list has sorting dropdown and search
2. Grid/list toggle works and persists
3. Bulk selection and actions work
4. Destructive actions have confirmation
5. Status indicators are prominent and clear
6. App cards show useful info
7. All buttons have icons
8. Page remains performant with many apps

---

## Success Criteria
- [ ] App status visible at a glance
- [ ] Quick actions work reliably with icons
- [ ] Sorting and filtering work correctly
- [ ] Bulk actions functional with confirmation
- [ ] Grid/list toggle works

---

## Output
- Modified `frontend/src/pages/Applications.jsx`
- Modified `frontend/src/styles/pages/_applications.less`
- Phase 8 SUMMARY.md on completion
