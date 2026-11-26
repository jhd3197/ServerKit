from datetime import datetime
from app import db

# Application carries FKs to projects.id / environments.id (opt-in Project /
# Environment hierarchy). Import those modules here so their tables are always
# registered on db.Model's metadata whenever Application is loaded, keeping the
# FK targets resolvable regardless of import order.
from app.models import project as _project  # noqa: F401
from app.models import environment as _environment  # noqa: F401
from app.models.json_column_mixin import JsonColumnMixin
from app.models.mixins import SoftDeleteMixin, TimestampMixin
from app.utils.ingress import (
    default_ingress_plane as _default_ingress_plane,
    proxy_eligible as _proxy_eligible,
)


class Application(JsonColumnMixin, TimestampMixin, SoftDeleteMixin, db.Model):
    """A managed app.

    SOFT DELETED. `Application.query` therefore returns TOMBSTONES —
    read `query_active()` anywhere you mean "an app that still exists". That
    distinction is not cosmetic here: this model drives nginx vhosts, container
    lifecycles, DNS, backups and outbound registry calls, and the equivalent
    oversight on `Domain` produced a WordPress search-replace to a dead host and
    real ACME orders.

    Two rules specific to this model:

    * **Sibling tables are the sharp edge.** `ContainerSleepPolicy`,
      `BackupPolicy`, `DeploymentJob` and `WafPolicy` are enumerated on a
      SCHEDULE and resolve the app afterwards, so they never appear in a search
      for `Application.query`. Each of those sweeps joins on liveness; see
      `deleted_app_ids()`.
    * **A soft delete keeps the files.** Stopping containers and unpublishing
      the vhost is reversible, so it happens on delete; removing data volumes
      and the uploaded source is not, so it waits for purge. See
      `application_restore.on_purge_application`.
    """

    __tablename__ = 'applications'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    app_type = db.Column(db.String(50), nullable=False)  # 'php', 'wordpress', 'flask', 'django', 'docker', 'static'
    status = db.Column(db.String(20), default='stopped')  # 'running', 'stopped', 'error', 'deploying'

    # Configuration
    php_version = db.Column(db.String(10), nullable=True)  # '8.0', '8.1', '8.2', '8.3'
    python_version = db.Column(db.String(10), nullable=True)  # '3.9', '3.10', '3.11', '3.12'
    port = db.Column(db.Integer, nullable=True)
    root_path = db.Column(db.String(500), nullable=True)
    # HTTP path used for health checks and the zero-downtime restart gate.
    # Populated from a manifest at import, editable in Settings. NULL => no gate
    # (the restart falls back to a fixed wait).
    healthcheck_path = db.Column(db.String(255), nullable=True)
    # JSON: health-gate timeout / 4xx rule and the other deploy knobs.
    # NULL = defaults; read through app.services.deploy_settings.
    deploy_settings = db.Column(db.Text, nullable=True)
    # A/B slot deploys: opt-in, and which slot is live.
    slot_deploys_enabled = db.Column(db.Boolean, nullable=False, server_default='0', default=False)
    active_slot = db.Column(db.String(1), nullable=True)

    # Docker specific
    docker_image = db.Column(db.String(200), nullable=True)
    container_id = db.Column(db.String(100), nullable=True)
    # Optional private-registry binding. Set => authenticate (docker login) with
    # the stored credentials before pulling docker_image. NULL => anonymous pull
    # (today's behavior). See app/services/container_registry_service.py.
    registry_id = db.Column(db.Integer, db.ForeignKey('container_registries.id'), nullable=True, index=True)

    # Build packs (zero-Dockerfile deploys). When the build method routes through
    # the build-pack layer, the detected plan and any user overrides are persisted
    # here so the generated Dockerfile is reproducible and the UI can show it.
    # Per-app resource limits (task #23). Docker-enforced caps emitted into the
    # generated compose service block (`cpus` / `mem_limit`). NULL = unlimited.
    cpu_limit = db.Column(db.String(16), nullable=True)     # CPU cores, e.g. '1.5'
    memory_limit = db.Column(db.String(16), nullable=True)  # e.g. '512m', '2g'

    buildpack_type = db.Column(db.String(20), nullable=True)   # 'nixpacks' | 'static' | 'dockerfile-present' | 'unknown'
    buildpack_plan = db.Column(db.Text, nullable=True)         # JSON: the detected build plan
    buildpack_overrides = db.Column(db.Text, nullable=True)    # JSON: user overrides applied to the plan

    # Source / lifecycle: github (repo clone), template (built-in template),
    # manual (local path already on server), upload (zip upload managed by ServerKit)
    source = db.Column(db.String(20), default='github', nullable=False)

    # Manual / local service configuration
    compose_file = db.Column(db.String(200), nullable=True)
    systemd_unit = db.Column(db.String(100), nullable=True)
    managed_by = db.Column(db.String(20), nullable=True)  # 'docker_compose', 'systemd', 'host'

    # Ingress plane: which reverse proxy is expected to serve this app —
    # 'nginx' (host Nginx, the default) or 'proxy_stack' (Dockerized
    # Traefik/Caddy). NULL is treated as the default. See app/utils/ingress.py.
    ingress_plane = db.Column(db.String(20), nullable=True)

    # Appliance tier: typed port declarations (JSON list of
    # {container, host, protocol, ...}) and a one-shot bootstrap-completed flag.
    ports = db.Column(db.Text, nullable=True)
    bootstrap_done = db.Column(db.Boolean, nullable=False, server_default='0', default=False)

    # Upload versioning
    version = db.Column(db.Integer, default=0, nullable=False)
    upload_path = db.Column(db.String(500), nullable=True)

    # Private URL feature
    # NOT `unique=True`: the uniqueness is a PARTIAL index predicated on
    # `deleted_at IS NULL` (migration 084), so a tombstone releases its slug and
    # deleting an app does not burn `/p/<slug>` forever. Same shape as
    # Domain.name. A column-level unique here would re-impose the burn on any
    # database built from the models.
    private_slug = db.Column(db.String(50), nullable=True, index=True)
    private_url_enabled = db.Column(db.Boolean, default=False)

    # Opt-in nginx micro-cache (task #21): short-TTL page cache emitted into
    # the site's vhost, with bypasses for auth/admin/cart traffic. NULL/False
    # = off (today's behavior).
    micro_cache_enabled = db.Column(db.Boolean, default=False, nullable=True)
    # Page-cache TTL in seconds. NULL = the 10s default; the
    # renderer clamps to NginxService.MICROCACHE_TTL_MAX.
    micro_cache_ttl = db.Column(db.Integer, nullable=True)
    # Opt-in PgBouncer sidecar for a PostgreSQL engine app.
    pooler_enabled = db.Column(db.Boolean, nullable=True)
    # Long-cache fingerprinted assets in the vhost.
    immutable_assets = db.Column(db.Boolean, nullable=True)

    # Environment linking
    environment_type = db.Column(db.String(20), default='standalone')  # 'production', 'development', 'staging', 'standalone'
    linked_app_id = db.Column(db.Integer, db.ForeignKey('applications.id'), nullable=True, index=True)
    shared_config = db.Column(db.Text, nullable=True)  # JSON string for shared resources

    # Metadata
    last_deployed_at = db.Column(db.DateTime, nullable=True)

    # Foreign keys
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False, index=True)
    server_id = db.Column(db.String(36), db.ForeignKey('servers.id'), nullable=True, index=True)
    # Workspace scoping (#33). Nullable: existing rows are backfilled to a default
    # workspace by migration 015; new rows are stamped on create.
    workspace_id = db.Column(db.Integer, db.ForeignKey('workspaces.id'), nullable=True, index=True)
    # Project / Environment hierarchy (opt-in). Nullable: existing apps stay
    # "unassigned" and keep working; stamped on create when provided.
    project_id = db.Column(db.Integer, db.ForeignKey('projects.id'), nullable=True, index=True)
    environment_id = db.Column(db.Integer, db.ForeignKey('environments.id'), nullable=True, index=True)

    # Relationships
    # Use 'subquery' to eagerly load domains in a single query, avoiding N+1
    # NOTE: this collection includes SOFT-DELETED domains. It is deliberately
    # NOT filtered with a primaryjoin: combined with delete-orphan, a tombstoned
    # child would fall out of the collection and SQLAlchemy would HARD-delete it
    # on the next flush — soft delete would destroy the very row the recycle bin
    # exists to keep. Read `live_domains` anywhere you mean "domains this app
    # actually serves".
    domains = db.relationship('Domain', backref='application', lazy='subquery', cascade='all, delete-orphan')
    linked_app = db.relationship('Application', remote_side=[id], backref='linked_from', foreign_keys=[linked_app_id])
    server = db.relationship('Server', backref=db.backref('applications', lazy='dynamic'))
    # Lightweight, read-only relationships to resolve the project/environment
    # names in to_dict() (the FK columns above are the source of truth). No
    # backref/cascade — these only exist so an app row can show where it lives.
    project = db.relationship('Project', foreign_keys=[project_id], viewonly=True)
    environment = db.relationship('Environment', foreign_keys=[environment_id], viewonly=True)

    @classmethod
    def deleted_ids(cls):
        """Ids of every tombstoned app, as a set.

        For the sweeps that DO NOT start from Application — `ContainerSleepPolicy`,
        `BackupPolicy`, `DeploymentJob`, `WafPolicy` — which enumerate their own
        table on a schedule and resolve `application_id` afterwards. Those never
        appear in a search for `Application.query`, which is exactly how they
        would keep acting on a deleted app: waking its containers, running its
        backups, executing its queued deploys.

        A set, not a join: each of those sweeps is already written as "select my
        rows, then loop", and a set membership test drops into that loop without
        restructuring the query. The table is small enough that the cost is
        nothing next to the docker/restic work the loop is about to do.
        """
        return {row.id for row in cls.query_deleted().with_entities(cls.id).all()}

    @classmethod
    def name_clash_error(cls, name, suffix=''):
        """Message when *name* is taken — tombstones included, so a restore can
        never collide — or ``None`` when it is free."""
        from app.utils.slug import app_name_clash_error
        return app_name_clash_error(cls.query.filter_by(name=name).first(), name, suffix)

    # A site that was already running on the host when the panel adopted it
    # (nginx + PHP-FPM, or static files): its vhost, pool and certificate
    # were written by someone else and stay theirs.
    MANAGED_BY_HOST = 'host'

    @property
    def is_host_managed(self):
        """True for an adopted host site. The panel records and observes it
        but must never write, rewrite or remove its running config — every
        path that touches nginx or the runtime for an app checks this (through
        :func:`is_host_managed`, which also accepts a stand-in object)."""
        return is_host_managed(self)

    @property
    def live_domains(self):
        """The domains this app actually serves — tombstones excluded.

        `self.domains` still holds soft-deleted rows (see the relationship note
        above), so anything that answers "what is published / what should nginx
        or DNS or a manifest see" must read this instead.
        """
        return [d for d in self.domains if getattr(d, 'deleted_at', None) is None]

    # Fields to_dict() can emit that are NOT mapped columns. Each one costs a
    # query (or a collection walk) to produce, so `$select` has to know they
    # exist in order to let a caller decline them. Kept next to to_dict so the
    # two cannot drift.
    DERIVED_FIELDS = (
        'project_name', 'environment_name', 'server_name', 'domains',
        'image_scan', 'image_update', 'sleep', 'linked_app', 'has_linked_app',
        'ingress_plane', 'ingress_proxy_eligible',
    )

    def to_dict(self, include_linked=False, fields=None):
        """Serialize the app.

        `fields` (a set, normally from ``$select``) is not only a payload
        narrowing — it decides which DERIVED fields get computed, and those are
        where the cost is. ``image_scan`` and ``image_update`` read
        ``lazy='dynamic'`` relationships, so they issue a query EACH, per row,
        and no amount of eager loading can hoist them; ``sleep``, ``server``,
        ``project`` and ``environment`` are lazy scalars. Unnarrowed, drawing a
        100-app list costs roughly 300 extra queries. A caller that asks for
        ``$select=id,name`` now costs none of them.

        `fields=None` keeps the full legacy payload, so every existing caller
        is unaffected.
        """
        want = fields.__contains__ if fields is not None else (lambda _key: True)
        result = {
            'id': self.id,
            'name': self.name,
            'app_type': self.app_type,
            'status': self.status,
            'php_version': self.php_version,
            'python_version': self.python_version,
            'port': self.port,
            'healthcheck_path': self.healthcheck_path,
            'deploy_settings': self._deploy_settings(),
            'slot_deploys_enabled': bool(self.slot_deploys_enabled),
            'active_slot': self.active_slot,
            'root_path': self.root_path,
            'docker_image': self.docker_image,
            'container_id': self.container_id,
            'registry_id': self.registry_id,
            'cpu_limit': self.cpu_limit,
            'memory_limit': self.memory_limit,
            'buildpack_type': self.buildpack_type,
            'buildpack_plan': self._json_read('buildpack_plan', None),
            'buildpack_overrides': self._json_read('buildpack_overrides', None),
            'source': self.source,
            'compose_file': self.compose_file,
            'systemd_unit': self.systemd_unit,
            'managed_by': self.managed_by,
            'version': self.version,
            'upload_path': self.upload_path,
            'private_slug': self.private_slug,
            'private_url_enabled': self.private_url_enabled,
            'micro_cache_enabled': bool(self.micro_cache_enabled),
            'micro_cache_ttl': self.micro_cache_ttl,
            'pooler_enabled': bool(self.pooler_enabled),
            'immutable_assets': bool(self.immutable_assets),
            'environment_type': self.environment_type,
            'linked_app_id': self.linked_app_id,
            'shared_config': self._json_read('shared_config', None),
            'created_at': self.created_at.isoformat(),
            'updated_at': self.updated_at.isoformat(),
            'last_deployed_at': self.last_deployed_at.isoformat() if self.last_deployed_at else None,
            'user_id': self.user_id,
            'server_id': self.server_id,
            'workspace_id': self.workspace_id,
            'project_id': self.project_id,
            'environment_id': self.environment_id,
        }

        # Narrow the plain columns. These are already loaded on the instance, so
        # dropping them saves payload, not queries — the queries are below.
        if fields is not None:
            result = {key: value for key, value in result.items() if key in fields}

        # Pure derivations off already-loaded columns — cheap, but still elided
        # when unasked so `$select` means one thing everywhere.
        if want('ingress_plane'):
            result['ingress_plane'] = self.ingress_plane or _default_ingress_plane(self.app_type, self.managed_by)
        if want('ingress_proxy_eligible'):
            result['ingress_proxy_eligible'] = _proxy_eligible(self.app_type, self.managed_by)
        if want('has_linked_app'):
            result['has_linked_app'] = self.linked_app_id is not None

        # Derived display names for the project/environment/server this app
        # lives in (null when unassigned). Each is a lazy relationship load.
        if want('project_name'):
            result['project_name'] = self.project.name if self.project else None
        if want('environment_name'):
            result['environment_name'] = self.environment.name if self.environment else None
        if want('server_name'):
            result['server_name'] = self.server.name if self.server else 'Local server'
        if want('domains'):
            result['domains'] = [d.to_dict() for d in self.live_domains]

        # Lightweight image-scan badge (latest scan only).
        if want('image_scan'):
            latest_scan = self.image_scans.first()
            result['image_scan'] = {
                'status': latest_scan.status,
                'highest_severity': latest_scan.highest_severity,
                'severity_counts': latest_scan.get_counts(),
                'scanned_at': latest_scan.completed_at.isoformat() if latest_scan.completed_at else None,
            } if latest_scan else None

        # Lightweight image-update badge (latest digest check only).
        if want('image_update'):
            latest_update = self.image_update_checks.first()
            result['image_update'] = {
                'status': latest_update.status,
                'update_available': latest_update.update_available,
                'checked_at': latest_update.checked_at.isoformat() if latest_update.checked_at else None,
            } if latest_update else None

        # Lightweight auto-sleep badge.
        if want('sleep'):
            sleep_policy = self.sleep_policy
            result['sleep'] = {
                'enabled': sleep_policy.enabled,
                'asleep': sleep_policy.asleep,
                'idle_timeout_minutes': sleep_policy.idle_timeout_minutes,
            } if sleep_policy else None

        if include_linked and want('linked_app') and self.linked_app:
            result['linked_app'] = {
                'id': self.linked_app.id,
                'name': self.linked_app.name,
                'environment_type': self.linked_app.environment_type,
                'status': self.linked_app.status
            }
        return result

    def _deploy_settings(self):
        from app.services.deploy_settings import effective
        return effective(self)

    def __repr__(self):
        return f'<Application {self.name}>'


@db.event.listens_for(Application, 'before_delete')
def _clear_cron_association(mapper, connection, target):
    """Cron jobs are never silently deleted with an app — they fall back to the
    System bucket. Clearing the association here (one place) covers every delete
    path (apps/docker/python/git/workflow), since cron metadata lives in a JSON
    store outside the DB and can't ride a FK cascade. Best-effort: a failure here
    must never block deleting the app."""
    try:
        from app.services.cron_service import CronService
        CronService.clear_application(target.id)
    except Exception:  # noqa: BLE001 - cleanup must not block app deletion
        pass


def is_host_managed(app):
    """Whether ``app`` is an adopted host site (``managed_by == 'host'``).

    A function rather than only the property so the services that guard on
    it can be handed any app-shaped object: a plain attribute comparison
    answers False for one that has no ``managed_by``, where reading a
    property off a stand-in would raise or, on a mock, read as true.
    """
    return getattr(app, 'managed_by', None) == Application.MANAGED_BY_HOST
