"""
Database Sync Service

Service for database cloning, transformation, and synchronization operations.
Supports WordPress-specific features like URL search-replace and data anonymization.
"""

import os
import subprocess
import gzip
import shutil
import json
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from pathlib import Path


class DatabaseSyncService:
    """Service for database cloning, transformation, and sync operations."""

    SNAPSHOT_DIR = '/var/backups/serverkit/snapshots'
    TEMP_DIR = '/tmp/serverkit_db_sync'

    @classmethod
    def _ensure_dirs(cls):
        """Ensure required directories exist."""
        for dir_path in [cls.SNAPSHOT_DIR, cls.TEMP_DIR]:
            os.makedirs(dir_path, exist_ok=True)

    @classmethod
    def _run_mysql(cls, command: str, database: str = None, host: str = 'localhost',
                   user: str = 'root', password: str = None) -> Dict:
        """Execute a MySQL command."""
        try:
            cmd = ['mysql', '-h', host, '-u', user]
            if password:
                cmd.append(f'-p{password}')
            if database:
                cmd.extend(['-D', database])
            cmd.extend(['-e', command])

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )

            return {
                'success': result.returncode == 0,
                'output': result.stdout,
                'error': result.stderr if result.returncode != 0 else None
            }
        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Command timed out'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def create_snapshot(cls, db_name: str, name: str = None, tag: str = None,
                        commit_sha: str = None, host: str = 'localhost',
                        user: str = 'root', password: str = None,
                        compress: bool = True, exclude_tables: List[str] = None) -> Dict:
        """
        Create a point-in-time database snapshot.

        Args:
            db_name: Database name to snapshot
            name: Human-readable snapshot name
            tag: Optional tag (e.g., 'pre-deploy', 'v1.2.0')
            commit_sha: Git commit SHA at snapshot time
            host: MySQL host
            user: MySQL user
            password: MySQL password
            compress: Whether to gzip the dump
            exclude_tables: List of tables to exclude

        Returns:
            Dict with success status and snapshot info
        """
        cls._ensure_dirs()

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        snapshot_name = name or f'{db_name}_{timestamp}'
        safe_name = re.sub(r'[^a-zA-Z0-9_-]', '_', snapshot_name)

        file_name = f'{safe_name}.sql'
        if compress:
            file_name += '.gz'

        file_path = os.path.join(cls.SNAPSHOT_DIR, file_name)

        try:
            # Build mysqldump command
            cmd = ['mysqldump', '-h', host, '-u', user]
            if password:
                cmd.append(f'-p{password}')

            # Add options for consistent snapshot
            cmd.extend([
                '--single-transaction',
                '--routines',
                '--triggers',
                '--add-drop-table',
            ])

            # Exclude tables if specified
            if exclude_tables:
                for table in exclude_tables:
                    cmd.extend(['--ignore-table', f'{db_name}.{table}'])

            cmd.append(db_name)

            # Execute dump
            if compress:
                # Pipe through gzip
                dump_process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                with gzip.open(file_path, 'wb') as f:
                    while True:
                        chunk = dump_process.stdout.read(8192)
                        if not chunk:
                            break
                        f.write(chunk)

                dump_process.wait()
                if dump_process.returncode != 0:
                    error = dump_process.stderr.read().decode()
                    return {'success': False, 'error': f'mysqldump failed: {error}'}
            else:
                with open(file_path, 'w') as f:
                    result = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, text=True)
                    if result.returncode != 0:
                        return {'success': False, 'error': f'mysqldump failed: {result.stderr}'}

            # Get file size
            size_bytes = os.path.getsize(file_path)

            # Get table list and row count
            tables_result = cls._run_mysql(
                f"SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.tables WHERE TABLE_SCHEMA = '{db_name}'",
                host=host, user=user, password=password
            )

            tables = []
            total_rows = 0
            if tables_result['success']:
                for line in tables_result['output'].strip().split('\n')[1:]:
                    parts = line.split('\t')
                    if len(parts) >= 2:
                        tables.append(parts[0])
                        try:
                            total_rows += int(parts[1]) if parts[1] != 'NULL' else 0
                        except ValueError:
                            pass

            return {
                'success': True,
                'snapshot': {
                    'name': snapshot_name,
                    'tag': tag,
                    'file_path': file_path,
                    'size_bytes': size_bytes,
                    'compressed': compress,
                    'commit_sha': commit_sha,
                    'tables': tables,
                    'row_count': total_rows,
                    'created_at': datetime.now().isoformat()
                }
            }

        except Exception as e:
            # Cleanup on failure
            if os.path.exists(file_path):
                os.remove(file_path)
            return {'success': False, 'error': str(e)}

    @classmethod
    def restore_snapshot(cls, file_path: str, target_db: str,
                         host: str = 'localhost', user: str = 'root',
                         password: str = None, create_db: bool = True) -> Dict:
        """
        Restore a database snapshot.

        Args:
            file_path: Path to snapshot file (.sql or .sql.gz)
            target_db: Target database name
            host: MySQL host
            user: MySQL user
            password: MySQL password
            create_db: Create database if it doesn't exist

        Returns:
            Dict with success status
        """
        if not os.path.exists(file_path):
            return {'success': False, 'error': f'Snapshot file not found: {file_path}'}

        try:
            # Create database if needed
            if create_db:
                create_result = cls._run_mysql(
                    f"CREATE DATABASE IF NOT EXISTS `{target_db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
                    host=host, user=user, password=password
                )
                if not create_result['success']:
                    return create_result

            # Build mysql import command
            cmd = ['mysql', '-h', host, '-u', user]
            if password:
                cmd.append(f'-p{password}')
            cmd.append(target_db)

            # Handle compressed files
            if file_path.endswith('.gz'):
                with gzip.open(file_path, 'rb') as f:
                    result = subprocess.run(
                        cmd,
                        stdin=f,
                        capture_output=True,
                        timeout=1800  # 30 min timeout for large DBs
                    )
            else:
                with open(file_path, 'r') as f:
                    result = subprocess.run(
                        cmd,
                        stdin=f,
                        capture_output=True,
                        timeout=1800
                    )

            if result.returncode != 0:
                return {'success': False, 'error': result.stderr.decode() if result.stderr else 'Import failed'}

            return {'success': True, 'message': f'Snapshot restored to {target_db}'}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Restore timed out (>30 minutes)'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def clone_database(cls, source_db: str, target_db: str,
                       source_host: str = 'localhost', target_host: str = 'localhost',
                       source_user: str = 'root', target_user: str = 'root',
                       source_password: str = None, target_password: str = None,
                       options: Dict = None) -> Dict:
        """
        Clone a database with optional transformations.

        Args:
            source_db: Source database name
            target_db: Target database name
            source_host/target_host: MySQL hosts
            source_user/target_user: MySQL users
            source_password/target_password: MySQL passwords
            options: Dict with transformation options:
                - search_replace: Dict of {search: replace} for URL/string replacement
                - table_prefix: New table prefix (e.g., 'wp_dev_')
                - anonymize: Bool - anonymize user data
                - exclude_tables: List of tables to skip
                - truncate_tables: List of tables to empty (keep structure)

        Returns:
            Dict with success status and clone info
        """
        options = options or {}
        cls._ensure_dirs()

        try:
            # Step 1: Create snapshot of source
            snapshot_result = cls.create_snapshot(
                db_name=source_db,
                name=f'clone_{source_db}_to_{target_db}',
                host=source_host,
                user=source_user,
                password=source_password,
                compress=False,  # Don't compress for transformation
                exclude_tables=options.get('exclude_tables', [])
            )

            if not snapshot_result['success']:
                return snapshot_result

            dump_file = snapshot_result['snapshot']['file_path']
            transformed_file = dump_file.replace('.sql', '_transformed.sql')

            try:
                # Step 2: Transform the dump if needed
                needs_transform = any([
                    options.get('search_replace'),
                    options.get('table_prefix'),
                    options.get('anonymize'),
                    options.get('truncate_tables')
                ])

                if needs_transform:
                    transform_result = cls._transform_dump(
                        dump_file,
                        transformed_file,
                        options
                    )
                    if not transform_result['success']:
                        return transform_result
                    import_file = transformed_file
                else:
                    import_file = dump_file

                # Step 3: Drop and recreate target database
                cls._run_mysql(
                    f"DROP DATABASE IF EXISTS `{target_db}`",
                    host=target_host, user=target_user, password=target_password
                )

                # Step 4: Restore to target
                restore_result = cls.restore_snapshot(
                    file_path=import_file,
                    target_db=target_db,
                    host=target_host,
                    user=target_user,
                    password=target_password,
                    create_db=True
                )

                if not restore_result['success']:
                    return restore_result

                return {
                    'success': True,
                    'message': f'Database cloned from {source_db} to {target_db}',
                    'transformations_applied': list(options.keys()) if needs_transform else []
                }

            finally:
                # Cleanup temp files
                for f in [dump_file, transformed_file]:
                    if os.path.exists(f):
                        os.remove(f)

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _transform_dump(cls, input_file: str, output_file: str, options: Dict) -> Dict:
        """
        Transform a SQL dump file with search-replace and other modifications.

        This handles WordPress serialized data properly using PHP-style serialization.
        """
        search_replace = options.get('search_replace', {})
        new_prefix = options.get('table_prefix')
        anonymize = options.get('anonymize', False)
        truncate_tables = options.get('truncate_tables', [])

        try:
            with open(input_file, 'r', encoding='utf-8', errors='replace') as infile:
                with open(output_file, 'w', encoding='utf-8') as outfile:
                    current_table = None

                    for line in infile:
                        # Track current table for truncation
                        if line.startswith('INSERT INTO'):
                            match = re.search(r'INSERT INTO `?(\w+)`?', line)
                            if match:
                                current_table = match.group(1)

                        # Skip inserts for truncated tables
                        if current_table and truncate_tables:
                            table_name = current_table
                            if new_prefix:
                                # Check both old and new prefix versions
                                for prefix in ['wp_', new_prefix]:
                                    for t in truncate_tables:
                                        if table_name == f'{prefix}{t}' or table_name == t:
                                            # Skip this INSERT
                                            if line.startswith('INSERT INTO'):
                                                continue

                        # Table prefix replacement
                        if new_prefix and 'wp_' in line:
                            # Replace table references
                            line = re.sub(r'`wp_(\w+)`', f'`{new_prefix}\\1`', line)
                            # Replace in CREATE TABLE
                            line = line.replace('CREATE TABLE `wp_', f'CREATE TABLE `{new_prefix}')
                            # Replace in INSERT INTO
                            line = line.replace('INSERT INTO `wp_', f'INSERT INTO `{new_prefix}')

                        # Search and replace (handles serialized data)
                        for search, replace in search_replace.items():
                            line = cls._safe_search_replace(line, search, replace)

                        # Anonymize user data
                        if anonymize and 'user_email' in line.lower():
                            line = cls._anonymize_line(line)

                        outfile.write(line)

            return {'success': True}

        except Exception as e:
            return {'success': False, 'error': f'Transform failed: {str(e)}'}

    @classmethod
    def _safe_search_replace(cls, text: str, search: str, replace: str) -> str:
        """
        Perform search-replace that handles WordPress serialized data.

        WordPress stores serialized PHP arrays in the database with string length prefixes.
        e.g., s:23:"http://example.com/path";

        When replacing URLs, we need to update these length prefixes.
        """
        # Simple replacement first
        if search not in text:
            return text

        # Handle serialized string format: s:LENGTH:"VALUE";
        def replace_serialized(match):
            original = match.group(2)
            new_value = original.replace(search, replace)
            new_length = len(new_value.encode('utf-8'))
            return f's:{new_length}:"{new_value}"'

        # Pattern for serialized strings that contain the search term
        pattern = r's:(\d+):"([^"]*' + re.escape(search) + r'[^"]*)"'
        text = re.sub(pattern, replace_serialized, text)

        # Also do plain replacement for non-serialized occurrences
        text = text.replace(search, replace)

        return text

    @classmethod
    def _anonymize_line(cls, line: str) -> str:
        """Anonymize user data in a SQL line."""
        # Replace email addresses
        line = re.sub(
            r"'([^']+@[^']+)'",
            lambda m: f"'user{hash(m.group(1)) % 10000}@example.com'",
            line
        )
        return line

    @classmethod
    def run_search_replace(cls, db_name: str, search: str, replace: str,
                           table_prefix: str = 'wp_', host: str = 'localhost',
                           user: str = 'root', password: str = None,
                           dry_run: bool = False) -> Dict:
        """
        Run WordPress-aware search-replace on a database.

        This is a pure SQL approach without requiring WP-CLI.
        For better serialized data handling, use WP-CLI if available.

        Args:
            db_name: Database name
            search: String to search for
            replace: String to replace with
            table_prefix: WordPress table prefix
            host: MySQL host
            user: MySQL user
            password: MySQL password
            dry_run: Only count replacements, don't apply

        Returns:
            Dict with success status and replacement count
        """
        try:
            # Get list of tables
            tables_result = cls._run_mysql(
                f"SHOW TABLES LIKE '{table_prefix}%'",
                database=db_name, host=host, user=user, password=password
            )

            if not tables_result['success']:
                return tables_result

            tables = [line.strip() for line in tables_result['output'].strip().split('\n')[1:] if line.strip()]
            total_replacements = 0

            for table in tables:
                # Get columns
                cols_result = cls._run_mysql(
                    f"SHOW COLUMNS FROM `{table}`",
                    database=db_name, host=host, user=user, password=password
                )

                if not cols_result['success']:
                    continue

                # Find text/varchar columns
                text_columns = []
                for line in cols_result['output'].strip().split('\n')[1:]:
                    parts = line.split('\t')
                    if len(parts) >= 2:
                        col_name = parts[0]
                        col_type = parts[1].lower()
                        if any(t in col_type for t in ['varchar', 'text', 'longtext', 'mediumtext']):
                            text_columns.append(col_name)

                # Count or replace in each column
                for col in text_columns:
                    if dry_run:
                        count_query = f"SELECT COUNT(*) FROM `{table}` WHERE `{col}` LIKE '%{search}%'"
                        count_result = cls._run_mysql(
                            count_query,
                            database=db_name, host=host, user=user, password=password
                        )
                        if count_result['success']:
                            try:
                                count = int(count_result['output'].strip().split('\n')[1])
                                total_replacements += count
                            except (IndexError, ValueError):
                                pass
                    else:
                        # Note: This is basic replacement, doesn't handle serialized data perfectly
                        update_query = f"UPDATE `{table}` SET `{col}` = REPLACE(`{col}`, '{search}', '{replace}') WHERE `{col}` LIKE '%{search}%'"
                        cls._run_mysql(
                            update_query,
                            database=db_name, host=host, user=user, password=password
                        )

            return {
                'success': True,
                'dry_run': dry_run,
                'replacements': total_replacements if dry_run else 'Applied to all matching rows',
                'tables_processed': len(tables)
            }

        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_snapshot(cls, file_path: str) -> Dict:
        """Delete a snapshot file."""
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                return {'success': True, 'message': 'Snapshot deleted'}
            return {'success': False, 'error': 'Snapshot file not found'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_snapshots(cls, site_name: str = None) -> List[Dict]:
        """List available snapshots."""
        cls._ensure_dirs()
        snapshots = []

        try:
            for filename in os.listdir(cls.SNAPSHOT_DIR):
                if not filename.endswith(('.sql', '.sql.gz')):
                    continue

                if site_name and not filename.startswith(site_name):
                    continue

                file_path = os.path.join(cls.SNAPSHOT_DIR, filename)
                stat = os.stat(file_path)

                snapshots.append({
                    'name': filename.replace('.sql.gz', '').replace('.sql', ''),
                    'file_path': file_path,
                    'size_bytes': stat.st_size,
                    'compressed': filename.endswith('.gz'),
                    'created_at': datetime.fromtimestamp(stat.st_mtime).isoformat()
                })

            return sorted(snapshots, key=lambda x: x['created_at'], reverse=True)

        except Exception:
            return []

    @classmethod
    def cleanup_old_snapshots(cls, days: int = 30, keep_tagged: bool = True) -> Dict:
        """
        Clean up snapshots older than specified days.

        Args:
            days: Delete snapshots older than this many days
            keep_tagged: Keep snapshots with tags (like 'v1.0.0')

        Returns:
            Dict with deleted count
        """
        cls._ensure_dirs()
        cutoff = datetime.now() - timedelta(days=days)
        deleted = 0

        try:
            for filename in os.listdir(cls.SNAPSHOT_DIR):
                file_path = os.path.join(cls.SNAPSHOT_DIR, filename)
                stat = os.stat(file_path)
                file_time = datetime.fromtimestamp(stat.st_mtime)

                if file_time < cutoff:
                    # TODO: Check if tagged in database before deleting
                    os.remove(file_path)
                    deleted += 1

            return {'success': True, 'deleted': deleted}

        except Exception as e:
            return {'success': False, 'error': str(e), 'deleted': deleted}
