# Changelog

Notable changes to the ServerKit control panel (Flask backend and React frontend),
organized by published release using [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

This history was backfilled on 2026-09-07 from the
[published GitHub releases](https://github.com/jhd3197/ServerKit/releases) and the
commits between their tags. Dates are GitHub publication dates in UTC. Each
version heading links to its release; each comparison links to the source changes.
Summaries describe changes introduced in that release, not a guarantee that later
versions retain the same interface or architecture.

Coverage starts at **1.6.25**, the earliest published panel release available for
this backfill. It is a baseline, not the project's first commit. Version bumps
without a published release are included in the next published release's range.
Earlier development history remains in
[Git history](https://github.com/jhd3197/ServerKit/commits/v1.6.25/).
The [agent](https://github.com/jhd3197/serverkit-agent/releases) has its own
release history; historical `agent-v*` tags are not panel releases.

## [1.11.1] - Unreleased

### Added

- Publish active applications, domains, deployments, and managed databases to
  ServerKit Cloud, with optional process diagnostics and selected log sources.
- Publish dev prerelease builds for the Cloud release lab from a separate,
  push-only release job.

### Fixed

- Require explicit consent before sending diagnostics or collecting logs, and
  redact structured secrets and short authorization credentials locally.
- Recover unacknowledged log batches within their byte and expiry limits;
  continue past oversized lines and drain deployment logs across batches.
- Exclude recycled resources, strip credentials from repository metadata,
  reject symlinked log files, and use the primary domain for WordPress admin links.
- Preserve repeated application log occurrences and read the production panel
  error log.
- Fix backend test-factory compliance and the settings browser-test timing race.
- Update the demo link in all four README translations.

[Source changes since 1.11.0](https://github.com/jhd3197/ServerKit/compare/v1.11.0...v1.11.1).

## [1.11.0] - 2026-09-08

### Added

- Configure connection-bound AI task models, routing strategies and guarded
  fallbacks through the AI Assistant settings.
- Set spending and generation limits, and inspect AI usage with user and
  workspace accounting.
- Add browser coverage for AI management and shared settings interfaces.

### Fixed

- Refresh the bundled extension registry and generated API inventories.
- Normalize usage-report user and workspace filters before quota calculations.
- Raise the clean-checkout backend test floor from 5,110 to 5,205 tests.

[Source changes since 1.10.0](https://github.com/jhd3197/ServerKit/compare/v1.10.0...v1.11.0).

## [1.10.0] - 2026-09-08

### Added

- Save named AI provider connections with encrypted credentials, a default
  connection, and a connection/model selector for new chats. Existing chats
  retain their original connection and model.
- Discover Prompture providers and gateway models, including OmniRoute,
  Prompture Hub and LM Studio, and test connections with a real chat request.
- Use Prompture 1.11 native gateway streaming and tool calls while preserving
  exact model IDs and routing aliases.

### Fixed

- Serve the runtime-extension vendor shims (`/serverkit-vendor/*.mjs`) as
  `text/javascript` from the shipped nginx vhosts. Stock nginx has no `.mjs`
  MIME entry and returned `application/octet-stream`, so every runtime-loaded
  extension (WordPress, Git, Mail, Fail2ban, ...) failed with "Failed to fetch
  dynamically imported module: blob:..." on fresh installs.
- Exclude SQLite database files from the updater's install-tree snapshot so
  the dedicated database backup does not duplicate them.

[Source changes since 1.9.29](https://github.com/jhd3197/ServerKit/compare/v1.9.29...v1.10.0).

## [1.9.29] - 2026-09-08

### Fixed

- Evaluate fleet alert thresholds every minute and send opened/resolved alerts
  to administrators through the notification bus.
- Preserve memory, disk and network measurements from agent heartbeats through
  the shared metrics writer.
- Report actual metrics-history retention and coverage instead of silently
  returning partial results for longer requested windows.
- Use database-specific time buckets so aggregated metrics work on SQLite as
  well as PostgreSQL.
- Send the caller's redirect URI on the Bitbucket OAuth authorize hop so the
  flow returns to the panel origin it started from, matching the token
  exchange (PR #139).
- Resolve application logs and metrics from the recorded runtime container
  before falling back to Compose files and name matching, and render JSON log
  lines as readable structured entries (PR #136).
- Keep remote application log requests on their assigned server instead of
  looking up the recorded container on the panel host.
- Avoid restarting service metrics requests when unrelated application metadata
  refreshes.
- Close the container inspector when opening Logs or Exec so it can no longer
  cover those surfaces (PR #137).

[Source changes since 1.9.28](https://github.com/jhd3197/ServerKit/compare/v1.9.28...v1.9.29).

## [1.9.28] - 2026-09-05

### Fixed

- Backfilled users.auth_version during upgrades so existing users can still log in.
- Cleared stale service metrics when runtimes change, kept the Docker inspector clear of action buttons, and restored Settings table surfaces.

### Security

- Enforced MFA, scoped API keys and revocable sessions; tightened authorization for Socket.IO subscriptions, event delivery and AI resource access.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.25...v1.9.28).

## [1.9.25] - 2026-09-05

### Added

- Reported agent identifiers to ServerKit Cloud and added repository parameters to development-only simulated deployments.

### Fixed

- Repaired GitHub App manifest setup, responsive navigation and the database toolbar.
- Replaced corrupted IBM Plex Sans assets and changed metrics-history requests to avoid content blockers.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.24...v1.9.25).

## [1.9.24] - 2026-09-03

### Added

- Added CLI pairing with ServerKit Cloud, an outbound relay connection, periodic metrics summaries, backup-destination configuration and signed client updates.
- Added commands encrypted to the server's own key and reporting of server policy capabilities.

### Fixed

- Dispatched the connect CLI command correctly; made doctor and lifecycle commands read the frontend layout from nginx.
- Preserved frontend image assets in release tarballs.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.22...v1.9.24).

## [1.9.22] - 2026-09-01

### Fixed

- Prevented bundled but uninstalled extensions from rendering through the legacy plugin loader.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.21...v1.9.22).

## [1.9.21] - 2026-09-01

### Added

- Added optional walkthrough guides, extension-contributed walkthroughs and the Walkthrough Studio extension, with translations across 16 locales.

### Fixed

- Restored start, stop and restart for Docker apps without a Compose project while retaining Compose as the default deployment path.
- Prevented browser-driver postinstall downloads from filling the build disk.
- Made application purge reclaim all ServerKit-managed app directories and corrected walkthrough step completion and selection.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.18...v1.9.21).

## [1.9.18] - 2026-09-01

### Changed

- Indexed foreign-key columns to improve related-record lookups.

### Fixed

- Fixed application purge failures caused by dependent database rows; repaired deletion cascades and added an orphan-cleanup migration.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.17...v1.9.18).

## [1.9.17] - 2026-08-31

### Added

- Added one-click panel updates from Settings → About, with translations.

### Fixed

- Served Vite build output with a static server that accepts the deployed hostname.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.15...v1.9.17).

## [1.9.15] - 2026-08-31

### Fixed

- Kept Node development dependencies when a build-pack application has a build step, so build tools remain available.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.14...v1.9.15).

## [1.9.14] - 2026-08-31

### Changed

- Moved Git, Email Server, Cloudflare Zone Ops and LocalKit extension sources into standalone repositories.

### Fixed

- Passed declared build inputs when deploying repository templates.
- Handled null status-page request bodies, escaped values in Telegram alerts and made overlapping security-posture installs safe.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.11...v1.9.14).

## [1.9.11] - 2026-08-31

**Upgrade note:** The extracted security tools and self-hosted Git interface now
require their matching extensions. Review the installed extensions after updating.

### Changed

- Moved ClamAV/YARA, Fail2ban, Lynis, automatic security updates and container-image scanning into installable extensions; added minimal, recommended and hardened setup choices.
- Moved self-hosted Gitea management into the Git extension and relocated Email Server and Cloudflare Zone Ops frontends into their extensions.

### Fixed

- Showed template validation errors in the deploy drawer and directed app-name conflicts with deleted apps to the Recycle Bin.
- Refreshed the bundled extension catalog.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.10...v1.9.11).

## [1.9.10] - 2026-08-29

### Added

- Added policy-driven replica scaling for local Compose apps, a WordPress shared-state contract and edge login rate limiting.
- Added an extension connection-provider contract and optional Redis-backed rate-limit storage.

### Fixed

- Applied the domain selected in the template deploy drawer, included attached volumes in capacity checks, and corrected scaling-policy rollback and null handling.
- Fixed distro compatibility probes and raised modals above the shell status bar.

### Security

- Hardened nginx configuration writes and certificate issuance; enabled trust for the signed first-party extension catalog.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.9...v1.9.10).

