# Giving Claude Code Direct Access to Your Server via MCP

## The Problem

Your current workflow:
```
You → Push to GitHub → Wait → SSH to server → Pull → Test → Report back → Repeat
```

This is slow and error-prone. With MCP, it becomes:
```
You → Claude runs commands directly on server → Instant feedback
```

---

## What is MCP?

**MCP (Model Context Protocol)** is a way to give Claude Code access to external tools and resources. Think of it as plugins that extend what Claude can do.

For server access, you'd set up an MCP server that lets Claude:
- Run bash commands on your remote server
- Read/write files on the server
- Check Docker status, nginx configs, logs, etc.

---

## Option 1: SSH MCP Server (Recommended)

This creates an MCP server on your **local machine** that tunnels commands to your remote server via SSH.

### Step 1: Install the SSH MCP Server

```bash
# On your Windows machine (where Claude Code runs)
npm install -g @anthropic/mcp-ssh
```

Or use the community one:
```bash
npm install -g @yourdevops/mcp-server-ssh
```

### Step 2: Configure Claude Code

Add to your Claude Code MCP config file:

**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
**Or for Claude Code CLI:** `~/.claude/settings.json`

```json
{
  "mcpServers": {
    "serverkit-server": {
      "command": "npx",
      "args": [
        "-y",
        "@anthropic/mcp-ssh",
        "--host", "your-server-ip-or-hostname",
        "--user", "your-username",
        "--key", "C:\\Users\\Juan\\.ssh\\id_rsa"
      ]
    }
  }
}
```

### Step 3: SSH Key Setup (if not done)

```bash
# Generate SSH key (if you don't have one)
ssh-keygen -t ed25519 -C "claude-serverkit"

# Copy to server
ssh-copy-id user@your-server-ip

# Test connection
ssh user@your-server-ip "echo 'SSH works!'"
```

---

## Option 2: Run MCP Server Directly on Your Server

This runs an MCP server **on your Linux server** that Claude connects to.

### Step 1: Install on Server

```bash
# SSH into your server
ssh user@your-server

# Install Node.js if needed
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install MCP bash server
npm install -g @anthropic/mcp-server-bash
```

### Step 2: Create a Systemd Service

```bash
sudo nano /etc/systemd/system/mcp-serverkit.service
```

```ini
[Unit]
Description=MCP Server for ServerKit
After=network.target

[Service]
Type=simple
User=your-username
WorkingDirectory=/var/serverkit
ExecStart=/usr/bin/npx @anthropic/mcp-server-bash
Restart=on-failure
Environment=MCP_PORT=3100

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable mcp-serverkit
sudo systemctl start mcp-serverkit
```

### Step 3: Expose via SSH Tunnel (Secure)

Don't expose MCP directly to the internet. Use an SSH tunnel:

```bash
# On your Windows machine, create persistent tunnel
ssh -L 3100:localhost:3100 user@your-server -N
```

### Step 4: Configure Claude Code

```json
{
  "mcpServers": {
    "serverkit-server": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-client-proxy", "--port", "3100"]
    }
  }
}
```

---

## Option 3: Simple Bash MCP (Easiest)

Use the built-in bash MCP with SSH as the shell:

### Claude Code Settings

Add to `~/.claude/settings.json` or your project's `.claude/settings.json`:

```json
{
  "mcpServers": {
    "serverkit-server": {
      "command": "ssh",
      "args": [
        "-o", "StrictHostKeyChecking=no",
        "-i", "C:\\Users\\Juan\\.ssh\\id_rsa",
        "user@your-server-ip",
        "bash"
      ]
    }
  }
}
```

This is the simplest - it just opens an SSH session as an MCP tool.

---

## Security Considerations

| Risk | Mitigation |
|------|------------|
| Full server access | Create a dedicated user with limited sudo rights |
| SSH key exposure | Use a dedicated key, not your main one |
| Accidental destructive commands | Claude will ask before running dangerous commands |
| Network exposure | Always use SSH tunnels, never expose MCP directly |

### Create a Limited User (Recommended)

```bash
# On your server
sudo useradd -m -s /bin/bash claude-mcp
sudo usermod -aG docker claude-mcp  # For Docker access

# Limit sudo to specific commands
sudo visudo -f /etc/sudoers.d/claude-mcp
```

Add:
```
claude-mcp ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart nginx, /usr/bin/systemctl reload nginx, /usr/bin/nginx -t, /usr/bin/docker *, /usr/bin/docker-compose *
```

---

## What Claude Can Do With Server Access

Once configured, you can say things like:

- "Check if the Flask app container is running on the server"
- "Show me the nginx config for my-app"
- "Tail the nginx error logs for the last 50 lines"
- "Run docker ps and show me what's listening on port 8080"
- "Check why I'm getting 502 errors"
- "Deploy the latest changes from the repo"

---

## Quick Test

After setup, restart Claude Code and try:

```
"Use the serverkit-server to run: docker ps"
```

If configured correctly, I'll be able to run that command on your server and show you the output.

---

## Recommended MCP Packages

| Package | Purpose |
|---------|---------|
| `@anthropic/mcp-server-bash` | Run bash commands |
| `@anthropic/mcp-server-filesystem` | Read/write files |
| `@anthropic/mcp-server-docker` | Docker-specific operations |
| `@modelcontextprotocol/server-everything` | All-in-one server |

---

## Next Steps

1. Decide which option works best for you
2. Set up SSH key access to your server
3. Configure the MCP server
4. Restart Claude Code
5. Test with a simple command

Let me know which option you want to try and I can help you set it up step by step!
