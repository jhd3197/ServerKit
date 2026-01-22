# ServerKit Git Integration Plan

## Overview

This document outlines the plan to add integrated Git functionality to ServerKit:
1. Add new "Git" sidebar page (similar to Firewall)
2. Integrate Gitea as a first-class ServerKit feature
3. Add GitHub/GitLab webhook support for repo sync
4. Resource warnings before installation

---

## Part 1: Architecture Notes

### Current Gitea Template Status: Working

The Gitea template works correctly. Key points:
- **HTTP_PORT** (default 3000) → Auto-assigned and stored in Application.port
- **SSH_PORT** (default 2222) → Auto-assigned and stored in `.serverkit-template.json`
- Both ports are properly mapped in docker-compose.yml
- App needs startup time (~30-60 seconds) for Gitea + PostgreSQL to initialize

**Note:** Containers may take time to fully start. The UI should reflect "Starting..." status during initialization.

### SSH Access for Git Operations

SSH cannot be proxied via nginx (HTTP only). For Git SSH operations:
- Users access SSH directly: `git clone ssh://git@server:2222/user/repo.git`
- The SSH port is available in the app's `.serverkit-template.json` file
- Consider displaying SSH port prominently in the UI

### Potential Future Enhancement: Multi-Port Support

For better UX with multi-port apps like Gitea, consider:
- Adding `ssh_port` column to Application model
- Displaying both HTTP and SSH ports in app details
- This is optional - current system works fine

---

## Part 2: New Git Sidebar Feature

### Design: Git Page (Similar to Firewall Page)

**Location in Sidebar:** Infrastructure section, after Docker

**States:**
1. **Not Installed** → Show installation button with resource warning
2. **Installed but Not Configured** → Show setup wizard
3. **Running** → Show Gitea dashboard with repos

### UI Components

**File: `frontend/src/pages/Git.jsx`**

```jsx
// Structure similar to Firewall.jsx

const Git = () => {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showInstallModal, setShowInstallModal] = useState(false);

    // Tabs: Overview, Repositories, Settings, Webhooks
    const [activeTab, setActiveTab] = useState('overview');

    return (
        <div className="page git-page">
            {/* Not installed state */}
            {!status?.installed && (
                <div className="empty-state-large">
                    <GitIcon />
                    <h2>Git Server Not Installed</h2>
                    <p>Install Gitea to manage your Git repositories</p>

                    {/* Resource Warning */}
                    <div className="resource-warning">
                        <WarningIcon />
                        <div>
                            <strong>Resource Requirements</strong>
                            <ul>
                                <li>Memory: ~512MB minimum (1GB recommended)</li>
                                <li>Storage: ~5GB for database + repositories</li>
                                <li>Will also install PostgreSQL database</li>
                            </ul>
                        </div>
                    </div>

                    <button onClick={() => setShowInstallModal(true)}>
                        Install Git Server
                    </button>
                </div>
            )}

            {/* Installed state - show dashboard */}
            {status?.installed && (
                <>
                    {/* Status cards, tabs, etc. */}
                </>
            )}
        </div>
    );
};
```

### Backend API Endpoints

**File: `backend/app/api/git.py`**

```python
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from app.services.git_service import GitService

git_bp = Blueprint('git', __name__, url_prefix='/api/git')

@git_bp.route('/status', methods=['GET'])
@jwt_required()
def get_status():
    """Get Gitea installation status."""
    return jsonify(GitService.get_status())

@git_bp.route('/install', methods=['POST'])
@jwt_required()
def install():
    """Install Gitea with PostgreSQL."""
    data = request.get_json() or {}
    return jsonify(GitService.install(
        admin_user=data.get('admin_user', 'admin'),
        admin_email=data.get('admin_email'),
        admin_password=data.get('admin_password')
    ))

@git_bp.route('/uninstall', methods=['POST'])
@jwt_required()
def uninstall():
    """Uninstall Gitea and optionally remove data."""
    data = request.get_json() or {}
    return jsonify(GitService.uninstall(
        remove_data=data.get('remove_data', False)
    ))

@git_bp.route('/repos', methods=['GET'])
@jwt_required()
def list_repos():
    """List all repositories."""
    return jsonify(GitService.list_repositories())

@git_bp.route('/webhooks', methods=['GET'])
@jwt_required()
def list_webhooks():
    """List configured webhooks."""
    return jsonify(GitService.list_webhooks())

@git_bp.route('/webhooks', methods=['POST'])
@jwt_required()
def create_webhook():
    """Create a webhook for GitHub/GitLab sync."""
    data = request.get_json()
    return jsonify(GitService.create_webhook(
        source=data.get('source'),  # 'github', 'gitlab', 'bitbucket'
        repo_url=data.get('repo_url'),
        local_repo=data.get('local_repo'),
        secret=data.get('secret')
    ))
```

