# Phase 3: PHP App Template Testing - Execution Plan

## Objective
Deploy a PHP application template and verify end-to-end functionality: container startup, PHP execution, Nginx routing, and domain access. Verify the Bug 1 fix from Phase 2 works correctly.

## Context

### PHP Template Location
- **Template file**: `backend/templates/php-app.yaml`
- **Version**: PHP 8.3 with Apache
- **Default port**: 8100
- **Image**: `php:8.3-apache`

### Template Structure
```yaml
compose:
  services:
    app:
      image: php:${PHP_VERSION:-8.3}-apache
      ports: "${HTTP_PORT}:80"
      volumes: html:/var/www/html
```

### Key Differences from WordPress
- Single container (no database)
- Apache built-in (not Nginx + PHP-FPM)
- Volume for custom PHP code
- Simpler deployment

### Available Diagnostic Tools (from Phase 1)
- `GET /api/v1/domains/debug/diagnose/{app_id}` - Full routing diagnosis
- `GET /api/v1/apps/{id}/status` - Port accessibility check
- Phase 2 bug fixes: NDJSON parsing should now work correctly

---

## Prerequisites

Before testing:
1. Phase 2 bug fixes deployed (`3f9884c` - NDJSON parsing)
2. Docker installed and running
3. ServerKit backend running
4. Admin API access

---

## Tasks

### Task 1: Verify Template Exists and Is Valid
**Type**: Verification

1. Check that `backend/templates/php-app.yaml` exists
2. Verify template structure matches schema
3. Confirm template is in `backend/templates/index.json`
4. Test template fetch via API: `GET /api/v1/templates/php-app`

**Expected Result**: Template loads without errors

---

### Task 2: Install PHP App Template
**Type**: Testing

1. Call template installation API:
   ```
   POST /api/v1/templates/php-app/install
   {
     "name": "test-php",
     "variables": {
       "HTTP_PORT": "8100",
       "PHP_VERSION": "8.3"
     }
   }
   ```

2. Monitor installation:
   - Check for errors in response
   - Verify `port_accessible` field in response
   - Note the `app_id` returned

3. Verify files created:
   - `/var/serverkit/apps/test-php/docker-compose.yml`
   - `/var/serverkit/apps/test-php/.env`

**Expected Result**: Installation completes, returns app_id

---

### Task 3: Verify Container Status (Bug Fix Validation)
**Type**: Testing + Bug Fix Validation

This task validates the Phase 2 Bug 1 fix (NDJSON parsing).

1. Check Docker container running:
   ```bash
   docker ps --filter "name=test-php"
   ```

2. Call app status API:
   ```
   GET /api/v1/apps/{app_id}/status
   ```
   - **Critical**: Verify `containers` array is NOT empty (Bug 1 fix)
   - Expect: `status: running`, `port_accessible: true`

3. Verify status in database matches actual container state

**Expected Result**: Status endpoint correctly shows running container

**If Bug Not Fixed**:
- containers array is empty
- status shows 'stopped' despite container running
- Need to verify NDJSON fix was deployed

---

### Task 4: Create Test PHP File
**Type**: Testing

1. Create a simple PHP info file in the container:
   ```bash
   docker exec test-php bash -c 'echo "<?php phpinfo(); ?>" > /var/www/html/index.php'
   ```

2. Test direct port access:
   ```bash
   curl http://127.0.0.1:8100/
   ```
   - Should return PHP info page HTML

3. Verify PHP version:
   ```bash
   docker exec test-php php -v
   ```
   - Should show PHP 8.3.x

**Expected Result**: PHP executes correctly, phpinfo() displays

---

### Task 5: Add Domain and Test Nginx Routing
**Type**: Testing

1. Create domain for the app:
   ```
   POST /api/v1/domains
   {
     "name": "test-php.local",
     "application_id": {app_id},
     "is_primary": true
   }
   ```

2. Run diagnostics:
   ```
   GET /api/v1/domains/debug/diagnose/{app_id}
   ```
   - Verify `health.overall` is true
   - Verify `docker.containers` is NOT empty

3. Verify Nginx config:
   ```bash
   cat /etc/nginx/sites-available/test-php
   ```
   - Should proxy to port 8100

4. Test domain routing:
   ```bash
   echo "127.0.0.1 test-php.local" | sudo tee -a /etc/hosts
   curl http://test-php.local/
   ```

**Expected Result**: Domain routes to PHP app, phpinfo() displays

---

### Task 6: Test PHP Functionality
**Type**: Testing

1. Create test PHP script:
   ```bash
   docker exec test-php bash -c 'cat > /var/www/html/test.php << EOF
   <?php
   header("Content-Type: application/json");
   echo json_encode([
       "status" => "ok",
       "php_version" => PHP_VERSION,
       "server" => \$_SERVER["SERVER_SOFTWARE"],
       "document_root" => \$_SERVER["DOCUMENT_ROOT"],
       "extensions" => get_loaded_extensions()
   ]);
   EOF'
   ```

2. Test via curl:
   ```bash
   curl http://test-php.local/test.php
   ```
   - Should return JSON with PHP info

3. Verify common extensions are available:
   - json, mbstring, curl should be loaded

**Expected Result**: PHP scripts execute, JSON returned

---

### Task 7: Document Results
**Type**: Documentation

1. Create test results document with:
   - Installation outcome
   - Container detection (Bug 1 validation)
   - PHP execution
   - Nginx routing
   - Any issues found

2. Compare to WordPress results:
   - Both should now work with Bug 1 fix
   - Note any PHP-specific issues

**Expected Result**: Clear documentation of test results

---

## Verification Checklist

After completing all tasks:

- [ ] PHP template loads from API
- [ ] Template installs without errors
- [ ] Container is detected correctly (Bug 1 validation)
- [ ] Port is accessible on localhost
- [ ] PHP executes in container
- [ ] Domain created without errors
- [ ] Nginx config exists and is enabled
- [ ] Domain routing works via Nginx
- [ ] PHP scripts return expected output
- [ ] Diagnostics show correct health status

---

## Success Criteria

- [ ] PHP apps execute correctly via Nginx
- [ ] Static assets served properly
- [ ] Container detection works (Bug 1 fix validated)

---

## Cleanup (After Testing)

```bash
# Stop and remove container
docker compose -f /var/serverkit/apps/test-php/docker-compose.yml down -v

# Remove app directory
rm -rf /var/serverkit/apps/test-php

# Remove from database
DELETE FROM applications WHERE name = 'test-php';

# Remove Nginx config
sudo rm /etc/nginx/sites-enabled/test-php
sudo rm /etc/nginx/sites-available/test-php
sudo nginx -s reload

# Remove hosts entry
sudo sed -i '/test-php.local/d' /etc/hosts
```

---

## Output

After execution:
- Verified PHP template works end-to-end
- Validated Bug 1 fix from Phase 2
- Documentation of any issues found
- Ready to proceed to Phase 4 (Flask/Python testing)
