# Phase 5: Private URL System - Execution Plan

## Objective
Allow applications to have private, shareable URLs that are not publicly indexed. Users can generate random slugs or set custom slugs for private access.

## Context

### Current Application Model
From `backend/app/models/application.py`:
```python
class Application(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    app_type = db.Column(db.String(50), nullable=False)
    status = db.Column(db.String(20), default='stopped')
    port = db.Column(db.Integer, nullable=True)
    root_path = db.Column(db.String(500), nullable=True)
    # ... other fields
```

### Nginx Integration
The `NginxService` already handles reverse proxy configuration for Docker apps using the `DOCKER_SITE_TEMPLATE`. Private URLs will need a separate routing mechanism.

### API Pattern
- Routes use Flask Blueprint pattern
- JWT authentication via `@jwt_required()`
- Admin check via `admin_required` decorator or inline check
- Standard JSON responses with `{'error': ...}` or `{'success': ..., 'data': ...}`

---

## Prerequisites

Before implementation:
1. Database migration system in place (Flask-Migrate)
2. Understanding of existing Nginx config generation

---

## Tasks

### Task 1: Database Schema Updates
**Type**: Backend - Database

Add new fields to the Application model:

1. Open `backend/app/models/application.py`
2. Add fields:
   ```python
   # Private URL feature
   private_slug = db.Column(db.String(50), unique=True, nullable=True, index=True)
   private_url_enabled = db.Column(db.Boolean, default=False)
   ```

3. Update `to_dict()` method to include new fields:
   ```python
   'private_slug': self.private_slug,
   'private_url_enabled': self.private_url_enabled,
   ```

4. Create migration:
   ```bash
   flask db migrate -m "Add private URL fields to Application"
   flask db upgrade
   ```

**Expected Result**: Application model has private URL fields

---

### Task 2: Create Private URL Service
**Type**: Backend - Service

Create `backend/app/services/private_url_service.py`:

```python
import secrets
import string
import re
from typing import Optional, Tuple

class PrivateURLService:
    """Service for managing private URLs for applications."""

    # Slug configuration
    SLUG_ALPHABET = string.ascii_lowercase + string.digits
    DEFAULT_SLUG_LENGTH = 12
    MIN_SLUG_LENGTH = 3
    MAX_SLUG_LENGTH = 50

    # Reserved slugs (system paths)
    RESERVED_SLUGS = {'api', 'admin', 'static', 'assets', 'health', 'status'}

    @classmethod
    def generate_slug(cls, length: int = None) -> str:
        """Generate a cryptographically secure random slug."""
        length = length or cls.DEFAULT_SLUG_LENGTH
        return ''.join(secrets.choice(cls.SLUG_ALPHABET) for _ in range(length))

    @classmethod
    def validate_slug(cls, slug: str) -> Tuple[bool, Optional[str]]:
        """Validate a custom slug.

        Returns:
            Tuple of (is_valid, error_message)
        """
        if not slug:
            return False, "Slug cannot be empty"

        if len(slug) < cls.MIN_SLUG_LENGTH:
            return False, f"Slug must be at least {cls.MIN_SLUG_LENGTH} characters"

        if len(slug) > cls.MAX_SLUG_LENGTH:
            return False, f"Slug cannot exceed {cls.MAX_SLUG_LENGTH} characters"

        # Only alphanumeric and hyphens allowed
        if not re.match(r'^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$', slug):
            return False, "Slug must contain only lowercase letters, numbers, and hyphens (cannot start or end with hyphen)"

        # No consecutive hyphens
        if '--' in slug:
            return False, "Slug cannot contain consecutive hyphens"

        # Check reserved
        if slug.lower() in cls.RESERVED_SLUGS:
            return False, f"Slug '{slug}' is reserved"

        return True, None

    @classmethod
    def is_slug_available(cls, slug: str, exclude_app_id: int = None) -> bool:
        """Check if a slug is available (not used by another app)."""
        from app.models import Application

        query = Application.query.filter_by(private_slug=slug)
        if exclude_app_id:
            query = query.filter(Application.id != exclude_app_id)

        return query.first() is None

    @classmethod
    def generate_unique_slug(cls, max_attempts: int = 10) -> Optional[str]:
        """Generate a unique slug that doesn't exist in the database."""
        for _ in range(max_attempts):
            slug = cls.generate_slug()
            if cls.is_slug_available(slug):
                return slug
        return None
```

