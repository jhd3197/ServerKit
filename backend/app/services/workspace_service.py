import hashlib
import logging
import secrets
from datetime import datetime
from app import db
from app.models.workspace import Workspace, WorkspaceMember, WorkspaceApiKey
from app.models.user import User
from app.utils.slug import unique_slug

logger = logging.getLogger(__name__)


class WorkspaceService:
    """Service for multi-tenancy workspace management."""

    DEFAULT_WORKSPACE_SLUG = 'default'

    # --- Scoping (#33 foundation) ---
    #
    # These three helpers centralize resource scoping so the admin-vs-owner-vs-
    # workspace branch isn't re-implemented per route. Scoping is OPT-IN: a
    # request only filters by workspace when it carries a workspace context
    # (X-Workspace-Id header or ?workspace_id=). With no context, scope_query
    # preserves each resource's existing ownership behavior exactly, so this
    # foundation changes nothing until a caller activates a workspace.

    @staticmethod
    def ensure_default_workspace():
        """Find-or-create the Default workspace (idempotent). Used to stamp newly
        created resources when no workspace context is supplied, and to give
        existing resources a home (mirrors migration 015's backfill)."""
        ws = Workspace.query.filter_by(slug=WorkspaceService.DEFAULT_WORKSPACE_SLUG).first()
        if ws is None:
            ws = Workspace(
                name='Default',
                slug=WorkspaceService.DEFAULT_WORKSPACE_SLUG,
                description='Default workspace (auto-created for existing resources).',
            )
            db.session.add(ws)
            db.session.commit()
        return ws

    @staticmethod
    def visible_workspace_ids(user, workspace_id=None):
        """Workspace ids whose resources ``user`` may see: just ``workspace_id``
        when a context is active, otherwise every workspace the user belongs
        to (all of them for an admin)."""
        if workspace_id is not None:
            return [workspace_id]
        if user.is_admin:
            from app.models.workspace import Workspace
            return [w.id for w in Workspace.query.all()]
        return [w.id for w in WorkspaceService.list_workspaces(user_id=user.id)]

    @staticmethod
    def resolve_workspace_id(user, requested):
        """Resolve an optionally-requested workspace context to a usable workspace
        id, or None for "no active context".

        LENIENT by design: an unparsable, unknown, deactivated-account, or
        not-permitted request degrades to None (no scoping) rather than raising,
        so a stale `X-Workspace-Id` header (deleted workspace, removed member)
        can never break the UI. This is safe because falling back to None only
        ever shows the user their OWN resources and stamps the default workspace
        on create — it never grants access to, or creates in, a workspace the
        user doesn't belong to.
        """
        if requested in (None, '', 'all'):
            return None
        if not getattr(user, 'is_active', True):
            return None
        try:
            ws_id = int(requested)
        except (ValueError, TypeError):
            return None
        if Workspace.query.get(ws_id) is None:
            return None
        if not user.is_admin and WorkspaceService.get_user_role(ws_id, user.id) is None:
            return None
        return ws_id

    @staticmethod
    def scope_query(query, model, user, workspace_id=None, owner_attr=None, grant_resource_type=None):
        """Apply scoping to a resource list query.

        - non-admin + owner_attr -> restricted to the user's own rows, PLUS any
          rows explicitly shared with them via a per-resource grant (#33) when
          grant_resource_type is given (e.g. 'application'). A workspace context
          then narrows *within* that set.
        - admin, or a global resource (owner_attr=None, e.g. servers) -> no owner
          filter; today's behavior (admin sees all; servers are global).
        - workspace context active -> additionally filter to that workspace.

        It still only ever NARROWS the global/admin view; for non-admins it widens
        ONLY by explicit grants the user was given, never by workspace membership
        alone.
        """
        if owner_attr and not user.is_admin:
            own = getattr(model, owner_attr) == user.id
            if grant_resource_type:
                from app import db
                from app.services.resource_grant_service import ResourceGrantService
                granted = ResourceGrantService.granted_ids(user.id, grant_resource_type)
                query = query.filter(db.or_(own, model.id.in_(granted))) if granted else query.filter(own)
            else:
                query = query.filter(own)
        if workspace_id is not None:
            query = query.filter(model.workspace_id == workspace_id)
        return query

    @staticmethod
    def effective_role(user, workspace_id):
        """Reconcile a user's GLOBAL role (User.role) with their per-workspace
        membership role (WorkspaceMember.role), returning the effective
        global-role string ('admin'|'developer'|'viewer') that applies while the
        user acts inside this workspace.

        NARROW-ONLY, mirroring scope_query: a workspace membership can only
        REDUCE capability, never grant more than the user's global role.

        - System admin (User.is_admin): always 'admin'. A platform super-admin is
          never capped by a workspace membership (consistent with scope_query's
          admin bypass), so they can't be locked out of a workspace they manage.
        - No workspace context (workspace_id is None): the global role, unchanged.
        - A 'viewer' workspace membership: capped to 'viewer' (read-only) here,
          even for a global developer.
        - Any other membership (member/admin/owner) or non-member: the global
          role, unchanged — the workspace role never elevates beyond it.
        """
        if user.is_admin:
            return User.ROLE_ADMIN
        if workspace_id is None:
            return user.role
        ws_role = WorkspaceService.get_user_role(workspace_id, user.id)
        if ws_role == WorkspaceMember.ROLE_VIEWER:
            return User.ROLE_VIEWER
        return user.role

    @staticmethod
    def can_write_in_workspace(user, workspace_id):
        """Whether the user may create/mutate resources while `workspace_id` is the
        active context. False only when their effective role here is viewer — a
        global developer who is merely a 'viewer' member of this workspace gets
        read-only access to it (workspace role caps capability, narrow-only)."""
        return WorkspaceService.effective_role(user, workspace_id) != User.ROLE_VIEWER

    @staticmethod
    def can_access_server(user, server):
        """Whether the user may operate *server*: admins always, otherwise only
        servers outside any named workspace or in one they are a member of.
        The Default workspace counts as none — servers created without a
        context are stamped into it, and nobody is a member of it.
        The one rule for both the REST routes and the Socket.IO rooms."""
        if user.is_admin or not server.workspace_id:
            return True
        default = Workspace.query.filter_by(
            slug=WorkspaceService.DEFAULT_WORKSPACE_SLUG).first()
        if default is not None and server.workspace_id == default.id:
            return True
        return WorkspaceService.get_user_role(server.workspace_id, user.id) is not None

    @staticmethod
    def filter_accessible_servers(query, user):
        """Narrow a Server query to what can_access_server allows, in SQL."""
        if user.is_admin:
            return query
        from app.models.server import Server
        member_ws = db.session.query(WorkspaceMember.workspace_id).filter_by(user_id=user.id)
        allowed = [Server.workspace_id.is_(None), Server.workspace_id.in_(member_ws)]
        default = Workspace.query.filter_by(
            slug=WorkspaceService.DEFAULT_WORKSPACE_SLUG).first()
        if default is not None:
            allowed.append(Server.workspace_id == default.id)
        return query.filter(db.or_(*allowed))

    @staticmethod
    def accessible_servers(user):
        """Every server *user* may operate, with its group loaded."""
        from sqlalchemy.orm import joinedload
        from app.models.server import Server
        query = WorkspaceService.filter_accessible_servers(Server.query, user)
        return query.options(joinedload(Server.group)).all()

    @staticmethod
    def get_accessible_server(user, server_id):
        """The server if *user* may operate it (see can_access_server), else None."""
        from app.models.server import Server
        server = Server.query.get(server_id)
        if server is None or not WorkspaceService.can_access_server(user, server):
            return None
        return server

    @staticmethod
    def check_quota(workspace_id, current_count, quota_field):
        """Return an error string if a workspace quota would be exceeded,
        otherwise None. `quota_field` is the Workspace column name."""
        ws = Workspace.query.get(workspace_id)
        if not ws:
            return 'Workspace not found'
        quota = getattr(ws, quota_field, 0) or 0
        if quota > 0 and current_count >= quota:
            label = quota_field.replace('max_', '').replace('_', ' ')
            return f'Workspace {label} limit reached (max {quota})'
        return None

    @staticmethod
    def list_workspaces(user_id=None, include_archived=False):
        query = Workspace.query
        if not include_archived:
            query = query.filter_by(status=Workspace.STATUS_ACTIVE)
        if user_id:
            member_ws_ids = db.session.query(WorkspaceMember.workspace_id).filter_by(user_id=user_id)
            query = query.filter(Workspace.id.in_(member_ws_ids))
        return query.order_by(Workspace.name).all()

    @staticmethod
    def get_workspace(workspace_id):
        return Workspace.query.get(workspace_id)

    @staticmethod
    def get_workspace_by_slug(slug):
        return Workspace.query.filter_by(slug=slug).first()

    @staticmethod
    def create_workspace(data, user_id):
        name = data.get('name', '').strip()
        if not name:
            raise ValueError('Workspace name required')

        slug = unique_slug(
            name,
            lambda s: Workspace.query.filter_by(slug=s).first() is not None,
            default='workspace',
        )

        workspace = Workspace(
            name=name,
            slug=slug,
            description=data.get('description', ''),
            logo_url=data.get('logo_url'),
            primary_color=data.get('primary_color'),
            max_servers=data.get('max_servers', 0),
            max_users=data.get('max_users', 0),
            max_api_calls=data.get('max_api_calls', 0),
            created_by=user_id,
        )
        if 'settings' in data:
            workspace.settings = data['settings']

        db.session.add(workspace)
        db.session.flush()

        # Creator becomes owner
        member = WorkspaceMember(
            workspace_id=workspace.id,
            user_id=user_id,
            role=WorkspaceMember.ROLE_OWNER,
        )
        db.session.add(member)
        db.session.commit()
        return workspace

    @staticmethod
    def update_workspace(workspace_id, data):
        ws = Workspace.query.get(workspace_id)
        if not ws:
            return None
        for field in ['name', 'description', 'logo_url', 'primary_color',
                      'max_servers', 'max_users', 'max_api_calls', 'billing_notes']:
            if field in data:
                setattr(ws, field, data[field])
        if 'settings' in data:
            ws.settings = data['settings']
        db.session.commit()
        return ws

    @staticmethod
    def archive_workspace(workspace_id):
        ws = Workspace.query.get(workspace_id)
        if not ws:
            return None
        ws.status = Workspace.STATUS_ARCHIVED
        db.session.commit()
        return ws

    @staticmethod
    def restore_workspace(workspace_id):
        ws = Workspace.query.get(workspace_id)
        if not ws:
            return None
        ws.status = Workspace.STATUS_ACTIVE
        db.session.commit()
        return ws

    @staticmethod
    def delete_workspace(workspace_id):
        ws = Workspace.query.get(workspace_id)
        if not ws:
            return False
        # Projects never ride a workspace delete (they carry environments and
        # app groupings) — Workspace.projects is deliberately uncascaded, so
        # without this refusal the delete would IntegrityError anyway.
        project_count = ws.projects.count()
        if project_count:
            raise ValueError(
                f'Workspace still contains {project_count} project(s) — '
                'delete or move them first')
        WorkspaceApiKey.query.filter_by(workspace_id=workspace_id).delete()
        WorkspaceMember.query.filter_by(workspace_id=workspace_id).delete()
        db.session.delete(ws)
        db.session.commit()
        return True

    # --- Members ---

    @staticmethod
    def get_member(member_id):
        return WorkspaceMember.query.get(member_id)

    @staticmethod
    def get_members(workspace_id):
        return WorkspaceMember.query.filter_by(workspace_id=workspace_id).all()

    @staticmethod
    def add_member(workspace_id, user_id, role='member'):
        ws = Workspace.query.get(workspace_id)
        if not ws:
            raise ValueError('Workspace not found')

        # Quota check
        if ws.max_users > 0 and ws.members.count() >= ws.max_users:
            raise ValueError('Workspace user limit reached')

        existing = WorkspaceMember.query.filter_by(
            workspace_id=workspace_id, user_id=user_id
        ).first()
        if existing:
            raise ValueError('User already a member')

        member = WorkspaceMember(
            workspace_id=workspace_id,
            user_id=user_id,
            role=role,
        )
        db.session.add(member)
        db.session.commit()
        return member

    @staticmethod
    def update_member_role(member_id, role):
        member = WorkspaceMember.query.get(member_id)
        if not member:
            return None
        member.role = role
        db.session.commit()
        return member

    @staticmethod
    def remove_member(member_id):
        member = WorkspaceMember.query.get(member_id)
        if not member:
            return False
        if member.role == WorkspaceMember.ROLE_OWNER:
            # Ensure at least one owner remains
            owner_count = WorkspaceMember.query.filter_by(
                workspace_id=member.workspace_id, role=WorkspaceMember.ROLE_OWNER
            ).count()
            if owner_count <= 1:
                raise ValueError('Cannot remove the last owner')
        db.session.delete(member)
        db.session.commit()
        return True

    @staticmethod
    def get_user_role(workspace_id, user_id):
        member = WorkspaceMember.query.filter_by(
            workspace_id=workspace_id, user_id=user_id
        ).first()
        return member.role if member else None

    # --- API Keys ---

    @staticmethod
    def create_api_key(workspace_id, name, scopes=None, user_id=None):
        raw_key = f'wsk_{secrets.token_urlsafe(32)}'
        key_hash = hashlib.sha256(raw_key.encode()).hexdigest()

        api_key = WorkspaceApiKey(
            workspace_id=workspace_id,
            name=name,
            key_hash=key_hash,
            key_prefix=raw_key[:12],
            created_by=user_id,
        )
        if scopes:
            api_key.scopes = scopes
        db.session.add(api_key)
        db.session.commit()
        return api_key, raw_key

    @staticmethod
    def get_api_key(key_id):
        return WorkspaceApiKey.query.get(key_id)

    @staticmethod
    def list_api_keys(workspace_id):
        return WorkspaceApiKey.query.filter_by(workspace_id=workspace_id).all()

    @staticmethod
    def revoke_api_key(key_id):
        key = WorkspaceApiKey.query.get(key_id)
        if not key:
            return False
        key.is_active = False
        db.session.commit()
        return True

    @staticmethod
    def get_all_workspaces_admin():
        """Super-admin: see all workspaces with usage info."""
        workspaces = Workspace.query.order_by(Workspace.name).all()
        return [{
            **ws.to_dict(),
            'member_count': ws.members.count(),
            'api_key_count': ws.api_keys.filter_by(is_active=True).count(),
        } for ws in workspaces]
