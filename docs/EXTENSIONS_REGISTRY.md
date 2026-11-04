# Extension Registry & Publishing

The **registry** is how third-party (and non-bundled first-party) extensions
become browsable in the Marketplace without any per-panel seeding. It is a single
curated `index.json`; panels fetch it, merge its entries into Browse labeled
"Registry", and install from it with checksum verification.

This document is the format spec (task #16) and the publisher guide (task #21).

---

## How a panel consumes the registry

- The panel fetches the index from `SERVERKIT_REGISTRY_URL` (env var). When unset
  it defaults to the curated public registry via serverkit.ai
  (`https://serverkit.ai/ext/index.json`, which proxies and caches the raw
  `serverkit-extensions` index and serves its logo art); set it **empty** to
  disable remote fetching entirely (air-gapped panels). When
  the fetch fails (offline), it falls back to the **last good cache**, then to a
  **bundled copy** shipped at `backend/app/data/registry_index.json`. The
  Marketplace never blanks.
- Results are cached in-memory for `SERVERKIT_REGISTRY_TTL` seconds (default 3600).
- Discovery is **read-only** — nothing in the registry is ever auto-installed.
- Installing a registry entry downloads its `source`, verifies `sha256` (when
  present) before extraction, and checks the panel version against
  `min_panel_version` / `max_panel_version`.
- **Installing straight from GitHub** (Marketplace → *Install manually* → URL)
  works with a repo URL, a release URL, a direct `.zip`, or `owner/repo` /
  `owner/repo@tag` shorthand. The panel first **previews** the extension —
  resolving the download, reading `plugin.json`, and showing the version,
  declared permissions, panel-version compatibility, and any warnings — then
  installs the *exact previewed bytes* (checksum-pinned). Set the optional
  **`SERVERKIT_GITHUB_TOKEN`** env var to lift GitHub's 60/hr anonymous API
  rate limit and enable private-repo installs; the token is attached only to
  GitHub hosts and is never logged or returned by the API.

Relevant endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/marketplace/registry` | list registry entries + live install state |
| `POST /api/v1/marketplace/registry/<slug>/install` | checksum-verified install (admin) |
| `GET /api/v1/plugins/updates` | installed plugins with a newer registry/bundled version; returns `{updates, count, checked_at, registry_source}`, `?refresh=1` refetches |
| `POST /api/v1/plugins/<id>/update` | update a plugin to the registry version (admin) |

---

## `index.json` format (schema_version 2)

`schema_version` is now `1` **or** `2`. Version 2 is fully additive — v1 entries
stay valid unchanged; the new fields (`logo`, `repo`, `bundled`) are optional.

```jsonc
{
  "schema_version": 2,
  "updated": "2026-07-09",
  "extensions": [
    {
      "slug": "serverkit-gui",                 // required — matches the manifest name
      "display_name": "ServerKit Agent GUI",   // required
      "description": "…",
      "version": "0.1.0",                       // required (unless bundled) — the published version
      "category": "monitoring",                 // ai|monitoring|security|deployment|integration|ui|utility
      "author": "Juan Denis",
      "first_party": false,                     // true only for ServerKit-authored entries
      "bundled": false,                          // v2 — true = ships inside the panel (catalog listing only)
      "permissions": ["network"],               // declared host permissions (honesty is reviewed)
      "min_panel_version": "1.7.0",             // optional compat gate (inclusive)
      "max_panel_version": null,                // optional
      "sdk_version": "^1.0.0",                   // optional (additive) — frontend SDK range the bundle targets
      "source": "https://github.com/owner/repo", // repo URL (latest release), release URL, or direct .zip
      "sha256": "…",                            // sha256 of the release zip — STRONGLY recommended
      "review": {                                // optional — hash-bound review stamp (see below)
        "reviewer": "jhd3197",
        "date": "2026-07-23",
        "sha256": "…",                           // sha256 of the exact zip the reviewer inspected
        "commit": "…",                           // optional git sha
        "notes": "…"                             // optional
      },
      "repo": "https://github.com/owner/repo",   // v2 — https URL of the source repo (shown as "Source repo")
      "logo": "assets/serverkit-gui/logo.svg",   // v2 — https URL OR repo-relative assets/<slug>/<file>
      "release_notes": "…",                      // optional (additive) — shown in the update-diff modal
      "homepage": "https://…",
      "icon": "<svg-inner-markup/>",            // rendered on the detail view
      "screenshots": ["https://…/1.png"]        // rendered on the detail view
    }
  ]
}
```

Notes:
- `source` accepts the same forms as a URL install: a GitHub repo URL (resolves the
  latest release asset), a release-tag URL, or a direct `.zip` URL.
- `sha256` is the digest of the exact zip `source` resolves to. When present it is
  **enforced** — a mismatch is a hard failure with no partial install. Omit only
  while prototyping.
- `min_panel_version`/`max_panel_version` are compared against the panel's
  `VERSION`. An incompatible entry can be listed but not installed/updated.
- `sdk_version` (additive) is the semver range of the frontend SDK a **runtime
  bundle** targets — see [EXTENSIONS.md](EXTENSIONS.md) → *The SDK contract*. Checked
  at install and at load. Older panels ignore it; older indexes omit it.
- `release_notes` (additive) is free text shown in the Marketplace **update-diff**
  modal alongside the version + permissions delta. Old panels ignore it.

### v2 fields (`logo`, `repo`, `bundled`)

- **`logo`** — an extension logo, shown first in the Marketplace art fallback
  chain (before brand marks / generated covers). Either an absolute `https://`
  URL or a **repo-relative** path `assets/<slug>/<file>` (`.svg` or `.png`,
  ≤ 200 KB) committed to the `serverkit-extensions` repo alongside the entry.
  Repo-relative paths are resolved to absolute URLs by the panel (against the
  index URL it fetched) and rewritten by the serverkit.ai `/ext` endpoint, so a
  single relative path works whether the panel reads the raw-GitHub index or the
  domain.
- **`repo`** — the https URL of the extension's source repository. The detail
  modal renders it as a **"Source repo"** link.
- **`bundled`** — `true` marks an entry as one of the panel's builtin
  extensions. Bundled entries are **catalog listings only** (they ship inside
  the panel, so `source`/`sha256` are optional) and are **excluded from the
  Browse merge** by default to avoid duplicating the builtin cards; the API
  exposes them via `GET /api/v1/marketplace/registry?include_bundled=true`.
  Generate them from the panel repo — never hand-type:
  ```bash
  node scripts/export-registry-entries.mjs   # emits index-v2 bundled entries
  ```

### Review stamps (`review`) & trust levels

An entry may carry an optional **`review`** stamp recording that a reviewer
inspected the published artifact:

```jsonc
"review": {
  "reviewer": "jhd3197",          // who reviewed it
  "date": "2026-07-23",           // when
  "sha256": "…",                  // sha256 of the EXACT zip that was reviewed
  "commit": "…",                  // optional git sha of the reviewed source
  "notes": "…"                    // optional free text
}
```

The stamp is **hash-bound**: the reviewer vouched for the bytes whose digest is
`review.sha256`, not for the slug. If the artifact ever changes (new release,
replaced asset), the entry's `sha256` moves on and no longer matches
`review.sha256` — the review is **stale** and stops counting. A stamp only
survives normalization when it is an object whose `sha256` is a 64-character
lowercase hex digest; anything malformed is dropped.

From this the panel derives a per-entry **`trust`** level, surfaced on the
catalog API and in the Marketplace:

| `trust` | Meaning |
|---|---|
| `first_party` | `first_party: true` — authored by ServerKit (always wins). |
| `reviewed` | A valid `review` stamp exists and `review.sha256` equals the entry's `sha256`. |
| `unreviewed` | Everything else — no stamp, a stale stamp (hash mismatch), a malformed stamp, or no `sha256` to bind to. |

The Marketplace renders **Reviewed** (with a *Reviewed by \<reviewer\> on
\<date\>* tooltip) and **Unreviewed** badges accordingly.

**Install-time acknowledgment.** Installing an `unreviewed` entry — or any
entry with no `sha256` to verify against — requires explicit consent:
`POST /api/v1/marketplace/registry/<slug>/install` without
`{"acknowledge_risk": true}` in the JSON body returns **409** with
`{"error": …, "trust": …, "reason": …, "requires_acknowledgment": true}`,
where `reason` is `unreviewed` (community code not vetted) or `unverified`
(no pinned checksum, possible even for `first_party`). The Marketplace catches
this, shows a confirmation dialog whose copy matches the reason, and resends
with `acknowledge_risk: true` only if the operator confirms (the
acknowledgment is recorded in the audit log). `first_party` and `reviewed`
entries install unchanged, with no extra prompt.

**Unreviewed entries are developer-stage content.** On a production panel
(Flask debug off, `dev_mode` setting off) `unreviewed` entries do not appear
in the Marketplace at all, and the install endpoint answers **404** for them —
hiding is the default, the 409 acknowledgment flow only exists where they are
visible. They list and install only in development contexts: Flask debug mode
(development/testing config) or the `dev_mode` setting toggled on under
Settings → Site. `first_party` and `reviewed` entries are unaffected.

---

## Publishing an extension

1. **Structure the repo** per [`docs/EXTENSIONS.md`](EXTENSIONS.md): a `plugin.json`
   at the archive root, plus `backend/` and/or `frontend/`. A third-party extension
   that ships a **prebuilt runtime bundle** (`frontend_entry: dist/index.mjs`,
   externalized shared libs) now renders on a prebuilt panel **with no rebuild** —
   see [`docs/EXTENSIONS_CI.md`](EXTENSIONS_CI.md) for the build→hash→publish recipe.
   (Backend-only extensions need no frontend at all.)

2. **Cut a release.** Tag a version and attach a plugin `.zip` as a release asset
   (the installer prefers a `.zip` asset over the source zipball). Record the
   asset's `sha256`:
   ```bash
   sha256sum my-extension-0.1.0.zip
   ```

3. **Submit the index PR.** Open a PR against the `serverkit-extensions` repo adding
   (or bumping) your entry in `index.json`. Bumping `version` is what surfaces the
   "Update available" badge on installed panels.

### Review checklist (what a maintainer verifies)

- **Permissions honesty** — declared `permissions` match what the code actually
  uses (`docker|filesystem|shell|network|db`, or `agent.command:*`). Over-broad or
  undeclared permissions are rejected. Enforcement (Phase 3 #25) makes an
  undeclared capability raise at runtime — declare accurately.
- **Checksum** — `sha256` present and matches the release asset.
- **License** — a real OSS license (`license` field + a LICENSE in the repo).
- **Compat** — `min_panel_version` reflects the oldest panel actually tested.
- **Frontend bundle** — if the extension ships UI, it's a **runtime ESM bundle**
  (`frontend_entry: dist/index.mjs`) that passes `--validate` (no embedded React,
  shared libs externalized). Raw `.jsx` frontends don't render on prebuilt panels.
- **SDK range** — `sdk_version` present for any extension shipping a runtime bundle
  and reflects the SDK it was actually built + tested against.
- **Brand-neutral** — no competitor names in the name/description (project policy).

Free/OSS project: there are **no paid extensions, quotas, or billing** — ever.
