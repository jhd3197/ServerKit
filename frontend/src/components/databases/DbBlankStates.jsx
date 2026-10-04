import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    Loader2, Plus, Terminal, Table2, Activity, RefreshCw, ShieldAlert, Layers, Database, Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '../../services/api';
import EngineGlyph from './EngineGlyph';
import { useTranslation } from 'react-i18next';
import {
    engineInitialDatabase, engineInstanceKey, engineLocation, engineMeta,
    engineTreeStatus, engineUnit, singular,
} from './engineHelpers';

// The three states the workspace can be in when there is nothing to show yet.
// Each one names what is happening and offers the single next step, rather than
// leaving an empty pane and a shrug.

// An engine template whose deploy is still running.
export function EngineInstallingPanel({ instance, onRefresh }) {
    const { t } = useTranslation();
    const failed = engineTreeStatus(instance) === 'failed';
    const meta = engineMeta(instance);
    const initialDb = engineInitialDatabase(instance);
    const appId = engineInstanceKey(instance);

    // The engine listing is a description of an Application, not of a run, so it
    // carries no job id. Resolve it from the same /deployment-jobs feed the
    // console reads — an engine install is an ordinary deployment and belongs in
    // that surface, not in a bespoke progress view here. Fail soft: without an
    // id the panel still points at Deploy Activity.
    const [jobId, setJobId] = useState(instance?.deploy_job_id || null);
    useEffect(() => {
        if (instance?.deploy_job_id) { setJobId(instance.deploy_job_id); return undefined; }
        if (appId == null) { setJobId(null); return undefined; }
        let cancelled = false;
        api.getDeploymentJobs({ appId, limit: 1 })
            .then((data) => { if (!cancelled) setJobId(data?.jobs?.[0]?.id || null); })
            .catch(() => { /* no job feed, no link */ });
        return () => { cancelled = true; };
    }, [appId, instance?.deploy_job_id]);

    return (
        <div className="dbx-blank">
            <div className={`dbx-blank__icon${failed ? ' is-failed' : ''}`}>
                <EngineGlyph entry={instance} size={24} />
                {!failed && <Loader2 size={52} className="dbx-blank__spin dbx-spin" aria-hidden="true" />}
            </div>

            {failed ? (
                <>
                    <h2 className="dbx-blank__title">
                        <ShieldAlert size={17} aria-hidden="true" /> {instance.name} {t('app.dbBlankStates.failedToInstall', "didn't install")}
                    </h2>
                    <p className="dbx-blank__body">
                        {instance.error_message
                            || t('app.dbBlankStates.deployDidNotFinish', "The deploy didn't finish. The install log has the reason.")}
                    </p>
                </>
            ) : (
                <>
                    <h2 className="dbx-blank__title">{t('app.dbBlankStates.installingName', 'Installing {{name}}', { name: instance.name })}</h2>
                    <p className="dbx-blank__body">
                        {meta.family
                            ? t('app.dbBlankStates.pullingImageOnEngine', 'Pulling the image, provisioning the volume and waiting for the first health check on this {{family}} engine.', { family: meta.family.toLowerCase() })
                            : t('app.dbBlankStates.pullingImage', 'Pulling the image, provisioning the volume and waiting for the first health check.')}
                        {' '}{t('app.dbBlankStates.usuallyAboutAMinute', 'This usually takes about a minute.')}
                    </p>
                </>
            )}

            <div className="dbx-blank__actions">
                {jobId && (
                    <Button asChild size="sm">
                        <Link to={`/deployments/${jobId}`}>
                            <Terminal size={14} aria-hidden="true" /> {t('app.dbBlankStates.viewInstallLog', 'View install log')}
                        </Link>
                    </Button>
                )}
                <Button asChild size="sm" variant="outline">
                    <Link to="/deployments"><Activity size={14} aria-hidden="true" /> {t('app.dbBlankStates.deployActivity', 'Deploy activity')}</Link>
                </Button>
                {onRefresh && (
                    <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
                        <RefreshCw size={14} aria-hidden="true" /> {t('app.dbBlankStates.checkAgain', 'Check again')}
                    </Button>
                )}
            </div>

            {initialDb && !failed && (
                <p className="dbx-blank__note">
                    <Plus size={12} aria-hidden="true" />
                    {initialDb} {t('app.dbBlankStates.willBeCreatedOnceTheEngine', 'will be created once the engine reports healthy')}
                </p>
            )}
        </div>
    );
}

