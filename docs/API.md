# ServerKit API Reference

This document provides complete REST API documentation for ServerKit.

---

## Overview

**Base URL:** `http://localhost:5000/api/v1`

**Content Type:** All requests and responses use `application/json`

**Authentication:** JWT Bearer tokens (except where noted)

---

## Authentication

### Login

Authenticate and receive access tokens.

```http
POST /auth/login
```

**Rate Limit:** 5 requests per minute

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "your-password"
}
```

**Response (200):**
```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "admin",
    "role": "admin"
  },
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "refresh_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

**Response (2FA Required):**
```json
{
  "requires_2fa": true,
  "temp_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "message": "Two-factor authentication required"
}
```

---

### Register

Create a new user account. The first registered user becomes admin.

```http
POST /auth/register
```

**Rate Limit:** 3 requests per minute

**Request Body:**
```json
{
  "email": "user@example.com",
  "username": "newuser",
  "password": "secure-password"
}
```

**Response (201):**
```json
{
  "message": "User registered successfully",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "newuser",
    "role": "admin"
  },
  "access_token": "...",
  "refresh_token": "..."
}
```

---

### Refresh Token

Get a new access token using a refresh token.

```http
POST /auth/refresh
Authorization: Bearer <refresh_token>
```

**Response (200):**
```json
{
  "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

---

### Get Current User

```http
GET /auth/me
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "user": {
    "id": 1,
    "email": "user@example.com",
    "username": "admin",
    "role": "admin",
    "totp_enabled": true
  }
}
```

---

### Update Current User

```http
PUT /auth/me
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "username": "newusername",
  "email": "newemail@example.com",
  "password": "new-password"
}
```

---

## Two-Factor Authentication

### Setup 2FA

Generate a TOTP secret and QR code for setup.

```http
POST /2fa/setup
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "secret": "BASE32SECRET",
  "qr_code": "data:image/png;base64,...",
  "backup_codes": ["12345678", "87654321", ...]
}
```

---

### Enable 2FA

Verify and enable 2FA after setup.

```http
POST /2fa/enable
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "code": "123456"
}
```

---

### Verify 2FA

Complete login with 2FA code.

```http
POST /2fa/verify
Authorization: Bearer <temp_token>
```

**Request Body:**
```json
{
  "code": "123456"
}
```

**Response (200):**
```json
{
  "user": {...},
  "access_token": "...",
  "refresh_token": "..."
}
```

---

### Disable 2FA

```http
POST /2fa/disable
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "code": "123456"
}
```

---

## System Metrics

All system endpoints require admin role.

### Get All Metrics

```http
GET /system/metrics
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "cpu": {
    "percent": 15.2,
    "count": 4,
    "freq_current": 2400.0
  },
  "memory": {
    "total": 8589934592,
    "available": 4294967296,
    "percent": 50.0,
    "used": 4294967296
  },
  "disk": {
    "total": 107374182400,
    "used": 53687091200,
    "free": 53687091200,
    "percent": 50.0
  },
  "network": {
    "bytes_sent": 1234567890,
    "bytes_recv": 9876543210
  }
}
```

---

### Get CPU Metrics

```http
GET /system/cpu
```

### Get Memory Metrics

```http
GET /system/memory
```

### Get Disk Metrics

```http
GET /system/disk
```

### Get Network Metrics

```http
GET /system/network
```

### Get Running Processes

```http
GET /system/processes
```

**Response (200):**
```json
{
  "processes": [
    {
      "pid": 1234,
      "name": "python",
      "cpu_percent": 5.2,
      "memory_percent": 2.1,
      "status": "running"
    }
  ]
}
```

---

### Get Services Status

```http
GET /system/services
```

**Response (200):**
```json
{
  "services": [
    {"name": "nginx", "status": "running"},
    {"name": "mysql", "status": "running"},
    {"name": "docker", "status": "stopped"}
  ]
}
```

---

### Health Check

No authentication required.

```http
GET /system/health
```

**Response (200):**
```json
{
  "status": "healthy",
  "service": "serverkit-api"
}
```

---

## Applications

### List Applications

```http
GET /apps
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "apps": [
    {
      "id": 1,
      "name": "my-app",
      "app_type": "php",
      "status": "running",
      "php_version": "8.2",
      "port": 8080,
      "root_path": "/var/www/my-app",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### Get Application

```http
GET /apps/:id
Authorization: Bearer <access_token>
```

---

### Create Application

```http
POST /apps
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "name": "my-app",
  "app_type": "php",
  "php_version": "8.2",
  "port": 8080,
  "root_path": "/var/www/my-app"
}
```

**Valid app_type values:** `php`, `wordpress`, `flask`, `django`, `docker`, `static`

---

### Update Application

```http
PUT /apps/:id
Authorization: Bearer <access_token>
```

---

### Delete Application

```http
DELETE /apps/:id
Authorization: Bearer <access_token>
```

---

### Start Application

```http
POST /apps/:id/start
Authorization: Bearer <access_token>
```

### Stop Application

```http
POST /apps/:id/stop
Authorization: Bearer <access_token>
```

### Restart Application

```http
POST /apps/:id/restart
Authorization: Bearer <access_token>
```

---

## Environment Variables

### List Environment Variables

```http
GET /apps/:app_id/env
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "env_vars": [
    {
      "id": 1,
      "key": "DATABASE_URL",
      "is_secret": true,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

---

### Set Environment Variable

```http
POST /apps/:app_id/env
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "key": "DATABASE_URL",
  "value": "postgresql://user:pass@localhost/db",
  "is_secret": true
}
```

---

### Delete Environment Variable

```http
DELETE /apps/:app_id/env/:key
Authorization: Bearer <access_token>
```

---

## Domains

### List Domains

```http
GET /domains
Authorization: Bearer <access_token>
```

### Create Domain

```http
POST /domains
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "domain": "example.com",
  "app_id": 1
}
```

### Delete Domain

```http
DELETE /domains/:id
Authorization: Bearer <access_token>
```

---

## SSL Certificates

### List Certificates

```http
GET /ssl/certificates
Authorization: Bearer <access_token>
```

### Issue Certificate

Request a Let's Encrypt certificate.

```http
POST /ssl/issue
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "domain": "example.com",
  "email": "admin@example.com"
}
```

### Renew Certificate

```http
POST /ssl/renew/:domain
Authorization: Bearer <access_token>
```

---

## Databases

### List Databases

```http
GET /databases
Authorization: Bearer <access_token>
```

### Create Database

```http
POST /databases
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "name": "my_database",
  "type": "mysql",
  "charset": "utf8mb4"
}
```

### Delete Database

```http
DELETE /databases/:id
Authorization: Bearer <access_token>
```

### Create Database User

```http
POST /databases/:id/users
Authorization: Bearer <access_token>
```

---

## Docker

### List Containers

```http
GET /docker/containers
Authorization: Bearer <access_token>
```

### Get Container

```http
GET /docker/containers/:id
Authorization: Bearer <access_token>
```

### Start Container

```http
POST /docker/containers/:id/start
Authorization: Bearer <access_token>
```

### Stop Container

```http
POST /docker/containers/:id/stop
Authorization: Bearer <access_token>
```

### Container Logs

```http
GET /docker/containers/:id/logs
Authorization: Bearer <access_token>
```

### List Images

```http
GET /docker/images
Authorization: Bearer <access_token>
```

---

## Files

### List Directory

```http
GET /files?path=/var/www
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "files": [
    {
      "name": "index.html",
      "path": "/var/www/index.html",
      "type": "file",
      "size": 1234,
      "modified": "2024-01-01T00:00:00Z"
    }
  ]
}
```

### Read File

```http
GET /files/read?path=/var/www/index.html
Authorization: Bearer <access_token>
```

### Write File

```http
POST /files/write
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "path": "/var/www/index.html",
  "content": "<html>...</html>"
}
```

### Delete File

```http
DELETE /files?path=/var/www/old-file.txt
Authorization: Bearer <access_token>
```

---

## Cron Jobs

### List Cron Jobs

```http
GET /cron
Authorization: Bearer <access_token>
```

### Create Cron Job

```http
POST /cron
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "name": "Daily Backup",
  "command": "/usr/local/bin/backup.sh",
  "schedule": "0 2 * * *",
  "enabled": true
}
```

### Update Cron Job

```http
PUT /cron/:id
Authorization: Bearer <access_token>
```

### Delete Cron Job

```http
DELETE /cron/:id
Authorization: Bearer <access_token>
```

---

## Firewall (UFW)

### Get Firewall Status

```http
GET /firewall/status
Authorization: Bearer <access_token>
```

### List Rules

```http
GET /firewall/rules
Authorization: Bearer <access_token>
```

### Add Rule

```http
POST /firewall/rules
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "port": 443,
  "protocol": "tcp",
  "action": "allow",
  "direction": "in"
}
```

### Delete Rule

```http
DELETE /firewall/rules/:id
Authorization: Bearer <access_token>
```

### Enable/Disable Firewall

```http
POST /firewall/enable
POST /firewall/disable
Authorization: Bearer <access_token>
```

---

## Security

### Get Security Status

```http
GET /security/status
Authorization: Bearer <access_token>
```

**Response (200):**
```json
{
  "clamav_installed": true,
  "clamav_running": true,
  "last_scan": "2024-01-01T00:00:00Z",
  "threats_found": 0,
  "quarantined_files": 3,
  "integrity_initialized": true
}
```

---

### Get ClamAV Status

```http
GET /security/clamav/status
Authorization: Bearer <access_token>
```

### Install ClamAV

```http
POST /security/clamav/install
Authorization: Bearer <access_token>
```

### Update Virus Definitions

```http
POST /security/clamav/update
Authorization: Bearer <access_token>
```

---

### Scan File

```http
POST /security/scan/file
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "path": "/var/www/suspicious-file.php"
}
```

### Scan Directory

```http
POST /security/scan/directory
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "path": "/var/www/html",
  "recursive": true
}
```

### Quick Scan

Scan common web directories.

```http
POST /security/scan/quick
Authorization: Bearer <access_token>
```

### Full Scan

Scan entire system.

```http
POST /security/scan/full
Authorization: Bearer <access_token>
```

---

### Get Quarantine

```http
GET /security/quarantine
Authorization: Bearer <access_token>
```

### Quarantine File

```http
POST /security/quarantine
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "path": "/var/www/malware.php"
}
```

### Delete Quarantined File

```http
DELETE /security/quarantine/:id
Authorization: Bearer <access_token>
```

---

### Initialize Integrity Database

```http
POST /security/integrity/initialize
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "paths": ["/var/www", "/etc/nginx"]
}
```

### Check File Integrity

```http
GET /security/integrity/check
Authorization: Bearer <access_token>
```

---

### Get Failed Logins

```http
GET /security/failed-logins
Authorization: Bearer <access_token>
```

### Get Security Events

```http
GET /security/events
Authorization: Bearer <access_token>
```

---

## Notifications

### Get Notification Status

```http
GET /notifications/status
Authorization: Bearer <access_token>
```

### Get Notification Config

```http
GET /notifications/config
Authorization: Bearer <access_token>
```

### Update Channel Config

```http
PUT /notifications/config/:channel
Authorization: Bearer <access_token>
```

**Channels:** `discord`, `slack`, `telegram`, `webhook`

**Request Body (Discord):**
```json
{
  "enabled": true,
  "webhook_url": "https://discord.com/api/webhooks/...",
  "severity_levels": ["warning", "critical"]
}
```

### Test Notification

```http
POST /notifications/test/:channel
Authorization: Bearer <access_token>
```

### Test All Channels

```http
POST /notifications/test
Authorization: Bearer <access_token>
```

---

## Monitoring

### Get Monitoring Status

```http
GET /monitoring/status
Authorization: Bearer <access_token>
```

### Get Alert Thresholds

```http
GET /monitoring/thresholds
Authorization: Bearer <access_token>
```

### Update Alert Thresholds

```http
PUT /monitoring/thresholds
Authorization: Bearer <access_token>
```

**Request Body:**
```json
{
  "cpu_warning": 70,
  "cpu_critical": 90,
  "memory_warning": 80,
  "memory_critical": 95,
  "disk_warning": 80,
  "disk_critical": 95
}
```

### Get Alert History

```http
GET /monitoring/alerts
Authorization: Bearer <access_token>
```

---

## Uptime

### Get Uptime History

```http
GET /uptime/history
Authorization: Bearer <access_token>
```

### Get Uptime Stats

```http
GET /uptime/stats
Authorization: Bearer <access_token>
```

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Error message describing what went wrong"
}
```