## [1.9.9] - 2026-08-28

### Fixed

- Made environment-variable export/import lossless and resistant to injected content.
- Corrected cron line matching, SSH-key deletion IDs, restricted authorized-key parsing, firewall parsing and Postfix address matching.
- Placed WAF includes in the serving nginx block and preserved them during drift repair.
- Guarded PHP pool paths and restored the Observed server-mode interface.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.7...v1.9.9).

## [1.9.7] - 2026-08-26

### Added

- Added server restore points, checkpoint lifecycle APIs and a combined restore timeline.

### Fixed

- Preserved frontend assets in release builds and allowed clearing an environment variable's description.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.9.5...v1.9.7).

## [1.9.5] - 2026-08-22

### Added

- Added guided operator walkthroughs, resumable recipes and recipe catalog installation.
- Added disk-space reclamation in the panel and a creation palette with recipe shortcuts.

### Changed

- Redesigned the application shell and File Manager; combined operational tools and the AI assistant in a tabbed shell console.

### Fixed

- Made smooth scrolling respect reduced-motion preferences and protected recipe handoff secrets through encrypted storage.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.130...v1.9.5).

## [1.7.130] - 2026-08-22

### Added

- Added authorized resource attachments to AI chat, capability-aware resource pickers and editable dashboards with undo history.
- Added a shared operations dock for run progress and service logs, plus the serverkit disk command.

