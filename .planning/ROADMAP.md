# ServerKit Enhancement Roadmap

> **Milestone 1**: Infrastructure Fixes, Private URLs & UI Polish
> **Started**: 2026-01-19
> **Status**: In Progress

---

## Phase Overview

| Phase | Name | Status | Goal |
|-------|------|--------|------|
| 1 | Docker & Domain Debugging | **completed** | Fix port mapping and domain routing for Docker apps |
| 2 | WordPress Template Testing | **completed** | Deploy and verify WordPress works end-to-end |
| 3 | PHP App Template Testing | **completed** | Deploy and verify PHP/Laravel apps work correctly |
| 4 | Flask/Python Template Testing | skipped | Deploy and verify Python apps route correctly |
| 5 | Private URL System | **completed** | Add private URL generation and custom slugs |
| 6 | Dashboard Historical Metrics | **completed** | Add CPU/Memory/Disk graphs over time |
| 7 | Templates Page Polish | pending | Fix icons, update URLs, improve filtering |
| 8 | Applications UI Polish | pending | Improve app list and management pages |
| 9 | FileManager Disk Usage UI | pending | Better visualization for disk usage |
| 10 | Integration Testing | pending | End-to-end testing of all features |

---

## Phase 1: Docker & Domain Debugging
**Goal**: Fix the critical issue where Docker apps are not accessible via connected domains

### Context
- Nginx proxies to `http://127.0.0.1:{port}` expecting Docker container exposed on localhost
- 404 errors with retries indicate proxy can't reach container
- No request logs in Docker app means traffic isn't reaching container

### Tasks
1. **Audit Docker port exposure logic**
   - Review `docker_service.py` container creation
   - Check if `-p {host_port}:{container_port}` is correctly applied
   - Verify port binding to `0.0.0.0` vs `127.0.0.1`

2. **Audit Nginx configuration generation**
   - Review `nginx_service.py` DOCKER_SITE_TEMPLATE
   - Verify site is created in `sites-available`
   - Verify symlink exists in `sites-enabled`
   - Check Nginx reload after config changes

3. **Add debugging endpoints**
   - Create `/api/v1/debug/port-check/{port}` to verify port accessibility
   - Create `/api/v1/debug/nginx-config/{app_name}` to view generated config
   - Add container port inspection to Docker API responses

4. **Fix identified issues**
   - Ensure containers expose ports to host correctly
   - Ensure Nginx configs are properly enabled
   - Add validation before domain creation

5. **Add diagnostic UI**
   - Show port binding status in Application detail
   - Show Nginx config status (exists, enabled, valid)
   - Add "Test Connection" button for domains

### Success Criteria
- [x] Docker containers expose ports to localhost correctly
- [x] Nginx configs are created and enabled automatically
- [x] Domains route traffic to Docker containers
- [x] Diagnostic info visible in UI

### Completed
Phase 1 added diagnostic tools to identify and debug routing issues. See `.planning/phases/01-docker-domain-debugging/SUMMARY.md` for details.

---

## Phase 2: WordPress Template Testing
**Goal**: Verify WordPress template deploys and works with domain routing

### Tasks
1. **Deploy WordPress template**
   - Use existing WordPress template from marketplace
   - Configure with test domain
   - Document any errors encountered

2. **Verify database connectivity**
   - Ensure MySQL container is accessible
   - Verify WordPress can connect to database
   - Check environment variables passed correctly

3. **Test domain access**
   - Verify Nginx config generated correctly
   - Test HTTP access via domain
   - Verify WordPress installation wizard loads

4. **Document issues and fixes**
   - Log all errors encountered
   - Apply fixes from Phase 1 if needed
   - Update template if issues are template-specific

### Success Criteria
- [x] WordPress container starts successfully
- [x] Database connection works
- [x] Domain routes to WordPress
- [x] Installation wizard accessible

### Completed
Phase 2 testing passed. Found and fixed 2 bugs:
- NDJSON parsing in compose_ps (critical)
- CLI .env loading

See `.planning/phases/02-wordpress-testing/SUMMARY.md` for details.

---

## Phase 3: PHP App Template Testing
**Goal**: Verify PHP/Laravel apps deploy and route correctly

### Tasks
1. **Test PHP-FPM template deployment**
   - Deploy a basic PHP app
   - Verify PHP-FPM socket connection
   - Test Nginx fastcgi_pass configuration

2. **Test Laravel template if available**
   - Deploy Laravel template
   - Verify artisan commands work
   - Test database migrations

3. **Verify static asset serving**
   - Check CSS/JS files load correctly
   - Verify public directory routing

4. **Document PHP-specific issues**
   - PHP version compatibility
   - Extension requirements
   - Permission issues

### Success Criteria
- [ ] PHP apps execute correctly via Nginx
- [ ] Static assets served properly
- [ ] Laravel-specific features work (if applicable)

---

## Phase 4: Flask/Python Template Testing
**Goal**: Verify Python apps deploy and route correctly

