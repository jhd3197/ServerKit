# Agent permission levels

Each ServerKit agent runs at one of three levels. The level is chosen **on the
server**, enforced **by the agent**, and merely *reported* to the panel.

| Level | What it can do | What it cannot do |
|-------|----------------|-------------------|
| **Monitor** (default for new installs) | Send CPU / memory / disk / uptime / load and service checks (web server, PHP-FPM, database, disk, CPU, memory) to the panel with signed outbound HTTPS POSTs. Opens no inbound command channel. | Run any command, open a terminal, touch files, Docker, packages or services. The panel cannot send it anything. |
| **Protect** | Everything in Monitor, plus a fixed security allowlist: firewall (ufw) rules, fail2ban, CrowdSec decisions, Cloudflare origin lock (restrict 80/443 to Cloudflare ranges). | Docker, shell, files, terminal, packages, systemd, cron, SSH keys, WireGuard, runtimes, agent updates. |
| **Full** | Today's behaviour: the whole agent feature set. Legacy installs with no level configured are treated as Full. | — |

## Install

The Add Server drawer shows the level picker and puts the choice in the command:

```bash
curl -fsSL https://panel.example.com/api/v1/servers/install.sh -o /tmp/serverkit-agent-install.sh \
  && sudo bash /tmp/serverkit-agent-install.sh --token "TOKEN" --server "https://panel.example.com" --level monitor
```

```powershell
irm https://panel.example.com/api/v1/servers/install.ps1 | iex; Install-ServerKitAgent -Token "TOKEN" -Server "https://panel.example.com" -Level monitor
```

The installer scripts under `scripts/` are vendored from the agent repo
(`scripts/sync-agent-installers.sh`); `--level` / `-Level` arrives with the next sync.

## Changing the level

Only on the server itself, as root, with a typed confirmation:

```bash
serverkit-agent permissions show
sudo serverkit-agent permissions set protect
```

There is no panel button or API for this, by design. Re-running `install.sh` with a
different `--level` on an installed box refuses unless `--reconfigure` is passed.

## What the panel does

- Records the level the agent reports (registration, auth, heartbeat, report). Every
  change, escalations included, is written to the audit log and shown in the server
  timeline. The Add Server flow remembers the *requested* level so a mismatch with
  the reported one is visible.
- Monitor agents POST to `/api/v1/agent/report` (HMAC over timestamp, nonce and body
  hash; 300 s skew; single-use nonces; 64 KB cap; per-IP+key rate limit). A monitor
  server with no report for max(3 minutes, 3 x its interval) is marked offline.
- Opens an alert (existing fleet alerts + notification channels) when a server goes
  offline or stops reporting and when a service check goes down; it resolves on
  recovery and does not repeat while the condition persists.
- Refuses to dispatch a command the reported level forbids (`LEVEL_DENIED`,
  "server is in Monitor mode: ..."). This is defence in depth; the agent enforces
  the same table. The table lives in `backend/app/services/permission_levels.py`.

Protect allowlist (checked against the panel table by a test):

```text allowlist
firewall:allow_port firewall:deny_port firewall:status
firewall:allow_ip firewall:deny_ip
fail2ban:status fail2ban:ban fail2ban:unban
crowdsec:decisions:list crowdsec:ban crowdsec:unban
cloudflare:origin_lock:status cloudflare:origin_lock:apply cloudflare:origin_lock:remove
```

`credential_update` (signature-verified key rotation) is allowed at every level.

## Threat model

The level is read only from the agent's local config at startup; no message from
the panel can change it. A compromised panel therefore **cannot escalate** a Monitor
agent: it has no channel to send commands to, and the report reply never carries any.
The panel's own gate only narrows what it will send. Someone with root on the box
can still change the level, which is the intended re-confirmation path, and the
panel audits the resulting change. A compromised panel can lie in the UI, but
cannot make a Monitor agent act.

## Demo data

`python backend/scripts/seed_permission_demo.py` (never run automatically) creates five
demo servers for the dev sandbox. It is idempotent.
