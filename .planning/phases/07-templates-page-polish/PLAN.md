# Phase 7: Templates Page Polish

## Objective
Fix broken icons, improve filtering UX, and enhance template cards with better information display.

## Context

### Current State
- Templates page exists at `frontend/src/pages/Templates.jsx`
- Templates are stored as YAML files in `backend/templates/`
- Each template has an `icon` field with external URLs (may be broken)
- Category filtering exists but lacks clear filter state indication
- No URL param persistence for filters
- Template detail modal shows basic info

### Key Files
- `frontend/src/pages/Templates.jsx` - Main page component
- `frontend/src/styles/pages/_templates.less` - Styles
- `backend/templates/*.yaml` - Individual template files
- `backend/templates/index.json` - Template index
- `backend/app/services/template_service.py` - Template service
- `backend/app/api/templates.py` - API endpoints

### Dependencies
- Lucide icons already available in project
- No new packages needed

---

## Tasks

### Task 1: Add Lucide Icon Mappings for Templates
**Goal**: Create icon mapping using Lucide icons as fallback when external icons fail

**Files to modify**:
- `frontend/src/pages/Templates.jsx`

**Implementation**:
1. Create `getTemplateIcon(templateId)` function that maps template IDs to Lucide icons
2. Map each template to an appropriate icon (e.g., wordpress → Globe, grafana → BarChart3, etc.)
3. Update template card to try img first, fall back to Lucide icon on error
4. Add `onError` handler to img tags that switches to fallback

**Verification**: Template cards show icons even when external URLs fail

---

### Task 2: Add Icon Error Handling with State
**Goal**: Handle icon load failures gracefully with visual fallback

**Files to modify**:
- `frontend/src/pages/Templates.jsx`

**Implementation**:
1. Add state to track which template icons have failed loading
2. Create `handleIconError(templateId)` that adds ID to failed set
3. When icon fails, render Lucide icon instead of broken img
4. Apply same logic to modal large icon

**Verification**: No broken image placeholders visible

---

### Task 3: Add URL Param Persistence for Filters
**Goal**: Persist category and search filters in URL for shareable links

**Files to modify**:
- `frontend/src/pages/Templates.jsx`

**Implementation**:
1. Import `useSearchParams` from react-router-dom
2. Initialize `selectedCategory` and `searchQuery` from URL params
3. Update URL when filters change using `setSearchParams`
4. Handle browser back/forward navigation

**Verification**:
- Filtering updates URL (e.g., `/templates?category=monitoring&search=uptime`)
- Refreshing page preserves filter state
- Browser back button works

---

### Task 4: Add Active Filter Chips with Clear Button
**Goal**: Show active filters as removable chips with "Clear All" option

**Files to modify**:
- `frontend/src/pages/Templates.jsx`
- `frontend/src/styles/pages/_templates.less`

**Implementation**:
1. Add filter chips section below search/category filters
2. Show chip for active category with X button to remove
3. Show chip for search term (if any) with X button
4. Add "Clear All" button when any filter is active
5. Style chips to match design system

**Verification**: Active filters visible and removable via chips

---

### Task 5: Enhance Template Cards with Additional Info
**Goal**: Add version badge styling and improve card layout

**Files to modify**:
- `frontend/src/pages/Templates.jsx`
- `frontend/src/styles/pages/_templates.less`

**Implementation**:
1. Make version badge more prominent with colored background
2. Add website/docs link indicator if available (small icon)
3. Add "Popular" or "Featured" indicator for select templates (hardcoded list initially)
4. Improve category badge styling

**Verification**: Cards show enhanced info clearly

---

### Task 6: Improve Template Detail Modal
**Goal**: Enhance modal with better organization and system requirements

**Files to modify**:
- `frontend/src/pages/Templates.jsx`
- `frontend/src/styles/pages/_templates.less`

**Implementation**:
1. Add "Requirements" section showing memory/storage needs
2. Show Docker Compose preview (collapsible code block)
3. Improve section headers with icons
4. Add copy button for Docker Compose
5. Better organize variable list (group by type: required vs optional)

**Verification**: Modal provides comprehensive template info

---

### Task 7: Add Search Icon to Search Input
**Goal**: Add visual search icon inside the search input

**Files to modify**:
- `frontend/src/pages/Templates.jsx`
- `frontend/src/styles/pages/_templates.less`

**Implementation**:
1. Import Search icon from lucide-react
2. Wrap search input in container with positioned icon
3. Add left padding to input for icon space
4. Style icon appropriately

**Verification**: Search input has icon

---

### Task 8: Add Results Count and Sort Options
**Goal**: Show template count and add sort dropdown

**Files to modify**:
- `frontend/src/pages/Templates.jsx`
- `frontend/src/styles/pages/_templates.less`

**Implementation**:
1. Add results header showing "X templates" count
2. Add sort dropdown (Name A-Z, Name Z-A, Version, Category)
3. Implement sorting logic
4. Persist sort preference in URL params

**Verification**: Count visible, sorting works correctly

---

## Verification

After completing all tasks:
1. All template icons load (fallback works)
2. Filtering is intuitive with visible chips
3. URL reflects current filter state
4. Template cards show useful information
5. Detail modal provides comprehensive info
6. Search has visual icon
7. Results can be sorted
8. Page remains performant

---

## Success Criteria
- [ ] All icons load correctly (with fallbacks)
- [ ] Filtering is intuitive and persistent
- [ ] Template cards show useful info at a glance
- [ ] Details modal provides complete information
- [ ] Search and sort enhance discoverability

---

## Output
- Modified `frontend/src/pages/Templates.jsx`
- Modified `frontend/src/styles/pages/_templates.less`
- Phase 7 SUMMARY.md on completion
