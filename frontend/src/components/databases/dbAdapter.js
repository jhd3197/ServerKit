// Unifies the four database backends (MySQL, PostgreSQL, SQLite, Docker) behind
// one small interface so the explorer's tree and tabs don't branch on engine
// everywhere. A `conn` describes one queryable database:
//   { dbType, name?, path?, container?, password?, user?, dockerType? }

import { api } from '../../services/api';

// Engine display metadata. Brand accents live in SCSS via `.is-<engine>` so the
// tree icons tint without inline styles.
export const ENGINE_META = {
    mysql:      { labelKey: 'app.dbAdapter.mysqlMariadb', label: 'MySQL / MariaDB', short: 'MySQL' },
    postgresql: { labelKey: 'app.dbAdapter.postgresql', label: 'PostgreSQL',      short: 'PostgreSQL' },
    sqlite:     { labelKey: 'app.dbAdapter.sqlite', label: 'SQLite',          short: 'SQLite' },
    docker:     { labelKey: 'app.dbAdapter.dockerApps', label: 'Docker services',     short: 'Docker' },
};

// A docker container can host either engine; everything else maps 1:1.
function quotingDialect(conn) {
    if (conn.dbType === 'postgresql' || conn.dbType === 'sqlite') return 'ansi';
    if (conn.dbType === 'docker' && conn.dockerType === 'postgresql') return 'ansi';
    return 'backtick';
}

// Quote an identifier so table names with mixed case or reserved words survive.
export function quoteIdent(conn, ident) {
    if (quotingDialect(conn) === 'ansi') {
        return '"' + String(ident).replace(/"/g, '""') + '"';
    }
    return '`' + String(ident).replace(/`/g, '``') + '`';
}

// Stable identity for a connection — used to key consoles and query history.
export function connKey(conn) {
    if (!conn) return '';
    if (conn.dbType === 'sqlite') return `sqlite:${conn.path}`;
    if (conn.dbType === 'docker') return `docker:${conn.container}:${conn.name || ''}`;
    return `${conn.dbType}:${conn.name}`;
}

export function connLabel(conn) {
    if (!conn) return '';
    if (conn.dbType === 'sqlite') return conn.name || conn.path?.split('/').pop() || 'database';
    return conn.name || conn.container || 'database';
}

export async function listTables(conn) {
    switch (conn.dbType) {
        case 'mysql':      return api.getMySQLTables(conn.name);
        case 'postgresql': return api.getPostgreSQLTables(conn.name);
        case 'sqlite':     return api.getSQLiteTables(conn.path);
        case 'docker':     return api.getDockerDatabaseTables(conn.container, conn.name, conn.password, conn.user);
        default:           return { tables: [] };
    }
}

// Docker has no structure endpoint; callers should treat `unsupported` as
// "show data only" rather than an error.
export async function getStructure(conn, table) {
    switch (conn.dbType) {
        case 'mysql':      return api.getMySQLTableStructure(conn.name, table);
        case 'postgresql': return api.getPostgreSQLTableStructure(conn.name, table);
        case 'sqlite':     return api.getSQLiteTableStructure(conn.path, table);
        default:           return { success: false, unsupported: true };
    }
}

export async function runQuery(conn, sql, readonly) {
    switch (conn.dbType) {
        case 'mysql':      return api.executeMySQLQuery(conn.name, sql, readonly);
        case 'postgresql': return api.executePostgreSQLQuery(conn.name, sql, readonly);
        case 'sqlite':     return api.executeSQLiteQuery(conn.path, sql, readonly);
        case 'docker':     return api.executeDockerQuery(conn.container, conn.name, sql, conn.password, readonly, conn.user);
        default:           return { success: false, error: 'Unknown database type' };
    }
}

// Browse-a-table query, built per dialect. Docker MySQL/PostgreSQL both accept
// LIMIT/OFFSET so one shape covers every backend we target.
export function buildBrowseQuery(conn, table, { limit, offset }) {
    return `SELECT * FROM ${quoteIdent(conn, table)} LIMIT ${limit} OFFSET ${offset};`;
}
