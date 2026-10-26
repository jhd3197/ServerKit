"""Authorization-aware read model for one server's activity timeline.

The three source tables intentionally remain independent.  This service owns
their attribution, secret-safe projections, global ordering, and keyset cursor
so the HTTP layer never reaches into ORM persistence.
"""

from __future__ import annotations

import base64
import binascii
from dataclasses import dataclass
from datetime import datetime
import json

from sqlalchemy import and_, or_
from sqlalchemy.orm import joinedload

from app import db
from app.exceptions import NotFoundError, PermissionDeniedError, ValidationError


EVENT_AUDIT = 'audit'
EVENT_RESTORE_POINT = 'restore_point'
EVENT_DEPLOYMENT_SNAPSHOT = 'deployment_snapshot'
EVENT_TYPES = frozenset({
    EVENT_AUDIT,
    EVENT_RESTORE_POINT,
    EVENT_DEPLOYMENT_SNAPSHOT,
})

DEFAULT_LIMIT = 50
MAX_LIMIT = 200
_APP_SCOPE_TYPES = frozenset({'application', 'env'})

# Higher ranks sort first when timestamps are equal.  This is API state: the
# cursor records the source name and resolves its stable rank from this table.
_SOURCE_RANK = {
    EVENT_AUDIT: 3,
    EVENT_RESTORE_POINT: 2,
    EVENT_DEPLOYMENT_SNAPSHOT: 1,
}

# AuditLog may contain request payloads, IPs, user agents, and provider data.
# A server timeline is not the admin audit export, so expose only small fields
# that help explain an event.  Nested request payload/query objects never pass.
_AUDIT_DETAIL_KEYS = frozenset({
    'action',
    'allow_agent_update_observed',
    'app_id',
    'app_name',
    'application_id',
    'code',
    'endpoint',
    'from',
    'kind',
    'label',
    'method',
    'pre_restore_point_id',
    'restore_point_id',
    'scope_id',
    'scope_type',
    'server_id',
    'service',
    'state',
    'status_code',
    'success',
    'to',
    'trigger',
})


class ServerTimelineError(ValidationError):
    code = 'server_timeline_invalid'


class ServerTimelineNotFoundError(NotFoundError):
    code = 'server_timeline_server_not_found'


@dataclass(frozen=True)
class TimelineCursor:
    created_at: datetime
    source: str
    source_id: int | str
    server_id: str
    types: frozenset[str]


@dataclass(frozen=True)
class TimelinePage:
    events: list[dict]
    next_cursor: str | None


def _parse_limit(value) -> int:
    if value in (None, ''):
        return DEFAULT_LIMIT
    try:
        limit = int(value)
    except (TypeError, ValueError) as exc:
        raise ServerTimelineError('limit must be an integer') from exc
    if limit < 1 or limit > MAX_LIMIT:
        raise ServerTimelineError(
            f'limit must be between 1 and {MAX_LIMIT}',
        )
    return limit


def _parse_types(value) -> frozenset[str]:
    if value in (None, ''):
        return EVENT_TYPES
    raw_values = value if isinstance(value, (list, tuple, set)) else str(value).split(',')
    requested = frozenset(
        str(item).strip() for item in raw_values if str(item).strip()
    )
    if not requested:
        return EVENT_TYPES
    unknown = requested - EVENT_TYPES
    if unknown:
        raise ServerTimelineError(
            'Unknown timeline event types',
            details={
                'types': sorted(unknown),
                'allowed': sorted(EVENT_TYPES),
            },
        )
    return requested


def _native_cursor_id(source, value):
    if source in {EVENT_AUDIT, EVENT_DEPLOYMENT_SNAPSHOT}:
        try:
            parsed = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError from exc
        if parsed < 1:
            raise ValueError
        return parsed
    if source == EVENT_RESTORE_POINT:
        parsed = str(value or '')
        if not parsed or len(parsed) > 128:
            raise ValueError
        return parsed
    raise ValueError


def encode_cursor(event, *, server_id, types) -> str:
    payload = {
        'v': 1,
        'created_at': event['_created_at'].isoformat(timespec='microseconds'),
        'source': event['type'],
        'source_id': event['source_id'],
        'server_id': str(server_id),
        'types': sorted(types),
    }
    raw = json.dumps(payload, sort_keys=True, separators=(',', ':')).encode('utf-8')
    return base64.urlsafe_b64encode(raw).rstrip(b'=').decode('ascii')


