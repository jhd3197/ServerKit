#!/bin/bash
#
# ServerKit Agent Installation Script
#
# ---------------------------------------------------------------------------
# CANONICAL SOURCE: jhd3197/serverkit-agent -> install.sh
#
# This file is VENDORED into the panel repo at ServerKit/scripts/install.sh,
# which is the copy the panel serves at GET /api/v1/servers/install.sh (it has
# to exist on the panel's own disk, so the panel cannot simply link to it).
#
# Edit it in the agent repo, then re-vendor with ServerKit's
# scripts/sync-agent-installers.sh. Do not patch one copy only: they silently
# drifted once already, and the panel spent that entire time serving an
# installer that downloaded from a tag scheme that no longer existed
# (ServerKit issue #101). ServerKit's nightly CI now fails on any drift.
# ---------------------------------------------------------------------------
#
# Usage (the panel serves this at /api/v1/servers/install.sh, not at the domain
# root -- the root of a ServerKit domain is the panel UI):
#   curl -fsSL https://your-serverkit.com/api/v1/servers/install.sh \
#     -o /tmp/serverkit-agent-install.sh \
#     && sudo bash /tmp/serverkit-agent-install.sh --token "TOKEN" --server "URL"
#
# Deliberately not `curl … | sudo bash`: a pipeline reports bash's exit status,
# not curl's, so a failed download exits 0 having installed nothing (issue #101).
#
# Options:
#   --token, -t     Registration token (required)
#   --server, -s    ServerKit server URL (required)
#   --name, -n      Display name for this server (optional)
#   --version, -v   Specific agent version to install (optional, defaults to latest)
#   --level, -l     Permission level: monitor | protect | full (see below)
#   --reconfigure   Allow changing the level of an already-installed agent
#   --yes, -y       Skip the typed confirmation when reconfiguring
#   --help, -h      Show this help message
#
# Permission levels: monitor = report-only (no inbound commands), protect =
# security actions only (firewall, fail2ban, CrowdSec, Cloudflare origin lock),
# full = everything. Omitted: a menu on a terminal; `full` (with a warning)
# when non-interactive, for compatibility with older install commands.
#

set -e

# Palette (truecolor violet gradient)
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ] && [ "${TERM:-dumb}" != "dumb" ]; then
  NC=$'\033[0m'; BOLD=$'\033[1m'
  fg() { printf '\033[38;2;%s;%s;%sm' "$1" "$2" "$3"; }
else
  NC=''; BOLD=''
  fg() { :; }
fi

V1="$(fg 196 181 253)"; V2="$(fg 167 139 250)"; V3="$(fg 139 92 246)"
V4="$(fg 124 58 237)"; V5="$(fg 109 40 217)"
WHITE="$(fg 237 233 254)"; MUTED="$(fg 165 160 190)"; FAINT="$(fg 113 108 140)"
GREEN="$(fg 52 211 153)"; RED="$(fg 248 113 113)"; YELLOW="$(fg 250 204 21)"
CYAN="$(fg 103 232 249)"

# Configuration
INSTALL_DIR="/usr/local/bin"
CONFIG_DIR="/etc/serverkit-agent"
LOG_DIR="/var/log/serverkit-agent"
SERVICE_USER="serverkit-agent"
# The agent publishes its own releases from its own repo, tagged plain `vX.Y.Z`.
# It used to live in the panel monorepo under `agent-v*` tags, and this script
# was never updated when it moved -- so every download 404'd against a tag scheme
# that no longer exists anywhere (ServerKit issue #101).
GITHUB_REPO="jhd3197/serverkit-agent"
AGENT_BINARY="serverkit-agent"

# Arguments
TOKEN=""
SERVER_URL=""
SERVER_NAME=""
VERSION="latest"
LEVEL=""
RECONFIGURE=false
ASSUME_YES=false

# Version injected by the panel when it serves this script (the panel already
# resolves the latest agent release for its update endpoints). Empty means
# discover the version via the GitHub API in get_latest_version().
SERVERKIT_AGENT_VERSION=""