### Git Service

**File: `backend/app/services/git_service.py`**

```python
"""Git/Gitea management service for ServerKit integrated Git."""

import os
import subprocess
import secrets
import requests
from typing import Dict, List, Optional
from app.services.template_service import TemplateService
from app.services.docker_service import DockerService

class GitService:
    """Service for managing integrated Gitea instance."""

    GITEA_APP_NAME = 'serverkit-gitea'
    GITEA_DATA_DIR = '/var/serverkit/gitea'
    GITEA_CONFIG_FILE = '/etc/serverkit/gitea.json'

    @classmethod
    def get_status(cls) -> Dict:
        """Check if Gitea is installed and running."""
        from app.models import Application

        app = Application.query.filter_by(name=cls.GITEA_APP_NAME).first()

        if not app:
            return {
                'installed': False,
                'running': False,
                'http_port': None,
                'ssh_port': None,
                'url': None
            }

        # Check container status
        running = DockerService.is_container_running(cls.GITEA_APP_NAME)

        # Load config for ports
        config = cls._load_config()

        return {
            'installed': True,
            'running': running,
            'http_port': app.port,
            'ssh_port': app.ssh_port or config.get('ssh_port'),
            'url': f"http://localhost:{app.port}",
            'app_id': app.id,
            'version': config.get('version', 'unknown')
        }

    @classmethod
    def install(cls, admin_user: str = 'admin',
                admin_email: str = None,
                admin_password: str = None) -> Dict:
        """Install Gitea as integrated ServerKit service."""

        # Check if already installed
        status = cls.get_status()
        if status['installed']:
            return {'success': False, 'error': 'Gitea is already installed'}

        # Generate secure password if not provided
        if not admin_password:
            admin_password = secrets.token_urlsafe(16)

        # Install using template service
        result = TemplateService.install_template(
            template_id='gitea',
            app_name=cls.GITEA_APP_NAME,
            user_variables={},
            user_id=1  # System user
        )

        if not result.get('success'):
            return result

        # Save config with admin credentials
        config = {
            'admin_user': admin_user,
            'admin_email': admin_email,
            'admin_password': admin_password,  # Should be encrypted
            'http_port': result.get('variables', {}).get('HTTP_PORT'),
            'ssh_port': result.get('variables', {}).get('SSH_PORT'),
            'db_password': result.get('variables', {}).get('DB_PASSWORD'),
            'installed_at': datetime.now().isoformat(),
            'version': '1.21'
        }
        cls._save_config(config)

        # Update Application with SSH port
        from app.models import Application
        from app import db

        app = Application.query.filter_by(name=cls.GITEA_APP_NAME).first()
        if app:
            app.ssh_port = int(config['ssh_port'])
            db.session.commit()

        return {
            'success': True,
            'message': 'Gitea installed successfully',
            'http_port': config['http_port'],
            'ssh_port': config['ssh_port'],
            'admin_user': admin_user,
            'admin_password': admin_password,  # Show once to user
            'warning': 'Save these credentials - password shown only once!'
        }

    @classmethod
    def get_resource_requirements(cls) -> Dict:
        """Get resource requirements for Gitea installation."""
        return {
            'memory_min': '512MB',
            'memory_recommended': '1GB',
            'storage_min': '5GB',
            'storage_recommended': '20GB',
            'components': [
                {'name': 'Gitea', 'memory': '~300MB', 'storage': '~100MB + repos'},
                {'name': 'PostgreSQL', 'memory': '~200MB', 'storage': '~1GB'}
            ],
            'warning': 'Installation will spin up a PostgreSQL database container'
        }
```

---

## Part 3: GitHub Webhook Integration

### Flow

```
[GitHub/GitLab] --webhook--> [ServerKit] --sync--> [Gitea/Local Repos]
```

### Webhook Endpoint

**File: `backend/app/api/webhooks.py`**