**Expected Result**: Service class for slug generation and validation

---

### Task 3: Create Private URL API Endpoints
**Type**: Backend - API

Create `backend/app/api/private_urls.py`:

```python
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Application, User
from app.services.private_url_service import PrivateURLService
from app.services.nginx_service import NginxService

private_urls_bp = Blueprint('private_urls', __name__)


@private_urls_bp.route('/<int:app_id>/private-url', methods=['POST'])
@jwt_required()
def enable_private_url(app_id):
    """Enable private URL for an application and generate/set slug."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json() or {}
    custom_slug = data.get('slug')

    if custom_slug:
        # Validate custom slug
        is_valid, error = PrivateURLService.validate_slug(custom_slug)
        if not is_valid:
            return jsonify({'error': error}), 400

        if not PrivateURLService.is_slug_available(custom_slug, exclude_app_id=app_id):
            return jsonify({'error': 'Slug is already in use'}), 409

        slug = custom_slug
    else:
        # Generate unique slug
        slug = PrivateURLService.generate_unique_slug()
        if not slug:
            return jsonify({'error': 'Could not generate unique slug'}), 500

    app.private_slug = slug
    app.private_url_enabled = True
    db.session.commit()

    # Update Nginx config if app has port
    nginx_result = None
    if app.port:
        nginx_result = NginxService.update_private_url_config(app)

    return jsonify({
        'message': 'Private URL enabled',
        'private_slug': slug,
        'private_url': f'/p/{slug}',
        'nginx_updated': nginx_result.get('success') if nginx_result else None
    }), 200


@private_urls_bp.route('/<int:app_id>/private-url', methods=['PUT'])
@jwt_required()
def update_private_url(app_id):
    """Update the private URL slug for an application."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    if not app.private_url_enabled:
        return jsonify({'error': 'Private URL is not enabled for this app'}), 400

    data = request.get_json()
    if not data or 'slug' not in data:
        return jsonify({'error': 'Slug is required'}), 400

    new_slug = data['slug']

    # Validate
    is_valid, error = PrivateURLService.validate_slug(new_slug)
    if not is_valid:
        return jsonify({'error': error}), 400

    if not PrivateURLService.is_slug_available(new_slug, exclude_app_id=app_id):
        return jsonify({'error': 'Slug is already in use'}), 409

    old_slug = app.private_slug
    app.private_slug = new_slug
    db.session.commit()

    # Update Nginx config
    nginx_result = None
    if app.port:
        nginx_result = NginxService.update_private_url_config(app, old_slug=old_slug)

    return jsonify({
        'message': 'Private URL updated',
        'private_slug': new_slug,
        'private_url': f'/p/{new_slug}',
        'nginx_updated': nginx_result.get('success') if nginx_result else None
    }), 200


@private_urls_bp.route('/<int:app_id>/private-url', methods=['DELETE'])
@jwt_required()
def disable_private_url(app_id):
    """Disable private URL for an application."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    old_slug = app.private_slug
    app.private_slug = None
    app.private_url_enabled = False
    db.session.commit()

    # Remove Nginx config for private URL
    nginx_result = None
    if old_slug:
        nginx_result = NginxService.remove_private_url_config(old_slug)

    return jsonify({
        'message': 'Private URL disabled',
        'nginx_updated': nginx_result.get('success') if nginx_result else None
    }), 200


@private_urls_bp.route('/<int:app_id>/private-url/regenerate', methods=['POST'])
@jwt_required()
def regenerate_private_url(app_id):
    """Generate a new random slug for an application."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    app = Application.query.get(app_id)

    if not app:
        return jsonify({'error': 'Application not found'}), 404

    if user.role != 'admin' and app.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    if not app.private_url_enabled:
        return jsonify({'error': 'Private URL is not enabled for this app'}), 400

    old_slug = app.private_slug
    new_slug = PrivateURLService.generate_unique_slug()

    if not new_slug:
        return jsonify({'error': 'Could not generate unique slug'}), 500

    app.private_slug = new_slug
    db.session.commit()

    # Update Nginx config
    nginx_result = None
    if app.port:
        nginx_result = NginxService.update_private_url_config(app, old_slug=old_slug)

    return jsonify({
        'message': 'Private URL regenerated',
        'private_slug': new_slug,
        'private_url': f'/p/{new_slug}',
        'nginx_updated': nginx_result.get('success') if nginx_result else None
    }), 200
```

