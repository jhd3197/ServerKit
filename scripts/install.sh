#!/bin/bash
#
# ServerKit Agent Installation Script
#
# Usage:
#   curl -fsSL https://your-serverkit.com/install.sh | sudo bash -s -- --token "TOKEN" --server "URL"
#
# Options:
#   --token, -t     Registration token (required)
#   --server, -s    ServerKit server URL (required)
#   --name, -n      Display name for this server (optional)
#   --version, -v   Specific agent version to install (optional, defaults to latest)
#   --help, -h      Show this help message
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/serverkit"
SERVICE_USER="serverkit"
GITHUB_REPO="serverkit/serverkit"
AGENT_BINARY="serverkit-agent"

# Arguments
TOKEN=""
SERVER_URL=""
SERVER_NAME=""
VERSION="latest"

print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║               ServerKit Agent Installer                    ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

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
    exit 1
}

show_help() {
    echo "ServerKit Agent Installation Script"
    echo ""
    echo "Usage: install.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --token, -t     Registration token (required)"
    echo "  --server, -s    ServerKit server URL (required)"
    echo "  --name, -n      Display name for this server (optional)"
    echo "  --version, -v   Specific agent version (optional, defaults to latest)"
    echo "  --help, -h      Show this help message"
    echo ""
    echo "Example:"
    echo "  curl -fsSL https://your-serverkit.com/install.sh | sudo bash -s -- \\"
    echo "    --token 'sk_reg_xxx' \\"
    echo "    --server 'https://your-serverkit.com'"
    exit 0
}

parse_args() {
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
                SERVER_NAME="$2"
                shift 2
                ;;
            --version|-v)
                VERSION="$2"
                shift 2
                ;;
            --help|-h)
                show_help
                ;;
            *)
                log_error "Unknown option: $1"
                ;;
        esac
    done

    # Validate required arguments
    if [[ -z "$TOKEN" ]]; then
        log_error "Registration token is required. Use --token or -t"
    fi

    if [[ -z "$SERVER_URL" ]]; then
        log_error "Server URL is required. Use --server or -s"
    fi
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
    fi
}

detect_platform() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)

    case "$ARCH" in
        x86_64|amd64)
            ARCH="amd64"
            ;;
        aarch64|arm64)
            ARCH="arm64"
            ;;
        *)
            log_error "Unsupported architecture: $ARCH"
            ;;
    esac

    if [[ "$OS" != "linux" ]]; then
        log_error "This script only supports Linux. For Windows, use install.ps1"
    fi

    log_info "Detected platform: ${OS}-${ARCH}"
}

check_dependencies() {
    log_info "Checking dependencies..."

    # Check for required tools
    for cmd in curl tar; do
        if ! command -v "$cmd" &> /dev/null; then
            log_error "$cmd is required but not installed"
        fi
    done

    # Check for systemd
    if ! command -v systemctl &> /dev/null; then
        log_warn "systemd not found. You will need to start the agent manually."
    fi
}

