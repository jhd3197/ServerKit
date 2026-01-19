# Phase 9: FileManager Disk Usage UI

## Objective
Improve disk usage visualization in the FileManager with enhanced widgets, directory size analysis, storage breakdown charts, and better UI organization.

## Context

### Current State
- FileManager at `frontend/src/pages/FileManager.jsx` (635 lines)
  - Basic disk usage bar showing used/total/percent
  - Color coding for warning (>75%) and critical (>90%)
  - `loadDiskUsage()` calls `api.getDiskUsage(currentPath)`
- Backend `FileService.get_disk_usage()` uses `shutil.disk_usage(path)`
  - Returns total, used, free, percent, and human-readable versions
- Styles in `frontend/src/styles/pages/_file-manager.less`
- Recharts already used in project (MetricsGraph component)

### Key Files
- `frontend/src/pages/FileManager.jsx` - Main page
- `frontend/src/styles/pages/_file-manager.less` - Styles
- `frontend/src/services/api.js` - API methods
- `backend/app/api/files.py` - Files API
- `backend/app/services/file_service.py` - File service

### What Works Well
- Basic disk usage display
- File browsing and management
- Color-coded progress bar

### What Needs Improvement
- No multi-mount point support
- No directory size analysis
- No file type breakdown
- Disk widget takes up horizontal space
- No visualization beyond simple bar

---

## Tasks

### Task 1: Add Backend Directory Size Analysis Endpoint
**Goal**: Create endpoint to analyze directory sizes

**Files to modify**:
- `backend/app/services/file_service.py`
- `backend/app/api/files.py`

**Implementation**:
1. Add `analyze_directory_sizes(path)` method to FileService:
   - Use `os.scandir()` to iterate directory
   - Calculate sizes recursively for subdirectories (with depth limit)
   - Return array of `{name, path, size, size_human, is_dir}`
   - Sort by size descending
   - Limit to top 20 entries
2. Add `/files/analyze` endpoint:
   - Accept `path` parameter
   - Optional `depth` param (default 1)
   - Return subdirectory sizes and large files
3. Add `get_all_disk_mounts()` method:
   - Use `psutil.disk_partitions()`
   - Return array of mount points with usage stats

**Verification**: API returns directory sizes correctly

---

### Task 2: Add Multi-Mount Disk Usage Widget
**Goal**: Show disk usage for all mount points with visual bars

**Files to modify**:
- `frontend/src/pages/FileManager.jsx`
- `frontend/src/styles/pages/_file-manager.less`
- `frontend/src/services/api.js`

**Implementation**:
1. Add `getAllDiskUsage()` API method
2. Replace single disk bar with multi-mount widget:
   - Each mount shows: device, mountpoint, progress bar, used/total
   - Color coding: green (<70%), yellow (70-90%), red (>=90%)
3. Make widget collapsible (collapsed by default)
4. Add refresh button with last updated timestamp
5. Style as card in sidebar area

**Verification**: All mounts display with correct percentages and colors

---

### Task 3: Create Directory Analysis Panel
**Goal**: Add "Analyze" button to show directory sizes

**Files to modify**:
- `frontend/src/pages/FileManager.jsx`
- `frontend/src/styles/pages/_file-manager.less`

**Implementation**:
1. Add "Analyze" button to toolbar
2. Create `analyzeDirectory()` function that calls new endpoint
3. Add `directoryAnalysis` state to store results
4. Create analysis panel showing:
   - Bar chart of subdirectory sizes (horizontal bars)
   - Each bar shows: name, size, percentage of parent
   - Click bar to navigate to that directory
5. Show loading state during analysis
6. Add close button to dismiss panel

**Verification**: Analysis shows accurate directory sizes

---

### Task 4: Add Storage Type Breakdown
**Goal**: Show pie chart of space used by file type

**Files to modify**:
- `backend/app/services/file_service.py`
- `backend/app/api/files.py`
- `frontend/src/pages/FileManager.jsx`
- `frontend/src/styles/pages/_file-manager.less`

