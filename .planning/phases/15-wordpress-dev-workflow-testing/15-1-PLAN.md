# Phase 15: WordPress Dev Workflow Testing

## Objective
Validate the complete multi-environment WordPress workflow end-to-end and create user documentation for the feature.

## Execution Context
- **Phase**: 15 of Milestone 2
- **Type**: Testing & Documentation (no code changes expected)
- **Dependencies**: Phases 11-14 completed
- **Estimated Scope**: Small (documentation only - no code)

## Context

### What Was Built (Phases 11-14)
1. **Phase 11**: WordPress External DB template (`wordpress-external-db.yaml`) allowing WordPress to connect to external MySQL
2. **Phase 12**: App linking API (`POST/GET/DELETE /apps/{id}/link`) with database credential propagation
3. **Phase 13**: UI for environment badges, linked apps section, link modal, and environment settings
4. **Phase 14**: GitHub links and community resources

### Key Components to Test
- Template: `backend/templates/wordpress-external-db.yaml`
- API: `POST /apps/{id}/link`, `GET /apps/{id}/linked`, `DELETE /apps/{id}/link`
- Frontend: LinkAppModal, LinkedAppsSection, environment badges
- DB propagation: `propagate_db_credentials()` in template_service.py

## Tasks

### Task 1: Create Test Plan Document
**Goal**: Document the complete test workflow with expected outcomes

Create `.planning/phases/15-wordpress-dev-workflow-testing/TEST-PLAN.md` with:
- Prerequisites (MySQL server, ServerKit running)
- Step-by-step test procedure
- Expected outcomes for each step
- Rollback procedures

### Task 2: Create Multi-Environment User Guide
**Goal**: Create user documentation for the multi-environment feature

Create `docs/MULTI_ENVIRONMENT.md` with:
- Feature overview (what prod/dev linking is)
- Use case: WordPress theme development workflow
- Step-by-step setup guide:
  1. Create production WordPress (standard template)
  2. Create development WordPress (external-db template)
  3. Link apps via UI
  4. Verify database sharing
- Limitations and gotchas
- FAQ section

### Task 3: Update Main Documentation
**Goal**: Reference the new feature in existing docs

Update `docs/README.md`:
- Add section about multi-environment support
- Link to MULTI_ENVIRONMENT.md guide

### Task 4: Create SUMMARY.md
**Goal**: Document phase completion

Create `.planning/phases/15-wordpress-dev-workflow-testing/SUMMARY.md`:
- What was tested/documented
- Documentation files created
- Any issues discovered
- Milestone 2 completion status

### Task 5: Complete Milestone 2
**Goal**: Finalize milestone and prepare for release

- Update STATE.md marking Phase 15 and Milestone 2 complete
- Update ROADMAP.md with completion status
- Git commit all changes

## Verification

After completing all tasks:
- [ ] TEST-PLAN.md exists with complete workflow
- [ ] docs/MULTI_ENVIRONMENT.md exists with setup guide
- [ ] docs/README.md references multi-environment feature
- [ ] SUMMARY.md documents phase completion
- [ ] STATE.md shows Milestone 2 complete
- [ ] ROADMAP.md shows all phases complete

## Success Criteria

- [ ] Test plan documents complete workflow
- [ ] User guide is clear and actionable
- [ ] Documentation is discoverable from main README
- [ ] Milestone 2 marked complete in project state

## Output

| File | Type |
|------|------|
| `.planning/phases/15-wordpress-dev-workflow-testing/TEST-PLAN.md` | New |
| `docs/MULTI_ENVIRONMENT.md` | New |
| `docs/README.md` | Modified |
| `.planning/phases/15-wordpress-dev-workflow-testing/SUMMARY.md` | New |
| `.planning/STATE.md` | Modified |
| `.planning/ROADMAP.md` | Modified |

## Notes

- This phase does NOT require actual deployment/testing of WordPress instances
- Focus is on creating documentation so users can follow the workflow
- Theme sync feature was deferred from Phase 13 - document this as a limitation
- No code changes expected - documentation only
