import os
import json
import subprocess
import shutil
import tarfile
import gzip
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from pathlib import Path
import threading
import time
import schedule

from app import paths


class BackupService:
    """Service for automated backups of applications and databases."""

    BACKUP_BASE_DIR = paths.SERVERKIT_BACKUP_DIR
    CONFIG_DIR = paths.SERVERKIT_CONFIG_DIR
    BACKUP_CONFIG = os.path.join(CONFIG_DIR, 'backups.json')

    # Backup types
    TYPE_APP = 'application'
    TYPE_DATABASE = 'database'
    TYPE_FULL = 'full'

    _scheduler_thread = None
    _stop_scheduler = False

    @classmethod
    def get_backup_dir(cls, backup_type: str = None) -> str:
        """Get backup directory for type."""
        if backup_type:
            return os.path.join(cls.BACKUP_BASE_DIR, backup_type)
        return cls.BACKUP_BASE_DIR

    @classmethod
    def ensure_backup_dirs(cls) -> None:
        """Ensure backup directories exist."""
        for subdir in ['applications', 'databases', 'full', 'scheduled']:
            path = os.path.join(cls.BACKUP_BASE_DIR, subdir)
            os.makedirs(path, exist_ok=True)

    @classmethod
    def get_config(cls) -> Dict:
        """Get backup configuration."""
        if os.path.exists(cls.BACKUP_CONFIG):
            try:
                with open(cls.BACKUP_CONFIG, 'r') as f:
                    return json.load(f)
            except Exception:
                pass

        return {
            'enabled': False,
            'retention_days': 30,
            'schedules': [],
            'notifications': {
                'on_success': False,
                'on_failure': True,
                'email': ''
            }
        }

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save backup configuration."""
        try:
            os.makedirs(cls.CONFIG_DIR, exist_ok=True)
            with open(cls.BACKUP_CONFIG, 'w') as f:
                json.dump(config, f, indent=2)
            return {'success': True, 'message': 'Configuration saved'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def backup_application(cls, app_name: str, app_path: str,
                          include_db: bool = False, db_config: Dict = None) -> Dict:
        """Backup an application (files and optionally database)."""
        cls.ensure_backup_dirs()

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_name = f"{app_name}_{timestamp}"
        backup_dir = os.path.join(cls.BACKUP_BASE_DIR, 'applications', backup_name)

        try:
            os.makedirs(backup_dir, exist_ok=True)

            # Backup files
            files_backup = os.path.join(backup_dir, 'files.tar.gz')
            with tarfile.open(files_backup, 'w:gz') as tar:
                tar.add(app_path, arcname=os.path.basename(app_path))

            backup_info = {
                'name': backup_name,
                'app_name': app_name,
                'timestamp': datetime.now().isoformat(),
                'type': cls.TYPE_APP,
                'files_backup': files_backup,
                'size': os.path.getsize(files_backup)
            }

            # Backup database if requested
            if include_db and db_config:
                db_backup = cls._backup_database_internal(
                    db_config.get('type', 'mysql'),
                    db_config.get('name'),
                    backup_dir,
                    db_config
                )
                if db_backup.get('success'):
                    backup_info['database_backup'] = db_backup['path']
                    backup_info['database_type'] = db_config.get('type')

            # Save backup metadata
            meta_path = os.path.join(backup_dir, 'backup.json')
            with open(meta_path, 'w') as f:
                json.dump(backup_info, f, indent=2)

            return {
                'success': True,
                'backup': backup_info,
                'path': backup_dir
            }

        except Exception as e:
            # Cleanup on failure
            if os.path.exists(backup_dir):
                shutil.rmtree(backup_dir, ignore_errors=True)
            return {'success': False, 'error': str(e)}

    @classmethod
    def _backup_database_internal(cls, db_type: str, db_name: str,
                                  backup_dir: str, config: Dict) -> Dict:
        """Internal database backup helper."""
        backup_file = os.path.join(backup_dir, f'{db_name}.sql.gz')

        try:
            if db_type == 'mysql':
                cmd = ['mysqldump']
                if config.get('user'):
                    cmd.extend(['-u', config['user']])
                if config.get('password'):
                    cmd.append(f"-p{config['password']}")
                if config.get('host'):
                    cmd.extend(['-h', config['host']])
                cmd.append(db_name)

                with gzip.open(backup_file, 'wt') as f:
                    result = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, text=True)

                if result.returncode != 0:
                    return {'success': False, 'error': result.stderr}

            elif db_type == 'postgresql':
                env = os.environ.copy()
                if config.get('password'):
                    env['PGPASSWORD'] = config['password']

                cmd = ['pg_dump']
                if config.get('user'):
                    cmd.extend(['-U', config['user']])
                if config.get('host'):
                    cmd.extend(['-h', config['host']])
                cmd.append(db_name)

                with gzip.open(backup_file, 'wt') as f:
                    result = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, text=True, env=env)

                if result.returncode != 0:
                    return {'success': False, 'error': result.stderr}

            return {'success': True, 'path': backup_file}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def backup_database(cls, db_type: str, db_name: str,
                       user: str = None, password: str = None,
                       host: str = 'localhost') -> Dict:
        """Backup a database."""
        cls.ensure_backup_dirs()

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_name = f"{db_type}_{db_name}_{timestamp}.sql.gz"
        backup_path = os.path.join(cls.BACKUP_BASE_DIR, 'databases', backup_name)

        config = {
            'type': db_type,
            'name': db_name,
            'user': user,
            'password': password,
            'host': host
        }

        result = cls._backup_database_internal(db_type, db_name,
                                               os.path.dirname(backup_path), config)

        if result.get('success'):
            # Rename to final path
            os.rename(result['path'], backup_path)
            return {
                'success': True,
                'backup': {
                    'name': backup_name,
                    'path': backup_path,
                    'timestamp': datetime.now().isoformat(),
                    'type': cls.TYPE_DATABASE,
                    'database_type': db_type,
                    'database_name': db_name,
                    'size': os.path.getsize(backup_path)
                }
            }

        return result

    @classmethod
    def restore_application(cls, backup_path: str, restore_path: str = None) -> Dict:
        """Restore an application from backup."""
        meta_path = os.path.join(backup_path, 'backup.json')

        if not os.path.exists(meta_path):
            return {'success': False, 'error': 'Invalid backup: metadata not found'}

        try:
            with open(meta_path, 'r') as f:
                backup_info = json.load(f)

            files_backup = backup_info.get('files_backup')
            if not files_backup or not os.path.exists(files_backup):
                return {'success': False, 'error': 'Backup files not found'}

            # Determine restore path
            if not restore_path:
                restore_path = f"/var/www/{backup_info['app_name']}"

            # Backup existing if present
            if os.path.exists(restore_path):
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                backup_existing = f"{restore_path}.backup_{timestamp}"
                shutil.move(restore_path, backup_existing)

            # Extract backup
            with tarfile.open(files_backup, 'r:gz') as tar:
                tar.extractall(os.path.dirname(restore_path))

            return {
                'success': True,
                'message': f'Application restored to {restore_path}',
                'restore_path': restore_path
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def restore_database(cls, backup_path: str, db_type: str, db_name: str,
                        user: str = None, password: str = None,
                        host: str = 'localhost') -> Dict:
        """Restore a database from backup."""
        if not os.path.exists(backup_path):
            return {'success': False, 'error': 'Backup file not found'}

        try:
            if db_type == 'mysql':
                cmd = ['mysql']
                if user:
                    cmd.extend(['-u', user])
                if password:
                    cmd.append(f"-p{password}")
                if host:
                    cmd.extend(['-h', host])
                cmd.append(db_name)

                with gzip.open(backup_path, 'rt') as f:
                    result = subprocess.run(cmd, stdin=f, capture_output=True, text=True)

            elif db_type == 'postgresql':
                env = os.environ.copy()
                if password:
                    env['PGPASSWORD'] = password

                cmd = ['psql']
                if user:
                    cmd.extend(['-U', user])
                if host:
                    cmd.extend(['-h', host])
                cmd.extend(['-d', db_name])

                with gzip.open(backup_path, 'rt') as f:
                    result = subprocess.run(cmd, stdin=f, capture_output=True, text=True, env=env)

            else:
                return {'success': False, 'error': f'Unknown database type: {db_type}'}

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr}

            return {'success': True, 'message': f'Database {db_name} restored'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_backups(cls, backup_type: str = None) -> List[Dict]:
        """List all backups."""
        backups = []
        cls.ensure_backup_dirs()

        search_dirs = []
        if backup_type == 'application':
            search_dirs = [os.path.join(cls.BACKUP_BASE_DIR, 'applications')]
        elif backup_type == 'database':
            search_dirs = [os.path.join(cls.BACKUP_BASE_DIR, 'databases')]
        else:
            search_dirs = [
                os.path.join(cls.BACKUP_BASE_DIR, 'applications'),
                os.path.join(cls.BACKUP_BASE_DIR, 'databases'),
                os.path.join(cls.BACKUP_BASE_DIR, 'scheduled')
            ]

        for search_dir in search_dirs:
            if not os.path.exists(search_dir):
                continue

            for item in os.listdir(search_dir):
                item_path = os.path.join(search_dir, item)

                if os.path.isdir(item_path):
                    # Application backup (directory)
                    meta_path = os.path.join(item_path, 'backup.json')
                    if os.path.exists(meta_path):
                        try:
                            with open(meta_path, 'r') as f:
                                backup_info = json.load(f)
                            backup_info['path'] = item_path
                            backups.append(backup_info)
                        except Exception:
                            pass
                elif item.endswith('.sql.gz'):
                    # Database backup (file)
                    stat = os.stat(item_path)
                    backups.append({
                        'name': item,
                        'path': item_path,
                        'type': cls.TYPE_DATABASE,
                        'size': stat.st_size,
                        'timestamp': datetime.fromtimestamp(stat.st_mtime).isoformat()
                    })

        # Sort by timestamp (newest first)
        backups.sort(key=lambda x: x.get('timestamp', ''), reverse=True)

        return backups

    @classmethod
    def delete_backup(cls, backup_path: str) -> Dict:
        """Delete a backup."""
        if not backup_path.startswith(cls.BACKUP_BASE_DIR):
            return {'success': False, 'error': 'Invalid backup path'}

        try:
            if os.path.isdir(backup_path):
                shutil.rmtree(backup_path)
            elif os.path.exists(backup_path):
                os.remove(backup_path)
            else:
                return {'success': False, 'error': 'Backup not found'}

            return {'success': True, 'message': 'Backup deleted'}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def cleanup_old_backups(cls, retention_days: int = None) -> Dict:
        """Delete backups older than retention period."""
        config = cls.get_config()
        if retention_days is None:
            retention_days = config.get('retention_days', 30)

        cutoff = datetime.now() - timedelta(days=retention_days)
        deleted = 0

        try:
            for backup in cls.list_backups():
                try:
                    backup_time = datetime.fromisoformat(backup.get('timestamp', ''))
                    if backup_time < cutoff:
                        result = cls.delete_backup(backup['path'])
                        if result.get('success'):
                            deleted += 1
                except Exception:
                    pass

            return {
                'success': True,
                'deleted_count': deleted,
                'message': f'Deleted {deleted} old backup(s)'
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def add_schedule(cls, name: str, backup_type: str, target: str,
                    schedule_time: str, days: List[str] = None) -> Dict:
        """Add a backup schedule."""
        config = cls.get_config()

        schedule_entry = {
            'id': datetime.now().strftime('%Y%m%d%H%M%S'),
            'name': name,
            'backup_type': backup_type,
            'target': target,
            'schedule_time': schedule_time,
            'days': days or ['daily'],
            'enabled': True,
            'last_run': None
        }

        config.setdefault('schedules', []).append(schedule_entry)
        result = cls.save_config(config)

        if result.get('success'):
            return {'success': True, 'schedule': schedule_entry}
        return result

    @classmethod
    def remove_schedule(cls, schedule_id: str) -> Dict:
        """Remove a backup schedule."""
        config = cls.get_config()
        schedules = config.get('schedules', [])

        new_schedules = [s for s in schedules if s.get('id') != schedule_id]

        if len(new_schedules) == len(schedules):
            return {'success': False, 'error': 'Schedule not found'}

        config['schedules'] = new_schedules
        return cls.save_config(config)

    @classmethod
    def get_schedules(cls) -> List[Dict]:
        """Get all backup schedules."""
        config = cls.get_config()
        return config.get('schedules', [])

    @classmethod
    def get_backup_stats(cls) -> Dict:
        """Get backup statistics."""
        backups = cls.list_backups()

        total_size = sum(b.get('size', 0) for b in backups)
        app_backups = [b for b in backups if b.get('type') == cls.TYPE_APP]
        db_backups = [b for b in backups if b.get('type') == cls.TYPE_DATABASE]

        return {
            'total_backups': len(backups),
            'application_backups': len(app_backups),
            'database_backups': len(db_backups),
            'total_size': total_size,
            'total_size_human': cls._format_size(total_size)
        }

    @staticmethod
    def _format_size(size: int) -> str:
        """Format size in human readable format."""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} PB"
