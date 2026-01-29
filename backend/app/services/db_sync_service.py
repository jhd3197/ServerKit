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

from app import paths


class DatabaseSyncService:
    """Service for database cloning, transformation, and sync operations."""

    SNAPSHOT_DIR = paths.SNAPSHOT_DIR
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
        anonymize_names = options.get('anonymize_names', False)
        reset_passwords = options.get('reset_passwords', False)
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

                        # Anonymize user data (enhanced with name and password support)
                        if anonymize and ('user_email' in line.lower() or 'user_pass' in line.lower()
                                          or 'display_name' in line.lower() or 'first_name' in line.lower()
                                          or 'last_name' in line.lower() or 'nickname' in line.lower()):
                            line = cls._anonymize_line(
                                line,
                                anonymize_names=anonymize_names,
                                reset_passwords=reset_passwords
                            )

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
    def _anonymize_line(cls, line: str, anonymize_names: bool = False,
                        reset_passwords: bool = False) -> str:
        """Anonymize user data in a SQL line.

        Args:
            line: SQL line to anonymize
            anonymize_names: Also anonymize display_name, first_name, last_name
            reset_passwords: Replace password hashes with a known hash
        """
        # Replace email addresses
        line = re.sub(
            r"'([^']+@[^']+)'",
            lambda m: f"'user{hash(m.group(1)) % 10000}@example.com'",
            line
        )

        # Anonymize display names in user meta
        if anonymize_names and ('display_name' in line.lower() or 'first_name' in line.lower()
                                or 'last_name' in line.lower() or 'nickname' in line.lower()):
            line = re.sub(
                r"('(?:first_name|last_name|nickname|display_name)'\s*,\s*')([^']+)(')",
                lambda m: f"{m.group(1)}User {hash(m.group(2)) % 10000}{m.group(3)}",
                line
            )

        # Reset passwords to a known hash (password: 'changeme')
        if reset_passwords and 'user_pass' in line.lower():
            line = re.sub(
                r"\$P\$[A-Za-z0-9./]{31}",
                "$P$BchangemeHASHEDplaceholder00000",
                line
            )

        return line

    @classmethod
    def apply_sanitization_profile(cls, profile_config: dict) -> dict:
        """Convert a sanitization profile config into db clone/sync options.

        Args:
            profile_config: Dict from SanitizationProfile.get_config()

        Returns:
            Dict of options suitable for clone_database/clone_between_containers
        """
        options = {}

        if profile_config.get('anonymize_emails') or profile_config.get('anonymize_names'):
            options['anonymize'] = True
            options['anonymize_names'] = profile_config.get('anonymize_names', False)
            options['reset_passwords'] = profile_config.get('reset_passwords', False)

        if profile_config.get('truncate_tables'):
            options['truncate_tables'] = list(profile_config['truncate_tables'])

        if profile_config.get('exclude_tables'):
            options['exclude_tables'] = list(profile_config['exclude_tables'])

        if profile_config.get('custom_search_replace'):
            options['search_replace'] = dict(profile_config['custom_search_replace'])

        # WooCommerce payment data stripping - add payment tables to truncate list
        if profile_config.get('strip_payment_data'):
            wc_payment_tables = [
                'wc_order_payment_lookup',
                'woocommerce_payment_tokens',
                'woocommerce_payment_tokenmeta',
            ]
            existing_truncate = options.get('truncate_tables', [])
            for table in wc_payment_tables:
                if table not in existing_truncate:
                    existing_truncate.append(table)
            options['truncate_tables'] = existing_truncate

        if profile_config.get('remove_transients'):
            options['remove_transients'] = True

        return options

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

    # ==================== CONTAINER-TO-CONTAINER OPERATIONS ====================

    @classmethod
    def export_from_container(cls, compose_path: str, db_name: str,
                               db_user: str = 'root', db_password: str = None,
                               output_path: str = None, compress: bool = True,
                               exclude_tables: List[str] = None) -> Dict:
        """
        Export a database from a Docker container's MySQL instance.

        Uses docker compose exec to run mysqldump inside the container.

        Args:
            compose_path: Path to the environment's docker-compose.yml
            db_name: Database name to export
            db_user: MySQL user
            db_password: MySQL password
            output_path: Where to save the dump (auto-generated if None)
            compress: Whether to gzip the output
            exclude_tables: Tables to exclude from the dump

        Returns:
            Dict with success status, file_path, and size_bytes
        """
        cls._ensure_dirs()

        if not os.path.exists(compose_path):
            return {'success': False, 'error': f'Compose file not found: {compose_path}'}

        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        if not output_path:
            output_path = os.path.join(cls.SNAPSHOT_DIR, f'{db_name}_{timestamp}.sql')
            if compress:
                output_path += '.gz'

        try:
            # Build mysqldump command to run inside container
            dump_cmd = ['mysqldump', '-u', db_user]
            if db_password:
                dump_cmd.append(f'-p{db_password}')
            dump_cmd.extend([
                '--single-transaction',
                '--routines',
                '--triggers',
                '--add-drop-table',
            ])

            if exclude_tables:
                for table in exclude_tables:
                    dump_cmd.extend(['--ignore-table', f'{db_name}.{table}'])

            dump_cmd.append(db_name)

            # Run via docker compose exec
            full_cmd = ['docker', 'compose', '-f', compose_path, 'exec', '-T', 'db'] + dump_cmd

            if compress:
                process = subprocess.Popen(
                    full_cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE
                )
                with gzip.open(output_path, 'wb') as f:
                    while True:
                        chunk = process.stdout.read(8192)
                        if not chunk:
                            break
                        f.write(chunk)
                process.wait()
                if process.returncode != 0:
                    error = process.stderr.read().decode()
                    if os.path.exists(output_path):
                        os.remove(output_path)
                    return {'success': False, 'error': f'Container mysqldump failed: {error}'}
            else:
                with open(output_path, 'w') as f:
                    result = subprocess.run(
                        full_cmd, stdout=f, stderr=subprocess.PIPE, text=True, timeout=600
                    )
                    if result.returncode != 0:
                        if os.path.exists(output_path):
                            os.remove(output_path)
                        return {'success': False, 'error': f'Container mysqldump failed: {result.stderr}'}

            size_bytes = os.path.getsize(output_path)
            return {
                'success': True,
                'file_path': output_path,
                'size_bytes': size_bytes,
                'compressed': compress,
                'db_name': db_name,
            }

        except subprocess.TimeoutExpired:
            if os.path.exists(output_path):
                os.remove(output_path)
            return {'success': False, 'error': 'Container mysqldump timed out'}
        except Exception as e:
            if os.path.exists(output_path):
                os.remove(output_path)
            return {'success': False, 'error': str(e)}

    @classmethod
    def import_to_container(cls, compose_path: str, snapshot_path: str,
                             db_name: str, db_user: str = 'root',
                             db_password: str = None) -> Dict:
        """
        Import a SQL dump into a Docker container's MySQL instance.

        Args:
            compose_path: Path to the environment's docker-compose.yml
            snapshot_path: Path to the .sql or .sql.gz file to import
            db_name: Target database name
            db_user: MySQL user
            db_password: MySQL password

        Returns:
            Dict with success status
        """
        if not os.path.exists(compose_path):
            return {'success': False, 'error': f'Compose file not found: {compose_path}'}

        if not os.path.exists(snapshot_path):
            return {'success': False, 'error': f'Snapshot file not found: {snapshot_path}'}

        try:
            # Build mysql import command
            import_cmd = ['docker', 'compose', '-f', compose_path, 'exec', '-T', 'db',
                          'mysql', '-u', db_user]
            if db_password:
                import_cmd.append(f'-p{db_password}')
            import_cmd.append(db_name)

            if snapshot_path.endswith('.gz'):
                with gzip.open(snapshot_path, 'rb') as f:
                    result = subprocess.run(
                        import_cmd,
                        stdin=f,
                        capture_output=True,
                        timeout=1800
                    )
            else:
                with open(snapshot_path, 'r') as f:
                    result = subprocess.run(
                        import_cmd,
                        stdin=f,
                        capture_output=True,
                        timeout=1800
                    )

            if result.returncode != 0:
                error = result.stderr.decode() if isinstance(result.stderr, bytes) else result.stderr
                return {'success': False, 'error': f'Container import failed: {error}'}

            return {'success': True, 'message': f'Imported {snapshot_path} into container DB {db_name}'}

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Container import timed out (>30 minutes)'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def clone_between_containers(cls, source_compose_path: str, target_compose_path: str,
                                  source_db: str, target_db: str,
                                  source_user: str = 'root', target_user: str = 'root',
                                  source_password: str = None, target_password: str = None,
                                  options: Dict = None) -> Dict:
        """
        Clone a database from one Docker container to another with optional transformations.

        Exports from source container, optionally transforms the dump,
        then imports into the target container.

        Args:
            source_compose_path: Path to source environment's docker-compose.yml
            target_compose_path: Path to target environment's docker-compose.yml
            source_db: Source database name
            target_db: Target database name
            source_user/target_user: MySQL users
            source_password/target_password: MySQL passwords
            options: Transformation options (search_replace, table_prefix,
                     anonymize, truncate_tables, exclude_tables)

        Returns:
            Dict with success status and clone info
        """
        options = options or {}
        cls._ensure_dirs()

        try:
            # Step 1: Export from source container (uncompressed for transformation)
            export_result = cls.export_from_container(
                compose_path=source_compose_path,
                db_name=source_db,
                db_user=source_user,
                db_password=source_password,
                compress=False,
                exclude_tables=options.get('exclude_tables', [])
            )

            if not export_result['success']:
                return export_result

            dump_file = export_result['file_path']
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

                # Step 3: Import into target container
                import_result = cls.import_to_container(
                    compose_path=target_compose_path,
                    snapshot_path=import_file,
                    db_name=target_db,
                    db_user=target_user,
                    db_password=target_password
                )

                if not import_result['success']:
                    return import_result

                return {
                    'success': True,
                    'message': f'Database cloned from container to container: {source_db} → {target_db}',
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
