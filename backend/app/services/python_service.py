import os
import shutil
import json
import secrets
from pathlib import Path

from app.utils.system import ServiceControl, run_checked


class PythonService:
    """Service for managing Python applications, virtual environments, and Gunicorn."""

    SUPPORTED_VERSIONS = ['3.9', '3.10', '3.11', '3.12']
    GUNICORN_SERVICE_TEMPLATE = '''[Unit]
Description=Gunicorn daemon for {app_name}
After=network.target

[Service]
User={user}
Group={group}
WorkingDirectory={working_dir}
Environment="PATH={venv_path}/bin"
{env_vars}
ExecStart={venv_path}/bin/gunicorn {gunicorn_args}
ExecReload=/bin/kill -s HUP $MAINPID
Restart=on-failure
RestartSec=5
KillMode=mixed
TimeoutStopSec=5

[Install]
WantedBy=multi-user.target
'''

    FLASK_APP_TEMPLATE = '''from flask import Flask, jsonify

app = Flask(__name__)


@app.route('/')
def index():
    return jsonify({
        'message': 'Welcome to {app_name}',
        'status': 'running'
    })


@app.route('/health')
def health():
    return jsonify({'status': 'healthy'})


if __name__ == '__main__':
    app.run(debug=True)
'''

    DJANGO_SETTINGS_APPEND = '''
# ServerKit Configuration
import os

# Allow all hosts in development, configure properly in production
ALLOWED_HOSTS = os.environ.get('ALLOWED_HOSTS', '*').split(',')

# Static files
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')
'''

    @staticmethod
    def get_python_versions():
        """Get available Python versions on the system."""
        versions = []
        for version in PythonService.SUPPORTED_VERSIONS:
            python_path = shutil.which(f'python{version}')
            if python_path:
                try:
                    result = run_checked([python_path, '--version'], timeout=None)
                    if result['success']:
                        full_version = result['output'].strip().replace('Python ', '')
                        versions.append({
                            'version': version,
                            'full_version': full_version,
                            'path': python_path,
                            'installed': True
                        })
                except Exception:
                    pass
            else:
                versions.append({
                    'version': version,
                    'full_version': None,
                    'path': None,
                    'installed': False
                })
        return versions

    @staticmethod
    def get_default_python():
        """Get the default Python version."""
        python_path = shutil.which('python3')
        if python_path:
            try:
                result = run_checked([python_path, '--version'], timeout=None)
                if result['success']:
                    return result['output'].strip().replace('Python ', '')
            except Exception:
                pass
        return None

    @staticmethod
    def create_virtualenv(app_path, python_version='3.11'):
        """Create a virtual environment for the application."""
        venv_path = os.path.join(app_path, 'venv')
        python_bin = f'python{python_version}'

        # Check if Python version exists
        if not shutil.which(python_bin):
            return {'success': False, 'error': f'Python {python_version} not found'}

        try:
            # Create venv
            result = run_checked([python_bin, '-m', 'venv', venv_path], timeout=None)

            if not result['success']:
                return {'success': False, 'error': result['error']}

            # Upgrade pip
            pip_path = os.path.join(venv_path, 'bin', 'pip')
            run_checked([pip_path, 'install', '--upgrade', 'pip'], timeout=None)

            return {
                'success': True,
                'venv_path': venv_path,
                'python_path': os.path.join(venv_path, 'bin', 'python'),
                'pip_path': pip_path
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def install_requirements(app_path, requirements=None):
        """Install Python packages from requirements.txt or a list."""
        venv_path = os.path.join(app_path, 'venv')
        pip_path = os.path.join(venv_path, 'bin', 'pip')

        if not os.path.exists(pip_path):
            return {'success': False, 'error': 'Virtual environment not found'}

        try:
            if requirements:
                # Install from list
                if isinstance(requirements, str):
                    requirements = [requirements]
                result = run_checked([pip_path, 'install'] + requirements, timeout=None)
            else:
                # Install from requirements.txt
                req_file = os.path.join(app_path, 'requirements.txt')
                if not os.path.exists(req_file):
                    return {'success': False, 'error': 'requirements.txt not found'}
                result = run_checked([pip_path, 'install', '-r', req_file], timeout=None)

            if not result['success']:
                return {'success': False, 'error': result['error'],
                        'output': result['output']}

            return {'success': True, 'output': result['output']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def get_installed_packages(app_path):
        """Get list of installed packages in the virtual environment."""
        venv_path = os.path.join(app_path, 'venv')
        pip_path = os.path.join(venv_path, 'bin', 'pip')

        if not os.path.exists(pip_path):
            return []

        try:
            result = run_checked([pip_path, 'list', '--format=json'], timeout=None)
            if result['success']:
                return json.loads(result['output'])
            return []
        except Exception:
            return []

    @staticmethod
    def freeze_requirements(app_path):
        """Generate requirements.txt from installed packages."""
        venv_path = os.path.join(app_path, 'venv')
        pip_path = os.path.join(venv_path, 'bin', 'pip')

        if not os.path.exists(pip_path):
            return {'success': False, 'error': 'Virtual environment not found'}

        try:
            result = run_checked([pip_path, 'freeze'], timeout=None)
            if result['success']:
                req_file = os.path.join(app_path, 'requirements.txt')
                with open(req_file, 'w') as f:
                    f.write(result['output'])
                return {'success': True, 'requirements': result['output']}
            return {'success': False, 'error': result['error']}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def create_flask_app(app_path, app_name, python_version='3.11'):
        """Create a new Flask application."""
        try:
            # Create directory
            os.makedirs(app_path, exist_ok=True)

            # Create virtual environment
            venv_result = PythonService.create_virtualenv(app_path, python_version)
            if not venv_result['success']:
                return venv_result

            # Install Flask and Gunicorn
            install_result = PythonService.install_requirements(
                app_path,
                ['flask', 'gunicorn', 'python-dotenv']
            )
            if not install_result['success']:
                return install_result

            # Create app.py
            app_content = PythonService.FLASK_APP_TEMPLATE.format(app_name=app_name)
            with open(os.path.join(app_path, 'app.py'), 'w') as f:
                f.write(app_content)

            # Create wsgi.py
            wsgi_content = '''from app import app

if __name__ == '__main__':
    app.run()
'''
            with open(os.path.join(app_path, 'wsgi.py'), 'w') as f:
                f.write(wsgi_content)

            # Create .env file
            env_content = f'''FLASK_APP=app.py
FLASK_ENV=production
SECRET_KEY={secrets.token_hex(32)}
'''
            with open(os.path.join(app_path, '.env'), 'w') as f:
                f.write(env_content)

            # Create requirements.txt
            PythonService.freeze_requirements(app_path)

            return {
                'success': True,
                'app_path': app_path,
                'message': 'Flask service created'
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def create_django_app(app_path, app_name, python_version='3.11'):
        """Create a new Django application."""
        try:
            # Create directory
            os.makedirs(app_path, exist_ok=True)

            # Create virtual environment
            venv_result = PythonService.create_virtualenv(app_path, python_version)
            if not venv_result['success']:
                return venv_result

            venv_path = os.path.join(app_path, 'venv')
            pip_path = os.path.join(venv_path, 'bin', 'pip')
            python_path = os.path.join(venv_path, 'bin', 'python')

            # Install Django and Gunicorn
            run_checked([pip_path, 'install', 'django', 'gunicorn', 'python-dotenv'],
                        timeout=None)

            # Create Django project
            django_admin = os.path.join(venv_path, 'bin', 'django-admin')
            project_name = app_name.replace('-', '_').replace(' ', '_').lower()

            result = run_checked([django_admin, 'startproject', project_name, '.'],
                                 cwd=app_path, timeout=None)

            if not result['success']:
                return {'success': False, 'error': result['error']}

            # Build ALLOWED_HOSTS: local addresses plus the panel domain and its
            # subdomains so Django accepts requests behind nginx on a real domain.
            from app.services.site_domain_service import SiteDomainService
            allowed_hosts = ['localhost', '127.0.0.1']
            panel_origin = SiteDomainService.panel_origin()
            if panel_origin:
                from urllib.parse import urlparse
                panel_host = urlparse(panel_origin).hostname
                if panel_host:
                    allowed_hosts.append(panel_host)
                    # Permit subdomains of the panel domain (e.g. app.serverkit.example.com)
                    if '.' in panel_host:
                        allowed_hosts.append('.' + panel_host)
            allowed_hosts_str = ','.join(allowed_hosts)

            # Create .env file
            env_content = f'''DEBUG=False
SECRET_KEY={secrets.token_hex(32)}
ALLOWED_HOSTS={allowed_hosts_str}
'''
            with open(os.path.join(app_path, '.env'), 'w') as f:
                f.write(env_content)

            # Create wsgi.py wrapper
            wsgi_content = f'''import os
from dotenv import load_dotenv

load_dotenv()

os.environ.setdefault('DJANGO_SETTINGS_MODULE', '{project_name}.settings')

from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
'''
            with open(os.path.join(app_path, 'wsgi.py'), 'w') as f:
                f.write(wsgi_content)

            # Run migrations
            run_checked([python_path, 'manage.py', 'migrate'], cwd=app_path, timeout=None)

            # Collect static files directory
            os.makedirs(os.path.join(app_path, 'staticfiles'), exist_ok=True)

            # Create requirements.txt
            PythonService.freeze_requirements(app_path)

            return {
                'success': True,
                'app_path': app_path,
                'project_name': project_name,
                'message': 'Django service created'
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def create_gunicorn_service(app_name, app_path, port=8000, workers=2, user='www-data'):
        """Create a systemd service for Gunicorn."""
        service_name = f'gunicorn-{app_name}'
        service_file = f'/etc/systemd/system/{service_name}.service'
        venv_path = os.path.join(app_path, 'venv')

        # Read environment variables from .env
        env_vars = ''
        env_file = os.path.join(app_path, '.env')
        if os.path.exists(env_file):
            with open(env_file, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        env_vars += f'Environment="{line}"\n'

        gunicorn_args = f'--workers {workers} --bind 127.0.0.1:{port} wsgi:application'

        service_content = PythonService.GUNICORN_SERVICE_TEMPLATE.format(
            app_name=app_name,
            user=user,
            group=user,
            working_dir=app_path,
            venv_path=venv_path,
            env_vars=env_vars,
            gunicorn_args=gunicorn_args
        )

        try:
            with open(service_file, 'w') as f:
                f.write(service_content)

            # Reload systemd
            ServiceControl.daemon_reload()

            return {
                'success': True,
                'service_name': service_name,
                'service_file': service_file
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def start_app(app_name):
        """Start the Gunicorn service for an app."""
        service_name = f'gunicorn-{app_name}'
        try:
            result = ServiceControl.start(service_name)
            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            # Enable on boot
            ServiceControl.enable(service_name)

            return {'success': True, 'message': f'{app_name} started'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def stop_app(app_name):
        """Stop the Gunicorn service for an app."""
        service_name = f'gunicorn-{app_name}'
        try:
            result = ServiceControl.stop(service_name)
            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}
            return {'success': True, 'message': f'{app_name} stopped'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def restart_app(app_name):
        """Restart the Gunicorn service for an app."""
        service_name = f'gunicorn-{app_name}'
        try:
            result = ServiceControl.restart(service_name)
            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}
            return {'success': True, 'message': f'{app_name} restarted'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def get_app_status(app_name):
        """Get the status of a Gunicorn service."""
        service_name = f'gunicorn-{app_name}'
        try:
            status = 'active' if ServiceControl.is_active(service_name) else 'inactive'

            # Get more details
            details_result = run_checked(
                ['systemctl', 'show', service_name,
                 '--property=ActiveState,SubState,MainPID,MemoryCurrent'],
                timeout=None)

            details = {}
            for line in details_result['output'].strip().split('\n'):
                if '=' in line:
                    key, value = line.split('=', 1)
                    details[key] = value

            return {
                'service_name': service_name,
                'status': status,
                'active_state': details.get('ActiveState', 'unknown'),
                'sub_state': details.get('SubState', 'unknown'),
                'main_pid': details.get('MainPID', '0'),
                'memory': details.get('MemoryCurrent', '0')
            }
        except Exception as e:
            return {
                'service_name': service_name,
                'status': 'error',
                'error': str(e)
            }

    @staticmethod
    def get_env_vars(app_path):
        """Get environment variables from .env file."""
        env_file = os.path.join(app_path, '.env')
        env_vars = {}

        if os.path.exists(env_file):
            with open(env_file, 'r') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        env_vars[key] = value

        return env_vars

    @staticmethod
    def set_env_vars(app_path, env_vars):
        """Set environment variables in .env file."""
        env_file = os.path.join(app_path, '.env')

        try:
            # Read existing vars
            existing_vars = PythonService.get_env_vars(app_path)

            # Update with new vars
            existing_vars.update(env_vars)

            # Write back
            with open(env_file, 'w') as f:
                for key, value in existing_vars.items():
                    f.write(f'{key}={value}\n')

            return {'success': True, 'env_vars': existing_vars}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def delete_env_var(app_path, key):
        """Delete an environment variable from .env file."""
        try:
            env_vars = PythonService.get_env_vars(app_path)
            if key in env_vars:
                del env_vars[key]

            env_file = os.path.join(app_path, '.env')
            with open(env_file, 'w') as f:
                for k, v in env_vars.items():
                    f.write(f'{k}={v}\n')

            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def run_command(app_path, command):
        """Run a command in the virtual environment context."""
        venv_path = os.path.join(app_path, 'venv')
        python_path = os.path.join(venv_path, 'bin', 'python')

        if not os.path.exists(python_path):
            return {'success': False, 'error': 'Virtual environment not found'}

        try:
            # Prepare environment
            env = os.environ.copy()
            env['PATH'] = f"{os.path.join(venv_path, 'bin')}:{env.get('PATH', '')}"
            env['VIRTUAL_ENV'] = venv_path

            # Load .env vars
            env_vars = PythonService.get_env_vars(app_path)
            env.update(env_vars)

            result = run_checked(['bash', '-c', command], cwd=app_path, env=env,
                                 timeout=300)

            if result['returncode'] is None:
                # Never ran (no bash, or it outlived the 300s bound) — do not
                # hand back a return_code the command never produced.
                return {'success': False, 'error': result['error']}

            return {
                'success': result['success'],
                'stdout': result['output'],
                'stderr': result['stderr'],
                'return_code': result['returncode'],
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def run_migrations(app_path, app_type='django'):
        """Run database migrations."""
        if app_type == 'django':
            return PythonService.run_command(app_path, 'python manage.py migrate')
        elif app_type == 'flask':
            # Flask-Migrate
            return PythonService.run_command(app_path, 'flask db upgrade')
        return {'success': False, 'error': 'Unknown service type'}

    @staticmethod
    def collect_static(app_path, app_type='django'):
        """Collect static files for Django."""
        if app_type == 'django':
            return PythonService.run_command(
                app_path,
                'python manage.py collectstatic --noinput'
            )
        return {'success': False, 'error': 'Only supported for Django'}

    @staticmethod
    def get_gunicorn_config(app_path):
        """Get or create Gunicorn configuration."""
        config_file = os.path.join(app_path, 'gunicorn.conf.py')

        if os.path.exists(config_file):
            with open(config_file, 'r') as f:
                return {'exists': True, 'content': f.read()}

        # Default config
        default_config = '''# Gunicorn configuration file
import multiprocessing

# Worker settings
workers = multiprocessing.cpu_count() * 2 + 1
worker_class = 'sync'
worker_connections = 1000
timeout = 30
keepalive = 2

# Server socket
bind = '127.0.0.1:8000'
backlog = 2048

# Logging
accesslog = '-'
errorlog = '-'
loglevel = 'info'

# Process naming
proc_name = 'gunicorn'

# Server mechanics
daemon = False
pidfile = None
umask = 0
user = None
group = None
tmp_upload_dir = None
'''
        return {'exists': False, 'content': default_config}

    @staticmethod
    def save_gunicorn_config(app_path, config_content):
        """Save Gunicorn configuration."""
        config_file = os.path.join(app_path, 'gunicorn.conf.py')

        try:
            with open(config_file, 'w') as f:
                f.write(config_content)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def delete_app(app_name, app_path, remove_files=False):
        """Delete a Python application and its service."""
        service_name = f'gunicorn-{app_name}'

        try:
            # Stop and disable service
            ServiceControl.stop(service_name)
            ServiceControl.disable(service_name)

            # Remove service file
            service_file = f'/etc/systemd/system/{service_name}.service'
            if os.path.exists(service_file):
                os.remove(service_file)

            ServiceControl.daemon_reload()

            # Remove files if requested
            if remove_files and os.path.exists(app_path):
                shutil.rmtree(app_path)

            return {'success': True, 'message': f'{app_name} deleted'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