```python
from flask import Blueprint, request, jsonify
import hmac
import hashlib

webhooks_bp = Blueprint('webhooks', __name__, url_prefix='/api/webhooks')

@webhooks_bp.route('/github/<repo_id>', methods=['POST'])
def github_webhook(repo_id):
    """Handle GitHub webhook for repo sync."""
    # Verify signature
    signature = request.headers.get('X-Hub-Signature-256')
    if not verify_github_signature(request.data, signature, repo_id):
        return jsonify({'error': 'Invalid signature'}), 401

    event = request.headers.get('X-GitHub-Event')
    payload = request.get_json()

    if event == 'push':
        # Sync changes to local Gitea
        return handle_push_event(repo_id, payload)
    elif event == 'pull_request':
        return handle_pr_event(repo_id, payload)

    return jsonify({'status': 'ignored'})

def verify_github_signature(payload: bytes, signature: str, repo_id: str) -> bool:
    """Verify GitHub webhook signature."""
    webhook_config = get_webhook_config(repo_id)
    if not webhook_config:
        return False

    secret = webhook_config['secret'].encode()
    expected = 'sha256=' + hmac.new(secret, payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

### UI for Webhook Setup

```
+----------------------------------------------------+
|  Add GitHub Sync                                    |
+----------------------------------------------------+
|                                                     |
|  GitHub Repository URL:                             |
|  [https://github.com/user/repo.git            ]   |
|                                                     |
|  Local Repository (in Gitea):                       |
|  [Select or create new...                    v]    |
|                                                     |
|  Sync Direction:                                    |
|  ( ) GitHub -> ServerKit (mirror)                   |
|  ( ) Bidirectional                                  |
|  ( ) ServerKit -> GitHub (push)                     |
|                                                     |
|  Webhook URL (copy this to GitHub):                 |
|  +----------------------------------------------+  |
|  | https://yourserver.com/api/webhooks/github/  |  |
|  | abc123xyz                                    |  |
|  +----------------------------------------------+  |
|  [Copy]                                             |
|                                                     |
|  Webhook Secret:                                    |
|  +----------------------------------------------+  |
|  | ••••••••••••••••••                          |  |
|  +----------------------------------------------+  |
|  [Generate New] [Copy]                             |
|                                                     |
|  [Cancel]                      [Create Webhook]    |
+----------------------------------------------------+
```

---

## Part 4: Implementation Order

### Phase 1: Git Page Foundation (Priority: High)
1. [ ] Add "Git" to sidebar in Sidebar.jsx
2. [ ] Create Git.jsx page component
3. [ ] Create _git.less styles
4. [ ] Create git_service.py backend
5. [ ] Create git.py API blueprint
6. [ ] Register blueprint in __init__.py

### Phase 2: Integrated Gitea (Priority: Medium)
1. [ ] Create Gitea installation flow with resource warning
2. [ ] Store Gitea config separately from regular apps
3. [ ] Add Gitea-specific nginx config generation
4. [ ] Add SSH port display in UI
5. [ ] Create uninstall flow

### Phase 3: Webhook Integration (Priority: Medium)
1. [ ] Create webhook database model
2. [ ] Create webhooks API endpoints
3. [ ] Create webhook verification logic
4. [ ] Create UI for webhook management
5. [ ] Add GitHub webhook handler
6. [ ] Add GitLab webhook handler (optional)

### Phase 4: Polish (Priority: Low)
1. [ ] Add repository browsing in Git page
2. [ ] Add commit history viewer
3. [ ] Add branch management
4. [ ] Add user/team management integration

---

## Part 5: File Structure

```
backend/
├── app/
│   ├── api/
│   │   ├── git.py           # NEW - Git API endpoints
│   │   └── webhooks.py      # NEW - Webhook handlers
│   ├── models/
│   │   └── webhook.py       # NEW - Webhook model
│   └── services/
│       └── git_service.py   # NEW - Git/Gitea service
│
frontend/
├── src/
│   ├── components/
│   │   └── Sidebar.jsx      # MODIFY - Add Git item
│   ├── pages/
│   │   └── Git.jsx          # NEW - Git page
│   ├── services/
│   │   └── api.js           # MODIFY - Add git endpoints
│   └── styles/
│       └── pages/
│           └── _git.less    # NEW - Git page styles
```

---

## Part 6: Database Changes

```sql
-- New table: webhooks (for GitHub/GitLab sync)
CREATE TABLE webhooks (
    id INTEGER PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    source VARCHAR(50) NOT NULL,  -- 'github', 'gitlab', 'bitbucket'
    source_repo_url VARCHAR(500) NOT NULL,
    local_repo_id INTEGER,
    secret VARCHAR(100) NOT NULL,
    sync_direction VARCHAR(20) DEFAULT 'pull',  -- 'pull', 'push', 'bidirectional'
    last_sync_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

-- New table: git_config (for integrated Gitea settings)
CREATE TABLE git_config (
    id INTEGER PRIMARY KEY,
    app_id INTEGER REFERENCES applications(id),
    admin_user VARCHAR(100),
    http_port INTEGER,
    ssh_port INTEGER,
    version VARCHAR(20),
    installed_at DATETIME,
    UNIQUE(app_id)
);
```

---

## Summary

| Feature | Status | Priority |
|---------|--------|----------|
| Git sidebar page | Need implementation | High |
| Resource warning UI | Need implementation | High |
| Integrated Gitea installation | Need implementation | High |
| GitHub webhook sync | Need implementation | Medium |
| GitLab webhook sync | Need implementation | Low |
| Repository browser in UI | Need implementation | Low |

This plan provides a roadmap for adding a fully integrated Git feature to ServerKit with resource warnings and webhook support for syncing with GitHub/GitLab repositories.
