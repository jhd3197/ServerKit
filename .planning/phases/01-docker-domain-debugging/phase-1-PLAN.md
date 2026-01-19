# Phase 1: Docker & Domain Debugging - Execution Plan

## Objective
Fix the critical issue where Docker apps are not accessible via connected domains. Traffic should flow: **Browser → Domain → Nginx → localhost:{port} → Docker Container**

## Problem Analysis

After reviewing the codebase, I identified the following potential issues:

### Issue 1: Port Mapping in Docker Compose
**Location**: `template_service.py:377-508` (install_template method)

The template service:
1. Generates `docker-compose.yml` from template
2. Stores port in Application model from variables (`PORT`, `HTTP_PORT`, `WEB_PORT`)
3. Runs `docker compose up`

**Problem**: The port stored in the Application model is the **host port** (good), but we need to verify the docker-compose.yml actually maps `host:container` correctly.

### Issue 2: Nginx Config Generation
**Location**: `nginx_service.py:115-138` (DOCKER_SITE_TEMPLATE)

```nginx
location / {
    proxy_pass http://127.0.0.1:{port};
    ...
}
```

**Current flow**:
1. User creates domain via `POST /api/v1/domains`
2. `domains.py:106-124` calls `NginxService.create_site()` for Docker apps
3. Creates config in `/etc/nginx/sites-available/{app_name}`
4. Enables site (symlink to `sites-enabled`)
5. Reloads Nginx

**Potential Issues**:
- Config might fail silently
- Port from Application model might be None or wrong
- Symlink might not be created
- Nginx reload might fail

### Issue 3: Missing Diagnostic Information
There's no way to:
- Check if a port is accessible on localhost
- View the generated Nginx config
- Test the proxy connection
- See container port bindings in the UI

---

## Execution Context

### Files to Modify
```
backend/app/services/nginx_service.py      # Add diagnostic methods
backend/app/services/docker_service.py     # Add port inspection
backend/app/api/domains.py                 # Add debug endpoints
backend/app/api/apps.py                    # Enhance status with port info
frontend/src/pages/ApplicationDetail.jsx   # Add diagnostic UI
```

### Dependencies
- Python: socket, subprocess (already available)
- Frontend: Existing API service

---

## Tasks

### Task 1: Add Port Accessibility Check
**File**: `backend/app/services/docker_service.py`

Add method to check if a port is accessible:

```python
@staticmethod
def check_port_accessible(port: int, host: str = '127.0.0.1') -> Dict:
    """Check if a port is accessible (something is listening)."""
    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex((host, port))
        sock.close()
        return {
            'accessible': result == 0,
            'port': port,
            'host': host
        }
    except Exception as e:
        return {'accessible': False, 'error': str(e)}

@staticmethod
def get_container_port_bindings(container_name: str) -> Dict:
    """Get port bindings for a container."""
    try:
        result = subprocess.run(
            ['docker', 'inspect', '--format', '{{json .NetworkSettings.Ports}}', container_name],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            ports = json.loads(result.stdout.strip())
            return {'success': True, 'ports': ports}
        return {'success': False, 'error': result.stderr}
    except Exception as e:
        return {'success': False, 'error': str(e)}
```

**Verification**: Unit test with a known running container

---

### Task 2: Add Nginx Config Diagnostics
**File**: `backend/app/services/nginx_service.py`

Add methods to diagnose Nginx configuration:

```python
@classmethod
def get_site_config(cls, name: str) -> Dict:
    """Get the content of a site configuration file."""
    config_path = os.path.join(cls.SITES_AVAILABLE, name)
    if not os.path.exists(config_path):
        return {'exists': False, 'error': 'Config file not found'}

    try:
        with open(config_path, 'r') as f:
            content = f.read()

        enabled_path = os.path.join(cls.SITES_ENABLED, name)
        is_enabled = os.path.exists(enabled_path) or os.path.islink(enabled_path)

        return {
            'exists': True,
            'enabled': is_enabled,
            'content': content,
            'path': config_path
        }
    except Exception as e:
        return {'exists': True, 'error': str(e)}

@classmethod
def diagnose_site(cls, name: str, port: int = None) -> Dict:
    """Full diagnostic for a site configuration."""
    diagnosis = {
        'config': cls.get_site_config(name),
        'nginx_running': cls.get_status().get('running', False),
        'config_valid': cls.test_config()
    }

    if port:
        from app.services.docker_service import DockerService
        diagnosis['port_accessible'] = DockerService.check_port_accessible(port)

    return diagnosis
```

