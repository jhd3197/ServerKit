# Phase 11: Shared Database WordPress Template

## Objective
Create a WordPress template variant that connects to an external database instead of bundling its own MySQL container. This enables prod/dev environment sharing via a single database with different table prefixes.

## Execution Context

### Key Files
- `backend/templates/wordpress.yaml` - Existing WordPress template (reference)
- `backend/templates/index.json` - Template registry
- `backend/app/services/template_service.py` - Template installation logic
- `backend/app/api/templates.py` - Template API endpoints

### Current WordPress Template
The existing `wordpress.yaml` template:
- Bundles MySQL 8.0 container
- Uses hardcoded `WORDPRESS_DB_HOST=db` (internal service)
- Creates `wordpress_db` volume for database storage
- Variables: `HTTP_PORT`, `DB_PASSWORD`, `WP_DB_PASSWORD`

### WordPress Environment Variables
WordPress official Docker image supports:
- `WORDPRESS_DB_HOST` - Database host (can be `host:port`)
- `WORDPRESS_DB_USER` - Database username
- `WORDPRESS_DB_PASSWORD` - Database password
- `WORDPRESS_DB_NAME` - Database name
- `WORDPRESS_TABLE_PREFIX` - Table prefix (default: `wp_`)

---

## Tasks

### Task 1: Create WordPress External DB Template
**File**: `backend/templates/wordpress-external-db.yaml`

Create a new template for WordPress with external database support:

```yaml
id: wordpress-external-db
name: WordPress (External Database)
version: "6.4"
description: WordPress CMS connecting to an existing external MySQL database
icon: https://s.w.org/style/images/about/WordPress-logotype-wmark.png
website: https://wordpress.org
documentation: https://wordpress.org/documentation/
categories:
  - cms
  - blog
  - website
  - development

variables:
  - name: HTTP_PORT
    description: HTTP port for WordPress
    type: port
    default: "8080"
  - name: DB_HOST
    description: External database host (e.g., 192.168.1.100 or db.example.com)
    type: string
    required: true
  - name: DB_PORT
    description: External database port
    type: string
    default: "3306"
  - name: DB_NAME
    description: Database name
    type: string
    default: "wordpress"
    required: true
  - name: DB_USER
    description: Database username
    type: string
    default: "wordpress"
    required: true
  - name: DB_PASSWORD
    description: Database password
    type: password
    required: true
  - name: TABLE_PREFIX
    description: WordPress table prefix (use different prefix for dev vs prod)
    type: string
    default: "wp_"

ports:
  - port: 8080
    protocol: tcp
    description: Web interface

volumes:
  - name: html
    path: /var/www/html
    description: WordPress files

compose:
  services:
    wordpress:
      image: wordpress:${VERSION:-6.4-apache}
      container_name: ${APP_NAME}
      restart: unless-stopped
      environment:
        - WORDPRESS_DB_HOST=${DB_HOST}:${DB_PORT}
        - WORDPRESS_DB_USER=${DB_USER}
        - WORDPRESS_DB_PASSWORD=${DB_PASSWORD}
        - WORDPRESS_DB_NAME=${DB_NAME}
        - WORDPRESS_TABLE_PREFIX=${TABLE_PREFIX}
      volumes:
        - wordpress_html:/var/www/html
      ports:
        - "${HTTP_PORT}:80"

  volumes:
    wordpress_html:
```

Key differences from standard WordPress template:
- No `db` service
- No `wordpress_db` volume
- No `depends_on: db`
- External DB connection variables (host, port, name, user, password)
- `TABLE_PREFIX` variable for multi-instance support

### Task 2: Register Template in Index
**File**: `backend/templates/index.json`

Add the new template entry to the templates array:

```json
{
  "id": "wordpress-external-db",
  "name": "WordPress (External Database)",
  "version": "6.4",
  "description": "WordPress CMS with external MySQL database support for dev/prod environments",
  "categories": ["cms", "blog", "website", "development"]
}
```

Place it after the standard WordPress entry.

### Task 3: Add Database Connection Validation
**File**: `backend/app/services/template_service.py`

Add a method to validate MySQL connection before installation:

