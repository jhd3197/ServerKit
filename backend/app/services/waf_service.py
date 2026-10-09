"""Per-application WAF management (ModSecurity v3 + OWASP Core Rule Set).

Mirrors the serverkit-image-scan extension's ImageScannerService:
classmethods that shell out to install an external tool and return
``{'success': ...}`` dicts, degrading gracefully when the host lacks
ModSecurity. The rule/snippet renderers are pure functions so they are
unit-testable without nginx or libmodsecurity present.

Integration note (nginx wiring)
-------------------------------
ServerKit writes one full ``server { ... }`` block per managed app into
``/etc/nginx/sites-available/<vhost>`` via ``NginxService.create_site``. That
file is regenerated wholesale, and the only additive include hook that exists
today (``/etc/nginx/serverkit-locations/*.conf``) is *location*-level inside the
**panel's** server block — the wrong scope for per-app, server-level WAF
directives. To stay additive and never rewrite the app's generated vhost, we:

  1. render the ModSecurity rules to ``WAF_RULES_DIR/<app>.conf``;
  2. render the nginx snippet (``modsecurity on; modsecurity_rules_file ...``)
     to ``WAF_RULES_DIR/<app>.include.conf``;
  3. idempotently inject a single ``include <snippet>;`` line into the app's own
     vhost inside the first ``server { ... }`` block, guarded by a sentinel
     marker so re-applies are no-ops.

If the app's vhost file cannot be found, ``apply`` degrades gracefully: it still
writes the rules + snippet and returns ``manual_include`` so an operator (or a
future ``create_site`` hook) can wire it up. We never regenerate or rewrite the
existing config.
"""
import json
import logging
import os
import re
import threading
from datetime import datetime
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Serverkit-managed WAF artifacts live under the conf.d dir install.sh creates.
WAF_RULES_DIR = os.environ.get('SERVERKIT_WAF_DIR', '/etc/nginx/serverkit-conf.d/waf')

# Path to the OWASP CRS entrypoint (Include'd by the per-app rules file).
OWASP_CRS_PATH = os.environ.get(
    'SERVERKIT_OWASP_CRS_PATH',
    '/usr/share/modsecurity-crs/owasp-crs.load',
)

# ModSecurity JSON audit log. Injectable for tests via the ``log_path`` arg of
# ``events`` or the SERVERKIT_MODSEC_AUDIT_LOG env var.
MODSEC_AUDIT_LOG = os.environ.get('SERVERKIT_MODSEC_AUDIT_LOG', '/var/log/modsec_audit.log')

# Where managed app vhosts live. Imported, not mirrored: "mirrors
# NginxService.SITES_AVAILABLE" is a comment, and a comment is not a
# constraint — the two drift the moment either side moves (plan 75 §G4).
from app.services.nginx_service import NginxService  # noqa: E402

NGINX_CONF_DIR = NginxService.NGINX_CONF_DIR
SITES_AVAILABLE = NginxService.SITES_AVAILABLE

# Sentinel marking our additive include so re-applies are idempotent.
_INCLUDE_MARKER = '# serverkit-waf'

# nginx package names per package manager, used by the best-effort installer.
_PKG_BY_MANAGER = {
    'apt': ['libmodsecurity3', 'modsecurity-crs'],
    'dnf': ['mod_security', 'mod_security_crs'],
    'yum': ['mod_security', 'mod_security_crs'],
}


