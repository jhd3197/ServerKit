# ============================================
# ServerKit Dockerfile - Single Container
# ============================================
# This Dockerfile creates a single container with both
# frontend and backend. Good for simple deployments.
#
# For production with separate containers and nginx,
# use docker-compose.yml instead.
#
# Build: docker build -t serverkit .
# Run:   docker run -d -p 5000:5000 --env-file .env serverkit
#        Override the internal backend port with SERVERKIT_BACKEND_PORT if needed.
#
# Build args:
#   INSTALL_CLAMAV=true   bundle the ClamAV scanner (~250 MB). Off by default:
#                         malware scanning falls back to the builtin YARA/pure-
#                         Python matcher and reports clamav_available=false, so
#                         the feature degrades instead of breaking. Operators who
#                         want ClamAV can build with it or apt-install it beside
#                         the panel.
# ============================================

# Stage 1: Build Frontend
# --platform=$BUILDPLATFORM: dist/ is static JS/CSS (arch-independent), so this
# stage always runs natively on the build machine — never under QEMU, where an
# emulated `npm ci` takes 20-40 min (or hangs) during multi-arch release builds.
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm ci

# Copy frontend source
COPY frontend/ ./

# Build production bundle
RUN npm run build

# ============================================
# Stage 2: Python dependency builder
#
# The compiler toolchain (gcc, *-dev headers) is needed to build wheels for
# cryptography / lxml / psutil on platforms without a prebuilt wheel, but it is
# ~280 MB and has no business in a running panel. Building into a self-contained
# venv here lets the runtime stage take the result and leave the toolchain behind.
FROM python:3.11-slim-bookworm AS python-builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    # Required for cryptography
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY backend/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r /tmp/requirements.txt

# Trim the venv (~50 MB). Both prunes happen here in the builder, so a mistake
# surfaces as a failed image build, never as a half-installed panel on a host.
#
# 1. Bundled test suites. Third-party packages ship their own pytest trees
#    (passlib is the big one) that no running panel imports.
# 2. botocore API models. botocore carries JSON models for 400+ AWS services
#    (~15 MB); ServerKit constructs exactly three clients — s3
#    (storage_provider_service), route53 (dns_provider_service) and ses
#    (notifications/providers) — plus sts, which botocore resolves while signing.
#    The glob below matches directories only, so botocore's top-level
#    endpoints.json and partitions.json are never touched.
#
#    >>> Adding a new boto3.client('<svc>') call? Add <svc> to BOTOCORE_KEEP or
#    >>> it raises UnknownServiceError at runtime — in the image only, never in
#    >>> dev. backend/tests/test_botocore_prune_contract.py parses this ARG and
#    >>> every call site and fails the suite when the two drift apart.
ARG BOTOCORE_KEEP="s3 route53 ses sts"
RUN set -eux; \
    SP=/opt/venv/lib/python3.11/site-packages; \
    find "$SP" -type d \( -name tests -o -name test \) -prune -exec rm -rf {} +; \
    for d in "$SP"/botocore/data/*/; do \
      name="$(basename "$d")"; \
      case " $BOTOCORE_KEEP " in *" $name "*) ;; *) rm -rf "$d";; esac; \
    done

# ============================================
# Stage 3: Production Image
FROM python:3.11-slim-bookworm

ARG INSTALL_CLAMAV=false

# Set environment variables
# PATH puts the venv first so `python`, `pip` and `gunicorn` all resolve to it —
# including the runtime `sys.executable -m pip install` that PluginService uses
# to install an extension's Python requirements.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLASK_ENV=production \
    SERVERKIT_BACKEND_PORT=5000 \
    PATH="/opt/venv/bin:$PATH"

# Runtime system dependencies only — no compiler, no -dev headers. psutil and
# cryptography link against libssl3/libffi8, which the slim base already ships.
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Health check
    curl \
    # Useful utilities (ps/top for operators exec'ing into the container)
    procps \
    && if [ "$INSTALL_CLAMAV" = "true" ]; then \
         apt-get install -y --no-install-recommends \
           clamav clamav-daemon clamav-freshclam; \
       fi \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security. Declared BEFORE the COPYs below so they can
# use --chown: a trailing `chown -R` would otherwise rewrite every file's metadata
# and duplicate the whole tree (~200 MB of venv + app) into an extra layer.
RUN groupadd -r serverkit && useradd -r -g serverkit serverkit

# Bring in the fully-built virtualenv from the builder stage. Owned by serverkit
# so runtime extension installs (PluginService's `pip install -r`) can write to it.
COPY --from=python-builder --chown=serverkit:serverkit /opt/venv /opt/venv

# Create necessary directories.
#
# /app/instance is where config.py's default DATABASE_URL points
# (sqlite:////app/instance/serverkit.db). It must exist AND be owned by the
# serverkit user before the USER switch below: SQLAlchemy will not create the
# parent directory, so without this the container dies on boot with
# "sqlite3.OperationalError: unable to open database file". Creating it here
# also fixes the ownership of a named volume mounted at that path — Docker
# seeds an empty volume from the image directory, permissions included, but
# creates it root-owned when the path is absent from the image.
RUN mkdir -p /etc/serverkit /var/serverkit/apps /var/log/serverkit /var/quarantine /var/backups/serverkit /app/data /app/instance \
    && chown -R serverkit:serverkit /etc/serverkit /var/serverkit /var/log/serverkit /var/quarantine /var/backups/serverkit /app

# Set working directory
WORKDIR /app

# Copy backend source
COPY --chown=serverkit:serverkit backend/ ./backend/

# Ship the VERSION file next to the backend tree (/app/VERSION) so the panel
# reports its real version in containers instead of the unknown-version fallback
COPY --chown=serverkit:serverkit VERSION ./VERSION

# Ship the fleet-agent installers. The panel serves these over HTTP at
# /api/v1/servers/install.sh and /api/v1/servers/install.ps1, reading them off
# its own disk at <tree root>/scripts — which is /app/scripts here. Neither is
# served at the domain root; spelling the prefix out twice is deliberate, since
# a half-written path is what sent the #101 reporter hunting for a wrong URL.
#
# They were missing from the image entirely, so every containerised panel
# answered the enrollment one-liner its own UI prints with a 404, and no server
# could ever join the fleet (#101).
#
# Only these two files: both are standalone (they source nothing from
# scripts/lib), so the rest of scripts/ — lib, keys, the test harnesses,
# stage-remote.sh — stays out of the image where it belongs.
COPY --chown=serverkit:serverkit scripts/install.sh scripts/install.ps1 ./scripts/

# Copy built frontend from Stage 1
COPY --from=frontend-builder --chown=serverkit:serverkit /app/frontend/dist ./frontend/dist

# Switch to non-root user
USER serverkit

# Expose port
EXPOSE 5000

# Health check. Boot runs schema sync, migrations and settings seeding; the
# 40s grace matches docker-compose.yml so a slow first boot is not unhealthy.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f "http://localhost:${SERVERKIT_BACKEND_PORT:-5000}/api/v1/system/health" || exit 1

# Working directory for the backend
WORKDIR /app/backend

# Default command - use gunicorn for production
# Single process (agent gateway state is in-memory) + threads: the app runs
# async_mode='threading' (simple-websocket serves WS); a gevent-websocket
# worker would double-answer the upgrade handshake and break WebSocket.
CMD ["sh", "-c", "exec gunicorn --workers 1 --threads ${SERVERKIT_THREADS:-100} --bind 0.0.0.0:${SERVERKIT_BACKEND_PORT:-5000} --timeout 120 --access-logfile - --error-logfile - run:app"]