**Implementation**:
1. Add `get_file_type_breakdown(path)` backend method:
   - Walk directory tree (with depth limit for performance)
   - Categorize files: images, videos, documents, code, archives, other
   - Calculate total size per category
   - Return category name, size, count, color
2. Add `/files/type-breakdown` endpoint
3. Add frontend API method
4. Create pie chart component using Recharts PieChart
5. Show legend with category names and sizes
6. Display in analysis panel alongside directory sizes

**Verification**: Pie chart shows accurate file type distribution

---

### Task 5: Add Largest Files List
**Goal**: Show top 10 largest files in current directory

**Files to modify**:
- `frontend/src/pages/FileManager.jsx`
- `frontend/src/styles/pages/_file-manager.less`

**Implementation**:
1. Extend directory analysis to include largest files
2. Create "Largest Files" section in analysis panel:
   - Show file name, size, path
   - Truncate long paths
   - Click to select file in file list
3. Add toggle between "By Directory" and "By File" views
4. Style list with consistent spacing

**Verification**: Shows correct largest files, navigation works

---

### Task 6: Reorganize Layout with Collapsible Sidebar
**Goal**: Move disk/analysis widgets to collapsible sidebar panel

**Files to modify**:
- `frontend/src/pages/FileManager.jsx`
- `frontend/src/styles/pages/_file-manager.less`

**Implementation**:
1. Create sidebar layout structure:
   - Main content (file list + preview)
   - Right sidebar (disk usage, analysis)
2. Add toggle button to show/hide sidebar
3. Sidebar sections:
   - Disk Usage (collapsible)
   - Directory Analysis (when active)
   - File Type Breakdown (when active)
4. Save sidebar state to localStorage
5. Responsive: sidebar becomes bottom sheet on mobile

**Verification**: Layout works at all screen sizes

---

### Task 7: Add Lucide Icons Throughout
**Goal**: Replace emoji icons with Lucide React icons

**Files to modify**:
- `frontend/src/pages/FileManager.jsx`
- `frontend/src/styles/pages/_file-manager.less`

**Implementation**:
1. Import Lucide icons: Folder, File, FileCode, FileImage, etc.
2. Replace emoji-based file icons with Lucide components
3. Replace `<span className="icon">` with Lucide icons
4. Add icons to analysis panel sections
5. Ensure consistent icon sizing

**Verification**: All icons render correctly

---

### Task 8: Polish and Responsive Adjustments
**Goal**: Ensure everything works well on all screen sizes

**Files to modify**:
- `frontend/src/styles/pages/_file-manager.less`

**Implementation**:
1. Add responsive breakpoints for:
   - Sidebar visibility (<1200px: bottom sheet)
   - File list columns (<768px: hide some columns)
   - Analysis charts (<640px: stack vertically)
2. Add smooth transitions for sidebar toggle
3. Ensure touch-friendly tap targets
4. Test and fix any layout issues

**Verification**: Works on mobile, tablet, and desktop

---

## Verification

After completing all tasks:
1. All mount points show with color-coded progress bars
2. "Analyze" button shows directory sizes and type breakdown
3. Charts render correctly with Recharts
4. Largest files list navigates correctly
5. Sidebar collapses and expands smoothly
6. Layout responsive at all sizes
7. Build succeeds with no errors

---

## Success Criteria
- [ ] Multi-mount disk usage visible
- [ ] Directory analysis functional
- [ ] Pie chart shows file type breakdown
- [ ] Largest files list works
- [ ] Sidebar layout responsive
- [ ] All icons are Lucide components

---

## Output
- Modified `frontend/src/pages/FileManager.jsx`
- Modified `frontend/src/styles/pages/_file-manager.less`
- Modified `frontend/src/services/api.js`
- Modified `backend/app/services/file_service.py`
- Modified `backend/app/api/files.py`
- Phase 9 SUMMARY.md on completion