def decode_cursor(value, *, server_id, types) -> TimelineCursor | None:
    if value in (None, ''):
        return None
    try:
        encoded = str(value).encode('ascii')
        encoded += b'=' * (-len(encoded) % 4)
        payload = json.loads(base64.b64decode(
            encoded, altchars=b'-_', validate=True,
        ).decode('utf-8'))
        if not isinstance(payload, dict) or payload.get('v') != 1:
            raise ValueError
        if set(payload) != {
            'v', 'created_at', 'source', 'source_id', 'server_id', 'types',
        }:
            raise ValueError
        if payload['server_id'] != str(server_id):
            raise ValueError
        cursor_types = frozenset(payload['types'])
        if (
            not isinstance(payload['types'], list)
            or cursor_types != frozenset(types)
            or not cursor_types <= EVENT_TYPES
        ):
            raise ValueError
        source = payload['source']
        if source not in EVENT_TYPES or source not in cursor_types:
            raise ValueError
        created_at = datetime.fromisoformat(payload['created_at'])
        if created_at.tzinfo is not None:
            # Stored timestamps are UTC-naive throughout these three models.
            raise ValueError
        source_id = _native_cursor_id(source, payload['source_id'])
        return TimelineCursor(
            created_at, source, source_id, str(server_id), cursor_types,
        )
    except (
        binascii.Error,
        json.JSONDecodeError,
        UnicodeError,
        ValueError,
        TypeError,
    ) as exc:
        raise ServerTimelineError(
            'Invalid timeline cursor', code='invalid_cursor',
        ) from exc


def _require_developer(user):
    if user is None:
        raise PermissionDeniedError('Developer access required')
    if not user.is_active:
        raise PermissionDeniedError('Account is deactivated')
    if not user.is_developer:
        raise PermissionDeniedError('Developer access required')


def _resolve_server(user, server_id):
    from app.models.server import Server
    from app.services.workspace_service import WorkspaceService

    server = db.session.get(Server, str(server_id))
    # A foreign workspace's server reads as missing, like every server route.
    if server is None or not WorkspaceService.can_access_server(user, server):
        raise ServerTimelineNotFoundError(f'Server {server_id} not found')
    return server


def _globally_accessible_app_ids(user):
    from app.models.application import Application
    from app.services.workspace_service import WorkspaceService

    query = WorkspaceService.scope_query(
        Application.query_active(), Application, user,
        owner_attr='user_id', grant_resource_type='application',
    )
    return {
        application_id
        for application_id, in query.with_entities(Application.id).all()
    }


def _accessible_apps_on_server(server_id, user):
    from app.models.application import Application
    from app.services.workspace_service import WorkspaceService

    query = WorkspaceService.scope_query(
        Application.query_active().filter(Application.server_id == server_id),
        Application,
        user,
        owner_attr='user_id',
        grant_resource_type='application',
    )
    return {
        row.id: row
        for row in query.with_entities(
            Application.id, Application.name, Application.server_id,
        ).all()
    }


def _apply_seek(query, created_column, id_column, source, cursor):
    if cursor is None:
        return query
    source_rank = _SOURCE_RANK[source]
    cursor_rank = _SOURCE_RANK[cursor.source]
    if source_rank < cursor_rank:
        return query.filter(created_column <= cursor.created_at)
    if source_rank > cursor_rank:
        return query.filter(created_column < cursor.created_at)
    return query.filter(or_(
        created_column < cursor.created_at,
        and_(
            created_column == cursor.created_at,
            id_column < cursor.source_id,
        ),
    ))


def _base_event(source, source_id, created_at, *, action, actor_user_id=None):
    return {
        'id': f'{source}:{source_id}',
        'type': source,
        'source_id': source_id,
        'created_at': created_at.isoformat(timespec='microseconds'),
        'action': action,
        'actor_user_id': actor_user_id,
        '_created_at': created_at,
    }


