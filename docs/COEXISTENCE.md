# Running ServerKit alongside another control panel

> Plan 27. The honest answer to "can this panel manage / migrate my existing
> box?" — including what it will and won't do while another panel is still in
> charge.

ServerKit has three explicit adoption modes. Pick the one that matches where the
box is today; you can move between them as you migrate.

## 1. Observe — read-only, safe to run anywhere

Install the agent on any Linux box, **including one still run by another control
panel**, and set the server to **Observed**. You get:

- **Metrics** — CPU / memory / disk / network, like any paired server.
- **A read-only survey ("flight")** — a map of what's running: web servers and
  their virtual hosts (domain → document root / upstream), databases, TLS
  certificates, cron jobs, listening ports, and a flag if another control panel
  is detected. See the read-only guarantees below.
- **Doctor probes** — the read-only health checks.
- **Backups** of paths you explicitly point at.

You do **not** get, by design:

- Site creation or web-server config writes.
- Any mutating server-targeted action. These are refused server-side — the
  server list and detail page show an **Observed** chip and a read-only banner,
  and the agent command choke point returns a clean refusal rather than letting
  two panels fight over the same files. Every refusal is recorded in the
  server's audit trail, and the Survey tab shows a **blocked-commands counter**.
- Agent binary updates. Observe mode covers the agent itself: `agent:update` is
  refused too, so observing never silently re-flashes the box. If you *do* want
  to keep the agent current while observing, set the per-server **"allow agent
  updates while observing"** break-glass on the Survey tab — an explicit,
  audited opt-in, off by default.

What an Observed server still allows (all reads): system metrics/info/processes,
Docker/compose *list/inspect/logs/stats*, file *read/list* within allowed paths,
the survey, doctor probes, `agent:recapabilities` (capability re-discovery), and
backups of paths you point at.

**Why the hard line:** two panels writing the same web-server config (nginx /
Apache vhosts, PHP-FPM pools, TLS) will overwrite each other and eventually
break the site. That scenario is **never supported**. Observe mode exists
precisely so you can adopt a box for visibility without stepping on the panel
that currently owns its config.

Detection only ever **suggests**. If the survey finds another panel's marker,
ServerKit shows a one-click "switch to Observed" prompt — it never flips a
managed server automatically, and it never downgrades an existing managed box.

### The survey's read-only guarantees

The survey is driven by a shipped, versioned **probe catalog** you can read in
full (the Survey tab's "What we check" view lists every location verbatim). The
agent enforces the trust boundary with a **fixed allowlist of read-only
primitives** — file-exists, glob, unit status, socket list, process list, and
parse-light extraction of a few config directives (`server_name`, `root`,
`proxy_pass`, and equivalents). Concretely:

- **Credential and environment files are listed by path only — never read.**
- No file contents leave the box beyond those parse-light directive lines.
- The catalog can only combine those primitives; it can never name a command to
  run. A compromised panel can at worst enumerate paths — never execute.

Full agent contract: [`AGENT_SURVEY_SPEC.md`](AGENT_SURVEY_SPEC.md).

## 2. Migrate — the guided path off the other panel

When you're ready to move a site onto ServerKit:

1. **Survey** the box (Observe mode) so you can see every site, its document
   root, and its databases.
2. **Import** each site. From the Survey tab, "Migrate this site" pre-fills the
   import wizard with the domain and document root. Imports cover **files +
   MySQL databases + database users (password hashes preserved) + crontabs** —
   from a control-panel backup archive, or a live pull over SSH for panel-less
   boxes. **Mail accounts and DNS zones are not migrated** (they stay on the
   source until moved separately).
3. **Verify on ServerKit** using a staging domain / basic-auth before touching
   public DNS; WordPress sites get the URL-swap tool for post-move URL fixes.
4. **DNS cutover, reversible per domain.** Before changing any record, ServerKit
   snapshots the domain's existing records (name / type / content / TTL). Lower
   the TTL a step ahead, switch the record, verify propagation, and **revert
   from the snapshot** in one click if anything looks wrong.
5. **Decommission.** Once every surveyed site is migrated, ServerKit shows a
   checklist: what to stop on the old box, what to keep until TTLs expire, and
   when it's safe to wipe.

## Adopt in place — a site that already runs on this server

Sometimes the site is already here: set up by hand, by a script, or by a
migration that wrote its own nginx and PHP-FPM config. It serves traffic, but
ServerKit has no record of it, so it gets no monitoring, backups, SSL status or
logs — while its database may well be listed under Databases.

Adopting registers such a site **as it is**. ServerKit reads the live nginx
config, the PHP-FPM pools, the certificate and (for WordPress) `wp-config.php`,
then records a service, its domains and its database link. **It writes nothing
to the server**: the vhost, the pool, the certificate and the files stay
exactly as they are. The database password is never read.

```bash
serverkit adopt-site                      # every site nginx serves, and its state
serverkit adopt-site example.com          # dry run: what would be recorded
serverkit adopt-site example.com --apply  # register it
```

In the panel, **Services** shows an **Adopt** button whenever this server is
serving sites that are not managed yet, and the doctor reports each one.

What adoption covers:

| Site | Adopted as |
|------|------------|
| nginx + PHP-FPM | a PHP service (any installed PHP version, any pool) |
| nginx + PHP-FPM + `wp-config.php` | a WordPress service, with its database linked |
| nginx serving files | a static service |
| nginx proxying to a port | not adopted here — register the process behind it as a Docker Compose or systemd service |

An adopted service is **host-managed**. ServerKit observes and records it but
never rewrites or removes its config:

- Adding or removing a domain updates the record only. Edit the vhost yourself.
- Start, stop and restart are refused: the site is served by the server's
  shared nginx and PHP-FPM, and there is no per-site runtime to control.
- Deleting the service forgets it. The site keeps serving.

### Migrating a site onto this server by hand

If you move a site yourself instead of using the import wizard, finish by
adopting it so the migration does not bypass ServerKit:

1. **Copy the files** to their document root and set ownership to the PHP-FPM
   pool user.
2. **Copy the database**: create the database and user, import the dump, and
   point the site's config at it.
3. **Write the nginx vhost and PHP-FPM pool**, then `nginx -t` and reload. Keep
   the ACME location ahead of any dotfile deny:
   `location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }`.
4. **Check it on a preview hostname** (or a hosts-file entry) before touching
   public DNS.
5. **Issue the certificate** once the name resolves here, or use a DNS
   challenge to issue it ahead of the cutover.
6. **Cut DNS over**: lower the TTL a step ahead, switch the record, verify, and
   keep the old server up until the old TTL has expired.
7. **Adopt the site**: `serverkit adopt-site <domain> --apply`.

## 3. Manage — full takeover on a clean box

Today's normal mode: ServerKit owns the box and manages the web stack end to
end. This is the right mode for a fresh server, or for one you've finished
migrating off its previous panel and cleaned up.

## What is never supported

- **Two panels writing the same web-server config.** Keep exactly one owner of
  nginx/Apache/PHP-FPM/TLS per box. Use Observe (read-only) until ServerKit is
  that single owner.
- Mail and DNS-zone *migration* are not part of v1 imports (the future path is
  the mail extension + DNS zone rails).