### Fixed

- Bounded updater disk use and added retention for job telemetry.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.125...v1.7.130).

## [1.7.125] - 2026-08-21

### Fixed

- Prevented tab-overflow navigation from crashing routes and consolidated error-state rendering.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.124...v1.7.125).

## [1.7.124] - 2026-08-21

### Added

- Added further language bundles for the localized panel.

### Changed

- Made releases immutable and required passing checks for main-branch promotions.

### Fixed

- Restored Appearance settings rendering and corrected backend locale ordering.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.121...v1.7.124).

## [1.7.121] - 2026-08-21

### Added

- Completed Spanish translations and converted remaining user-visible panel text to translation keys.

### Fixed

- Corrected translated labels and sentence composition, and updated Settings links in the AI drawer and Docker gate.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.119...v1.7.121).

## [1.7.119] - 2026-08-20

### Added

- Added per-user language preferences, a language selector, locale-aware formatting and translated authentication, onboarding and shell text.
- Shared localization support with extensions and checked extension SDK compatibility at installation.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.116...v1.7.119).

## [1.7.116] - 2026-08-20

### Security

- Required an explicit authorization decision for every mutating route and restricted workspace creation to administrators.
- Rejected unsigned webhooks as unauthenticated.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.113...v1.7.116).

## [1.7.113] - 2026-08-19

### Added

- Added managed databases to the Recycle Bin and reported host specification changes and filesystem inventory.
- Added firewall safeguards against enabling rules that cut off SSH or deleting the last SSH-access rule.