**Verification**: Test with an existing app

---

### Task 3: Add Debug API Endpoints
**File**: `backend/app/api/domains.py`

Add diagnostic endpoints:

```python
@domains_bp.route('/debug/diagnose/<int:app_id>', methods=['GET'])
@jwt_required()
@admin_required
def diagnose_app_routing(app_id):
    """Diagnose routing issues for an application."""
    app = Application.query.get(app_id)
    if not app:
        return jsonify({'error': 'Application not found'}), 404

    diagnosis = {
        'app': {
            'id': app.id,
            'name': app.name,
            'type': app.app_type,
            'port': app.port,
            'root_path': app.root_path,
            'status': app.status
        },
        'domains': [],
        'nginx': None,
        'docker': None
    }

    # Get domains
    domains = Domain.query.filter_by(application_id=app_id).all()
    diagnosis['domains'] = [d.to_dict() for d in domains]

    # Nginx diagnosis
    diagnosis['nginx'] = NginxService.diagnose_site(app.name, app.port)

    # Docker diagnosis (if docker app)
    if app.app_type == 'docker':
        from app.services.docker_service import DockerService

        # Check port accessibility
        if app.port:
            diagnosis['docker'] = {
                'port_check': DockerService.check_port_accessible(app.port),
            }

        # Get container info
        if app.root_path:
            containers = DockerService.compose_ps(app.root_path)
            diagnosis['docker']['containers'] = containers

            # Get port bindings for each container
            for container in containers:
                if container.get('Name'):
                    bindings = DockerService.get_container_port_bindings(container['Name'])
                    container['port_bindings'] = bindings

    return jsonify(diagnosis), 200
```

**Verification**: Call endpoint and verify all data is returned

---

### Task 4: Fix Domain Creation to Validate Port
**File**: `backend/app/api/domains.py`

Enhance domain creation to validate the port is accessible before creating Nginx config:

```python
# In create_domain(), after getting the app:
if app.app_type == 'docker':
    if not app.port:
        return jsonify({
            'error': 'Docker app must have a port configured before adding domains',
            'hint': 'Update the application with a valid port number'
        }), 400

    # Check if port is accessible
    from app.services.docker_service import DockerService
    port_check = DockerService.check_port_accessible(app.port)

    # Add warning if port not accessible (but still allow creation)
    port_warning = None
    if not port_check.get('accessible'):
        port_warning = f"Warning: Port {app.port} is not currently accessible. Make sure the container is running."
```

Then include `port_warning` in the response.

**Verification**: Create domain for stopped app, verify warning appears

---

### Task 5: Add Container Port Discovery
**File**: `backend/app/services/template_service.py`

After starting containers, verify the actual port mapping:

```python
# In install_template(), after compose_up succeeds (around line 458):

# Verify container is actually running and port is mapped
import time
time.sleep(2)  # Give container time to start

if app_port:
    from app.services.docker_service import DockerService
    port_check = DockerService.check_port_accessible(app_port)
    if not port_check.get('accessible'):
        # Log warning but don't fail - container might need more startup time
        print(f"Warning: Port {app_port} not accessible immediately after start")
```

**Verification**: Install a template and check logs

---

### Task 6: Enhance App Status API with Port Info
**File**: `backend/app/api/apps.py`

Modify `get_app_status` to include port accessibility:

```python
# In get_app_status(), add after getting containers:

# Add port check
port_status = None
if app.port:
    port_status = DockerService.check_port_accessible(app.port)

return jsonify({
    'status': actual_status,
    'containers': containers,
    'running': running_count,
    'total': total_count,
    'port': app.port,
    'port_accessible': port_status.get('accessible') if port_status else None
}), 200
```

**Verification**: Call `/api/v1/apps/{id}/status` and verify port_accessible field

---

### Task 7: Add Frontend Diagnostic Display
**File**: `frontend/src/pages/ApplicationDetail.jsx`

Add a diagnostic section that shows:
- Port configuration and accessibility
- Nginx config status (exists, enabled)
- Container port bindings
- "Test Connection" button

