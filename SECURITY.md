# Security Policy

## Supported Versions

ServerKit is under active development. Security fixes are applied to the latest
release line and the `main` branch.

| Version | Supported |
|---------|-----------|
| 1.7.x   | ✅ |
| < 1.7   | ❌ (please upgrade) |

The **agent** ships from its own repository, `jhd3197/serverkit-agent`, and is
versioned independently (`vX.Y.Z` — it used `agent-vX.Y.Z` while it lived in this
monorepo); always run a recent
agent build, as several Windows service and credential-handling fixes landed in
the 1.6.x line.

## Reporting a Vulnerability

Please report security issues **privately** — do not open a public issue for
anything exploitable.

- Preferred: [open a GitHub Security Advisory](https://github.com/jhd3197/ServerKit/security/advisories/new)
- We aim to acknowledge reports within a few days and to provide a remediation
  timeline after triage.

Please include affected version(s), reproduction steps, and impact. Coordinated
disclosure is appreciated — give us a reasonable window to ship a fix before any
public write-up.

## Agent Trust Model

The multi-server agent is powerful by design — operators should understand its
trust boundaries:

- **`agent.key` is a host-equivalent secret.** Agent API credentials are stored
  AES-256-GCM encrypted under a key derived from host-stable identifiers
  (hostname + machine ID on Linux, hostname + computer name on Windows). Because
  that key is derived only from values available on the host itself, the
  encryption is at-rest tamper-resistance / off-host-exfil protection (e.g. a
  leaked backup) — **not** confidentiality against a local root/SYSTEM user, who
  can re-derive the key. Anyone who can read this file on the host can recover
  the credentials. The `0600` file permissions are the real access control;
  protect it like a root/SYSTEM secret.
- **Remote command execution is gated.** Arbitrary command execution
  (`system:exec`) and interactive PTY sessions are controlled by the agent's
  `Features.Exec` flag, which is **off by default**. Enable it only on servers
  where you intend the panel to run shell commands.
- **Transport & connection controls.** Agents authenticate to the panel with
  per-connection HMAC-SHA256 (with nonce/replay protection and a timestamp-skew
  check), and the panel enforces a per-server IP allowlist. Use `wss://`
  (TLS-terminated) in production.
- **`SERVERKIT_INSECURE_TLS=true` disables certificate verification** for all
  agent connections. It is intended for local development/testing only — never
  set it in production.

For a deeper description of the panel's trust boundaries, see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## API Authentication

Panel API routes are JWT-only by default. A route accepts API keys only when it
explicitly opts in through the shared policy decorator (`auth_required()` in
`app/middleware/rbac.py`); the caller's identity always resolves through one
door, and API-key requests are attributed to the key's owner in the audit log.

## Client-IP Trust & Login Brute-Force

The panel keys several security decisions — rate-limit buckets, login lockout,
audit-log source IPs, API-key attribution, dynamic DNS — on the client's IP.
Behind a reverse proxy the raw socket peer is the proxy, and the real client
arrives in `X-Forwarded-For`. That header is **client-controlled**, so ServerKit
never hand-parses it. Instead it derives the client IP through one trusted seam
(Werkzeug `ProxyFix`, `app/utils/client_ip.py::get_client_ip`) gated by config:

| Variable | Default | Meaning |
|----------|---------|---------|
| `TRUST_PROXY_HEADERS` | `false` in code; `true` written by `install.sh` | Trust forwarding headers to derive the client IP. **Only where a reverse proxy is guaranteed in front.** Leave `false` for a directly-exposed server so headers can't be forged. |
| `TRUSTED_PROXY_HOPS` | `1` | Number of trusted proxy hops in front of Flask (bundled nginx = 1). Raise it only if you add another proxy (e.g. Cloudflare on top). |

The code default is `false` because a bare `create_app()` — a dev server, a test,
an import — has nothing in front of it. A **host install is different**: it always
serves the panel through its own nginx, and the systemd unit binds gunicorn to
`127.0.0.1`, so nothing can reach Flask without passing through that nginx and
`X-Forwarded-For` is ours. `install.sh` therefore writes `TRUST_PROXY_HEADERS=true`
and `TRUSTED_PROXY_HOPS=1` into `.env`, and backfills them on a re-run of an
install that predates this — without ever overriding a value you set yourself.

Two cases where the installer deliberately does **not** enable it:

- `SERVERKIT_BIND_HOST` set to anything but loopback. The raw backend port is then
  reachable directly, a client can connect without traversing nginx, and
  `X-Forwarded-For` becomes attacker-chosen. The installer says so and leaves it off.
- `SERVERKIT_EXTERNAL_PROXY=1` uses `TRUSTED_PROXY_HOPS=2` instead — your proxy
  appends the real client, then our nginx appends your proxy.

With trust on, `ProxyFix` takes the **rightmost** `TRUSTED_PROXY_HOPS` entries of
`X-Forwarded-For` — the hops your own proxies appended — so a forged *leftmost*
value is discarded. Setting a hop count higher than the real number of proxies,
or turning trust on for a directly-exposed panel, re-introduces spoofing — don't.

⚠️ If you run the panel some other way — the Docker image with the port published,
a custom unit, gunicorn by hand — you own this decision. Enable it only if a proxy
you control is the sole path in.

> **Behavior change:** audit-log source IPs now record the real client IP
> instead of the proxy's address. Update any dashboards or alerts that were built
> on the old (proxy-IP-or-forged) values.

On top of the per-user account lockout, a **per-IP login throttle** blocks a
client IP after repeated failed logins (also covering login-link redeem and 2FA
verification), returning `429` with `Retry-After`. This stops password-spraying
across many usernames from one source and prevents a single attacker draining
the shared login rate-limit for everyone. It is in-memory and relies on the
single-worker deployment (see the Deployment Note below).

| Variable | Default | Meaning |
|----------|---------|---------|
| `AUTH_IP_MAX_ATTEMPTS` | `10` | Failed auths from one IP within the window before it is blocked. |
| `AUTH_IP_WINDOW_MINUTES` | `15` | Rolling window for counting failures. |
| `AUTH_IP_BLOCK_MINUTES` | `15` | How long a blocked IP stays blocked. |

## Frontend HTML Sinks (XSS)

Raw-HTML sinks (`dangerouslySetInnerHTML`, `innerHTML =`, `insertAdjacentHTML`,
`new Function`, `eval`) must sit behind a sanitizer/escaper, and template output
on the backend (`|safe`, `Markup(`, `render_template_string`) is avoided in favor
of Jinja's default autoescaping. Today every sink is safe by construction:
extension icons pass through `sanitizeSvgInner`, assistant markdown through the
escape-then-allowlist `renderMarkdownToHtml`, and the SQL/file syntax tinting
escapes input before inserting its own token spans.

To keep the sweep swept, each sink must reference an allowlisted sanitizer **or**
carry a `sink-safe: <sanitizer> — <why>` comment. `scripts/check-html-sinks.mjs`
(run in `npm run lint`, and mirrored by `backend/tests/test_html_sink_sweep.py`)
fails CI on any new unannotated sink, so a raw-HTML injection point can't land
silently.

## Known Limitations

- **Tokens in `localStorage`.** The SPA keeps its JWT access/refresh tokens in
  `localStorage`, so an XSS bug would expose them. The production CSP now
  forbids inline and `eval` scripts (`script-src 'self'`) to reduce that risk;
  planned follow-up: move tokens to `httpOnly` `SameSite` cookies with CSRF protection.

## Extension Trust Model

Extensions are **in-process code**. An installed extension runs with the panel's
privileges, in the panel's interpreter, against the panel's database. Nothing in
ServerKit sandboxes it, and no permission string changes that. Everything below is
about making an extension's behaviour *legible* before and after you install it —
not about containing it. Treat installing an extension exactly as you would treat
running any other code as root on the box.

**Integrity — what the panel does verify.** First-party release zips are signed
(ed25519; the pinned public key ships in `backend/app/data/`), and the registry
index carries `signature` + `publisher_key_id`. Install verifies before extracting:
a **bad** signature is always a hard failure, an **unsigned** extension prompts for
consent rather than being blocked (third parties must remain installable), and the
verdict is stamped on the installed row and shown in the UI. Registry entries are
additionally pinned by sha256, so a swapped release asset fails the download.

**Permissions — what the panel does NOT enforce.** A manifest's `permissions` array
is a consent signal shown at install time. It is enforced only where a capability
*must* pass through the SDK gate, which today means `agent.command:<action>` and
nothing else. `docker`, `shell`, `filesystem`, `network` and `db` have no gated
helper — the SDK exposes none, and `db` is raw SQLAlchemy — so an extension using
them imports the host module directly and no in-process check is involved.

The extension detail page reflects that split rather than papering over it: it
records real use (and refusals) for the mediated capability, and for the rest it
says use **cannot be observed** instead of showing a zero count. A "never used"
badge on an unenforceable permission would imply a boundary that does not exist.

**Python dependencies** are not installed by default. pip would run with the
backend's privileges and a `setup.py` hook is arbitrary code, so a shipped
`requirements.txt` is saved for review and surfaced on the extension's page;
operators opt in with `SERVERKIT_ALLOW_PLUGIN_PIP=1`.

The practical controls, in order of how much they actually protect you: install
only extensions you have reason to trust, prefer signed first-party releases,
read the consent dialog, and keep the registry curated. See
[docs/EXTENSIONS.md](docs/EXTENSIONS.md) for the per-capability table.

## Deployment Note

The agent gateway keeps all connected-agent state in-memory in a single process.
Run the panel with a **single** gunicorn worker process (threaded worker,
`-w 1 --threads N` — not the gevent-websocket worker class); multi-worker
deployments can misroute agent commands. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