**Expected Result**: API endpoints for managing private URLs

---

### Task 4: Create Public Resolver Endpoint
**Type**: Backend - API

Add a public endpoint to resolve private URLs. This does NOT require authentication.

Add to `backend/app/api/private_urls.py`:

```python
@private_urls_bp.route('/p/<slug>', methods=['GET'])
def resolve_private_url(slug):
    """Resolve a private URL slug to app info (public endpoint).

    This endpoint is for API consumers that need to look up which app
    a private URL points to. The actual proxying is handled by Nginx.
    """
    app = Application.query.filter_by(
        private_slug=slug,
        private_url_enabled=True
    ).first()

    if not app:
        return jsonify({'error': 'Not found'}), 404

    return jsonify({
        'app_id': app.id,
        'app_name': app.name,
        'port': app.port,
        'status': app.status
    }), 200
```

**Expected Result**: Public endpoint for slug resolution

---

### Task 5: Nginx Integration for Private URLs
**Type**: Backend - Service

Update `backend/app/services/nginx_service.py` to handle private URL routing.

1. Add new template for private URL routing:

```python
PRIVATE_URL_LOCATION_TEMPLATE = '''
    # Private URL: /p/{slug}
    location /p/{slug}/ {{
        proxy_pass http://127.0.0.1:{port}/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Private-URL {slug};
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 86400;
    }}
'''

PRIVATE_URL_MAIN_CONFIG = '''# ServerKit Private URL Routes
# This file is auto-generated. Do not edit manually.

server {{
    listen 80;
    listen [::]:80;
    server_name _;

    # Private URL routes
{locations}

    # Fallback for unknown slugs
    location /p/ {{
        return 404;
    }}
}}
'''
```

2. Add methods:

```python
@classmethod
def update_private_url_config(cls, app, old_slug: str = None) -> Dict:
    """Update Nginx config for a private URL."""
    # Implementation to regenerate private-urls config file
    pass

@classmethod
def remove_private_url_config(cls, slug: str) -> Dict:
    """Remove a private URL from Nginx config."""
    pass

@classmethod
def regenerate_all_private_urls(cls) -> Dict:
    """Regenerate the entire private URLs config from database."""
    from app.models import Application

    apps = Application.query.filter(
        Application.private_url_enabled == True,
        Application.private_slug.isnot(None),
        Application.port.isnot(None)
    ).all()

    locations = []
    for app in apps:
        location = cls.PRIVATE_URL_LOCATION_TEMPLATE.format(
            slug=app.private_slug,
            port=app.port
        )
        locations.append(location)

    config = cls.PRIVATE_URL_MAIN_CONFIG.format(
        locations='\n'.join(locations)
    )

    # Write to /etc/nginx/sites-available/serverkit-private-urls
    # Enable and reload
    pass
```

**Expected Result**: Nginx generates configs for `/p/{slug}` routes

---

### Task 6: Register API Blueprint
**Type**: Backend - Configuration

1. Update `backend/app/api/__init__.py` to import and register the new blueprint:

```python
from app.api.private_urls import private_urls_bp

def register_blueprints(app):
    # ... existing blueprints ...
    app.register_blueprint(private_urls_bp, url_prefix='/api/v1/apps')
```

