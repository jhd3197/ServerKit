# Phase 13: Environment Switching UI — PLAN

## Objective
Add UI components for managing environment types, linking apps as prod/dev pairs, and syncing themes between WordPress environments.

## Execution Context

**Key Files:**
- `frontend/src/pages/Applications.jsx` — App list (add environment badges)
- `frontend/src/pages/ApplicationDetail.jsx` — App detail (add linked apps section)
- `frontend/src/components/LinkedAppsSection.jsx` — New component for linked apps
- `frontend/src/components/LinkAppModal.jsx` — New modal for linking apps
- `frontend/src/styles/components/_badges.less` — Environment badge styles
- `frontend/src/styles/components/_linked-apps.less` — Linked apps section styles

**API Methods Available (from Phase 12):**
- `api.linkApp(appId, targetAppId, asEnvironment, options)`
- `api.getLinkedApps(appId)`
- `api.unlinkApp(appId)`
- `api.updateAppEnvironment(appId, environmentType)`

**Patterns to Follow:**
- Functional components with hooks
- Lucide icons (already imported in Applications.jsx)
- Status badge pattern from _badges.less
- Card-based UI for sections
- Modal pattern from CreateAppModal

## Tasks

### Task 1: Add Environment Badge to App List
**Files:** `frontend/src/pages/Applications.jsx`, `frontend/src/styles/components/_badges.less`

Add environment badge next to status badge in both list and grid views:
- Show badge only when `environment_type !== 'standalone'`
- Colors: green=production, blue=development, yellow=staging
- Badge text: "PROD", "DEV", "STAGING"
- Add linked icon indicator if `has_linked_app` is true

Update `AppRow` and `AppCard` components to display environment info.

**Verification:** Apps with environment types show colored badges.

---

### Task 2: Add Environment Filter to Apps Toolbar
**File:** `frontend/src/pages/Applications.jsx`

Add environment filter dropdown in toolbar:
- Options: All, Production, Development, Staging, Standalone
- Uses URL params like existing search/sort
- Calls `api.getApps()` with `?environment=` filter

**Verification:** Filter dropdown filters apps by environment type.

---

### Task 3: Create LinkedAppsSection Component
**Files:** `frontend/src/components/LinkedAppsSection.jsx`, `frontend/src/styles/components/_linked-apps.less`

New component showing linked apps in Overview tab:
```jsx
<LinkedAppsSection
    app={app}
    linkedApps={linkedApps}
    onLink={() => setShowLinkModal(true)}
    onUnlink={handleUnlink}
    onNavigate={(appId) => navigate(`/apps/${appId}`)}
/>
```

Features:
- Shows current environment type with colored badge
- Lists linked apps with their status
- "Link App" button to open modal
- "Unlink" button with confirmation
- Quick navigation to linked app

**Verification:** Component renders in Overview tab with linked app info.

---

### Task 4: Create LinkAppModal Component
**File:** `frontend/src/components/LinkAppModal.jsx`

Modal for linking an app to another:
- Dropdown to select target app (filtered to same type, not already linked)
- Environment type selection (This app will be: Development / Production / Staging)
- Table prefix input for WordPress apps (optional, auto-generated default)
- Checkbox: "Propagate database credentials" (default: true)
- Shows preview of what will happen
- Calls `api.linkApp()` on submit

**Verification:** Modal opens, shows compatible apps, links successfully.

---

### Task 5: Integrate Linked Apps Section into ApplicationDetail
**File:** `frontend/src/pages/ApplicationDetail.jsx`

Add LinkedAppsSection to Overview tab:
- Load linked apps on mount using `api.getLinkedApps(id)`
- Add state for `linkedApps`, `showLinkModal`
- Handle unlink with confirmation dialog
- Refresh after link/unlink operations

Update header to show environment badge next to status badge.

**Verification:** Overview tab shows linked apps section with functional link/unlink.

---

### Task 6: Add Environment Settings to Settings Tab
**File:** `frontend/src/pages/ApplicationDetail.jsx`

Add environment configuration section in SettingsTab:
- Current environment type display
- Dropdown to change environment type (standalone apps only)
- Warning when changing linked app environment
- "Unlink from [app name]" button for linked apps

**Verification:** Can change environment type for standalone apps.

---

## Verification

```javascript
// In browser console, verify:
// 1. Apps with environment_type show badges
// 2. Filter dropdown works
// 3. Linked apps section appears in Overview
// 4. Link modal shows compatible apps
// 5. Link/unlink operations work
```

## Success Criteria
- [ ] Environment badges visible in app list (list and grid views)
- [ ] Environment filter dropdown in toolbar
- [ ] Linked apps section in Overview tab
- [ ] Link app modal with target selection
- [ ] Unlink functionality with confirmation
- [ ] Environment type editable in Settings tab

## Output
- Modified: `frontend/src/pages/Applications.jsx`
- Modified: `frontend/src/pages/ApplicationDetail.jsx`
- Created: `frontend/src/components/LinkedAppsSection.jsx`
- Created: `frontend/src/components/LinkAppModal.jsx`
- Modified: `frontend/src/styles/components/_badges.less`
- Created: `frontend/src/styles/components/_linked-apps.less`
