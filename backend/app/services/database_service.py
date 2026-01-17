import subprocess
import os
import secrets
import string
from datetime import datetime


class DatabaseService:
    """Service for managing MySQL/MariaDB and PostgreSQL databases."""

    BACKUP_DIR = '/var/backups/serverkit/databases'

    # ==================== MYSQL/MARIADB ====================

    @staticmethod
    def mysql_is_installed():
        """Check if MySQL/MariaDB is installed."""
        try:
            result = subprocess.run(
                ['mysql', '--version'],
                capture_output=True, text=True
            )
            return result.returncode == 0
        except FileNotFoundError:
            return False

    @staticmethod
    def mysql_is_running():
        """Check if MySQL/MariaDB is running."""
        try:
            result = subprocess.run(
                ['systemctl', 'is-active', 'mysql'],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return True
            # Try mariadb service name
            result = subprocess.run(
                ['systemctl', 'is-active', 'mariadb'],
                capture_output=True, text=True
            )
            return result.returncode == 0
        except Exception:
            return False

    @staticmethod
    def mysql_execute(query, database=None, root_password=None):
        """Execute a MySQL query."""
        try:
            cmd = ['mysql', '-u', 'root']
            if root_password:
                cmd.extend([f'-p{root_password}'])
            if database:
                cmd.extend(['-D', database])
            cmd.extend(['-e', query])

            result = subprocess.run(
                cmd, capture_output=True, text=True
            )
            return {
                'success': result.returncode == 0,
                'output': result.stdout,
                'error': result.stderr if result.returncode != 0 else None
            }
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
                # Get database size
                size_result = DatabaseService.mysql_execute(
                    f"SELECT SUM(data_length + index_length) as size FROM information_schema.tables WHERE table_schema = '{db_name}';",
                    root_password=root_password
                )
                size = 0
                if size_result['success']:
                    try:
                        size_line = size_result['output'].strip().split('\n')[1]
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
        query = f"CREATE DATABASE IF NOT EXISTS `{name}` CHARACTER SET {charset} COLLATE {collation};"
        result = DatabaseService.mysql_execute(query, root_password=root_password)
        return result

    @staticmethod
    def mysql_drop_database(name, root_password=None):
        """Drop a MySQL database."""
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
        query = f"CREATE USER IF NOT EXISTS '{username}'@'{host}' IDENTIFIED BY '{password}';"
        result = DatabaseService.mysql_execute(query, root_password=root_password)
        return result

    @staticmethod
    def mysql_drop_user(username, host='localhost', root_password=None):
        """Drop a MySQL user."""
        query = f"DROP USER IF EXISTS '{username}'@'{host}';"
        result = DatabaseService.mysql_execute(query, root_password=root_password)
        return result

    @staticmethod
    def mysql_grant_privileges(username, database, privileges='ALL', host='localhost', root_password=None):
        """Grant privileges to a MySQL user."""
        query = f"GRANT {privileges} ON `{database}`.* TO '{username}'@'{host}'; FLUSH PRIVILEGES;"
        result = DatabaseService.mysql_execute(query, root_password=root_password)
        return result

    @staticmethod
    def mysql_revoke_privileges(username, database, privileges='ALL', host='localhost', root_password=None):
        """Revoke privileges from a MySQL user."""
        query = f"REVOKE {privileges} ON `{database}`.* FROM '{username}'@'{host}'; FLUSH PRIVILEGES;"
        result = DatabaseService.mysql_execute(query, root_password=root_password)
        return result

    @staticmethod
    def mysql_get_user_privileges(username, host='localhost', root_password=None):
        """Get privileges for a MySQL user."""
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
            if root_password:
                cmd.append(f'-p{root_password}')
            cmd.append(database)

            # Pipe through gzip
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
    def mysql_restore(database, backup_path, root_password=None):
        """Restore a MySQL database from backup."""
        if not os.path.exists(backup_path):
            return {'success': False, 'error': 'Backup file not found'}

        try:
            cmd = ['mysql', '-u', 'root']
            if root_password:
                cmd.append(f'-p{root_password}')
            cmd.append(database)

            if backup_path.endswith('.gz'):
                # Decompress and restore
                gunzip = subprocess.Popen(['gunzip', '-c', backup_path], stdout=subprocess.PIPE)
                restore = subprocess.Popen(cmd, stdin=gunzip.stdout, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                gunzip.stdout.close()
                _, stderr = restore.communicate()

                if restore.returncode != 0:
                    return {'success': False, 'error': stderr.decode()}
            else:
                with open(backup_path, 'r') as f:
                    result = subprocess.run(cmd, stdin=f, capture_output=True, text=True)
                    if result.returncode != 0:
                        return {'success': False, 'error': result.stderr}

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
        try:
            result = subprocess.run(
                ['psql', '--version'],
                capture_output=True, text=True
            )
            return result.returncode == 0
        except FileNotFoundError:
            return False

    @staticmethod
    def pg_is_running():
        """Check if PostgreSQL is running."""
        try:
            result = subprocess.run(
                ['systemctl', 'is-active', 'postgresql'],
                capture_output=True, text=True
            )
            return result.returncode == 0
        except Exception:
            return False

    @staticmethod
    def pg_execute(query, database='postgres', user='postgres'):
        """Execute a PostgreSQL query."""
        try:
            cmd = ['sudo', '-u', 'postgres', 'psql', '-d', database, '-c', query, '-t', '-A']

            result = subprocess.run(cmd, capture_output=True, text=True)
            return {
                'success': result.returncode == 0,
                'output': result.stdout,
                'error': result.stderr if result.returncode != 0 else None
            }
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
        query = f"CREATE DATABASE \"{name}\" ENCODING '{encoding}'"
        if owner:
            query += f" OWNER \"{owner}\""
        query += ";"
        result = DatabaseService.pg_execute(query)
        return result

    @staticmethod
    def pg_drop_database(name):
        """Drop a PostgreSQL database."""
        # Terminate connections first
        DatabaseService.pg_execute(
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{name}';"
        )
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
        result = DatabaseService.pg_execute(
            f"CREATE USER \"{username}\" WITH PASSWORD '{password}';"
        )
        return result

    @staticmethod
    def pg_drop_user(username):
        """Drop a PostgreSQL user."""
        result = DatabaseService.pg_execute(f'DROP USER IF EXISTS "{username}";')
        return result

    @staticmethod
    def pg_grant_privileges(username, database, privileges='ALL'):
        """Grant privileges to a PostgreSQL user."""
        result = DatabaseService.pg_execute(
            f'GRANT {privileges} PRIVILEGES ON DATABASE "{database}" TO "{username}";'
        )
        return result

    @staticmethod
    def pg_revoke_privileges(username, database, privileges='ALL'):
        """Revoke privileges from a PostgreSQL user."""
        result = DatabaseService.pg_execute(
            f'REVOKE {privileges} PRIVILEGES ON DATABASE "{database}" FROM "{username}";'
        )
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
                    result = subprocess.run(cmd, stdin=f, capture_output=True, text=True)
                    if result.returncode != 0:
                        return {'success': False, 'error': result.stderr}

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
