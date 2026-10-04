import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Plus, Trash2, Check, AlertTriangle, Loader2, Table2, ShieldAlert, RefreshCw,
} from 'lucide-react';
import api from '../../services/api';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { EngineIcon } from '../icons/DatabaseBrands';
import EngineGlyph from './EngineGlyph';
import { runQuery, connKey, ENGINE_META } from './dbAdapter';
import { CopyButton } from '@/components/CopyButton';
import { Select, SelectTrigger, SelectContent, SelectGroup, SelectLabel, SelectItem, SelectValue } from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import {
    engineBrandKey, engineInitialDatabase, engineInstanceKey, engineMeta,
    engineTreeStatus, engineUnit, singular,
} from './engineHelpers';
import {
    DEFAULT_KEYWORD_LIST, SQL_DIALECTS, buildCreateTable, buildFamilyStatement,
    dialectOf, emptyColumn, familyTypes, familyWording, starterColumns,
    starterFields, validate,
} from './ddlBuilder';

// The column builder from the design mock, wired to the only thing that can
// actually create a table here: `POST /databases/<engine>/<db>/query` with
// `readonly: false`, which the backend gates on the admin role.
//
// Three honest states, never a fourth that pretends:
//
//  * a MySQL / PostgreSQL / SQLite / containerised-MySQL database → the
//    statement is generated, shown, and run on demand;
//  * an engine ServerKit installed but has no client bridge for (MongoDB,
//    Redis, Meilisearch, InfluxDB, Neo4j…) → the statement is generated in
//    that engine's own syntax and offered for copying, with the reason;
//  * a non-admin operator → the builder still generates and copies, and says
//    why it will not run.


function targetFromConn(conn, engine, label, sub) {
    const dialect = dialectOf(conn);
    return {
        key: `db:${connKey(conn)}`,
        kind: 'sql',
        conn,
        engine,
        label,
        sub,
        dialect,
        family: 'Relational',
        unit: 'tables',
        client: dialect ? SQL_DIALECTS[dialect].label : null,
        // A containerised PostgreSQL is reached through the container's
        // MySQL client, so there is no route for its DDL. Say so rather than
        // offering a button that fails.
        blockedReason: dialect
            ? null
            : 'ServerKit reaches containerised databases through the container\'s MySQL client, so it cannot run statements against a PostgreSQL container.',
    };
}

function targetFromEngine(instance) {
    const meta = engineMeta(instance);
    const unit = engineUnit(instance);
    return {
        key: `engine:${engineInstanceKey(instance)}`,
        kind: 'engine',
        instance,
        engine: engineBrandKey(instance),
        label: instance.name || instance.template_id,
        sub: meta.family || 'engine',
        dialect: null,
        family: meta.family || 'Relational',
        unit,
        client: meta.client || null,
        database: engineInitialDatabase(instance),
        blockedReason: `ServerKit runs ${instance.name || 'this engine'} but has no ${meta.client || 'client'} bridge, so it cannot create ${unit} for you.`,
    };
}