print_banner() {
    echo
    printf "  ${V1}${BOLD}╔═╗┌─┐┌─┐┌┬┐┌─┐┬┌─┐${NC}\n"
    printf "  ${V2}${BOLD}╚═╗│ ││   │ ├┤ │├┤ ${NC}  ${WHITE}${BOLD}ServerKit Agent${NC}\n"
    printf "  ${V3}${BOLD}╚═╝└─┘└─┘ ┴ └─┘┴└──┘${NC}  ${FAINT}v%s${NC}\n" "$VERSION"
    echo
}

log_info() {
    echo -e "  ${CYAN}›${NC} $1"
}

log_success() {
    echo -e "  ${GREEN}●${NC} $1"
}

log_warn() {
    echo -e "  ${YELLOW}▲${NC} $1"
}

log_error() {
    echo -e "  ${RED}■${NC} $1"
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
    echo "  --level, -l     Permission level: monitor | protect | full (optional)"
    echo "  --reconfigure   Allow changing the level of an already-installed agent"
    echo "  --yes, -y       Skip the typed confirmation when reconfiguring"
    echo "  --help, -h      Show this help message"
    echo ""
    echo "Example:"
    echo "  curl -fsSL https://your-serverkit.com/api/v1/servers/install.sh \\"
    echo "    -o /tmp/serverkit-agent-install.sh \\"
    echo "    && sudo bash /tmp/serverkit-agent-install.sh \\"
    echo "    --token 'sk_reg_xxx' \\"
    echo "    --server 'https://your-serverkit.com'"
    exit 0
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --token|-t)
                [[ $# -ge 2 ]] || log_error "Option $1 requires a value"
                TOKEN="$2"
                shift 2
                ;;
            --server|-s)
                [[ $# -ge 2 ]] || log_error "Option $1 requires a value"
                SERVER_URL="$2"
                shift 2
                ;;
            --name|-n)
                [[ $# -ge 2 ]] || log_error "Option $1 requires a value"
                SERVER_NAME="$2"
                shift 2
                ;;
            --version|-v)
                [[ $# -ge 2 ]] || log_error "Option $1 requires a value"
                VERSION="$2"
                shift 2
                ;;
            --level|-l)
                [[ $# -ge 2 ]] || log_error "Option $1 requires a value"
                LEVEL="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
                shift 2
                ;;
            --reconfigure)
                RECONFIGURE=true
                shift
                ;;
            --yes|-y)
                ASSUME_YES=true
                shift
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

    if [[ -n "$LEVEL" ]]; then
        case "$LEVEL" in
            monitor|protect|full) ;;
            *) log_error "Unknown permission level '$LEVEL' (use monitor, protect or full)" ;;
        esac
    fi
}

# Level recorded in an existing config ("" when none; a config without the
# key is a legacy install, which means full).
installed_level() {
    local cfg="${CONFIG_DIR}/config.yaml"
    [[ -f "$cfg" ]] || return 0
    local lvl
    lvl="$(sed -n '/^permissions:/,/^[^ ]/ s/^[[:space:]]*level:[[:space:]]*//p' "$cfg" | head -n1 | tr -d "\"' \r")"
    printf '%s' "${lvl:-full}"
}

is_tty() { [[ -t 0 && -t 1 ]]; }

# Refuse to silently change the level of an installed agent; --reconfigure
# plus a typed confirmation (or --yes) is required.
check_reconfigure() {
    local current
    current="$(installed_level)"
    [[ -n "$current" ]] || return 0
    if [[ -z "$LEVEL" ]]; then
        LEVEL="$current"
        return 0
    fi
    [[ "$LEVEL" != "$current" ]] || return 0
    if [[ "$RECONFIGURE" != true ]]; then
        log_error "This agent is already installed at level '$current'. Re-run with --reconfigure to change it to '$LEVEL'."
    fi
    if [[ "$ASSUME_YES" != true ]]; then
        local answer=""
        if is_tty; then
            read -r -p "  Changing level ${current} -> ${LEVEL}. Type '${LEVEL}' to confirm: " answer
        fi
        [[ "$answer" == "$LEVEL" ]] || log_error "Confirmation did not match; permission level unchanged (use --yes for scripted use)"
    fi
    CHANGE_LEVEL_FROM="$current"
}