Note: The `/p/<slug>` public endpoint will be at `/api/v1/apps/p/<slug>` OR we can register it separately at the root.

Alternative: Register public resolver at root level:
```python
# In app/__init__.py or main blueprint
@app.route('/p/<slug>')
def private_url_redirect(slug):
    # This is handled by Nginx in production, but for dev/testing
    pass
```

**Expected Result**: API routes accessible

---

### Task 7: Frontend - Private URL Section Component
**Type**: Frontend

Create `frontend/src/components/PrivateURLSection.jsx`:

```jsx
import React, { useState } from 'react';
import { Card, Button, Input, Switch, message, Tooltip, Space, Alert } from 'antd';
import { CopyOutlined, ReloadOutlined, LinkOutlined } from '@ant-design/icons';
import api from '../api';

const PrivateURLSection = ({ app, onUpdate }) => {
  const [loading, setLoading] = useState(false);
  const [customSlug, setCustomSlug] = useState('');
  const [editMode, setEditMode] = useState(false);

  const baseUrl = window.location.origin;
  const privateUrl = app.private_slug ? `${baseUrl}/p/${app.private_slug}` : null;

  const handleEnable = async () => {
    setLoading(true);
    try {
      const response = await api.post(`/apps/${app.id}/private-url`, {
        slug: customSlug || undefined
      });
      message.success('Private URL enabled');
      onUpdate();
      setCustomSlug('');
    } catch (error) {
      message.error(error.response?.data?.error || 'Failed to enable private URL');
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    setLoading(true);
    try {
      await api.delete(`/apps/${app.id}/private-url`);
      message.success('Private URL disabled');
      onUpdate();
    } catch (error) {
      message.error(error.response?.data?.error || 'Failed to disable private URL');
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    setLoading(true);
    try {
      await api.post(`/apps/${app.id}/private-url/regenerate`);
      message.success('Private URL regenerated');
      onUpdate();
    } catch (error) {
      message.error(error.response?.data?.error || 'Failed to regenerate');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSlug = async () => {
    if (!customSlug) return;
    setLoading(true);
    try {
      await api.put(`/apps/${app.id}/private-url`, { slug: customSlug });
      message.success('Slug updated');
      onUpdate();
      setEditMode(false);
      setCustomSlug('');
    } catch (error) {
      message.error(error.response?.data?.error || 'Failed to update slug');
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(privateUrl);
    message.success('URL copied to clipboard');
  };

  return (
    <Card title="Private URL" size="small">
      {!app.private_url_enabled ? (
        <div>
          <p>Enable a private, shareable URL for this application.</p>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Input
              placeholder="Custom slug (optional)"
              value={customSlug}
              onChange={(e) => setCustomSlug(e.target.value.toLowerCase())}
              addonBefore="/p/"
            />
            <Button
              type="primary"
              onClick={handleEnable}
              loading={loading}
              icon={<LinkOutlined />}
            >
              Enable Private URL
            </Button>
          </Space>
        </div>
      ) : (
        <div>
          <Alert
            message="Private URL Active"
            description={
              <div>
                <code>{privateUrl}</code>
                <Space style={{ marginTop: 8 }}>
                  <Tooltip title="Copy URL">
                    <Button icon={<CopyOutlined />} size="small" onClick={copyToClipboard} />
                  </Tooltip>
                  <Tooltip title="Regenerate">
                    <Button icon={<ReloadOutlined />} size="small" onClick={handleRegenerate} loading={loading} />
                  </Tooltip>
                </Space>
              </div>
            }
            type="success"
            showIcon
          />

          {editMode ? (
            <Space style={{ marginTop: 16 }}>
              <Input
                placeholder="New slug"
                value={customSlug}
                onChange={(e) => setCustomSlug(e.target.value.toLowerCase())}
                addonBefore="/p/"
              />
              <Button type="primary" size="small" onClick={handleUpdateSlug} loading={loading}>
                Save
              </Button>
              <Button size="small" onClick={() => setEditMode(false)}>
                Cancel
              </Button>
            </Space>
          ) : (
            <Button
              type="link"
              size="small"
              onClick={() => setEditMode(true)}
              style={{ marginTop: 8, padding: 0 }}
            >
              Change slug
            </Button>
          )}

          <div style={{ marginTop: 16 }}>
            <Button danger onClick={handleDisable} loading={loading}>
              Disable Private URL
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};

export default PrivateURLSection;
```

