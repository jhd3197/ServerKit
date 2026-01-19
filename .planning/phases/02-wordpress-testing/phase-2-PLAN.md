# Phase 2: WordPress Template Testing - Execution Plan

## Objective
Deploy a WordPress template and verify end-to-end functionality: container startup, database connectivity, Nginx routing, and domain access. Use Phase 1 diagnostic tools to identify and fix any issues.

## Context

### WordPress Template Location
- **Template file**: `backend/templates/wordpress.yaml`
- **Version**: WordPress 6.4 with MySQL 8.0
- **Services**: WordPress (Apache+PHP) + MySQL database
- **Default port**: 8080

### Template Structure
```yaml
compose:
  services:
    wordpress:
      image: wordpress:6.4-apache
      ports: "${HTTP_PORT}:80"
      volumes: wordpress_html:/var/www/html
    db:
      image: mysql:8.0
      volumes: wordpress_db:/var/lib/mysql
```

### Available Diagnostic Tools (from Phase 1)
- `GET /api/v1/domains/debug/diagnose/{app_id}` - Full routing diagnosis
- `GET /api/v1/apps/{id}/status` - Port accessibility check
- UI: Application Detail → Routing Diagnostics card
- CLI: `scripts/test-routing.sh`

---

## Prerequisites

Before testing, ensure:
1. Docker is installed and running
2. ServerKit backend is running
3. User is authenticated with admin role
4. `/var/serverkit/apps/` directory exists with write permissions
5. `/etc/serverkit/` directory exists for template config

---

## Tasks

### Task 1: Verify Template Exists and Is Valid
**Type**: Verification (no code changes expected)

1. Check that `backend/templates/wordpress.yaml` exists
2. Verify template structure matches schema
3. Confirm template is in `backend/templates/index.json`
4. Test template fetch via API: `GET /api/v1/templates/wordpress`

**Expected Result**: Template loads without errors

**If Issues Found**:
- Fix YAML syntax errors
- Add missing required fields
- Update index.json if template missing

---

### Task 2: Install WordPress Template
**Type**: Testing

1. Call template installation API:
   ```
   POST /api/v1/templates/wordpress/install
   {
     "name": "test-wordpress",
     "variables": {
       "HTTP_PORT": "8085"
     }
   }
   ```

2. Monitor installation:
   - Check for errors in response
   - Verify `port_accessible` field in response
   - Note the `app_id` returned

3. Verify files created:
   - `/var/serverkit/apps/test-wordpress/docker-compose.yml`
   - `/var/serverkit/apps/test-wordpress/.env`
   - `/var/serverkit/apps/test-wordpress/.serverkit-template.json`

**Expected Result**: Installation completes, returns app_id, port_accessible = true

**If Issues Found**:
- Check Docker logs: `docker compose logs` in app directory
- Verify MySQL container starts (slow startup)
- Check port conflicts with `_find_available_port()`

---

### Task 3: Verify Container Status
**Type**: Testing

1. Check Docker containers running:
   ```bash
   docker ps --filter "name=test-wordpress"
   ```

2. Verify both services are up:
   - `test-wordpress-wordpress-1` (or similar name)
   - `test-wordpress-db-1`

3. Check container health:
   ```bash
   docker compose -f /var/serverkit/apps/test-wordpress/docker-compose.yml ps
   ```

4. Call app status API:
   ```
   GET /api/v1/apps/{app_id}/status
   ```
   - Expect: `status: running`, `port_accessible: true`

**Expected Result**: Both containers running, port accessible

**If Issues Found**:
- MySQL may need 30-60 seconds to initialize
- Check logs: `docker compose logs db`
- WordPress may fail if DB not ready - check `docker compose logs wordpress`

---

### Task 4: Verify Database Connectivity
**Type**: Testing

1. Check MySQL container accepts connections:
   ```bash
   docker exec test-wordpress-db-1 mysql -u wordpress -p${WP_DB_PASSWORD} -e "SHOW DATABASES;"
   ```

2. Verify WordPress database exists:
   ```bash
   docker exec test-wordpress-db-1 mysql -u wordpress -p${WP_DB_PASSWORD} -e "USE wordpress; SHOW TABLES;"
   ```

3. Check WordPress can connect to DB:
   - Access WordPress container
   - Check wp-config.php has correct credentials
   - Or simply verify WordPress loads (Task 5)

