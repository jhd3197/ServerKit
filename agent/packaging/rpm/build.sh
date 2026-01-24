#!/bin/bash
# Build .rpm package for ServerKit Agent
# Usage: ./build.sh <version> <architecture> <binary_path>
# Example: ./build.sh 1.0.0 x86_64 ../../dist/serverkit-agent-linux-amd64

set -e

VERSION="${1:-1.0.0}"
ARCH="${2:-x86_64}"
BINARY_PATH="${3:-../../dist/serverkit-agent-linux-amd64}"
PACKAGE_NAME="serverkit-agent"

# Map Go arch to RPM arch
case "$ARCH" in
    amd64) RPM_ARCH="x86_64" ;;
    arm64) RPM_ARCH="aarch64" ;;
    *) RPM_ARCH="$ARCH" ;;
esac

echo "Building .rpm package..."
echo "  Version: $VERSION"
echo "  Architecture: $RPM_ARCH"
echo "  Binary: $BINARY_PATH"

# Create build directory structure
BUILD_ROOT="$(mktemp -d)"
mkdir -p "$BUILD_ROOT"/{BUILD,RPMS,SOURCES,SPECS,SRPMS}

# Create source tarball
SOURCE_DIR="$BUILD_ROOT/SOURCES/serverkit-agent-$VERSION"
mkdir -p "$SOURCE_DIR"

# Copy binary
cp "$BINARY_PATH" "$SOURCE_DIR/serverkit-agent"

# Create systemd service file
cat > "$SOURCE_DIR/serverkit-agent.service" << EOF
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
cat > "$SOURCE_DIR/config.yaml" << EOF
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

# Create tarball
cd "$BUILD_ROOT/SOURCES"
tar -czvf "serverkit-agent-$VERSION.tar.gz" "serverkit-agent-$VERSION"
rm -rf "serverkit-agent-$VERSION"

# Create spec file
cat > "$BUILD_ROOT/SPECS/serverkit-agent.spec" << EOF
Name:           serverkit-agent
Version:        $VERSION
Release:        1%{?dist}
Summary:        ServerKit Agent - Remote server management agent

License:        MIT
URL:            https://github.com/serverkit/serverkit
Source0:        serverkit-agent-%{version}.tar.gz

BuildArch:      $RPM_ARCH
Requires:       ca-certificates

%description
ServerKit Agent connects your server to a ServerKit control plane,
enabling remote Docker management, monitoring, and more.

Features:
- Docker container management
- System metrics collection
- Secure WebSocket communication
- Auto-reconnect with exponential backoff

%prep
%setup -q

%install
rm -rf %{buildroot}

# Install binary
install -D -m 755 serverkit-agent %{buildroot}/usr/local/bin/serverkit-agent

# Install systemd service
install -D -m 644 serverkit-agent.service %{buildroot}/usr/lib/systemd/system/serverkit-agent.service

# Install config directory and default config
install -D -m 644 config.yaml %{buildroot}/etc/serverkit-agent/config.yaml

# Create log directory
install -d -m 755 %{buildroot}/var/log/serverkit-agent

%files
%attr(755, root, root) /usr/local/bin/serverkit-agent
%attr(644, root, root) /usr/lib/systemd/system/serverkit-agent.service
%config(noreplace) %attr(644, root, root) /etc/serverkit-agent/config.yaml
%dir %attr(755, root, root) /etc/serverkit-agent
%dir %attr(755, root, root) /var/log/serverkit-agent

%post
%systemd_post serverkit-agent.service

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

%preun
%systemd_preun serverkit-agent.service

%postun
%systemd_postun_with_restart serverkit-agent.service

if [ \$1 -eq 0 ]; then
    # Complete uninstall - remove config and logs
    rm -rf /etc/serverkit-agent 2>/dev/null || true
    rm -rf /var/log/serverkit-agent 2>/dev/null || true
fi

%changelog
* $(date '+%a %b %d %Y') ServerKit <support@serverkit.dev> - $VERSION-1
- Release $VERSION
EOF

# Build the RPM (disable build-id for Go binaries)
rpmbuild --define "_topdir $BUILD_ROOT" --define "_build_id_links none" -bb "$BUILD_ROOT/SPECS/serverkit-agent.spec"

# Copy output
OUTPUT_DIR="${4:-./output}"
mkdir -p "$OUTPUT_DIR"
cp "$BUILD_ROOT/RPMS/$RPM_ARCH"/*.rpm "$OUTPUT_DIR/"

# Cleanup
rm -rf "$BUILD_ROOT"

echo ""
echo "Package built successfully!"
echo "Output: $OUTPUT_DIR/"
ls -la "$OUTPUT_DIR"/*.rpm