def _safe_audit_details(details):
    if not isinstance(details, dict):
        return {}
    result = {}
    for key in sorted(_AUDIT_DETAIL_KEYS & set(details)):
        value = details[key]
        if value is None or isinstance(value, (bool, int, float)):
            result[key] = value
        elif isinstance(value, str):
            result[key] = value[:500]
    return result


def _coerce_app_id(value):
    try:
        app_id = int(value)
    except (TypeError, ValueError):
        return None
    return app_id if app_id > 0 else None


def _audit_application_id(row, details):
    if row.target_type in {'app', 'application'}:
        return _coerce_app_id(row.target_id)
    for key in ('application_id', 'app_id'):
        app_id = _coerce_app_id(details.get(key))
        if app_id is not None:
            return app_id
    if details.get('scope_type') in _APP_SCOPE_TYPES:
        return _coerce_app_id(details.get('scope_id'))
    return None


def _audit_server_id(row, details):
    if row.target_type == 'server' and row.target_id is not None:
        return str(row.target_id)
    direct = details.get('server_id')
    if direct not in (None, ''):
        return str(direct)
    route_args = details.get('route_args')
    if isinstance(route_args, dict):
        routed = route_args.get('server_id')
        if routed not in (None, ''):
            return str(routed)
    return None


def _audit_belongs_to_server(
        row, details, server_id, accessible_app_ids, current_apps):
    app_id = _audit_application_id(row, details)
    if app_id is not None:
        if app_id not in accessible_app_ids:
            return False
        # A frozen server attribution preserves history after an app moves.
        # Only older audit shapes with no server stamp derive from the app's
        # current server association.
        explicit_server_id = _audit_server_id(row, details)
        if explicit_server_id is not None:
            return explicit_server_id == server_id
        return app_id in current_apps
    return _audit_server_id(row, details) == server_id


def _audit_events(
        server_id, accessible_app_ids, current_apps, cursor, fetch_limit):
    from app.models.audit_log import AuditLog

    app_ids = tuple(accessible_app_ids)
    candidates = [AuditLog.target_type.in_(('server', 'servers', 'restore_point'))]
    if app_ids:
        candidates.append(and_(
            AuditLog.target_type.in_(('app', 'application')),
            AuditLog.target_id.in_(app_ids),
        ))
    # Some explicit audits use a domain-specific target_type and put the UUID
    # in details.  The quoted value is only a candidate prefilter; attribution
    # below parses JSON and requires exact server_id/route_args equality.
    candidates.append(AuditLog.details.contains(f'"{server_id}"'))

    query = AuditLog.query.options(joinedload(AuditLog.user)).filter(
        AuditLog.created_at.isnot(None),
        AuditLog.action != AuditLog.ACTION_RESTORE_POINT_CREATE,
        or_(*candidates),
    )
    query = _apply_seek(
        query, AuditLog.created_at, AuditLog.id, EVENT_AUDIT, cursor,
    ).order_by(AuditLog.created_at.desc(), AuditLog.id.desc())

    events = []
    for row in query.yield_per(200):
        details = row.get_details()
        if not _audit_belongs_to_server(
            row, details, server_id, accessible_app_ids, current_apps,
        ):
            continue
        event = _base_event(
            EVENT_AUDIT, row.id, row.created_at,
            action=row.action, actor_user_id=row.user_id,
        )
        event.update({
            'actor_username': row.user.username if row.user else None,
            'target_type': row.target_type,
            'target_id': row.target_id,
            'details': _safe_audit_details(details),
        })
        events.append(event)
        if len(events) >= fetch_limit:
            break
    return events


