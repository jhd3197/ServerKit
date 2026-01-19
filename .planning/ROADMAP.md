# ServerKit Enhancement Roadmap

---

## Completed Milestones

### [Milestone 1: Infrastructure Fixes, Private URLs & UI Polish](./milestones/v1.0-ROADMAP.md) (v1.0)
Completed 2026-01-19 | 9 phases | 109 commits | +14,667/-2,836 lines

---

## Current Milestone

> **Milestone 2**: Multi-Environment WordPress & Community Features
> **Version**: v1.1
> **Started**: 2026-01-19
> **Status**: In Progress

---

## Phase Overview

| Phase | Name | Status | Goal |
|-------|------|--------|------|
| 11 | Shared Database WordPress Template | **completed** | Create WordPress template with external DB support |
| 12 | Multi-Environment App Linking | pending | Link prod/dev apps to share database |
| 13 | Environment Switching UI | pending | UI to manage prod/dev environments |
| 14 | GitHub & Community Links | **completed** | Add GitHub link, community resources to app |
| 15 | WordPress Dev Workflow Testing | pending | End-to-end testing of the dev workflow |

---

## Phase 11: Shared Database WordPress Template ✓
**Goal**: Create a WordPress template variant that connects to an external database instead of its own

**Status**: Completed 2026-01-19

### What Was Built
- `wordpress-external-db.yaml` template with DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, TABLE_PREFIX variables
- `validate_mysql_connection()` in template_service.py with socket + pymysql validation
- `POST /templates/test-db-connection` API endpoint
- `testDatabaseConnection()` frontend API method

### Success Criteria
- [x] WordPress template can connect to external MySQL
- [x] Connection errors shown clearly during install
- [x] Table prefix configurable

[Full Summary](./phases/11-shared-database-wordpress-template/SUMMARY.md)

---

## Phase 12: Multi-Environment App Linking
**Goal**: Allow apps to be linked as prod/dev pairs sharing a database

### Tasks
1. **Database schema updates**
   - Add `linked_app_id` field to Application model
   - Add `environment_type` field (prod/dev/staging)
   - Add `shared_resource_config` JSON field for shared resources

2. **App linking API**
   - `POST /api/v1/apps/{id}/link` - Link two apps
   - `GET /api/v1/apps/{id}/linked` - Get linked apps
   - `DELETE /api/v1/apps/{id}/link` - Unlink apps
   - Validation: only same-type apps can link

3. **Shared database configuration**
   - When linking, propagate database credentials
   - Auto-configure table prefixes to avoid collision
   - Show shared resources in app detail

### Success Criteria
- [ ] Apps can be linked as prod/dev pairs
- [ ] Linked apps share database credentials automatically
- [ ] Table prefixes prevent collision

---

## Phase 13: Environment Switching UI
**Goal**: UI to manage and switch between prod/dev environments

### Tasks
1. **Environment badge in app list**
   - Show "PROD" / "DEV" / "STAGING" badge
   - Color coding (green=prod, blue=dev, yellow=staging)
   - Filter apps by environment type

2. **Linked apps section in app detail**
   - Show linked apps with quick navigation
   - Environment comparison (running status, version, etc.)
   - Quick action: "Copy theme from dev to prod"

3. **Environment configuration panel**
   - Set environment type for existing apps
   - Link/unlink apps UI
   - Shared resource visualization

4. **Theme sync feature (WordPress-specific)**
   - Copy theme files from dev to prod
   - Preview changes before sync
   - Rollback capability

### Success Criteria
- [ ] Environment type visible in UI
- [ ] Easy navigation between linked apps
- [ ] Theme sync works for WordPress apps

---

## Phase 14: GitHub & Community Links
**Goal**: Add GitHub repository link and community resources to the application

### Tasks
1. **Add GitHub link to UI**
   - GitHub icon in header/footer
   - Link to repository (github.com/jhd3197/ServerKit)
   - "Star on GitHub" prompt for new users

2. **Add documentation links**
   - Link to README/Wiki
   - Quick start guide link
   - API documentation link (if available)

3. **Add community section to Settings page**
   - GitHub Issues link for bug reports
   - Discussions link for questions
   - Contributing guidelines link

4. **Add version info with update check**
   - Show current version in Settings
   - Check for new releases via GitHub API
   - "Update available" notification

### Success Criteria
- [ ] GitHub link visible in main UI
- [ ] Documentation accessible from Settings
- [ ] Version check shows update availability

---

## Phase 15: WordPress Dev Workflow Testing
**Goal**: End-to-end testing of the complete dev workflow

### Tasks
1. **Create test plan**
   - Document full workflow steps
   - Define success criteria for each step
   - Prepare test data

2. **Test: Deploy prod WordPress**
   - Install WordPress with standard template
   - Configure domain
   - Create sample content

3. **Test: Deploy dev WordPress (shared DB)**
   - Install WordPress-External-DB template
   - Link to prod app
   - Verify shared database connection
   - Verify separate table prefixes

4. **Test: Theme development workflow**
   - Install different theme on dev
   - Make theme customizations
   - Sync theme to prod
   - Verify prod unchanged until sync

5. **Document workflow**
   - Create user guide for multi-environment setup
   - Add examples to documentation
   - Note any limitations or gotchas

### Success Criteria
- [ ] Full workflow completes without errors
- [ ] Data isolation works correctly
- [ ] Theme sync works as expected
- [ ] Documentation is complete

---

## Dependencies

```
Phase 11 (Shared DB Template) ──► Phase 12 (App Linking)
                                        │
                                        ▼
Phase 12 ────────────────────► Phase 13 (Environment UI)
                                        │
                                        ▼
Phase 13 ────────────────────► Phase 15 (Testing)

Phase 14 (GitHub Links) ─────► Phase 15 (Testing)
```

---

## Notes

- Phases 11-13 are the core multi-environment feature
- Phase 14 (GitHub links) can be done independently
- Phase 15 should run last after all features implemented
- Table prefix approach avoids complexity of separate databases
- Consider backup strategy before theme sync operations

---

## Estimated Complexity

| Phase | Complexity | Files Changed |
|-------|------------|---------------|
| 11 | Medium | 3-5 (template + validation) |
| 12 | High | 6-8 (model, API, service) |
| 13 | High | 5-7 (UI components) |
| 14 | Low | 2-4 (UI only) |
| 15 | Low | 0 (testing + docs) |
