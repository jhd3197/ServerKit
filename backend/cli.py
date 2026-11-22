#!/usr/bin/env python3
"""ServerKit CLI - Administrative commands for ServerKit."""

import os
import click
import json
import secrets
import sys
import contextlib
from pathlib import Path

# Load .env file before importing app
# Check multiple locations for the .env file
def load_env():
    """Load environment variables from .env file."""
    try:
        from dotenv import load_dotenv

        # Try multiple locations
        env_locations = [
            Path(__file__).parent / '.env',                    # Same directory as cli.py
            Path(__file__).parent.parent / '.env',             # Parent directory
            Path('/opt/serverkit/.env'),                       # Production location
            Path('/opt/serverkit/backend/.env'),               # Alternative production
        ]

        for env_path in env_locations:
            if env_path.exists():
                load_dotenv(env_path)
                return str(env_path)

        # Also check if DATABASE_URL is already set
        if os.environ.get('DATABASE_URL'):
            return 'environment'

        return None
    except ImportError:
        # python-dotenv not installed
        return None

# Load env before any other imports that might use config
_env_loaded = load_env()

# A CLI command is a one-shot beside the running panel: it must not start a
# second job consumer, scheduler and relay (the boot reconcile would mark the
# panel's in-flight deploys failed). Queued work is run by the panel itself.
os.environ.setdefault('SERVERKIT_SKIP_BACKGROUND', '1')

from werkzeug.security import generate_password_hash
from app import create_app, db
from app.models import User


@click.group()
@click.option('--debug', is_flag=True, help='Show debug information')
@click.pass_context
def cli(ctx, debug):
    """ServerKit administrative CLI."""
    ctx.ensure_object(dict)
    ctx.obj['debug'] = debug
    if debug and _env_loaded:
        click.echo(f"Loaded environment from: {_env_loaded}")


def _echo_json(payload):
    """Machine-readable output for the --json flags (stdout only)."""
    click.echo(json.dumps(payload, indent=2, default=str))


@cli.command()
@click.option('--email', prompt=True, help='Admin email address')
@click.option('--username', prompt=True, help='Admin username')
@click.option('--password', prompt=True, hide_input=True, confirmation_prompt=True, help='Admin password')
def create_admin(email, username, password):
    """Create a new admin user."""
    app = create_app()
    with app.app_context():
        # Check if user already exists
        if User.query.filter((User.email == email) | (User.username == username)).first():
            click.echo(click.style('Error: User with this email or username already exists.', fg='red'))
            sys.exit(1)

        user = User(
            email=email,
            username=username,
            role='admin',
            is_active=True
        )
        user.set_password(password)
        db.session.add(user)
        db.session.commit()

        # Mark setup as complete so the UI doesn't show the setup wizard
        from app.services.settings_service import SettingsService
        from app.services import setup_code_service
        SettingsService.complete_setup(user_id=user.id)
        setup_code_service.consume()

        click.echo(click.style(f'Admin user "{username}" created successfully!', fg='green'))


@cli.command()
def setup_code():
    """Show the one-time code that creating the first admin requires."""
    app = create_app()
    with app.app_context():
        from app.services import setup_code_service
        code = setup_code_service.ensure()
        if not code:
            click.echo('This panel already has an account; no setup code is needed.')
            return
        click.echo(code)


@cli.command()
@click.option('--email', prompt=True, help='User email address')
@click.option('--password', prompt=True, hide_input=True, confirmation_prompt=True, help='New password')
def reset_password(email, password):
    """Reset a user's password."""
    app = create_app()
    with app.app_context():
        user = User.query.filter_by(email=email).first()
        if not user:
            click.echo(click.style(f'Error: User with email "{email}" not found.', fg='red'))
            sys.exit(1)

        user.set_password(password)
        user.failed_login_count = 0
        user.locked_until = None
        db.session.commit()

        click.echo(click.style(f'Password reset successfully for "{user.username}"!', fg='green'))


@cli.command()
@click.option('--email', prompt=True, help='User email address')
def unlock_user(email):
    """Unlock a locked user account."""
    app = create_app()
    with app.app_context():
        user = User.query.filter_by(email=email).first()
        if not user:
            click.echo(click.style(f'Error: User with email "{email}" not found.', fg='red'))
            sys.exit(1)

        user.failed_login_count = 0
        user.locked_until = None
        db.session.commit()

        click.echo(click.style(f'User "{user.username}" unlocked successfully!', fg='green'))


@cli.command()
@click.option('--email', prompt=True, help='User email address')
def make_admin(email):
    """Promote a user to admin role."""
    app = create_app()
    with app.app_context():
        user = User.query.filter_by(email=email).first()
        if not user:
            click.echo(click.style(f'Error: User with email "{email}" not found.', fg='red'))
            sys.exit(1)

        user.role = 'admin'
        db.session.commit()

        click.echo(click.style(f'User "{user.username}" is now an admin!', fg='green'))


@cli.command()
@click.option('--email', prompt=True, help='User email address')
def deactivate_user(email):
    """Deactivate a user account."""
    app = create_app()
    with app.app_context():
        user = User.query.filter_by(email=email).first()
        if not user:
            click.echo(click.style(f'Error: User with email "{email}" not found.', fg='red'))
            sys.exit(1)

        user.is_active = False
        db.session.commit()

        click.echo(click.style(f'User "{user.username}" has been deactivated.', fg='yellow'))


@cli.command()
@click.option('--email', prompt=True, help='User email address')
def activate_user(email):
    """Activate a user account."""
    app = create_app()
    with app.app_context():
        user = User.query.filter_by(email=email).first()
        if not user:
            click.echo(click.style(f'Error: User with email "{email}" not found.', fg='red'))
            sys.exit(1)

        user.is_active = True
        db.session.commit()

        click.echo(click.style(f'User "{user.username}" has been activated.', fg='green'))


@cli.command()
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def list_users(as_json):
    """List all users."""
    app = create_app()
    with app.app_context():
        users = User.query.all()

        if as_json:
            _echo_json({'users': [
                {
                    'id': user.id,
                    'username': user.username,
                    'email': user.email,
                    'role': user.role,
                    'is_active': user.is_active,
                    'is_locked': user.is_locked,
                }
                for user in users
            ]})
            return

        if not users:
            click.echo('No users found.')
            return

        click.echo(f"\n{'ID':<5} {'Username':<20} {'Email':<30} {'Role':<10} {'Active':<8} {'Locked':<8}")
        click.echo('-' * 85)

        for user in users:
            locked = 'Yes' if user.is_locked else 'No'
            active = 'Yes' if user.is_active else 'No'
            click.echo(f"{user.id:<5} {user.username:<20} {user.email:<30} {user.role:<10} {active:<8} {locked:<8}")

        click.echo(f"\nTotal: {len(users)} user(s)")


@cli.command()
def generate_keys():
    """Generate secure SECRET_KEY and JWT_SECRET_KEY."""
    secret_key = secrets.token_hex(32)
    jwt_secret_key = secrets.token_hex(32)

    click.echo("\nAdd these to your .env file:\n")
    click.echo(f"SECRET_KEY={secret_key}")
    click.echo(f"JWT_SECRET_KEY={jwt_secret_key}")
    click.echo()


@cli.command()
def init_db():
    """Initialize the database using Alembic migrations."""
    app = create_app()
    with app.app_context():
        from app.services.migration_service import MigrationService
        result = MigrationService.apply_migrations(app)
        if result['success']:
            click.echo(click.style(f'Database initialized successfully (revision: {result["revision"]})!', fg='green'))
        else:
            click.echo(click.style(f'Database initialization failed: {result["error"]}', fg='red'))
            sys.exit(1)


