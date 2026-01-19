#!/usr/bin/env python3
"""ServerKit CLI - Administrative commands for ServerKit."""

import os
import click
import secrets
import sys
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

        click.echo(click.style(f'Admin user "{username}" created successfully!', fg='green'))


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
def list_users():
    """List all users."""
    app = create_app()
    with app.app_context():
        users = User.query.all()

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
    """Initialize the database."""
    app = create_app()
    with app.app_context():
        db.create_all()
        click.echo(click.style('Database initialized successfully!', fg='green'))


@cli.command()
def migrate_db():
    """Apply database migrations for missing columns."""
    app = create_app()
    with app.app_context():
        from sqlalchemy import text, inspect

        inspector = inspect(db.engine)

        # Get existing columns in applications table
        existing_columns = [col['name'] for col in inspector.get_columns('applications')]

        migrations = []

        # Check and add missing columns to applications table
        if 'private_slug' not in existing_columns:
            migrations.append(('applications', 'private_slug', 'VARCHAR(50)'))
        if 'private_url_enabled' not in existing_columns:
            migrations.append(('applications', 'private_url_enabled', 'BOOLEAN DEFAULT 0'))
        if 'environment_type' not in existing_columns:
            migrations.append(('applications', 'environment_type', "VARCHAR(20) DEFAULT 'standalone'"))
        if 'linked_app_id' not in existing_columns:
            migrations.append(('applications', 'linked_app_id', 'INTEGER'))
        if 'shared_config' not in existing_columns:
            migrations.append(('applications', 'shared_config', 'TEXT'))

        if not migrations:
            click.echo(click.style('Database is up to date. No migrations needed.', fg='green'))
            return

        click.echo(f'Found {len(migrations)} migration(s) to apply...')

        for table, column, col_type in migrations:
            try:
                sql = f'ALTER TABLE {table} ADD COLUMN {column} {col_type}'
                db.session.execute(text(sql))
                click.echo(click.style(f'  ✓ Added column {table}.{column}', fg='green'))
            except Exception as e:
                click.echo(click.style(f'  ✗ Failed to add {table}.{column}: {e}', fg='red'))

        db.session.commit()
        click.echo(click.style('\nMigrations completed!', fg='green'))


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
        apps = Application.query.all()

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
        apps = Application.query.all()
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

        # 7. Drop and recreate database
        try:
            db.drop_all()
            db.create_all()
            click.echo(click.style('✓ Reset database', fg='green'))
        except Exception as e:
            click.echo(click.style(f'✗ Failed to reset database: {e}', fg='red'))

        click.echo(click.style('\nFactory reset completed!', fg='green'))
        click.echo('Run "serverkit create-admin" to create a new admin user.')


@cli.command()
@click.option('--all', 'show_all', is_flag=True, help='Also show Docker container status')
def list_apps(show_all):
    """List all user applications (excludes ServerKit infrastructure)."""
    import subprocess
    from app.models import Application

    app = create_app()
    with app.app_context():
        apps = Application.query.all()

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


if __name__ == '__main__':
    cli()