### Fixed

- Distinguished unavailable measurements and failed health probes from zero usage, healthy status or successful backup verification.
- Recorded caught API, webhook and queue failures in monitoring; fixed error-page request races.
- Reconciled agent tunnels on both transports and made server selection workspace-aware.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.105...v1.7.113).

## [1.7.105] - 2026-08-18

### Added

- Added Monitoring → Errors with filters, a detail drawer, deduplicated backend exceptions and frontend error reporting.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.104...v1.7.105).

## [1.7.104] - 2026-08-16

### Changed

- Added consistent JSON API error handlers and application logging.

### Fixed

- Shipped agent installers in the Docker image, downloaded agents from the separate serverkit-agent repository and corrected release lookup.
- Made enrollment commands fail visibly on download errors; returned server errors when installer assets are missing.
- Restored the offline extension catalog and corrected its checksums.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.99...v1.7.104).

## [1.7.99] - 2026-08-14

### Added

- Added SERVERKIT_EXTERNAL_PROXY and SERVERKIT_CONFIG installer configuration.

### Fixed

- Restored panel Docker startup and nginx startup when PANEL_DOMAIN is configured.
- Fixed Debian 13 installation with Python 3.13, upgraded SQLAlchemy for compatibility and prevented unattended apt prompts.
- Corrected trusted client-IP handling for host installs.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.95...v1.7.99).

## [1.7.95] - 2026-08-14

### Added

- Added deployment preflight checks before stopping the live application, fleet doctor integration and extension permission/dependency visibility.
- Added default-deny firewall and Fail2ban setup, plus a reusable Let's Encrypt contact.

### Fixed

- Made backup repair actions functional and distinguished queued repairs from completed ones.
- Detected conflicting AAAA records before certificate issuance, improved certbot discovery and corrected nginx health reporting.
- Fixed the File Manager Web config shortcut and surfaced email installation errors.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.94...v1.7.95).

## [1.7.94] - 2026-08-13

### Added

- Added chat-notification connection editing, testing and default selection.

### Fixed

- Redacted notification transport errors, rejected null updates and limited credential re-encryption to changed fields.
- Wrote extension manifests with consistent LF newlines.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.91...v1.7.94).

## [1.7.91] - 2026-08-13

### Added

- Added saved table views, shareable view links, multi-column sorting, column visibility, grouping, keyboard navigation and bulk selection.
- Added the Recycle Bin with application and domain restore/purge, favorites, recent visits and quick-create actions.

### Fixed

- Preserved HTTPS when domains change and restored domain nginx configuration from the Recycle Bin.
- Reduced SQLite locking with WAL and busy timeouts; stopped overlapping pollers and coalesced duplicate API requests.

### Security

- Closed Git argument injection in repository URLs, application paths and branches (GHSA-8vx6-432p-h62q).

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.83...v1.7.91).

## [1.7.83] - 2026-08-06

### Added

- Added extension-install deep links.

### Fixed

- Returned users to their intended page after login and tightened redirect validation.
- Corrected the default template repository and verified downloaded template content.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.82...v1.7.83).

## [1.7.82] - 2026-08-06

### Added

- Added extension signature verification, publisher keys, signature badges and installation consent.
- Expanded the extension SDK with UI primitives and providers for backups, templates and event types.

### Fixed

- Restored curl-pipe installation under strict shell variable checking.

### Security

- Hardened extension downloads, update consent and hook registration.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.81...v1.7.82).

## [1.7.81] - 2026-08-04

### Security

- Closed resource-access and authorization gaps in deployment jobs, vaults, queues, Docker and databases; enforced app access on deployment reads.
- Updated the cryptography dependency.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.79...v1.7.81).

## [1.7.79] - 2026-08-03

### Changed

- Updated README variants with a demo-video badge. This release contains documentation changes only.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.78...v1.7.79).

