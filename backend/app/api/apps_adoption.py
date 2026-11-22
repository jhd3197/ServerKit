"""Site adoption routes — register sites that already run on this host.

An area module of the apps blueprint: importing it registers the routes on
``apps_bp`` (see the bottom of app/api/apps.py), so they live under
/api/v1/apps/host-sites. Admin-only: discovery reads the host's nginx,
PHP-FPM and site configuration, and adopting creates an application any
admin could then operate.

Nothing here writes to the host. See app/services/site_adoption_service.py.
"""
from flask import jsonify, request

from app.api._request import json_object
from app.api.apps import apps_bp
from app.exceptions import field_required
from app.middleware.rbac import admin_required, get_current_user
from app.services import site_adoption_service

@apps_bp.route('/host-sites', methods=['GET'])
@admin_required
def list_host_sites():
    """Every site host nginx serves, and whether an application accounts for
    it. ``unmanaged`` is the drift count: live sites the panel cannot see."""
    sites = site_adoption_service.discover()
    return jsonify({
        'sites': sites,
        'unmanaged': sum(1 for site in sites if site['linked_app'] is None),
        'adoptable': sum(1 for site in sites if site['adoptable']),
    }), 200


@apps_bp.route('/host-sites/adopt', methods=['POST'])
@admin_required
def adopt_host_site():
    """Adopt one site. A dry run unless the body says ``"dry_run": false`` —
    the default answer is the plan, never the change."""
    data = json_object()
    identifier = (data.get('site') or '').strip()
    if not identifier:
        raise field_required('site')
    name = (data.get('name') or '').strip() or None

    if data.get('dry_run', True) is not False:
        site = site_adoption_service.find(identifier)
        if site is None:
            raise site_adoption_service.unknown_site(identifier)
        return jsonify({'dry_run': True, 'adoptable': site['adoptable'],
                        'reason': site['reason'],
                        'plan': site_adoption_service.plan(site, name)}), 200

    user = get_current_user()
    from app.services.workspace_service import WorkspaceService
    workspace_id = WorkspaceService.resolve_workspace_id(
        user, request.headers.get('X-Workspace-Id') or request.args.get('workspace_id'))
    application, plan = site_adoption_service.adopt(
        identifier, user, name=name, workspace_id=workspace_id)
    return jsonify({'message': 'Site adopted', 'dry_run': False, 'plan': plan,
                    'app': application.to_dict()}), 201
