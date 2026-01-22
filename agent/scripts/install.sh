#!/bin/bash
#
# ServerKit Agent Installation Script
# Usage: curl -fsSL https://your-serverkit.com/install.sh | sudo bash -s -- --token "sk_reg_xxx"
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/serverkit-agent"
LOG_DIR="/var/log/serverkit-agent"
SERVICE_USER="serverkit-agent"
DOWNLOAD_URL=""  # Will be set by ServerKit server
TOKEN=""
SERVER_URL=""
NAME=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --token|-t)
            TOKEN="$2"
            shift 2
            ;;
        --server|-s)
            SERVER_URL="$2"
            shift 2
            ;;
        --name|-n)
            NAME="$2"
            shift 2
            ;;
        --download-url)
            DOWNLOAD_URL="$2"
            shift 2
            ;;
        --help|-h)
            echo "ServerKit Agent Installer"
            echo ""
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --token, -t TOKEN        Registration token (required)"
            echo "  --server, -s URL         ServerKit server URL (required)"
            echo "  --name, -n NAME          Server display name (optional)"
            echo "  --download-url URL       Custom download URL (optional)"
            echo "  --help, -h               Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate required arguments
if [ -z "$TOKEN" ]; then
    echo -e "${RED}Error: Registration token is required${NC}"
    echo "Usage: $0 --token TOKEN --server URL"
    exit 1
fi

if [ -z "$SERVER_URL" ]; then
    echo -e "${RED}Error: Server URL is required${NC}"
    echo "Usage: $0 --token TOKEN --server URL"
    exit 1
fi

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run as root"
        exit 1
    fi
}

# Detect OS and architecture
detect_platform() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)

    case $ARCH in
        x86_64|amd64)
            ARCH="amd64"
            ;;
        aarch64|arm64)
            ARCH="arm64"
            ;;
        armv7l|armhf)
            ARCH="arm"
            ;;
        *)
            log_error "Unsupported architecture: $ARCH"
            exit 1
            ;;
    esac

    log_info "Detected platform: $OS/$ARCH"
}

# Detect init system
detect_init_system() {
    if [ -d /run/systemd/system ]; then
        INIT_SYSTEM="systemd"
    elif [ -f /etc/init.d/cron ] && [ ! -d /run/systemd/system ]; then
        INIT_SYSTEM="sysvinit"
    else
        INIT_SYSTEM="unknown"
    fi
    log_info "Init system: $INIT_SYSTEM"
}

# Create service user
create_user() {
    if id "$SERVICE_USER" &>/dev/null; then
        log_info "Service user '$SERVICE_USER' already exists"
    else
        log_info "Creating service user '$SERVICE_USER'..."
        useradd --system --no-create-home --shell /bin/false "$SERVICE_USER"
    fi

    # Add user to docker group if it exists
    if getent group docker > /dev/null; then
        usermod -aG docker "$SERVICE_USER"
        log_info "Added $SERVICE_USER to docker group"
    fi
}

# Download the agent binary
download_agent() {
    if [ -z "$DOWNLOAD_URL" ]; then
        # Construct download URL from server
        DOWNLOAD_URL="${SERVER_URL}/downloads/agent/serverkit-agent-${OS}-${ARCH}"
    fi

    log_info "Downloading agent from $DOWNLOAD_URL..."

    # Try curl first, then wget
    if command -v curl &> /dev/null; then
        curl -fsSL -o /tmp/serverkit-agent "$DOWNLOAD_URL"
    elif command -v wget &> /dev/null; then
        wget -q -O /tmp/serverkit-agent "$DOWNLOAD_URL"
    else
        log_error "Neither curl nor wget is available"
        exit 1
    fi

    chmod +x /tmp/serverkit-agent
}

# Install the agent
install_agent() {
    log_info "Installing agent to $INSTALL_DIR..."

    # Stop existing service if running
    if [ "$INIT_SYSTEM" = "systemd" ] && systemctl is-active --quiet serverkit-agent; then
        log_info "Stopping existing agent service..."
        systemctl stop serverkit-agent
    fi

    # Install binary
    mv /tmp/serverkit-agent "$INSTALL_DIR/serverkit-agent"
    chmod 755 "$INSTALL_DIR/serverkit-agent"

    # Create directories
    mkdir -p "$CONFIG_DIR"
    mkdir -p "$LOG_DIR"
    chown "$SERVICE_USER:$SERVICE_USER" "$LOG_DIR"
}

# Register with ServerKit
register_agent() {
    log_info "Registering agent with ServerKit..."

    REGISTER_CMD="$INSTALL_DIR/serverkit-agent register --token \"$TOKEN\" --server \"$SERVER_URL\""
    if [ -n "$NAME" ]; then
        REGISTER_CMD="$REGISTER_CMD --name \"$NAME\""
    fi

    eval $REGISTER_CMD

    if [ $? -ne 0 ]; then
        log_error "Registration failed"
        exit 1
    fi

    # Set permissions on config
    chown -R "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR"
    chmod 600 "$CONFIG_DIR/config.yaml"
    chmod 600 "$CONFIG_DIR/agent.key"
}

# Install systemd service
install_systemd_service() {
    log_info "Installing systemd service..."

    cat > /etc/systemd/system/serverkit-agent.service << EOF
[Unit]
Description=ServerKit Agent
Documentation=https://github.com/serverkit/agent
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
ExecStart=$INSTALL_DIR/serverkit-agent start
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=serverkit-agent

# Security hardening
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$LOG_DIR $CONFIG_DIR
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable serverkit-agent
}

# Start the agent
start_agent() {
    log_info "Starting agent..."

    if [ "$INIT_SYSTEM" = "systemd" ]; then
        systemctl start serverkit-agent
        sleep 2
        if systemctl is-active --quiet serverkit-agent; then
            log_success "Agent is running"
        else
            log_error "Agent failed to start"
            journalctl -u serverkit-agent -n 20 --no-pager
            exit 1
        fi
    else
        log_warn "Please start the agent manually: $INSTALL_DIR/serverkit-agent start"
    fi
}

# Main installation flow
main() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     ServerKit Agent Installation         ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
    echo ""

    check_root
    detect_platform
    detect_init_system
    create_user
    download_agent
    install_agent
    register_agent

    if [ "$INIT_SYSTEM" = "systemd" ]; then
        install_systemd_service
    fi

    start_agent

    echo ""
    log_success "Installation complete!"
    echo ""
    echo "Agent Status: serverkit-agent status"
    echo "View Logs:    journalctl -u serverkit-agent -f"
    echo "Config File:  $CONFIG_DIR/config.yaml"
    echo ""
}

main