## [1.7.78] - 2026-08-03

### Added

- Added daily GitHub security-advisory checks with admin notifications and capacity-aware setup profiles.

### Security

- Blocked File Manager access to panel-internal paths and corrected protected-root matching (GHSA-rm3m-9mvw-68fh).

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.76...v1.7.78).

## [1.7.76] - 2026-07-29

### Changed

- Rebuilt cron creation as a drawer with the shared schedule picker and added a consistent standalone-page layout.

### Fixed

- Resolved a page-shell CSS name collision and corrected schedule-picker styling and drawer padding.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.75...v1.7.76).

## [1.7.75] - 2026-07-28

### Added

- Added Monitors and Incidents pages and promoted status checks to first-class monitors.

### Changed

- Rebuilt the cron list using the shared list-page layout.

### Fixed

- Separated TLS certificate checks from the monitor polling clock and corrected monitoring layout defects.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.74...v1.7.75).

## [1.7.74] - 2026-07-27

### Fixed

- Used SQLite's online backup API for consistent pre-upgrade snapshots and pg_dump for PostgreSQL installations.
- Selected the backup engine from DATABASE_URL, verified backups, added automatic restoration on failure and capped retention.
- Recognized prebuilt virtual environments with unquoted VIRTUAL_ENV assignments.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.68...v1.7.74).

## [1.7.68] - 2026-07-26

### Fixed

- Hardened updater migrations against startup side effects and virtual-environment mismatches; distinguished database corruption from probe failure.

### Security

- Enforced files.read and files.write permissions in the File Manager (GHSA-4wqh-7f4f-5qmx).
- Prevented hostname command injection in Postfix installation and removed shell interpolation from the syslog unit filter (GHSA-mc93-rc3x-fpgq).

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.65...v1.7.68).

## [1.7.65] - 2026-07-26

### Added

- Added persistent, rearrangeable dashboard boards and widget editing.
- Expanded database tools with engine installation, table creation, dump import and engine-extension management.
- Added template capacity checks, deployment retry, console focus mode and a severity map; refreshed Services, Templates, Backups and Monitoring interfaces.
- Expanded extension support for fleet commands, backups, doctor checks, search, storage and deployment jobs.

### Fixed

- Restored MariaDB inspection, service logs and usage metrics; corrected Compose v1 flag handling.
- Made privileged commands non-interactive with timeouts and reduced panel image size and AI startup overhead.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.59...v1.7.65).

## [1.7.59] - 2026-07-23

### Added

- Added the theme gallery, live preview, theme import, registry browsing, a panel default and Theme Studio.
- Bundled 11 Venezuelan-inspired themes.

### Fixed

- Validated theme previews and improved theme token wiring and registry caching.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.56...v1.7.59).

## [1.7.56] - 2026-07-23

### Fixed

- Made serverkit update recognize an updater script even when it is not executable.

### Security

- Bound extension review stamps to package hashes, exposed trust levels and hid unreviewed entries outside development mode.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.53...v1.7.56).

## [1.7.53] - 2026-07-23

### Added

- Added the full-page Deploy Console with live logs, asynchronous deployment jobs, retry and links from deployment activity.
- Delivered runtime ESM extension frontends to production panels and added a Minecraft extension foundation.

### Security

- Added a guard against unsafe HTML rendering sinks.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.51...v1.7.53).

## [1.7.51] - 2026-07-22

### Changed

- Moved linked-panel setup into a third tab in the Add Server drawer.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.49...v1.7.51).

## [1.7.49] - 2026-07-22

### Fixed

- Accepted Compose file paths returned by linked panels when resolving project locations.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.48...v1.7.49).

## [1.7.48] - 2026-07-22

### Added

- Added ServerKit-to-ServerKit peering through embedded agent mode.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.47...v1.7.48).

## [1.7.47] - 2026-07-22

### Added

- Exposed LocalKit site and sync capabilities during pairing.