### Tasks
1. **Test Flask template deployment**
   - Deploy Flask template
   - Verify Gunicorn starts correctly
   - Check port binding

2. **Test reverse proxy to Gunicorn**
   - Verify Nginx proxy_pass works
   - Test WebSocket upgrades if applicable
   - Check static file serving via Nginx

3. **Test Django template if available**
   - Deploy Django template
   - Verify collectstatic works
   - Test admin interface access

4. **Document Python-specific issues**
   - Virtual environment setup
   - Dependency installation
   - WSGI/ASGI configuration

### Success Criteria
- [ ] Python apps run via Gunicorn/uWSGI
- [ ] Nginx proxies requests correctly
- [ ] Static files served properly

---

## Phase 5: Private URL System
**Goal**: Allow apps to have private, non-indexed URLs for sharing

### Backend Tasks
1. **Database schema updates**
   - Add `private_slug` field to Application model (unique, nullable)
   - Add `is_private` boolean field
   - Add `private_url_enabled` boolean field
   - Create migration

2. **Private URL generation service**
   - Create `PrivateURLService` in `backend/app/services/`
   - Generate cryptographically secure slugs (e.g., `nanoid` style)
   - Allow custom slug validation (alphanumeric, hyphens, 3-50 chars)
   - Prevent slug collisions

3. **API endpoints**
   - `POST /api/v1/apps/{id}/private-url` - Enable/generate private URL
   - `PUT /api/v1/apps/{id}/private-url` - Update custom slug
   - `DELETE /api/v1/apps/{id}/private-url` - Disable private URL
   - `GET /api/v1/p/{slug}` - Resolve private URL to app (public endpoint)

4. **Nginx integration**
   - Generate Nginx config for private URL route
   - Route `/p/{slug}` to correct container port
   - Handle both private URL and domain access

### Frontend Tasks
5. **Application settings UI**
   - Add "Private URL" section in Application detail
   - Toggle to enable/disable
   - Input for custom slug with validation
   - Copy button for private URL
   - Show generated URL preview

6. **Applications list update**
   - Show private URL indicator icon
   - Quick copy action for private URL

### Success Criteria
- [x] Private URLs can be generated for any app
- [x] Custom slugs work with validation
- [x] Private URL routes to correct container
- [x] UI allows easy management and copying

### Completed
Phase 5 implemented the complete private URL system. See `.planning/phases/05-private-urls/SUMMARY.md` for details.

---

## Phase 6: Dashboard Historical Metrics
**Goal**: Add time-series graphs for CPU, Memory, and Disk usage

### Backend Tasks
1. **Metrics storage system**
   - Create `MetricsHistory` model or use time-series file storage
   - Store metrics every 60 seconds (configurable)
   - Retain 24 hours of minute-level data
   - Retain 7 days of hourly aggregates
   - Retain 30 days of daily aggregates

2. **Metrics collection service**
   - Create background task to collect and store metrics
   - Use existing `psutil` calls from monitoring service
   - Add data aggregation for older data points

3. **Historical metrics API**
   - `GET /api/v1/metrics/history?period=1h|6h|24h|7d|30d`
   - Return time-series data for CPU, Memory, Disk
   - Include min, max, avg for each time bucket

### Frontend Tasks
4. **Dashboard graph components**
   - Create `MetricsGraph` component using Recharts
   - Support multiple metrics on one graph
   - Add time period selector (1h, 6h, 24h, 7d, 30d)
   - Show current value + trend indicator

5. **CPU usage graph**
   - Line chart showing CPU % over time
   - Color coding for high usage periods
   - Hover tooltip with exact values

6. **Memory usage graph**
   - Area chart showing used/total memory
   - Show both percentage and absolute values
   - Include swap usage if available

7. **Disk usage graph**
   - Area chart showing used/total disk
   - Per-mount breakdown if multiple disks
   - Growth rate indicator

8. **Dashboard layout update**
   - Reorganize dashboard to fit graphs
   - Keep real-time stats in header cards
   - Add graphs below current stats section

### Success Criteria
- [ ] Metrics stored persistently
- [ ] Historical data queryable by time period
- [ ] Graphs display correctly with interactions
- [ ] Dashboard remains performant

### Research Needed
- [ ] Best storage approach (SQLite, InfluxDB, JSON files)
- [ ] Recharts performance with large datasets

---

## Phase 7: Templates Page Polish
**Goal**: Fix broken icons, update URLs, improve filtering

### Tasks
1. **Audit current icon system**
   - Identify broken icon URLs
   - Check icon loading in browser dev tools
   - Document which icons are missing

2. **Fix icon URLs**
   - Update template `index.json` with correct icon URLs
   - Use reliable CDN or local icons
   - Add fallback icon for missing images

3. **Improve category filtering**
   - Add clear filter chips showing active filters
   - Add "Clear all filters" button
   - Remember filter state in URL params
   - Add search by template name

