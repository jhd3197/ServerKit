# Phase 12: Multi-Environment App Linking — PLAN

## Objective
Add database schema and API support for linking applications as prod/dev pairs that share database resources.

## Execution Context

**Key Files:**
- `backend/app/models/application.py` — Application model (add new fields)
- `backend/app/api/apps.py` — Apps API endpoints (add linking endpoints)
- `backend/app/models/__init__.py` — Model exports
- `backend/app/services/template_service.py` — Template service (credential propagation)
- `frontend/src/services/api.js` — Frontend API methods

**Patterns to Follow:**
- SQLAlchemy model with `db.create_all()` (no Alembic migrations)
- Blueprint pattern for API routes with `@jwt_required()` decorator
- `to_dict()` serialization method on models
- `admin_required` decorator from templates.py for admin-only operations

## Context

**Phase 11 Created:**
- `wordpress-external-db.yaml` template with configurable DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, TABLE_PREFIX
- Database connection validation via `validate_mysql_connection()`

**This Phase Enables:**
- Linking a dev WordPress to a prod WordPress
- Auto-propagating database credentials when linking
- Auto-configuring table prefixes to avoid collision (wp_ for prod, wp_dev_ for dev)

## Tasks

### Task 1: Add Environment Fields to Application Model
**File:** `backend/app/models/application.py`

Add new columns to Application model:
```python
# Environment linking
environment_type = db.Column(db.String(20), default='standalone')  # 'production', 'development', 'staging', 'standalone'
linked_app_id = db.Column(db.Integer, db.ForeignKey('applications.id'), nullable=True)
shared_config = db.Column(db.Text, nullable=True)  # JSON string for shared resources
```

Add self-referential relationship:
```python
linked_app = db.relationship('Application', remote_side=[id], backref='linked_apps')
```

Update `to_dict()` to include new fields.

**Verification:** Check model imports and `db.create_all()` creates the new columns.

---

### Task 2: Create App Linking API Endpoints
**File:** `backend/app/api/apps.py`

Add new endpoints:

1. **POST /apps/{id}/link** — Link two apps as prod/dev pair
   - Request: `{ "target_app_id": int, "as_environment": "development" | "production" | "staging" }`
   - Validates both apps exist and belong to same user (or admin)
   - Validates apps are same type (e.g., both docker/wordpress)
   - Sets environment_type on both apps
   - Links apps bidirectionally
   - Returns updated app info

2. **GET /apps/{id}/linked** — Get linked apps
   - Returns all apps linked to this app
   - Includes environment type and shared config

3. **DELETE /apps/{id}/link** — Unlink apps
   - Removes link from both apps
   - Resets environment_type to 'standalone'

4. **PUT /apps/{id}/environment** — Update environment type only
   - Request: `{ "environment_type": "production" | "development" | "staging" | "standalone" }`
   - For apps not linked, just sets the type

**Verification:** Test endpoints with curl or frontend.

---

### Task 3: Add Database Credential Propagation
**File:** `backend/app/services/template_service.py`

Add method to propagate database credentials when linking:
```python
@classmethod
def propagate_db_credentials(cls, source_app_id: int, target_app_id: int, target_prefix: str = None) -> Dict:
    """Propagate database credentials from source app to target app.

    Reads source app's .env file for DB credentials, updates target app's
    .env with same credentials but different table prefix.
    """
```

Logic:
1. Get source app's root_path
2. Read source app's `.env` or `docker-compose.yml` for DB_HOST, DB_NAME, DB_USER, DB_PASSWORD
3. Get target app's root_path
4. Update target app's env with same credentials but different TABLE_PREFIX
5. Store shared config in shared_config field as JSON

**Verification:** After linking, target app should have source app's DB credentials.

---

### Task 4: Add Frontend API Methods
**File:** `frontend/src/services/api.js`

Add methods:
```javascript
async linkApp(appId, targetAppId, asEnvironment) {
    return this.request(`/apps/${appId}/link`, {
        method: 'POST',
        body: { target_app_id: targetAppId, as_environment: asEnvironment }
    });
}

async getLinkedApps(appId) {
    return this.request(`/apps/${appId}/linked`);
}

async unlinkApp(appId) {
    return this.request(`/apps/${appId}/link`, {
        method: 'DELETE'
    });
}

async updateAppEnvironment(appId, environmentType) {
    return this.request(`/apps/${appId}/environment`, {
        method: 'PUT',
        body: { environment_type: environmentType }
    });
}
```

**Verification:** Methods callable from browser console.

---

### Task 5: Update App List Response to Include Environment Info
**File:** `backend/app/api/apps.py`

Modify `get_apps()` and `get_app()` to include:
- `environment_type` in response
- `linked_apps` summary (id, name, environment_type)
- `has_linked_apps` boolean

**Verification:** GET /apps returns environment info.

---

## Verification

```bash
# Test model changes (will happen on app startup)
cd backend && python -c "from app import db, create_app; app = create_app(); app.app_context().push(); db.create_all()"

# Test API endpoints (after implementation)
# Link apps
curl -X POST http://localhost:5000/api/v1/apps/1/link \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"target_app_id": 2, "as_environment": "development"}'

# Get linked apps
curl http://localhost:5000/api/v1/apps/1/linked \
  -H "Authorization: Bearer <token>"
```

## Success Criteria
- [ ] Application model has environment_type, linked_app_id, shared_config fields
- [ ] Apps can be linked via API
- [ ] Linked apps visible in GET /apps response
- [ ] Database credentials propagate when linking WordPress apps
- [ ] Frontend API methods added

## Output
- Modified: `backend/app/models/application.py`
- Modified: `backend/app/api/apps.py`
- Modified: `backend/app/services/template_service.py`
- Modified: `frontend/src/services/api.js`
