# Phase 14: GitHub & Community Links

## Objective
Add GitHub repository link and community resources throughout the application UI, including version checking for updates.

## Execution Context

### Key Files
- `frontend/src/pages/Settings.jsx` - AboutSection component (lines 1649-1754)
- `frontend/src/components/Sidebar.jsx` - Navigation sidebar
- `frontend/src/styles/pages/_settings.less` - About section styles
- `frontend/src/styles/layout/_sidebar.less` - Sidebar styles
- `frontend/src/services/api.js` - API service
- `backend/app/api/system.py` - Version endpoint

### Existing State
- **AboutSection already exists** in Settings.jsx with:
  - Version display (fetched from `/api/v1/system/version`)
  - GitHub link pointing to `https://github.com/serverkit` (needs update to correct URL)
  - Documentation link (placeholder `#`)
  - Support link (placeholder `#`)
- **Sidebar** has user profile at bottom but no external links
- **Lucide icons** already used throughout frontend

### Repository URLs
- Main: `https://github.com/jhd3197/ServerKit`
- Issues: `https://github.com/jhd3197/ServerKit/issues`
- Discussions: `https://github.com/jhd3197/ServerKit/discussions`
- Releases: `https://github.com/jhd3197/ServerKit/releases`
- Wiki/Docs: `https://github.com/jhd3197/ServerKit/wiki` (or README)

---

## Tasks

### Task 1: Update About Section Links
**File**: `frontend/src/pages/Settings.jsx`

Update the existing AboutSection component:

1. **Fix GitHub URL** (line 1722)
   - Change from `https://github.com/serverkit` to `https://github.com/jhd3197/ServerKit`

2. **Add functional links**
   - Documentation → `https://github.com/jhd3197/ServerKit#readme`
   - Support → `https://github.com/jhd3197/ServerKit/issues`

3. **Add additional community links**
   - GitHub Discussions: `https://github.com/jhd3197/ServerKit/discussions`
   - Report Bug: `https://github.com/jhd3197/ServerKit/issues/new`
   - Star on GitHub badge/prompt

4. **Replace inline SVGs with Lucide icons**
   - Import: `Github, FileText, HelpCircle, MessageSquare, Bug, Star`
   - Replace existing SVG icons with Lucide components

### Task 2: Add Version Update Check
**Files**: `backend/app/api/system.py`, `frontend/src/pages/Settings.jsx`, `frontend/src/services/api.js`

1. **Backend: Add GitHub releases check endpoint**
   ```python
   @system_bp.route('/check-update', methods=['GET'])
   def check_update():
       # Fetch latest release from GitHub API
       # Compare with current version
       # Return: current_version, latest_version, update_available, release_url
   ```

2. **Frontend API: Add checkUpdate method**
   ```javascript
   async checkUpdate() {
       return this.request('/system/check-update');
   }
   ```

3. **Frontend UI: Show update notification in AboutSection**
   - Display "Update available: v1.x.x" with link to release
   - Badge/indicator when update available
   - "You're up to date" message when current

### Task 3: Add GitHub Link to Sidebar
**Files**: `frontend/src/components/Sidebar.jsx`, `frontend/src/styles/layout/_sidebar.less`

1. **Add GitHub icon link between nav and user profile**
   - Small GitHub icon with hover effect
   - Links to repository
   - Tooltip: "View on GitHub"

2. **Styling**
   - Match existing sidebar aesthetic
   - Subtle but visible
   - Hover state with accent color

### Task 4: Add Star Prompt for New Users
**Files**: `frontend/src/pages/Settings.jsx`, `frontend/src/styles/pages/_settings.less`

1. **Add "Star on GitHub" card**
   - Shows in About section
   - GitHub star icon with count (if API allows)
   - Dismissible (localStorage to remember)
   - Friendly CTA: "If you find ServerKit useful, consider starring the repo!"

2. **Styling**
   - Accent-colored border or background
   - Star icon prominent
   - Dismiss button (X)

---

## Verification

After implementation:
1. [ ] GitHub link in About section opens correct repository
2. [ ] Documentation link opens README
3. [ ] Support/Issues link opens GitHub Issues
4. [ ] Discussions link opens GitHub Discussions
5. [ ] Sidebar GitHub icon visible and functional
6. [ ] Update check shows current version status
7. [ ] Star prompt displays for new users
8. [ ] Star prompt can be dismissed
9. [ ] All icons are Lucide (no inline SVGs in changed code)
10. [ ] Build passes without errors

---

## Success Criteria
- [ ] GitHub link visible in main UI (sidebar)
- [ ] Documentation accessible from Settings
- [ ] Version check shows update availability
- [ ] Community links functional (Issues, Discussions)

---

## Output
- Modified: `frontend/src/pages/Settings.jsx`
- Modified: `frontend/src/components/Sidebar.jsx`
- Modified: `frontend/src/styles/pages/_settings.less`
- Modified: `frontend/src/styles/layout/_sidebar.less`
- Modified: `frontend/src/services/api.js`
- Modified: `backend/app/api/system.py`
- Created: `.planning/phases/14-github-community-links/SUMMARY.md`

---

## Notes
- GitHub API rate limits: 60 requests/hour for unauthenticated. Cache update check result.
- Star count requires GitHub API call - consider if worth the complexity
- Keep changes minimal and focused per CLAUDE.md guidelines
