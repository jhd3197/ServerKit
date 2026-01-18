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
# ============================================

# Stage 1: Build Frontend
FROM node:20-alpine AS frontend-builder

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
# Stage 2: Production Image
FROM python:3.11-slim-bookworm

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLASK_ENV=production \
    PORT=5000

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Required for psutil and some Python packages
    gcc \
    python3-dev \
    # Required for gevent
    libevent-dev \
    # Required for cryptography
    libffi-dev \
    libssl-dev \
    # ClamAV for malware scanning (optional, can be installed separately)
    clamav \
    clamav-daemon \
    clamav-freshclam \
    # Useful utilities
    curl \
    procps \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN groupadd -r serverkit && useradd -r -g serverkit serverkit

# Create necessary directories
RUN mkdir -p /etc/serverkit /var/log/serverkit /var/quarantine \
    && chown -R serverkit:serverkit /etc/serverkit /var/log/serverkit /var/quarantine

# Set working directory
WORKDIR /app

# Copy backend requirements and install Python dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend from Stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create data directory for SQLite database
RUN mkdir -p /app/data && chown -R serverkit:serverkit /app/data

# Set ownership
RUN chown -R serverkit:serverkit /app

# Switch to non-root user
USER serverkit

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/api/v1/system/health || exit 1

# Working directory for the backend
WORKDIR /app/backend

# Default command - use gunicorn for production
CMD ["gunicorn", \
    "--worker-class", "geventwebsocket.gunicorn.workers.GeventWebSocketWorker", \
    "--workers", "1", \
    "--bind", "0.0.0.0:5000", \
    "--timeout", "120", \
    "--access-logfile", "-", \
    "--error-logfile", "-", \
    "run:app"]
