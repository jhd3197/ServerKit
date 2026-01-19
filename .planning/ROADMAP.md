# ServerKit Enhancement Roadmap

---

## Completed Milestones

### [Milestone 1: Infrastructure Fixes, Private URLs & UI Polish](./milestones/v1.0-ROADMAP.md) (v1.0)
Completed 2026-01-19 | 9 phases | 109 commits | +14,667/-2,836 lines

### [Milestone 2: Multi-Environment WordPress & Community Features](./milestones/v1.1-ROADMAP.md) (v1.1)
Completed 2026-01-19 | 5 phases | Multi-environment app linking, shared DB support, GitHub integration

---

## Current Milestone

> **No active milestone**
> Ready for next milestone planning

---

## Phase Overview

| Phase | Name | Status | Goal |
|-------|------|--------|------|
| 11 | Shared Database WordPress Template | **completed** | Create WordPress template with external DB support |
| 12 | Multi-Environment App Linking | **completed** | Link prod/dev apps to share database |
| 13 | Environment Switching UI | **completed** | UI to manage prod/dev environments |
| 14 | GitHub & Community Links | **completed** | Add GitHub link, community resources to app |
| 15 | WordPress Dev Workflow Testing | **completed** | End-to-end testing and documentation |

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

## Phase 12: Multi-Environment App Linking ✓
**Goal**: Allow apps to be linked as prod/dev pairs sharing a database

**Status**: Completed 2026-01-19

### What Was Built
- Application model with `environment_type`, `linked_app_id`, `shared_config` fields
- App linking API: POST/GET/DELETE `/apps/{id}/link`, PUT `/apps/{id}/environment`
- `propagate_db_credentials()` for sharing DB credentials with different table prefixes
- Frontend API methods: `linkApp`, `getLinkedApps`, `unlinkApp`, `updateAppEnvironment`
- GET /apps with environment filtering and include_linked option

### Success Criteria
- [x] Apps can be linked as prod/dev pairs
- [x] Linked apps share database credentials automatically
- [x] Table prefixes prevent collision

[Full Summary](./phases/12-multi-environment-app-linking/SUMMARY.md)

---

## Phase 13: Environment Switching UI ✓
**Goal**: UI to manage and switch between prod/dev environments

**Status**: Completed 2026-01-19

### What Was Built
- Environment badges (PROD/DEV/STAGING) in app list with color coding
- Environment filter dropdown in apps toolbar with URL param persistence
- LinkedAppsSection component showing linked apps with navigation/unlink buttons
- LinkAppModal for linking apps with environment selection and DB credential options
- Environment settings in Settings tab with change/unlink functionality
- Comprehensive LESS styles for all new components

### Success Criteria
- [x] Environment type visible in UI
- [x] Easy navigation between linked apps
- [ ] Theme sync works for WordPress apps (deferred to Phase 15)

[Full Summary](./phases/13-environment-switching-ui/SUMMARY.md)

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

## Phase 15: WordPress Dev Workflow Testing ✓
**Goal**: End-to-end testing of the complete dev workflow

**Status**: Completed 2026-01-19

### What Was Built
- TEST-PLAN.md with 8-step validation workflow
- docs/MULTI_ENVIRONMENT.md user guide
- Updated docs/README.md with multi-environment section
- Comprehensive documentation for the feature

### Success Criteria
- [x] Test plan documents complete workflow
- [x] User guide is clear and actionable
- [x] Documentation is discoverable from main README
- [ ] Theme sync works as expected (deferred to future release)

[Full Summary](./phases/15-wordpress-dev-workflow-testing/SUMMARY.md)

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