### Fixed

- Fixed template installs stuck at zero progress and deployed repository apps when created.
- Kept relative template files in the build context instead of treating them as host bind mounts, and pinned Prompture Hub to a published version.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.45...v1.7.47).

## [1.7.45] - 2026-07-21

### Added

- Added resumable LocalKit transfers, chunked pushes and code pulls.
- Added an installation test sandbox.

### Changed

- Used the serverkit.ai extension index by default and included catalog logos.

### Fixed

- Included target-server names in deployment jobs and hardened installation scripts.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.43...v1.7.45).

## [1.7.43] - 2026-07-20

### Added

- Added the LocalKit bridge and an analytics extension with collection, reporting, tracking snippets and WordPress/nginx integration.

### Changed

- Moved seven builtin extensions into standalone repositories, unified loading skeletons and made newly created environment variables secret by default.

### Security

- Added per-IP login throttling and explicit trusted-proxy handling for client addresses.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.40...v1.7.43).

## [1.7.40] - 2026-07-16

### Changed

- Refreshed the ServerKit logo.

### Fixed

- Placed page-title updates inside the authentication provider.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.39...v1.7.40).

## [1.7.39] - 2026-07-16

### Changed

- Made prebuilt release updates the default so servers do not need Node to rebuild the panel.
- Moved status pages, remote access, cloud provisioning and FTP backends into extensions; added recommended extension installation during setup.

### Fixed

- Corrected installer Node requirements, updater bind-host substitution and a removed Slack icon import.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.37...v1.7.39).

## [1.7.37] - 2026-07-15

### Added

- Added configurable panel titles, selectable login layouts and persistent per-install favicon colors.

### Fixed

- Started local-image apps without a source directory and corrected login-layout and favicon application.

### Security

- Strengthened insecure-secret checks, bound the API to loopback by default and added search-engine noindex handling.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.35...v1.7.37).

## [1.7.35] - 2026-07-13

### Added

- Added Kubernetes management and Tramo automation extensions with starter templates and template browsing.

### Changed

- Replaced the Workflow Builder with Tramo Automations and renamed Marketplace navigation to Extensions.
- Built the frontend stage natively for multi-architecture Docker releases.

### Fixed

- Displayed a Not Found page for unknown or uninstalled extension routes; removed retired extension leftovers and quarantined extensions that break builds.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.29...v1.7.35).

## [1.7.29] - 2026-07-11

### Added

- Added unified entity and Settings search, a three-step New Service wizard and GitHub App manifest setup.
- Supported repository templates and a custom Dockerfile path in serverkit.yaml.
- Added JSON output and shell completion for operator CLI commands.

### Fixed

- Forwarded CLI flags unchanged through the command wrapper.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.25...v1.7.29).

## [1.7.25] - 2026-07-10

### Added

- Expanded serverkit.yaml with multi-container units, ports, volumes, bootstrap commands, image-based services and network references.
- Added setup-health checks, fleet survey/doctor actions, backup restore drills, DNS cutover tools and SSH site import.
- Added cron run history, notification digests and preferences, GitHub-based extension installation with consent, and GPU monitoring.

### Fixed

- Restored missing authorization checks, migrations, fleet services and UI components after repository recovery.
- Preserved image assets in release tarballs and corrected bundled extension manifests.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.16...v1.7.25).

## [1.7.16] - 2026-07-04

### Added

- Added serverkit.yaml planning and application, secret/service references, health checks, drift detection and fleet targeting.
- Added migration importers for cPanel, DirectAdmin and Hestia, plus WordPress import over SSH.
- Added database-user management, Adminer SSO, query process controls, engine tuning, application resource limits and server speed tests.
- Added Stalwart mail, authoritative DNS and CrowdSec extensions, nginx micro-cache controls, bandwidth accounting and .htaccess conversion.

### Security

- Added container cloud-metadata egress protection, scoped file-integrity monitoring and job-backed malware scans.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.11...v1.7.16).

