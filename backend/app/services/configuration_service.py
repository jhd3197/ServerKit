"""
Configuration Service - Resolve, hash, diff, snapshot & restore app config.

This service produces an IMMUTABLE, deterministic snapshot of an application's
*resolved configuration* (env var keys + masked values, domains, image/tag,
build method/plan, volumes, nginx overrides) before a deployment, hashes it
(SHA-256 over canonical JSON), and can diff two snapshots without ever leaking
secret values.

Design notes
------------
* ``generate_config`` / ``hash_config`` / ``diff_configs`` are PURE and fully
  unit-testable. ``generate_config`` accepts an Application-like object but only
  reads attributes; the heavy lifting (env/domains/volumes extraction) is
  delegated to small helpers that also accept plain data so tests can drive
  them without a DB.
* Secret *values* are never stored. Secret env vars are masked to ``MASK``;
  non-secret env values are stored verbatim (they're already visible config).
* Ordering is deterministic (sorted keys / sorted lists) so equal config →
  equal hash regardless of insertion order.
"""

import hashlib
import json
import logging
import os

from app import db
from app.utils.sensitive_data_filter import MASK, is_sensitive_key

logger = logging.getLogger(__name__)


class ConfigurationService:
    """Build, hash, diff, snapshot and restore application configuration."""

    # ------------------------------------------------------------------ #
    # Pure helpers (no DB) — fully unit-testable                          #
    # ------------------------------------------------------------------ #

    @staticmethod
    def mask_env_value(key, value, is_secret):
        """Return the value to store for an env var.

        Secret-flagged vars and vars whose *name* looks sensitive are masked;
        everything else is stored verbatim (already-visible config).
        """
        if is_secret or is_sensitive_key(key):
            return MASK
        return value if value is not None else ''

    @classmethod
    def build_config(cls, *, env=None, domains=None, image_tag=None,
                     build_method=None, buildpack_plan=None, volumes=None,
                     nginx_overrides=None):
        """Assemble a deterministic config dict from plain pieces.

        This is the pure core of :meth:`generate_config`. ``env`` is a list of
        dicts shaped like ``{'key', 'value', 'is_secret'}``.
        """
        env = env or []
        env_map = {}
        for ev in env:
            key = ev.get('key')
            if not key:
                continue
            env_map[key] = cls.mask_env_value(
                key, ev.get('value'), ev.get('is_secret', False)
            )

        config = {
            'env': dict(sorted(env_map.items())),
            'env_keys': sorted(env_map.keys()),
            'domains': sorted(domains or []),
            'image_tag': image_tag,
            'build_method': build_method,
            'volumes': sorted(volumes or []),
        }
        # Optional keys only present when known — keeps hashes stable for apps
        # that don't use buildpacks / nginx overrides.
        if buildpack_plan is not None:
            config['buildpack_plan'] = buildpack_plan
        if nginx_overrides is not None:
            config['nginx_overrides'] = nginx_overrides
        return config

    @staticmethod
    def hash_config(config):
        """SHA-256 hex digest of the canonical JSON for ``config``.

        Canonical = sorted keys + compact separators, so logically-equal configs
        produce identical hashes regardless of key insertion order.
        """
        canonical = json.dumps(
            config, sort_keys=True, separators=(',', ':'), default=str
        )
        return hashlib.sha256(canonical.encode('utf-8')).hexdigest()

    @staticmethod
    def _diff_string_list(old_list, new_list):
        """Return ``{'added': [...], 'removed': [...]}`` for two string lists."""
        old_set = set(old_list or [])
        new_set = set(new_list or [])
        return {
            'added': sorted(new_set - old_set),
            'removed': sorted(old_set - new_set),
        }

    @classmethod
    def diff_configs(cls, old, new):
        """Structured diff between two config dicts.

        Never leaks secret values: for env we only report KEYS and whether a
        value *changed* (booleans), not the values themselves.
        """
        old = old or {}
        new = new or {}

        old_env = old.get('env', {}) or {}
        new_env = new.get('env', {}) or {}
        old_keys = set(old_env.keys())
        new_keys = set(new_env.keys())

        changed_keys = sorted(
            k for k in (old_keys & new_keys) if old_env.get(k) != new_env.get(k)
        )

        env_diff = {
            'added': sorted(new_keys - old_keys),
            'removed': sorted(old_keys - new_keys),
            'changed': changed_keys,
        }

        diff = {
            'env': env_diff,
            'domains': cls._diff_string_list(
                old.get('domains'), new.get('domains')
            ),
            'volumes': cls._diff_string_list(
                old.get('volumes'), new.get('volumes')
            ),
            'image': {
                'old': old.get('image_tag'),
                'new': new.get('image_tag'),
                'changed': old.get('image_tag') != new.get('image_tag'),
            },
            'build_method': {
                'old': old.get('build_method'),
                'new': new.get('build_method'),
                'changed': old.get('build_method') != new.get('build_method'),
            },
        }
        return diff

    @staticmethod
    def has_changes(diff):
        """True if a diff produced by :meth:`diff_configs` contains any change."""
        env = diff.get('env', {})
        if env.get('added') or env.get('removed') or env.get('changed'):
            return True
        for section in ('domains', 'volumes'):
            s = diff.get(section, {})
            if s.get('added') or s.get('removed'):
                return True
        if diff.get('image', {}).get('changed'):
            return True
        if diff.get('build_method', {}).get('changed'):
            return True
        return False

    @classmethod
    def summarize_diff(cls, diff):
        """Plain-language summary of a diff, e.g.

            "3 environment variables and the image tag (1.2.1 → 1.1.9) changed"

        Used both as a short snapshot row label and as the human-readable
        sentence shown above the technical diff. Always <=255 chars. Returns
        ``'no config changes'`` when nothing changed (kept verbatim — callers
        and tests rely on it).
        """
        parts = []
        env = diff.get('env', {})
        env_count = (
            len(env.get('added', [])) + len(env.get('removed', []))
            + len(env.get('changed', []))
        )
        if env_count:
            parts.append(
                f"{env_count} environment variable{'s' if env_count != 1 else ''}"
            )

        dom = diff.get('domains', {})
        dom_count = len(dom.get('added', [])) + len(dom.get('removed', []))
        if dom_count:
            parts.append(f"{dom_count} domain{'s' if dom_count != 1 else ''}")

        vol = diff.get('volumes', {})
        vol_count = len(vol.get('added', [])) + len(vol.get('removed', []))
        if vol_count:
            parts.append(f"{vol_count} volume{'s' if vol_count != 1 else ''}")

        image = diff.get('image', {})
        if image.get('changed'):
            old_tag = image.get('old')
            new_tag = image.get('new')
            if old_tag or new_tag:
                parts.append(
                    f"the image tag ({old_tag or '—'} → {new_tag or '—'})"
                )
            else:
                parts.append('the image tag')

        if diff.get('build_method', {}).get('changed'):
            parts.append('the build method')

        if not parts:
            return 'no config changes'

        # Join into a natural sentence: "A, B and C changed".
        if len(parts) == 1:
            subject = parts[0]
        else:
            subject = f"{', '.join(parts[:-1])} and {parts[-1]}"

        sentence = f"{subject} changed"
        # Capitalize the leading character without disturbing the rest
        # (e.g. a leading number stays a number).
        sentence = sentence[0].upper() + sentence[1:]
        return sentence[:255]

    # ------------------------------------------------------------------ #
    # DB-backed resolution                                                #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _resolve_env(application):
        """Resolve env vars as a list of ``{key, value, is_secret}`` dicts."""
        try:
            from app.models.env_variable import EnvironmentVariable
            rows = EnvironmentVariable.query.filter_by(
                application_id=application.id
            ).all()
            return [
                {'key': r.key, 'value': r.value, 'is_secret': bool(r.is_secret)}
                for r in rows
            ]
        except Exception as e:  # pragma: no cover - defensive
            logger.warning('Could not resolve env vars for app %s: %s',
                           getattr(application, 'id', '?'), e)
            return []

    @staticmethod
    def _resolve_domains(application):
        """Resolve domain names attached to the app."""
        try:
            # live_domains: the snapshot / serverkit.yaml records what the app
            # actually serves, and it is replayed on restore.
            return [d.name for d in (application.live_domains or [])]
        except Exception:  # pragma: no cover - defensive
            return []

    @staticmethod
    def _resolve_volumes(application):
        """Best-effort extraction of named/host volumes from the compose file.

        Read-only: parses the app's compose file if present. Returns a sorted,
        de-duplicated list of volume strings. Never raises.
        """
        volumes = []
        try:
            root = getattr(application, 'root_path', None)
            if not root:
                return []
            compose_name = getattr(application, 'compose_file', None) or 'docker-compose.yml'
            compose_path = os.path.join(root, compose_name)
            if not os.path.exists(compose_path):
                return []
            try:
                import yaml  # optional dependency
            except ImportError:
                return []
            with open(compose_path, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f) or {}
            services = data.get('services', {}) or {}
            for svc in services.values():
                if not isinstance(svc, dict):
                    continue
                for vol in (svc.get('volumes') or []):
                    if isinstance(vol, str):
                        volumes.append(vol)
                    elif isinstance(vol, dict):
                        src = vol.get('source')
                        tgt = vol.get('target')
                        if src or tgt:
                            volumes.append(f"{src or ''}:{tgt or ''}")
            # Top-level named volumes
            for vol_name in (data.get('volumes', {}) or {}).keys():
                volumes.append(vol_name)
        except Exception as e:  # pragma: no cover - defensive
            logger.debug('Volume resolution failed for app %s: %s',
                         getattr(application, 'id', '?'), e)
        return sorted(set(volumes))

    @staticmethod
    def _resolve_build(application):
        """Resolve (build_method, image_tag, buildpack_plan) for the app."""
        build_method = None
        image_tag = getattr(application, 'docker_image', None)
        buildpack_plan = None
        try:
            from app.services.build_service import BuildService
            cfg = BuildService.get_app_build_config(application.id)
            if cfg:
                build_method = cfg.get('build_method')
                buildpack_plan = cfg.get('buildpack') or cfg.get('build_plan')
        except Exception:  # pragma: no cover - defensive
            pass
        return build_method, image_tag, buildpack_plan

    @classmethod
    def generate_config(cls, application):
        """Build the deterministic resolved-config dict for an Application.

        Reads only; does not write. Secret values are masked.
        """
        env = cls._resolve_env(application)
        domains = cls._resolve_domains(application)
        volumes = cls._resolve_volumes(application)
        build_method, image_tag, buildpack_plan = cls._resolve_build(application)

        return cls.build_config(
            env=env,
            domains=domains,
            image_tag=image_tag,
            build_method=build_method,
            buildpack_plan=buildpack_plan,
            volumes=volumes,
            nginx_overrides=None,
        )

    # ------------------------------------------------------------------ #
    # Snapshot lifecycle                                                  #
    # ------------------------------------------------------------------ #

    @classmethod
    def create_snapshot(cls, application, deployment=None):
        """Capture an immutable config snapshot for ``application``.

        Dedupe: if the most recent snapshot for the app has the same hash, the
        existing row is returned unchanged (no duplicate write).

        Returns the (existing or new) :class:`DeploymentSnapshot`.
        """
        from app.models.deployment_snapshot import DeploymentSnapshot

        config = cls.generate_config(application)
        snapshot_hash = cls.hash_config(config)

        latest = DeploymentSnapshot.get_latest(application.id)
        if latest and latest.snapshot_hash == snapshot_hash:
            # Identical config — reuse the existing snapshot.
            return latest

        # Summary relative to the previous snapshot (if any).
        if latest:
            prev_config = latest.get_config()
            summary = cls.summarize_diff(cls.diff_configs(prev_config, config))
        else:
            summary = 'initial config snapshot'

        snapshot = DeploymentSnapshot(
            application_id=application.id,
            deployment_id=getattr(deployment, 'id', None) if deployment else None,
            snapshot_hash=snapshot_hash,
            config_json=json.dumps(config, sort_keys=True, separators=(',', ':')),
            summary=summary,
        )
        db.session.add(snapshot)
        db.session.commit()
        return snapshot

    @classmethod
    def restore_snapshot(cls, snapshot_id, user_id=None):
        """Restore a snapshot's config to the app and trigger a redeploy.

        Best-effort. Restores env vars (non-masked values only — masked secrets
        are left untouched so we never overwrite a real secret with ``MASK``) and
        domains, then enqueues a redeploy job. Returns a result dict.
        """
        from app.models.deployment_snapshot import DeploymentSnapshot
        from app.models.application import Application

        snapshot = DeploymentSnapshot.query.get(snapshot_id)
        if not snapshot:
            return {'success': False, 'error': 'Config checkpoint not found'}

        # query_active(): restoring a snapshot rewrites env and redeploys, so a
        # tombstoned app must 404 here rather than be brought back to life
        # outside the Recycle Bin.
        application = Application.query_active().filter_by(
            id=snapshot.application_id).first()
        if not application:
            return {'success': False, 'error': 'Service not found'}

        config = snapshot.get_config()
        result = {
            'success': True,
            'snapshot_id': snapshot_id,
            'application_id': application.id,
            'restored': {'env': [], 'domains_noop': True},
            'skipped_secrets': [],
            'redeploy': None,
            'warnings': [],
        }

        # --- Restore env vars (skip masked secret values) ---------------- #
        try:
            from app.services.env_service import EnvService
            for key, value in (config.get('env', {}) or {}).items():
                if value == MASK:
                    # Don't clobber a real secret with the mask placeholder.
                    result['skipped_secrets'].append(key)
                    continue
                _, _, err = EnvService.set_env_var(
                    application.id, key, value, user_id=user_id
                )
                if err:
                    result['warnings'].append(f'env {key}: {err}')
                else:
                    result['restored']['env'].append(key)
        except Exception as e:  # pragma: no cover - defensive
            result['warnings'].append(f'env restore failed: {e}')

        # --- Trigger a redeploy (best-effort) ---------------------------- #
        # Prefer the jobs SDK when a deploy handler is registered (keeps the
        # request snappy / async); otherwise fall back to a direct synchronous
        # DeploymentService.deploy(). Either way, restoring config above is the
        # primary, already-committed effect — a redeploy failure here does not
        # fail the restore.
        result['redeploy'] = cls._trigger_redeploy(application, snapshot_id, user_id)
        if result['redeploy'] and not result['redeploy'].get('triggered'):
            err = result['redeploy'].get('error')
            if err:
                result['warnings'].append(f'redeploy not triggered: {err}')

        return result

    @staticmethod
    def _trigger_redeploy(application, snapshot_id, user_id):
        """Best-effort redeploy: jobs SDK if a handler exists, else direct call."""
        # 1) Jobs SDK path — only if a handler is registered for the kind.
        try:
            from app.jobs import registry
            from app.plugins_sdk import jobs
            if 'deployment.deploy' in set(registry.registered_kinds()):
                job = jobs.enqueue(
                    'deployment.deploy',
                    payload={
                        'app_id': application.id,
                        'trigger': 'restore',
                        'snapshot_id': snapshot_id,
                        'user_id': user_id,
                    },
                    owner_type='application',
                    owner_id=application.id,
                )
                return {'triggered': True, 'mode': 'job', 'job': job}
        except Exception as e:  # pragma: no cover - defensive
            logger.debug('Jobs redeploy path failed, falling back: %s', e)

        # 2) Direct synchronous path.
        try:
            from app.services.deployment_service import DeploymentService
            deploy_result = DeploymentService.deploy(
                application.id, user_id=user_id, trigger='rollback'
            )
            return {
                'triggered': bool(deploy_result.get('success')),
                'mode': 'direct',
                'result': deploy_result,
                'error': deploy_result.get('error'),
            }
        except Exception as e:
            return {'triggered': False, 'error': str(e)}