```python
@classmethod
def validate_mysql_connection(cls, host: str, port: int, user: str,
                               password: str, database: str) -> Dict:
    """Validate MySQL database connection.

    Returns:
        Dict with 'success' and optional 'error' message
    """
    import socket

    try:
        # First check if host:port is reachable
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(5)
        result = sock.connect_ex((host, int(port)))
        sock.close()

        if result != 0:
            return {
                'success': False,
                'error': f'Cannot connect to {host}:{port} - host unreachable'
            }

        # Try MySQL connection if pymysql available
        try:
            import pymysql
            conn = pymysql.connect(
                host=host,
                port=int(port),
                user=user,
                password=password,
                database=database,
                connect_timeout=5
            )
            conn.close()
            return {'success': True}
        except ImportError:
            # pymysql not available, just check port was reachable
            return {'success': True, 'warning': 'MySQL library not available, only port check performed'}
        except Exception as e:
            return {
                'success': False,
                'error': f'Database connection failed: {str(e)}'
            }

    except Exception as e:
        return {
            'success': False,
            'error': f'Connection check failed: {str(e)}'
        }
```

Integrate into `install_template()` method for external-db templates:

```python
# In install_template(), after variable processing:
if template_id == 'wordpress-external-db':
    db_check = cls.validate_mysql_connection(
        host=variables.get('DB_HOST'),
        port=variables.get('DB_PORT', '3306'),
        user=variables.get('DB_USER'),
        password=variables.get('DB_PASSWORD'),
        database=variables.get('DB_NAME')
    )
    if not db_check.get('success'):
        return {
            'success': False,
            'error': f"Database connection failed: {db_check.get('error')}"
        }
```

### Task 4: Add API Endpoint for DB Connection Test
**File**: `backend/app/api/templates.py`

Add an endpoint to test database connections before installation:

```python
@templates_bp.route('/test-db-connection', methods=['POST'])
@jwt_required()
def test_db_connection():
    """Test database connection before template installation."""
    data = request.get_json()

    required = ['host', 'user', 'password', 'database']
    for field in required:
        if field not in data:
            return jsonify({'error': f'Missing required field: {field}'}), 400

    result = TemplateService.validate_mysql_connection(
        host=data.get('host'),
        port=data.get('port', 3306),
        user=data.get('user'),
        password=data.get('password'),
        database=data.get('database')
    )

    if result.get('success'):
        return jsonify({'success': True, 'message': 'Connection successful'}), 200
    else:
        return jsonify({
            'success': False,
            'error': result.get('error')
        }), 400
```

### Task 5: Add Frontend API Method
**File**: `frontend/src/services/api.js`

Add method to test database connections:

```javascript
async testDatabaseConnection(config) {
    return this.request('/templates/test-db-connection', {
        method: 'POST',
        body: config
    });
}
```

---

## Verification

After implementation:
1. [ ] New template `wordpress-external-db` appears in template list
2. [ ] Template has correct variables: HTTP_PORT, DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, TABLE_PREFIX
3. [ ] Installing with invalid DB credentials shows clear error
4. [ ] Installing with valid external DB succeeds
5. [ ] WordPress container starts without bundled MySQL
6. [ ] WordPress connects to external database
7. [ ] Table prefix is applied correctly
8. [ ] Build passes without errors

---

## Success Criteria
- [ ] WordPress template can connect to external MySQL
- [ ] Connection errors shown clearly during install
- [ ] Table prefix configurable

---

## Output
- Created: `backend/templates/wordpress-external-db.yaml`
- Modified: `backend/templates/index.json`
- Modified: `backend/app/services/template_service.py`
- Modified: `backend/app/api/templates.py`
- Modified: `frontend/src/services/api.js`
- Created: `.planning/phases/11-shared-db-wordpress-template/SUMMARY.md`

---

## Notes
- The external DB template is separate from the standard WordPress template for clarity
- Users can install standard WordPress first (with bundled DB), then install WordPress-External-DB pointing to the same database with a different table prefix for dev
- pymysql is optional - if not installed, only port connectivity is checked
- Table prefix must end with underscore (WordPress requirement)
- Phase 12 will add the UI for linking apps and auto-configuring shared databases
