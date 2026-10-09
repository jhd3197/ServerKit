# Bucket: PER-APP (plan 29 #9). Volume routes gate on the shared app-access seam
# (can_access_app for reads, can_edit_app for attach/detach mutations).
"""Per-app managed volume API — attach/list/detach first-class persistent
volumes for an application. Mounted under ``/api/v1/apps`` alongside the main
apps blueprint (routes are ``/<app_id>/volumes*``).
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required

from app.models import Application
from app.services.resource_grant_service import ResourceGrantService
from app.services.volume_service import VolumeService, VolumeError
from app.middleware.rbac import get_current_user
from app.exceptions import not_found, permission_denied

app_volumes_bp = Blueprint('app_volumes', __name__)


def _load_app_for(app_id, *, write):
    """Resolve (user, app) with the right ACL, or an (error_response, status)."""
    user = get_current_user()
    app = Application.query_active().filter_by(id=app_id).first()
    if not app:
        raise not_found('service')
    allowed = (ResourceGrantService.can_edit_app(user, app) if write
               else ResourceGrantService.can_access_app(user, app))
    if not allowed:
        raise permission_denied()
    return user, app, None


@app_volumes_bp.route('/<int:app_id>/volumes', methods=['GET'])
@jwt_required()
def list_volumes(app_id):
    _user, app, err = _load_app_for(app_id, write=False)
    if err:
        return err
    volumes = [v.to_dict(live=live) for v, live in VolumeService.list_for_app(app)]
    return jsonify({'volumes': volumes})


@app_volumes_bp.route('/<int:app_id>/volumes', methods=['POST'])
@jwt_required()
def attach_volume(app_id):
    _user, app, err = _load_app_for(app_id, write=True)
    if err:
        return err
    data = request.get_json() or {}
    try:
        volume = VolumeService.create(
            app,
            name=data.get('name'),
            mount_path=data.get('mount_path'),
            driver=data.get('driver') or 'local',
            read_only=bool(data.get('read_only')),
        )
    except VolumeError as e:
        return jsonify({'error': str(e)}), 400
    live = None
    return jsonify({'volume': volume.to_dict(live=live)}), 201


@app_volumes_bp.route('/<int:app_id>/volumes/<int:volume_id>', methods=['DELETE'])
@jwt_required()
def detach_volume(app_id, volume_id):
    _user, app, err = _load_app_for(app_id, write=True)
    if err:
        return err
    volume = VolumeService.get(volume_id)
    if not volume or volume.application_id != app.id:
        return jsonify({'error': 'Volume not found'}), 404
    wipe = str(request.args.get('wipe', '')).lower() in ('1', 'true', 'yes')
    try:
        VolumeService.delete(volume, wipe=wipe)
    except VolumeError as e:
        return jsonify({'error': str(e)}), 400
    return jsonify({'success': True, 'wiped': wipe})


@app_volumes_bp.route('/<int:app_id>/volumes/convert', methods=['POST'])
@jwt_required()
def convert_bind_mount(app_id):
    """Create a managed volume and copy an existing host directory's contents
    into it. (Deviates from the plan's ``/<vid>/convert`` — a convert creates a
    new volume, so there is no prior vid.)"""
    _user, app, err = _load_app_for(app_id, write=True)
    if err:
        return err
    data = request.get_json() or {}
    host_path = data.get('host_path')
    mount_path = data.get('mount_path')
    if not host_path or not mount_path:
        return jsonify({'error': 'host_path and mount_path are required'}), 400
    try:
        volume = VolumeService.convert_bind_mount(app, host_path, mount_path, name=data.get('name'))
    except VolumeError as e:
        return jsonify({'error': str(e)}), 400
    return jsonify({'volume': volume.to_dict()}), 201