@cli.command()
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def db_status(as_json):
    """Show current database migration status."""
    app = create_app()
    with app.app_context():
        from app.services.migration_service import MigrationService
        status = MigrationService.get_status()

        if as_json:
            _echo_json(status)
            return

        click.echo(f"\nCurrent revision: {status['current_revision'] or 'none'}")
        click.echo(f"Head revision:    {status['head_revision'] or 'none'}")
        click.echo(f"Pending:          {status['pending_count']}")

        if status['pending_migrations']:
            click.echo(f"\nPending migrations:")
            for m in status['pending_migrations']:
                click.echo(f"  - {m['revision']}: {m['description']}")
        else:
            click.echo(click.style('\nDatabase is up to date.', fg='green'))
        click.echo()


@cli.command()
@click.option('--no-backup', is_flag=True, help='Skip creating a backup before migrating')
def db_migrate(no_backup):
    """Apply pending database migrations."""
    app = create_app()
    with app.app_context():
        from app.services.migration_service import MigrationService
        status = MigrationService.get_status()

        if not status['needs_migration']:
            click.echo(click.style('Database is up to date. No migrations needed.', fg='green'))
            return

        click.echo(f'Found {status["pending_count"]} pending migration(s):')
        for m in status['pending_migrations']:
            click.echo(f'  - {m["revision"]}: {m["description"]}')

        if not no_backup:
            click.echo('\nCreating backup...')
            backup = MigrationService.create_backup(app)
            if backup['success']:
                click.echo(click.style(f'  Backup saved to: {backup["path"]}', fg='green'))
            else:
                click.echo(click.style(f'  Backup failed: {backup["error"]}', fg='red'))
                if not click.confirm('Continue without backup?'):
                    return

        click.echo('\nApplying migrations...')
        result = MigrationService.apply_migrations(app)
        if result['success']:
            click.echo(click.style(f'\nMigrations applied! Now at revision: {result["revision"]}', fg='green'))
        else:
            click.echo(click.style(f'\nMigration failed: {result["error"]}', fg='red'))
            sys.exit(1)


@cli.command()
def db_history():
    """Show all database migration revisions."""
    app = create_app()
    with app.app_context():
        from app.services.migration_service import MigrationService
        history = MigrationService.get_migration_history(app)

        if not history:
            click.echo('No migration history found.')
            return

        click.echo(f"\n{'Revision':<20} {'Description':<50} {'Status'}")
        click.echo('-' * 80)

        for rev in history:
            status_parts = []
            if rev['is_current']:
                status_parts.append('CURRENT')
            if rev['is_head']:
                status_parts.append('HEAD')
            status = ', '.join(status_parts) if status_parts else ''

            desc = rev['description'][:48] if rev['description'] else ''
            click.echo(f"{rev['revision']:<20} {desc:<50} {status}")

        click.echo()


@cli.command()
@click.confirmation_option(prompt='Are you sure you want to drop all tables?')
def drop_db():
    """Drop all database tables."""
    app = create_app()
    with app.app_context():
        db.drop_all()
        click.echo(click.style('All tables dropped!', fg='yellow'))


