import json
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from app import db
from app.models import Workflow, User

workflows_bp = Blueprint('workflows', __name__)


@workflows_bp.route('', methods=['GET'])
@jwt_required()
def get_workflows():
    """Get all workflows for the current user."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)

    if user.role == 'admin':
        workflows = Workflow.query.all()
    else:
        workflows = Workflow.query.filter_by(user_id=current_user_id).all()

    return jsonify({
        'workflows': [w.to_dict() for w in workflows]
    })


@workflows_bp.route('/<int:workflow_id>', methods=['GET'])
@jwt_required()
def get_workflow(workflow_id):
    """Get a single workflow by ID."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    workflow = Workflow.query.get(workflow_id)

    if not workflow:
        return jsonify({'error': 'Workflow not found'}), 404

    if user.role != 'admin' and workflow.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    return jsonify(workflow.to_dict())


@workflows_bp.route('', methods=['POST'])
@jwt_required()
def create_workflow():
    """Create a new workflow."""
    current_user_id = get_jwt_identity()
    data = request.get_json()

    if not data:
        return jsonify({'error': 'No data provided'}), 400

    name = data.get('name')
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    workflow = Workflow(
        name=name,
        description=data.get('description', ''),
        nodes=json.dumps(data.get('nodes', [])),
        edges=json.dumps(data.get('edges', [])),
        viewport=json.dumps(data.get('viewport')) if data.get('viewport') else None,
        user_id=current_user_id
    )

    db.session.add(workflow)
    db.session.commit()

    return jsonify({
        'message': 'Workflow created successfully',
        'workflow': workflow.to_dict()
    }), 201


@workflows_bp.route('/<int:workflow_id>', methods=['PUT'])
@jwt_required()
def update_workflow(workflow_id):
    """Update an existing workflow."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    workflow = Workflow.query.get(workflow_id)

    if not workflow:
        return jsonify({'error': 'Workflow not found'}), 404

    if user.role != 'admin' and workflow.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data provided'}), 400

    if 'name' in data:
        workflow.name = data['name']
    if 'description' in data:
        workflow.description = data['description']
    if 'nodes' in data:
        workflow.nodes = json.dumps(data['nodes'])
    if 'edges' in data:
        workflow.edges = json.dumps(data['edges'])
    if 'viewport' in data:
        workflow.viewport = json.dumps(data['viewport']) if data['viewport'] else None

    db.session.commit()

    return jsonify({
        'message': 'Workflow updated successfully',
        'workflow': workflow.to_dict()
    })


@workflows_bp.route('/<int:workflow_id>', methods=['DELETE'])
@jwt_required()
def delete_workflow(workflow_id):
    """Delete a workflow."""
    current_user_id = get_jwt_identity()
    user = User.query.get(current_user_id)
    workflow = Workflow.query.get(workflow_id)

    if not workflow:
        return jsonify({'error': 'Workflow not found'}), 404

    if user.role != 'admin' and workflow.user_id != current_user_id:
        return jsonify({'error': 'Access denied'}), 403

    db.session.delete(workflow)
    db.session.commit()

    return jsonify({'message': 'Workflow deleted successfully'})


@workflows_bp.route('/<int:workflow_id>/deploy', methods=['POST'])
@jwt_required()
def deploy_workflow(workflow_id):
    """
    Deploy all resources from a workflow.

    This endpoint converts workflow nodes (Docker apps, databases, domains)
    into actual infrastructure by calling the appropriate backend services.

    Returns:
        {
            "success": boolean,
            "message": string,
            "results": [
                {"nodeId": "node_1", "type": "dockerApp", "success": true, "resourceId": 5},
                {"nodeId": "node_2", "type": "domain", "success": true, "resourceId": 12},
                ...
            ],
            "errors": [],
            "workflow": {...updated workflow with resource IDs...}
        }
    """
    from app.services.workflow_service import WorkflowService

    current_user_id = get_jwt_identity()

    result = WorkflowService.deploy_workflow(workflow_id, current_user_id)

    if result.get('success'):
        return jsonify(result), 200
    elif result.get('error') == 'Workflow not found':
        return jsonify(result), 404
    elif result.get('error') == 'Access denied':
        return jsonify(result), 403
    else:
        # Partial success or errors - return 200 with error details
        return jsonify(result), 200
