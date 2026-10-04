"""Read-only database visibility: top queries and health gauges (plan 86 §A3).

For the Database Explorer's Insights tab, per server or container, with the
same target shape as :mod:`db_process_service`:

* **gauges**: connections in use vs ``max_connections``, and the cache hit
  ratio (PostgreSQL ``pg_stat_database`` ``blks_hit/blks_read``, InnoDB buffer
  pool ``read_requests/reads``);
* **top queries** by total time: ``pg_stat_statements`` and
  ``performance_schema.events_statements_summary_by_digest``. Each needs the
  engine to be collecting; when it is not, the response says why and what
  turns it on (``DbConfigTunerService.enable_pg_stat_statements``, or
  ``performance_schema=ON`` for MariaDB, where it is off by default).

Nothing here writes. Status counters come from ``SHOW GLOBAL STATUS``, which
works on MySQL and MariaDB alike (MySQL 8 has no
``information_schema.GLOBAL_STATUS``, MariaDB often runs with
``performance_schema`` off).
"""
from typing import Dict, List, Optional

from app.services import db_exec

SUPPORTED_ENGINES = ('mysql', 'postgresql')
TOP_LIMIT = 20

_PG_GAUGES = (
    "SELECT (SELECT setting FROM pg_settings WHERE name = 'max_connections'), "
    "(SELECT count(*) FROM pg_stat_activity), "
    "COALESCE(sum(blks_hit), 0), COALESCE(sum(blks_read), 0), "
    "(SELECT count(*) FROM pg_extension WHERE extname = 'pg_stat_statements'), "
    "(SELECT count(*) FROM pg_settings WHERE name = 'shared_preload_libraries' "
    "AND setting LIKE '%pg_stat_statements%') "
    "FROM pg_stat_database;"
)
# calls | total ms | mean ms | rows | query (LAST, flattened server-side, so a
# tab or newline in user SQL can never shift the columns).
_PG_TOP = (
    "SELECT calls, round(total_exec_time::numeric, 1), round(mean_exec_time::numeric, 2), "
    "rows, regexp_replace(query, E'[\\n\\r\\t]+', ' ', 'g') "
    f"FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT {TOP_LIMIT};"
)
_MYSQL_STATUS = (
    "SHOW GLOBAL STATUS WHERE Variable_name IN "
    "('Threads_connected', 'Innodb_buffer_pool_read_requests', 'Innodb_buffer_pool_reads');"
)
# Timer columns are picoseconds; /1e9 = milliseconds.
_MYSQL_TOP = (
    "SELECT COUNT_STAR, ROUND(SUM_TIMER_WAIT / 1e9, 1), ROUND(AVG_TIMER_WAIT / 1e9, 2), "
    "SUM_ROWS_SENT, REPLACE(REPLACE(REPLACE(DIGEST_TEXT, '\\n', ' '), '\\r', ' '), '\\t', ' ') "
    "FROM performance_schema.events_statements_summary_by_digest "
    f"WHERE DIGEST_TEXT IS NOT NULL ORDER BY SUM_TIMER_WAIT DESC LIMIT {TOP_LIMIT};"
)


def _rows(output: str) -> List[List[str]]:
    return [line.split('\t') for line in (output or '').splitlines() if line.strip()]


def _ratio(hits: float, misses: float) -> Optional[float]:
    total = hits + misses
    return hits / total if total > 0 else None


def _num(value, cast=float):
    try:
        return cast(value)
    except (TypeError, ValueError):
        return None


def _queries(rows) -> List[Dict]:
    out = []
    for row in rows:
        if len(row) < 5:
            continue
        out.append({'calls': _num(row[0], int), 'total_ms': _num(row[1]),
                    'mean_ms': _num(row[2]), 'rows': _num(row[3], int),
                    'query': '\t'.join(row[4:]).strip()})
    return out


class DbInsightsService:

    @staticmethod
    def _exec_sql(target, sql):
        """One exec seam (tests stub it), parse-friendly output."""
        return db_exec.exec_sql(target, sql, machine_readable=True)

    @classmethod
    def insights(cls, target) -> Dict:
        engine = (target.get('engine') or '').lower()
        engine = 'postgresql' if engine in db_exec.POSTGRES_ALIASES else engine
        engine = 'mysql' if engine in db_exec.MYSQL_ALIASES else engine
        if engine not in SUPPORTED_ENGINES:
            return {'error': 'unsupported engine', 'code': 'unsupported_engine'}
        if not target.get('container'):
            # Dockerised engines only (the host executors don't return
            # parse-friendly output).
            return {'error': 'insights need a Docker database container'}
        target = dict(target, engine=engine)
        return cls._postgres(target) if engine == 'postgresql' else cls._mysql(target)

    @classmethod
    def _postgres(cls, target) -> Dict:
        res = cls._exec_sql(target, _PG_GAUGES)
        if not res['success']:
            return {'error': res.get('error') or 'query failed'}
        row = (_rows(res['output']) or [[]])[0]
        if len(row) < 6:
            return {'error': 'unexpected output from pg_stat_database'}
        max_conn, in_use, hit, read, has_ext, preloaded = row[:6]
        result = {
            'engine': 'postgresql',
            'connections': {'in_use': _num(in_use, int), 'max': _num(max_conn, int)},
            'cache_hit_ratio': _ratio(_num(hit) or 0, _num(read) or 0),
            'top_queries': [],
            'top_queries_source': 'pg_stat_statements',
        }
        if _num(has_ext, int):
            top = cls._exec_sql(target, _PG_TOP)
            if top['success']:
                result['top_queries'] = _queries(_rows(top['output']))
                result['top_queries_available'] = True
                return result
            result['top_queries_reason'] = top.get('error') or 'pg_stat_statements query failed'
        elif _num(preloaded, int):
            result['top_queries_reason'] = ('pg_stat_statements is preloaded but the extension '
                                            'is not created in this database')
        else:
            result['top_queries_reason'] = 'pg_stat_statements is not enabled'
        result['top_queries_available'] = False
        result['can_enable'] = bool(target.get('container'))
        return result

    @classmethod
    def _mysql(cls, target) -> Dict:
        res = cls._exec_sql(target, _MYSQL_STATUS)
        if not res['success']:
            return {'error': res.get('error') or 'query failed'}
        status = {row[0]: row[1] for row in _rows(res['output']) if len(row) >= 2}
        max_conn = cls._exec_sql(target, 'SELECT @@max_connections;')
        max_value = (_rows(max_conn['output']) or [[None]])[0][0] if max_conn['success'] else None
        requests = _num(status.get('Innodb_buffer_pool_read_requests')) or 0
        disk_reads = _num(status.get('Innodb_buffer_pool_reads')) or 0
        result = {
            'engine': 'mysql',
            'connections': {'in_use': _num(status.get('Threads_connected'), int),
                            'max': _num(max_value, int)},
            # read_requests counts every logical read; reads are the misses
            # that went to disk.
            'cache_hit_ratio': _ratio(max(requests - disk_reads, 0), disk_reads),
            'top_queries': [],
            'top_queries_source': 'performance_schema',
        }
        top = cls._exec_sql(target, _MYSQL_TOP)
        if top['success']:
            result['top_queries'] = _queries(_rows(top['output']))
            result['top_queries_available'] = True
        else:
            result['top_queries_available'] = False
            result['top_queries_reason'] = (
                'performance_schema is not collecting statement digests '
                '(set performance_schema=ON; it is off by default on MariaDB)')
        return result