### Common Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request - Invalid input |
| 401 | Unauthorized - Invalid or missing token |
| 403 | Forbidden - Insufficient permissions |
| 404 | Not Found - Resource doesn't exist |
| 409 | Conflict - Resource already exists |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |

---

## Rate Limiting

Some endpoints have rate limits:

| Endpoint | Limit |
|----------|-------|
| POST /auth/login | 5/minute |
| POST /auth/register | 3/minute |

When rate limited, you'll receive a 429 response with retry information.

---

## WebSocket Events

ServerKit uses Socket.IO for real-time updates.

**Connection:**
```javascript
const socket = io('http://localhost:5000', {
  auth: { token: 'your-access-token' }
});
```

**Events:**

| Event | Description |
|-------|-------------|
| `metrics` | Real-time system metrics |
| `alert` | New alert triggered |
| `scan_progress` | Malware scan progress |
| `scan_complete` | Scan finished |

---

## Examples

### cURL

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}' \
  | jq -r '.access_token')

# Get system metrics
curl -s http://localhost:5000/api/v1/system/metrics \
  -H "Authorization: Bearer $TOKEN" | jq

# Create application
curl -s -X POST http://localhost:5000/api/v1/apps \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"my-app","app_type":"php","php_version":"8.2"}'
```

### Python

```python
import requests

BASE_URL = "http://localhost:5000/api/v1"

# Login
response = requests.post(f"{BASE_URL}/auth/login", json={
    "email": "admin@example.com",
    "password": "password"
})
token = response.json()["access_token"]

headers = {"Authorization": f"Bearer {token}"}

# Get metrics
metrics = requests.get(f"{BASE_URL}/system/metrics", headers=headers).json()
print(f"CPU: {metrics['cpu']['percent']}%")
```

### JavaScript

```javascript
const BASE_URL = 'http://localhost:5000/api/v1';

// Login
const loginRes = await fetch(`${BASE_URL}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@example.com',
    password: 'password'
  })
});

const { access_token } = await loginRes.json();

// Get metrics
const metricsRes = await fetch(`${BASE_URL}/system/metrics`, {
  headers: { 'Authorization': `Bearer ${access_token}` }
});

const metrics = await metricsRes.json();
console.log(`CPU: ${metrics.cpu.percent}%`);
```

---

<p align="center">
  <strong>ServerKit API Reference</strong><br>
  Version 0.9.0
</p>
