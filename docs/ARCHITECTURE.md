# ServerKit Architecture

> Deep dive into how ServerKit connects domains, apps, containers, and databases.

---

## Table of Contents

- [System Overview](#system-overview)
- [Request Flow](#request-flow)
- [Template System](#template-system)
- [Port Allocation](#port-allocation)
- [Database Linking](#database-linking)
- [File Paths](#file-paths)

---

## System Overview

```
                                    ┌─────────────────────────────────────────────────────────────┐
                                    │                        INTERNET                             │
                                    └─────────────────────────────────────────────────────────────┘
                                                              │
                                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         YOUR SERVER                                                  │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                    NGINX (Reverse Proxy)                                      │  │
│  │                                      Port 80 / 443                                            │  │
│  │                                                                                               │  │
│  │   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐              │  │
│  │   │ app1.com     │    │ app2.com     │    │ api.app3.com │    │ Private URLs │              │  │
│  │   │    :443      │    │    :443      │    │    :443      │    │  /p/abc123   │              │  │
│  │   └──────┬───────┘    └──────┬───────┘    └──────┬───────┘    └──────┬───────┘              │  │
│  └──────────┼───────────────────┼───────────────────┼───────────────────┼────────────────────────┘  │
│             │                   │                   │                   │                           │
│             │ proxy_pass        │ proxy_pass        │ proxy_pass        │ proxy_pass                │
│             ▼                   ▼                   ▼                   ▼                           │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                                    DOCKER CONTAINERS                                         │   │
│  │                                                                                              │   │
│  │   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐             │   │
│  │   │  WordPress   │    │    Flask     │    │   Node.js    │    │   Custom     │             │   │
│  │   │  Port 8001   │    │  Port 8002   │    │  Port 8003   │    │  Port 8004   │             │   │
│  │   │              │    │              │    │              │    │              │             │   │
│  │   │ ┌──────────┐ │    │ ┌──────────┐ │    │ ┌──────────┐ │    │ ┌──────────┐ │             │   │
│  │   │ │ Apache   │ │    │ │ Gunicorn │ │    │ │   PM2    │ │    │ │  Your    │ │             │   │
│  │   │ │ PHP-FPM  │ │    │ │ Python   │ │    │ │ Express  │ │    │ │  App     │ │             │   │
│  │   │ └──────────┘ │    │ └──────────┘ │    │ └──────────┘ │    │ └──────────┘ │             │   │
│  │   └──────┬───────┘    └──────────────┘    └──────────────┘    └──────────────┘             │   │
│  │          │                                                                                  │   │
│  └──────────┼──────────────────────────────────────────────────────────────────────────────────┘   │
│             │                                                                                       │
│             ▼                                                                                       │
│  ┌─────────────────────────────────────────────────────────────────────────────────────────────┐   │
│  │                                      DATABASES                                               │   │
│  │                                                                                              │   │
│  │   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐             │   │
│  │   │    MySQL     │    │  PostgreSQL  │    │    Redis     │    │   MongoDB    │             │   │
│  │   │  Port 3306   │    │  Port 5432   │    │  Port 6379   │    │  Port 27017  │             │   │
│  │   └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘             │   │
│  │                                                                                              │   │
│  └──────────────────────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Request Flow

What happens when a user visits your app:

```
User Request                    What Happens
─────────────────────────────────────────────────────────────────────────────────

  Browser                 1. DNS resolves app1.com to your server IP
     │
     ▼
┌─────────┐              2. Request hits Nginx on port 80/443
│  Nginx  │                 Nginx checks server_name directives
│ :80/443 │                 Matches "app1.com" → proxy_pass http://127.0.0.1:8001
└────┬────┘
     │
     ▼
┌─────────┐              3. Nginx forwards request to Docker container
│ Docker  │                 Container receives request on internal port
│ :8001   │                 App processes and returns response
└────┬────┘
     │
     ▼
┌─────────┐              4. Response flows back through Nginx
│ Response│                 SSL termination handled by Nginx
│  200 OK │                 User sees the page
└─────────┘
```

### Detailed Nginx → Container Flow

```
                    NGINX CONFIG                                    DOCKER
              /etc/nginx/sites-enabled/                         CONTAINER
             ─────────────────────────                     ─────────────────

             server {
                 listen 80;
                 server_name my-blog.com;
                                                           ┌─────────────────┐
                 location / {                              │   WordPress     │
                     proxy_pass ─────────────────────────► │                 │
                        http://127.0.0.1:8001;             │  0.0.0.0:80     │
                     proxy_set_header Host $host;          │       ▲         │
                     proxy_set_header X-Real-IP ...;       │       │         │
                 }                                         │   (mapped to    │
             }                                             │    host:8001)   │
                                                           └─────────────────┘
```

---

## Template System

### Template → App → Domain Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              TEMPLATE LIBRARY                                    │
│                           /etc/serverkit/templates/                              │
│                                                                                  │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│   │WordPress│  │  Flask  │  │ Node.js │  │ Grafana │  │  n8n    │  ... 60+    │
│   │  .yaml  │  │  .yaml  │  │  .yaml  │  │  .yaml  │  │  .yaml  │             │
│   └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘             │
│        │            │            │            │            │                   │
└────────┼────────────┼────────────┼────────────┼────────────┼───────────────────┘
         │            │            │            │            │
         │     User clicks "Deploy" in UI                    │
         │            │                                      │
         ▼            ▼                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SERVERKIT BACKEND                                   │
│                                                                                  │
│  TemplateService.install_template()                                             │
│  ├── 1. Parse template YAML                                                     │
│  ├── 2. Generate unique port (8000-60000)                                       │
│  ├── 3. Substitute variables:                                                   │
│  │       ${APP_NAME}    → "my-blog"                                             │
│  │       ${HTTP_PORT}   → "8247"                                                │
│  │       ${DB_PASSWORD} → "auto_generated"                                      │
│  ├── 4. Create /var/serverkit/apps/my-blog/docker-compose.yml                   │
│  ├── 5. Run: docker compose up -d --build                                       │
│  └── 6. Store app record in database                                            │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              APP CREATED                                         │
│                                                                                  │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │  App Name:    my-blog                                                   │   │
│   │  Type:        docker                                                    │   │
│   │  Port:        8247 (auto-assigned)                                      │   │
│   │  Status:      running                                                   │   │
│   │  Container:   my-blog                                                   │   │
│   │  Path:        /var/serverkit/apps/my-blog/                              │   │
│   │                                                                         │   │
│   │  Private URL: http://server-ip:8247  ◄── Works immediately!             │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
         │
         │  User clicks "Connect Domain"
         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DOMAIN CONNECTED                                    │
│                                                                                  │
│  DomainService.create_domain()                                                  │
│  ├── 1. Validate domain DNS points to server                                    │
│  ├── 2. Check container port is accessible                                      │
│  ├── 3. Generate Nginx config:                                                  │
│  │                                                                              │
│  │      server {                                                                │
│  │          listen 80;                                                          │
│  │          server_name my-blog.com;                                            │
│  │                                                                              │
│  │          location / {                                                        │
│  │              proxy_pass http://127.0.0.1:8247;  ◄── Container port           │
│  │              proxy_set_header Host $host;                                    │
│  │              proxy_set_header X-Real-IP $remote_addr;                        │
│  │              proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;    │
│  │              proxy_set_header X-Forwarded-Proto $scheme;                     │
│  │          }                                                                   │
│  │      }                                                                       │
│  │                                                                              │
│  ├── 4. Write to /etc/nginx/sites-available/my-blog                             │
│  ├── 5. Symlink to /etc/nginx/sites-enabled/my-blog                             │
│  ├── 6. Test config: nginx -t                                                   │
│  ├── 7. Reload: systemctl reload nginx                                          │
│  └── 8. (Optional) Request SSL via Let's Encrypt                                │
│                                                                                  │
│   Public URL: https://my-blog.com  ◄── Now accessible worldwide!                │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Template YAML Structure

```yaml
# Example: flask-hello-world.yaml

id: flask-hello-world
name: Flask - Hello World
version: "1.0"
description: Simple Flask debug app
categories:
  - development
  - api

variables:
  - name: HTTP_PORT          # Variable name
    type: port               # Auto-generates available port
    default: "5000"          # Starting port to search from
    hidden: true             # Don't show in UI

compose:                     # Docker Compose configuration
  services:
    app:
      image: python:3.12-slim
      container_name: ${APP_NAME}
      ports:
        - "${HTTP_PORT}:5000"    # Host:Container port mapping
      environment:
        - APP_NAME=${APP_NAME}
        - EXTERNAL_PORT=${HTTP_PORT}
```

---

## Port Allocation

### How ServerKit Finds Available Ports

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              PORT ALLOCATION                                     │
│                                                                                  │
│  TemplateService._find_available_port(start=8000)                               │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  Step 1: Check Database                                                  │   │
│  │  SELECT port FROM applications WHERE port IS NOT NULL                    │   │
│  │  Result: [8001, 8002, 8005, 8010]                                        │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                            │                                                    │
│                            ▼                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  Step 2: Check Docker                                                    │   │
│  │  docker ps --format '{{.Ports}}'                                         │   │
│  │  Parse: "0.0.0.0:8003->80/tcp" → 8003                                    │   │
│  │  Result: [8003, 8004]                                                    │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                            │                                                    │
│                            ▼                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  Step 3: Socket Bind Test                                                │   │
│  │  Try: socket.bind(('127.0.0.1', port))                                   │   │
│  │  If fails → port in use by system                                        │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                            │                                                    │
│                            ▼                                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │  Step 4: Return First Available                                          │   │
│  │                                                                          │   │
│  │  Checking 8000... taken (DB)                                             │   │
│  │  Checking 8001... taken (DB)                                             │   │
│  │  Checking 8002... taken (DB)                                             │   │
│  │  Checking 8003... taken (Docker)                                         │   │
│  │  Checking 8004... taken (Docker)                                         │   │
│  │  Checking 8005... taken (DB)                                             │   │
│  │  Checking 8006... AVAILABLE ✓                                            │   │
│  │                                                                          │   │
│  │  Return: 8006                                                            │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Port Map Example

```
┌──────────┬────────────────────────────────────────┐
│   Port   │              Service                   │
├──────────┼────────────────────────────────────────┤
│    22    │ SSH                                    │
│    80    │ Nginx (HTTP)                           │
│   443    │ Nginx (HTTPS)                          │
│  3306    │ MySQL                                  │
│  5432    │ PostgreSQL                             │
│  5000    │ ServerKit Backend API                  │
│  6379    │ Redis                                  │
├──────────┼────────────────────────────────────────┤
│  8001    │ App: wordpress-blog                    │
│  8002    │ App: flask-api                         │
│  8003    │ App: node-frontend                     │
│  8004    │ App: grafana-monitoring                │
│  8005    │ App: n8n-automation                    │
│  8006    │ App: (next available)                  │
│   ...    │ ...                                    │
│ 60000    │ (max port range)                       │
└──────────┴────────────────────────────────────────┘
```

---

## Database Linking

### How Apps Connect to Databases

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                                                                                 │
│    ┌──────────────────┐              ┌──────────────────┐                      │
│    │   APP (Flask)    │              │ DATABASE (MySQL) │                      │
│    │                  │              │                  │                      │
│    │  Needs DB access │              │  db: my_app_db   │                      │
│    │                  │              │  user: app_user  │                      │
│    └────────┬─────────┘              └────────┬─────────┘                      │
│             │                                  │                                │
│             │      User clicks "Link Database" │                                │
│             │                                  │                                │
│             └──────────────┬───────────────────┘                                │
│                            │                                                    │
│                            ▼                                                    │
│    ┌────────────────────────────────────────────────────────────────────────┐  │
│    │                    SERVERKIT LINKS THEM                                 │  │
│    │                                                                         │  │
│    │  1. Creates database: my_app_db                                         │  │
│    │  2. Creates user with secure password                                   │  │
│    │  3. Grants permissions                                                  │  │
│    │  4. Injects environment variables into app container:                   │  │
│    │                                                                         │  │
│    │     ┌─────────────────────────────────────────────────────────────┐    │  │
│    │     │  DB_HOST=localhost                                          │    │  │
│    │     │  DB_PORT=3306                                               │    │  │
│    │     │  DB_NAME=my_app_db                                          │    │  │
│    │     │  DB_USER=app_user                                           │    │  │
│    │     │  DB_PASSWORD=xK9#mP2$vL7@nQ4                                │    │  │
│    │     │                                                             │    │  │
│    │     │  # Also provides connection URL format:                     │    │  │
│    │     │  DATABASE_URL=mysql://app_user:xK9#mP2$vL7@nQ4@localhost/db │    │  │
│    │     └─────────────────────────────────────────────────────────────┘    │  │
│    │                                                                         │  │
│    │  5. Restarts app container to pick up new env vars                      │  │
│    │                                                                         │  │
│    └────────────────────────────────────────────────────────────────────────┘  │
│                            │                                                    │
│                            ▼                                                    │
│    ┌────────────────────────────────────────────────────────────────────────┐  │
│    │                         APP CODE                                        │  │
│    │                                                                         │  │
│    │  # Python/Flask example                                                 │  │
│    │  import os                                                              │  │
│    │  import mysql.connector                                                 │  │
│    │                                                                         │  │
│    │  db = mysql.connector.connect(                                          │  │
│    │      host=os.environ['DB_HOST'],      # localhost                       │  │
│    │      port=os.environ['DB_PORT'],      # 3306                            │  │
│    │      database=os.environ['DB_NAME'],  # my_app_db                       │  │
│    │      user=os.environ['DB_USER'],      # app_user                        │  │
│    │      password=os.environ['DB_PASSWORD']                                 │  │
│    │  )                                                                      │  │
│    │                                                                         │  │
│    │  # Or use the URL directly:                                             │  │
│    │  # SQLAlchemy: create_engine(os.environ['DATABASE_URL'])                │  │
│    │                                                                         │  │
│    └────────────────────────────────────────────────────────────────────────┘  │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## File Paths

### Where Everything Lives

```
SERVER FILESYSTEM
─────────────────────────────────────────────────────────────────────────────────

/var/serverkit/                          # ServerKit data root
├── apps/                                # All deployed applications
│   ├── my-blog/
│   │   ├── docker-compose.yml           # Generated from template
│   │   ├── .env                         # Environment variables
│   │   └── data/                        # Persistent volumes
│   ├── flask-api/
│   │   ├── docker-compose.yml
│   │   └── app/                         # Application code
│   └── ...
│
├── backups/                             # Database backups
│   ├── mysql/
│   └── postgres/
│
└── ssl/                                 # SSL certificates (if not using certbot)

/etc/serverkit/                          # ServerKit configuration
├── templates/                           # Template library (YAML files)
│   ├── wordpress.yaml
│   ├── flask-hello-world.yaml
│   ├── grafana.yaml
│   └── ...
└── config.yaml                          # Main config

/etc/nginx/                              # Nginx configuration
├── sites-available/                     # All site configs
│   ├── my-blog                          # Generated by ServerKit
│   ├── flask-api
│   └── default
├── sites-enabled/                       # Enabled sites (symlinks)
│   ├── my-blog -> ../sites-available/my-blog
│   └── flask-api -> ../sites-available/flask-api
└── nginx.conf                           # Main nginx config

/var/log/nginx/                          # Nginx logs (per-app)
├── my-blog.access.log
├── my-blog.error.log
├── flask-api.access.log
└── flask-api.error.log

/var/lib/mysql/                          # MySQL data
/var/lib/postgresql/                     # PostgreSQL data
```

---

## Component Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                SERVERKIT                                         │
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                            FRONTEND (React)                              │   │
│  │                         Served via Nginx :80/443                         │   │
│  │                                                                          │   │
│  │   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │   │
│  │   │Dashboard │ │   Apps   │ │ Domains  │ │ Docker   │ │ Security │    │   │
│  │   └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │   │
│  │   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐    │   │
│  │   │Databases │ │Templates │ │ Firewall │ │  Cron    │ │ Settings │    │   │
│  │   └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘    │   │
│  │                                                                          │   │
│  └─────────────────────────────────┬────────────────────────────────────────┘   │
│                                    │                                            │
│                          REST API + WebSocket                                   │
│                                    │                                            │
│                                    ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                          BACKEND (Flask)                                 │   │
│  │                            Port 5000                                     │   │
│  │                                                                          │   │
│  │   ┌─────────────────────────────────────────────────────────────────┐   │   │
│  │   │                         SERVICES                                 │   │   │
│  │   │                                                                  │   │   │
│  │   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │   │   │
│  │   │  │DockerService │  │ NginxService │  │TemplateServ. │          │   │   │
│  │   │  │              │  │              │  │              │          │   │   │
│  │   │  │ • compose_up │  │ • create_site│  │ • install    │          │   │   │
│  │   │  │ • logs       │  │ • enable_ssl │  │ • variables  │          │   │   │
│  │   │  │ • stats      │  │ • reload     │  │ • validate   │          │   │   │
│  │   │  └──────────────┘  └──────────────┘  └──────────────┘          │   │   │
│  │   │                                                                  │   │   │
│  │   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │   │   │
│  │   │  │  DBService   │  │  SSLService  │  │SecurityServ. │          │   │   │
│  │   │  │              │  │              │  │              │          │   │   │
│  │   │  │ • create_db  │  │ • certbot    │  │ • ClamAV     │          │   │   │
│  │   │  │ • users      │  │ • renew      │  │ • 2FA        │          │   │   │
│  │   │  │ • backup     │  │ • wildcard   │  │ • firewall   │          │   │   │
│  │   │  └──────────────┘  └──────────────┘  └──────────────┘          │   │   │
│  │   │                                                                  │   │   │
│  │   └──────────────────────────────────────────────────────────────────┘   │   │
│  │                                                                          │   │
│  └─────────────────────────────────┬────────────────────────────────────────┘   │
│                                    │                                            │
│                                    ▼                                            │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                       DATABASE (SQLite/PostgreSQL)                       │   │
│  │                                                                          │   │
│  │   ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌─────────┐  │   │
│  │   │   Apps    │ │  Domains  │ │   Users   │ │ Databases │ │ Settings│  │   │
│  │   └───────────┘ └───────────┘ └───────────┘ └───────────┘ └─────────┘  │   │
│  │                                                                          │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Troubleshooting

### 502 Bad Gateway

```
Problem: Nginx can't reach the container

Check:
┌─────────────────────────────────────────────────────────────────┐
│ 1. Is container running?                                        │
│    docker ps | grep <app-name>                                  │
│                                                                 │
│ 2. Is port bound to host?                                       │
│    docker port <container-name>                                 │
│    Expected: 5000/tcp -> 0.0.0.0:8001                          │
│                                                                 │
│ 3. Is port accessible?                                          │
│    curl -I http://127.0.0.1:8001                               │
│    Expected: HTTP/1.1 200 OK                                    │
│                                                                 │
│ 4. Does nginx config have correct port?                         │
│    cat /etc/nginx/sites-enabled/<app-name>                     │
│    Check: proxy_pass http://127.0.0.1:8001;                    │
│                                                                 │
│ 5. Check nginx error log:                                       │
│    tail -50 /var/log/nginx/<app-name>.error.log                │
└─────────────────────────────────────────────────────────────────┘
```

### Container Won't Start

```
Problem: docker compose up fails

Check:
┌─────────────────────────────────────────────────────────────────┐
│ 1. Check compose logs:                                          │
│    cd /var/serverkit/apps/<app-name>                           │
│    docker compose logs                                          │
│                                                                 │
│ 2. Validate compose file:                                       │
│    docker compose config                                        │
│                                                                 │
│ 3. Check for port conflicts:                                    │
│    docker ps --format "{{.Ports}}"                             │
│    netstat -tulpn | grep <port>                                │
└─────────────────────────────────────────────────────────────────┘
```

---

## See Also

- [Installation Guide](INSTALLATION.md)
- [API Reference](API.md)
- [Deployment Guide](DEPLOYMENT.md)
