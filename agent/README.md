# ServerKit Agent

A lightweight, cross-platform agent for remote server management. Connects to a ServerKit control plane to enable Docker management, system monitoring, and remote command execution.

## Features

- **Cross-Platform**: Supports Linux (amd64, arm64, arm), Windows (amd64, arm64), and macOS (amd64, arm64)
- **Lightweight**: Single binary, ~15MB RAM typical usage
- **Docker Integration**: Full Docker API access for container management
- **System Metrics**: Real-time CPU, memory, disk, and network monitoring
- **Secure Communication**: TLS encryption with HMAC-SHA256 authentication
- **Auto-Reconnect**: Automatic reconnection with exponential backoff
- **Self-Update**: Built-in update mechanism (coming soon)

## Quick Start

### Linux (One-liner)

```bash
curl -fsSL https://your-serverkit.com/install.sh | sudo bash -s -- \
  --token "sk_reg_your_token" \
  --server "https://your-serverkit.com"
```

### Windows (PowerShell as Administrator)

```powershell
irm https://your-serverkit.com/install.ps1 | iex
Install-ServerKitAgent -Token "sk_reg_your_token" -Server "https://your-serverkit.com"
```

### Docker (Recommended for containerized environments)

```bash
# Pull the image
docker pull serverkit/agent:latest

# Register the agent (one-time setup)
docker run --rm -v serverkit-agent-config:/etc/serverkit-agent \
  serverkit/agent:latest register \
  --token "sk_reg_your_token" \
  --server "https://your-serverkit.com"

# Start the agent
docker run -d --name serverkit-agent \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v serverkit-agent-config:/etc/serverkit-agent \
  serverkit/agent:latest
```

Or use Docker Compose:

```bash
# Clone and navigate to agent directory
cd agent

# Register (one-time setup)
docker compose run --rm agent register -s https://your-serverkit.com -t YOUR_TOKEN

# Start the agent
docker compose up -d

# View logs
docker compose logs -f
```

### Package Installation

**Debian/Ubuntu (.deb):**
```bash
curl -LO https://github.com/serverkit/serverkit/releases/latest/download/serverkit-agent_VERSION_amd64.deb
sudo dpkg -i serverkit-agent_VERSION_amd64.deb
sudo serverkit-agent register --token "YOUR_TOKEN" --server "https://your-serverkit.com"
sudo systemctl start serverkit-agent
```

**RHEL/CentOS/Fedora (.rpm):**
```bash
sudo rpm -i https://github.com/serverkit/serverkit/releases/latest/download/serverkit-agent-VERSION-1.x86_64.rpm
sudo serverkit-agent register --token "YOUR_TOKEN" --server "https://your-serverkit.com"
sudo systemctl start serverkit-agent
```

**Windows (.msi):**
Download and run the MSI installer from the releases page, then:
```powershell
serverkit-agent register --token "YOUR_TOKEN" --server "https://your-serverkit.com"
Start-Service ServerKitAgent
```

### Manual Installation

1. Download the appropriate binary for your platform from the releases page
2. Register the agent:
   ```bash
   ./serverkit-agent register --token "sk_reg_xxx" --server "https://your-serverkit.com"
   ```
3. Start the agent:
   ```bash
   ./serverkit-agent start
   ```

## Building from Source

### Prerequisites

- Go 1.21 or later
- Make (optional, for using Makefile)

### Build

```bash
# Clone the repository
git clone https://github.com/serverkit/agent.git
cd agent

# Download dependencies
go mod download

# Build for current platform
make build

# Or build for all platforms
make build-all
```

### Build Outputs

Binaries are placed in the `dist/` directory:
- `serverkit-agent-{version}-linux-amd64`
- `serverkit-agent-{version}-linux-arm64`
- `serverkit-agent-{version}-windows-amd64.exe`
- `serverkit-agent-{version}-darwin-amd64`
- `serverkit-agent-{version}-darwin-arm64`

## Usage

### Commands

```
serverkit-agent [command]

Available Commands:
  start       Start the agent service
  register    Register with a ServerKit instance
  status      Show agent status
  config      Configuration management
  version     Show version information
  help        Help about any command

Flags:
  -c, --config string   config file path
  -d, --debug           enable debug logging
  -h, --help            help for serverkit-agent
```

### Register

```bash
serverkit-agent register \
  --token "sk_reg_xxx" \
  --server "https://your-serverkit.com" \
  --name "my-server"
```

### Start

```bash
# Foreground
serverkit-agent start

# With debug logging
serverkit-agent start --debug
```

## Configuration