# Pick a level when none was given: menu on a terminal, else full + warning.
resolve_level() {
    [[ -z "$LEVEL" ]] || return 0
    if is_tty; then
        echo ""
        echo "  Choose what this agent may do on this server:"
        echo "    1) monitor  report-only, accepts no commands from the panel"
        echo "    2) protect  security actions only (firewall, fail2ban, CrowdSec, origin lock)"
        echo "    3) full     everything (docker, files, terminal, packages, ...)"
        local choice=""
        read -r -p "  Selection [1-3]: " choice
        case "$choice" in
            1|monitor) LEVEL=monitor ;;
            2|protect) LEVEL=protect ;;
            3|full) LEVEL=full ;;
            *) log_error "Invalid selection" ;;
        esac
    else
        log_warn "No --level given and no terminal: defaulting to FULL control. Pass --level monitor|protect|full to choose."
        LEVEL=full
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
    if [[ "$VERSION" != "latest" ]]; then
        return 0
    fi

    # The panel injects the version it already resolved when serving this
    # script — use it and keep GitHub out of the enrollment path entirely.
    if [[ -n "$SERVERKIT_AGENT_VERSION" ]]; then
        VERSION="$SERVERKIT_AGENT_VERSION"
        log_info "Using panel-resolved version: v${VERSION}"
        return 0
    fi

    log_info "Fetching latest version..."

    # Every release in the agent repo is an agent release, so the first vX.Y.Z
    # tag is the one we want. The paging kept from the monorepo era costs one
    # extra request at most and covers a repo with many pre-release tags.
    #
    # The `[0-9]` is load-bearing: the repo carries a malformed release literally
    # tagged "v", which would otherwise parse to an empty VERSION and send the
    # download at .../releases/download/v/serverkit-agent--linux-amd64.tar.gz.
    local page releases
    VERSION=""
    for page in 1 2 3; do
        releases=$(curl -fsSL "https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100&page=${page}") || break
        VERSION=$(printf '%s\n' "$releases" | grep -o '"tag_name": *"v[0-9][^"]*"' | head -1 | sed -e 's/.*"v//' -e 's/"$//') || true
        [[ -n "$VERSION" ]] && break
        # A page with no tags at all means the release list is exhausted.
        printf '%s' "$releases" | grep -q '"tag_name"' || break
    done

    if [[ -z "$VERSION" ]]; then
        log_error "Failed to fetch latest version"
    fi
    log_info "Latest version: v${VERSION}"
}

# Verify the downloaded archive against the release's checksums.txt.
# Best-effort when checksums.txt is unavailable (older releases); a present-
# but-mismatching checksum is a hard failure.
verify_checksum() {
    local tmp_dir="$1" asset_name="$2"
    local checksums_url="https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/checksums.txt"

    if ! command -v sha256sum &> /dev/null; then
        log_warn "sha256sum not available — skipping checksum verification"
        return 0
    fi

    if ! curl -fsSL "$checksums_url" -o "${tmp_dir}/checksums.txt"; then
        log_warn "Could not download checksums.txt — skipping verification"
        return 0
    fi

    if ! grep -q "$asset_name" "${tmp_dir}/checksums.txt"; then
        log_warn "checksums.txt has no entry for ${asset_name} — skipping verification"
        return 0
    fi

    if ! (cd "$tmp_dir" && sha256sum -c <(grep "$asset_name" checksums.txt) >/dev/null 2>&1); then
        rm -rf "$tmp_dir"
        log_error "Checksum verification FAILED for ${asset_name} — aborting install"
    fi

    log_success "Checksum verified"
}