4. **Update template cards**
   - Show version number
   - Show last updated date
   - Add "Popular" or "Featured" badges
   - Improve install button visibility

5. **Add template details modal**
   - Show full description
   - List required variables
   - Show Docker Compose preview
   - Display system requirements

### Success Criteria
- [ ] All icons load correctly
- [ ] Filtering is intuitive and persistent
- [ ] Template cards show useful info
- [ ] Details modal provides complete info

---

## Phase 8: Applications UI Polish
**Goal**: Improve the applications list and management pages

### Tasks
1. **Applications list improvements**
   - Add status indicators (running, stopped, error)
   - Show port and domain info inline
   - Add quick actions (start, stop, restart)
   - Improve grid/list view toggle
   - Add sorting options (name, status, created, updated)

2. **Application detail page**
   - Reorganize into clear sections/tabs
   - Add real-time logs preview
   - Show resource usage (CPU, Memory per container)
   - Improve environment variables UI
   - Add deployment history section

3. **Manage app page improvements**
   - Clearer action buttons with icons
   - Confirmation dialogs for destructive actions
   - Status messages for async operations
   - Better error display

4. **Add bulk actions**
   - Select multiple apps
   - Bulk start/stop/restart
   - Bulk delete with confirmation

### Success Criteria
- [ ] App status visible at a glance
- [ ] Quick actions work reliably
- [ ] Detail page is well-organized
- [ ] Bulk actions functional

---

## Phase 9: FileManager Disk Usage UI
**Goal**: Improve disk usage visualization in FileManager

### Tasks
1. **Enhanced disk usage widget**
   - Visual progress bar for each mount point
   - Color coding (green < 70%, yellow < 90%, red >= 90%)
   - Show used/total/free space
   - Percentage and absolute values

2. **Directory size analysis**
   - Add "Analyze" button for current directory
   - Show size of subdirectories
   - Treemap or bar chart visualization
   - Identify largest files/folders

3. **Storage breakdown**
   - Pie chart showing space by file type
   - List largest files in current directory
   - Show hidden files space usage

4. **UI improvements**
   - Move disk usage to collapsible sidebar panel
   - Add refresh button for disk stats
   - Show last updated timestamp
   - Responsive layout for all screen sizes

### Success Criteria
- [ ] Disk usage clearly visible
- [ ] Directory analysis functional
- [ ] Visualization helps identify space usage
- [ ] Responsive on all devices

---

## Phase 10: Integration Testing
**Goal**: End-to-end testing of all new features

### Tasks
1. **Create test plan document**
   - List all features to test
   - Define test scenarios
   - Document expected results

2. **Docker & Domain tests**
   - Deploy each template type
   - Verify domain routing
   - Test SSL certificate provisioning
   - Test multiple domains per app

3. **Private URL tests**
   - Generate private URLs
   - Test custom slugs
   - Verify access control
   - Test with different app types

4. **Dashboard tests**
   - Verify metrics collection
   - Test all time periods
   - Check graph accuracy
   - Test real-time updates

5. **UI tests**
   - Test all template filters
   - Verify icon loading
   - Test app management flows
   - Verify FileManager features

6. **Performance testing**
   - Check dashboard load time
   - Test with many apps
   - Verify WebSocket stability
   - Check memory usage

7. **Document findings**
   - Create bug reports for issues found
   - Document workarounds
   - Update user documentation

### Success Criteria
- [ ] All features pass testing
- [ ] No critical bugs remain
- [ ] Performance is acceptable
- [ ] Documentation updated

---

## Dependencies

```
Phase 1 (Docker/Domain) ─┬─► Phase 2 (WordPress)
                         ├─► Phase 3 (PHP)
                         ├─► Phase 4 (Flask)
                         └─► Phase 5 (Private URLs)

Phase 5 (Private URLs) ──► Phase 8 (Apps UI) ──► Phase 10 (Testing)

Phase 6 (Metrics) ───────► Phase 10 (Testing)

Phase 7 (Templates) ─────► Phase 10 (Testing)

Phase 9 (FileManager) ───► Phase 10 (Testing)
```

---

## Notes

- **Phase 1 is critical** - must be completed before testing any templates
- Phases 2-4 can run in parallel after Phase 1
- Phases 6, 7, 8, 9 are independent and can be worked in any order
- Phase 10 should run last after all features are implemented
- Consider creating feature branches for each phase

---

## Estimated Complexity

| Phase | Complexity | Files Changed |
|-------|------------|---------------|
| 1 | High | 5-8 |
| 2 | Medium | 1-2 (mostly testing) |
| 3 | Medium | 1-2 (mostly testing) |
| 4 | Medium | 1-2 (mostly testing) |
| 5 | High | 8-12 |
| 6 | High | 6-10 |
| 7 | Medium | 3-5 |
| 8 | Medium | 4-6 |
| 9 | Medium | 2-4 |
| 10 | Low | 0 (testing only) |
