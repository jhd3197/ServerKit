#!/bin/bash
# Build .deb package for ServerKit Agent
# Usage: ./build.sh <version> <architecture> <binary_path>
# Example: ./build.sh 1.0.0 amd64 ../../dist/serverkit-agent-linux-amd64

set -e

VERSION="${1:-1.0.0}"
ARCH="${2:-amd64}"
BINARY_PATH="${3:-../../dist/serverkit-agent-linux-$ARCH}"
PACKAGE_NAME="serverkit-agent"
MAINTAINER="ServerKit <support@serverkit.dev>"
DESCRIPTION="ServerKit Agent - Remote server management agent"

# Map Go arch to Debian arch
case "$ARCH" in
    amd64) DEB_ARCH="amd64" ;;
    arm64) DEB_ARCH="arm64" ;;
    arm) DEB_ARCH="armhf" ;;
    *) DEB_ARCH="$ARCH" ;;
esac

echo "Building .deb package..."
echo "  Version: $VERSION"
echo "  Architecture: $DEB_ARCH"
echo "  Binary: $BINARY_PATH"

# Create build directory
BUILD_DIR="$(mktemp -d)"
PKG_DIR="$BUILD_DIR/${PACKAGE_NAME}_${VERSION}_${DEB_ARCH}"

# Create directory structure
mkdir -p "$PKG_DIR/DEBIAN"
mkdir -p "$PKG_DIR/usr/local/bin"
mkdir -p "$PKG_DIR/etc/serverkit-agent"
mkdir -p "$PKG_DIR/var/log/serverkit-agent"
mkdir -p "$PKG_DIR/lib/systemd/system"

# Copy binary
cp "$BINARY_PATH" "$PKG_DIR/usr/local/bin/serverkit-agent"
chmod 755 "$PKG_DIR/usr/local/bin/serverkit-agent"

# Create control file
cat > "$PKG_DIR/DEBIAN/control" << EOF
Package: $PACKAGE_NAME
Version: $VERSION
Section: admin
Priority: optional
Architecture: $DEB_ARCH
Maintainer: $MAINTAINER
Description: $DESCRIPTION
 ServerKit Agent connects your server to a ServerKit control plane,
 enabling remote Docker management, monitoring, and more.
 .
 Features:
  - Docker container management
  - System metrics collection
  - Secure WebSocket communication
  - Auto-reconnect with exponential backoff
Depends: ca-certificates
Suggests: docker-ce | docker.io
Homepage: https://github.com/serverkit/serverkit
EOF

# Create conffiles (list of config files that shouldn't be overwritten)
cat > "$PKG_DIR/DEBIAN/conffiles" << EOF
/etc/serverkit-agent/config.yaml
EOF

# Create systemd service file
cat > "$PKG_DIR/lib/systemd/system/serverkit-agent.service" << EOF
[Unit]
Description=ServerKit Agent
Documentation=https://github.com/serverkit/serverkit
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/serverkit-agent start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security hardening
NoNewPrivileges=false
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/etc/serverkit-agent /var/log/serverkit-agent

[Install]
WantedBy=multi-user.target
EOF

# Create default config file
cat > "$PKG_DIR/etc/serverkit-agent/config.yaml" << EOF
# ServerKit Agent Configuration
# This file is created during installation.
# Run 'serverkit-agent register' to configure the agent.

server:
  url: ""
  reconnect_interval: 5s
  max_reconnect_interval: 5m
  ping_interval: 30s

agent:
  id: ""
  name: ""

features:
  docker: true
  metrics: true
  logs: true
  file_access: false
  exec: false

metrics:
  enabled: true
  interval: 10s

docker:
  socket: /var/run/docker.sock
  timeout: 30s

logging:
  level: info
  file: /var/log/serverkit-agent/agent.log
  max_size_mb: 100
  max_backups: 5
  max_age_days: 30
  compress: true
EOF

# Create postinst script
cat > "$PKG_DIR/DEBIAN/postinst" << 'EOF'
#!/bin/bash
set -e

case "$1" in
    configure)
        # Reload systemd
        systemctl daemon-reload

        # Enable service (but don't start - user needs to register first)
        systemctl enable serverkit-agent.service || true

        echo ""
        echo "ServerKit Agent installed successfully!"
        echo ""
        echo "To complete setup:"
        echo "  1. Register the agent:"
        echo "     sudo serverkit-agent register --token YOUR_TOKEN --server https://your-serverkit.com"
        echo ""
        echo "  2. Start the service:"
        echo "     sudo systemctl start serverkit-agent"
        echo ""
        echo "  3. Check status:"
        echo "     sudo systemctl status serverkit-agent"
        echo ""
        ;;
esac

exit 0
EOF
chmod 755 "$PKG_DIR/DEBIAN/postinst"

# Create prerm script
cat > "$PKG_DIR/DEBIAN/prerm" << 'EOF'
#!/bin/bash
set -e

case "$1" in
    remove|upgrade)
        # Stop service
        systemctl stop serverkit-agent.service || true
        systemctl disable serverkit-agent.service || true
        ;;
esac

exit 0
EOF
chmod 755 "$PKG_DIR/DEBIAN/prerm"

# Create postrm script
cat > "$PKG_DIR/DEBIAN/postrm" << 'EOF'
#!/bin/bash
set -e

case "$1" in
    purge)
        # Remove config and log directories
        rm -rf /etc/serverkit-agent
        rm -rf /var/log/serverkit-agent
        ;;
    remove)
        # Reload systemd
        systemctl daemon-reload || true
        ;;
esac

exit 0
EOF
chmod 755 "$PKG_DIR/DEBIAN/postrm"

# Build the package
OUTPUT_DIR="${4:-./output}"
mkdir -p "$OUTPUT_DIR"
dpkg-deb --build --root-owner-group "$PKG_DIR" "$OUTPUT_DIR/${PACKAGE_NAME}_${VERSION}_${DEB_ARCH}.deb"

# Cleanup
rm -rf "$BUILD_DIR"

echo ""
echo "Package built successfully!"
echo "Output: $OUTPUT_DIR/${PACKAGE_NAME}_${VERSION}_${DEB_ARCH}.deb"
