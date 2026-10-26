# Environment variables

Every environment variable the panel backend reads at runtime. Installer
options (`SERVERKIT_PROFILE`, `PANEL_DOMAIN`, `SERVERKIT_SKIP_SSL`, ...) are
covered in [INSTALLATION.md](INSTALLATION.md#install-options); this page is
about the running panel.

On a host install the values live in `/opt/serverkit/.env`, loaded by the
`serverkit-backend` systemd unit. With Docker they come from the compose file
or `docker run -e`. Restart the panel after changing one.

`backend/tests/test_environment_doc.py` fails when the backend reads a
variable that is not listed here.

## Core

| Variable | Default | Purpose |
|---|---|---|
| `FLASK_ENV` | `development` | `production` selects the production config, refuses the default secret keys or an empty `CORS_ORIGINS`, and auto-generates `SERVERKIT_ENCRYPTION_KEY` when it is missing. The systemd unit sets it. |
| `SECRET_KEY` | insecure dev value | Flask session signing. Must be set in production. |
| `JWT_SECRET_KEY` | insecure dev value | Signs access and refresh tokens. Changing it signs everyone out. |
| `DATABASE_URL` | `sqlite:////app/instance/serverkit.db` | SQLAlchemy URL (`sqlite:///...` or `postgresql://...`). In Docker see the compose note in INSTALLATION.md. |
| `LOG_LEVEL` | `INFO` (`DEBUG` in development) | Python logging level name (`DEBUG`, `INFO`, `WARNING`, ...). |
| `PORT` | `5000` | Port for `python run.py`. Gunicorn deployments bind with `-b` instead. |
| `SERVERKIT_THREADS` | `100` | Request threads in the single panel process (systemd unit and Docker image). Every open WebSocket (a browser tab or an agent) and every long-polling agent holds one for as long as it is connected, so the sum must stay under this with room for normal requests. Raise it for large fleets. |
| `SERVERKIT_PROFILE` | `standard` | Install profile (`minimal`, `standard`, `full`) when the panel setting has not overridden it. Written by the installer. |

## Network and proxy

| Variable | Default | Purpose |
|---|---|---|
| `CORS_ORIGINS` | local dev origins | Comma-separated allowed browser origins; required in production. `SERVERKIT_PUBLIC_URL` is added automatically. |
| `SERVERKIT_PUBLIC_URL` | unset | The URL browsers and agents use to reach the panel. Needed behind your own proxy or tunnel, or websocket handshakes are rejected on origin. |
| `TRUST_PROXY_HEADERS` | `false` | Trust `X-Forwarded-*` from the reverse proxy to find the real client IP. `true` behind the bundled nginx. See SECURITY.md. |
| `TRUSTED_PROXY_HOPS` | `1` | How many proxies sit in front of the panel. |
| `SERVERKIT_SSL_MODE` | read from `/etc/serverkit/ssl-mode`, else `insecure` | `secure` turns on HSTS. Only set it when the panel really serves end-to-end HTTPS. |
| `SITES_BASE_DOMAIN` | empty (`lvh.me` in development) | Managed sites are published at `<slug>.<domain>`. Empty falls back to `localhost:<port>` URLs. The panel setting overrides it. |
| `SERVER_PUBLIC_IP` | empty | IP that auto-created DNS records point at. |
| `SERVERKIT_ALLOW_PRIVATE_WEBHOOKS` | off | Let outgoing webhooks and event subscriptions reach private/internal addresses (the SSRF guard blocks them by default). |

## Security and secrets

| Variable | Default | Purpose |
|---|---|---|
| `SERVERKIT_ENCRYPTION_KEY` | generated on first production boot | Key for secrets stored in the database. Back it up: losing it makes stored credentials unreadable. |
| `SERVERKIT_ENV_FILE` | auto-detected | The `.env` file the generated encryption key is written to. |
| `AUTH_IP_MAX_ATTEMPTS` | `10` | Failed logins from one IP before it is blocked. |
| `AUTH_IP_WINDOW_MINUTES` | `15` | Window those attempts are counted in. |
| `AUTH_IP_BLOCK_MINUTES` | `15` | How long the IP stays blocked. |
| `RATELIMIT_STORAGE_URI` | in-memory | Rate-limit storage (e.g. `redis://...`). In-memory is correct for the single-worker panel. |
| `SERVERKIT_PASSKEY_RP_ID` | host of `BASE_URL`, else `localhost` | WebAuthn relying-party ID: the panel's domain. |
| `SERVERKIT_PASSKEY_ORIGIN` | `BASE_URL`, else `http://localhost` | Origin passkey ceremonies must come from. |
| `SERVERKIT_PASSKEY_RP_NAME` | `ServerKit` | Name shown in the authenticator prompt. |
| `BASE_URL` | unset | Fallback for the two passkey values above. |
| `PROMETHEUS_TOKEN` | unset | Extra bearer token accepted by the Prometheus scrape endpoint, besides the one the panel generates. |
| `SERVERKIT_SETUP_CODE` | generated | Pins the one-time code that the first admin registration requires, for automation. At least 12 characters. |
| `SERVERKIT_DEMO_MODE` | off | Reject every mutating API request, for a public read-only demo. Wins over the panel setting. |

## Paths

| Variable | Default | Purpose |
|---|---|---|
| `SERVERKIT_INSTALL_DIR` | `/opt/serverkit` | Where the panel is installed. The systemd unit sets it. |
| `SERVERKIT_DIR` | `/var/serverkit` | Data root (apps, deployments, imports). Also a lower-priority hint when locating `.env`. |
| `SERVERKIT_CONFIG_DIR` | `/etc/serverkit` | Panel configuration files. |
| `SERVERKIT_LOG_DIR` | `/var/log/serverkit` | Panel log directory. |
| `SERVERKIT_LOG_FILE` | unset | A panel log file to include in support bundles (the systemd unit logs to the journal). |
| `SERVERKIT_BACKUP_DIR` | `/var/backups/serverkit` | Update snapshots and backups. Must match `BACKUP_DIR` in `scripts/update.sh`. |
| `SERVERKIT_CACHE_DIR` | `/var/cache/serverkit` | Caches, including build-pack workspaces. |
| `BUILDPACK_WORKSPACE_DIR` | `$SERVERKIT_CACHE_DIR/buildpacks` | Where build packs stage sources. |
| `SERVERKIT_IMPORTS_DIR` | `$SERVERKIT_DIR/imports` | Uploaded site-migration archives. |
| `SERVERKIT_QUARANTINE_DIR` | `/var/quarantine` | Files the malware scanner quarantines. |
| `SERVERKIT_TMP_DIR` | `/tmp` | Temp directory disk reclaim cleans. |
| `SERVERKIT_LOCK_FILE` | `/var/lock/serverkit-update.lock` | Updater lock; slot retention waits while it is held. |
| `SERVERKIT_SCRIPTS_DIR` | `<repo>/scripts` | Where the agent installers are served from, for layouts that split the backend from the tree. |
| `VMAIL_DIR` | `/var/vmail` | Mailbox storage. |
| `NGINX_CONF_DIR` | `/etc/nginx` | nginx configuration root. |
| `SERVERKIT_WAF_DIR` | `/etc/nginx/serverkit-conf.d/waf` | Generated WAF rule files. |
| `SERVERKIT_OWASP_CRS_PATH` | `/usr/share/modsecurity-crs/owasp-crs.load` | OWASP CRS entrypoint the WAF rules include. |
| `SERVERKIT_MODSEC_AUDIT_LOG` | `/var/log/modsec_audit.log` | ModSecurity JSON audit log read for WAF events. |

## Binaries

| Variable | Default | Purpose |
|---|---|---|
| `NGINX_BIN` | `/usr/sbin/nginx` | nginx executable. |
| `CERTBOT_BIN` | found on `PATH` | certbot executable. |
| `NIXPACKS_BIN` | `nixpacks` | Optional nixpacks executable for opaque builds. |

## Extensions

| Variable | Default | Purpose |
|---|---|---|
| `SERVERKIT_BACKEND_PLUGINS_DIR` | `backend/app/plugins` | Where extension backends are installed. |
| `SERVERKIT_FRONTEND_PLUGINS_DIR` | `frontend/src/plugins` | Where extension frontends are installed. Docker panels must set it and mount the folder to install extensions that ship a UI. |
| `SERVERKIT_BUILTIN_EXTENSIONS_DIR` | `<repo>/builtin-extensions` | Bundled extensions offered for one-click install. |
| `SERVERKIT_GITHUB_TOKEN` | unset | GitHub token for extension downloads: lifts the anonymous rate limit and allows private repositories. Sent only to GitHub hosts over HTTPS. |
| `SERVERKIT_ALLOW_PRIVATE_DOWNLOADS` | off | Let extension downloads reach private addresses, for a private-network registry. |
| `SERVERKIT_ALLOW_PLUGIN_PIP` | off | Install an extension's `requirements.txt`. Off by default because pip runs with the panel's privileges and a `setup.py` is arbitrary code. |
| `SERVERKIT_TRUSTED_EXTENSION_KEYS` | unset | Path to an extra keys file trusted for extension signatures, beside the pinned first-party keys. |

## Integrations

| Variable | Default | Purpose |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379/0` | Optional Redis for the cache; the panel works without it. |
| `SERVERKIT_AGENT_GITHUB_REPO` | the official agent repository | Repository agent releases and installers are fetched from. |
| `SERVERKIT_CLOUD_URL` | the hosted service URL | Endpoint `serverkit connect` pairs with. A `--cloud` flag wins. |
| `LINKED_PANEL_ALLOWED_WRITE_ROOTS` | `/var/serverkit/apps,/etc/serverkit` | Comma-separated directories a master panel may write to when this panel runs as its linked worker. |
| `ANTHROPIC_BASE_URL` | unset | Not a panel setting: when set in the panel's process environment the native Claude driver would inherit it, so Claude connections refuse to run. Remove it, or configure a compatible-gateway connection instead. |

## Development and testing

| Variable | Default | Purpose |
|---|---|---|
| `SERVERKIT_SKIP_BACKGROUND` | off | Do not start background threads (metrics, queues, jobs). The updater sets it while running migrations. |
| `SERVERKIT_DEMO_DEPLOYS` | off | Enable scripted demo deployments that exercise the deploy console without Docker. |
| `SERVERKIT_PROFILE_REQUESTS` | off | Measure each API request's time and SQL query count, for local or staging profiling. No SQL text or parameters are recorded. |
| `SERVERKIT_STAGING` | off | Mark a staging instance; `/system/health` reports it. |
| `TEST_DATABASE_URL` | a per-process temp SQLite file | Database for the test suite (set by `tests/conftest.py` when unset). |
