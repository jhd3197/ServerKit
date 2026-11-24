import { useId } from 'react';
import { Database, Globe, Layers3, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Connect step body for "Start from a framework": pick a framework, then the
// service's domain and whether to add its database. Rows come from the backend
// registry, so a new framework appears here without a frontend change.
export const FrameworkPicker = ({ form }) => {
    const { t } = useTranslation();
    const fieldId = useId();
    const {
        frameworks, frameworksLoading, frameworkId, setFrameworkId, selectedFramework,
        frameworkDomain, setFrameworkDomain, frameworkDomainValid, addDatabase, setAddDatabase,
    } = form;
    const db = selectedFramework?.database;

    return (
        <div className="new-service-page__pane">
            <div className="new-service-page__repo-list" role="radiogroup" aria-label={t('app.frameworkStep.framework', 'Framework')}>
                {frameworksLoading && <div className="new-service-page__repo-state">{t('app.frameworkStep.loading', 'Loading frameworks…')}</div>}
                {!frameworksLoading && frameworks.length === 0 && (
                    <div className="new-service-page__repo-state">{t('app.frameworkStep.none', 'No frameworks available.')}</div>
                )}
                {frameworks.map(fw => (
                    <Button variant="unstyled"
                        key={fw.id}
                        type="button"
                        role="radio"
                        aria-checked={frameworkId === fw.id}
                        disabled={!fw.available}
                        className={`new-service-page__repo-row ${frameworkId === fw.id ? 'new-service-page__repo-row--active' : ''}`}
                        onClick={() => setFrameworkId(fw.id)}
                    >
                        <span>
                            <strong>{fw.name}</strong>
                            <small>{fw.description}</small>
                        </span>
                        {fw.php_version && <em>PHP {fw.php_version}</em>}
                    </Button>
                ))}
            </div>

            <div className="new-service-page__field">
                <Label htmlFor={`${fieldId}-domain`}>
                    {t('app.frameworkStep.domain', 'Domain')} <span className="new-service-page__optional">{t('app.frameworkStep.optional', '(optional)')}</span>
                </Label>
                <Input
                    id={`${fieldId}-domain`}
                    value={frameworkDomain}
                    onChange={(e) => setFrameworkDomain(e.target.value)}
                    placeholder="app.example.com"
                    autoComplete="off"
                    aria-invalid={!frameworkDomainValid}
                />
                {!frameworkDomainValid && (
                    <small className="new-service-page__field-error">{t('app.frameworkStep.invalidDomain', 'Enter a valid domain such as app.example.com, or leave it empty.')}</small>
                )}
            </div>

            {db?.supported && (
                <div className="new-service-page__toggle">
                    <div>
                        <Label htmlFor={`${fieldId}-db`}>{t('app.frameworkStep.addMysql', 'Add MySQL')}</Label>
                        <span>{t('app.frameworkStep.addMysqlHelp', 'Installs a private MySQL service and wires its credentials into the app. No password to type.')}</span>
                    </div>
                    <Checkbox id={`${fieldId}-db`} checked={addDatabase} onCheckedChange={(v) => setAddDatabase(v === true)} />
                </div>
            )}
        </div>
    );
};

// Review step body: a summary of what will be created.
export const FrameworkReview = ({ form }) => {
    const { t } = useTranslation();
    const { selectedFramework, serviceName, frameworkDomain, addDatabase } = form;
    const dbLabel = addDatabase
        ? (selectedFramework?.database?.label || 'MySQL')
        : t('app.frameworkStep.noDatabase', 'None (SQLite inside the container)');
    // What ServerKit does, in run order; ids match the registry's `steps`.
    const stepLabel = (step) => {
        switch (step) {
            case 'scaffold': return t('app.frameworkStep.stepScaffold', 'Scaffold the project with Composer');
            case 'database': return t('app.frameworkStep.stepDatabase', 'Provision the database');
            case 'env': return t('app.frameworkStep.stepEnv', 'Generate .env and APP_KEY, wire database credentials');
            case 'migrate': return t('app.frameworkStep.stepMigrate', 'Run migrations once the database is ready');
            case 'deploy': return t('app.frameworkStep.stepDeploy', 'Build the image and deploy');
            default: return null;
        }
    };
    const steps = (selectedFramework?.steps || []).filter(s => s !== 'database' || addDatabase);

    return (
        <div className="new-service-page__framework-summary">
            <dl>
                <div><dt><Layers3 size={14} /> {t('app.frameworkStep.framework', 'Framework')}</dt><dd>{selectedFramework?.name}</dd></div>
                <div><dt>{t('app.connectStep.serviceName', 'Service name')}</dt><dd>{serviceName}</dd></div>
                <div><dt><Database size={14} /> {t('app.frameworkStep.database', 'Database')}</dt><dd>{dbLabel}</dd></div>
                <div><dt><Globe size={14} /> {t('app.frameworkStep.domain', 'Domain')}</dt><dd>{frameworkDomain.trim() || t('app.frameworkStep.noDomain', 'None. Served on the assigned port.')}</dd></div>
            </dl>
            <h3><ListChecks size={14} /> {t('app.frameworkStep.whatServerkitWillDo', 'What ServerKit will do')}</h3>
            <ol>
                {steps.map(step => stepLabel(step) && <li key={step}>{stepLabel(step)}</li>)}
            </ol>
        </div>
    );
};