Configuration file location:
- **Linux**: `/etc/serverkit-agent/config.yaml`
- **Windows**: `C:\ProgramData\ServerKit\Agent\config.yaml`

### Example Configuration

```yaml
server:
  url: wss://your-serverkit.com/agent/ws
  reconnect_interval: 5s
  max_reconnect_interval: 5m
  ping_interval: 30s

agent:
  id: "auto-generated"
  name: "my-server"

features:
  docker: true
  metrics: true
  logs: true
  file_access: false
  exec: false

metrics:
  enabled: true
  interval: 10s
  include_per_cpu: true
  include_docker_stats: true

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
```

## Security

### Authentication

The agent uses HMAC-SHA256 signatures for authentication:
1. During registration, the agent receives an API key and secret
2. Each WebSocket connection is authenticated using HMAC-signed messages
3. Session tokens are issued after successful authentication

### Credentials Storage

Credentials are encrypted at rest using AES-256-GCM with a machine-specific key derived from:
- Hostname
- Machine ID (Linux) or computer/user name (Windows)

### Network Security

- All communication uses TLS (WSS)
- Certificate validation is enforced in production
- Replay attack protection via timestamps and nonces

## Systemd Service (Linux)

The installation script automatically creates a systemd service:

```bash
# Check status
systemctl status serverkit-agent

# View logs
journalctl -u serverkit-agent -f

# Restart
systemctl restart serverkit-agent
```

## Windows Service

On Windows, the agent runs as a Windows Service:

```powershell
# Check status
Get-Service ServerKitAgent

# View logs
Get-Content "C:\ProgramData\ServerKit\Agent\logs\agent.log" -Tail 50

# Restart
Restart-Service ServerKitAgent
```

## Docker Deployment

### Building the Image

```bash
cd agent

# Build with version info
docker build \
  --build-arg VERSION=1.0.0 \
  --build-arg BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ") \
  --build-arg GIT_COMMIT=$(git rev-parse --short HEAD) \
  -t serverkit/agent:latest .
```

### Running with Docker

```bash
# Register the agent first
docker run --rm \
  -v serverkit-agent-config:/etc/serverkit-agent \
  serverkit/agent:latest register \
  --token "sk_reg_xxx" \
  --server "https://your-serverkit.com" \
  --name "my-server"

# Run the agent
docker run -d \
  --name serverkit-agent \
  --restart unless-stopped \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v serverkit-agent-config:/etc/serverkit-agent \
  -v serverkit-agent-logs:/var/log/serverkit-agent \
  serverkit/agent:latest
```

### Running with Docker Compose

```yaml
# docker-compose.yml
services:
  agent:
    image: serverkit/agent:latest
    container_name: serverkit-agent
    restart: unless-stopped
    user: root
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - serverkit-config:/etc/serverkit-agent
      - serverkit-logs:/var/log/serverkit-agent
    environment:
      - TZ=UTC

volumes:
  serverkit-config:
  serverkit-logs:
```

```bash
# Register
docker compose run --rm agent register -s https://your-serverkit.com -t YOUR_TOKEN

# Start
docker compose up -d

# Logs
docker compose logs -f

# Stop
docker compose down
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TZ` | Timezone | `UTC` |

### Volumes

| Path | Description |
|------|-------------|
| `/etc/serverkit-agent` | Configuration and credentials |
| `/var/log/serverkit-agent` | Log files |
| `/var/run/docker.sock` | Docker socket (mount read-only) |

## Development

### Project Structure

```
agent/
├── cmd/agent/          # Main entry point
├── internal/
│   ├── agent/          # Core agent logic
│   ├── auth/           # HMAC authentication
│   ├── config/         # Configuration management
│   ├── docker/         # Docker client wrapper
│   ├── logger/         # Structured logging
│   ├── metrics/        # System metrics collection
│   └── ws/             # WebSocket client
├── pkg/protocol/       # Message protocol definitions
├── scripts/            # Build and install scripts
├── Makefile
└── go.mod
```

### Running Tests

```bash
make test
```

### Code Formatting

```bash
make fmt
```

## Troubleshooting

### Agent won't connect

1. Check the server URL is correct
2. Verify the registration token is valid
3. Check firewall allows outbound WebSocket connections
4. Review logs: `journalctl -u serverkit-agent -n 50`

### Docker commands fail

1. Ensure Docker is installed and running
2. Verify the agent user has Docker permissions:
   ```bash
   sudo usermod -aG docker serverkit-agent
   ```
3. Check Docker socket permissions

### High CPU/Memory usage

1. Increase the metrics interval in config
2. Disable per-CPU metrics if not needed
3. Check for log rotation issues

## License

MIT License - see LICENSE file for details.