download_agent() {
    log_info "Downloading ServerKit Agent v${VERSION}..."

    ASSET_NAME="serverkit-agent-${VERSION}-linux-${ARCH}.tar.gz"
    DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/${ASSET_NAME}"
    TMP_DIR=$(mktemp -d)
    ARCHIVE="${TMP_DIR}/${ASSET_NAME}"

    if ! curl -fsSL "$DOWNLOAD_URL" -o "$ARCHIVE"; then
        rm -rf "$TMP_DIR"
        log_error "Failed to download agent from: $DOWNLOAD_URL"
    fi

    verify_checksum "$TMP_DIR" "$ASSET_NAME"

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
        if command -v useradd &> /dev/null; then
            useradd -r -s /bin/false -d /nonexistent "$SERVICE_USER"
        elif command -v adduser &> /dev/null; then
            # Alpine/busybox ships adduser instead of useradd
            adduser -S -D -H -s /bin/false "$SERVICE_USER"
        else
            log_error "Cannot create user: neither useradd nor adduser found"
        fi
    fi

    # Add to docker group if it exists
    if getent group docker > /dev/null 2>&1; then
        if command -v usermod &> /dev/null; then
            usermod -aG docker "$SERVICE_USER"
        else
            # busybox equivalent of usermod -aG
            addgroup "$SERVICE_USER" docker
        fi
        log_info "Added $SERVICE_USER to docker group"
    fi
}

create_config_dir() {
    log_info "Creating configuration and log directories..."
    mkdir -p "$CONFIG_DIR" "$LOG_DIR"
    chown "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR" "$LOG_DIR"
    chmod 750 "$CONFIG_DIR" "$LOG_DIR"
}

register_agent() {
    log_info "Registering agent with ServerKit..."

    REGISTER_CMD=(
        "${INSTALL_DIR}/${AGENT_BINARY}"
        --config "${CONFIG_DIR}/config.yaml"
        register
        --token "${TOKEN}"
        --server "${SERVER_URL}"
    )

    if [[ -n "$SERVER_NAME" ]]; then
        REGISTER_CMD+=(--name "${SERVER_NAME}")
    fi
    REGISTER_CMD+=(--level "${LEVEL}")

    # Re-installing at a different level: apply it locally first so the
    # register step sees a consistent config.
    if [[ -n "${CHANGE_LEVEL_FROM:-}" ]]; then
        "${INSTALL_DIR}/${AGENT_BINARY}" --config "${CONFIG_DIR}/config.yaml" \
            permissions set "${LEVEL}" --yes >/dev/null 2>&1 || true
    fi

    if ! "${REGISTER_CMD[@]}"; then
        log_error "Agent registration failed"
    fi

    # Fix permissions on config files
    chown -R "$SERVICE_USER:$SERVICE_USER" "$CONFIG_DIR" "$LOG_DIR"
    [[ -f "${CONFIG_DIR}/config.yaml" ]] && chmod 600 "${CONFIG_DIR}/config.yaml"
    [[ -f "${CONFIG_DIR}/agent.key" ]] && chmod 600 "${CONFIG_DIR}/agent.key"

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
ExecStart=${INSTALL_DIR}/${AGENT_BINARY} --config ${CONFIG_DIR}/config.yaml start
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=serverkit-agent

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${CONFIG_DIR} ${LOG_DIR}
PrivateTmp=true
ProtectKernelLogs=yes
ProtectKernelModules=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryMax=512M
LimitNOFILE=65535

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
        echo "  ${INSTALL_DIR}/${AGENT_BINARY} --config ${CONFIG_DIR}/config.yaml start"
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
    echo -e "${YELLOW}Permission level: ${LEVEL^^}${NC}"
    case "$LEVEL" in
        monitor) echo "  Report-only: this agent sends metrics out and accepts NO commands." ;;
        protect) echo "  Security actions only (firewall, fail2ban, CrowdSec, origin lock)." ;;
        *)       echo "  Full control: the panel can run any supported action." ;;
    esac
    echo "  Change it (as root, on this machine only):"
    echo "    ${INSTALL_DIR}/${AGENT_BINARY} permissions set <monitor|protect|full>"
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
    check_reconfigure
    resolve_level
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

# Sourcing this file (e.g. from scripts/test/test_agent_install.sh) defines
# every function above for unit testing without running an install. Piped
# execution (curl | bash) has no BASH_SOURCE[0], so only a real `source`
# takes the early return.
if [ -n "${BASH_SOURCE[0]:-}" ] && [ "${BASH_SOURCE[0]}" != "$0" ]; then
    return 0
fi

main "$@"
