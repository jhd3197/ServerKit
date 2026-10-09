"""Live database process inspection and termination.

Surfaces ``SHOW FULL PROCESSLIST`` (MySQL/MariaDB) and ``pg_stat_activity``
(PostgreSQL) for the Database Explorer, plus a kill/terminate action.

A *target* mirrors the explorer's connection shapes:

    {'engine': 'mysql'|'postgresql',   # which SQL dialect / client to use
     'container': None | 'name',       # set for Docker-hosted databases
     'user': ..., 'password': ...,     # optional credentials
     'database': ...}                  # optional (docker postgres only)

Every statement flows through the single :meth:`DbProcessService._exec_sql`
choke-point (which reuses the exact exec pathways the explorer already uses in
``DatabaseService``), so tests can stub one method to cover everything.
"""
from app.services import db_exec

SUPPORTED_ENGINES = ('mysql', 'postgresql')

_MYSQL_PROCESSLIST = 'SHOW FULL PROCESSLIST;'

# pid | usename | datname | state | time_s | query  (query LAST so the
# separator-based parse can never be broken by user SQL; newlines/tabs are
# flattened server-side for the same reason).
_PG_PROCESSLIST = (
    "SELECT pid, usename, datname, state, "
    "COALESCE(floor(extract(epoch FROM now() - query_start))::bigint, 0), "
    "regexp_replace(COALESCE(query, ''), E'[\\n\\r\\t]+', ' ', 'g') "
    "FROM pg_stat_activity "
    "WHERE pid <> pg_backend_pid() "
    "ORDER BY 5 DESC;"
)


class DbProcessService:
    """List and kill live server processes for MySQL/MariaDB and PostgreSQL."""

    # ------------------------------------------------------------------
    # Single exec choke-point
    # ------------------------------------------------------------------
    @staticmethod
    def _exec_sql(target, sql):
        """Run ``sql`` against the target's engine — via ``db_exec`` (§G5).

        The named seam stays (tests stub it); the engine × host dispatch it used
        to re-implement does not. The private docker-postgres branch here never
        set ``ON_ERROR_STOP=1``, so psql reported success for statements the
        server had rejected — the drift that made three copies worth one.
        """
        return db_exec.exec_sql(target, sql)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    @classmethod
    def list_processes(cls, target):
        """List live server processes, normalized across engines.

        Returns ``{'processes': [{id, user, db, state, command, time_s,
        query}, ...]}`` or ``{'error': msg}``.
        """
        engine = (target or {}).get('engine')
        if engine not in SUPPORTED_ENGINES:
            return {'error': 'unsupported engine', 'code': 'unsupported_engine'}

        sql = _MYSQL_PROCESSLIST if engine == 'mysql' else _PG_PROCESSLIST
        result = cls._exec_sql(target, sql)
        if not result.get('success'):
            return {'error': result.get('error') or 'failed to list processes'}

        output = result.get('output') or ''
        if engine == 'mysql':
            return {'processes': cls._parse_mysql_processlist(output)}
        return {'processes': cls._parse_pg_activity(output)}

    @classmethod
    def kill_process(cls, target, pid):
        """Kill/terminate a server process by id.

        MySQL: ``KILL <id>``; PostgreSQL: ``SELECT pg_terminate_backend(<pid>)``.
        ``pid`` is validated as an integer before it goes anywhere near SQL.
        """
        engine = (target or {}).get('engine')
        if engine not in SUPPORTED_ENGINES:
            return {'error': 'unsupported engine', 'code': 'unsupported_engine'}
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            return {'error': 'pid must be an integer'}

        if engine == 'mysql':
            sql = f'KILL {pid};'
        else:
            sql = f'SELECT pg_terminate_backend({pid});'

        result = cls._exec_sql(target, sql)
        if not result.get('success'):
            return {'error': result.get('error') or 'failed to kill process'}
        if engine == 'postgresql' and (result.get('output') or '').strip() == 'f':
            return {'error': 'process not found or could not be terminated'}
        return {'success': True, 'pid': pid}

    # ------------------------------------------------------------------
    # Output parsing / normalization
    # ------------------------------------------------------------------
    @staticmethod
    def _parse_mysql_processlist(output):
        """Parse tab-separated ``SHOW FULL PROCESSLIST`` batch output.

        Columns: Id, User, Host, db, Command, Time, State, Info. ``Info``
        (the query) is last, so a bounded split keeps embedded tabs safe —
        the mysql client already escapes newlines in batch mode.
        """
        processes = []
        lines = [ln for ln in output.split('\n') if ln.strip()]
        for line in lines:
            parts = line.split('\t', 7)
            if len(parts) < 7:
                continue
            try:
                proc_id = int(parts[0])
            except ValueError:
                continue  # header row ("Id\tUser\t...") or noise
            info = parts[7] if len(parts) > 7 else ''
            try:
                time_s = int(parts[5])
            except ValueError:
                time_s = 0
            processes.append({
                'id': proc_id,
                'user': parts[1],
                'db': None if parts[3] == 'NULL' else parts[3],
                'command': parts[4],
                'time_s': time_s,
                'state': parts[6],
                'query': '' if info in ('NULL', '') else info,
            })
        return processes

    @staticmethod
    def _parse_pg_activity(output):
        """Parse ``psql -t -A`` ('|'-separated, no header) activity rows.

        The query column is selected last and split with a bound, so query
        text containing '|' cannot shift fields.
        """
        processes = []
        for line in output.split('\n'):
            line = line.strip()
            if not line:
                continue
            parts = line.split('|', 5)
            if len(parts) < 6:
                continue
            try:
                pid = int(parts[0])
            except ValueError:
                continue
            try:
                time_s = int(float(parts[4])) if parts[4] else 0
            except ValueError:
                time_s = 0
            processes.append({
                'id': pid,
                'user': parts[1] or None,
                'db': parts[2] or None,
                'command': '',
                'time_s': time_s,
                'state': parts[3] or 'idle',
                'query': parts[5],
            })
        return processes
