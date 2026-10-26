import subprocess
import os
import re
import secrets
import string
import json
from datetime import datetime

from app import paths
from app.utils.system import run_checked, secret_env, unit_is_active


def _validate_identifier(name: str, max_length: int = 64) -> bool:
    """Validate database/user identifiers to prevent SQL injection."""
    return bool(re.match(r'^[a-zA-Z0-9_$]{1,}$', name)) and len(name) <= max_length


_INVALID_ID = {'success': False, 'error': 'Invalid identifier: only alphanumeric characters and underscores allowed'}
_INVALID_PRIVILEGES = {'success': False, 'error': 'Invalid privileges: use privilege keywords such as ALL or SELECT, INSERT'}


def _validate_privileges(privileges: str) -> bool:
    """A comma list of privilege keywords (`ALL`, `SELECT, INSERT`): letters and
    spaces only, so it can sit unquoted in GRANT/REVOKE."""
    return bool(re.fullmatch(r'[A-Za-z ]+(,[A-Za-z ]+)*', privileges or ''))


class DatabaseService:
    """Service for managing MySQL/MariaDB and PostgreSQL databases.

    NOTE (L6): Subprocess timeout values in this service (typically 30s) should be
    reviewed periodically to ensure they are appropriate. Shorter timeouts reduce
    the window for resource exhaustion attacks, but may break legitimate long-running
    operations like large database backups or restores.
    """

    BACKUP_DIR = paths.DB_BACKUP_DIR

    # ==================== MYSQL/MARIADB ====================

    @staticmethod
    def mysql_is_installed():
        """Check if MySQL/MariaDB is installed."""
        # run_checked also resolves argv[0] when $PATH misses it, so a client
        # installed outside the unit's PATH stops reading as "not installed"
        # (the class behind a past outage).
        return run_checked(['mysql', '--version'])['success']

    @staticmethod
    def mysql_is_running():
        """Check if MySQL/MariaDB is running (either unit name)."""
        return any(unit_is_active(unit) is True for unit in ('mysql', 'mariadb'))

    @staticmethod
    def _mysql_env(root_password):
        """Process env with ``MYSQL_PWD`` set, or ``None`` when there is no password.

        Pasted verbatim eight times in this file. It carries a
        real rule — the password goes in the environment, never on the argv,
        where ``ps`` and the shell history would see it — and a rule that lives
        in eight copies is a rule that only holds in the copies someone
        remembered to update.

        ``None`` (rather than ``os.environ.copy()``) when there is no password,
        so ``subprocess`` inherits the parent environment exactly as before.
        """
        if not root_password:
            return None
        env = os.environ.copy()
        env['MYSQL_PWD'] = root_password
        return env

    @staticmethod
    def mysql_execute(query, database=None, root_password=None):
        """Execute a MySQL query."""
        try:
            cmd = ['mysql', '-u', 'root']
            if database:
                cmd.extend(['-D', database])
            cmd.extend(['-e', query])

            env = DatabaseService._mysql_env(root_password)

            return run_checked(cmd, env=env, timeout=None)
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def _mysql_execute_parameterized(query, params, database=None, root_password=None):
        """Execute a MySQL query with parameterized values using mysql CLI.

        Uses the mysql --execute flag with a prepared statement approach:
        passes the query through stdin with proper escaping to avoid injection.

        Args:
            query: SQL query with %s placeholders
            params: List of parameter values to substitute safely
            database: Optional database name
            root_password: Optional MySQL root password
        """
        try:
            # Build the parameterized query using mysql's built-in escaping
            # by passing values through a SET/EXECUTE pattern via stdin
            cmd = ['mysql', '-u', 'root', '--batch', '-N']
            if database:
                cmd.extend(['-D', database])

            env = DatabaseService._mysql_env(root_password)

            # Build a safe query using user-defined variables and EXECUTE
            # For simple single-param queries, we use a quoted literal approach
            # MySQL's cli doesn't support true parameterized queries, so we use
            # hex-encoding for string safety
            safe_params = []
            for p in params:
                if p is None:
                    safe_params.append('NULL')
                elif isinstance(p, (int, float)):
                    safe_params.append(str(p))
                else:
                    # Hex-encode string values: 0x<hex> is safe from injection
                    hex_val = p.encode('utf-8').hex()
                    safe_params.append(f"0x{hex_val}")

            # Replace %s placeholders with safe values
            safe_query = query
            for sp in safe_params:
                safe_query = safe_query.replace('%s', sp, 1)

            cmd.extend(['-e', safe_query])

            return run_checked(cmd, env=env, timeout=None)
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def mysql_list_databases(root_password=None):
        """List all MySQL databases."""
        result = DatabaseService.mysql_execute(
            "SHOW DATABASES;",
            root_password=root_password
        )
        if not result['success']:
            return []

        databases = []
        system_dbs = ['information_schema', 'mysql', 'performance_schema', 'sys']
        for line in result['output'].strip().split('\n')[1:]:
            db_name = line.strip()
            if db_name and db_name not in system_dbs:
                # Get database size using parameterized query via MySQL CLI
                # Pass db_name as a separate argument to avoid SQL injection
                size_query = "SELECT SUM(data_length + index_length) as size FROM information_schema.tables WHERE table_schema = %s;"
                size_result = DatabaseService._mysql_execute_parameterized(
                    size_query, [db_name], root_password=root_password
                )
                size = 0
                if size_result['success']:
                    try:
                        size_line = size_result['output'].strip().split('\n')[0]
                        size = int(size_line) if size_line and size_line != 'NULL' else 0
                    except (IndexError, ValueError):
                        pass

                databases.append({
                    'name': db_name,
                    'size': size,
                    'type': 'mysql'
                })
        return databases

    @staticmethod
    def mysql_create_database(name, charset='utf8mb4', collation='utf8mb4_unicode_ci', root_password=None):
        """Create a MySQL database."""
        if not _validate_identifier(name):
            return {'success': False, 'error': 'Invalid identifier: only alphanumeric characters and underscores allowed'}
        if not _validate_identifier(charset):
            return {'success': False, 'error': 'Invalid charset identifier'}
        if not _validate_identifier(collation, max_length=128):
            return {'success': False, 'error': 'Invalid collation identifier'}
        query = f"CREATE DATABASE IF NOT EXISTS `{name}` CHARACTER SET {charset} COLLATE {collation};"
        result = DatabaseService.mysql_execute(query, root_password=root_password)
        return result

    @staticmethod
    def mysql_drop_database(name, root_password=None):
        """Drop a MySQL database."""
        if not _validate_identifier(name):
            return {'success': False, 'error': 'Invalid identifier: only alphanumeric characters and underscores allowed'}
        query = f"DROP DATABASE IF EXISTS `{name}`;"
        result = DatabaseService.mysql_execute(query, root_password=root_password)
        return result

    @staticmethod
    def mysql_list_users(root_password=None):
        """List MySQL users."""
        result = DatabaseService.mysql_execute(
            "SELECT User, Host FROM mysql.user;",
            root_password=root_password
        )
        if not result['success']:
            return []

        users = []
        system_users = ['root', 'mysql.sys', 'mysql.session', 'mysql.infoschema', 'debian-sys-maint']
        for line in result['output'].strip().split('\n')[1:]:
            parts = line.strip().split('\t')
            if len(parts) >= 2:
                user, host = parts[0], parts[1]
                if user not in system_users:
                    users.append({'user': user, 'host': host})
        return users

    @staticmethod
    def mysql_create_user(username, password, host='localhost', root_password=None):
        """Create a MySQL user."""
        if not _validate_identifier(username):
            return {'success': False, 'error': 'Invalid identifier: only alphanumeric characters and underscores allowed'}
        if not _validate_identifier(host):
            return {'success': False, 'error': 'Invalid host identifier'}
        # Use hex-encoded password with UNHEX + QUOTE to safely pass the password
        # without manual string escaping. Username and host are validated above.
        try:
            cmd = ['mysql', '-u', 'root']

            env = DatabaseService._mysql_env(root_password)

            # Hex-encode the password so it never appears as a raw string in SQL.
            # UNHEX converts it back to bytes, CAST converts to string, QUOTE wraps
            # it safely for use in a dynamic SQL statement.
            hex_pw = password.encode('utf-8').hex()
            safe_stmt = (
                f"SET @pw = UNHEX('{hex_pw}');\n"
                f"SET @pw = CAST(@pw AS CHAR);\n"
                f"SET @sql = CONCAT('CREATE USER IF NOT EXISTS ''{username}''@''{host}'' IDENTIFIED BY ', QUOTE(@pw));\n"
                f"PREPARE stmt FROM @sql;\n"
                f"EXECUTE stmt;\n"
                f"DEALLOCATE PREPARE stmt;\n"
            )

            return run_checked(cmd, input=safe_stmt, env=env, timeout=None)
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def mysql_drop_user(username, host='localhost', root_password=None):
        """Drop a MySQL user."""
        if not _validate_identifier(username):
            return {'success': False, 'error': 'Invalid identifier: only alphanumeric characters and underscores allowed'}
        if not _validate_identifier(host):
            return {'success': False, 'error': 'Invalid host identifier'}
        query = f"DROP USER IF EXISTS '{username}'@'{host}';"
        result = DatabaseService.mysql_execute(query, root_password=root_password)
        return result

    @staticmethod
    def mysql_grant_privileges(username, database, privileges='ALL', host='localhost', root_password=None):
        """Grant privileges to a MySQL user."""
        if not _validate_identifier(username):
            return {'success': False, 'error': 'Invalid identifier: only alphanumeric characters and underscores allowed'}
        if not _validate_identifier(database):
            return {'success': False, 'error': 'Invalid identifier: only alphanumeric characters and underscores allowed'}
        if not _validate_identifier(host):
            return {'success': False, 'error': 'Invalid host identifier'}
        if not _validate_privileges(privileges):
            return _INVALID_PRIVILEGES
        query = f"GRANT {privileges} ON `{database}`.* TO '{username}'@'{host}'; FLUSH PRIVILEGES;"
        result = DatabaseService.mysql_execute(query, root_password=root_password)
        return result

    @staticmethod
    def mysql_revoke_privileges(username, database, privileges='ALL', host='localhost', root_password=None):
        """Revoke privileges from a MySQL user."""
        if not _validate_identifier(username):
            return {'success': False, 'error': 'Invalid identifier: only alphanumeric characters and underscores allowed'}
        if not _validate_identifier(database):
            return {'success': False, 'error': 'Invalid identifier: only alphanumeric characters and underscores allowed'}
        if not _validate_identifier(host):
            return {'success': False, 'error': 'Invalid host identifier'}
        if not _validate_privileges(privileges):
            return _INVALID_PRIVILEGES
        query = f"REVOKE {privileges} ON `{database}`.* FROM '{username}'@'{host}'; FLUSH PRIVILEGES;"
        result = DatabaseService.mysql_execute(query, root_password=root_password)
        return result

    @staticmethod
    def mysql_get_user_privileges(username, host='localhost', root_password=None):
        """Get privileges for a MySQL user."""
        if not _validate_identifier(username):
            return []
        if not _validate_identifier(host):
            return []
        result = DatabaseService.mysql_execute(
            f"SHOW GRANTS FOR '{username}'@'{host}';",
            root_password=root_password
        )
        if not result['success']:
            return []

        privileges = []
        for line in result['output'].strip().split('\n')[1:]:
            privileges.append(line.strip())
        return privileges

    @staticmethod
    def mysql_backup(database, output_path=None, root_password=None):
        """Backup a MySQL database."""
        os.makedirs(DatabaseService.BACKUP_DIR, exist_ok=True)

        if not output_path:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            output_path = os.path.join(
                DatabaseService.BACKUP_DIR,
                f"mysql_{database}_{timestamp}.sql.gz"
            )

        try:
            cmd = ['mysqldump', '-u', 'root']
            cmd.append(database)

            env = DatabaseService._mysql_env(root_password)

            # Pipe through gzip
            with open(output_path, 'wb') as f:
                dump = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
                gzip = subprocess.Popen(['gzip'], stdin=dump.stdout, stdout=f, stderr=subprocess.PIPE)
                dump.stdout.close()
                gzip.communicate()

                if dump.wait() != 0 or gzip.returncode != 0:
                    return {'success': False, 'error': 'Backup failed'}

            return {
                'success': True,
                'backup_path': output_path,
                'size': os.path.getsize(output_path)
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def mysql_restore(database, backup_path, root_password=None):
        """Restore a MySQL database from backup."""
        if not os.path.exists(backup_path):
            return {'success': False, 'error': 'Backup file not found'}

        try:
            cmd = ['mysql', '-u', 'root']
            cmd.append(database)

            env = DatabaseService._mysql_env(root_password)

            if backup_path.endswith('.gz'):
                # Decompress and restore
                gunzip = subprocess.Popen(['gunzip', '-c', backup_path], stdout=subprocess.PIPE)
                restore = subprocess.Popen(cmd, stdin=gunzip.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
                gunzip.stdout.close()
                _, stderr = restore.communicate()

                if restore.returncode != 0:
                    return {'success': False, 'error': stderr.decode()}
            else:
                with open(backup_path, 'r') as f:
                    result = run_checked(cmd, stdin=f, env=env, timeout=None)
                    if not result['success']:
                        return {'success': False, 'error': result['error']}

            return {'success': True, 'message': 'Database restored successfully'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def mysql_get_tables(database, root_password=None):
        """Get tables in a MySQL database."""
        result = DatabaseService.mysql_execute(
            "SHOW TABLES;",
            database=database,
            root_password=root_password
        )
        if not result['success']:
            return []

        tables = []
        for line in result['output'].strip().split('\n')[1:]:
            table_name = line.strip()
            if table_name:
                # Get table info
                info_result = DatabaseService.mysql_execute(
                    f"SELECT COUNT(*) as rows FROM `{table_name}`;",
                    database=database,
                    root_password=root_password
                )
                rows = 0
                if info_result['success']:
                    try:
                        rows = int(info_result['output'].strip().split('\n')[1])
                    except (IndexError, ValueError):
                        pass

                tables.append({
                    'name': table_name,
                    'rows': rows
                })
        return tables

    # ==================== POSTGRESQL ====================

    @staticmethod
    def pg_is_installed():
        """Check if PostgreSQL is installed."""
        return run_checked(['psql', '--version'])['success']

    @staticmethod
    def pg_is_running():
        """Check if PostgreSQL is running."""
        return unit_is_active('postgresql') is True

    @staticmethod
    def pg_execute(query, database='postgres', user='postgres'):
        """Execute a PostgreSQL query."""
        try:
            # `sudo -u postgres` is identity switching, not escalation — peer
            # auth maps the OS user to the DB role, so this cannot go through
            # run_privileged (which drops the -u when already root).
            cmd = ['sudo', '-u', 'postgres', 'psql', '-d', database, '-c', query, '-t', '-A']
            return run_checked(cmd, timeout=None)
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def pg_list_databases():
        """List all PostgreSQL databases."""
        result = DatabaseService.pg_execute(
            "SELECT datname FROM pg_database WHERE datistemplate = false;"
        )
        if not result['success']:
            return []

        databases = []
        system_dbs = ['postgres']
        for line in result['output'].strip().split('\n'):
            db_name = line.strip()
            if db_name and db_name not in system_dbs:
                # Get database size
                size_result = DatabaseService.pg_execute(
                    f"SELECT pg_database_size('{db_name}');"
                )
                size = 0
                if size_result['success']:
                    try:
                        size = int(size_result['output'].strip())
                    except ValueError:
                        pass

                databases.append({
                    'name': db_name,
                    'size': size,
                    'type': 'postgresql'
                })
        return databases

    @staticmethod
    def pg_create_database(name, owner=None, encoding='UTF8'):
        """Create a PostgreSQL database."""
        if not _validate_identifier(name) or (owner and not _validate_identifier(owner)):
            return _INVALID_ID
        if not _validate_identifier(encoding):
            return {'success': False, 'error': 'Invalid encoding identifier'}
        query = f"CREATE DATABASE \"{name}\" ENCODING '{encoding}'"
        if owner:
            query += f" OWNER \"{owner}\""
        query += ";"
        result = DatabaseService.pg_execute(query)
        return result

    @staticmethod
    def pg_drop_database(name):
        """Drop a PostgreSQL database."""
        if not _validate_identifier(name):
            return {'success': False, 'error': 'Invalid identifier: only alphanumeric characters and underscores allowed'}
        # Terminate connections first using psql variable binding to prevent injection
        try:
            cmd = [
                'sudo', '-u', 'postgres', 'psql', '-d', 'postgres',
                '-v', f'dbname={name}',
                '-c', "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'dbname';",
                '-t', '-A'
            ]
            run_checked(cmd, timeout=None)
        except Exception:
            pass
        # Name is validated above, safe to use in identifier position
        result = DatabaseService.pg_execute(f'DROP DATABASE IF EXISTS "{name}";')
        return result

    @staticmethod
    def pg_list_users():
        """List PostgreSQL users/roles."""
        result = DatabaseService.pg_execute(
            "SELECT rolname FROM pg_roles WHERE rolcanlogin = true;"
        )
        if not result['success']:
            return []

        users = []
        system_users = ['postgres']
        for line in result['output'].strip().split('\n'):
            user = line.strip()
            if user and user not in system_users:
                users.append({'user': user, 'host': 'local'})
        return users

    @staticmethod
    def pg_create_user(username, password):
        """Create a PostgreSQL user."""
        if not _validate_identifier(username):
            return _INVALID_ID
        # Standard-conforming strings: doubling the quote is the whole escape.
        escaped = password.replace("'", "''")
        result = DatabaseService.pg_execute(
            f"CREATE USER \"{username}\" WITH PASSWORD '{escaped}';"
        )
        return result

    @staticmethod
    def pg_drop_user(username):
        """Drop a PostgreSQL user."""
        if not _validate_identifier(username):
            return _INVALID_ID
        result = DatabaseService.pg_execute(f'DROP USER IF EXISTS "{username}";')
        return result

    @staticmethod
    def pg_grant_privileges(username, database, privileges='ALL'):
        """Grant privileges to a PostgreSQL user."""
        if not _validate_identifier(username) or not _validate_identifier(database):
            return _INVALID_ID
        if not _validate_privileges(privileges):
            return _INVALID_PRIVILEGES
        result = DatabaseService.pg_execute(
            f'GRANT {privileges} PRIVILEGES ON DATABASE "{database}" TO "{username}";'
        )
        return result

    @staticmethod
    def pg_revoke_privileges(username, database, privileges='ALL'):
        """Revoke privileges from a PostgreSQL user."""
        if not _validate_identifier(username) or not _validate_identifier(database):
            return _INVALID_ID
        if not _validate_privileges(privileges):
            return _INVALID_PRIVILEGES
        result = DatabaseService.pg_execute(
            f'REVOKE {privileges} PRIVILEGES ON DATABASE "{database}" FROM "{username}";'
        )
        return result

    @staticmethod
    def create_database_user(engine, name, password, host='localhost', root_password=None):
        """Create a user named after database *name* with ALL on it. Returns the
        first failing step's result, so callers never hand out credentials for
        a user that was not created."""
        if engine == 'mysql':
            result = DatabaseService.mysql_create_user(name, password, host, root_password)
            if result.get('success'):
                result = DatabaseService.mysql_grant_privileges(name, name, 'ALL', host, root_password)
        else:
            result = DatabaseService.pg_create_user(name, password)
            if result.get('success'):
                result = DatabaseService.pg_grant_privileges(name, name, 'ALL')
        return result

    @staticmethod
    def pg_backup(database, output_path=None):
        """Backup a PostgreSQL database."""
        os.makedirs(DatabaseService.BACKUP_DIR, exist_ok=True)

        if not output_path:
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            output_path = os.path.join(
                DatabaseService.BACKUP_DIR,
                f"pg_{database}_{timestamp}.sql.gz"
            )

        try:
            cmd = ['sudo', '-u', 'postgres', 'pg_dump', database]

            with open(output_path, 'wb') as f:
                dump = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                gzip = subprocess.Popen(['gzip'], stdin=dump.stdout, stdout=f, stderr=subprocess.PIPE)
                dump.stdout.close()
                gzip.communicate()

                if dump.wait() != 0 or gzip.returncode != 0:
                    return {'success': False, 'error': 'Backup failed'}

            return {
                'success': True,
                'backup_path': output_path,
                'size': os.path.getsize(output_path)
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def pg_restore(database, backup_path):
        """Restore a PostgreSQL database from backup."""
        if not os.path.exists(backup_path):
            return {'success': False, 'error': 'Backup file not found'}

        try:
            cmd = ['sudo', '-u', 'postgres', 'psql', database]

            if backup_path.endswith('.gz'):
                gunzip = subprocess.Popen(['gunzip', '-c', backup_path], stdout=subprocess.PIPE)
                restore = subprocess.Popen(cmd, stdin=gunzip.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                gunzip.stdout.close()
                _, stderr = restore.communicate()

                if restore.returncode != 0:
                    return {'success': False, 'error': stderr.decode()}
            else:
                with open(backup_path, 'r') as f:
                    result = run_checked(cmd, stdin=f, timeout=None)
                    if not result['success']:
                        return {'success': False, 'error': result['error']}

            return {'success': True, 'message': 'Database restored successfully'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def pg_get_tables(database):
        """Get tables in a PostgreSQL database."""
        result = DatabaseService.pg_execute(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public';",
            database=database
        )
        if not result['success']:
            return []

        tables = []
        for line in result['output'].strip().split('\n'):
            table_name = line.strip()
            if table_name:
                # Get row count
                count_result = DatabaseService.pg_execute(
                    f"SELECT COUNT(*) FROM \"{table_name}\";",
                    database=database
                )
                rows = 0
                if count_result['success']:
                    try:
                        rows = int(count_result['output'].strip())
                    except ValueError:
                        pass

                tables.append({
                    'name': table_name,
                    'rows': rows
                })
        return tables

    # ==================== QUERY EXECUTION ====================

    # Allowed readonly commands for security
    READONLY_COMMANDS = {'SELECT', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN'}

    @staticmethod
    def _is_readonly_query(query):
        """Check if a query is readonly (SELECT, SHOW, DESCRIBE, EXPLAIN)."""
        # Remove leading whitespace and get first word
        normalized = query.strip().upper()
        first_word = normalized.split()[0] if normalized.split() else ''
        return first_word in DatabaseService.READONLY_COMMANDS

    @staticmethod
    def mysql_execute_query(database, query, readonly=True, root_password=None, timeout=30, max_rows=1000):
        """Execute a MySQL query and return structured results.

        Args:
            database: Database name to query
            query: SQL query to execute
            readonly: If True, only allow SELECT/SHOW/DESCRIBE/EXPLAIN
            root_password: MySQL root password
            timeout: Query timeout in seconds
            max_rows: Maximum rows to return

        Returns:
            dict with columns, rows, row_count, and execution info
        """
        import json
        import time

        # Security check for readonly mode
        if readonly and not DatabaseService._is_readonly_query(query):
            return {
                'success': False,
                'error': 'Only SELECT, SHOW, DESCRIBE, and EXPLAIN queries are allowed in readonly mode'
            }

        try:
            start_time = time.time()

            # Build mysql command with JSON output format
            cmd = ['mysql', '-u', 'root']

            env = DatabaseService._mysql_env(root_password)
            cmd.extend([
                '-D', database,
                '-e', query,
                '--batch',  # Tab-separated output
                '-N' if query.strip().upper().startswith(('SHOW', 'DESCRIBE', 'DESC')) else ''
            ])
            # Remove empty strings from cmd
            cmd = [c for c in cmd if c]

            result = run_checked(cmd, timeout=timeout, env=env)

            execution_time = time.time() - start_time

            if not result['success']:
                return {'success': False, 'error': result['error']}

            # Parse the output
            lines = result['output'].strip().split('\n') if result['output'].strip() else []

            if not lines:
                return {
                    'success': True,
                    'columns': [],
                    'rows': [],
                    'row_count': 0,
                    'execution_time': execution_time,
                    'truncated': False
                }

            # First line is headers (unless -N was used)
            if query.strip().upper().startswith(('SHOW', 'DESCRIBE', 'DESC')):
                # For SHOW/DESCRIBE, we need to add generic column names
                columns = [f'Column_{i}' for i in range(len(lines[0].split('\t')))] if lines else []
                data_lines = lines
            else:
                columns = lines[0].split('\t') if lines else []
                data_lines = lines[1:]

            # Parse rows
            rows = []
            for i, line in enumerate(data_lines):
                if i >= max_rows:
                    break
                values = line.split('\t')
                # Convert NULL strings to None
                values = [None if v == 'NULL' else v for v in values]
                rows.append(values)

            return {
                'success': True,
                'columns': columns,
                'rows': rows,
                'row_count': len(rows),
                'total_rows': len(data_lines),
                'execution_time': round(execution_time, 4),
                'truncated': len(data_lines) > max_rows
            }

        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error': f'Query timed out after {timeout} seconds'
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def pg_execute_query(database, query, readonly=True, timeout=30, max_rows=1000):
        """Execute a PostgreSQL query and return structured results.

        Args:
            database: Database name to query
            query: SQL query to execute
            readonly: If True, only allow SELECT/SHOW/DESCRIBE/EXPLAIN
            timeout: Query timeout in seconds
            max_rows: Maximum rows to return

        Returns:
            dict with columns, rows, row_count, and execution info
        """
        import time

        # Security check for readonly mode
        if readonly and not DatabaseService._is_readonly_query(query):
            return {
                'success': False,
                'error': 'Only SELECT, SHOW, DESCRIBE, and EXPLAIN queries are allowed in readonly mode'
            }

        try:
            start_time = time.time()

            # For PostgreSQL, we use psql with specific formatting
            # -F sets field separator, -A for unaligned output
            cmd = [
                'sudo', '-u', 'postgres', 'psql',
                '-d', database,
                '-c', query,
                '-F', '\t',  # Tab separator
                '-A',  # Unaligned output
                '--pset', 'footer=off'  # No row count footer
            ]

            result = run_checked(cmd, timeout=timeout)

            execution_time = time.time() - start_time

            if not result['success']:
                return {'success': False, 'error': result['error']}

            # Parse the output
            lines = result['output'].strip().split('\n') if result['output'].strip() else []

            if not lines:
                return {
                    'success': True,
                    'columns': [],
                    'rows': [],
                    'row_count': 0,
                    'execution_time': execution_time,
                    'truncated': False
                }

            # First line is headers
            columns = lines[0].split('\t') if lines else []
            data_lines = lines[1:] if len(lines) > 1 else []

            # Parse rows
            rows = []
            for i, line in enumerate(data_lines):
                if i >= max_rows:
                    break
                if line.strip():  # Skip empty lines
                    values = line.split('\t')
                    # Convert empty strings and special values
                    values = [None if v == '' else v for v in values]
                    rows.append(values)

            return {
                'success': True,
                'columns': columns,
                'rows': rows,
                'row_count': len(rows),
                'total_rows': len(data_lines),
                'execution_time': round(execution_time, 4),
                'truncated': len(data_lines) > max_rows
            }

        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error': f'Query timed out after {timeout} seconds'
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def sqlite_execute_query(db_path, query, readonly=True, timeout=30, max_rows=1000):
        """Execute a SQLite query and return structured results.

        Args:
            db_path: Path to SQLite database file
            query: SQL query to execute
            readonly: If True, only allow SELECT/SHOW/DESCRIBE/EXPLAIN
            timeout: Query timeout in seconds
            max_rows: Maximum rows to return

        Returns:
            dict with columns, rows, row_count, and execution info
        """
        import sqlite3
        import time

        # Security check for readonly mode
        if readonly and not DatabaseService._is_readonly_query(query):
            return {
                'success': False,
                'error': 'Only SELECT queries are allowed in readonly mode'
            }

        # Validate path exists
        if not os.path.exists(db_path):
            return {'success': False, 'error': f'Database file not found: {db_path}'}

        try:
            start_time = time.time()

            # Open in readonly mode if readonly is True
            uri = f'file:{db_path}?mode=ro' if readonly else db_path
            conn = sqlite3.connect(uri, uri=readonly, timeout=timeout)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()

            cursor.execute(query)

            # Get column names
            columns = [description[0] for description in cursor.description] if cursor.description else []

            # Fetch rows with limit
            rows = []
            total_fetched = 0
            for row in cursor:
                total_fetched += 1
                if len(rows) < max_rows:
                    rows.append(list(row))

            execution_time = time.time() - start_time
            conn.close()

            return {
                'success': True,
                'columns': columns,
                'rows': rows,
                'row_count': len(rows),
                'total_rows': total_fetched,
                'execution_time': round(execution_time, 4),
                'truncated': total_fetched > max_rows
            }

        except sqlite3.OperationalError as e:
            return {'success': False, 'error': str(e)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def mysql_get_table_structure(database, table, root_password=None):
        """Get the structure/schema of a MySQL table."""
        query = f"DESCRIBE `{table}`;"
        result = DatabaseService.mysql_execute(query, database=database, root_password=root_password)

        if not result['success']:
            return result

        columns = []
        for line in result['output'].strip().split('\n')[1:]:
            parts = line.split('\t')
            if len(parts) >= 6:
                columns.append({
                    'name': parts[0],
                    'type': parts[1],
                    'nullable': parts[2] == 'YES',
                    'key': parts[3],
                    'default': parts[4] if parts[4] != 'NULL' else None,
                    'extra': parts[5]
                })

        return {'success': True, 'columns': columns, 'table': table}

    @staticmethod
    def pg_get_table_structure(database, table):
        """Get the structure/schema of a PostgreSQL table."""
        query = f"""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = '{table}' AND table_schema = 'public'
            ORDER BY ordinal_position;
        """
        result = DatabaseService.pg_execute(query, database=database)

        if not result['success']:
            return result

        columns = []
        for line in result['output'].strip().split('\n'):
            parts = line.split('|')
            if len(parts) >= 4:
                columns.append({
                    'name': parts[0].strip(),
                    'type': parts[1].strip(),
                    'nullable': parts[2].strip() == 'YES',
                    'default': parts[3].strip() if parts[3].strip() else None
                })

        return {'success': True, 'columns': columns, 'table': table}

    @staticmethod
    def sqlite_get_table_structure(db_path, table):
        """Get the structure/schema of a SQLite table."""
        import sqlite3

        if not os.path.exists(db_path):
            return {'success': False, 'error': f'Database file not found: {db_path}'}

        try:
            conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
            cursor = conn.cursor()
            cursor.execute(f"PRAGMA table_info(`{table}`);")
            rows = cursor.fetchall()
            conn.close()

            columns = []
            for row in rows:
                columns.append({
                    'name': row[1],
                    'type': row[2],
                    'nullable': row[3] == 0,
                    'default': row[4],
                    'primary_key': row[5] == 1
                })

            return {'success': True, 'columns': columns, 'table': table}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def sqlite_list_databases(search_paths=None):
        """Find SQLite database files in common locations."""
        if search_paths is None:
            search_paths = ['/var/www', '/home', '/opt']

        databases = []
        for base_path in search_paths:
            if not os.path.exists(base_path):
                continue
            try:
                for root, dirs, files in os.walk(base_path):
                    # Skip hidden directories and common non-app directories
                    dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['node_modules', 'vendor', '__pycache__']]

                    for file in files:
                        if file.endswith(('.db', '.sqlite', '.sqlite3')):
                            filepath = os.path.join(root, file)
                            try:
                                size = os.path.getsize(filepath)
                                databases.append({
                                    'name': file,
                                    'path': filepath,
                                    'size': size,
                                    'type': 'sqlite'
                                })
                            except OSError:
                                continue
            except PermissionError:
                continue

        return databases

    @staticmethod
    def sqlite_get_tables(db_path):
        """Get tables in a SQLite database."""
        import sqlite3

        if not os.path.exists(db_path):
            return []

        try:
            conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
            cursor = conn.cursor()
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")
            tables = []
            for row in cursor.fetchall():
                table_name = row[0]
                # Get row count
                cursor.execute(f"SELECT COUNT(*) FROM `{table_name}`;")
                count = cursor.fetchone()[0]
                tables.append({'name': table_name, 'rows': count})
            conn.close()
            return tables
        except Exception:
            return []

    # ==================== UTILITY ====================

    @staticmethod
    def get_status():
        """Get database server status."""
        return {
            'mysql': {
                'installed': DatabaseService.mysql_is_installed(),
                'running': DatabaseService.mysql_is_running()
            },
            'postgresql': {
                'installed': DatabaseService.pg_is_installed(),
                'running': DatabaseService.pg_is_running()
            }
        }

    @staticmethod
    def list_backups(db_type=None):
        """List all database backups."""
        if not os.path.exists(DatabaseService.BACKUP_DIR):
            return []

        backups = []
        for filename in os.listdir(DatabaseService.BACKUP_DIR):
            if filename.endswith('.sql') or filename.endswith('.sql.gz'):
                filepath = os.path.join(DatabaseService.BACKUP_DIR, filename)
                backup_type = 'mysql' if filename.startswith('mysql_') else 'postgresql'

                if db_type and backup_type != db_type:
                    continue

                # Parse database name from filename
                parts = filename.replace('.sql.gz', '').replace('.sql', '').split('_')
                db_name = '_'.join(parts[1:-2]) if len(parts) > 3 else parts[1] if len(parts) > 1 else 'unknown'

                backups.append({
                    'filename': filename,
                    'path': filepath,
                    'type': backup_type,
                    'database': db_name,
                    'size': os.path.getsize(filepath),
                    'created_at': datetime.fromtimestamp(os.path.getctime(filepath)).isoformat()
                })

        return sorted(backups, key=lambda x: x['created_at'], reverse=True)

    @staticmethod
    def delete_backup(filename):
        """Delete a backup file."""
        filepath = os.path.join(DatabaseService.BACKUP_DIR, filename)
        if os.path.exists(filepath):
            os.remove(filepath)
            return {'success': True}
        return {'success': False, 'error': 'Backup not found'}

    @staticmethod
    def generate_password(length=16):
        """Generate a secure random password."""
        alphabet = string.ascii_letters + string.digits + '!@#$%^&*'
        return ''.join(secrets.choice(alphabet) for _ in range(length))

    # ==================== DOCKER CONTAINER DATABASES ====================

    @staticmethod
    def list_docker_mysql_containers():
        """Find all Docker containers running MySQL/MariaDB."""
        try:
            # Get all running containers
            result = run_checked(['docker', 'ps', '--format', '{{json .}}'],
                                 timeout=None)
            if not result['success']:
                return []

            containers = []
            mysql_images = ['mysql', 'mariadb', 'percona']

            for line in result['output'].strip().split('\n'):
                if not line:
                    continue
                container = json.loads(line)
                image = container.get('Image', '').lower()

                # Check if it's a MySQL-like container
                if any(img in image for img in mysql_images):
                    containers.append({
                        'id': container.get('ID'),
                        'name': container.get('Names'),
                        'image': container.get('Image'),
                        'status': container.get('Status'),
                        'ports': container.get('Ports'),
                        'type': 'mysql'
                    })

            return containers
        except Exception:
            return []

    # Which CLI a DB container actually ships. MariaDB 11 dropped the `mysql`
    # symlink in favour of `mariadb`, so a hardcoded 'mysql' fails outright with
    # "executable file not found in $PATH" against any modern MariaDB image —
    # including the mariadb:11.4 our own engine template installs. Resolved once
    # per container and remembered; the answer cannot change while it runs.
    _docker_client_cache = {}

    @staticmethod
    def _docker_db_client(container_name):
        """Name of the mysql-compatible client available inside a container."""
        cached = DatabaseService._docker_client_cache.get(container_name)
        if cached:
            return cached
        for client in ('mariadb', 'mysql'):
            probe = run_checked(['docker', 'exec', container_name, client, '--version'],
                                timeout=10)
            if probe['success']:
                DatabaseService._docker_client_cache[container_name] = client
                return client
        # Nothing answered — keep the historic default so the caller's error
        # message stays the familiar one.
        return 'mysql'

    @staticmethod
    def docker_mysql_execute(container_name, query, database=None, user='root',
                             password=None, machine_readable=False, timeout=30):
        """Execute a MySQL query inside a Docker container.

        ``machine_readable`` adds ``-N -B``: no column headers, tab-separated,
        no box drawing. Callers that parse the output need it; callers that
        show the output to a human do not. It is a flag rather than a second
        method because ``db_config_tuner_service`` used to keep a private copy
        of this whole function purely to add those two characters.
        """
        try:
            cmd = ['docker', 'exec']

            # Bare `-e MYSQL_PWD`: docker reads the value from our env, so the
            # password never sits in the docker command line.
            if password:
                cmd.extend(['-e', 'MYSQL_PWD'])

            cmd.extend([container_name, DatabaseService._docker_db_client(container_name), '-u', user])

            if database:
                cmd.extend(['-D', database])

            if machine_readable:
                cmd.extend(['-N', '-B'])

            cmd.extend(['-e', query])

            return run_checked(cmd, timeout=timeout, env=secret_env(MYSQL_PWD=password))
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def docker_pg_execute(container_name, query, database='postgres', user='postgres',
                          password=None, timeout=30, machine_readable=False):
        """Execute a PostgreSQL statement inside a Docker container.

        The psql twin of :meth:`docker_mysql_execute`, so anything that has to
        talk to a containerised engine has one place to do it.

        ``ON_ERROR_STOP=1`` is not optional: without it psql happily reports
        success for a statement the server rejected, which turns a real failure
        (``could not open extension control file``) into a silent no-op.

        Output is ``-t -A``: no header, no padding, ``|``-separated columns.
        """
        try:
            cmd = ['docker', 'exec']
            # PGPASSWORD via the exec environment, never on the command line.
            if password:
                cmd.extend(['-e', 'PGPASSWORD'])
            cmd.extend([container_name, 'psql', '-U', user,
                        '-d', database or 'postgres',
                        '-v', 'ON_ERROR_STOP=1',
                        '-c', query, '-t', '-A'])
            if machine_readable:
                # tab, not the '|' default: the callers that parse this split
                # on tabs, and a '|' is legal inside a value.
                cmd.extend(['-F', '\t'])
            return run_checked(cmd, timeout=timeout, env=secret_env(PGPASSWORD=password))
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def docker_mysql_list_databases(container_name, user='root', password=None):
        """List databases in a Docker MySQL container."""
        result = DatabaseService.docker_mysql_execute(
            container_name,
            "SHOW DATABASES;",
            user=user,
            password=password
        )
        if not result['success']:
            return []

        databases = []
        system_dbs = ['information_schema', 'mysql', 'performance_schema', 'sys']
        for line in result['output'].strip().split('\n')[1:]:
            db_name = line.strip()
            if db_name and db_name not in system_dbs:
                databases.append({
                    'name': db_name,
                    'type': 'docker_mysql',
                    'container': container_name
                })
        return databases

    @staticmethod
    def docker_mysql_get_tables(container_name, database, user='root', password=None):
        """List tables in a Docker MySQL database.

        Returns ``{'connected': bool, 'tables': [...], 'error': str|None}`` so
        callers can tell a genuinely empty database apart from a container/auth
        failure. Both used to collapse to ``[]`` and the explorer rendered
        "Empty" either way, silently hiding a broken connection.
        """
        result = DatabaseService.docker_mysql_execute(
            container_name,
            "SHOW TABLES;",
            database=database,
            user=user,
            password=password
        )
        if not result['success']:
            return {
                'connected': False,
                'tables': [],
                'error': result.get('error') or 'Could not connect to the database container',
            }

        tables = []
        for line in result['output'].strip().split('\n')[1:]:
            table_name = line.strip()
            if table_name:
                # Get row count
                count_result = DatabaseService.docker_mysql_execute(
                    container_name,
                    f"SELECT COUNT(*) FROM `{table_name}`;",
                    database=database,
                    user=user,
                    password=password
                )
                rows = 0
                if count_result['success']:
                    try:
                        rows = int(count_result['output'].strip().split('\n')[1])
                    except (IndexError, ValueError):
                        pass

                tables.append({
                    'name': table_name,
                    'rows': rows
                })
        return {'connected': True, 'tables': tables, 'error': None}

    @staticmethod
    def docker_mysql_execute_query(container_name, database, query, user='root', password=None,
                                   readonly=True, timeout=30, max_rows=1000):
        """Execute a query against a Docker MySQL container and return structured results."""
        import time

        # Security check for readonly mode
        if readonly and not DatabaseService._is_readonly_query(query):
            return {
                'success': False,
                'error': 'Only SELECT, SHOW, DESCRIBE, and EXPLAIN queries are allowed in readonly mode'
            }

        try:
            start_time = time.time()

            cmd = ['docker', 'exec']
            if password:
                cmd.extend(['-e', 'MYSQL_PWD'])
            cmd.extend([container_name, DatabaseService._docker_db_client(container_name), '-u', user])
            cmd.extend([
                '-D', database,
                '-e', query,
                '--batch'
            ])

            result = run_checked(cmd, timeout=timeout, env=secret_env(MYSQL_PWD=password))
            execution_time = time.time() - start_time

            if not result['success']:
                return {'success': False, 'error': result['error']}

            # Parse the output
            lines = result['output'].strip().split('\n') if result['output'].strip() else []

            if not lines:
                return {
                    'success': True,
                    'columns': [],
                    'rows': [],
                    'row_count': 0,
                    'execution_time': execution_time,
                    'truncated': False
                }

            # First line is headers
            columns = lines[0].split('\t') if lines else []
            data_lines = lines[1:] if len(lines) > 1 else []

            # Parse rows
            rows = []
            for i, line in enumerate(data_lines):
                if i >= max_rows:
                    break
                values = line.split('\t')
                values = [None if v == 'NULL' else v for v in values]
                rows.append(values)

            return {
                'success': True,
                'columns': columns,
                'rows': rows,
                'row_count': len(rows),
                'total_rows': len(data_lines),
                'execution_time': round(execution_time, 4),
                'truncated': len(data_lines) > max_rows
            }

        except subprocess.TimeoutExpired:
            return {
                'success': False,
                'error': f'Query timed out after {timeout} seconds'
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @staticmethod
    def _resolve_app_container(app_path, service_name, fallback=None, env_vars=None):
        """Resolve the real running container name for a compose service.

        docker-compose v2 names containers ``<project>-<service>-N`` and our
        templates leave ``container_name`` as an unexpanded ``${APP_NAME}-db``
        in the on-disk compose, so neither the literal value nor a
        ``<app>_<service>`` guess reliably matches the live container — which is
        why ``docker exec`` silently failed and tables showed as empty. Ask
        ``docker compose ps`` what the container is actually called and match on
        the service; fall back to expanding ``${VARS}`` from .env, then to the
        raw fallback.
        """
        # 1. Authoritative: ask docker what the container is actually called.
        if app_path:
            try:
                from app.services.docker_service import DockerService
                for c in DockerService.compose_ps(app_path):
                    svc = c.get('Service') or c.get('service')
                    if svc == service_name:
                        name = c.get('Name') or c.get('name') or c.get('ID') or c.get('id')
                        if name:
                            return name
            except Exception:
                pass
        # 2. Best-effort: expand ${VARS} in the declared/guessed name from .env.
        if fallback and env_vars and '${' in fallback:
            fallback = re.sub(r'\$\{([^}]+)\}',
                              lambda m: env_vars.get(m.group(1), m.group(0)), fallback)
        return fallback

    @staticmethod
    def get_app_database_info(app_name, app_path):
        """Get database info for a Docker app by reading its compose file."""
        compose_path = os.path.join(app_path, 'docker-compose.yml') if app_path else None
        env_path = os.path.join(app_path, '.env') if app_path else None

        if not compose_path or not os.path.exists(compose_path):
            return None

        try:
            import yaml

            with open(compose_path, 'r') as f:
                compose = yaml.safe_load(f)

            # Read .env file for passwords
            env_vars = {}
            if env_path and os.path.exists(env_path):
                with open(env_path, 'r') as f:
                    for line in f:
                        if '=' in line and not line.strip().startswith('#'):
                            key, value = line.strip().split('=', 1)
                            env_vars[key] = value

            db_info = []
            services = compose.get('services', {})

            for service_name, service_config in services.items():
                image = service_config.get('image', '').lower()

                # Check for MySQL containers
                if any(db in image for db in ['mysql', 'mariadb', 'percona']):
                    container_name = service_config.get('container_name', f'{app_name}_{service_name}')
                    container_name = DatabaseService._resolve_app_container(app_path, service_name, container_name, env_vars)
                    environment = service_config.get('environment', [])

                    # Extract credentials from environment
                    root_password = None
                    db_user = None
                    db_password = None
                    db_name = None

                    if isinstance(environment, list):
                        for env in environment:
                            if isinstance(env, str) and '=' in env:
                                key, value = env.split('=', 1)
                            elif isinstance(env, str):
                                key = env
                                value = env_vars.get(env.replace('${', '').replace('}', ''), '')
                            else:
                                continue

                            # Resolve ${VAR} syntax
                            if value.startswith('${') and value.endswith('}'):
                                var_name = value[2:-1]
                                value = env_vars.get(var_name, value)

                            if 'ROOT_PASSWORD' in key:
                                root_password = value
                            elif 'MYSQL_PASSWORD' in key and 'ROOT' not in key:
                                db_password = value
                            elif 'MYSQL_USER' in key:
                                db_user = value
                            elif 'MYSQL_DATABASE' in key:
                                db_name = value
                    elif isinstance(environment, dict):
                        for key, value in environment.items():
                            if isinstance(value, str) and value.startswith('${') and value.endswith('}'):
                                var_name = value[2:-1]
                                value = env_vars.get(var_name, value)

                            if 'ROOT_PASSWORD' in key:
                                root_password = value
                            elif 'MYSQL_PASSWORD' in key and 'ROOT' not in key:
                                db_password = value
                            elif 'MYSQL_USER' in key:
                                db_user = value
                            elif 'MYSQL_DATABASE' in key:
                                db_name = value

                    db_info.append({
                        'type': 'mysql',
                        'container': container_name,
                        'service': service_name,
                        'image': image,
                        'database': db_name,
                        'user': db_user or 'root',
                        'password': db_password or root_password,
                        'root_password': root_password
                    })

                # Check for PostgreSQL containers
                elif 'postgres' in image:
                    container_name = service_config.get('container_name', f'{app_name}_{service_name}')
                    container_name = DatabaseService._resolve_app_container(app_path, service_name, container_name, env_vars)
                    environment = service_config.get('environment', [])

                    pg_user = 'postgres'
                    pg_password = None
                    pg_db = None

                    if isinstance(environment, list):
                        for env in environment:
                            if isinstance(env, str) and '=' in env:
                                key, value = env.split('=', 1)
                                if value.startswith('${') and value.endswith('}'):
                                    var_name = value[2:-1]
                                    value = env_vars.get(var_name, value)

                                if 'POSTGRES_PASSWORD' in key:
                                    pg_password = value
                                elif 'POSTGRES_USER' in key:
                                    pg_user = value
                                elif 'POSTGRES_DB' in key:
                                    pg_db = value

                    db_info.append({
                        'type': 'postgresql',
                        'container': container_name,
                        'service': service_name,
                        'image': image,
                        'database': pg_db,
                        'user': pg_user,
                        'password': pg_password
                    })

            return db_info if db_info else None

        except Exception as e:
            return None
