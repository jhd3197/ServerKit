# `serverkit.yaml` — Declarative Service Manifest

A repository can carry a single `serverkit.yaml` (or `serverkit.json`) that
declares everything you would otherwise click into existence in the panel:
services, databases, disks, backups, environment variables, cron jobs and
domains. ServerKit parses it, diffs it against live state, and applies the
difference — at import, on push (per-service `autoDeploy`), or on demand.

The manifest is an **optional overlay**. Panel-first users see zero change; the
imperative APIs stay authoritative for apps without a manifest.

## Editor support

Add a `$schema` header comment so editors give you validation and autocomplete:

```yaml
# yaml-language-server: $schema=https://serverkit.ai/serverkit-yaml.schema.json
version: 1
```

The JSON Schema ships in the repo at [`docs/serverkit-yaml.schema.json`](./serverkit-yaml.schema.json).

## Versioning

`version: 1` is the discriminator that selects the declarative multi-service
spec. **A file without `version: 1` is a legacy flat manifest and keeps behaving
exactly as before** — no breaking change, ever, to the v0 shape. Legacy files
use flat `build`/`deploy` keys and describe a single service.

## Key casing

`camelCase` is canonical in this document and the schema. `snake_case` aliases
are accepted everywhere (`buildCommand` == `build_command`,
`healthCheckPath` == `healthcheck_path`, `fromSecret` == `from_secret`, …).

## Full example

```yaml
# yaml-language-server: $schema=https://serverkit.ai/serverkit-yaml.schema.json
version: 1
server: vps-frankfurt          # optional fleet target (Phase 5); omit for local

services:
  - name: api
    type: web
    runtime: python
    buildCommand: pip install -r requirements.txt
    startCommand: gunicorn app:app
    port: 8000
    healthCheckPath: /health
    autoDeploy: true
    envVars:
      - key: DATABASE_URL
        fromService: { name: db, property: connectionString }
      - key: STRIPE_KEY
        fromSecret: stripe_prod
      - key: SESSION_SECRET
        generate: true
      - key: LOG_LEVEL
        value: info
    disks:
      - name: uploads
        mountPath: /data/uploads
        backup: { schedule: daily, retain: 7 }
    cron:
      - schedule: "0 3 * * *"
        command: python manage.py cleanup

  - name: db
    type: postgres
    version: "16"
    disk:
      size: 10GB
      backup: { schedule: daily, retain: 7 }

domains:
  - host: api.example.com
    service: api
    ssl: auto                  # best-effort — SSL stays optional, never blocks
```

## Top-level keys

| Key | Type | Notes |
|---|---|---|
| `version` | `1` | Required. Selects the declarative spec. |
| `server` | string | Optional default fleet target. A service may override it. |
| `project` | string | Optional project name; defaults to the repository name. A manifest maps to one Project. |
| `envVars[]` | list | Manifest-level (project-scoped) variables applied to every service. |
| `services[]` | list | The services that make up the deployment. |
| `domains[]` | list | Public domains routed to services. |

## Services

Each `services[]` entry becomes an `Application` (app types) or a
`ManagedDatabase` (db types) inside the manifest's Project, in the default
environment.

