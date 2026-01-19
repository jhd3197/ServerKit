# Multi-Environment WordPress Workflow - Test Plan

## Overview
This test plan validates the complete multi-environment WordPress workflow implemented in Milestone 2 (Phases 11-14).

## Prerequisites

### Server Requirements
- ServerKit running and accessible
- MySQL server available (can be the same server or external)
- At least 2 available ports for WordPress instances
- Sufficient disk space for 2 WordPress installations (~500MB each)

### User Requirements
- Admin access to ServerKit dashboard
- MySQL credentials (host, port, user, password, database)
- Basic familiarity with WordPress

## Test Workflow

### Step 1: Deploy Production WordPress

**Action**: Install WordPress using the standard template

1. Navigate to **Applications** > **New Application**
2. Select **WordPress** template (standard, not external-db)
3. Configure:
   - Name: `wordpress-prod`
   - Port: Auto-assigned or manual (e.g., 8080)
4. Click **Install**
5. Wait for installation to complete

**Expected Outcome**:
- Application shows "running" status
- WordPress accessible at configured port
- Database tables created with default `wp_` prefix
- Application shows as "Standalone" environment type

**Verification**:
- [ ] App appears in applications list
- [ ] Status badge shows "Running"
- [ ] WordPress admin accessible at `/wp-admin`

---

### Step 2: Create Sample Content in Production

**Action**: Add content to production WordPress

1. Access WordPress admin at `http://localhost:{port}/wp-admin`
2. Log in with generated credentials (check app credentials)
3. Create:
   - 2-3 sample posts
   - 1-2 sample pages
   - Upload a test image

**Expected Outcome**:
- Content visible in WordPress frontend
- Data stored in database with `wp_` table prefix

**Verification**:
- [ ] Posts visible on frontend
- [ ] Media library contains uploaded image

---

### Step 3: Deploy Development WordPress (Shared DB)

**Action**: Install WordPress using the external-db template

1. Navigate to **Applications** > **New Application**
2. Select **WordPress (External Database)** template
3. Configure:
   - Name: `wordpress-dev`
   - Port: Different from prod (e.g., 8081)
   - DB Host: Same as production's database host
   - DB Port: Same as production (usually 3306)
   - DB Name: Same as production database
   - DB User: Same as production
   - DB Password: Same as production
   - Table Prefix: `wp_dev_` (different from production)
4. Click **Test Connection** to validate
5. Click **Install**

**Expected Outcome**:
- Connection test passes
- Application installs successfully
- WordPress accessible at configured port
- Database tables created with `wp_dev_` prefix

**Verification**:
- [ ] Connection test shows "Success"
- [ ] App appears in applications list
- [ ] WordPress admin accessible
- [ ] Database shows both `wp_*` and `wp_dev_*` tables

---

### Step 4: Link Applications

**Action**: Link dev and prod WordPress as environment pair

1. Navigate to `wordpress-prod` application detail
2. In **Overview** tab, find **Environment Linking** section
3. Click **Link App** button
4. In modal:
   - Select `wordpress-dev` from dropdown
   - Choose **Development** as environment type
   - Enable **Propagate database credentials** (should already match)
5. Click **Link Apps**

**Expected Outcome**:
- Modal closes
- Both apps show environment badges
- `wordpress-prod` shows "PROD" badge
- `wordpress-dev` shows "DEV" badge
- Linked Apps section shows the linked app

**Verification**:
- [ ] Environment badges visible in app list
- [ ] Linked Apps section shows partner app
- [ ] Navigate button works to switch between apps
- [ ] Shared Database info displayed (if credentials propagated)

---

### Step 5: Verify Data Isolation

**Action**: Confirm dev and prod have separate data

1. Access `wordpress-dev` admin
2. Verify it has its own:
   - Posts (separate from prod)
   - Users (separate admin)
   - Settings
3. Create a test post in dev: "Dev Test Post"
4. Verify prod does NOT show "Dev Test Post"

**Expected Outcome**:
- Dev WordPress is completely independent
- Changes in dev don't affect prod
- Both use same database but different table prefixes

**Verification**:
- [ ] Dev has independent content
- [ ] Prod content unchanged after dev modifications
- [ ] Database shows separate table sets (`wp_posts` vs `wp_dev_posts`)

---

### Step 6: Test Environment Navigation

**Action**: Use UI to navigate between linked apps

1. From `wordpress-dev` detail page, find Linked Apps section
2. Click navigate button to go to `wordpress-prod`
3. Verify you're now on `wordpress-prod` detail page
4. Click navigate button to return to `wordpress-dev`

**Expected Outcome**:
- One-click navigation between linked apps
- Correct app loaded each time

**Verification**:
- [ ] Navigate from dev to prod works
- [ ] Navigate from prod to dev works

---

### Step 7: Test Unlinking

**Action**: Unlink the applications

1. From either app's detail page
2. Go to **Settings** tab
3. Find **Linked Application** section
4. Click **Unlink Application**
5. Confirm the action

**Expected Outcome**:
- Both apps become "Standalone" again
- Environment badges removed
- Linked Apps section shows empty state
- Both apps continue to function independently

**Verification**:
- [ ] Both apps show "Standalone" environment
- [ ] No environment badges in list
- [ ] Both WordPress instances still accessible

---

### Step 8: Environment Filter Test

**Action**: Test filtering by environment type

1. Navigate to Applications list
2. Use environment filter dropdown
3. Select "Production" - should show only prod apps
4. Select "Development" - should show only dev apps
5. Select "All" - should show all apps

**Expected Outcome**:
- Filter correctly shows/hides apps by environment
- URL updates with filter parameter

**Verification**:
- [ ] Production filter works
- [ ] Development filter works
- [ ] All filter shows everything

---

## Rollback Procedures

### If WordPress Installation Fails
1. Delete the failed application from ServerKit
2. Check Docker logs for errors
3. Verify MySQL connection parameters
4. Retry installation

### If Linking Fails
1. Check both apps are of same type
2. Verify neither app is already linked
3. Check API logs for error details
4. Try unlinking and re-linking

### If Data Appears Corrupted
1. Check table prefixes are correctly different
2. Verify each WordPress is using its designated prefix
3. If needed, unlink apps and reinstall dev instance

## Success Criteria Summary

| Test | Status |
|------|--------|
| Production WordPress deployment | [ ] |
| Sample content creation | [ ] |
| Development WordPress (external DB) | [ ] |
| App linking via UI | [ ] |
| Data isolation verification | [ ] |
| Navigation between linked apps | [ ] |
| Unlinking functionality | [ ] |
| Environment filtering | [ ] |

## Known Limitations

1. **Theme Sync**: Copying themes between environments is not yet implemented (planned for future release)
2. **Same App Type Required**: Can only link apps of the same type (WordPress to WordPress)
3. **Database Must Be Accessible**: External DB must be reachable from ServerKit server
4. **Manual Table Prefix**: User must ensure unique table prefix for dev environment

## Notes

- Test was designed for ServerKit v1.1 with Milestone 2 features
- External database template requires MySQL credentials upfront
- Credential propagation only works for Docker-based apps
