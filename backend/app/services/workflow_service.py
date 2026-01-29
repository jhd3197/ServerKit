"""
Workflow Deployment Service

Orchestrates deployment of workflows by converting visual nodes and edges
into actual infrastructure resources (Docker apps, databases, domains).
"""

import json
import os
from app import db
from app.models import Workflow, Application, Domain, User
from app.services.docker_service import DockerService
from app.services.database_service import DatabaseService
from app import paths


class WorkflowService:
    """Service for deploying workflows to infrastructure."""

    # Base path for app deployments
    APP_BASE_PATH = paths.APPS_DIR

    @staticmethod
    def deploy_workflow(workflow_id, user_id):
        """
        Deploy all resources from a workflow.

        Args:
            workflow_id: ID of the workflow to deploy
            user_id: ID of the user deploying

        Returns:
            dict with results, errors, and updated workflow
        """
        workflow = Workflow.query.get(workflow_id)
        if not workflow:
            return {'success': False, 'error': 'Workflow not found'}

        # Verify user access
        user = User.query.get(user_id)
        if not user:
            return {'success': False, 'error': 'User not found'}

        if user.role != 'admin' and workflow.user_id != user_id:
            return {'success': False, 'error': 'Access denied'}

        # Parse workflow data
        nodes = json.loads(workflow.nodes) if workflow.nodes else []
        edges = json.loads(workflow.edges) if workflow.edges else []

        if not nodes:
            return {'success': False, 'error': 'Workflow has no nodes to deploy'}

        # Get deployment order
        ordered_nodes = WorkflowService.get_deployment_order(nodes, edges)

        # Track results and created resources
        results = []
        errors = []
        created_resources = {}  # nodeId -> resourceId mapping

        # Deploy each node
        for node in ordered_nodes:
            result = WorkflowService.deploy_node(
                node, edges, user_id, created_resources
            )
            results.append(result)

            if result['success']:
                created_resources[node['id']] = {
                    'type': node['type'],
                    'resourceId': result.get('resourceId'),
                    'resourceName': result.get('resourceName'),
                    'credentials': result.get('credentials'),  # Store DB credentials for apps
                    'rootPath': result.get('rootPath')
                }
            else:
                errors.append({
                    'nodeId': node['id'],
                    'type': node['type'],
                    'error': result.get('error')
                })

        # Update workflow nodes with created resource IDs
        updated_nodes = WorkflowService.update_nodes_with_ids(nodes, created_resources)
        workflow.nodes = json.dumps(updated_nodes)
        db.session.commit()

        return {
            'success': len(errors) == 0,
            'message': 'Deployment completed' if len(errors) == 0 else 'Deployment completed with errors',
            'results': results,
            'errors': errors,
            'workflow': workflow.to_dict()
        }

    @staticmethod
    def get_deployment_order(nodes, edges):
        """
        Determine deployment order using topological sort.

        Order: databases -> apps -> domains

        Args:
            nodes: List of workflow nodes
            edges: List of workflow edges

        Returns:
            List of nodes in deployment order
        """
        # Separate by type
        databases = [n for n in nodes if n['type'] == 'database']
        apps = [n for n in nodes if n['type'] in ('dockerApp', 'service')]
        domains = [n for n in nodes if n['type'] == 'domain']

        # Order: databases first, then apps, then domains
        return databases + apps + domains

    @staticmethod
    def deploy_node(node, edges, user_id, created_resources):
        """
        Deploy a single node based on its type.

        Args:
            node: Node to deploy
            edges: All workflow edges
            user_id: User ID for ownership
            created_resources: Already created resources mapping

        Returns:
            dict with success, resourceId, etc.
        """
        node_type = node.get('type')
        node_data = node.get('data', {})

        try:
            if node_type == 'database':
                return WorkflowService.deploy_database(node, user_id)
            elif node_type == 'dockerApp':
                return WorkflowService.deploy_docker_app(node, edges, user_id, created_resources)
            elif node_type == 'service':
                return WorkflowService.deploy_service(node, edges, user_id, created_resources)
            elif node_type == 'domain':
                return WorkflowService.deploy_domain(node, edges, user_id, created_resources)
            else:
                return {
                    'nodeId': node['id'],
                    'type': node_type,
                    'success': False,
                    'error': f'Unknown node type: {node_type}'
                }
        except Exception as e:
            return {
                'nodeId': node['id'],
                'type': node_type,
                'success': False,
                'error': str(e)
            }

    @staticmethod
    def deploy_database(node, user_id):
        """
        Deploy a database node.

        For MVP: Creates database using existing database service.
        Note: Databases don't have a model in the current system,
        so we track by name rather than ID.

        Args:
            node: Database node
            user_id: User ID

        Returns:
            dict with deployment result
        """
        node_data = node.get('data', {})
        db_name = node_data.get('name', '').replace(' ', '_').replace('-', '_').lower()
        db_type = node_data.get('type', 'mysql')

        if not db_name:
            return {
                'nodeId': node['id'],
                'type': 'database',
                'success': False,
                'error': 'Database name is required'
            }

        # Check if already deployed (has dbName set)
        if node_data.get('deployed'):
            return {
                'nodeId': node['id'],
                'type': 'database',
                'success': True,
                'resourceId': None,
                'resourceName': db_name,
                'message': 'Database already deployed'
            }

        try:
            if db_type == 'mysql':
                # Create MySQL database with user
                result = DatabaseService.mysql_create_database(
                    db_name,
                    charset='utf8mb4',
                    collation='utf8mb4_unicode_ci'
                )

                if result.get('success'):
                    # Also create a user for the database
                    password = DatabaseService.generate_password()
                    user_result = DatabaseService.mysql_create_user(
                        username=db_name,
                        password=password,
                        host='%'
                    )

                    if user_result.get('success'):
                        # Grant privileges
                        DatabaseService.mysql_grant_privileges(
                            username=db_name,
                            database=db_name,
                            privileges='ALL',
                            host='%'
                        )

                    return {
                        'nodeId': node['id'],
                        'type': 'database',
                        'success': True,
                        'resourceId': None,
                        'resourceName': db_name,
                        'credentials': {
                            'database': db_name,
                            'username': db_name,
                            'password': password,
                            'host': 'localhost',
                            'port': 3306
                        }
                    }
                else:
                    return {
                        'nodeId': node['id'],
                        'type': 'database',
                        'success': False,
                        'error': result.get('error', 'Failed to create MySQL database')
                    }

            elif db_type == 'postgresql':
                result = DatabaseService.pg_create_database(db_name)

                if result.get('success'):
                    password = DatabaseService.generate_password()
                    user_result = DatabaseService.pg_create_user(
                        username=db_name,
                        password=password
                    )

                    if user_result.get('success'):
                        DatabaseService.pg_grant_privileges(
                            username=db_name,
                            database=db_name,
                            privileges='ALL'
                        )

                    return {
                        'nodeId': node['id'],
                        'type': 'database',
                        'success': True,
                        'resourceId': None,
                        'resourceName': db_name,
                        'credentials': {
                            'database': db_name,
                            'username': db_name,
                            'password': password,
                            'host': 'localhost',
                            'port': 5432
                        }
                    }
                else:
                    return {
                        'nodeId': node['id'],
                        'type': 'database',
                        'success': False,
                        'error': result.get('error', 'Failed to create PostgreSQL database')
                    }

            else:
                # MongoDB and Redis would be handled as Docker containers
                return {
                    'nodeId': node['id'],
                    'type': 'database',
                    'success': False,
                    'error': f'{db_type} databases should be deployed as Docker containers'
                }

        except Exception as e:
            return {
                'nodeId': node['id'],
                'type': 'database',
                'success': False,
                'error': str(e)
            }

    @staticmethod
    def deploy_docker_app(node, edges, user_id, created_resources):
        """
        Deploy a Docker app node.

        Args:
            node: Docker app node
            edges: Workflow edges (to find database connections)
            user_id: User ID
            created_resources: Already created resources

        Returns:
            dict with deployment result
        """
        node_data = node.get('data', {})
        app_name = node_data.get('name', '').replace(' ', '-').lower()
        image = node_data.get('image', 'nginx:latest')
        ports = node_data.get('ports', [])
        memory = node_data.get('memory')

        if not app_name:
            return {
                'nodeId': node['id'],
                'type': 'dockerApp',
                'success': False,
                'error': 'App name is required'
            }

        # Check if already deployed
        existing_app_id = node_data.get('appId')
        if existing_app_id:
            app = Application.query.get(existing_app_id)
            if app:
                # Update existing app
                if image:
                    app.docker_image = image
                if ports:
                    # Extract host port from first port mapping
                    first_port = ports[0] if ports else None
                    if first_port and ':' in first_port:
                        app.port = int(first_port.split(':')[0])
                db.session.commit()

                return {
                    'nodeId': node['id'],
                    'type': 'dockerApp',
                    'success': True,
                    'resourceId': app.id,
                    'resourceName': app.name,
                    'message': 'App updated'
                }

        # Find connected database for environment variables
        env_vars = {}
        for edge in edges:
            if edge.get('source') == node['id']:
                # This app connects to something
                target_id = edge.get('target')
                target_resource = created_resources.get(target_id)

                if target_resource and target_resource['type'] == 'database':
                    # Get database credentials from the deployment result
                    credentials = target_resource.get('credentials', {})
                    if credentials:
                        env_vars.update({
                            'DB_HOST': credentials.get('host', 'localhost'),
                            'DB_NAME': credentials.get('database', ''),
                            'DB_USER': credentials.get('username', ''),
                            'DB_PASSWORD': credentials.get('password', ''),
                            'DB_PORT': str(credentials.get('port', 3306))
                        })
                    else:
                        # Fallback to naming convention
                        db_name = target_resource.get('resourceName', '')
                        env_vars.update({
                            'DB_HOST': 'localhost',
                            'DB_NAME': db_name,
                            'DB_USER': db_name,
                            'DB_PORT': '3306'
                        })

        # Create the application record
        app = Application(
            name=app_name,
            app_type='docker',
            status='stopped',
            docker_image=image,
            user_id=user_id
        )

        # Extract host port from first port mapping
        if ports:
            first_port = ports[0]
            if ':' in first_port:
                app.port = int(first_port.split(':')[0])
            else:
                app.port = int(first_port)

        # Set root path
        app.root_path = os.path.join(WorkflowService.APP_BASE_PATH, app_name)

        db.session.add(app)
        db.session.commit()

        # Create Docker compose files
        docker_result = DockerService.create_docker_app(
            app_path=app.root_path,
            app_name=app_name,
            image=image,
            ports=ports if ports else None,
            env=env_vars if env_vars else None
        )

        if not docker_result.get('success'):
            # Rollback application creation
            db.session.delete(app)
            db.session.commit()
            return {
                'nodeId': node['id'],
                'type': 'dockerApp',
                'success': False,
                'error': docker_result.get('error', 'Failed to create Docker app')
            }

        # Start the containers
        start_result = DockerService.compose_up(app.root_path, detach=True)
        if start_result.get('success'):
            app.status = 'running'
            db.session.commit()
        else:
            # App created but containers didn't start - still return success
            # but include warning
            return {
                'nodeId': node['id'],
                'type': 'dockerApp',
                'success': True,
                'resourceId': app.id,
                'resourceName': app.name,
                'port': app.port,
                'rootPath': app.root_path,
                'warning': f'App created but containers failed to start: {start_result.get("error", "Unknown error")}'
            }

        return {
            'nodeId': node['id'],
            'type': 'dockerApp',
            'success': True,
            'resourceId': app.id,
            'resourceName': app.name,
            'port': app.port,
            'rootPath': app.root_path,
            'status': 'running'
        }

    @staticmethod
    def deploy_service(node, edges, user_id, created_resources):
        """
        Deploy a service node.

        Services are similar to Docker apps but may have specialized handling.
        For now, treat them as Docker apps.
        """
        return WorkflowService.deploy_docker_app(node, edges, user_id, created_resources)

    @staticmethod
    def deploy_domain(node, edges, user_id, created_resources):
        """
        Deploy a domain node.

        Domains must be connected to an app. Find the connected app
        from edges and create the domain linked to that app.

        Args:
            node: Domain node
            edges: Workflow edges
            user_id: User ID
            created_resources: Already created resources

        Returns:
            dict with deployment result
        """
        node_data = node.get('data', {})
        domain_name = node_data.get('name', '')
        ssl_status = node_data.get('ssl', 'none')

        if not domain_name:
            return {
                'nodeId': node['id'],
                'type': 'domain',
                'success': False,
                'error': 'Domain name is required'
            }

        # Check if already deployed
        existing_domain_id = node_data.get('domainId')
        if existing_domain_id:
            domain = Domain.query.get(existing_domain_id)
            if domain:
                return {
                    'nodeId': node['id'],
                    'type': 'domain',
                    'success': True,
                    'resourceId': domain.id,
                    'resourceName': domain.name,
                    'message': 'Domain already exists'
                }

        # Find the app this domain connects to
        target_app_id = None
        for edge in edges:
            if edge.get('source') == node['id']:
                target_id = edge.get('target')
                target_resource = created_resources.get(target_id)

                if target_resource and target_resource['type'] in ('dockerApp', 'service'):
                    target_app_id = target_resource.get('resourceId')
                    break

        if not target_app_id:
            return {
                'nodeId': node['id'],
                'type': 'domain',
                'success': False,
                'error': 'Domain must be connected to an app'
            }

        # Verify the app exists
        app = Application.query.get(target_app_id)
        if not app:
            return {
                'nodeId': node['id'],
                'type': 'domain',
                'success': False,
                'error': 'Connected app not found'
            }

        # Check if domain already exists
        existing = Domain.query.filter_by(name=domain_name).first()
        if existing:
            return {
                'nodeId': node['id'],
                'type': 'domain',
                'success': False,
                'error': f'Domain {domain_name} already exists'
            }

        # Create the domain
        domain = Domain(
            name=domain_name,
            is_primary=True,
            ssl_enabled=ssl_status == 'valid',
            ssl_auto_renew=True,
            application_id=target_app_id
        )

        db.session.add(domain)
        db.session.commit()

        # Create nginx config
        from app.services.nginx_service import NginxService

        if app.port:
            all_domains = [d.name for d in Domain.query.filter_by(application_id=target_app_id).all()]
            nginx_result = NginxService.create_site(
                name=app.name,
                app_type='docker',
                domains=all_domains,
                root_path=app.root_path or '',
                port=app.port
            )

            if nginx_result.get('success'):
                NginxService.enable_site(app.name)

        return {
            'nodeId': node['id'],
            'type': 'domain',
            'success': True,
            'resourceId': domain.id,
            'resourceName': domain.name,
            'applicationId': target_app_id
        }

    @staticmethod
    def update_nodes_with_ids(nodes, created_resources):
        """
        Update node data with created resource IDs.

        Args:
            nodes: Original nodes list
            created_resources: Mapping of nodeId to resource info

        Returns:
            Updated nodes list
        """
        updated = []
        for node in nodes:
            node_copy = dict(node)
            resource = created_resources.get(node['id'])

            if resource:
                data = dict(node_copy.get('data', {}))

                if resource['type'] == 'dockerApp' or resource['type'] == 'service':
                    data['appId'] = resource.get('resourceId')
                    data['deployed'] = True
                elif resource['type'] == 'domain':
                    data['domainId'] = resource.get('resourceId')
                    data['deployed'] = True
                elif resource['type'] == 'database':
                    data['deployed'] = True
                    data['dbName'] = resource.get('resourceName')

                node_copy['data'] = data

            updated.append(node_copy)

        return updated
