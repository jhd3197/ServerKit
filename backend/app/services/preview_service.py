"""PR Preview Environments — reconciliation + provisioning service.

When a Git pull request is opened/updated, ServerKit deploys an isolated
preview of that branch to a temporary domain and tears it down when the PR
closes.

The *testable core* is two pure functions:

  * :meth:`PreviewService.render_domain` — expand a domain template against a
    PR context (deterministic, no I/O).
  * :meth:`PreviewService.reconcile` — diff open PRs against the active
    previews and return the create/destroy/update decisions (no I/O).

Everything else (``create_preview``/``destroy_preview``/``sync_previews``/
``expire_stale``) is orchestration that touches the DB and — where a Docker/DNS/
WordPress environment is actually available — provisions or tears down real
infrastructure. All of it is BEST-EFFORT and try/except-guarded so it never
raises in a dev/test environment that lacks Docker or DNS.
"""
import logging
import re
from datetime import datetime, timedelta

from app.utils.slug import slugify

logger = logging.getLogger(__name__)

# Job kinds — also registered in :meth:`PreviewService.register_jobs`.
JOB_CREATE = 'preview.create'
JOB_DESTROY = 'preview.destroy'
JOB_SYNC = 'preview.sync'
JOB_EXPIRE = 'preview.expire'


def _slugify_branch(branch):
    """DNS-safe label for a branch name.

    ``feature/Login-Page`` -> ``feature-login-page``. Lowercased, every run of
    non-alphanumerics collapses to a single dash, leading/trailing dashes
    trimmed. Empty input yields ``branch``.
    """
    return slugify(branch) or 'branch'


