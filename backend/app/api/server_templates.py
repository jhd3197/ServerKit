from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from app.services.server_template_service import ServerTemplateService
from app.services.audit_service import AuditService
from app.models.audit_log import AuditLog
from app.middleware.rbac import admin_required, get_current_user
from app.exceptions import not_found

server_templates_bp = Blueprint('server_templates', __name__)


@server_templates_bp.route('/', methods=['GET'])
@jwt_required()
def list_templates():
    category = request.args.get('category')
    templates = ServerTemplateService.list_templates(category=category)
    return jsonify({'templates': [t.to_dict() for t in templates]})


@server_templates_bp.route('/library', methods=['GET'])
@jwt_required()
def get_library():
    return jsonify({'templates': ServerTemplateService.get_library_templates()})


@server_templates_bp.route('/library/<key>', methods=['POST'])
@jwt_required()
def create_from_library(key):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    try:
        template = ServerTemplateService.create_from_library(key, user.id)
        return jsonify(template.to_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@server_templates_bp.route('/<int:template_id>', methods=['GET'])
@jwt_required()
def get_template(template_id):
    template = ServerTemplateService.get_template(template_id)
    if not template:
        raise not_found('template')
    return jsonify(template.to_dict())


@server_templates_bp.route('/', methods=['POST'])
@jwt_required()
def create_template():
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    data = request.get_json()
    if not data or 'name' not in data:
        return jsonify({'error': 'name required'}), 400

    try:
        template = ServerTemplateService.create_template(data, user.id)
        AuditService.log(
            action=AuditLog.ACTION_RESOURCE_CREATE, user_id=user.id,
            target_type='server_template', target_id=template.id,
            details={'name': template.name}
        )
        return jsonify(template.to_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@server_templates_bp.route('/<int:template_id>', methods=['PUT'])
@jwt_required()
def update_template(template_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    data = request.get_json()
    template = ServerTemplateService.update_template(template_id, data)
    if not template:
        raise not_found('template')
    return jsonify(template.to_dict())


@server_templates_bp.route('/<int:template_id>', methods=['DELETE'])
@jwt_required()
def delete_template(template_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    try:
        result = ServerTemplateService.delete_template(template_id)
        if not result:
            return jsonify({'error': 'Template not found'}), 404
        return jsonify({'message': 'Template deleted'})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


# --- Assignments ---

@server_templates_bp.route('/<int:template_id>/assign', methods=['POST'])
@jwt_required()
def assign_template(template_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    data = request.get_json() or {}
    server_id = data.get('server_id')
    if not server_id:
        return jsonify({'error': 'server_id required'}), 400

    try:
        assignment = ServerTemplateService.assign_template(template_id, server_id)
        return jsonify(assignment.to_dict()), 201
    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@server_templates_bp.route('/<int:template_id>/bulk-assign', methods=['POST'])
@jwt_required()
def bulk_assign(template_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    data = request.get_json() or {}
    server_ids = data.get('server_ids', [])
    results = ServerTemplateService.bulk_assign(template_id, server_ids)
    return jsonify({'results': results})


@server_templates_bp.route('/<int:template_id>/assignments', methods=['GET'])
@jwt_required()
def get_assignments(template_id):
    assignments = ServerTemplateService.get_template_assignments(template_id)
    return jsonify({'assignments': [a.to_dict() for a in assignments]})


@server_templates_bp.route('/assignments/<int:assignment_id>', methods=['DELETE'])
@jwt_required()
def unassign(assignment_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403
    result = ServerTemplateService.unassign_template(assignment_id)
    if not result:
        return jsonify({'error': 'Assignment not found'}), 404
    return jsonify({'message': 'Template unassigned'})


@server_templates_bp.route('/assignments/<int:assignment_id>/check', methods=['POST'])
@admin_required
def check_drift(assignment_id):
    assignment = ServerTemplateService.check_drift(assignment_id)
    if not assignment:
        return jsonify({'error': 'Assignment not found'}), 404
    return jsonify(assignment.to_dict())


@server_templates_bp.route('/assignments/<int:assignment_id>/remediate', methods=['POST'])
@jwt_required()
def remediate(assignment_id):
    user = get_current_user()
    if not user or not user.is_admin:
        return jsonify({'error': 'Admin access required'}), 403

    assignment = ServerTemplateService.remediate(assignment_id)
    if not assignment:
        return jsonify({'error': 'Assignment not found'}), 404
    return jsonify(assignment.to_dict())


@server_templates_bp.route('/compliance', methods=['GET'])
@jwt_required()
def compliance_summary():
    summary = ServerTemplateService.get_compliance_summary()
    return jsonify(summary)


@server_templates_bp.route('/server/<int:server_id>', methods=['GET'])
@jwt_required()
def get_server_templates(server_id):
    assignments = ServerTemplateService.get_server_assignments(server_id)
    return jsonify({'assignments': [a.to_dict() for a in assignments]})
