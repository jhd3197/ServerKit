# ServerKit Agent - Docker Image
# Multi-stage build for minimal image size

# ============================================
# Stage 1: Build
# ============================================
FROM golang:1.21-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /build

# Copy go mod files first for better layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build arguments for version info
ARG VERSION=dev
ARG BUILD_TIME=unknown
ARG GIT_COMMIT=unknown

# Build the agent binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s \
        -X main.Version=${VERSION} \
        -X main.BuildTime=${BUILD_TIME} \
        -X main.GitCommit=${GIT_COMMIT}" \
    -o serverkit-agent \
    ./cmd/agent

# ============================================
# Stage 2: Runtime
# ============================================
FROM alpine:3.19

# Install runtime dependencies
RUN apk add --no-cache \
    ca-certificates \
    tzdata \
    docker-cli \
    docker-cli-compose

# Create non-root user
RUN addgroup -g 1000 serverkit && \
    adduser -u 1000 -G serverkit -s /bin/sh -D serverkit

# Create directories
RUN mkdir -p /etc/serverkit-agent /var/log/serverkit-agent && \
    chown -R serverkit:serverkit /etc/serverkit-agent /var/log/serverkit-agent

# Copy binary from builder
COPY --from=builder /build/serverkit-agent /usr/local/bin/serverkit-agent

# Set permissions
RUN chmod +x /usr/local/bin/serverkit-agent

# Volume for configuration persistence
VOLUME ["/etc/serverkit-agent"]

# Volume for logs
VOLUME ["/var/log/serverkit-agent"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD serverkit-agent status || exit 1

# Labels
LABEL org.opencontainers.image.title="ServerKit Agent" \
      org.opencontainers.image.description="Remote server management agent for ServerKit" \
      org.opencontainers.image.vendor="ServerKit" \
      org.opencontainers.image.source="https://github.com/serverkit/serverkit"

# Default user (can be overridden for Docker socket access)
USER serverkit

ENTRYPOINT ["serverkit-agent"]
CMD ["start"]
