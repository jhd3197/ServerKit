"""Answer "can I use this host port?" for the panel's port inputs.

The deploy paths already pick and check host ports through
TemplateService (app rows, slot rows, Docker mappings, then a bind test).
This module asks the same sources on behalf of one typed port and adds
*who* holds it, so the UI can say "taken by shop-api" instead of "invalid".
"""
from app.services.template_service import TemplateService

# Ports below this need root to bind and are never handed to an app.
PRIVILEGED_PORT_LIMIT = 1024


def port_holder(port: int):
    """The app or container holding ``port``, as ``{'kind', 'name', 'id'}``,
    or None when nothing ServerKit knows about holds it."""
    try:
        from app import db
        from app.models import Application
        from app.models.app_slot import AppSlot
        # Unfiltered on purpose, like TemplateService: a soft-deleted app keeps
        # its port so restoring it from the recycle bin cannot collide.
        app = Application.query.filter_by(port=port).first()
        if app is None:
            slot = AppSlot.query.filter_by(host_port=port).first()
            app = db.session.get(Application, slot.application_id) if slot else None
        if app is not None:
            return {'kind': 'app', 'name': app.name, 'id': app.id}
    except Exception:
        pass
    if port in TemplateService._get_docker_used_ports():
        return {'kind': 'container', 'name': None, 'id': None}
    return None


def check_port(port) -> dict:
    """Validity, availability and holder of one host port."""
    try:
        port = int(port)
    except (TypeError, ValueError):
        return {'port': None, 'valid': False, 'free': False, 'reason': 'not_a_number'}
    if not 1 <= port <= 65535:
        return {'port': port, 'valid': False, 'free': False, 'reason': 'out_of_range'}
    holder = port_holder(port)
    free = holder is None and TemplateService._port_is_free(port)
    reason = None
    if holder is not None:
        reason = 'in_use'
    elif not free:
        reason = 'bound'  # something outside ServerKit is listening
    return {
        'port': port,
        'valid': True,
        'free': free,
        'privileged': port < PRIVILEGED_PORT_LIMIT,
        'holder': holder,
        'reason': reason,
    }


def suggest_port(start: int = 8000) -> int:
    """The next free host port at or above ``start``."""
    try:
        start = max(PRIVILEGED_PORT_LIMIT, min(int(start), 65535))
    except (TypeError, ValueError):
        start = 8000
    return TemplateService._find_available_port(start_port=start)