get_latest_version() {
    if [[ "$VERSION" == "latest" ]]; then
        log_info "Fetching latest version..."
        VERSION=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases" | \
            grep -oP '"tag_name": "agent-v\K[^"]+' | head -1)

        if [[ -z "$VERSION" ]]; then
            log_error "Failed to fetch latest version"
        fi
        log_info "Latest version: v${VERSION}"
    fi
}

download_agent() {
    log_info "Downloading ServerKit Agent v${VERSION}..."

    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/agent-v${VERSION}/serverkit-agent-${VERSION}-linux-${ARCH}.tar.gz"
    TMP_DIR=$(mktemp -d)
    ARCHIVE="${TMP_DIR}/serverkit-agent.tar.gz"

    if ! curl -fsSL "$DOWNLOAD_URL" -o "$ARCHIVE"; then
        rm -rf "$TMP_DIR"
        log_error "Failed to download agent from: $DOWNLOAD_URL"
    fi

    # Extract binary
    log_info "Extracting agent..."
    tar -xzf "$ARCHIVE" -C "$TMP_DIR"

    # Install binary
    mv "${TMP_DIR}/serverkit-agent-linux-${ARCH}" "${INSTALL_DIR}/${AGENT_BINARY}"
    chmod +x "${INSTALL_DIR}/${AGENT_BINARY}"

    # Cleanup
    rm -rf "$TMP_DIR"

    log_success "Agent installed to ${INSTALL_DIR}/${AGENT_BINARY}"
}

create_user() {
    if id "$SERVICE_USER" &>/dev/null; then
        log_info "User $SERVICE_USER already exists"
    else
        log_info "Creating service user: $SERVICE_USER"
        useradd -r -s /bin/false -d /nonexistent "$SERVICE_USER"
    fi

    # Add to docker group if it exists
    if getent group docker > /dev/null 2>&1; then
        usermod -aG docker "$SERVICE_USER"
        log_info "Added $SERVICE_USER to docker group"
    fi
}

create_config_dir() {
    log_info "Creating configuration directory..."
    mkdir -p "$CONFIG_DIR"
    chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR"
    chmod 750 "$CONFIG_DIR"
}

register_agent() {
    log_info "Registering agent with ServerKit..."

    REGISTER_CMD="${INSTALL_DIR}/${AGENT_BINARY} register --token \"${TOKEN}\" --server \"${SERVER_URL}\""

    if [[ -n "$SERVER_NAME" ]]; then
        REGISTER_CMD="${REGISTER_CMD} --name \"${SERVER_NAME}\""
    fi

    if ! eval "$REGISTER_CMD"; then
        log_error "Agent registration failed"
    fi

    # Fix permissions on config files
    chown -R "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR"

    log_success "Agent registered successfully"
}

install_systemd_service() {
    if ! command -v systemctl &> /dev/null; then
        log_warn "Skipping systemd service installation (systemd not found)"
        return
    fi

    log_info "Installing systemd service..."

    cat > /etc/systemd/system/serverkit-agent.service << EOF
[Unit]
Description=ServerKit Agent
Documentation=https://github.com/${GITHUB_REPO}
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
ExecStart=${INSTALL_DIR}/${AGENT_BINARY} start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=serverkit-agent

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${CONFIG_DIR}
PrivateTmp=true

# Environment
Environment=HOME=/nonexistent

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable serverkit-agent

    log_success "Systemd service installed"
}

start_service() {
    if ! command -v systemctl &> /dev/null; then
        log_warn "Cannot auto-start without systemd"
        echo ""
        echo "To start the agent manually:"
        echo "  ${INSTALL_DIR}/${AGENT_BINARY} start"
        return
    fi

    log_info "Starting ServerKit Agent..."
    systemctl start serverkit-agent

    sleep 2

    if systemctl is-active --quiet serverkit-agent; then
        log_success "Agent is running"
    else
        log_error "Failed to start agent. Check logs with: journalctl -u serverkit-agent"
    fi
}

print_success() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║          Installation completed successfully!             ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Agent Status:"
    echo "  Binary:     ${INSTALL_DIR}/${AGENT_BINARY}"
    echo "  Config:     ${CONFIG_DIR}/config.yaml"
    echo "  Service:    serverkit-agent"
    echo ""
    echo "Useful commands:"
    echo "  Check status:    systemctl status serverkit-agent"
    echo "  View logs:       journalctl -u serverkit-agent -f"
    echo "  Restart agent:   systemctl restart serverkit-agent"
    echo "  Stop agent:      systemctl stop serverkit-agent"
    echo ""
}

# Main execution
main() {
    print_banner
    parse_args "$@"
    check_root
    detect_platform
    check_dependencies
    get_latest_version
    download_agent
    create_user
    create_config_dir
    register_agent
    install_systemd_service
    start_service
    print_success
}

main "$@"