```jsx
// Add new component or section:
<div className="diagnostic-section">
  <h3>Routing Diagnostics</h3>

  <div className="diagnostic-item">
    <label>Port:</label>
    <span>{app.port || 'Not configured'}</span>
    {portAccessible !== null && (
      <span className={portAccessible ? 'status-ok' : 'status-error'}>
        {portAccessible ? '✓ Accessible' : '✗ Not accessible'}
      </span>
    )}
  </div>

  <div className="diagnostic-item">
    <label>Nginx Config:</label>
    <span className={nginxStatus?.exists ? 'status-ok' : 'status-error'}>
      {nginxStatus?.exists ? 'Created' : 'Missing'}
    </span>
    {nginxStatus?.enabled && <span className="badge">Enabled</span>}
  </div>

  <button onClick={runDiagnostics}>Run Full Diagnostics</button>
</div>
```

**Verification**: View app detail page and verify diagnostics display

---

### Task 8: Create Test Script
**File**: `scripts/test-routing.sh` (new file)

Create a script to test the full routing chain:

```bash
#!/bin/bash
# Test Docker app routing

APP_NAME=$1
PORT=$2
DOMAIN=$3

echo "=== Testing routing for $APP_NAME ==="

echo "1. Checking if port $PORT is accessible on localhost..."
nc -z 127.0.0.1 $PORT && echo "   ✓ Port accessible" || echo "   ✗ Port NOT accessible"

echo "2. Checking Nginx config..."
[ -f /etc/nginx/sites-available/$APP_NAME ] && echo "   ✓ Config exists" || echo "   ✗ Config missing"
[ -L /etc/nginx/sites-enabled/$APP_NAME ] && echo "   ✓ Config enabled" || echo "   ✗ Config NOT enabled"

echo "3. Testing Nginx config syntax..."
sudo nginx -t 2>&1 | grep -q "successful" && echo "   ✓ Config valid" || echo "   ✗ Config INVALID"

echo "4. Testing HTTP request to localhost:$PORT..."
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT/ | grep -q "200\|301\|302" && echo "   ✓ Container responds" || echo "   ✗ Container NOT responding"

if [ -n "$DOMAIN" ]; then
    echo "5. Testing HTTP request via domain $DOMAIN..."
    curl -s -o /dev/null -w "%{http_code}" -H "Host: $DOMAIN" http://127.0.0.1/ | grep -q "200\|301\|302" && echo "   ✓ Domain routing works" || echo "   ✗ Domain routing FAILED"
fi

echo "=== Done ==="
```

**Verification**: Run script with a test app

---

## Verification

### Integration Test Checklist
After all tasks complete:

1. [ ] Deploy a Docker template (e.g., nginx, whoami)
2. [ ] Verify Application record has correct port
3. [ ] Check port is accessible: `curl http://127.0.0.1:{port}`
4. [ ] Add domain to the application
5. [ ] Verify Nginx config created in `/etc/nginx/sites-available/`
6. [ ] Verify symlink in `/etc/nginx/sites-enabled/`
7. [ ] Test domain access: `curl -H "Host: yourdomain.com" http://127.0.0.1/`
8. [ ] Check diagnostic endpoint returns all data
9. [ ] Verify frontend shows diagnostic info

### Expected Results
- Port accessibility shows green checkmark when container is running
- Nginx config status shows "Created" and "Enabled"
- Domain resolves to the correct container
- Diagnostic endpoint provides actionable information

---

## Success Criteria
- [ ] Docker containers expose ports to localhost correctly
- [ ] Nginx configs are created and enabled automatically
- [ ] Domains route traffic to Docker containers
- [ ] Diagnostic info visible in UI
- [ ] Debug endpoint provides full routing diagnosis
- [ ] Clear error messages when something is misconfigured

---

## Rollback Plan
All changes are additive (new methods, new endpoints). No breaking changes to existing functionality. If issues arise:
1. Revert the specific file changes
2. Existing functionality remains unchanged

---

## Output
After execution:
- New diagnostic methods in DockerService and NginxService
- New `/api/v1/domains/debug/diagnose/{app_id}` endpoint
- Enhanced app status with port information
- Frontend diagnostic section in ApplicationDetail
- Test script for manual verification
