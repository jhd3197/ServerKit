import { useCallback, useEffect, useState } from 'react';
import { Ban, Eye, EyeOff, PackageX } from 'lucide-react';
import api from '../../services/api';
import Modal from '@/components/Modal';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ds';
import { formatRelativeTime } from '../../utils/time';
import { useTranslation } from 'react-i18next';

// The backend stamps observations with datetime.utcnow().isoformat(), which
// carries no timezone suffix — JS would read that as local time and skew every
// label by the browser's offset. Pin it to UTC before formatting.
const asUtcDate = (iso) => {
    if (!iso) return null;
    const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(String(iso));
    const parsed = new Date(hasZone ? iso : `${iso}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// "4m ago", with the absolute local timestamp in the tooltip.
const ObservedAt = ({ iso }) => {
    const date = asUtcDate(iso);
    if (!date) return null;
    return (
        <time dateTime={date.toISOString()} title={date.toLocaleString()}>
            {formatRelativeTime(date.toISOString())}
        </time>
    );
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// One declared permission. The three shapes below are the whole point of this
// surface, so each renders its own sentence rather than sharing a vague one:
//
//   observable + used      → the gate saw it happen
//   observable + not used  → the gate saw nothing, and that means something
//   not observable         → there is no gate, so nothing can be concluded.
//                            No count, no "unused", no zero.
const PermissionRow = ({ row }) => {
    const { t } = useTranslation();
    if (!row.observable) {
        return (
            <li className="extension-permissions__row extension-permissions__row--opaque">
                <div className="extension-permissions__row-head">
                    <code>{row.permission}</code>
                    <Pill kind="gray" dot={false}>
                        <EyeOff aria-hidden="true" />
                        {t('app.extensionPermissionsDialog.useCannotBeObserved', 'Use cannot be observed')}
                    </Pill>
                </div>
                <p className="extension-permissions__note">
                    {t('app.extensionPermissionsDialog.thePanelExposesNoGatedHelper', 'The panel exposes no gated helper for this capability. An extension that wants it imports the host module directly, and nothing in the panel sees the call. Whether this extension has used it cannot be answered here.')}
                </p>
                {row.uses > 0 && (
                    <p className="extension-permissions__note">
                        {t('app.extensionPermissionsDialog.callsPassedTheGate', { count: row.uses, defaultValue_one: '1 call passed through the SDK gate and was recorded', defaultValue_other: '{{count}} calls passed through the SDK gate and were recorded' })}
                        {row.last_used_at && <> {t('app.extensionPermissionsDialog.mostRecent', '(most recent')} <ObservedAt iso={row.last_used_at} />)</>}
                        .{' '}{t('app.extensionPermissionsDialog.ungatedCallsLeaveNoTrace', "Calls that didn't go through the gate leave no trace, so treat that as a floor, not a total.")}
                    </p>
                )}
            </li>
        );
    }

    if (row.used) {
        return (
            <li className="extension-permissions__row extension-permissions__row--used">
                <div className="extension-permissions__row-head">
                    <code>{row.permission}</code>
                    <Pill kind="green" dot={false}>
                        <Eye aria-hidden="true" />
                        {t('app.extensionPermissionsDialog.used', 'Used')}
                    </Pill>
                </div>
                <p className="extension-permissions__note">
                    {t('app.extensionPermissionsDialog.everyUseOfThisCapabilityPasses', 'Every use of this capability passes through the panel\'s SDK gate. Recorded')} {plural(row.uses, 'time')} {t('app.extensionPermissionsDialog.sinceThePanelProcessStarted', 'since the panel process started')}
                    {row.last_used_at && <>{t('app.extensionPermissionsDialog.mostRecently', ', most recently')} <ObservedAt iso={row.last_used_at} /></>}
                    .
                </p>
            </li>
        );
    }

    return (
        <li className="extension-permissions__row extension-permissions__row--unused">
            <div className="extension-permissions__row-head">
                <code>{row.permission}</code>
                <Pill kind="amber" dot={false}>
                    <Eye aria-hidden="true" />
                    {t('app.extensionPermissionsDialog.noUseRecorded', 'No use recorded')}
                </Pill>
            </div>
            <p className="extension-permissions__note">
                {t('app.extensionPermissionsDialog.everyUseOfThisCapabilityHas', 'Every use of this capability has to pass through the panel\'s SDK gate, and the gate has recorded none since the panel process started. Either the extension has not needed it yet, or it declares more than it uses.')}
            </p>
        </li>
    );
};

// Calls the gate refused. These did not happen — the wording never says "used".
const BlockedRow = ({ row }) => {
    const { t } = useTranslation();
    const refused = row.denied ?? row.uses;
    return (
        <li className="extension-permissions__row extension-permissions__row--blocked">
            <div className="extension-permissions__row-head">
                <code>{row.permission}</code>
                <Pill kind="red" dot={false}>
                    <Ban aria-hidden="true" />
                    {t('app.extensionPermissionsDialog.blocked', 'Blocked')}
                </Pill>
            </div>
            <p className="extension-permissions__note">
                {t('app.extensionPermissionsDialog.thisExtensionAskedForACapability', 'This extension asked for a capability its manifest does not declare, so the panel refused the call and it did not run. Refused')} {plural(refused, 'time')}
                {row.last_used_at && <>{t('app.extensionPermissionsDialog.mostRecently', ', most recently')} <ObservedAt iso={row.last_used_at} /></>}
                .
            </p>
        </li>
    );
};

const PermissionsSection = ({ report }) => {
    const { t } = useTranslation();
    const rows = Array.isArray(report?.permissions) ? report.permissions : [];
    const declared = rows.filter((row) => row.declared);
    const blocked = rows.filter((row) => !row.declared);
    const observable = declared.filter((row) => row.observable).length;

    return (
        <section className="extension-permissions__section">
            <div className="extension-permissions__section-head">
                <h4>{t('app.extensionPermissionsDialog.declaredPermissions', 'Declared permissions')}</h4>
                {declared.length > 0 && (
                    <span className="extension-permissions__count">
                        {declared.length} {t('app.extensionPermissionsDialog.declared', 'declared ·')} {observable} {t('app.extensionPermissionsDialog.thePanelCanObserve', 'the panel can observe')}
                    </span>
                )}
            </div>
            <p className="extension-permissions__scope">
                {t('app.extensionPermissionsDialog.useIsRecordedInMemoryIn', 'Use is recorded in memory, in this backend process only. It covers the time since the panel last started and is cleared on restart.')}
            </p>

            {declared.length > 0 ? (
                <ul className="extension-permissions__list">
                    {declared.map((row) => <PermissionRow key={row.permission} row={row} />)}
                </ul>
            ) : (
                <p className="extension-permissions__note">
                    {t('app.extensionPermissionsDialog.thisExtensionSManifestDeclaresNo', 'This extension\'s manifest declares no host permissions.')}
                </p>
            )}

            {blocked.length > 0 && (
                <div className="extension-permissions__blocked">
                    <div className="extension-permissions__section-head">
                        <h4>{t('app.extensionPermissionsDialog.blockedAttempts', 'Blocked attempts')}</h4>
                    </div>
                    <p className="extension-permissions__scope">
                        {t('app.extensionPermissionsDialog.capabilitiesThisExtensionReachedForWithout', 'Capabilities this extension reached for without declaring them. The panel refused each one; nothing on this list ran.')}
                    </p>
                    <ul className="extension-permissions__list">
                        {blocked.map((row) => <BlockedRow key={row.permission} row={row} />)}
                    </ul>
                </div>
            )}

            <p className="extension-permissions__footnote">
                {t('app.extensionPermissionsDialog.declaredPermissionsAreAConsentSignal', 'Declared permissions are a consent signal, not a sandbox. Extension code runs inside the panel process with the panel\'s privileges; the panel can record what passes through its own SDK and cannot confine what does not.')}
            </p>
        </section>
    );
};

// Task 6: the "saved for manual review" requirements file, with its contents and
// the exact opt-in env var. Read-only on purpose — there is deliberately no
// install action here, and the copy says so rather than implying one is missing.
const RequirementsSection = ({ requirements }) => {
    const { t } = useTranslation();
    const envVar = requirements?.env_var || 'SERVERKIT_ALLOW_PLUGIN_PIP';
    const pipEnabled = Boolean(requirements?.pip_enabled);
    const packages = Array.isArray(requirements?.packages) ? requirements.packages : [];

    if (!requirements?.pending) {
        return (
            <section className="extension-permissions__section">
                <div className="extension-permissions__section-head">
                    <h4>{t('app.extensionPermissionsDialog.pythonDependencies', 'Python dependencies')}</h4>
                </div>
                <p className="extension-permissions__note">
                    {t('app.extensionPermissionsDialog.noPendingPythonDependenciesEitherThis', 'No pending Python dependencies. Either this extension ships no')} <code>requirements.txt</code>{t('app.extensionPermissionsDialog.orItsPackagesWereInstalledWhen', ', or its packages were installed when it was installed.')}
                </p>
                <p className="extension-permissions__note">
                    {pipEnabled
                        ? <>{t('app.extensionPermissionsDialog.dependencyInstallationIsCurrentlyEnabledOn', 'Dependency installation is currently enabled on this panel (')}<code>{envVar}</code>).</>
                        : <>{t('app.extensionPermissionsDialog.dependencyInstallationIsOffOnThis', 'Dependency installation is off on this panel. When an extension ships Python packages, the panel writes the file next to the extension instead of installing it, and lists it here.')}</>}
                </p>
            </section>
        );
    }

    return (
        <section className="extension-permissions__section">
            <div className="extension-permissions__section-head">
                <h4>{t('app.extensionPermissionsDialog.pythonDependencies', 'Python dependencies')}</h4>
                <Pill kind="amber" dot={false}>
                    <PackageX aria-hidden="true" />
                    {t('app.extensionPermissionsDialog.notInstalled', 'Not installed')}
                </Pill>
            </div>
            <p className="extension-permissions__note">
                {t('app.extensionPermissionsDialog.thisExtensionShipsA', 'This extension ships a')} <code>requirements.txt</code> {t('app.extensionPermissionsDialog.thatThePanelDidNotInstall', 'that the panel did not install (')}{plural(packages.length, 'requirement')} {t('app.extensionPermissionsDialog.listedAnythingOnThisListThat', 'listed). Anything on this list that is not already present in the backend\'s Python environment will fail to import at runtime.')}
            </p>
            <p className="extension-permissions__note">
                {pipEnabled
                    ? <>{t('app.extensionPermissionsDialog.dependencyInstallationIsEnabledOnThis', 'Dependency installation is enabled on this panel now (')}<code>{envVar}</code>{t('app.extensionPermissionsDialog.butThisFilePredatesThatThe', '), but this file predates that: the panel only installs requirements while installing or updating an extension. Reinstall or update this extension to apply it.')}</>
                    : <>{t('app.extensionPermissionsDialog.installingTheseRunsPipWithThe', "Installing these runs pip with the backend's privileges (a setup.py hook is arbitrary code), so it is opt-in and off by default. Set")} <code>{envVar}=1</code> {t('app.extensionPermissionsDialog.onTheBackendThenReinstallOr', 'on the backend, then reinstall or update this extension.')}</>}
            </p>
            {requirements.path && (
                <p className="extension-permissions__note">
                    {t('app.extensionPermissionsDialog.fileOnTheBackendHost', 'File on the backend host:')} <code>{requirements.path}</code>
                </p>
            )}
            {requirements.content && (
                <pre className="extension-permissions__file">{requirements.content}</pre>
            )}
            {requirements.truncated && (
                <p className="extension-permissions__note">
                    {t('app.extensionPermissionsDialog.thisFileIsLargerThanThe', 'This file is larger than the panel will send to the browser; the end has been cut off. Read it on the backend host for the full list.')}
                </p>
            )}
            <p className="extension-permissions__footnote">
                {t('app.extensionPermissionsDialog.thisPageIsReadOnlyNothing', 'This page is read-only. Nothing here installs anything.')}
            </p>
        </section>
    );
};

// Per-extension honesty surface (plan 55 tasks 6 + 7): what the extension
// declared, what the panel actually saw it do, what it was refused, and which
// Python packages the panel declined to install.
const ExtensionPermissionsDialog = ({ plugin, onClose }) => {
    const { t } = useTranslation();
    const [report, setReport] = useState(null);
    const [requirements, setRequirements] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [perms, reqs] = await Promise.all([
                api.getPluginPermissions(plugin.id),
                api.getPluginRequirements(plugin.id),
            ]);
            setReport(perms);
            setRequirements(reqs);
        } catch (err) {
            setError(err.message || 'Could not read this extension.');
        } finally {
            setLoading(false);
        }
    }, [plugin.id]);

    useEffect(() => { load(); }, [load]);

    return (
        <Modal
            open
            onClose={onClose}
            title={t('app.extensionPermissionsDialog.permissionsDependencies', '{{displayname}}: permissions and dependencies', { displayname: plugin.display_name })}
            size="md"
            footer={<Button variant="ghost" onClick={onClose}>{t('common.actions.close', 'Close')}</Button>}
        >
            <div className="extension-permissions">
                {loading && <p className="text-muted">{t('common.loading', 'Loading…')}</p>}

                {!loading && error && (
                    <div className="extension-permissions__error">
                        <p>{error}</p>
                        <Button variant="outline" size="sm" onClick={load}>{t('app.extensionPermissionsDialog.tryAgain', 'Try again')}</Button>
                    </div>
                )}

                {!loading && !error && (
                    <>
                        <PermissionsSection report={report} />
                        <RequirementsSection requirements={requirements} />
                    </>
                )}
            </div>
        </Modal>
    );
};

export default ExtensionPermissionsDialog;