class WafService:
    """Install ModSecurity and manage per-application WAF policies."""

    _install_lock = threading.Lock()

    # ------------------------------------------------------------------
    # Installation (best-effort; not unit-tested)
    # ------------------------------------------------------------------
    @classmethod
    def modsecurity_installed(cls) -> bool:
        """Return True when libmodsecurity / the nginx connector look present.

        Checked without invoking nginx: we look for the connector module and
        the OWASP CRS entrypoint. This is intentionally lenient — enforcement
        ultimately depends on the host's nginx build including
        ``ngx_http_modsecurity_module``.
        """
        module_candidates = [
            '/usr/lib/nginx/modules/ngx_http_modsecurity_module.so',
            '/usr/share/nginx/modules/ngx_http_modsecurity_module.so',
            '/etc/nginx/modules/ngx_http_modsecurity_module.so',
        ]
        if any(os.path.exists(p) for p in module_candidates):
            return True
        # Fall back to the system utility check for the shared lib / CRS.
        try:
            from app.utils.system import is_command_available
            if is_command_available('modsecurity'):
                return True
        except Exception:
            pass
        return os.path.exists(OWASP_CRS_PATH)

    @classmethod
    def install_modsecurity(cls) -> Dict:
        """Install libmodsecurity, the nginx connector, and the OWASP CRS.

        Distro-aware via ``app.utils.system`` package helpers. Best-effort: on
        hosts without a supported package manager (or on Windows dev boxes) it
        returns a ``success: False`` dict rather than raising.
        """
        with cls._install_lock:
            if cls.modsecurity_installed():
                return {'success': True, 'message': 'ModSecurity already installed'}
            try:
                from app.utils.system import PackageManager
            except Exception as e:  # pragma: no cover - import guard
                return {'success': False, 'error': f'system utils unavailable: {e}'}

            manager = PackageManager.detect()
            if manager is None:
                return {
                    'success': False,
                    'error': 'No supported package manager found (apt/dnf/yum)',
                }
            packages = _PKG_BY_MANAGER.get(manager, [])
            try:
                result = PackageManager.install(packages, timeout=600)
                if result.returncode != 0:
                    return {
                        'success': False,
                        'error': (result.stderr or 'package install failed')[:300],
                    }
                return {
                    'success': True,
                    'message': f'Installed {", ".join(packages)} via {manager}',
                    'note': (
                        'nginx must load ngx_http_modsecurity_module for '
                        'enforcement; install the connector if your distro '
                        'ships it separately.'
                    ),
                }
            except Exception as e:
                return {'success': False, 'error': str(e)[:300]}

    # ------------------------------------------------------------------
    # Pure renderers (unit-testable, no I/O)
    # ------------------------------------------------------------------
    @staticmethod
    def _engine_directive(mode: str) -> str:
        return {
            'block': 'On',
            'detect': 'DetectionOnly',
            'off': 'Off',
        }.get(mode, 'Off')

    @classmethod
    def render_rules(cls, policy, crs_path: str = OWASP_CRS_PATH) -> str:
        """Render the ModSecurity rules for one application as a string.

        Includes the engine directive, the OWASP CRS include, the paranoia
        level + anomaly threshold (set before the CRS is included so the CRS
        picks them up), and one ``SecRuleRemoveById`` per disabled rule (after
        the include, so the targeted rules exist when removed).
        """
        mode = getattr(policy, 'mode', 'off')
        paranoia = max(1, min(4, int(getattr(policy, 'paranoia_level', 1) or 1)))
        anomaly = int(getattr(policy, 'anomaly_threshold', 5) or 5)
        engine = cls._engine_directive(mode)

        lines = [
            '# ServerKit-managed WAF rules. Do not edit by hand.',
            f'# application_id={getattr(policy, "application_id", "?")} mode={mode}',
            f'SecRuleEngine {engine}',
        ]

        if mode != 'off':
            # CRS reads these tx vars during its own initialisation, so they
            # must be set *before* the CRS Include.
            lines.append(
                'SecAction "id:900000,phase:1,nolog,pass,t:none,'
                f'setvar:tx.blocking_paranoia_level={paranoia},'
                f'setvar:tx.detection_paranoia_level={paranoia},'
                f'setvar:tx.inbound_anomaly_score_threshold={anomaly},'
                f'setvar:tx.outbound_anomaly_score_threshold={anomaly}"'
            )
            lines.append(f'Include {crs_path}')

            for rule_id in cls._normalize_rule_ids(getattr(policy, 'disabled_rules', [])):
                lines.append(f'SecRuleRemoveById {rule_id}')

        return '\n'.join(lines) + '\n'

    @staticmethod
    def _normalize_rule_ids(rule_ids) -> List[str]:
        """Keep only sane, injection-safe numeric CRS rule IDs."""
        out = []
        for rid in rule_ids or []:
            rid = str(rid).strip()
            if rid.isdigit():
                out.append(rid)
        return out

    @classmethod
    def nginx_snippet(cls, policy, rules_path: str) -> str:
        """Render the nginx directives that activate the WAF for this app.

        When the policy is enforcing/detecting, emit ``modsecurity on;`` plus
        the rules-file include. When off, emit ``modsecurity off;`` so the
        directive is explicit (and an existing include can be neutralised
        without removal).
        """
        mode = getattr(policy, 'mode', 'off')
        if mode == 'off':
            return f'{_INCLUDE_MARKER}\nmodsecurity off;\n'
        return (
            f'{_INCLUDE_MARKER}\n'
            'modsecurity on;\n'
            f'modsecurity_rules_file {rules_path};\n'
        )

    # ------------------------------------------------------------------
    # Policy persistence
    # ------------------------------------------------------------------
    @classmethod
    def get_or_create_policy(cls, app_id: int):
        """Return the app's WafPolicy, creating a default (off) one if absent."""
        from app import db
        from app.models.waf_policy import WafPolicy

        policy = WafPolicy.query.filter_by(application_id=app_id).first()
        if policy is None:
            policy = WafPolicy(application_id=app_id, mode='off')
            db.session.add(policy)
            db.session.commit()
        return policy

    @classmethod
    def set_policy(cls, app_id: int, **fields):
        """Validate and persist policy fields. Raises ValueError on bad input."""
        from app import db
        from app.models.waf_policy import WafPolicy

        policy = cls.get_or_create_policy(app_id)

        if 'mode' in fields and fields['mode'] is not None:
            mode = fields['mode']
            if mode not in WafPolicy.MODES:
                raise ValueError(
                    f"Invalid mode '{mode}'; expected one of {', '.join(WafPolicy.MODES)}"
                )
            policy.mode = mode

        if 'paranoia_level' in fields and fields['paranoia_level'] is not None:
            try:
                level = int(fields['paranoia_level'])
            except (TypeError, ValueError):
                raise ValueError('paranoia_level must be an integer 1-4')
            policy.paranoia_level = max(1, min(4, level))

        if 'anomaly_threshold' in fields and fields['anomaly_threshold'] is not None:
            try:
                policy.anomaly_threshold = int(fields['anomaly_threshold'])
            except (TypeError, ValueError):
                raise ValueError('anomaly_threshold must be an integer')

        if 'disabled_rule_ids' in fields and fields['disabled_rule_ids'] is not None:
            ids = fields['disabled_rule_ids']
            if not isinstance(ids, (list, tuple)):
                raise ValueError('disabled_rule_ids must be a list')
            policy.disabled_rules = list(ids)

        db.session.commit()
        return policy

    # ------------------------------------------------------------------
    # Filesystem / nginx side-effects (isolated for monkeypatching)
    # ------------------------------------------------------------------
    @classmethod
    def _ensure_rules_dir(cls) -> None:
        from app.utils.system import run_privileged
        run_privileged(['mkdir', '-p', WAF_RULES_DIR])

    @classmethod
    def _write_file(cls, path: str, content: str) -> Dict:
        """Write *content* to *path* with privilege — the shared door (plan 75 §G2)."""
        from app.utils.system import write_privileged_file
        return write_privileged_file(path, content)

    @classmethod
    def _nginx_test_and_reload(cls) -> Dict:
        """Run ``nginx -t`` then reload, reusing NginxService's helper."""
        from app.services.nginx_service import NginxService
        return NginxService.reload()

    @classmethod
    def _vhost_path(cls, application_id: int) -> Optional[str]:
        """Locate the app's vhost file in sites-available.

        ServerKit names vhosts by hostname/app name (not DB id), so we search
        sites-available for the first server block that is clearly this app's:
        we match the app name or any of its domains against ``server_name``.
        Returns None when nothing matches (caller then defers wiring).
        """
        from app.models.application import Application

        application = Application.query_active().filter_by(id=application_id).first()
        if not application:
            return None

        candidates = set()
        if application.name:
            candidates.add(application.name)
        # live_domains, not domains: a tombstoned domain's server_name is no
        # longer in any vhost, and matching on it could land on another app's file.
        for domain in getattr(application, 'live_domains', []) or []:
            if getattr(domain, 'domain', None):
                candidates.add(domain.domain)

        if not os.path.isdir(SITES_AVAILABLE):
            return None

        for filename in os.listdir(SITES_AVAILABLE):
            if filename.startswith('.'):
                continue
            path = os.path.join(SITES_AVAILABLE, filename)
            if not os.path.isfile(path):
                continue
            # Fast path: the vhost file is named after the app.
            if filename in candidates:
                return path
            try:
                with open(path, 'r') as fh:
                    content = fh.read()
            except OSError:
                continue
            match = re.search(r'server_name\s+([^;]+);', content)
            if not match:
                continue
            names = set(match.group(1).split())
            if names & candidates:
                return path
        return None

    @classmethod
    def include_path_for(cls, application_id: int) -> str:
        """The nginx include file wired into this app's vhost."""
        return os.path.join(WAF_RULES_DIR, f'app-{application_id}.include.conf')

    @classmethod
    def inject_include_text(cls, content: str, include_path: str) -> Optional[str]:
        """``content`` with ``include <include_path>;`` idempotently wired into
        the serving server block, or None when no server block exists.

        Text-level so the live wiring (_inject_include) and drift's expected
        render (drift_service._nginx_render_expected) share one injector — two
        copies is how the expected file and the real file learn to disagree.
        """
        include_line = f'    {_INCLUDE_MARKER}\n    include {include_path};'

        # Drop any existing serverkit-waf include line(s) first (idempotent).
        cleaned = re.sub(
            r'\n[ \t]*' + re.escape(_INCLUDE_MARKER) + r'\n[ \t]*include\s+[^;]+;',
            '',
            content,
        )

        # Insert into the first server block that actually serves the app.
        # On an SSL vhost the file opens with the HTTP->HTTPS redirect block
        # (SSL_REDIRECT_TEMPLATE) — wiring the WAF there would protect only
        # the redirect and leave the real HTTPS server uncovered, so skip
        # redirect-only blocks (a 301 return and nothing served).
        starts = list(re.finditer(r'server\s*\{', cleaned))
        if not starts:
            return None
        idx = None
        for pos, match in enumerate(starts):
            end = starts[pos + 1].start() if pos + 1 < len(starts) else len(cleaned)
            body = cleaned[match.end():end]
            redirect_only = (re.search(r'return\s+301\b', body)
                             and not re.search(r'\b(location|proxy_pass|root|try_files)\b', body))
            if not redirect_only:
                idx = match.end()
                break
        if idx is None:
            idx = starts[0].end()
        return cleaned[:idx] + '\n' + include_line + cleaned[idx:]

    @classmethod
    def _inject_include(cls, vhost_path: str, include_path: str) -> Dict:
        """Idempotently add ``include <include_path>;`` into the serving
        server block of the vhost file at ``vhost_path``."""
        try:
            with open(vhost_path, 'r') as fh:
                content = fh.read()
        except OSError as e:
            return {'success': False, 'error': f'cannot read vhost: {e}'}

        new_content = cls.inject_include_text(content, include_path)
        if new_content is None:
            return {'success': False, 'error': 'no server block found in vhost'}

        return cls._write_file(vhost_path, new_content)

    @classmethod
    def reapply_if_enforcing(cls, application_id: int) -> Optional[Dict]:
        """Re-wire the WAF include after something regenerated the vhost.

        ``write_app_vhost`` renders from the template, which has no WAF
        include; drift repair and a slot switch both rewrite the vhost, and
        neither may strip protection the DB still records (plan 82 §F.1,
        plan 87 §B). None when the app has no enforcing policy.
        """
        from app.models.waf_policy import WafPolicy
        policy = WafPolicy.query.filter_by(application_id=application_id).first()
        if policy is None or policy.mode not in ('block', 'detect'):
            return None
        return cls.apply(application_id)

    @classmethod
    def apply(cls, application_id: int) -> Dict:
        """Render + persist the WAF artifacts for an app and reload nginx.

        Always writes the rules file and the nginx snippet. Then tries to
        additively wire the snippet into the app's vhost; if the vhost can't be
        located, returns ``manual_include`` describing how to wire it by hand.
        Finally validates + reloads nginx (skipped when there was nothing to
        enforce and no vhost wiring happened).
        """
        from app.models.application import Application
        from app.models.waf_policy import WafPolicy

        application = Application.query_active().filter_by(id=application_id).first()
        if not application:
            return {'success': False, 'error': 'Service not found'}

        policy = WafPolicy.query.filter_by(application_id=application_id).first()
        if policy is None:
            policy = cls.get_or_create_policy(application_id)

        rules_path = os.path.join(WAF_RULES_DIR, f'app-{application_id}.conf')
        include_path = cls.include_path_for(application_id)

        rules = cls.render_rules(policy)
        snippet = cls.nginx_snippet(policy, rules_path)

        cls._ensure_rules_dir()
        wrote_rules = cls._write_file(rules_path, rules)
        if not wrote_rules['success']:
            return wrote_rules
        wrote_snippet = cls._write_file(include_path, snippet)
        if not wrote_snippet['success']:
            return wrote_snippet

        result = {
            'success': True,
            'rules_path': rules_path,
            'include_path': include_path,
            'mode': policy.mode,
        }

        vhost_path = cls._vhost_path(application_id)
        if vhost_path:
            injected = cls._inject_include(vhost_path, include_path)
            if not injected['success']:
                # Wiring failed but artifacts exist — surface for manual fix.
                result['wired'] = False
                result['manual_include'] = {
                    'include_path': include_path,
                    'reason': injected.get('error'),
                }
            else:
                result['wired'] = True
                result['vhost_path'] = vhost_path
        else:
            result['wired'] = False
            result['manual_include'] = {
                'include_path': include_path,
                'reason': (
                    "no app vhost found in sites-available; add "
                    f"'include {include_path};' inside the app's server block"
                ),
            }

        # Reload nginx so the change (or its removal) takes effect.
        reload_result = cls._nginx_test_and_reload()
        result['nginx_reloaded'] = reload_result.get('success', False)
        if not reload_result.get('success'):
            result['nginx_error'] = reload_result.get('error') or reload_result.get('message')
        return result

    # ------------------------------------------------------------------
    # Audit-log parsing (unit-testable via injectable path)
    # ------------------------------------------------------------------
    @classmethod
    def events(cls, application_id: int, limit: int = 50, log_path: str = None) -> List[Dict]:
        """Parse recent ModSecurity events from the JSON audit log.

        ModSecurity's JSON audit log writes one JSON object per line. We read
        the file, tolerate malformed lines, normalise each transaction into a
        flat event (rule id, message, severity, uri, client ip, timestamp), and
        return the most recent *limit* entries (newest first).

        *log_path* is injectable so tests can point at a fixture; it defaults to
        the module/env-configured ``MODSEC_AUDIT_LOG``.
        """
        path = log_path or MODSEC_AUDIT_LOG
        if not path or not os.path.isfile(path):
            return []

        events: List[Dict] = []
        try:
            with open(path, 'r', errors='ignore') as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except (ValueError, TypeError):
                        continue  # tolerate malformed lines
                    parsed = cls._parse_audit_entry(entry)
                    if parsed:
                        events.extend(parsed)
        except OSError as e:
            logger.warning('Failed to read modsec audit log %s: %s', path, e)
            return []

        # Newest first; cap to limit.
        events.reverse()
        return events[:limit]

    @staticmethod
    def _parse_audit_entry(entry: Dict) -> List[Dict]:
        """Flatten one ModSecurity JSON transaction into 0..n event dicts."""
        if not isinstance(entry, dict):
            return []
        txn = entry.get('transaction', {}) if isinstance(entry.get('transaction'), dict) else {}
        request = entry.get('request', {}) if isinstance(entry.get('request'), dict) else {}
        audit = entry.get('audit_data') or entry.get('audit', {})
        if not isinstance(audit, dict):
            audit = {}

        client_ip = txn.get('client_ip') or txn.get('remote_address')
        timestamp = txn.get('time') or entry.get('time') or txn.get('timestamp')
        uri = request.get('uri') or txn.get('uri')

        messages = audit.get('messages') or entry.get('messages') or []
        if isinstance(messages, str):
            messages = [messages]

        out: List[Dict] = []
        for msg in messages:
            rule_id = None
            severity = None
            text = None
            if isinstance(msg, dict):
                details = msg.get('details', {}) if isinstance(msg.get('details'), dict) else {}
                rule_id = details.get('ruleId') or details.get('id') or msg.get('id')
                severity = details.get('severity') or msg.get('severity')
                text = msg.get('message') or msg.get('msg')
            else:
                text = str(msg)
                # Best-effort: pull "[id "942100"]" / "[severity ...]" out of the line.
                id_match = re.search(r'\[id "?(\d+)"?\]', text)
                if id_match:
                    rule_id = id_match.group(1)
                sev_match = re.search(r'\[severity "?([^"\]]+)"?\]', text)
                if sev_match:
                    severity = sev_match.group(1)

            out.append({
                'rule_id': str(rule_id) if rule_id is not None else None,
                'message': text,
                'severity': severity,
                'uri': uri,
                'client_ip': client_ip,
                'timestamp': timestamp,
            })
        return out