## [1.7.11] - 2026-07-03

### Fixed

- Restored WebSocket connections by using a plain threaded Gunicorn worker compatible with the panel's Socket.IO mode.
- Stopped extension pages from rendering on unrelated routes.
- Prevented caching of the SPA entrypoint and warned about stale panel nginx ports.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.10...v1.7.11).

## [1.7.10] - 2026-07-03

### Added

- Added remote-agent-specific File Manager shortcuts and stored agent-reported installation directories.

### Fixed

- Preserved .env secrets and the database when rerunning installation; fixed no-domain installs and updater rollback/re-entry failures.
- Hardened installation, removal and CLI commands for minimal systems and distro differences.
- Verified agent download checksums and paged release discovery.
- Reported the real version and install directory on Docker and custom-directory installs.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.7...v1.7.10).

## [1.7.7] - 2026-07-02

### Added

- Added remote extension catalogs, checksum-verified installation, configuration forms, update checks and admin notifications.
- Added extension-owned models, jobs, permissions, settings sections and tab contributions.

### Changed

- Moved WordPress, Email, Cloudflare Zone Ops, FTP, cloud provisioning, remote access and status-page functionality into builtin extensions.
- Preserved installed extensions across panel updates.

### Fixed

- Kept Marketplace visible across onboarding presets and guarded invalid chart timezones.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.5...v1.7.7).

## [1.7.5] - 2026-07-01

### Added

- Added managed databases and volumes, private container-registry credentials and a global WordPress plugin library.
- Added multiple publishing base domains, wildcard HTTPS and domain selection during site creation.

### Changed

- Served the panel frontend from host nginx and reloaded nginx during panel updates to keep hosted apps reachable.

### Fixed

- Attached subdomains for all managed app types and surfaced incomplete publishing configuration.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.3...v1.7.5).

## [1.7.3] - 2026-06-26

### Fixed

- Aligned docker-compose.yml with the then-current frontend-container and host-backend deployment layout.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.2...v1.7.3).

## [1.7.2] - 2026-06-25

### Added

- Added multi-distro and init-system detection, firewall setup, Python bootstrap support and a unified uninstall flow.
- Added version-aware updates, dry-run handling, self-updating bootstrap and a concurrent-update lock.

### Fixed

- Improved rollback behavior and tolerated a missing serverkit.conf during updates.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.1...v1.7.2).

## [1.7.1] - 2026-06-25

### Changed

- Unified Services detail pages, deployment activity, observability, SSL management and backup policies.
- Standardized the frontend on shared SCSS components and added consistent loading, confirmation and empty states.

### Fixed

- Protected ServerKit's own containers from lifecycle actions and detected all-Docker deployments during updates.

### Security

- Sanitized sidebar SVG icons and hardened rendered Markdown links.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.7.0...v1.7.1).

## [1.7.0] - 2026-06-24

### Added

- Added projects and environments, shared resources and variables, pull-request previews and proxy stacks.
- Added build packs, configuration snapshots, API scopes, onboarding and an expanded application template catalog.
- Added per-site WordPress Fail2ban jails and shared-variable injection for Compose deployments.

### Changed

- Added preflight checks, offline support and atomic blue/green installation/update infrastructure.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.6.33...v1.7.0).

## [1.6.33] - 2026-06-23

### Added

- Added application and WordPress detail loading skeletons.

### Changed

- Combined domains, DNS zones and Dynamic DNS into one interface and restricted Connections administration.

### Fixed

- Improved install/update/uninstall handling and restored the SSL status-bar layout.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.6.32...v1.6.33).

## [1.6.32] - 2026-06-23

### Added

- Added Cloudflare zone settings, cache purge, WAF rules, Workers, Tunnels and R2/KV/D1 tools.
- Added backup-protection policies, scheduling and a global storage-cost view.

### Fixed