export default function CreateTableModal({ preset, engines = [], isAdmin = false, onClose, onCreated }) {
    const { t } = useTranslation();
    const [targets, setTargets] = useState(null); // null while loading
    const [loadFailed, setLoadFailed] = useState(false);
    const [targetKey, setTargetKey] = useState('');
    const [name, setName] = useState('');
    const [cols, setCols] = useState([]);
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState(null); // { ok, message }

    // The page re-polls its engine list while an install is in flight, so the
    // props change under us. Read them through refs: reloading the target list
    // mid-edit would throw away the columns being typed.
    const enginesRef = useRef(engines);
    enginesRef.current = engines;
    const presetRef = useRef(preset);
    presetRef.current = preset;

    // The four listings the explorer's tree is built from. Each one is allowed
    // to fail on its own — a stopped PostgreSQL must not hide a running MySQL.
    const load = useCallback(async () => {
        setTargets(null);
        setLoadFailed(false);
        const [my, pg, lite, dock] = await Promise.allSettled([
            api.getMySQLDatabases(),
            api.getPostgreSQLDatabases(),
            api.getSQLiteDatabases(),
            api.getAllDockerDatabases(),
        ]);
        const out = [];
        if (my.status === 'fulfilled') {
            (my.value?.databases || []).forEach((db) => out.push(
                targetFromConn({ dbType: 'mysql', name: db.name }, 'mysql', db.name, ENGINE_META.mysql.short),
            ));
        }
        if (pg.status === 'fulfilled') {
            (pg.value?.databases || []).forEach((db) => out.push(
                targetFromConn({ dbType: 'postgresql', name: db.name }, 'postgresql', db.name, ENGINE_META.postgresql.short),
            ));
        }
        if (lite.status === 'fulfilled') {
            (lite.value?.databases || []).forEach((db) => out.push(
                targetFromConn({ dbType: 'sqlite', name: db.name, path: db.path }, 'sqlite', db.name, db.path),
            ));
        }
        if (dock.status === 'fulfilled') {
            (dock.value?.databases || []).forEach((db) => out.push(targetFromConn(
                {
                    dbType: 'docker',
                    container: db.container,
                    name: db.database,
                    password: db.password || db.root_password,
                    user: db.user,
                    dockerType: db.type,
                },
                db.type || 'docker',
                db.database || 'default',
                db.app_name ? `${db.app_name} · container` : 'container',
            )));
        }

        // Engines ServerKit installed but speaks no protocol for. Listed so the
        // builder can still write their syntax — the mock's family awareness,
        // without the mock's pretend execution.
        enginesRef.current
            .filter((e) => engineTreeStatus(e) === 'active')
            .filter((e) => !['mysql', 'postgresql'].includes(engineMeta(e).protocol))
            .forEach((e) => out.push(targetFromEngine(e)));

        if (my.status === 'rejected' && pg.status === 'rejected'
            && lite.status === 'rejected' && dock.status === 'rejected') {
            setLoadFailed(true);
        }

        // A right-clicked node always works, even when its listing failed.
        const seed = presetRef.current;
        if (seed?.conn) {
            const presetTarget = targetFromConn(
                seed.conn, seed.engine, seed.label || 'database', 'selected in the tree',
            );
            const existing = out.find((t) => t.key === presetTarget.key);
            if (!existing) out.unshift(presetTarget);
            setTargetKey(presetTarget.key);
        } else if (out.length) {
            setTargetKey((cur) => (out.some((t) => t.key === cur) ? cur : out[0].key));
        }
        setTargets(out);
    }, []);

    useEffect(() => { load(); }, [load]);

    const target = useMemo(
        () => (targets || []).find((t) => t.key === targetKey) || null,
        [targets, targetKey],
    );

    // Each engine shape gets its own starter rows — a document store opening on
    // `id BIGINT AUTO_INCREMENT` would be nonsense. Keyed on the target's id,
    // not the object, so a re-listing never wipes work in progress.
    useEffect(() => {
        const picked = (targets || []).find((t) => t.key === targetKey);
        if (!picked) return;
        setCols(picked.dialect ? starterColumns(picked.dialect) : starterFields(picked.family));
        setResult(null);
    }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps

    const unitOne = singular(target?.unit || 'tables');
    const words = familyWording(target?.dialect ? 'Relational' : target?.family);
    const types = target?.dialect ? SQL_DIALECTS[target.dialect].types : familyTypes(target?.family);
    const canRun = Boolean(target && target.dialect && isAdmin && !result?.ok);

    const issues = useMemo(
        () => (target ? validate({ table: name, columns: cols, unitOne }) : []),
        [target, name, cols, unitOne],
    );

    const statement = useMemo(() => {
        if (!target) return '';
        if (target.dialect) {
            return buildCreateTable({
                conn: target.conn, dialect: target.dialect, table: name, columns: cols,
            });
        }
        return buildFamilyStatement({
            family: target.family, name, database: target.database, fields: cols,
        });
    }, [target, name, cols]);

    const setCol = (i, key, value) => setCols((prev) => prev.map((c, j) => (j === i ? { ...c, [key]: value } : c)));
    const setKeyCol = (i) => setCols((prev) => prev.map((c, j) => ({ ...c, pk: j === i ? !c.pk : false })));
    const addCol = () => setCols((prev) => [...prev, target?.dialect ? emptyColumn(target.dialect) : { name: '', type: types[0], pk: false, notNull: false, def: '' }]);
    const removeCol = (i) => setCols((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev));

    async function run() {
        if (!canRun || issues.length) return;
        setBusy(true);
        setResult(null);
        try {
            const res = await runQuery(target.conn, statement, false);
            if (res?.success) {
                setResult({ ok: true, message: `${unitOne.charAt(0).toUpperCase()}${unitOne.slice(1)} "${name.trim()}" created in ${target.label}.` });
                onCreated?.(target);
            } else {
                setResult({ ok: false, message: res?.error || 'The database rejected the statement.' });
            }
        } catch (err) {
            setResult({
                ok: false,
                message: err?.status === 403
                    ? 'Your account is not an administrator, so ServerKit will not run write statements for it.'
                    : (err?.message || 'The request failed.'),
            });
        } finally {
            setBusy(false);
        }
    }


    const footer = (
        <>
            <Button type="button" variant="outline" onClick={onClose}>
                {result?.ok ? 'Done' : 'Cancel'}
            </Button>
            {statement && (
                <CopyButton
                    value={statement}
                    variant="outline"
                    size="default"
                    label={t('app.createTableModal.copyStatement', 'Copy statement')}
                    copiedLabel={t('app.copyField.copied', 'Copied')}
                >
                    {t('app.createTableModal.copyStatement', 'Copy statement')}
                </CopyButton>
            )}
            {canRun && (
                <Button type="button" onClick={run} disabled={busy || issues.length > 0}>
                    {busy
                        ? <Loader2 size={14} className="dbx-spin" aria-hidden="true" />
                        : <Plus size={14} aria-hidden="true" />}
                    {busy ? 'Running…' : `Create ${unitOne}`}
                </Button>
            )}
        </>
    );

    return (
        <Modal open onClose={onClose} title={t('app.createTableModal.new', 'New {{unitOne}}', { unitOne: unitOne })} size="xl" footer={footer}>
            {targets === null ? (
                <p className="dbx-builder__loading">
                    <Loader2 size={15} className="dbx-spin" aria-hidden="true" /> {t('app.createTableModal.lookingForDatabases', 'Looking for databases…')}
                </p>
            ) : !targets.length ? (
                <div className="dbx-notice dbx-notice--info">
                    <AlertTriangle size={15} aria-hidden="true" />
                    <div>
                        <strong>{t('app.createTableModal.nothingToCreateIntoYet', 'Nothing to create into yet.')}</strong>
                        <p>
                            {loadFailed
                                ? 'ServerKit could not reach any database server. Check that MySQL or PostgreSQL is running, then try again.'
                                : 'Create a database first — the builder writes into an existing one.'}
                        </p>
                        <Button variant="unstyled" type="button" className="dbx-inline-link" onClick={load}>
                            <RefreshCw size={13} aria-hidden="true" /> {t('app.createTableModal.tryAgain', 'Try again')}
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="dbx-builder">
                    {loadFailed && (
                        <div className="dbx-notice dbx-notice--warn">
                            <AlertTriangle size={15} aria-hidden="true" />
                            <div><p>{t('app.createTableModal.someDatabaseServersDidNotAnswer', 'Some database servers did not answer, so this list may be incomplete.')}</p></div>
                        </div>
                    )}

                    <div className="dbx-field-row">
                        <div className="dbx-field">
                            <label className="dbx-field__label" htmlFor="dbx-builder-target">{t('app.createTableModal.database', 'Database')}</label>
                            <Select value={targetKey} onValueChange={setTargetKey}>
                                <SelectTrigger id="dbx-builder-target" className="dbx-select">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {targets.some((row) => row.dialect) && (
                                        <SelectGroup>
                                            <SelectLabel>{t('app.createTableModal.databasesServerkitCanWriteTo', 'Databases ServerKit can write to')}</SelectLabel>
                                            {targets.filter((row) => row.dialect).map((row) => (
                                                <SelectItem key={row.key} value={row.key}>{row.label} · {row.sub}</SelectItem>
                                            ))}
                                        </SelectGroup>
                                    )}
                                    {targets.some((row) => !row.dialect) && (
                                        <SelectGroup>
                                            <SelectLabel>{t('app.createTableModal.generateOnlyNoClientBridge', 'Generate only (no client bridge)')}</SelectLabel>
                                            {targets.filter((row) => !row.dialect).map((row) => (
                                                <SelectItem key={row.key} value={row.key}>{row.label} · {row.sub}</SelectItem>
                                            ))}
                                        </SelectGroup>
                                    )}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="dbx-field">
                            <label className="dbx-field__label" htmlFor="dbx-builder-name">
                                {unitOne.charAt(0).toUpperCase() + unitOne.slice(1)} name
                            </label>
                            <div className="dbx-input">
                                <Table2 size={15} aria-hidden="true" />
                                <input
                                    id="dbx-builder-name"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    placeholder={target?.dialect ? 'orders' : 'users'}
                                    spellCheck="false"
                                    autoFocus
                                />
                            </div>
                        </div>
                    </div>

                    {target && (
                        <p className="dbx-builder__target">
                            <span className="dbx-builder__target-ico">
                                {target.instance
                                    ? <EngineGlyph entry={target.instance} size={15} />
                                    : <EngineIcon engine={target.engine || 'database'} size={15} />}
                            </span>
                            {target.dialect
                                ? <>{t('app.createTableModal.statementsRunAs', 'Statements run as')} {SQL_DIALECTS[target.dialect].label} against <code>{target.label}</code>.</>
                                : <>{target.blockedReason}</>}
                        </p>
                    )}

                    {target && !target.dialect && target.client && (
                        <div className="dbx-notice dbx-notice--info">
                            <AlertTriangle size={15} aria-hidden="true" />
                            <div>
                                <strong>{t('app.createTableModal.copyThisInto', 'Copy this into')} {target.client}.</strong>
                                <p>{t('app.createTableModal.theBuilderWritesTheStatementRunning', 'The builder writes the statement; running it is a step you take in the engine\'s own client.')}</p>
                            </div>
                        </div>
                    )}

                    {target?.dialect && !isAdmin && (
                        <div className="dbx-notice dbx-notice--warn">
                            <ShieldAlert size={15} aria-hidden="true" />
                            <div>
                                <strong>{t('app.createTableModal.readOnlyAccount', 'Read-only account.')}</strong>
                                <p>{t('app.createTableModal.creatingA', 'Creating a')} {unitOne} {t('app.createTableModal.isAWriteStatementAndOnly', 'is a write statement, and only administrators may run those. You can still build and copy it.')}</p>
                            </div>
                        </div>
                    )}

                    <div className="dbx-field">
                        <span className="dbx-field__label">{words.fields}</span>
                        <div className="dbx-colgrid">
                            <div className="dbx-colgrid__head">
                                <span>{t('common.labels.name', 'Name')}</span>
                                <span>{t('common.labels.type', 'Type')}</span>
                                <span>{words.key}</span>
                                <span>{words.required}</span>
                                <span>{t('common.labels.default', 'Default')}</span>
                                <span aria-hidden="true" />
                            </div>
                            <div className="dbx-colgrid__rows">
                                {cols.map((c, i) => (
                                    // Rows are positional and reorderable only by
                                    // add/remove, so the index is their identity.
                                    <div className="dbx-colgrid__row" key={i}>
                                        <div className="dbx-input dbx-input--sm">
                                            <input
                                                value={c.name}
                                                onChange={(e) => setCol(i, 'name', e.target.value)}
                                                placeholder={target?.dialect ? 'column' : 'field'}
                                                spellCheck="false"
                                                aria-label={t('app.createTableModal.nameOfColumn', 'Name of column {{value}}', { value: i + 1 })}
                                            />
                                        </div>
                                        <Select value={c.type} onValueChange={(value) => setCol(i, 'type', value)}>
                                            <SelectTrigger
                                                className="dbx-select dbx-select--sm"
                                                aria-label={t('app.createTableModal.typeOfColumn', 'Type of column {{value}}', { value: i + 1 })}
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {types.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <Button variant="unstyled"
                                            type="button"
                                            className={`dbx-cbox${c.pk ? ' is-on' : ''}`}
                                            onClick={() => setKeyCol(i)}
                                            aria-pressed={Boolean(c.pk)}
                                            aria-label={t('app.createTableModal.onColumn', '{{key}} on column {{value}}', { key: words.key, value: i + 1 })}
                                        >
                                            {c.pk && <Check size={12} aria-hidden="true" />}
                                        </Button>
                                        <Button variant="unstyled"
                                            type="button"
                                            className={`dbx-cbox${c.notNull ? ' is-on' : ''}`}
                                            onClick={() => setCol(i, 'notNull', !c.notNull)}
                                            aria-pressed={Boolean(c.notNull)}
                                            aria-label={t('app.createTableModal.onColumn2', '{{required}} on column {{value}}', { required: words.required, value: i + 1 })}
                                        >
                                            {c.notNull && <Check size={12} aria-hidden="true" />}
                                        </Button>
                                        <div className="dbx-input dbx-input--sm">
                                            <input
                                                value={c.def}
                                                onChange={(e) => setCol(i, 'def', e.target.value)}
                                                placeholder="—"
                                                spellCheck="false"
                                                aria-label={t('app.createTableModal.defaultForColumn', 'Default for column {{value}}', { value: i + 1 })}
                                            />
                                        </div>
                                        <Button variant="unstyled"
                                            type="button"
                                            className="dbx-icon-xs"
                                            onClick={() => removeCol(i)}
                                            disabled={cols.length < 2}
                                            aria-label={t('app.createTableModal.removeColumn', 'Remove column {{value}}', { value: i + 1 })}
                                        >
                                            <Trash2 size={13} aria-hidden="true" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            <Button variant="unstyled" type="button" className="dbx-inline-link dbx-colgrid__add" onClick={addCol}>
                                <Plus size={13} aria-hidden="true" /> {t('common.actions.add', 'Add')} {target?.dialect ? 'column' : 'field'}
                            </Button>
                        </div>
                        <p className="dbx-field-hint">
                            {target?.dialect ? (
                                <>
                                    {t('app.createTableModal.aWholeNumberKeyBecomes', 'A whole-number key becomes')} <code>{SQL_DIALECTS[target.dialect].keyNote}</code>.
                                    Defaults: numbers stay numbers, {DEFAULT_KEYWORD_LIST.join(' / ')} {t('app.createTableModal.stayKeywordsAnythingElseIsQuoted', 'stay keywords, anything else is quoted as text.')}
                                </>
                            ) : (
                                <>{t('app.createTableModal.fieldNamesAndTypesAreWritten', 'Field names and types are written into the statement below exactly as typed.')}</>
                            )}
                        </p>
                    </div>

                    <div className="dbx-field">
                        <span className="dbx-field__label">
                            {target?.dialect ? 'Will run' : `${target?.client || 'Client'} statement`}
                        </span>
                        <pre className="dbx-sqlprev">{statement}</pre>
                    </div>

                    {issues.length > 0 && (
                        <ul className="dbx-issues">
                            {issues.map((issue) => (
                                <li key={issue}><AlertTriangle size={13} aria-hidden="true" /> {issue}</li>
                            ))}
                        </ul>
                    )}

                    {result && (
                        <div className={`dbx-notice ${result.ok ? 'dbx-notice--ok' : 'dbx-notice--error'}`}>
                            {result.ok
                                ? <Check size={15} aria-hidden="true" />
                                : <AlertTriangle size={15} aria-hidden="true" />}
                            <div><p>{result.message}</p></div>
                        </div>
                    )}
                </div>
            )}
        </Modal>
    );
}
