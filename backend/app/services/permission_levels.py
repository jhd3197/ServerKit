"""Agent permission levels and the one command-gate table.

The level is chosen on the server (``permissions.level`` in the agent's
config.yaml) and REPORTED to the panel. The panel never sets it. This module
is only the panel's defence in depth: it refuses to send a command the agent
would refuse anyway. ``PROTECT_ACTIONS`` must stay identical to the agent's
allowlist (docs/AGENT_PERMISSION_LEVELS.md; checked by a test).
"""

LEVELS = ('monitor', 'protect', 'full')
_RANK = {level: i for i, level in enumerate(LEVELS)}
LABELS = {'monitor': 'Monitor', 'protect': 'Protect', 'full': 'Full'}

PROTECT_ACTIONS = frozenset({
    'firewall:allow_port', 'firewall:deny_port', 'firewall:status',
    'firewall:allow_ip', 'firewall:deny_ip',
    'fail2ban:status', 'fail2ban:ban', 'fail2ban:unban',
    'crowdsec:decisions:list', 'crowdsec:ban', 'crowdsec:unban',
    'cloudflare:origin_lock:status', 'cloudflare:origin_lock:apply',
    'cloudflare:origin_lock:remove',
})

# Signature-verified key rotation is not control; allowed at every level.
ALWAYS_ALLOWED = frozenset({'credential_update'})


def normalize(level):
    """Return a valid level string, or None for missing/unknown values."""
    level = level.strip().lower() if isinstance(level, str) else None
    return level if level in _RANK else None


def effective_level(level):
    """Unknown/legacy (None) means a pre-levels agent, i.e. full."""
    return normalize(level) or 'full'


def is_escalation(old, new):
    return old is not None and _RANK[new] > _RANK[old]


def refusal(level, action):
    """Message explaining why ``action`` is refused at ``level``, else None."""
    level = effective_level(level)
    if level == 'full' or action in ALWAYS_ALLOWED:
        return None
    if level == 'protect' and action in PROTECT_ACTIONS:
        return None
    if level == 'monitor':
        return (f"server is in Monitor mode: '{action}' refused. Monitor agents "
                "are report-only and accept no commands. The level can only be "
                "changed on the server itself (serverkit-agent permissions set).")
    return (f"server is in Protect mode: '{action}' refused. Protect agents only "
            "run firewall, fail2ban, CrowdSec and Cloudflare origin-lock actions. "
            "The level can only be changed on the server itself "
            "(serverkit-agent permissions set).")