| Key | Applies to | Notes |
|---|---|---|
| `name` | all | Unique within the manifest. `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`. |
| `type` | all | `web` / `worker` / `static` / `docker` → Application; `postgres` / `mysql` / `mariadb` / `redis` → ManagedDatabase. |
| `runtime` | app | Build runtime hint (`python`, `node`, `static`, `docker`). |
| `buildCommand` / `startCommand` | app | Buildpack command overrides. |
| `dockerfilePath` | app | Build the service from this Dockerfile in the repository (repo root = build context). Mutually exclusive with `image` and `containers` — see [Building from a Dockerfile](#building-from-a-dockerfile). |
| `port` | app | Container listen port (1–65535). Keeps its HTTP/nginx semantics. |
| `ports[]` | app | Typed L4 publishes (appliance tier) — see [Ports](#ports-appliance-tier). |
| `healthCheckPath` | app | Used for health checks and the zero-downtime restart gate. |
| `autoDeploy` | app | `true` auto-applies on a changing push; otherwise the manifest flips to `pending`. |
| `cpu` / `memory` | app | Resource limits (best-effort). |
| `version` | db | Engine version (e.g. `"16"`). |
| `server` | all | Per-service fleet target override. |
| `envVars[]` | all | Per-service environment variables. |
| `disks[]` | app | Persistent volumes. |
| `disk` | db | Single primary disk for a db service. |
| `cron` | app | One object or a list — scheduled jobs. |

## Ports (appliance tier)

The scalar `port` is the HTTP door: it stays behind nginx, on a loopback bind,
with a vhost — unchanged. Real infrastructure speaks more than HTTP, so
`ports[]` is the **raw L4 escape hatch**: media/UDP, VoIP, brokers, DNS.

```yaml
services:
  - name: media
    type: docker
    ports:
      - { port: 10000, protocol: udp, expose: public }   # 0.0.0.0:10000:10000/udp + firewall
      - { port: 8443, containerPort: 443, expose: local } # 127.0.0.1:8443:443 (behind nginx)
```

| Field | Default | Meaning |
|---|---|---|
| `port` | — | Host port to publish (required). |
| `containerPort` | = `port` | Container port to publish to. |
| `protocol` | `tcp` | `tcp` or `udp`. |
| `expose` | `public` | `public` binds `0.0.0.0` **and opens the firewall**; `local` binds `127.0.0.1` only. |

A `public` port renders a direct `0.0.0.0` docker publish and opens a firewall
rule on the panel host, recorded so deleting the app closes it again. `ports[]`
persist as JSON on the app row; a plain HTTP app declares none and keeps using
`port`.

### The honesty rule — plan-time blockers

The plan tells you what the target **can't** provide, and `apply` refuses rather
than deploying something that silently won't route. Blockers are distinct from
advisory `issues`; there is no force flag — clear the cause and re-apply.

| Blocker | Fires when |
|---|---|
| `port_conflict` | A `public` host port is already bound on the panel host. |
| `remote_target` | A service with appliance features targets a remote `server:` — remote appliance apply is deferred; run it on the panel host. |
| `observed_server` | The target server is observed (read-only); ServerKit won't mutate it. |
| `firewall_undetected` | Public ports are declared but the host firewall state couldn't be determined. |

A *manageable-firewall-simply-absent* case is a warning, not a blocker: the port
is still published, just not firewall-managed.

## Environment variables

Each entry has a `key` plus **exactly one** value source:

| Source | Meaning |
|---|---|
| `value: <literal>` | A non-secret literal. Secrets never live in the manifest. |
| `fromSecret: <name>` | Reference to a vault secret by name. Resolved at injection time; the value never lands in the env row and masking stays intact. A missing secret is a **plan-time** error. |
| `fromService: { name, property }` | Reference to a sibling service's connection property. For db services: `connectionString`, `host`, `port`, `database`, `username`, `password`. For app services: `host`, `port`, `url`. |
| `fromServer: { property }` | The service's own advertised identity — `publicIp` or `hostname`. `publicIp` is what a NAT'd media/WebRTC bridge must advertise to clients. Resolves against the target server (or the panel host); a missing IP is a plan-time blocker (`fromserver_no_ip`). |
| `generate: true` | On first apply ServerKit generates a random value, stores it as a vault secret, and rewires the entry as a `fromSecret` reference — a committable manifest with zero secrets in git. |

## Addressing

- **In a unit** — containers reach each other by their short name on the unit's
  private (compose default) network.
- **Across apps** — a manifest app resolves a sibling app by its service name
  (`fromService: { name, property: host }`). ServerKit attaches manifest-generated
  projects to a shared external `serverkit` docker network (created idempotently
  via `DockerService.ensure_network`), so that name resolves at runtime.
- **Public IP** — `fromServer: { property: publicIp }` (or the
  `${SERVER_PUBLIC_IP}` template magic var) binds the host's advertised address —
  the WebRTC/NAT need.

**Static egress IPs are out of scope.** Advertising an inbound IP is container
config; pinning the *source* IP of outbound traffic is network infrastructure
(secondary IPs, SNAT) that lives below the manifest.

**Framework scaffolds.** New Service → *Start from a framework* (see the
[Deployment Guide](DEPLOYMENT.md#starting-from-a-framework-laravel)) wires its
database with the same primitives a manifest uses: the engine template install
that backs `type: redis` and `fromService` references (`DB_HOST`, `DB_PORT`,
`DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`). It does not write a
`serverkit.yaml`: a `type: mysql` service goes through the managed-database
record path, while the scaffold needs a MySQL container on the shared network.

## Disks & backups

```yaml
disks:
  - name: uploads
    mountPath: /data/uploads
    size: 5GB              # recorded; not enforced by the local driver
    backup: { schedule: daily, retain: 7 }
```

`disks[]` become `AppVolume` rows; `size` is recorded as the volume's
`declared_size` cap (not enforced by the local driver). A `backup:` block
becomes a `BackupPolicy` on the `files` target that resolves the **live host
mountpoint** of the named docker volume — so the backup captures the real bytes,
not the empty in-container path. `schedule` is one of
`hourly` / `daily` / `weekly` / `monthly`; `retain` is the number of backups to
keep.

## Building from a Dockerfile

A service has exactly one image source: a buildpack (`runtime` +
`buildCommand`/`startCommand`), a ready-made `image:`, or a **Dockerfile in the
repository**. `dockerfilePath` is the third path — the monorepo story: one
repo, several services, each built from its own Dockerfile.

```yaml
services:
  - name: api-worker
    type: worker
    dockerfilePath: services/api/Dockerfile
    autoDeploy: true
  - name: mail-worker
    type: worker
    dockerfilePath: services/mail/Dockerfile
    autoDeploy: true
```

- **Context is the repo root.** The path is relative to the repository;
  absolute paths and `..` segments are validation errors. Every service built
  from the same repo shares the same context, so Dockerfiles can `COPY` shared
  code.
- **Source resolution.** Apply clones the project's repository into the managed
  apps directory and writes the same git-deployment + build config the import
  wizard does — the normal deploy pipeline (including the push webhook and
  per-service `autoDeploy`) takes over from there. The repository is the stored
  manifest's provenance (recorded at import / on push), or, failing that, the
  git deployment of a sibling app in the project. Neither on record is a
  plan-time **blocker** (`dockerfile_no_source`).
- **Mutually exclusive** with `image:` (build from source *or* bring an image)
  and with `containers:` (unit containers declare ready-made images).
- **Panel host only for now.** Like the other appliance features, a Dockerfile
  build on a remote `server:` target is a plan-time blocker (`remote_target`).
- **Drift.** A changed `dockerfilePath` shows up in the plan as an app update
  and rewrites the build config on apply.

## BYO image & host requirements

`image:` is a first-class peer of the buildpack path — declare a ready-made
image instead of building one. `registry:` names a private registry to
authenticate against before pulling; an unknown or uncredentialed registry is a
plan-time **blocker** (`registry_credential`). ECR registries authenticate via a
key-pair exchange, so they need no stored secret.

`hostRequirements:` exposes the elevated compose fields real appliances need:

```yaml
services:
  - name: vpn
    type: docker
    image: ghcr.io/acme/vpn:1.2
    registry: acme-ghcr
    hostRequirements:
      capAdd: [NET_ADMIN]
      sysctls: { net.ipv4.ip_forward: "1" }
      devices: [/dev/net/tun]
      kernelModules: [wireguard]   # advisory /proc/modules check only
```

Every host requirement is **listed in plain words in the plan** and written to a
`manifest.host_requirements` audit line on apply — `privileged` is a big hammer
and it never applies silently. `kernelModules` are advisory: an unconfirmed
module is a warning, never a silent pass, and is unverifiable off-Linux.

## Multi-container units

Some services are not one image — a web frontend, a signaling process, a media
bridge. A `containers:` map makes ONE service a **unit**: one Application, one
compose project, one private network (the compose default), with health-gated
start order. It is mutually exclusive with the buildpack keys (`runtime`,
`buildCommand`, `startCommand`).

```yaml
services:
  - name: meet
    type: docker
    containers:
      web:
        image: jitsi/web:stable
        ports:
          - { port: 8443, containerPort: 443, expose: local }
        dependsOn:
          - { service: prosody, condition: healthy }
        healthCheck: { httpPath: /, interval: 30s, retries: 5 }
        disks:
          - { name: web-config, mountPath: /config, size: 1GB, backup: { schedule: daily, retain: 7 } }
      prosody:
        image: jitsi/prosody:stable
        bootstrap: { command: "/opt/gen-config.sh", timeoutSeconds: 120 }
        healthCheck: { cmd: "prosodyctl status" }
```

Each container takes the same vocabulary as a service:
`image` / `registry` / `ports` / `disks` / `envVars` / `bootstrap` /
`hostRequirements` / `healthCheck` (`cmd` → `CMD-SHELL`, `httpPath` → a `wget`
probe) / `dependsOn` (`{ service, condition: healthy|started }`, validated
against sibling containers and checked for cycles). Container names resolve on
the unit's private network; `container_name` is `{unit}-{container}`. A
container's disks become **per-container** named volumes
(`{unit}-{container}-{disk}`), so two containers can both mount `/config`
without colliding.

## First-boot bootstrap

Some appliances generate a config/certificate tree exactly once. A compose init
container gets left behind; an entrypoint reruns every deploy. `bootstrap` runs
the command **once**, via `docker compose run --rm`, after the volumes exist and
before the first `up`:

```yaml
services:
  - name: prosody
    type: docker
    bootstrap: { command: "/opt/bootstrap/generate-config.sh", timeoutSeconds: 120 }
```

Success flips `Application.bootstrap_done`, so it never re-runs; a failure is a
visible, retryable apply-step error. To deliberately run it again (a fresh
config generation), `POST /api/v1/manifests/bootstrap/reset` with the app name
typed in `confirm`.

## Domains & SSL

```yaml
domains:
  - host: api.example.com
    service: api
    ssl: auto
```

`ssl: auto` is **best-effort**: certificate failure degrades to a warning and
never blocks the deploy or the domain attach. HTTPS is optional in ServerKit,
period. Use `ssl: off` for HTTP only.

## Apply model

- **Explicit apply by default.** `plan` (dry-run) → `apply` is the base flow.
  A dry-run is always available and is the default UX.
- **`autoDeploy: true`** opts a service into auto-apply on a changing push.
- Every apply is logged, runs inside a `DeploymentJob`, and snapshots config
  before and after — the same auto-apply-sandboxed-logged trust model as the
  rest of ServerKit.
- **Secrets never live in YAML.** The manifest is committable by construction.

## Out of scope

The manifest is an *app* manifest. It does **not** declare multi-replica /
load-balanced / blue-green services, non-app server resources (firewall rules,
global nginx, system packages), or act as a general-purpose IaC engine. Live
panel state *is* the state; the manifest is the desired state.
