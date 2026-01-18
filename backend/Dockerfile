# Backend Dockerfile for ServerKit
FROM python:3.11-slim-bookworm

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLASK_ENV=production \
    PORT=5000

# Set working directory
WORKDIR /app

# Install system dependencies including ClamAV for security scanning
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build dependencies
    gcc \
    python3-dev \
    libpq-dev \
    libffi-dev \
    libssl-dev \
    libevent-dev \
    # ClamAV antivirus
    clamav \
    clamav-daemon \
    clamav-freshclam \
    # Utilities
    curl \
    procps \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create directories for ServerKit
RUN mkdir -p /etc/serverkit /app/logs /var/quarantine

# Copy requirements first for caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir gunicorn gevent gevent-websocket

# Copy application code
COPY . .

# Create non-root user and set permissions
RUN useradd --create-home appuser \
    && chown -R appuser:appuser /app \
    && chown -R appuser:appuser /etc/serverkit \
    && chown -R appuser:appuser /var/quarantine

USER appuser

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:5000/api/v1/system/health || exit 1

# Run with gunicorn + gevent for WebSocket support
CMD ["gunicorn", "-k", "geventwebsocket.gunicorn.workers.GeventWebSocketWorker", \
     "-w", "1", "-b", "0.0.0.0:5000", "--timeout", "120", \
     "--access-logfile", "-", "--error-logfile", "-", \
     "run:app"]