**Expected Result**: Database accessible, credentials work

**If Issues Found**:
- Check environment variables in `.env` file
- Verify MySQL finished initializing
- Check Docker network connectivity between containers

---

### Task 5: Add Domain and Test Nginx Routing
**Type**: Testing + Potential fixes

1. Create domain for the app:
   ```
   POST /api/v1/domains
   {
     "name": "test-wordpress.local",
     "application_id": {app_id},
     "is_primary": true
   }
   ```

2. Check for warnings in response (port not accessible, etc.)

3. Run Phase 1 diagnostics:
   ```
   GET /api/v1/domains/debug/diagnose/{app_id}
   ```

4. Verify Nginx config created:
   - Check `/etc/nginx/sites-available/test-wordpress`
   - Check symlink in `/etc/nginx/sites-enabled/`
   - Verify config has correct port

5. Test direct port access:
   ```bash
   curl -I http://127.0.0.1:8085/
   ```
   - Should return 302 redirect to WordPress setup

6. Test domain routing (add to /etc/hosts first):
   ```bash
   echo "127.0.0.1 test-wordpress.local" | sudo tee -a /etc/hosts
   curl -I http://test-wordpress.local/
   ```

**Expected Result**:
- Nginx config created and enabled
- Direct port access returns HTTP response
- Domain routing works

**If Issues Found**:
- Use Phase 1 diagnostics to identify specific failure
- Check Nginx logs: `/var/log/nginx/test-wordpress.error.log`
- Verify Nginx service is running
- Check port matches between Nginx config and container

---

### Task 6: Access WordPress Installation Wizard
**Type**: Testing

1. Open browser to `http://test-wordpress.local/` or `http://127.0.0.1:8085/`

2. Verify WordPress installation page loads:
   - Should show language selection
   - Then show "Welcome" setup page
   - Should ask for site title, admin user, password

3. Complete WordPress installation:
   - Site Title: "Test WordPress"
   - Username: admin
   - Password: (generate strong password)
   - Email: test@example.com

4. Verify WordPress dashboard loads after installation

**Expected Result**: WordPress fully functional, can create posts

**If Issues Found**:
- Check browser console for errors
- Verify database connectivity (Task 4)
- Check file permissions in WordPress volume

---

### Task 7: Document Results and Issues
**Type**: Documentation

1. Create test results document with:
   - Installation outcome (success/failure)
   - Container status
   - Database connectivity
   - Nginx routing status
   - WordPress accessibility
   - Any errors encountered
   - Fixes applied

2. If issues found, categorize:
   - **Template issues**: Fix in `wordpress.yaml`
   - **Service issues**: Fix in `template_service.py`
   - **Nginx issues**: Fix in `nginx_service.py`
   - **Docker issues**: Document workaround

3. Update template if changes needed

**Expected Result**: Clear documentation of test results

---

## Verification Checklist

After completing all tasks:

- [ ] WordPress template loads from API
- [ ] Template installs without errors
- [ ] Both containers (wordpress, db) running
- [ ] Port is accessible on localhost
- [ ] Domain created without errors
- [ ] Nginx config exists and is enabled
- [ ] Direct port access returns HTTP response
- [ ] Domain routing works via Nginx
- [ ] WordPress installation wizard loads
- [ ] WordPress installation completes
- [ ] WordPress dashboard accessible
- [ ] Can create and view a blog post

---

## Success Criteria

- [ ] WordPress container starts successfully
- [ ] Database connection works
- [ ] Domain routes to WordPress
- [ ] Installation wizard accessible

---

## Cleanup (After Testing)

To remove test installation:
```bash
# Stop and remove containers
docker compose -f /var/serverkit/apps/test-wordpress/docker-compose.yml down -v

# Remove app directory
rm -rf /var/serverkit/apps/test-wordpress

# Remove from database
DELETE FROM applications WHERE name = 'test-wordpress';

# Remove Nginx config
sudo rm /etc/nginx/sites-enabled/test-wordpress
sudo rm /etc/nginx/sites-available/test-wordpress
sudo nginx -s reload

# Remove hosts entry
sudo sed -i '/test-wordpress.local/d' /etc/hosts
```

---

## Output

After execution:
- Verified WordPress template works end-to-end
- Documentation of any issues found
- Fixes applied if needed
- Ready to proceed to Phase 3 (PHP testing)