**Expected Result**: Reusable component for private URL management

---

### Task 8: Integrate into Application Detail Page
**Type**: Frontend

Update `frontend/src/pages/ApplicationDetail.jsx`:

1. Import the component:
```jsx
import PrivateURLSection from '../components/PrivateURLSection';
```

2. Add to the page layout (in the details/settings section):
```jsx
{app.app_type === 'docker' && app.port && (
  <PrivateURLSection app={app} onUpdate={fetchApp} />
)}
```

**Expected Result**: Private URL section visible on Docker app detail pages

---

### Task 9: Update Applications List
**Type**: Frontend

Update `frontend/src/pages/ApplicationsList.jsx` (or equivalent):

1. Add private URL indicator to app cards/rows:
```jsx
{app.private_url_enabled && (
  <Tooltip title={`Private URL: /p/${app.private_slug}`}>
    <LinkOutlined style={{ color: '#52c41a' }} />
  </Tooltip>
)}
```

2. Add quick copy action for private URL in actions menu

**Expected Result**: Visual indicator for apps with private URLs

---

### Task 10: Test End-to-End
**Type**: Testing

1. **Database migration test**:
   - Run migration
   - Verify fields exist in database

2. **API tests**:
   - Enable private URL (auto-generated slug)
   - Enable private URL (custom slug)
   - Update slug
   - Regenerate slug
   - Disable private URL
   - Test validation (invalid slugs, duplicates)

3. **Nginx tests**:
   - Verify config file generated
   - Test `/p/{slug}` routes to correct port
   - Test Nginx reload works

4. **Frontend tests**:
   - Enable/disable toggle works
   - Copy button works
   - Slug editing works
   - Error messages display correctly

**Expected Result**: All features working end-to-end

---

## Verification Checklist

After completing all tasks:

- [ ] Database migration applied successfully
- [ ] `private_slug` and `private_url_enabled` fields exist
- [ ] API endpoints respond correctly
- [ ] Slug validation works (length, format, uniqueness)
- [ ] Nginx config generates for private URLs
- [ ] `/p/{slug}` routes to correct app port
- [ ] Frontend component renders correctly
- [ ] Copy to clipboard works
- [ ] Regenerate creates new slug
- [ ] Custom slug can be set
- [ ] Disable removes slug and config
- [ ] Application list shows indicator

---

## Success Criteria

- [ ] Private URLs can be generated for any Docker app
- [ ] Custom slugs work with validation
- [ ] Private URL routes to correct container via Nginx
- [ ] UI allows easy management and copying

---

## Implementation Notes

### Nginx Architecture Decision

Two approaches for `/p/{slug}` routing:

**Option A: Single config file with all routes (Recommended)**
- One file: `/etc/nginx/sites-available/serverkit-private-urls`
- Regenerate entire file when any private URL changes
- Pros: Simple, single point of configuration
- Cons: Full regeneration on any change

**Option B: Separate config per app**
- Individual files per slug
- Pros: Granular updates
- Cons: More complex management

**Recommendation**: Option A for simplicity. Private URL changes are infrequent.

### Port Requirement

Private URLs only work for apps with a configured `port` field. This is enforced in:
1. API (returns error if no port)
2. Frontend (only shows section if port exists)

### Security Considerations

- Slugs are public but unguessable (12 chars = 36^12 combinations)
- No authentication on `/p/{slug}` access (by design - shareable)
- Users can regenerate slugs if compromised

---

## Output

After execution:
- Database schema updated with private URL fields
- New service for slug generation
- API endpoints for private URL management
- Nginx integration for `/p/{slug}` routing
- Frontend UI for managing private URLs
- Ready for Phase 6 (Dashboard Historical Metrics)
