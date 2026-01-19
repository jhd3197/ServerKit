# Phase 2: WordPress Template Testing - Summary

## Completion Status
**Completed**: 2026-01-19
**Result**: WordPress deployment works; 2 bugs found and fixed

## Test Results

### What Works Correctly
- Template listing and fetching
- Template installation with docker-compose
- Port allocation and accessibility
- Nginx reverse proxy configuration
- Domain management
- WordPress container runs properly
- Domain routing through Nginx works
- `curl http://test-wordpress.local/` returns WordPress

### Verification Checklist

| Check | Result |
|-------|--------|
| WordPress template loads from API | PASS |
| Template installs without errors | PASS |
| Both containers (wordpress, db) running | PASS |
| Port is accessible on localhost | PASS |
| Domain created without errors | PASS |
| Nginx config exists and is enabled | PASS |
| Direct port access returns HTTP response | PASS |
| Domain routing works via Nginx | PASS |
| WordPress installation wizard loads | PASS |

## Bugs Found and Fixed

### Bug 1: Container Detection Fails (Critical)
**Location**: `docker_service.py:539-551` (`compose_ps` method)

**Root Cause**: `docker compose ps --format json` outputs NDJSON (one JSON object per line), not a JSON array. The code did:
```python
return json.loads(result.stdout)  # Fails on NDJSON
```
This threw `JSONDecodeError`, which was caught and returned `[]`.

**Fix**: Parse each line separately:
```python
containers = []
for line in result.stdout.strip().split('\n'):
    if line.strip():
        containers.append(json.loads(line))
return containers
```

**Commit**: `3f9884c`

### Bug 2: CLI Database Path Issue
**Location**: `cli.py`

**Root Cause**: CLI commands (like `list-users`, `reset-password`) failed with "unable to open database file" because they didn't load the `.env` file from `/opt/serverkit/.env`. The code used the default path `sqlite:////app/instance/serverkit.db` instead of the configured path.

**Fix**: Load `.env` file before `create_app()` is called:
```python
from dotenv import load_dotenv
# Check multiple locations: ./env, ../env, /opt/serverkit/.env
```

**Commit**: `4ba0afe`

### Bug 3: Database Status Not Updated (Consequence of Bug 1)
**Location**: `apps.py:313-325`

**Root Cause**: When `compose_ps` returned empty `[]` (due to Bug 1), the status endpoint saw `total_count == 0` and set `actual_status = 'stopped'`, then updated the database.

**Fix**: Bug 1 fix resolves this. Now `compose_ps` correctly returns container list.

**Note**: The `container_id` field is intentionally not populated for Docker Compose apps because they have multiple containers with auto-generated names.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `3f9884c` | fix | Parse NDJSON output from docker compose ps |
| `4ba0afe` | fix | Load .env file in CLI before app initialization |

## Success Criteria

- [x] WordPress container starts successfully
- [x] Database connection works
- [x] Domain routes to WordPress
- [x] Installation wizard accessible

## Impact of Fixes

The Bug 1 fix is **critical** because it affects:
1. App status endpoint (`/api/v1/apps/{id}/status`)
2. Routing diagnostics (`/api/v1/domains/debug/diagnose/{app_id}`)
3. Any code using `DockerService.compose_ps()`

The Bug 2 fix enables CLI commands to work in production environments.

## Recommendations

1. **Test on server**: Re-run the diagnostics endpoint after deploying these fixes
2. **Verify status**: Check that app status now shows 'running' correctly
3. **CLI test**: Run `python cli.py --debug list-users` to verify .env loading

## Next Steps

With WordPress working:
- **Phase 3**: PHP App Template Testing
- **Phase 4**: Flask/Python Template Testing

Both should benefit from the Bug 1 fix.