// An engine that is up but has nothing in it yet — either a host engine
// (MySQL / PostgreSQL) with no databases, or a freshly installed one.
export function EngineReadyPanel({ instance, label, onNewDatabase, onOpenConsole }) {
    const { t } = useTranslation();
    const meta = engineMeta(instance);
    const address = engineLocation(instance);
    const unitOne = singular(engineUnit(instance));
    const initialDb = engineInitialDatabase(instance);

    return (
        <div className="dbx-blank">
            <div className="dbx-blank__icon">
                <EngineGlyph entry={instance} size={24} />
            </div>
            <h2 className="dbx-blank__title">{label || instance?.name} {t('app.dbBlankStates.isReady', 'is ready')}</h2>
            <p className="dbx-blank__body">
                {address ? <>{t('app.dbBlankStates.listeningOn', 'Listening on')} <code>{address}</code>. </> : null}
                {onNewDatabase ? (
                    t('app.dbBlankStates.createDatabaseToStart', 'Create a database to start writing to it.')
                ) : (
                    <>
                        {t('app.dbBlankStates.createUnitFrom', 'Create a {{unit}} from', { unit: unitOne })}{' '}
                        {meta.client ? <code>{meta.client}</code> : t('app.dbBlankStates.itsClient', 'its client')}
                        {' '}{t('app.dbBlankStates.serverkitListsItHereAsSoon', '(ServerKit lists it here as soon as it exists).')}
                    </>
                )}
            </p>
            <div className="dbx-blank__actions">
                {onNewDatabase && (
                    <Button type="button" size="sm" onClick={onNewDatabase}>
                        <Plus size={14} aria-hidden="true" /> {t('app.dbBlankStates.newDatabase', 'New database')}
                    </Button>
                )}
                {onOpenConsole && (
                    <Button type="button" size="sm" variant="outline" onClick={onOpenConsole}>
                        <Terminal size={14} aria-hidden="true" /> {t('app.dbBlankStates.openSqlConsole', 'Open SQL console')}
                    </Button>
                )}
                {instance?.app_id != null && (
                    <Button asChild size="sm" variant="outline">
                        <Link to={`/services/${instance.app_id}`}>
                            <Layers size={14} aria-hidden="true" /> {t('app.dbBlankStates.manageService', 'Manage service')}
                        </Link>
                    </Button>
                )}
            </div>
            {/* The database the install was asked to seed. Naming it is what
                makes arriving here from a finished deploy feel like landing on
                the thing you created. */}
            {initialDb && (
                <p className="dbx-blank__note">
                    <Database size={12} aria-hidden="true" />
                    {initialDb} {t('app.dbBlankStates.wasCreatedOnInstall', 'was created on install')}
                </p>
            )}
            {meta.protocol === 'none' && (
                <p className="dbx-blank__note">
                    {t('app.dbBlankStates.thisEngineHasNoBrowsableProtocol', 'This engine has no browsable protocol. ServerKit runs it, but table browsing comes from its own client.')}
                </p>
            )}
        </div>
    );
}

// A database that exists but holds no tables/collections yet. The two ways to
// put something in it — build it column by column, or replay a dump — are the
// primary actions; the console stays as the way to do anything else.
export function DatabaseEmptyPanel({ node, unit = 'tables', onNewTable, onImport, onOpenConsole }) {
    const { t } = useTranslation();
    const unitOne = singular(unit);
    return (
        <div className="dbx-blank">
            <div className="dbx-blank__icon">
                <Table2 size={24} aria-hidden="true" />
            </div>
            <h2 className="dbx-blank__title">No {unit} in {node?.label}</h2>
            <p className="dbx-blank__body">
                {t('app.dbBlankStates.theDatabaseIsConnectedAndEmpty', 'The database is connected and empty. Build your first')} {unitOne}{t('app.dbBlankStates.importADumpOrWriteThe', ', import a dump, or write the statement yourself in the console.')}
            </p>
            <div className="dbx-blank__actions">
                {onNewTable && (
                    <Button type="button" size="sm" onClick={onNewTable}>
                        <Plus size={14} aria-hidden="true" /> {t('app.dbBlankStates.new', 'New')} {unitOne}
                    </Button>
                )}
                {onImport && (
                    <Button type="button" size="sm" variant="outline" onClick={onImport}>
                        <Download size={14} aria-hidden="true" /> {t('app.dbBlankStates.importDump', 'Import dump')}
                    </Button>
                )}
                {onOpenConsole && (
                    <Button type="button" size="sm" variant="outline" onClick={onOpenConsole}>
                        <Terminal size={14} aria-hidden="true" /> {t('app.dbBlankStates.openSqlConsole', 'Open SQL console')}
                    </Button>
                )}
            </div>
        </div>
    );
}
