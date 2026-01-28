"""
Environment Health Service

Monitors the health of WordPress environment containers, databases,
and WordPress HTTP responses. Also tracks disk usage.
"""

import os
import subprocess
from datetime import datetime
from typing import Dict, Optional

from app import db
from app.models.wordpress_site import WordPressSite
from app.services.environment_docker_service import EnvironmentDockerService
from app.services.environment_pipeline_service import EnvironmentPipelineService


class EnvironmentHealthService:
    """Service for checking environment health and disk usage."""

    @classmethod
    def check_health(cls, site_id: int) -> Dict:
        """Run health checks for a single environment.

        Checks: container running, MySQL connectivity, WordPress HTTP response.

        Returns:
            Dict with overall status and individual check results
        """
        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        compose_path = EnvironmentPipelineService._get_compose_path(site)
        checks = {
            'container': {'status': 'unknown', 'message': ''},
            'mysql': {'status': 'unknown', 'message': ''},
            'wordpress': {'status': 'unknown', 'message': ''},
        }

        # Container check
        if compose_path:
            status_result = EnvironmentDockerService.get_environment_status(compose_path)
            if status_result.get('running'):
                checks['container'] = {'status': 'healthy', 'message': 'All containers running'}
            elif status_result.get('success'):
                checks['container'] = {'status': 'unhealthy', 'message': 'Containers not running'}
            else:
                checks['container'] = {'status': 'unhealthy', 'message': status_result.get('error', 'Status check failed')}
        else:
            checks['container'] = {'status': 'unknown', 'message': 'No Docker compose configuration'}

        # MySQL check
        if compose_path and checks['container']['status'] == 'healthy':
            mysql_result = EnvironmentDockerService.exec_in_container(
                compose_path, 'db', 'mysqladmin ping -h 127.0.0.1'
            )
            if mysql_result.get('success'):
                checks['mysql'] = {'status': 'healthy', 'message': 'MySQL is alive'}
            else:
                checks['mysql'] = {'status': 'unhealthy', 'message': mysql_result.get('error', 'MySQL ping failed')}
        elif checks['container']['status'] != 'healthy':
            checks['mysql'] = {'status': 'unknown', 'message': 'Container not running'}

        # WordPress HTTP check
        if compose_path and checks['container']['status'] == 'healthy':
            port = site.application.port if site.application else None
            if port:
                wp_result = cls._check_wordpress_http(port)
                checks['wordpress'] = wp_result
            else:
                checks['wordpress'] = {'status': 'unknown', 'message': 'No port configured'}
        elif checks['container']['status'] != 'healthy':
            checks['wordpress'] = {'status': 'unknown', 'message': 'Container not running'}

        # Determine overall status
        statuses = [c['status'] for c in checks.values()]
        if all(s == 'healthy' for s in statuses):
            overall = 'healthy'
        elif any(s == 'unhealthy' for s in statuses):
            overall = 'unhealthy'
        elif any(s == 'healthy' for s in statuses):
            overall = 'degraded'
        else:
            overall = 'unknown'

        # Update site record
        site.health_status = overall
        site.last_health_check = datetime.utcnow()
        db.session.commit()

        return {
            'success': True,
            'site_id': site_id,
            'overall_status': overall,
            'checks': checks,
            'checked_at': datetime.utcnow().isoformat(),
        }

    @classmethod
    def check_all_project_health(cls, production_site_id: int) -> Dict:
        """Check health for all environments in a project.

        Returns:
            Dict with health data for production and all child environments
        """
        prod_site = WordPressSite.query.get(production_site_id)
        if not prod_site:
            return {'success': False, 'error': 'Production site not found'}

        results = {}

        # Check production
        prod_health = cls.check_health(production_site_id)
        results[production_site_id] = prod_health

        # Check all child environments
        for env in prod_site.environments:
            env_health = cls.check_health(env.id)
            results[env.id] = env_health

        return {
            'success': True,
            'project_id': production_site_id,
            'environments': results,
        }

    @classmethod
    def get_disk_usage(cls, site_id: int) -> Dict:
        """Calculate disk usage for an environment.

        Measures WordPress files and MySQL data directories.

        Returns:
            Dict with usage breakdown in bytes
        """
        site = WordPressSite.query.get(site_id)
        if not site:
            return {'success': False, 'error': 'Site not found'}

        app = site.application
        if not app or not app.root_path:
            return {'success': False, 'error': 'No application root path'}

        env_dir = app.root_path
        usage = {
            'wordpress': 0,
            'mysql': 0,
            'snapshots': 0,
            'total': 0,
        }

        # WordPress files
        wp_dir = os.path.join(env_dir, 'wordpress')
        if os.path.exists(wp_dir):
            usage['wordpress'] = cls._get_dir_size(wp_dir)
        elif os.path.exists(env_dir):
            usage['wordpress'] = cls._get_dir_size(env_dir)

        # MySQL data
        mysql_dir = os.path.join(env_dir, 'mysql-data')
        if os.path.exists(mysql_dir):
            usage['mysql'] = cls._get_dir_size(mysql_dir)

        # Snapshots
        snapshots_dir = os.path.join(env_dir, 'snapshots')
        if os.path.exists(snapshots_dir):
            usage['snapshots'] = cls._get_dir_size(snapshots_dir)

        usage['total'] = usage['wordpress'] + usage['mysql'] + usage['snapshots']

        # Update site record
        site.disk_usage_bytes = usage['total']
        site.disk_usage_updated_at = datetime.utcnow()
        db.session.commit()

        return {
            'success': True,
            'site_id': site_id,
            'usage': usage,
            'total_human': cls._format_size(usage['total']),
            'breakdown': {
                'wordpress': cls._format_size(usage['wordpress']),
                'mysql': cls._format_size(usage['mysql']),
                'snapshots': cls._format_size(usage['snapshots']),
            },
            'updated_at': datetime.utcnow().isoformat(),
        }

    @classmethod
    def get_disk_usage_for_project(cls, production_site_id: int) -> Dict:
        """Get disk usage for all environments in a project.

        Returns:
            Dict with disk usage data for each environment
        """
        prod_site = WordPressSite.query.get(production_site_id)
        if not prod_site:
            return {'success': False, 'error': 'Production site not found'}

        results = {}
        total = 0

        # Production
        prod_usage = cls.get_disk_usage(production_site_id)
        results[production_site_id] = prod_usage
        if prod_usage.get('success'):
            total += prod_usage['usage']['total']

        # Child environments
        for env in prod_site.environments:
            env_usage = cls.get_disk_usage(env.id)
            results[env.id] = env_usage
            if env_usage.get('success'):
                total += env_usage['usage']['total']

        return {
            'success': True,
            'project_id': production_site_id,
            'environments': results,
            'project_total': total,
            'project_total_human': cls._format_size(total),
        }

    @classmethod
    def _check_wordpress_http(cls, port: int) -> Dict:
        """Check WordPress HTTP response on localhost."""
        try:
            result = subprocess.run(
                ['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
                 '--max-time', '5', f'http://127.0.0.1:{port}/wp-login.php'],
                capture_output=True,
                text=True,
                timeout=10
            )

            status_code = result.stdout.strip()
            if status_code in ('200', '302', '301'):
                return {'status': 'healthy', 'message': f'HTTP {status_code}'}
            elif status_code == '401':
                return {'status': 'healthy', 'message': 'HTTP 401 (Basic Auth enabled)'}
            elif status_code == '000' or not status_code:
                return {'status': 'unhealthy', 'message': 'Connection refused'}
            else:
                return {'status': 'degraded', 'message': f'HTTP {status_code}'}

        except subprocess.TimeoutExpired:
            return {'status': 'unhealthy', 'message': 'HTTP check timed out'}
        except Exception as e:
            return {'status': 'unknown', 'message': str(e)}

    @classmethod
    def _get_dir_size(cls, path: str) -> int:
        """Get total size of a directory in bytes."""
        try:
            result = subprocess.run(
                ['du', '-sb', path],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode == 0 and result.stdout.strip():
                return int(result.stdout.split()[0])
        except Exception:
            pass

        # Fallback: walk directory
        total = 0
        try:
            for dirpath, dirnames, filenames in os.walk(path):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    try:
                        total += os.path.getsize(fp)
                    except OSError:
                        pass
        except Exception:
            pass
        return total

    @staticmethod
    def _format_size(size_bytes: int) -> str:
        """Format bytes to human-readable string."""
        if not size_bytes:
            return '0 B'
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size_bytes < 1024:
                return f'{size_bytes:.1f} {unit}'
            size_bytes /= 1024
        return f'{size_bytes:.1f} TB'
