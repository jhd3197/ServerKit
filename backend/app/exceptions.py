"""Typed application errors rendered consistently at the HTTP boundary.

Services may raise these errors when a caller can act on the failure.  Flask
owns their JSON representation; service code therefore does not need to know
about ``jsonify`` or duplicate status-code mapping.

The subclasses of built-in exception types are intentional compatibility
bridges.  Existing callers that catch ``ValueError`` or ``LookupError`` keep
working while a feature is migrated incrementally to the typed contract.
"""

from collections.abc import Mapping


class ApplicationError(Exception):
    """Base class for expected, client-safe application failures."""

    status_code = 500
    code = 'application_error'
    default_message = 'Application error'

    def __init__(self, message=None, *, code=None, details=None):
        self.message = str(message or self.default_message)
        self.code = code or type(self).code
        self.details = dict(details) if isinstance(details, Mapping) else None
        super().__init__(self.message)

    def to_dict(self, *, request_id=None):
        """Return the stable public error body used by API handlers."""
        payload = {
            'error': self.message,
            'status': self.status_code,
            'code': self.code,
        }
        if self.details:
            payload['details'] = self.details
        if request_id:
            payload['request_id'] = request_id
        return payload


class ValidationError(ApplicationError, ValueError):
    status_code = 400
    code = 'validation_error'
    default_message = 'Invalid request'


class AuthenticationError(ApplicationError):
    status_code = 401
    code = 'authentication_required'
    default_message = 'Authentication required'


class PermissionDeniedError(ApplicationError, PermissionError):
    status_code = 403
    code = 'permission_denied'
    default_message = 'Access denied'


class NotFoundError(ApplicationError, LookupError):
    status_code = 404
    code = 'not_found'
    default_message = 'Resource not found'


class ConflictError(ApplicationError):
    status_code = 409
    code = 'conflict'
    default_message = 'Resource conflict'


class DependencyUnavailableError(ApplicationError):
    status_code = 503
    code = 'dependency_unavailable'
    default_message = 'Dependency unavailable'


class AgentOfflineError(DependencyUnavailableError):
    """The target server's agent is not connected, so nothing can reach it."""

    code = 'agent.offline'
    default_message = (
        "The server's agent is offline. Start the agent on that server, "
        'then try again.'
    )


# ---------------------------------------------------------------------------
# Stable codes the client translates (plan 88 §C).
#
# The frontend (``frontend/src/services/api/errorCodes.js``) swaps the server's
# English for its own translation when it knows the ``code``. A translated code
# must therefore mean exactly ONE message — a code whose text varied per call
# would lose its specifics on the client. So the dotted codes below come only
# from these factories, each with a fixed message (parameterised by ``details``
# at most). The class defaults (``not_found``, ``validation_error``,
# ``permission_denied``, ``conflict``) stay for raises that carry their own
# prose; the client shows that prose untranslated, as before.
#
#   code                   message                          details
#   not_found.<resource>   "<Resource> not found"           resource
#   validation.required    "<field> is required"            field
#   permission.denied      PERMISSION_DENIED_MESSAGE        -
#   conflict.exists        "<Resource> already exists"      resource
#   agent.offline          AgentOfflineError's message      -
#
# Resource words are the UI's nouns (plan 88 glossary), not model names: an
# ``Application`` row is a "service" to the person reading the toast.
# ---------------------------------------------------------------------------

RESOURCE_LABELS = {
    'service': 'Service',
    'server': 'Server',
    'domain': 'Domain',
    'database': 'Database',
    'backup': 'Backup',
    'snapshot': 'Snapshot',
    'config_checkpoint': 'Config checkpoint',
    'deployment': 'Deployment',
    'template': 'Template',
    'user': 'User',
}

PERMISSION_DENIED_MESSAGE = "You don't have permission to do this. Ask an admin for access."


def _resource_label(resource):
    try:
        return RESOURCE_LABELS[resource]
    except KeyError:  # a typo here would ship a code nobody translates
        raise ValueError(f'unknown resource kind {resource!r}; add it to RESOURCE_LABELS') from None


def not_found(resource):
    """``NotFoundError`` for one resource kind: ``raise not_found('service')``."""
    return NotFoundError(
        f'{_resource_label(resource)} not found',
        code=f'not_found.{resource}',
        details={'resource': resource},
    )


def field_required(field):
    """``ValidationError`` for a missing request field: ``raise field_required('name')``."""
    return ValidationError(
        f'{field} is required',
        code='validation.required',
        details={'field': field},
    )


def permission_denied():
    """``PermissionDeniedError`` for a caller who may not act on this resource.

    The message is deliberately generic: it reveals nothing the status code
    doesn't, and tells the caller what they can do about it.
    """
    return PermissionDeniedError(PERMISSION_DENIED_MESSAGE, code='permission.denied')


def already_exists(resource):
    """``ConflictError`` for a create that collides with an existing row."""
    return ConflictError(
        f'{_resource_label(resource)} already exists',
        code='conflict.exists',
        details={'resource': resource},
    )


def agent_offline():
    """``AgentOfflineError`` (503) for a server whose agent is not connected."""
    return AgentOfflineError()
