import os
import json
import subprocess
import shutil
import tarfile
import gzip
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional
from pathlib import Path
import threading
import time
import uuid
import schedule

from app import paths
from app.utils import backup_crypto
from app.utils.config_store import load_json_config, save_json_config
from app.utils.formatting import format_bytes
from app.utils.system import is_command_available, run_checked
from app.services.telemetry_service import TelemetryService, generate_correlation_id
from app.services import backup_schedule_service

# Unified job kind for asynchronous scheduled backups (see register_jobs).
BACKUP_JOB_KIND = 'backup.run'


class BackupService:
    """Service for automated backups of applications and databases."""

    BACKUP_BASE_DIR = paths.SERVERKIT_BACKUP_DIR
    CONFIG_DIR = paths.SERVERKIT_CONFIG_DIR
    BACKUP_CONFIG = os.path.join(CONFIG_DIR, 'backups.json')

    # Backup types
    TYPE_APP = 'application'
    TYPE_DATABASE = 'database'
    TYPE_FULL = 'full'
    TYPE_FILES = 'files'

    @classmethod
    def get_backup_dir(cls, backup_type: str = None) -> str:
        """Get backup directory for type."""
        if backup_type:
            return os.path.join(cls.BACKUP_BASE_DIR, backup_type)
        return cls.BACKUP_BASE_DIR

    @classmethod
    def ensure_backup_dirs(cls) -> None:
        """Ensure backup directories exist."""
        for subdir in ['applications', 'databases', 'full', 'scheduled', 'files']:
            path = os.path.join(cls.BACKUP_BASE_DIR, subdir)
            os.makedirs(path, exist_ok=True)

    @classmethod
    def get_config(cls) -> Dict:
        """Get backup configuration."""
        return load_json_config(cls.BACKUP_CONFIG, {
            'enabled': False,
            'retention_days': 30,
            'encrypt_backups': False,
            'schedules': [],
            'notifications': {
                'on_success': False,
                'on_failure': True,
                'email': ''
            }
        })

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save backup configuration."""
        return save_json_config(cls.BACKUP_CONFIG, config)

    @classmethod
    def backup_application(cls, app_name: str, app_path: str,
                          include_db: bool = False, db_config: Dict = None,
                          correlation_id: str = None) -> Dict:
        """Backup an application (files and optionally database)."""
        cls.ensure_backup_dirs()

        correlation_id = correlation_id or generate_correlation_id()
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_name = f"{app_name}_{timestamp}"
        backup_dir = os.path.join(cls.BACKUP_BASE_DIR, 'applications', backup_name)

        TelemetryService.emit(
            source='backup',
            event_type='backup.started',
            message=f'Application backup started: {app_name}',
            severity='info',
            resource_type='application',
            resource_id=app_name,
            correlation_id=correlation_id,
            payload={'app_name': app_name, 'include_db': include_db},
            commit=True,
        )

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
                'size': os.path.getsize(files_backup),
                'remote_status': 'local'
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

            # Encrypt the archive in place if configured (updates 'path'/'size').
            # backup_info['path'] is the archive; the upload target is the dir.
            backup_info['path'] = files_backup
            cls._finalize_backup(files_backup, backup_info)
            backup_info['files_backup'] = backup_info['path']

            # Save backup metadata
            meta_path = os.path.join(backup_dir, 'backup.json')
            with open(meta_path, 'w') as f:
                json.dump(backup_info, f, indent=2)

            # Auto-upload to remote if configured (whole directory)
            cls._auto_upload(backup_dir, backup_info)

            result = {
                'success': True,
                'backup': backup_info,
                'path': backup_dir,
                'correlation_id': correlation_id,
            }
            TelemetryService.emit(
                source='backup',
                event_type='backup.completed',
                message=f'Application backup completed: {app_name}',
                severity='info',
                resource_type='application',
                resource_id=app_name,
                correlation_id=correlation_id,
                payload={
                    'app_name': app_name,
                    'backup_name': backup_name,
                    'size': backup_info.get('size'),
                    'include_db': include_db,
                },
                commit=True,
            )
            return result

        except Exception as e:
            # Cleanup on failure
            if os.path.exists(backup_dir):
                shutil.rmtree(backup_dir, ignore_errors=True)
            TelemetryService.emit(
                source='backup',
                event_type='backup.failed',
                message=f'Application backup failed: {app_name}',
                severity='error',
                resource_type='application',
                resource_id=app_name,
                correlation_id=correlation_id,
                payload={'app_name': app_name, 'include_db': include_db, 'error': str(e)},
                commit=True,
            )
            return {'success': False, 'error': str(e), 'correlation_id': correlation_id}

    @classmethod
    def _backup_database_internal(cls, db_type: str, db_name: str,
                                  backup_dir: str, config: Dict) -> Dict:
        """Internal database backup helper."""
        backup_file = os.path.join(backup_dir, f'{db_name}.sql.gz')

        try:
            if db_type == 'mysql':
                if not is_command_available('mysqldump'):
                    return {'success': False, 'error': 'mysqldump not installed'}
                cmd = ['mysqldump']
                if config.get('user'):
                    cmd.extend(['-u', config['user']])
                if config.get('password'):
                    cmd.append(f"-p{config['password']}")
                if config.get('host'):
                    cmd.extend(['-h', config['host']])
                cmd.append(db_name)

                with gzip.open(backup_file, 'wt') as f:
                    result = run_checked(cmd, stdout=f, stderr=subprocess.PIPE,
                                         timeout=None)

                if not result['success']:
                    return {'success': False, 'error': result['error']}

            elif db_type == 'postgresql':
                if not is_command_available('pg_dump'):
                    return {'success': False, 'error': 'pg_dump not installed'}

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
                    result = run_checked(cmd, stdout=f, stderr=subprocess.PIPE,
                                         env=env, timeout=None)

                if not result['success']:
                    return {'success': False, 'error': result['error']}

            return {'success': True, 'path': backup_file}

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def backup_database(cls, db_type: str, db_name: str,
                       user: str = None, password: str = None,
                       host: str = 'localhost',
                       correlation_id: str = None) -> Dict:
        """Backup a database."""
        cls.ensure_backup_dirs()

        correlation_id = correlation_id or generate_correlation_id()
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_name = f"{db_type}_{db_name}_{timestamp}.sql.gz"
        backup_path = os.path.join(cls.BACKUP_BASE_DIR, 'databases', backup_name)

        TelemetryService.emit(
            source='backup',
            event_type='backup.started',
            message=f'Database backup started: {db_name}',
            severity='info',
            resource_type='database',
            resource_id=db_name,
            correlation_id=correlation_id,
            payload={'db_type': db_type, 'db_name': db_name},
            commit=True,
        )

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

            backup_info = {
                'name': backup_name,
                'path': backup_path,
                'timestamp': datetime.now().isoformat(),
                'type': cls.TYPE_DATABASE,
                'database_type': db_type,
                'database_name': db_name,
                'size': os.path.getsize(backup_path),
                'remote_status': 'local'
            }

            # Encrypt in place if configured (updates backup_info path/size)
            backup_path = cls._finalize_backup(backup_path, backup_info)

            # Auto-upload to remote if configured
            cls._auto_upload(backup_path, backup_info)

            TelemetryService.emit(
                source='backup',
                event_type='backup.completed',
                message=f'Database backup completed: {db_name}',
                severity='info',
                resource_type='database',
                resource_id=db_name,
                correlation_id=correlation_id,
                payload={
                    'db_type': db_type,
                    'db_name': db_name,
                    'backup_name': backup_name,
                    'size': backup_info.get('size'),
                },
                commit=True,
            )

            return {
                'success': True,
                'backup': backup_info,
                'correlation_id': correlation_id,
            }

        TelemetryService.emit(
            source='backup',
            event_type='backup.failed',
            message=f'Database backup failed: {db_name}',
            severity='error',
            resource_type='database',
            resource_id=db_name,
            correlation_id=correlation_id,
            payload={'db_type': db_type, 'db_name': db_name, 'error': result.get('error')},
            commit=True,
        )
        return {**result, 'correlation_id': correlation_id}

    @classmethod
    def backup_files(cls, file_paths: List[str], backup_name: str = None) -> Dict:
        """Backup specific files and directories."""
        cls.ensure_backup_dirs()

        # Validate paths
        valid_paths = []
        for p in file_paths:
            if os.path.exists(p):
                valid_paths.append(p)

        if not valid_paths:
            return {'success': False, 'error': 'No valid file paths provided'}

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        if not backup_name:
            backup_name = f"files_{timestamp}"
        else:
            backup_name = f"{backup_name}_{timestamp}"

        backup_file = os.path.join(cls.BACKUP_BASE_DIR, 'files', f'{backup_name}.tar.gz')

        try:
            with tarfile.open(backup_file, 'w:gz') as tar:
                for p in valid_paths:
                    tar.add(p, arcname=os.path.basename(p))

            backup_info = {
                'name': f'{backup_name}.tar.gz',
                'path': backup_file,
                'timestamp': datetime.now().isoformat(),
                'type': cls.TYPE_FILES,
                'source_paths': valid_paths,
                'size': os.path.getsize(backup_file),
                'remote_status': 'local'
            }

            # Encrypt in place if configured (updates backup_info path/size)
            backup_file = cls._finalize_backup(backup_file, backup_info)

            # Save metadata alongside the archive (sidecar keyed off backup_name)
            meta_path = os.path.join(cls.BACKUP_BASE_DIR, 'files', f'{backup_name}.json')
            with open(meta_path, 'w') as f:
                json.dump(backup_info, f, indent=2)

            # Auto-upload to remote if configured
            cls._auto_upload(backup_file, backup_info)

            return {
                'success': True,
                'backup': backup_info,
                'path': backup_file
            }

        except Exception as e:
            if os.path.exists(backup_file):
                os.remove(backup_file)
            return {'success': False, 'error': str(e)}

    @classmethod
    def restore_application(cls, backup_path: str, restore_path: str = None) -> Dict:
        """Restore an application from backup."""
        meta_path = os.path.join(backup_path, 'backup.json')

        if not os.path.exists(meta_path):
            return {'success': False, 'error': 'Invalid backup: metadata not found'}

        tmp_decrypted = None
        try:
            with open(meta_path, 'r') as f:
                backup_info = json.load(f)

            files_backup = backup_info.get('files_backup')
            if not files_backup or not os.path.exists(files_backup):
                return {'success': False, 'error': 'Backup files not found'}

            # Decrypt to a temp file first if the archive is encrypted
            files_backup, tmp_decrypted = cls._resolve_for_restore(files_backup)

            # Determine restore path
            if not restore_path:
                restore_path = f"/var/www/{backup_info['app_name']}"

            # Backup existing if present
            if os.path.exists(restore_path):
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                backup_existing = f"{restore_path}.backup_{timestamp}"
                shutil.move(restore_path, backup_existing)

            # Extract backup (filter='data' blocks path traversal in archives)
            with tarfile.open(files_backup, 'r:gz') as tar:
                tar.extractall(os.path.dirname(restore_path), filter='data')

            return {
                'success': True,
                'message': f'Service restored to {restore_path}',
                'restore_path': restore_path
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}
        finally:
            if tmp_decrypted and os.path.exists(tmp_decrypted):
                os.remove(tmp_decrypted)

    @classmethod
    def restore_database(cls, backup_path: str, db_type: str, db_name: str,
                        user: str = None, password: str = None,
                        host: str = 'localhost') -> Dict:
        """Restore a database from backup."""
        if not os.path.exists(backup_path):
            return {'success': False, 'error': 'Backup file not found'}

        tmp_decrypted = None
        try:
            # Decrypt to a temp file first if the dump is encrypted
            backup_path, tmp_decrypted = cls._resolve_for_restore(backup_path)

            if db_type == 'mysql':
                if not is_command_available('mysql'):
                    return {'success': False, 'error': 'mysql client not installed'}
                cmd = ['mysql']
                if user:
                    cmd.extend(['-u', user])
                if password:
                    cmd.append(f"-p{password}")
                if host:
                    cmd.extend(['-h', host])
                cmd.append(db_name)

                with gzip.open(backup_path, 'rt') as f:
                    result = run_checked(cmd, stdin=f, timeout=None)

            elif db_type == 'postgresql':
                if not is_command_available('psql'):
                    return {'success': False, 'error': 'psql client not installed'}

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
                    result = run_checked(cmd, stdin=f, env=env, timeout=None)

            else:
                return {'success': False, 'error': f'Unknown database type: {db_type}'}

            if not result['success']:
                return {'success': False, 'error': result['error']}

            return {'success': True, 'message': f'Database {db_name} restored'}

        except Exception as e:
            return {'success': False, 'error': str(e)}
        finally:
            if tmp_decrypted and os.path.exists(tmp_decrypted):
                os.remove(tmp_decrypted)

    @classmethod
    def _resolve_for_restore(cls, backup_path: str):
        """Return a (usable_path, tmp_to_cleanup) pair for restore.

        If ``backup_path`` is an encrypted artifact (or a sibling ``.enc``
        exists when the plaintext is gone), decrypt it to a temp file and return
        that path plus the temp path to clean up. Otherwise the original path is
        returned with ``None`` (nothing to clean up).
        """
        enc_path = None
        if backup_crypto.is_encrypted_backup(backup_path):
            enc_path = backup_path
        elif not os.path.exists(backup_path) and os.path.exists(backup_path + backup_crypto.ENC_SUFFIX):
            enc_path = backup_path + backup_crypto.ENC_SUFFIX

        if not enc_path:
            return backup_path, None

        fd, tmp_path = tempfile.mkstemp(suffix='.restore')
        os.close(fd)
        backup_crypto.decrypt_file(enc_path, dest=tmp_path)
        return tmp_path, tmp_path

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
        elif backup_type == 'files':
            search_dirs = [os.path.join(cls.BACKUP_BASE_DIR, 'files')]
        else:
            search_dirs = [
                os.path.join(cls.BACKUP_BASE_DIR, 'applications'),
                os.path.join(cls.BACKUP_BASE_DIR, 'databases'),
                os.path.join(cls.BACKUP_BASE_DIR, 'files'),
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
                        'timestamp': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        'remote_status': 'local'
                    })
                elif item.endswith('.tar.gz') and search_dir.endswith('files'):
                    # File backup - check for metadata
                    meta_name = item.replace('.tar.gz', '.json')
                    meta_path = os.path.join(search_dir, meta_name)
                    if os.path.exists(meta_path):
                        try:
                            with open(meta_path, 'r') as f:
                                backup_info = json.load(f)
                            backup_info['path'] = item_path
                            backups.append(backup_info)
                        except Exception:
                            pass
                    else:
                        stat = os.stat(item_path)
                        backups.append({
                            'name': item,
                            'path': item_path,
                            'type': cls.TYPE_FILES,
                            'size': stat.st_size,
                            'timestamp': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                            'remote_status': 'local'
                        })

        # Sort by timestamp (newest first)
        backups.sort(key=lambda x: x.get('timestamp', ''), reverse=True)

        return backups

    @classmethod
    def delete_backup(cls, backup_path: str) -> Dict:
        """Delete a backup."""
        backup_path = os.path.realpath(backup_path)
        if not backup_path.startswith(os.path.realpath(cls.BACKUP_BASE_DIR)):
            return {'success': False, 'error': 'Invalid backup path'}

        try:
            if os.path.isdir(backup_path):
                shutil.rmtree(backup_path)
            elif os.path.exists(backup_path):
                os.remove(backup_path)
                # Also remove metadata file for file backups
                if backup_path.endswith('.tar.gz'):
                    meta_path = backup_path.replace('.tar.gz', '.json')
                    if os.path.exists(meta_path):
                        os.remove(meta_path)
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
                    schedule_time: str, days: List[str] = None,
                    upload_remote: bool = False) -> Dict:
        """Add a backup schedule."""
        config = cls.get_config()

        schedule_entry = {
            'id': uuid.uuid4().hex[:12],
            'name': name,
            'backup_type': backup_type,
            'target': target,
            'schedule_time': schedule_time,
            'days': ['daily'] if days is None else days,
            'enabled': True,
            'upload_remote': upload_remote,
            'last_run': None,
            'last_status': None
        }

        try:
            backup_schedule_service.validate_schedule(schedule_entry)
        except ValueError as exc:
            return {'success': False, 'error': str(exc)}
        config.setdefault('schedules', []).append(schedule_entry)
        result = cls.save_config(config)

        if result.get('success'):
            return {'success': True, 'schedule': backup_schedule_service.describe_schedule(
                schedule_entry, globally_enabled=config.get('enabled', False))}
        return result

    @classmethod
    def update_schedule(cls, schedule_id: str, updates: Dict) -> Dict:
        """Update a backup schedule."""
        config = cls.get_config()
        schedules = config.get('schedules', [])

        for i, s in enumerate(schedules):
            if s.get('id') == schedule_id:
                allowed_fields = ['name', 'backup_type', 'target', 'schedule_time',
                                  'days', 'enabled', 'upload_remote']
                updated = {**s, **{field: updates[field] for field in allowed_fields if field in updates}}
                try:
                    backup_schedule_service.validate_schedule(updated)
                except ValueError as exc:
                    return {'success': False, 'error': str(exc)}
                schedules[i] = updated
                config['schedules'] = schedules
                return cls.save_config(config)

        return {'success': False, 'error': 'Schedule not found'}

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
        zone = backup_schedule_service.server_timezone()
        now = datetime.now(timezone.utc)
        return [backup_schedule_service.describe_schedule(
            entry, globally_enabled=config.get('enabled', False), now=now, zone=zone,
        ) for entry in config.get('schedules', [])]

    @classmethod
    def get_backup_stats(cls) -> Dict:
        """Get backup statistics."""
        backups = cls.list_backups()

        total_size = sum(b.get('size', 0) for b in backups)
        app_backups = [b for b in backups if b.get('type') == cls.TYPE_APP]
        db_backups = [b for b in backups if b.get('type') == cls.TYPE_DATABASE]
        file_backups = [b for b in backups if b.get('type') == cls.TYPE_FILES]

        # Get remote stats
        remote_stats = {'remote_count': 0, 'remote_size': 0, 'remote_size_human': '0 B'}
        try:
            from app.services.storage_provider_service import StorageProviderService
            storage_config = StorageProviderService.get_config()
            if storage_config.get('provider', 'local') != 'local':
                remote_stats = StorageProviderService.get_remote_stats()
        except Exception:
            pass

        return {
            'total_backups': len(backups),
            'application_backups': len(app_backups),
            'database_backups': len(db_backups),
            'file_backups': len(file_backups),
            'total_size': total_size,
            'total_size_human': cls._format_size(total_size),
            'remote_count': remote_stats.get('remote_count', 0),
            'remote_size': remote_stats.get('remote_size', 0),
            'remote_size_human': remote_stats.get('remote_size_human', '0 B')
        }

    @classmethod
    def _finalize_backup(cls, path: str, backup_info: Dict) -> str:
        """Encrypt the backup artifact in place when configured.

        When ``encrypt_backups`` is enabled in config and an encryption key is
        available, the artifact at ``path`` is Fernet-encrypted (the plaintext
        is removed) and ``backup_info`` is updated to point at the encrypted
        file. Returns the (possibly new) path so callers can hand it to
        :meth:`_auto_upload`. A no-op (returns ``path`` unchanged) when
        encryption is disabled or unavailable.
        """
        if cls.get_config().get('encrypt_backups') and backup_crypto.encryption_available():
            enc_path = backup_crypto.encrypt_file(path)
            backup_info['encrypted'] = True
            backup_info['path'] = enc_path
            if 'size' in backup_info:
                backup_info['size'] = os.path.getsize(enc_path)
            return enc_path

        backup_info['encrypted'] = False
        return path

    @classmethod
    def _auto_upload(cls, backup_path: str, backup_info: Dict) -> None:
        """Auto-upload backup to remote storage if configured."""
        try:
            from app.services.storage_provider_service import StorageProviderService
            storage_config = StorageProviderService.get_config()

            if storage_config.get('provider', 'local') == 'local':
                return
            if not storage_config.get('auto_upload', False):
                return

            if os.path.isdir(backup_path):
                result = StorageProviderService.upload_directory(backup_path)
            else:
                result = StorageProviderService.upload_file(backup_path)

            if result.get('success'):
                backup_info['remote_status'] = 'synced'
                backup_info['remote_key'] = result.get('remote_key', '')
                # Update metadata if it's a directory backup
                meta_path = os.path.join(backup_path, 'backup.json') if os.path.isdir(backup_path) else None
                if meta_path and os.path.exists(meta_path):
                    with open(meta_path, 'w') as f:
                        json.dump(backup_info, f, indent=2)
        except Exception:
            pass

    # --- Smart backups (incremental + compression tiering) ---

    @classmethod
    def _compression_program(cls, compression):
        """Return ``(tar --use-compress-program value, file extension)`` for a
        compression tier. zstd is preferred for balanced/max; gzip is the
        fallback when the zstd binary is missing."""
        have_zstd = is_command_available('zstd')
        if compression == 'fast':
            return ('gzip', 'gz')
        if compression == 'max':
            return ('zstd -19 -T0', 'zst') if have_zstd else ('gzip -9', 'gz')
        # balanced (default)
        return ('zstd -3 -T0', 'zst') if have_zstd else ('gzip', 'gz')

    @classmethod
    def smart_backup_files(cls, source_path, dest_dir, kind, compression, snar_path):
        """Create a (full|incremental) compressed tar of ``source_path`` into
        ``dest_dir``.

        Uses GNU ``tar --listed-incremental`` (level-0 for full, level-1+ for
        incremental, sharing one ``.snar`` per policy). A full run resets the
        ``.snar`` so the chain starts fresh. Falls back to a full Python
        ``tarfile`` gzip archive when ``tar`` is unavailable (e.g. Windows dev),
        which means incremental degrades gracefully to full.

        Returns a dict: archive, size, compression, kind, incremental, ext.
        """
        os.makedirs(dest_dir, exist_ok=True)

        if not (os.name == 'posix' and is_command_available('tar')):
            archive = os.path.join(dest_dir, 'files.tar.gz')
            with tarfile.open(archive, 'w:gz') as tar:
                tar.add(source_path, arcname=os.path.basename(source_path))
            return {'archive': archive, 'size': os.path.getsize(archive),
                    'compression': 'gzip', 'kind': 'full', 'incremental': False, 'ext': 'gz'}

        program, ext = cls._compression_program(compression)
        archive = os.path.join(dest_dir, f'files.tar.{ext}')

        # A full backup resets the incremental chain.
        if kind == 'full' and os.path.exists(snar_path):
            try:
                os.remove(snar_path)
            except OSError:
                pass

        os.makedirs(os.path.dirname(snar_path), exist_ok=True)
        cmd = ['tar']
        if program:
            cmd.append(f'--use-compress-program={program}')
        cmd.append(f'--listed-incremental={snar_path}')
        cmd += ['-cf', archive, '-C', os.path.dirname(source_path) or '/', os.path.basename(source_path)]

        result = run_checked(cmd, timeout=1800)
        if not result['success']:
            raise RuntimeError(f"tar failed: {result['error'][:300]}")
        return {'archive': archive, 'size': os.path.getsize(archive),
                'compression': program, 'kind': kind, 'incremental': kind == 'incremental', 'ext': ext}

    @classmethod
    def restore_incremental_chain(cls, archives, restore_path):
        """Restore an ordered list of incremental tar archives (full first) into
        ``restore_path`` using ``tar --listed-incremental``. Each archive is
        extracted in sequence, reconstructing the point-in-time state of the last
        archive (including files deleted between increments)."""
        if not archives:
            raise RuntimeError('No archives to restore')
        os.makedirs(restore_path, exist_ok=True)
        parent = os.path.dirname(restore_path.rstrip('/')) or '/'
        for archive in archives:
            if not os.path.exists(archive):
                raise RuntimeError(f'Backup archive missing: {archive}')
            cmd = ['tar', '--listed-incremental=/dev/null', '-xf', archive, '-C', parent]
            result = run_checked(cmd, timeout=1800)
            if not result['success']:
                raise RuntimeError(f"tar restore failed: {result['error'][:300]}")
        return {'success': True, 'restore_path': restore_path}

    # --- Scheduler (unified job system) ---

    @classmethod
    def register_jobs(cls):
        """Register the backup.run handler with the unified job registry. Called
        once at app startup (see app/__init__.py)."""
        from app.jobs import registry
        registry.register(BACKUP_JOB_KIND, cls.run_backup_job, replace=True)

    @classmethod
    def check_backup_schedules(cls) -> None:
        """Enqueue a backup.run job for each schedule that is due now.

        Runs on the unified job scheduler (builtin.backup_scheduler) instead of a
        dedicated daemon thread. Gated by the existing backup config, so it stays
        inert unless backups are configured + enabled.
        """
        from app.jobs.service import JobService
        config = cls.get_config()
        if not config.get('enabled', False):
            return

        zone = backup_schedule_service.server_timezone()
        now = datetime.now(timezone.utc).astimezone(zone)
        current_time = now.strftime('%H:%M')
        dirty = False

        for sched in config.get('schedules', []):
            due = backup_schedule_service.next_run(sched, now=now, zone=zone)
            if due is None or due.astimezone(timezone.utc) > now.astimezone(timezone.utc):
                continue

            JobService.enqueue(
                BACKUP_JOB_KIND,
                payload={'schedule_id': sched.get('id')},
                max_attempts=1,  # backups aren't idempotent — no auto-retry
                owner_type='backup_schedule',
                owner_id=sched.get('id'),
            )
            # Optimistic dedup so the next tick in the same minute doesn't
            # double-enqueue; the run itself rewrites last_run/last_status.
            sched['last_run'] = now.isoformat()
            dirty = True

        if dirty:
            cls.save_config(config)

        if current_time == '00:00':
            cls.cleanup_old_backups()

    @staticmethod
    def run_backup_job(job):
        """Unified-job handler for ``backup.run`` — execute one scheduled backup.
        Raises if the backup failed so the unified job is marked failed too (the
        schedule's last_status carries the detail)."""
        schedule_id = (job.get_payload() or {}).get('schedule_id')
        config = BackupService.get_config()
        sched = next((s for s in config.get('schedules', []) if s.get('id') == schedule_id), None)
        if not sched:
            raise ValueError(f'backup schedule {schedule_id!r} not found')

        BackupService._run_scheduled_backup(sched)

        updated = next(
            (s for s in BackupService.get_config().get('schedules', []) if s.get('id') == schedule_id),
            None,
        )
        if updated and updated.get('last_status') == 'failed':
            raise RuntimeError(f"Backup '{sched.get('name', schedule_id)}' failed")
        return {'schedule_id': schedule_id, 'name': sched.get('name'),
                'status': updated.get('last_status') if updated else None}

    @classmethod
    def _run_scheduled_backup(cls, sched: Dict) -> None:
        """Execute a single scheduled backup."""
        backup_type = sched.get('backup_type', 'database')
        target = sched.get('target', '')
        result = None
        correlation_id = generate_correlation_id()

        TelemetryService.emit(
            source='backup',
            event_type='backup.scheduled_started',
            message=f'Scheduled backup started: {sched.get("name", "Backup")}',
            severity='info',
            resource_type='backup_schedule',
            resource_id=sched.get('id'),
            correlation_id=correlation_id,
            payload={'schedule_name': sched.get('name'), 'backup_type': backup_type, 'target': target},
            commit=True,
        )

        try:
            if backup_type == 'database':
                # Parse target as db_type:db_name or just db_name
                parts = target.split(':')
                if len(parts) == 2:
                    db_type, db_name = parts
                else:
                    db_type, db_name = 'mysql', target
                result = cls.backup_database(db_type, db_name, correlation_id=correlation_id)

            elif backup_type == 'application':
                from app.models import Application
                # Name-keyed and fires every 30s: a tombstone sharing the name
                # would shadow the live app and the wrong one gets backed up.
                app = Application.query_active().filter_by(name=target).first()
                if app:
                    result = cls.backup_application(app.name, app.root_path, correlation_id=correlation_id)
                else:
                    result = {'success': False, 'error': f'Service "{target}" not found'}

            elif backup_type == 'files':
                paths_list = [p.strip() for p in target.split(',') if p.strip()]
                result = cls.backup_files(paths_list, backup_name=f"scheduled_{sched.get('name', 'backup')}")

            # Upload to remote if configured on this schedule
            if result and result.get('success') and sched.get('upload_remote', False):
                try:
                    from app.services.storage_provider_service import StorageProviderService
                    backup_path = result.get('path') or result.get('backup', {}).get('path')
                    if backup_path:
                        if os.path.isdir(backup_path):
                            StorageProviderService.upload_directory(backup_path)
                        else:
                            StorageProviderService.upload_file(backup_path)
                except Exception:
                    pass

            # Update schedule status
            config = cls.get_config()
            for s in config.get('schedules', []):
                if s.get('id') == sched.get('id'):
                    s['last_run'] = datetime.now(timezone.utc).isoformat()
                    s['last_status'] = 'success' if result and result.get('success') else 'failed'
                    break
            cls.save_config(config)

            # Send notification on failure
            if result and not result.get('success'):
                cls._send_backup_notification(
                    sched.get('name', 'Backup'),
                    False,
                    result.get('error', 'Unknown error'),
                    correlation_id=correlation_id,
                )

        except Exception as e:
            # Update schedule status on exception
            config = cls.get_config()
            for s in config.get('schedules', []):
                if s.get('id') == sched.get('id'):
                    s['last_run'] = datetime.now(timezone.utc).isoformat()
                    s['last_status'] = 'failed'
                    break
            cls.save_config(config)
            cls._send_backup_notification(sched.get('name', 'Backup'), False, str(e), correlation_id=correlation_id)

    @classmethod
    def _send_backup_notification(cls, backup_name: str, success: bool, message: str,
                                  correlation_id: str = None) -> None:
        """Send a notification about backup status and emit telemetry."""
        TelemetryService.emit(
            source='backup',
            event_type='backup.completed' if success else 'backup.failed',
            message=f'Backup {backup_name} {"completed" if success else "failed"}',
            severity='info' if success else 'critical',
            resource_type='backup_schedule',
            correlation_id=correlation_id,
            payload={'backup_name': backup_name, 'success': success, 'message': message},
            commit=True,
        )

        try:
            from app.services.notification_service import NotificationService
            config = cls.get_config()
            notifications = config.get('notifications', {})

            if success and not notifications.get('on_success', False):
                return
            if not success and not notifications.get('on_failure', True):
                return

            severity = 'success' if success else 'critical'
            status = 'completed successfully' if success else 'failed'
            # send_all takes a list of alert dicts (it fans out to the configured
            # system channels through the queue-backed Notification Bus).
            NotificationService.send_all([{
                'type': 'backup',
                'severity': 'critical' if not success else 'info',
                'message': f'Backup {status}: {backup_name}' + (f' — {message}' if message else ''),
            }])
        except Exception:
            pass

    @staticmethod
    def _format_size(size: int) -> str:
        """Format size in human readable format."""
        return format_bytes(size, suffix_sep=' ')