def _restore_point_events(
        server_id, accessible_app_ids, current_apps, cursor, fetch_limit):
    from app.models.restore_point import RestorePoint

    app_scope_ids = tuple(str(app_id) for app_id in accessible_app_ids)
    current_scope_ids = tuple(str(app_id) for app_id in current_apps)
    attributed = [and_(
        RestorePoint.server_id == server_id,
        RestorePoint.scope_type.notin_(_APP_SCOPE_TYPES),
    )]
    if app_scope_ids:
        attributed.append(and_(
            RestorePoint.server_id == server_id,
            RestorePoint.scope_type.in_(_APP_SCOPE_TYPES),
            RestorePoint.scope_id.in_(app_scope_ids),
        ))
    if current_scope_ids:
        attributed.append(and_(
            RestorePoint.server_id.is_(None),
            RestorePoint.scope_type == 'env',
            RestorePoint.scope_id.in_(current_scope_ids),
        ))
    query = RestorePoint.query.filter(
        RestorePoint.created_at.isnot(None), or_(*attributed),
    )
    query = _apply_seek(
        query, RestorePoint.created_at, RestorePoint.id,
        EVENT_RESTORE_POINT, cursor,
    ).order_by(RestorePoint.created_at.desc(), RestorePoint.id.desc())

    events = []
    for point in query.limit(fetch_limit).all():
        event = _base_event(
            EVENT_RESTORE_POINT, point.id, point.created_at,
            action='restore_point.captured',
            actor_user_id=point.actor_user_id,
        )
        event.update({
            'server_id': point.server_id or server_id,
            'scope_type': point.scope_type,
            'scope_id': point.scope_id,
            'trigger': point.trigger,
            'label': point.label,
            'keep': bool(point.keep),
            'coverage': point.get_coverage(),
        })
        events.append(event)
    return events


def _deployment_snapshot_events(accessible_apps, cursor, fetch_limit):
    from app.models.deployment_snapshot import DeploymentSnapshot

    app_ids = tuple(accessible_apps)
    if not app_ids:
        return []
    query = DeploymentSnapshot.query.filter(
        DeploymentSnapshot.application_id.in_(app_ids),
        DeploymentSnapshot.created_at.isnot(None),
    )
    query = _apply_seek(
        query, DeploymentSnapshot.created_at, DeploymentSnapshot.id,
        EVENT_DEPLOYMENT_SNAPSHOT, cursor,
    ).order_by(
        DeploymentSnapshot.created_at.desc(), DeploymentSnapshot.id.desc(),
    )

    events = []
    for snapshot in query.limit(fetch_limit).all():
        application = accessible_apps[snapshot.application_id]
        event = _base_event(
            EVENT_DEPLOYMENT_SNAPSHOT, snapshot.id, snapshot.created_at,
            action='deployment.snapshot', actor_user_id=None,
        )
        event.update({
            'application_id': snapshot.application_id,
            'application_name': application.name,
            'deployment_id': snapshot.deployment_id,
            'snapshot_hash': snapshot.snapshot_hash,
            'summary': snapshot.summary,
        })
        events.append(event)
    return events


def _event_sort_key(event):
    return (
        event['_created_at'],
        _SOURCE_RANK[event['type']],
        event['source_id'],
    )


def get_timeline(user, server_id, *, types=None, before=None, limit=None):
    """Return one authorization-filtered keyset page, newest first."""
    _require_developer(user)
    server = _resolve_server(user, server_id)
    requested_types = _parse_types(types)
    page_limit = _parse_limit(limit)
    cursor = decode_cursor(
        before, server_id=server.id, types=requested_types,
    )
    accessible_app_ids = _globally_accessible_app_ids(user)
    current_apps = _accessible_apps_on_server(server.id, user)
    fetch_limit = page_limit + 1

    events = []
    if EVENT_AUDIT in requested_types:
        events.extend(_audit_events(
            server.id, accessible_app_ids, current_apps, cursor, fetch_limit,
        ))
    if EVENT_RESTORE_POINT in requested_types:
        events.extend(_restore_point_events(
            server.id, accessible_app_ids, current_apps, cursor, fetch_limit,
        ))
    if EVENT_DEPLOYMENT_SNAPSHOT in requested_types:
        events.extend(_deployment_snapshot_events(
            current_apps, cursor, fetch_limit,
        ))

    events.sort(key=_event_sort_key, reverse=True)
    has_more = len(events) > page_limit
    page_events = events[:page_limit]
    next_cursor = (
        encode_cursor(
            page_events[-1], server_id=server.id, types=requested_types,
        )
        if has_more else None
    )
    for event in page_events:
        event.pop('_created_at', None)
    return TimelinePage(page_events, next_cursor)


class ServerTimelineService:
    """Facade for call sites that use the project's service-class convention."""

    get_timeline = staticmethod(get_timeline)
    encode_cursor = staticmethod(encode_cursor)
    decode_cursor = staticmethod(decode_cursor)