- Used the WordPress database URL for canonical site links and corrected Python compatibility, migration logging and frontend health checks.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.6.30...v1.6.32).

## [1.6.30] - 2026-06-22

### Added

- Added a DNS ownership ledger, zone mirror, change activity and failure notices.
- Added wildcard/per-site subdomain modes and a managed-records view.

### Changed

- Unified Cloudflare credentials through a shared connection and added domain-aware panel URLs.

### Fixed

- Made the release builder work on Windows/Git Bash.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.6.29...v1.6.30).

## [1.6.29] - 2026-06-22

### Added

- Added unified background jobs for deployments, workflows and scheduled backups, with an admin Jobs page.
- Added a correlated telemetry stream, notification center and queue-backed email notifications.

### Fixed

- Activated the backup scheduler, enforced workspace server quotas and improved workspace switching.
- Bounded large telemetry payloads and refined release packaging with a smoke test.

[Full comparison](https://github.com/jhd3197/ServerKit/compare/v1.6.25...v1.6.29).

## [1.6.25] - 2026-06-21

### Changed

- Established the earliest published panel release covered by this backfill, with the Flask/React control panel, application and database management, Docker operations, backups and server monitoring.
- Moved the agent into the separate serverkit-agent repository and introduced a dedicated panel release workflow.

[1.11.1]: https://github.com/jhd3197/ServerKit/releases/tag/v1.11.1
[1.11.0]: https://github.com/jhd3197/ServerKit/releases/tag/v1.11.0
[1.10.0]: https://github.com/jhd3197/ServerKit/releases/tag/v1.10.0
[1.9.29]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.29
[1.9.28]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.28
[1.9.25]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.25
[1.9.24]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.24
[1.9.22]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.22
[1.9.21]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.21
[1.9.18]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.18
[1.9.17]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.17
[1.9.15]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.15
[1.9.14]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.14
[1.9.11]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.11
[1.9.10]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.10
[1.9.9]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.9
[1.9.7]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.7
[1.9.5]: https://github.com/jhd3197/ServerKit/releases/tag/v1.9.5
[1.7.130]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.130
[1.7.125]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.125
[1.7.124]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.124
[1.7.121]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.121
[1.7.119]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.119
[1.7.116]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.116
[1.7.113]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.113
[1.7.105]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.105
[1.7.104]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.104
[1.7.99]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.99
[1.7.95]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.95
[1.7.94]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.94
[1.7.91]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.91
[1.7.83]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.83
[1.7.82]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.82
[1.7.81]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.81
[1.7.79]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.79
[1.7.78]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.78
[1.7.76]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.76
[1.7.75]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.75
[1.7.74]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.74
[1.7.68]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.68
[1.7.65]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.65
[1.7.59]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.59
[1.7.56]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.56
[1.7.53]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.53
[1.7.51]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.51
[1.7.49]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.49
[1.7.48]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.48
[1.7.47]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.47
[1.7.45]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.45
[1.7.43]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.43
[1.7.40]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.40
[1.7.39]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.39
[1.7.37]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.37
[1.7.35]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.35
[1.7.29]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.29
[1.7.25]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.25
[1.7.16]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.16
[1.7.11]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.11
[1.7.10]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.10
[1.7.7]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.7
[1.7.5]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.5
[1.7.3]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.3
[1.7.2]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.2
[1.7.1]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.1
[1.7.0]: https://github.com/jhd3197/ServerKit/releases/tag/v1.7.0
[1.6.33]: https://github.com/jhd3197/ServerKit/releases/tag/v1.6.33
[1.6.32]: https://github.com/jhd3197/ServerKit/releases/tag/v1.6.32
[1.6.30]: https://github.com/jhd3197/ServerKit/releases/tag/v1.6.30
[1.6.29]: https://github.com/jhd3197/ServerKit/releases/tag/v1.6.29
[1.6.25]: https://github.com/jhd3197/ServerKit/releases/tag/v1.6.25
