"""What each server carries: its services and the domains pointing at them.

The server list shows these as columns, so they are computed for the whole
list at once (two queries, however many servers) rather than per row.
"""
from collections import Counter

from app.models import Application
from app.models.domain import Domain
from app.services.workspace_service import WorkspaceService


def workload_counts_by_server(server_ids, user, workspace_id=None):
    """Return ``{server_id: {'services_count': n, 'domains_count': n}}``.

    Only services the caller may see are counted, by the same scoping the
    service list applies: a count must not reveal that a server runs something
    the caller has no access to. A service with no ``server_id`` runs on the
    panel host itself and belongs to no row here.
    """
    ids = list(server_ids)
    if not ids or user is None:
        return {}

    services = WorkspaceService.scope_query(
        Application.query_active(), Application, user,
        workspace_id=workspace_id, owner_attr='user_id',
        grant_resource_type='application',
    ).filter(Application.server_id.in_(ids))
    server_of = dict(services.with_entities(Application.id, Application.server_id).all())

    service_counts = Counter(server_of.values())
    domain_counts = Counter()
    if server_of:
        domain_rows = (Domain.query_active()
                       .filter(Domain.application_id.in_(list(server_of)))
                       .with_entities(Domain.application_id)
                       .all())
        for (application_id,) in domain_rows:
            domain_counts[server_of[application_id]] += 1

    return {
        server_id: {
            'services_count': service_counts.get(server_id, 0),
            'domains_count': domain_counts.get(server_id, 0),
        }
        for server_id in ids
    }