class PreviewService:
    """Static service for PR preview environments."""

    # ------------------------------------------------------------------ #
    # Pure core — fully unit-testable, no I/O
    # ------------------------------------------------------------------ #

    @staticmethod
    def render_domain(template, ctx):
        """Expand a preview-domain ``template`` against a PR context ``ctx``.

        Supported placeholders:
          * ``{pr_number}`` — the PR number.
          * ``{branch}``    — the branch name, slugified to a DNS-safe label.
          * ``{app_domain}``/``{base_domain}`` — the application's base domain.

        Deterministic and side-effect free. Unknown placeholders are left as-is
        rather than raising, and the result is lowercased (hostnames are
        case-insensitive). Returns ``''`` for a falsy template.
        """
        if not template:
            return ''
        ctx = ctx or {}
        app_domain = (ctx.get('app_domain') or ctx.get('base_domain') or '')
        values = {
            'pr_number': str(ctx.get('pr_number', '')),
            'branch': _slugify_branch(ctx.get('branch')),
            'app_domain': app_domain,
            'base_domain': app_domain,
        }

        def _replace(match):
            key = match.group(1)
            return values.get(key, match.group(0))

        rendered = re.sub(r'\{([a-z_]+)\}', _replace, template)
        return rendered.strip().lower()

    @staticmethod
    def reconcile(open_prs, active_previews):
        """Diff open PRs against active previews.

        Args:
            open_prs: iterable of dicts with at least ``pr_number``; optionally
                ``commit_sha``, ``branch``, ``pr_title``.
            active_previews: iterable of dicts/objects describing currently-live
                previews, each exposing ``pr_number``, ``commit_sha`` and
                ``status``. (Both dict and ORM-row shapes are accepted.)

        Returns a dict::

            {'to_create': [pr, ...],   # open PR with no live preview
             'to_destroy': [pv, ...],  # live preview whose PR is closed/missing
             'to_update': [pr, ...]}   # open PR whose preview is on an old commit

        Pure — no I/O, no DB. Destroyed previews are ignored as "not live".
        """
        def _get(obj, key):
            if isinstance(obj, dict):
                return obj.get(key)
            return getattr(obj, key, None)

        open_by_pr = {}
        for pr in (open_prs or []):
            num = _get(pr, 'pr_number')
            if num is not None:
                open_by_pr[num] = pr

        # Map live previews by PR number. A preview already marked destroyed is
        # not "live" and shouldn't be re-destroyed.
        live_by_pr = {}
        for pv in (active_previews or []):
            if _get(pv, 'status') == 'destroyed':
                continue
            num = _get(pv, 'pr_number')
            if num is not None:
                live_by_pr[num] = pv

        to_create, to_update, to_destroy = [], [], []

        for num, pr in open_by_pr.items():
            preview = live_by_pr.get(num)
            if preview is None:
                to_create.append(pr)
                continue
            # Same PR, already has a preview — redeploy only if the tip moved.
            pr_sha = _get(pr, 'commit_sha')
            pv_sha = _get(preview, 'commit_sha')
            if pr_sha and pr_sha != pv_sha:
                to_update.append(pr)

        for num, preview in live_by_pr.items():
            if num not in open_by_pr:
                to_destroy.append(preview)

        return {'to_create': to_create, 'to_destroy': to_destroy, 'to_update': to_update}

    # ------------------------------------------------------------------ #
    # Settings
    # ------------------------------------------------------------------ #

    @classmethod
    def get_settings(cls, application_id):
        """Return the (existing or default, unsaved) settings row for an app."""
        from app.models.application_preview import ApplicationPreviewSettings
        settings = ApplicationPreviewSettings.query.get(application_id)
        if settings:
            return settings
        # Return a transient default so callers always get a usable object.
        return ApplicationPreviewSettings(
            application_id=application_id,
            enabled=False,
            domain_template=ApplicationPreviewSettings.DEFAULT_DOMAIN_TEMPLATE,
        )

    @classmethod
    def enable_previews(cls, application_id, settings):
        """Create/update the per-app preview settings (upsert). ``settings`` is a
        dict of any of ``enabled``/``domain_template``/``target_server_id``/
        ``ttl_days``. Returns the persisted row's ``to_dict()``."""
        from app import db
        from app.models.application_preview import ApplicationPreviewSettings

        settings = settings or {}
        row = ApplicationPreviewSettings.query.get(application_id)
        if not row:
            row = ApplicationPreviewSettings(application_id=application_id)
            db.session.add(row)

        if 'enabled' in settings:
            row.enabled = bool(settings['enabled'])
        if 'domain_template' in settings and settings['domain_template']:
            row.domain_template = str(settings['domain_template'])
        if 'target_server_id' in settings:
            row.target_server_id = settings['target_server_id'] or None
        if 'ttl_days' in settings:
            ttl = settings['ttl_days']
            try:
                row.ttl_days = int(ttl) if ttl not in (None, '') else None
            except (TypeError, ValueError):
                row.ttl_days = None

        try:
            db.session.commit()
        except Exception as exc:  # pragma: no cover - defensive
            db.session.rollback()
            logger.warning('enable_previews commit failed for app %s: %s', application_id, exc)
            raise
        return row.to_dict()

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #

    @classmethod
    def _app_base_domain(cls, app):
        """Best-effort base domain for an app's previews: the app's primary
        domain, else ``<slug>.<sites-base-domain>``, else the bare slug."""
        try:
            domains = list(getattr(app, 'domains', []) or [])
            primary = next((d for d in domains if getattr(d, 'is_primary', False)), None)
            if primary and getattr(primary, 'name', None):
                return primary.name
            if domains and getattr(domains[0], 'name', None):
                return domains[0].name
        except Exception:
            pass
        try:
            from app.services.site_domain_service import SiteDomainService
            sub = SiteDomainService.subdomain_for(app.name)
            if sub:
                return sub
        except Exception:
            pass
        from app.utils.slug import slugify
        return slugify(getattr(app, 'name', '') or 'app') or 'app'

    @classmethod
    def _domain_for(cls, app, settings, pr_number, branch):
        from app.models.application_preview import ApplicationPreviewSettings
        template = (getattr(settings, 'domain_template', None)
                    or ApplicationPreviewSettings.DEFAULT_DOMAIN_TEMPLATE)
        return cls.render_domain(template, {
            'pr_number': pr_number,
            'branch': branch,
            'app_domain': cls._app_base_domain(app),
        })

    @staticmethod
    def _pr_field(pr_payload, *keys, default=None):
        for k in keys:
            if isinstance(pr_payload, dict) and pr_payload.get(k) not in (None, ''):
                return pr_payload.get(k)
        return default

    # ------------------------------------------------------------------ #
    # Orchestration — best-effort, never raises
    # ------------------------------------------------------------------ #

    @classmethod
    def create_preview(cls, app, pr_payload):
        """Create (or update-in-place) a preview for a PR. Best-effort.

        Writes/updates an :class:`ApplicationPreview` row, renders the domain,
        and provisions real infra only where a Docker/WordPress environment is
        available. Returns the preview ``to_dict()`` (or ``{'error': ...}``).
        Never raises.
        """
        from app import db
        from app.models.application_preview import ApplicationPreview

        try:
            pr_number = cls._pr_field(pr_payload, 'pr_number', 'number')
            if pr_number is None:
                return {'error': 'pr_number is required'}
            pr_number = int(pr_number)
            branch = cls._pr_field(pr_payload, 'branch', 'head_ref', 'head')
            pr_title = cls._pr_field(pr_payload, 'pr_title', 'title')
            commit_sha = cls._pr_field(pr_payload, 'commit_sha', 'sha', 'head_sha')

            settings = cls.get_settings(app.id)
            if not getattr(settings, 'enabled', False):
                return {'skipped': True, 'reason': 'previews_disabled'}

            preview = ApplicationPreview.query.filter_by(
                application_id=app.id, pr_number=pr_number).first()
            if not preview:
                preview = ApplicationPreview(application_id=app.id, pr_number=pr_number)
                db.session.add(preview)

            preview.branch = branch
            preview.pr_title = pr_title
            preview.commit_sha = commit_sha
            preview.domain = cls._domain_for(app, settings, pr_number, branch)
            preview.status = ApplicationPreview.STATUS_BUILDING
            preview.deleted_at = None

            ttl_days = getattr(settings, 'ttl_days', None)
            if ttl_days:
                preview.expires_at = datetime.utcnow() + timedelta(days=int(ttl_days))

            db.session.commit()

            # Best-effort provisioning — degrade gracefully when unavailable.
            provisioned = cls._provision(app, preview)
            preview.status = (ApplicationPreview.STATUS_RUNNING
                              if provisioned.get('ok')
                              else ApplicationPreview.STATUS_FAILED)
            if provisioned.get('container_ids'):
                preview.set_container_ids(provisioned['container_ids'])
            db.session.commit()
            return preview.to_dict()
        except Exception as exc:
            logger.warning('create_preview failed: %s', exc)
            try:
                db.session.rollback()
            except Exception:
                pass
            return {'error': str(exc)}

    @classmethod
    def _provision(cls, app, preview):
        """Best-effort real provisioning. Returns ``{'ok': bool, 'container_ids': [...]}``.

        For WordPress apps, delegate to the WP preview hook. For other app types
        we currently only record the row + domain (a deeper Docker clone is a
        roadmap item); we still report ``ok`` so the preview shows as running in
        environments where the row is all that's expected. All failures are
        swallowed and surfaced as ``ok: False``.
        """
        try:
            if getattr(app, 'app_type', None) == 'wordpress':
                try:
                    from app.services.wordpress_bridge import wordpress_service
                    from app.models.wordpress_site import WordPressSite
                    WordPressService = wordpress_service()
                    site = WordPressSite.query.filter_by(application_id=app.id).first()
                    if site:
                        res = WordPressService.create_preview_instance(
                            site, preview.pr_number, domain=preview.domain,
                            branch=preview.branch)
                        return {'ok': bool(res.get('success', True)),
                                'container_ids': res.get('container_ids', [])}
                except Exception as exc:
                    logger.info('WP preview provisioning unavailable: %s', exc)
                    return {'ok': False, 'container_ids': []}
            # Non-WP: clone the manifest-resolved config (env + per-preview
            # overrides + domain) when the app is manifest-managed (#20). The
            # resolved config is the portable unit; a full Docker clone for
            # generic apps remains best-effort future work.
            manifest_preview = None
            try:
                from app.services.manifest_preview_service import ManifestPreviewService
                manifest_preview = ManifestPreviewService.build_preview_config(app, preview)
            except Exception as exc:
                logger.info('manifest preview config unavailable: %s', exc)
            return {'ok': True, 'container_ids': [],
                    'manifest_preview': manifest_preview}
        except Exception as exc:
            logger.info('preview provisioning unavailable: %s', exc)
            return {'ok': False, 'container_ids': []}

    @classmethod
    def destroy_preview(cls, preview_id):
        """Tear down a preview and mark it destroyed. Best-effort; never raises."""
        from app import db
        from app.models.application_preview import ApplicationPreview

        try:
            preview = ApplicationPreview.query.get(preview_id)
            if not preview:
                return {'error': 'preview not found'}
            if preview.status == ApplicationPreview.STATUS_DESTROYED:
                return preview.to_dict()

            app = None
            try:
                from app.models import Application
                # Deliberately NOT query_active: this is the teardown path, and
                # a deleted app's previews still have to be torn down. Scoping
                # it here would leak the WordPress preview instance.
                app = Application.query.get(preview.application_id)
            except Exception:
                pass

            # Best-effort WordPress teardown.
            if app is not None and getattr(app, 'app_type', None) == 'wordpress':
                try:
                    from app.services.wordpress_bridge import wordpress_service
                    from app.models.wordpress_site import WordPressSite
                    WordPressService = wordpress_service()
                    site = WordPressSite.query.filter_by(application_id=app.id).first()
                    if site:
                        WordPressService.destroy_preview_instance(site, preview.pr_number)
                except Exception as exc:
                    logger.info('WP preview teardown unavailable: %s', exc)

            preview.status = ApplicationPreview.STATUS_DESTROYED
            preview.deleted_at = datetime.utcnow()
            preview.set_container_ids([])
            db.session.commit()
            return preview.to_dict()
        except Exception as exc:
            logger.warning('destroy_preview failed: %s', exc)
            try:
                db.session.rollback()
            except Exception:
                pass
            return {'error': str(exc)}

    @classmethod
    def sync_previews(cls, application_id):
        """Reconcile an app's live previews against its open PRs.

        Reads open PRs from a connected source provider when available; in a
        dev/test environment with no provider this is a safe no-op (no PRs ⇒ no
        creates, and existing previews stay put). Best-effort; never raises.
        """
        from app.models.application_preview import ApplicationPreview

        try:
            from app.models import Application
            # query_active: syncing provisions preview infra (domains,
            # containers) — never for a deleted app.
            app = Application.query_active().filter_by(id=application_id).first()
            if not app:
                return {'error': 'Service not found'}

            open_prs = cls._fetch_open_prs(app)
            active = ApplicationPreview.query.filter(
                ApplicationPreview.application_id == application_id,
                ApplicationPreview.status != ApplicationPreview.STATUS_DESTROYED,
            ).all()

            plan = cls.reconcile(open_prs, active)
            created = destroyed = updated = 0
            for pr in plan['to_create']:
                cls.create_preview(app, pr)
                created += 1
            for pr in plan['to_update']:
                cls.create_preview(app, pr)  # idempotent update-in-place
                updated += 1
            for preview in plan['to_destroy']:
                pid = preview.get('id') if isinstance(preview, dict) else getattr(preview, 'id', None)
                cls.destroy_preview(pid)
                destroyed += 1

            return {'success': True, 'created': created,
                    'updated': updated, 'destroyed': destroyed}
        except Exception as exc:
            logger.warning('sync_previews failed for app %s: %s', application_id, exc)
            return {'error': str(exc)}

    @classmethod
    def _fetch_open_prs(cls, app):
        """Best-effort: list open PRs for the app's connected repo. Returns a
        list of ``{pr_number, branch, commit_sha, pr_title}`` dicts, or ``[]``
        when no provider is connected (e.g. dev/test)."""
        try:
            from app.services.source_connection_service import SourceConnectionService
            fn = getattr(SourceConnectionService, 'list_open_pull_requests', None)
            if callable(fn):
                prs = fn(app.id) or []
                return prs if isinstance(prs, list) else []
        except Exception as exc:
            logger.debug('open-PR listing unavailable for app %s: %s', app.id, exc)
        return []

    @classmethod
    def expire_stale(cls):
        """Destroy previews whose ``expires_at`` has passed. For a scheduled job.
        Returns ``{'expired': n}``. Best-effort; never raises."""
        from app.models.application_preview import ApplicationPreview

        try:
            now = datetime.utcnow()
            stale = ApplicationPreview.query.filter(
                ApplicationPreview.expires_at.isnot(None),
                ApplicationPreview.expires_at < now,
                ApplicationPreview.status != ApplicationPreview.STATUS_DESTROYED,
            ).all()
            for preview in stale:
                cls.destroy_preview(preview.id)
            return {'expired': len(stale)}
        except Exception as exc:
            logger.warning('expire_stale failed: %s', exc)
            return {'expired': 0, 'error': str(exc)}

    # ------------------------------------------------------------------ #
    # Jobs
    # ------------------------------------------------------------------ #

    @classmethod
    def _job_create(cls, job):
        from app.models import Application
        payload = job.get_payload() or {}
        # query_active: a queued preview job can outlive its app.
        app = Application.query_active().filter_by(
            id=payload.get('application_id')).first()
        if not app:
            return {'error': 'Service not found'}
        return cls.create_preview(app, payload.get('pr') or payload)

    @classmethod
    def _job_destroy(cls, job):
        payload = job.get_payload() or {}
        return cls.destroy_preview(payload.get('preview_id'))

    @classmethod
    def _job_sync(cls, job):
        payload = job.get_payload() or {}
        return cls.sync_previews(payload.get('application_id'))

    @classmethod
    def _job_expire(cls, _job):
        return cls.expire_stale()

    @classmethod
    def register_jobs(cls):
        """Register the preview job kinds with the unified job registry.
        Called once at app startup."""
        from app.jobs import registry
        registry.register(JOB_CREATE, cls._job_create, replace=True)
        registry.register(JOB_DESTROY, cls._job_destroy, replace=True)
        registry.register(JOB_SYNC, cls._job_sync, replace=True)
        registry.register(JOB_EXPIRE, cls._job_expire, replace=True)
