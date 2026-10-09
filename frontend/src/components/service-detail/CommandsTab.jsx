import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import api from '../../services/api';
import { useTranslation } from 'react-i18next';

const CommandsTab = ({ appId, appType }) => {
    const { t } = useTranslation();
    const [command, setCommand] = useState('');
    const [output, setOutput] = useState(null);
    const [running, setRunning] = useState(false);

    const quickCommands = appType === 'django' ? [
        { labelKey: 'app.commandsTab.runMigrations', label: 'Run migrations', cmd: 'python manage.py migrate' },
        { labelKey: 'app.commandsTab.collectStatic', label: 'Collect static', cmd: 'python manage.py collectstatic --noinput' },
        { labelKey: 'app.commandsTab.createSuperuser', label: 'Create superuser', cmd: 'python manage.py createsuperuser' },
        { labelKey: 'app.commandsTab.shell', label: 'Shell', cmd: 'python manage.py shell' },
        { labelKey: 'app.commandsTab.check', label: 'Check', cmd: 'python manage.py check' },
    ] : [
        { labelKey: 'app.commandsTab.flaskRoutes', label: 'Flask routes', cmd: 'flask routes' },
        { labelKey: 'app.commandsTab.flaskShell', label: 'Flask shell', cmd: 'flask shell' },
        { labelKey: 'app.commandsTab.dbUpgrade', label: 'DB upgrade', cmd: 'flask db upgrade' },
        { labelKey: 'app.commandsTab.dbMigrate', label: 'DB migrate', cmd: 'flask db migrate' },
    ];

    async function handleRun(cmd) {
        const commandToRun = cmd || command;
        if (!commandToRun.trim()) return;

        setRunning(true);
        setOutput(null);

        try {
            const result = await api.runPythonCommand(appId, commandToRun);
            setOutput(result);
        } catch (err) {
            setOutput({ success: false, stderr: err.message });
        } finally {
            setRunning(false);
        }
    }

    return (
        <div>
            <h3 className="svc-eyebrow">{t('app.commandsTab.runCommands', 'Run commands')}</h3>
            <p className="hint">{t('app.commandsTab.commandsRunInTheAppS', "Commands run in the service's virtual environment context.")}</p>

            <div className="quick-commands">
                {quickCommands.map(({ labelKey, label, cmd }) => (
                    <Button
                        key={cmd}
                        variant="outline"
                        size="sm"
                        onClick={() => handleRun(cmd)}
                        disabled={running}
                    >
                        {t(labelKey, { defaultValue: label })}
                    </Button>
                ))}
            </div>

            <div className="command-input">
                <Input
                    type="text"
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    placeholder={t('app.commandsTab.enterCommand', 'Enter command…')}
                    onKeyDown={(e) => e.key === 'Enter' && handleRun()}
                />
                <Button
                    onClick={() => handleRun()}
                    disabled={running}
                >
                    {running ? t('app.commandsTab.running', 'Running…') : t('app.commandsTab.run', 'Run')}
                </Button>
            </div>

            {output && (
                <div className={`command-output ${output.success ? '' : 'error'}`}>
                    {output.stdout && <pre>{output.stdout}</pre>}
                    {output.stderr && <pre className="stderr">{output.stderr}</pre>}
                    {!output.stdout && !output.stderr && (
                        <pre>{output.success
                            ? t('app.commandsTab.commandCompleted', 'Command completed.')
                            : t('app.commandsTab.commandFailed', "Couldn't run the command.")}</pre>
                    )}
                </div>
            )}
        </div>
    );
};

export default CommandsTab;