@cli.command()
@click.option('--delete-volumes', is_flag=True, help='Also delete Docker volumes')
@click.option('--keep-db', is_flag=True, help='Keep database records')
@click.confirmation_option(prompt='Are you sure you want to delete ALL applications and their data?')
def cleanup_apps(delete_volumes, keep_db):
    """Delete all applications, containers, and app folders.

    This removes:
    - All Docker containers and networks for apps
    - All app folders in /var/serverkit/apps/
    - Orphaned Docker containers (excludes serverkit-* infrastructure)
    - Optionally Docker volumes (--delete-volumes)
    - Database records (unless --keep-db)
    """
    import shutil
    import subprocess
    from app.models import Application

    # Infrastructure containers to never touch
    PROTECTED_CONTAINERS = ['serverkit-frontend', 'serverkit-backend', 'serverkit']

    app = create_app()
    with app.app_context():
        # Live apps only. `docker compose down -v` on a soft-deleted app would
        # destroy the data volumes the delete deliberately KEPT for restore,
        # leaving a restorable row with nothing behind it. Recycle-bin entries
        # are removed by purging them, not here.
        apps = Application.query_active().all()

        click.echo(f'Found {len(apps)} application(s) in database...\n')

        # 1. Clean up tracked applications
        for application in apps:
            click.echo(f'Cleaning up: {application.name}')

            # Stop and remove Docker containers
            if application.root_path and os.path.exists(application.root_path):
                try:
                    cmd = ['docker', 'compose', 'down']
                    if delete_volumes:
                        cmd.append('-v')
                    cmd.extend(['--remove-orphans'])

                    subprocess.run(
                        cmd,
                        cwd=application.root_path,
                        capture_output=True,
                        timeout=60
                    )
                    click.echo(click.style(f'  ✓ Stopped containers', fg='green'))
                except Exception as e:
                    click.echo(click.style(f'  ✗ Failed to stop containers: {e}', fg='red'))

                # Delete app folder
                try:
                    shutil.rmtree(application.root_path)
                    click.echo(click.style(f'  ✓ Deleted folder: {application.root_path}', fg='green'))
                except Exception as e:
                    click.echo(click.style(f'  ✗ Failed to delete folder: {e}', fg='red'))

            # Delete database record
            if not keep_db:
                try:
                    db.session.delete(application)
                    click.echo(click.style(f'  ✓ Removed from database', fg='green'))
                except Exception as e:
                    click.echo(click.style(f'  ✗ Failed to remove from database: {e}', fg='red'))

        if not keep_db:
            db.session.commit()

        # 2. Clean up orphaned containers (not in database, not infrastructure)
        click.echo('\nCleaning up orphaned Docker containers...')
        try:
            result = subprocess.run(
                ['docker', 'ps', '-a', '--format', '{{.Names}}'],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode == 0:
                containers = result.stdout.strip().split('\n')
                orphaned = 0
                for container in containers:
                    if not container:
                        continue
                    # Skip protected infrastructure containers
                    if any(container.startswith(p) for p in PROTECTED_CONTAINERS):
                        continue
                    # Skip if it's a serverkit network container
                    if container == 'serverkit-frontend' or container == 'serverkit-backend':
                        continue

                    # Stop and remove orphaned container
                    try:
                        subprocess.run(['docker', 'stop', container], capture_output=True, timeout=30)
                        subprocess.run(['docker', 'rm', container], capture_output=True, timeout=30)
                        click.echo(click.style(f'  ✓ Removed orphaned container: {container}', fg='yellow'))
                        orphaned += 1
                    except Exception:
                        pass

                if orphaned == 0:
                    click.echo('  No orphaned containers found.')
                else:
                    click.echo(f'  Removed {orphaned} orphaned container(s).')
        except Exception as e:
            click.echo(click.style(f'  ✗ Failed to clean orphaned containers: {e}', fg='red'))

        # 3. Clean up orphaned Docker networks (except serverkit-network)
        click.echo('\nCleaning up orphaned Docker networks...')
        try:
            subprocess.run(
                ['docker', 'network', 'prune', '-f'],
                capture_output=True,
                timeout=30
            )
            click.echo(click.style('  ✓ Pruned unused networks', fg='green'))
        except Exception as e:
            click.echo(click.style(f'  ✗ Failed to prune networks: {e}', fg='red'))

        # 4. Optionally clean up volumes
        if delete_volumes:
            click.echo('\nCleaning up orphaned Docker volumes...')
            try:
                subprocess.run(
                    ['docker', 'volume', 'prune', '-f'],
                    capture_output=True,
                    timeout=30
                )
                click.echo(click.style('  ✓ Pruned unused volumes', fg='green'))
            except Exception as e:
                click.echo(click.style(f'  ✗ Failed to prune volumes: {e}', fg='red'))

        # 5. Clean up any remaining folders in /var/serverkit/apps/
        apps_dir = '/var/serverkit/apps'
        if os.path.exists(apps_dir):
            click.echo(f'\nCleaning up app folders in {apps_dir}...')
            for folder in os.listdir(apps_dir):
                folder_path = os.path.join(apps_dir, folder)
                if os.path.isdir(folder_path):
                    try:
                        shutil.rmtree(folder_path)
                        click.echo(click.style(f'  ✓ Deleted: {folder}', fg='yellow'))
                    except Exception as e:
                        click.echo(click.style(f'  ✗ Failed to delete {folder}: {e}', fg='red'))

        click.echo(click.style('\nCleanup completed!', fg='green'))


@cli.command()
@click.confirmation_option(prompt='This will delete ALL data and reset ServerKit. Continue?')
def factory_reset():
    """Complete factory reset - delete everything and start fresh.

    This removes:
    - All applications and Docker containers
    - All app folders
    - All orphaned Docker containers (preserves serverkit infrastructure)
    - All Docker volumes and networks (except serverkit-network)
    - All database tables
    - Template installation cache
    """
    import shutil
    import subprocess
    from app.models import Application

    # Infrastructure to never touch
    PROTECTED_CONTAINERS = ['serverkit-frontend', 'serverkit-backend', 'serverkit']
    PROTECTED_NETWORKS = ['serverkit-network', 'serverkit_default']

    app = create_app()
    with app.app_context():
        click.echo('Starting factory reset...\n')

        # 1. Clean up all applications from database
        # Only live apps have a stack to bring down; a soft-deleted app's
        # containers are already stopped, and steps 2-4 + drop_all() below sweep
        # up whatever it left behind anyway.
        apps = Application.query_active().all()
        click.echo(f'Stopping {len(apps)} tracked application(s)...')
        for application in apps:
            if application.root_path and os.path.exists(application.root_path):
                try:
                    subprocess.run(
                        ['docker', 'compose', 'down', '-v', '--remove-orphans'],
                        cwd=application.root_path,
                        capture_output=True,
                        timeout=60
                    )
                except Exception:
                    pass

        # 2. Stop and remove ALL non-infrastructure containers
        click.echo('Removing all app containers...')
        try:
            result = subprocess.run(
                ['docker', 'ps', '-a', '--format', '{{.Names}}'],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode == 0:
                containers = [c for c in result.stdout.strip().split('\n') if c]
                for container in containers:
                    # Skip protected infrastructure
                    if any(container.startswith(p) for p in PROTECTED_CONTAINERS):
                        continue
                    try:
                        subprocess.run(['docker', 'stop', container], capture_output=True, timeout=30)
                        subprocess.run(['docker', 'rm', '-f', container], capture_output=True, timeout=30)
                    except Exception:
                        pass
            click.echo(click.style('✓ Removed all app containers', fg='green'))
        except Exception as e:
            click.echo(click.style(f'✗ Failed to remove containers: {e}', fg='red'))

        # 3. Delete entire apps directory
        apps_dir = '/var/serverkit/apps'
        if os.path.exists(apps_dir):
            try:
                shutil.rmtree(apps_dir)
                os.makedirs(apps_dir, exist_ok=True)
                click.echo(click.style('✓ Deleted all app folders', fg='green'))
            except Exception as e:
                click.echo(click.style(f'✗ Failed to delete apps folder: {e}', fg='red'))

        # 4. Prune Docker volumes (except protected)
        click.echo('Pruning Docker volumes...')
        try:
            subprocess.run(['docker', 'volume', 'prune', '-f'], capture_output=True, timeout=60)
            click.echo(click.style('✓ Pruned unused volumes', fg='green'))
        except Exception as e:
            click.echo(click.style(f'✗ Failed to prune volumes: {e}', fg='red'))

        # 5. Prune Docker networks (except protected)
        click.echo('Pruning Docker networks...')
        try:
            subprocess.run(['docker', 'network', 'prune', '-f'], capture_output=True, timeout=30)
            click.echo(click.style('✓ Pruned unused networks', fg='green'))
        except Exception as e:
            click.echo(click.style(f'✗ Failed to prune networks: {e}', fg='red'))

        # 6. Clear template installation cache
        template_config = '/etc/serverkit/templates.json'
        if os.path.exists(template_config):
            try:
                import json
                with open(template_config, 'r') as f:
                    config = json.load(f)
                config['installed'] = {}
                with open(template_config, 'w') as f:
                    json.dump(config, f, indent=2)
                click.echo(click.style('✓ Cleared template cache', fg='green'))
            except Exception as e:
                click.echo(click.style(f'✗ Failed to clear template cache: {e}', fg='red'))

        # 7. Drop and recreate database via Alembic
        try:
            db.drop_all()
            from app.services.migration_service import MigrationService
            result = MigrationService.apply_migrations(app)
            if result['success']:
                click.echo(click.style('✓ Reset database', fg='green'))
            else:
                click.echo(click.style(f'✗ Migration after reset failed: {result["error"]}', fg='red'))
        except Exception as e:
            click.echo(click.style(f'✗ Failed to reset database: {e}', fg='red'))

        click.echo(click.style('\nFactory reset completed!', fg='green'))
        click.echo('Run "serverkit create-admin" to create a new admin user.')


@cli.command()
@click.option('--all', 'show_all', is_flag=True, help='Also show Docker container status')
@click.option('--json', 'as_json', is_flag=True,
              help='Output machine-readable JSON (not combinable with --all)')
def list_apps(show_all, as_json):
    """List all user applications (excludes ServerKit infrastructure)."""
    import subprocess
    from app.models import Application

    if as_json and show_all:
        _fail('--json cannot be combined with --all (the Docker section is table-only).')

    app = create_app()
    with app.app_context():
        apps = Application.query_active().all()

        if as_json:
            _echo_json({'apps': [
                {
                    'id': application.id,
                    'name': application.name,
                    'app_type': application.app_type,
                    'status': application.status,
                    'port': application.port,
                    'root_path': application.root_path,
                }
                for application in apps
            ]})
            return

        click.echo('\n' + '=' * 90)
        click.echo('  USER APPLICATIONS')
        click.echo('=' * 90)

        if not apps:
            click.echo('\n  No applications found in database.')
            click.echo('  Install apps from the Templates page in the web UI.\n')
        else:
            click.echo(f"\n{'ID':<5} {'Name':<25} {'Type':<10} {'Status':<10} {'Port':<8} {'Path'}")
            click.echo('-' * 90)

            for application in apps:
                click.echo(
                    f"{application.id:<5} "
                    f"{application.name:<25} "
                    f"{application.app_type:<10} "
                    f"{application.status:<10} "
                    f"{str(application.port or '-'):<8} "
                    f"{application.root_path or '-'}"
                )

            click.echo(f"\nTotal: {len(apps)} application(s)")

        if show_all:
            click.echo('\n' + '=' * 90)
            click.echo('  DOCKER CONTAINERS')
            click.echo('=' * 90 + '\n')

            try:
                result = subprocess.run(
                    ['docker', 'ps', '-a', '--format', 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'],
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                if result.returncode == 0:
                    # Filter out header and show
                    lines = result.stdout.strip().split('\n')
                    for line in lines:
                        # Mark serverkit infrastructure
                        if 'serverkit-frontend' in line or 'serverkit-backend' in line:
                            click.echo(click.style(f'{line}  [INFRASTRUCTURE]', fg='blue'))
                        else:
                            click.echo(line)
                else:
                    click.echo('  Failed to list Docker containers')
            except Exception as e:
                click.echo(f'  Error: {e}')

        click.echo('')


@cli.command('list-servers')
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def list_servers(as_json):
    """List deployment targets."""
    app = create_app()
    with app.app_context():
        from app.services.remote_docker_service import RemoteDockerService

        servers = RemoteDockerService.get_available_servers()
        if as_json:
            _echo_json({'servers': servers})
            return
        click.echo(f"\n{'ID':<38} {'Name':<28} {'Status':<12} {'Target'}")
        click.echo('-' * 90)
        for server in servers:
            target = 'local' if server.get('is_local') else server.get('group_name') or 'remote'
            click.echo(
                f"{server.get('id'):<38} "
                f"{server.get('name'):<28} "
                f"{server.get('status', '-'):<12} "
                f"{target}"
            )
        click.echo('')


@cli.command('deploy-template')
@click.argument('template_id')
@click.option('--name', 'app_name', required=True, help='Application name')
@click.option('--target', 'server_id', default='local', help='Target server ID or "local"')
@click.option('--var', 'variables', multiple=True, help='Template variable in KEY=VALUE form')
@click.option('--wait', is_flag=True, help='Wait for deployment to finish')
def deploy_template(template_id, app_name, server_id, variables, wait):
    """Deploy a template to local or remote ServerKit target."""
    app = create_app()
    with app.app_context():
        from app.services.deployment_job_service import DeploymentJobService

        parsed_vars = {}
        for item in variables:
            if '=' not in item:
                click.echo(click.style(f'Invalid --var value: {item}. Use KEY=VALUE.', fg='red'))
                sys.exit(1)
            key, value = item.split('=', 1)
            parsed_vars[key] = value

        result = DeploymentJobService.install_template(
            template_id=template_id,
            app_name=app_name,
            user_variables=parsed_vars,
            server_id=server_id,
            wait=wait,
        )

        if not result.get('success'):
            click.echo(click.style(result.get('error', 'Deployment failed'), fg='red'))
            sys.exit(1)

        job = result.get('job', {})
        click.echo(click.style(f'Deployment job created: {job.get("id")}', fg='green'))
        click.echo(f'Status: {job.get("status")}')
        click.echo(f'Target: {job.get("target_server_name")}')

        if wait:
            if job.get('status') == 'succeeded':
                click.echo(click.style(f'App created: {job.get("result", {}).get("app_name")}', fg='green'))
            else:
                click.echo(click.style(job.get('error_message') or 'Deployment did not complete successfully', fg='red'))
                sys.exit(1)
        else:
            click.echo(f'Check status: serverkit deployment-status {job.get("id")}')


@cli.command('deployment-status')
@click.argument('job_id')
@click.option('--logs', is_flag=True, help='Show job logs')
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def deployment_status(job_id, logs, as_json):
    """Show deployment job status."""
    app = create_app()
    with app.app_context():
        from app.services.deployment_job_service import DeploymentJobService

        job = DeploymentJobService.get_job(job_id, include_logs=logs)
        if not job:
            click.echo(click.style('Deployment job not found', fg='red'))
            sys.exit(1)

        if as_json:
            _echo_json({'job': job})
            return

        click.echo(f"\nJob:    {job['id']}")
        click.echo(f"Kind:   {job['kind']}")
        click.echo(f"Status: {job['status']} ({job['progress_percent']}%)")
        click.echo(f"Target: {job['target_server_name']}")
        if job.get('app_name'):
            click.echo(f"App:    {job['app_name']}")
        if job.get('error_message'):
            click.echo(click.style(f"Error:  {job['error_message']}", fg='red'))

        if logs:
            click.echo('\nLogs')
            click.echo('-' * 80)
            for entry in job.get('logs', []):
                prefix = f"[{entry['step_index']}] " if entry.get('step_index') else ''
                click.echo(f"{entry['created_at']} {entry['level'].upper():<5} {prefix}{entry['message']}")
        click.echo('')


# ─────────────────────────────────────────────────────────────────────────────
# API-backed commands: talk to the running panel over the local HTTP API using
# a short-lived break-glass admin token (root/shell on the box already implies
# full control; every mint is audit-logged as 'cli.breakglass').
# ─────────────────────────────────────────────────────────────────────────────

STATUS_SYMBOLS = {
    'ok': ('✓', 'green'),
    'pass': ('✓', 'green'),
    'healthy': ('✓', 'green'),
    'warn': ('!', 'yellow'),
    'warning': ('!', 'yellow'),
}


def _api_client(with_token=True):
    """Build an ApiClient for the local panel, minting a break-glass token."""
    from app.services.cli_api_client import ApiClient, mint_breakglass_token

    token = None
    if with_token:
        token, _user = mint_breakglass_token()
    return ApiClient(token=token)


@cli.command('adopt-site')
@click.argument('site', required=False)
@click.option('--apply', 'apply_', is_flag=True,
              help='Register the site. Without it, only show what would be recorded.')
@click.option('--name', default=None, help='Service name (default: derived from the domain)')
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def adopt_site(site, apply_, name, as_json):
    """Register a site that already runs on this server.

    With no SITE, lists every site host nginx serves and whether ServerKit
    manages it. With a SITE (a domain or a vhost file name), shows what
    adopting it would record: a dry run. Add --apply to register it.

    Nothing on the server is rewritten either way: adopting records the
    running nginx vhost, PHP-FPM pool, database and certificate as they are.
    """
    from app.services import site_adoption_service
    from app.services.site_adoption_service import SiteAdoptionError

    app = create_app()
    with app.app_context():
        if not site:
            if apply_:
                _fail('--apply needs a site: serverkit adopt-site <domain> --apply')
            sites = site_adoption_service.discover()
            if as_json:
                _echo_json({'sites': sites})
                return
            if not sites:
                click.echo('\n  Host nginx is not serving any sites.\n')
                return
            click.echo(f"\n{'Domain':<34} {'Type':<10} {'PHP':<6} {'SSL':<4} {'State'}")
            click.echo('-' * 90)
            for found in sites:
                if found['linked_app']:
                    state = f"managed as {found['linked_app']['name']}"
                elif found['adoptable']:
                    state = 'not managed (adoptable)'
                else:
                    state = f"not managed: {found['reason']}"
                click.echo(
                    f"{found['primary_domain']:<34} "
                    f"{(found['app_type'] or found['kind']):<10} "
                    f"{((found['php'] or {}).get('version') or '-'):<6} "
                    f"{('yes' if found['ssl']['enabled'] else 'no'):<4} "
                    f"{state}"
                )
            adoptable = sum(1 for found in sites if found['adoptable'])
            click.echo(f"\n{adoptable} site(s) can be adopted: serverkit adopt-site <domain>\n")
            return

        found = site_adoption_service.find(site)
        if found is None:
            _fail(f'No site served by host nginx matches "{site}". '
                  "Run 'serverkit adopt-site' to list them.")
        plan = site_adoption_service.plan(found, name)

        if not apply_:
            if as_json:
                _echo_json({'dry_run': True, 'adoptable': found['adoptable'],
                            'reason': found['reason'], 'plan': plan})
                return
            _print_adoption_plan(found, plan)
            if found['adoptable']:
                click.echo(f"\nDry run. Nothing was changed. To register it:\n"
                           f"  serverkit adopt-site {site} --apply\n")
            else:
                click.echo(click.style(f"\nCannot adopt: {found['reason']}\n", fg='yellow'))
            return

        owner = User.query.filter_by(role='admin', is_active=True).order_by(User.id).first()
        if owner is None:
            _fail("No active admin user to own the service. Run 'serverkit create-admin' first.")
        try:
            application, plan = site_adoption_service.adopt(site, owner, name=name)
        except SiteAdoptionError as exc:
            _fail(str(exc))
        if as_json:
            _echo_json({'dry_run': False, 'plan': plan, 'app': application.to_dict()})
            return
        _print_adoption_plan(found, plan)
        click.echo(click.style(
            f"\nAdopted as \"{application.name}\" (id {application.id}). "
            'No file on the server was changed.\n', fg='green'))


def _print_adoption_plan(site, plan):
    php = site['php'] or {}
    click.echo(f"\nSite: {site['primary_domain']}")
    click.echo(f"  vhost        {site['vhost_file']}")
    click.echo(f"  domains      {', '.join(site['domains'])}")
    click.echo(f"  root         {site['root'] or '-'}")
    if php:
        pool = f" (pool {php['pool']})" if php.get('pool') else ''
        click.echo(f"  PHP-FPM      {php.get('version') or 'unknown version'}{pool} at {php['listen']}")
    if site['ssl']['enabled']:
        expires = site['ssl']['expires_at'] or 'expiry unknown'
        click.echo(f"  certificate  {site['ssl']['certificate']} ({expires})")
    else:
        click.echo('  certificate  none')
    if site['database']:
        click.echo(f"  database     {site['database']['name']} on {site['database']['host']}")
    click.echo('\nWould record:' if site['adoptable'] else '\nWould have recorded:')
    application = plan['application']
    click.echo(f"  service      {application['name']} ({application['app_type']}, "
               f"managed by {application['managed_by']})")
    click.echo(f"  domains      {len(plan['domains'])}")
    if plan['wordpress_site'] is not None:
        click.echo(f"  WordPress    version {plan['wordpress_site']['wp_version'] or 'unknown'}")
    if plan['database'] is not None:
        click.echo(f"  database     linked to the service")
    click.echo('\nLeft exactly as it is:')
    for path in plan['untouched']:
        click.echo(f"  {path}")


def _fail(message):
    click.echo(click.style(f'Error: {message}', fg='red'), err=True)
    sys.exit(1)


def _echo_table(headers, rows):
    """Plain fixed-width table via click.echo (no extra deps)."""
    rows = [[('' if cell is None else str(cell)) for cell in row] for row in rows]
    widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))
    fmt = '  '.join(f'{{:<{w}}}' for w in widths)
    click.echo(fmt.format(*headers))
    click.echo('-' * (sum(widths) + 2 * (len(widths) - 1)))
    for row in rows:
        click.echo(fmt.format(*row))


@cli.command()
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def status(as_json):
    """Show panel health and version."""
    from app.utils.version import get_panel_version
    from app.services.cli_api_client import CliApiError

    version = get_panel_version()
    try:
        # /system/health is unauthenticated by design.
        health = _api_client(with_token=False).get('/system/health')
    except CliApiError as exc:
        _fail(str(exc))

    if as_json:
        _echo_json({'version': version, 'health': health})
        return

    rows = [
        ('Panel version', version),
        ('API status', health.get('status', 'unknown')),
        ('Service', health.get('service', '-')),
        ('Canonical domain', health.get('canonical_domain') or '-'),
        ('HTTPS enabled', 'yes' if health.get('canonical_https_enabled') else 'no'),
        ('Encryption configured', 'yes' if health.get('encryption_configured') else 'no'),
    ]
    _echo_table(['Field', 'Value'], rows)


@cli.group()
def services():
    """Inspect and control system services via the panel API."""


@services.command('list')
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def services_list(as_json):
    """List monitored system services."""
    from app.services.cli_api_client import CliApiError

    try:
        data = _api_client().get('/processes/services')
    except CliApiError as exc:
        _fail(str(exc))

    entries = data.get('services', [])
    if as_json:
        _echo_json({'services': entries})
        return
    if not entries:
        click.echo('No services reported.')
        return
    rows = [(s.get('name', '-'), s.get('status', '-'), s.get('pid', '-')) for s in entries]
    _echo_table(['Service', 'Status', 'PID'], rows)


@services.command('restart')
@click.argument('name')
def services_restart(name):
    """Restart a system service."""
    from app.services.cli_api_client import CliApiError

    try:
        result = _api_client().post(f'/processes/services/{name}', {'action': 'restart'})
    except CliApiError as exc:
        _fail(str(exc))
    click.echo(click.style(result.get('message', f'Service "{name}" restarted.'), fg='green'))


@cli.group()
def apps():
    """Inspect applications via the panel API.

    Read-only. Application lifecycle -- start, stop, restart, logs, delete --
    lives in the web UI and the HTTP API, not here; `serverkit apps stop
    <name>` has never existed. `serverkit services` does control system
    services (nginx, docker), which is a different thing and a common source
    of the confusion.
    """


@apps.command('list')
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def apps_list(as_json):
    """List applications known to the panel."""
    from app.services.cli_api_client import CliApiError

    try:
        data = _api_client().get('/apps')
    except CliApiError as exc:
        _fail(str(exc))

    entries = data.get('apps', [])
    if as_json:
        _echo_json({'apps': entries})
        return
    if not entries:
        click.echo('No applications found.')
        return
    rows = [(a.get('name', '-'), a.get('app_type', '-'), a.get('status', '-')) for a in entries]
    _echo_table(['Name', 'Type', 'Status'], rows)


@cli.command('login-url')
@click.option('--ttl', default=15, show_default=True, help='Link lifetime in minutes')
@click.option('--ip', default=None, help='Bind the link to this client IP address')
@click.option('--user', 'user_ref', default=None, help='Username or email (default: first active admin)')
def login_url(ttl, ip, user_ref):
    """Mint a one-time login link for the panel."""
    app = create_app()
    with app.app_context():
        from app.services import login_link_service
        from app.services.cli_api_client import find_breakglass_admin, resolve_port

        if user_ref:
            user = User.query.filter(
                (User.username == user_ref) | (User.email == user_ref)
            ).first()
            if not user:
                _fail(f'User "{user_ref}" not found.')
            if not user.is_active:
                _fail(f'User "{user.username}" is not active.')
        else:
            user = find_breakglass_admin()
            if not user:
                _fail('No active admin user found — create one with "serverkit create-admin".')

        token, link = login_link_service.mint(user.id, ttl_minutes=ttl, bound_ip=ip)

        origin = None
        try:
            from app.services.site_domain_service import SiteDomainService
            origin = SiteDomainService.panel_origin()
        except Exception:
            origin = None
        if not origin:
            origin = f'http://localhost:{resolve_port()}'

        click.echo(f'{origin}/login?link={token}')
        click.echo(
            f'Single-use link for "{user.username}", expires {link.expires_at.isoformat()}Z'
            + (f', bound to {ip}' if ip else ''),
            err=True,
        )


@cli.command()
@click.option('--repair', 'do_repair', is_flag=True, help='Repair all repairable findings')
@click.option('--yes', is_flag=True, help='Skip the repair confirmation prompt')
@click.option('--json', 'as_json', is_flag=True,
              help='Output the report as JSON (not combinable with --repair)')
def doctor(do_repair, yes, as_json):
    """Run panel diagnostics (and optionally repair findings)."""
    from app.services.cli_api_client import CliApiError

    if as_json and do_repair:
        _fail('--json cannot be combined with --repair (JSON mode is read-only).')

    try:
        client = _api_client()
        data = client.post('/doctor/run')
    except CliApiError as exc:
        _fail(str(exc))

    if as_json:
        _echo_json(data.get('report') or {})
        return

    checks = (data.get('report') or {}).get('checks', [])
    if not checks:
        click.echo('Doctor reported no checks.')
        return

    rows = []
    for check in checks:
        raw_status = str(check.get('status', '')).lower()
        symbol, color = STATUS_SYMBOLS.get(raw_status, ('✗', 'red'))
        rows.append((
            click.style(symbol, fg=color),
            check.get('title') or check.get('key', '-'),
            raw_status or '-',
            check.get('detail') or '',
        ))
    _echo_table(['', 'Check', 'Status', 'Detail'], rows)

    if not do_repair:
        return

    repairable = [
        c for c in checks
        if c.get('repairable') and str(c.get('status', '')).lower() not in ('ok', 'pass', 'healthy')
    ]
    if not repairable:
        click.echo('Nothing repairable.')
        return

    click.echo(f'\n{len(repairable)} repairable finding(s): '
               + ', '.join(c.get('key', '?') for c in repairable))
    if not yes and not click.confirm('Repair all of these?', default=False):
        click.echo('Aborted.')
        return

    # The repair endpoint takes the repair_ref dicts the report carries
    # ({'kind': 'drift', 'type', 'id'} / {'kind': 'service', 'name'}).
    items = [c.get('repair_ref') for c in repairable if c.get('repair_ref')]
    if not items:
        click.echo('Nothing repairable.')
        return
    try:
        result = client.post('/doctor/repair', {'items': items})
    except CliApiError as exc:
        _fail(str(exc))
    results = result.get('results', [])
    ok = sum(1 for r in results if r.get('success'))
    for r in results:
        mark = click.style('OK', fg='green') if r.get('success') else click.style('FAIL', fg='red')
        detail = r.get('error') or ''
        click.echo(f"  [{mark}] {r.get('item')} {detail}".rstrip())
    click.echo(click.style(f'{ok}/{len(results)} repairs succeeded.',
                           fg='green' if ok == len(results) else 'yellow'))


@cli.command()
@click.argument('drift_type')
@click.argument('drift_id')
def repair(drift_type, drift_id):
    """Repair a single drift finding (e.g. serverkit repair nginx <id>)."""
    from app.services.cli_api_client import CliApiError

    try:
        result = _api_client().post(
            f'/doctor/drift/{drift_type}/{drift_id}/repair', {'confirm': True}
        )
    except CliApiError as exc:
        _fail(str(exc))
    click.echo(click.style(result.get('message', 'Repair triggered.'), fg='green'))


# ── manifest (serverkit.yaml) ────────────────────────────────────────────────

def _manifest_body(project_id, file_path):
    """Build the request body for the manifest endpoints."""
    body = {'project_id': project_id}
    if file_path:
        body['content'] = Path(file_path).read_text(encoding='utf-8')
    return body


def _echo_plan_steps(steps):
    for step in steps:
        click.echo(
            f"  {step.get('type', '-')}  {step.get('service', '-')}  "
            f"{step.get('description', '')}".rstrip()
        )


def _echo_plan_issues(issues):
    for issue in issues or []:
        text = issue if isinstance(issue, str) else (
            issue.get('message') or issue.get('detail') or str(issue)
        )
        click.secho(f'  ! {text}', fg='yellow')


@cli.group()
def manifest():
    """Work with a project's declarative serverkit.yaml manifest."""


@manifest.command('plan')
@click.option('--project', 'project_id', type=int, required=True, help='Project id')
@click.option('--file', 'file_path', type=click.Path(exists=True), default=None,
              help='Manifest file to plan (defaults to the stored manifest)')
@click.option('--json', 'as_json', is_flag=True, help='Output the plan as JSON')
def manifest_plan(project_id, file_path, as_json):
    """Compute the change plan for a project's manifest (dry run)."""
    from app.services.cli_api_client import CliApiError

    try:
        data = _api_client().post('/manifests/plan', _manifest_body(project_id, file_path))
    except CliApiError as exc:
        _fail(str(exc))

    plan = data.get('plan') or {}
    if as_json:
        _echo_json(plan)
        return
    steps = plan.get('steps') or []
    _echo_plan_steps(steps)
    _echo_plan_issues(plan.get('issues'))
    summary = plan.get('summary') or 'Plan computed.'
    click.echo(f"{summary} ({plan.get('step_count', len(steps))} steps)")


@manifest.command('diff')
@click.option('--project', 'project_id', type=int, required=True, help='Project id')
@click.option('--file', 'file_path', type=click.Path(exists=True), default=None,
              help='Manifest file to diff (defaults to the stored manifest)')
def manifest_diff(project_id, file_path):
    """Show the human-readable diff between the manifest and live state."""
    from app.services.cli_api_client import CliApiError

    try:
        data = _api_client().post('/manifests/plan', _manifest_body(project_id, file_path))
    except CliApiError as exc:
        _fail(str(exc))

    plan = data.get('plan') or {}
    steps = plan.get('steps') or []
    if plan.get('step_count', len(steps)) == 0:
        click.echo('No changes — live state matches the manifest.')
        return
    click.echo('Planned changes:')
    _echo_plan_steps(steps)
    _echo_plan_issues(plan.get('issues'))


@manifest.command('apply')
@click.option('--project', 'project_id', type=int, required=True, help='Project id')
@click.option('--file', 'file_path', type=click.Path(exists=True), default=None,
              help='Manifest file to apply (defaults to the stored manifest)')
@click.option('--yes', is_flag=True, help='Skip the confirmation prompt')
def manifest_apply(project_id, file_path, yes):
    """Apply a project's manifest to live state."""
    from app.services.cli_api_client import CliApiError

    body = _manifest_body(project_id, file_path)
    client = _api_client()

    if not yes:
        try:
            data = client.post('/manifests/plan', body)
        except CliApiError as exc:
            _fail(str(exc))
        plan = data.get('plan') or {}
        steps = plan.get('steps') or []
        if plan.get('step_count', len(steps)) == 0:
            click.echo('No changes — live state matches the manifest.')
            return
        click.echo('Planned changes:')
        _echo_plan_steps(steps)
        _echo_plan_issues(plan.get('issues'))
        if not click.confirm('Apply these changes?', default=False):
            click.echo('Aborted.')
            return

    try:
        result = client.post('/manifests/apply', body)
    except CliApiError as exc:
        _fail(str(exc))

    results = result.get('results') or []
    for r in results:
        ok = str(r.get('status', '')).lower() in ('ok', 'skipped', 'success', 'applied', 'done')
        mark = click.style('OK', fg='green') if ok else click.style('FAIL', fg='red')
        detail = r.get('error') or ''
        click.echo(f"  [{mark}] {r.get('type', '-')}  {r.get('service', '-')} {detail}".rstrip())

    _echo_plan_issues(result.get('issues'))

    click.echo(f"Applied {result.get('applied', len(results))} change(s).")

    if not result.get('success'):
        failed = next((r for r in results if r.get('error')), None)
        if failed:
            _fail(f"Apply failed on {failed.get('service', '?')}: {failed.get('error')}")
        _fail('Apply did not complete successfully.')


@cli.command()
@click.option('--yes', is_flag=True, help='Skip the confirmation prompt')
def update(yes):
    """Update ServerKit via the bundled update script (Linux only)."""
    import subprocess

    if os.name == 'nt':
        _fail('serverkit update is Linux-only — run scripts/update.sh on the server itself.')

    from app.utils.version import get_install_dir
    candidates = [
        os.path.join(get_install_dir(), 'scripts', 'update.sh'),
        str(Path(__file__).resolve().parent.parent / 'scripts' / 'update.sh'),
        '/opt/serverkit/scripts/update.sh',
    ]
    script = next((c for c in candidates if os.path.isfile(c)), None)
    if not script:
        _fail('update.sh not found (looked in: ' + ', '.join(candidates) + ')')

    click.echo(f'This will run: bash {script}')
    if not yes and not click.confirm('Update ServerKit now?', default=False):
        click.echo('Aborted.')
        return

    # Inherit stdio so the operator sees the updater output live.
    proc = subprocess.Popen(['bash', script])
    sys.exit(proc.wait())


@cli.command('support-bundle')
@click.option('--out', 'out_path', default=None, help='Output path for the zip')
@click.option('--passphrase', default=None,
              help='Requested bundle passphrase (see output: encryption needs external tooling)')
def support_bundle(out_path, passphrase):
    """Build a scrubbed diagnostic support bundle zip."""
    app = create_app()
    with app.app_context():
        from app.services import support_bundle_service
        path = support_bundle_service.build(out_path=out_path, passphrase=passphrase)

    if passphrase:
        click.echo(click.style(
            'Note: built-in zip encryption is unavailable (pyzipper not installed); '
            'the bundle is NOT encrypted. Encrypt before sharing, e.g. gpg -c ' + path,
            fg='yellow',
        ))
    click.echo(click.style(f'Support bundle written: {path}', fg='green'))


# ── disk (reclaim space) ─────────────────────────────────────────────────────

@cli.command()
@click.option('--days', default=None, type=int,
              help='Prune telemetry rows older than this many days (default 7)')
@click.option('--keep', default=None, type=int,
              help='Upgrade snapshots to keep, newest first (default 1)')
@click.option('--older-than', 'older_than', default=None, type=int,
              help='Only offer upgrade snapshots at least this many days old')
@click.option('--only', default=None,
              help='Comma-separated candidate keys to reclaim, skipping the menu')
@click.option('--safe', is_flag=True, help='Reclaim every candidate marked safe, no prompt')
@click.option('--all', 'do_all', is_flag=True, help='Reclaim every candidate, no prompt')
@click.option('--dry-run', is_flag=True, help='Report what would be freed, change nothing')
@click.option('--allow-restart', is_flag=True,
              help='Let the panel restart if the database is locked during VACUUM')
@click.option('--yes', is_flag=True, help='Skip the confirmation prompt')
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def disk(days, keep, older_than, only, safe, do_all, dry_run, allow_restart, yes, as_json):
    """Show what is using disk space and reclaim it.

    With no options this lists every reclaimable item with its measured size and
    asks which to free — pick by number ("1,3"), by "safe", or "all".
    """
    from app.services import disk_reclaim_service as svc

    days = svc.DEFAULT_RETENTION_DAYS if days is None else days
    keep = svc.DEFAULT_KEEP_SNAPSHOTS if keep is None else keep
    if keep < 0:
        _fail('--keep cannot be negative.')
    if days < 0:
        _fail('--days cannot be negative.')

    app = create_app()
    with app.app_context():
        report = svc.scan(days=days, keep=keep, older_than_days=older_than)
        candidates = report['candidates']
        usable = [c for c in candidates if (c['bytes'] or 0) > 0]

        if as_json and not (only or safe or do_all):
            _echo_json(report)
            return

        disk_info = report['disk'] or {}
        if not as_json:
            click.echo()
            if disk_info:
                bar_used = disk_info['percent_used']
                colour = 'red' if bar_used >= 90 else ('yellow' if bar_used >= 75 else 'green')
                click.echo(click.style(
                    f"Disk {disk_info['path']}: {svc.human_bytes(disk_info['used'])} used "
                    f"of {svc.human_bytes(disk_info['total'])} "
                    f"({bar_used}%), {svc.human_bytes(disk_info['free'])} free",
                    fg=colour))
            click.echo()
            # Number only the items that can actually free something, and
            # number them exactly the way the prompt reads them back.
            numbers = {cand['key']: n for n, cand in enumerate(usable, start=1)}
            rows = []
            for cand in candidates:
                size = cand['bytes'] or 0
                rows.append((
                    str(numbers.get(cand['key'], '-')),
                    svc.human_bytes(size) if size else '—',
                    cand['safety'],
                    cand['title'],
                    cand['detail'],
                ))
            _echo_table(['#', 'Reclaims', 'Safety', 'Item', 'Detail'], rows)
            click.echo()
            click.echo(f"Total reclaimable: "
                       f"{click.style(svc.human_bytes(report['total_bytes']), bold=True)}")

        # Work out the selection.
        if do_all:
            chosen = [c['key'] for c in usable]
        elif safe:
            chosen = [c['key'] for c in usable if c['safety'] == 'safe']
        elif only:
            wanted = {k.strip() for k in only.split(',') if k.strip()}
            known = {c['key'] for c in candidates}
            unknown = wanted - known
            if unknown:
                _fail('unknown candidate(s): ' + ', '.join(sorted(unknown))
                      + '. Known: ' + ', '.join(sorted(known)))
            chosen = [c['key'] for c in candidates if c['key'] in wanted]
        elif not usable:
            click.echo('\nNothing to reclaim.')
            return
        else:
            chosen = _prompt_disk_selection(usable)
            if chosen is None:
                click.echo('Aborted.')
                return

        if not chosen:
            click.echo('Nothing selected.')
            return

        # When snapshots were chosen interactively, let the operator say which
        # ones rather than assuming the keep/age rule.
        stamps = None
        interactive = not (do_all or safe or only)
        if 'upgrade-snapshots' in chosen and interactive and not as_json:
            snapshot_cand = next(c for c in candidates if c['key'] == 'upgrade-snapshots')
            stamps = _prompt_snapshot_choice(snapshot_cand)
            if not stamps:
                chosen = [k for k in chosen if k != 'upgrade-snapshots']
                if not chosen:
                    click.echo('Nothing selected.')
                    return

        picked = [c for c in candidates if c['key'] in chosen]
        planned = sum(
            (sum(s['bytes'] for s in c['snapshots'] if s['stamp'] in stamps)
             if (stamps is not None and c['key'] == 'upgrade-snapshots')
             else (c['bytes'] or 0))
            for c in picked)
        if not as_json:
            click.echo()
            for cand in picked:
                size = cand['bytes'] or 0
                label = cand['title']
                if stamps is not None and cand['key'] == 'upgrade-snapshots':
                    size = sum(s['bytes'] for s in cand['snapshots'] if s['stamp'] in stamps)
                    label = f'{len(stamps)} upgrade snapshot(s)'
                click.echo(f'  • {label} ({svc.human_bytes(size)})')
            verb = 'Would free' if dry_run else 'Free'
            click.echo(f"\n{verb} about {click.style(svc.human_bytes(planned), bold=True)}.")

        if not dry_run and not yes and not as_json:
            if not click.confirm('Proceed?', default=False):
                click.echo('Aborted.')
                return

        result = svc.reclaim(chosen, days=days, keep=keep, dry_run=dry_run,
                             allow_restart=allow_restart, older_than_days=older_than,
                             snapshot_stamps=stamps)

    if as_json:
        _echo_json(result)
        return

    click.echo()
    _echo_table(['Item', 'Freed', 'Note'],
                [(r['key'], svc.human_bytes(r['bytes'] or 0), r['note']) for r in result['results']])
    after = result['disk_after'] or {}
    click.echo()
    click.echo(click.style(
        f"{'Would free' if dry_run else 'Freed'} "
        f"{svc.human_bytes(result['freed_bytes'])}.", fg='green', bold=True))
    if after and not dry_run:
        click.echo(f"Disk now {after['percent_used']}% used, "
                   f"{svc.human_bytes(after['free'])} free.")


def _prompt_snapshot_choice(candidate):
    """Offer the upgrade snapshots one by one. Returns the stamps to delete.

    One update writes a database copy and a whole tree backup under the same
    timestamp, so snapshots are picked as units — a half-deleted snapshot is
    not a restore point.
    """
    from app.services import disk_reclaim_service as svc

    snapshots = candidate.get('snapshots') or []
    if len(snapshots) <= 1:
        return candidate.get('doomed_stamps') or []

    default_stamps = candidate.get('doomed_stamps') or []
    click.echo(f'\n{len(snapshots)} upgrade snapshot(s), newest first:')
    rows = []
    for index, snap in enumerate(snapshots, start=1):
        age = snap['age_days']
        if age is None:
            when = '-'
        elif age == 0:
            when = 'today'
        else:
            when = f'{age} day{"s" if age != 1 else ""} ago'
        rows.append((
            str(index),
            snap['stamp'],
            when,
            svc.human_bytes(snap['bytes']),
            'newest — kept by default' if index == 1 else
            ('would delete' if snap['stamp'] in default_stamps else 'kept'),
        ))
    _echo_table(['#', 'Snapshot', 'Taken', 'Size', ''], rows)

    click.echo('\nDelete which? numbers like "1,3", "older-than 14" (days), '
               '"all-but-newest", or "none".')
    by_index = {index: snap for index, snap in enumerate(snapshots, start=1)}
    while True:
        answer = click.prompt('Snapshots', default='all-but-newest',
                              show_default=True).strip().lower()
        if answer in ('none', 'n', 'q'):
            return []
        if answer == 'all-but-newest':
            return [s['stamp'] for s in snapshots[1:]]
        if answer.startswith('older-than'):
            raw = answer.replace('older-than', '').strip()
            if not raw.isdigit():
                click.echo(click.style('Give a number of days, e.g. "older-than 14".',
                                       fg='yellow'))
                continue
            chosen = svc.select_snapshots(snapshots, keep=1, older_than_days=int(raw))
            if not chosen:
                click.echo(click.style(
                    f'No snapshot besides the newest is {raw}+ days old.', fg='yellow'))
                continue
            return [s['stamp'] for s in chosen]
        picked, bad = [], []
        for token in answer.replace(' ', ',').split(','):
            if not token:
                continue
            if token.isdigit() and int(token) in by_index:
                picked.append(by_index[int(token)]['stamp'])
            else:
                bad.append(token)
        if bad:
            click.echo(click.style('Not a listed number: ' + ', '.join(bad), fg='yellow'))
            continue
        if picked:
            if len(picked) == len(snapshots) and not click.confirm(
                    'That deletes every snapshot, leaving no restore point. Sure?',
                    default=False):
                continue
            return picked
        click.echo(click.style('Nothing selected — pick at least one number.', fg='yellow'))


def _prompt_disk_selection(usable):
    """Ask which candidates to reclaim. Returns keys, or None to abort."""
    by_index = {index: cand for index, cand in enumerate(usable, start=1)}
    click.echo('\nSelect what to free: numbers like "1,3", "safe" for everything '
               'marked safe, "all", or "q" to quit.')
    while True:
        answer = click.prompt('Selection', default='safe', show_default=True).strip().lower()
        if answer in ('q', 'quit', 'n', 'no'):
            return None
        if answer == 'all':
            return [c['key'] for c in usable]
        if answer == 'safe':
            return [c['key'] for c in usable if c['safety'] == 'safe']
        picked, bad = [], []
        for token in answer.replace(' ', ',').split(','):
            if not token:
                continue
            if token.isdigit() and int(token) in by_index:
                picked.append(by_index[int(token)]['key'])
            else:
                bad.append(token)
        if bad:
            click.echo(click.style('Not a listed number: ' + ', '.join(bad), fg='yellow'))
            continue
        if picked:
            return picked
        click.echo(click.style('Nothing selected — pick at least one number.', fg='yellow'))


# ── connect (ServerKit Cloud pairing) ─────────────────────────────────────────

@cli.group(invoke_without_command=True)
@click.option('--cloud', 'cloud_url', default=None,
              help='ServerKit Cloud control-plane URL (default: SERVERKIT_CLOUD_URL env var '
                   'or https://app.serverkit.ai)')
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
@click.pass_context
def connect(ctx, cloud_url, as_json):
    """Pair this panel with ServerKit Cloud.

    Prints a pairing code and this panel's fingerprint, then waits for the
    enrollment to be approved in the browser.
    """
    if ctx.invoked_subcommand is not None:
        return

    from app.services import connect_client
    from app.services.connect_client import ConnectError

    already = connect_client.status()
    if already.get('paired'):
        if as_json:
            _echo_json(already)
            return
        click.echo(f'This panel is already connected to organization '
                   f'"{already.get("org_slug")}" as "{already.get("name")}" '
                   f'({already.get("cloud_url")}).')
        click.echo(f'Fingerprint: {already.get("fingerprint_grouped")}')
        click.echo('Run `serverkit connect status` for details, or '
                   '`serverkit connect disconnect` before re-pairing.')
        return

    # The app context is only needed to enumerate managed agents from the DB.
    # Pairing itself is DB-independent, so a broken local DB must not block it.
    try:
        app = create_app()
        app_context = app.app_context()
    except Exception as exc:
        click.echo(click.style(
            f'Warning: panel database unavailable ({exc}); '
            'reporting no managed agents to ServerKit Cloud.', fg='yellow'), err=True)
        app_context = contextlib.nullcontext()

    try:
        with app_context:
            result = connect_client.connect(cloud_url=cloud_url, echo=click.echo)
    except ConnectError as exc:
        _fail(str(exc))
    except KeyboardInterrupt:
        click.echo()
        _fail('Pairing aborted — nothing was saved. '
              'Run `serverkit connect` to start over.')

    if as_json:
        _echo_json(result)


@connect.command('status')
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def connect_status(as_json):
    """Show this panel's ServerKit Cloud connection state."""
    from app.services import connect_client

    state = connect_client.status()
    if as_json:
        _echo_json(state)
        return

    if not state.get('paired'):
        click.echo('Not connected to ServerKit Cloud. '
                   'Run `serverkit connect` to pair this panel.')
        return

    rows = [
        ('State', state.get('state')),
        ('Reason', state.get('state_reason') or '-'),
        ('Transport', state.get('transport') or '-'),
        ('Last seen', state.get('last_connected_at') or '-'),
        ('Relay instance', state.get('relay_instance') or '-'),
        ('ServerKit Cloud', state.get('cloud_url')),
        ('Organization', state.get('org_slug') or '-'),
        ('Name', state.get('name') or '-'),
        ('Fingerprint', state.get('fingerprint_grouped') or '-'),
        ('Relay', state.get('relay_url') or '-'),
        ('Scopes', ', '.join(state.get('scopes') or []) or '-'),
        ('Paired at', state.get('paired_at') or '-'),
        ('Device key', state.get('key_path')
         + ('' if state.get('key_present') else ' (MISSING)')),
    ]
    _echo_table(['Field', 'Value'], rows)


@connect.command('doctor')
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def connect_doctor(as_json):
    """Diagnose the path from this panel to the ServerKit relay.

    Exits non-zero when any hard check fails (DNS, TCP, TLS, clock skew,
    device key, panel loopback). A refused WebSocket upgrade is a warning —
    the client falls back to limited (long-poll) mode.
    """
    from app.services import connect_client

    checks = connect_client.run_doctor()
    healthy = connect_client.doctor_ok(checks)

    if as_json:
        _echo_json({'ok': healthy, 'checks': checks})
    else:
        click.echo('ServerKit Cloud connect doctor')
        click.echo()
        for check in checks:
            if check['ok']:
                mark = click.style('OK  ', fg='green')
            elif check['hard']:
                mark = click.style('FAIL', fg='red')
            else:
                mark = click.style('WARN', fg='yellow')
            line = f'  {mark} {check["name"]}'
            if check.get('note'):
                line += f'  ({check["note"]})'
            click.echo(line)
            if check.get('error'):
                click.echo(f'    {check["error"]}')
        click.echo()
        if healthy:
            click.echo(click.style('All hard checks passed.', fg='green'))
        else:
            click.echo(click.style('Some checks failed — see above.', fg='red'))

    if not healthy:
        sys.exit(1)


@connect.command('disconnect')
@click.option('--remove-key', is_flag=True,
              help='Also delete the device keypair (a new identity on next pair)')
@click.option('--yes', is_flag=True, help='Skip the confirmation prompt')
@click.option('--json', 'as_json', is_flag=True, help='Output machine-readable JSON')
def connect_disconnect(remove_key, yes, as_json):
    """Forget the ServerKit Cloud pairing on this panel.

    Local only — to revoke the device for everyone, remove it in the ServerKit Cloud UI.
    """
    from app.services import connect_client

    state = connect_client.status()
    if not state.get('paired'):
        if as_json:
            _echo_json({'success': True, 'state': 'unpaired', 'removed': []})
            return
        click.echo('This panel is not connected to ServerKit Cloud.')
        return

    if not yes and not as_json:
        click.echo(f'This will forget the pairing with organization '
                   f'"{state.get("org_slug")}" on this panel. '
                   'The device stays registered on ServerKit Cloud until revoked there.')
        if not click.confirm('Disconnect?', default=False):
            click.echo('Aborted.')
            return

    result = connect_client.disconnect(remove_key=remove_key)
    if as_json:
        _echo_json(result)
        return
    for path in result['removed']:
        click.echo(f'Removed {path}')
    click.echo(click.style('Disconnected from ServerKit Cloud.', fg='green'))


if __name__ == '__main__':
    cli()
