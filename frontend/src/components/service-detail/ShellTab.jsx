import { useCallback, useState, useEffect, useRef  } from 'react';
import api from '../../services/api';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import EmptyState from '../EmptyState';
import { useTranslation } from 'react-i18next';

const ShellTab = ({ appId, appName }) => {
    const { t } = useTranslation();
    const [containers, setContainers] = useState([]);
    const [selectedContainer, setSelectedContainer] = useState(null);
    const [history, setHistory] = useState([]);
    const [command, setCommand] = useState('');
    const [running, setRunning] = useState(false);
    const [loading, setLoading] = useState(true);
    const terminalRef = useRef(null);

    const loadContainers = useCallback(async () => {
        try {
            const data = await api.getContainers(true);
            const appContainers = (data.containers || []).filter(c =>
                c.Names?.some(n => n.includes(appName)) ||
                c.Labels?.['com.docker.compose.project'] === appName
            );
            setContainers(appContainers);
            if (appContainers.length > 0) {
                setSelectedContainer(current => current || appContainers[0].Id);
            }
        } catch (err) {
            console.error('Failed to load containers:', err);
        } finally {
            setLoading(false);
        }
    }, [appName]);

    useEffect(() => {
        loadContainers();
    }, [appId, loadContainers]);

    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [history]);


    async function handleExec(e) {
        e.preventDefault();
        if (!command.trim() || !selectedContainer) return;

        const cmd = command.trim();
        setCommand('');
        setRunning(true);
        setHistory(prev => [...prev, { type: 'input', text: cmd }]);

        try {
            const result = await api.execContainer(selectedContainer, cmd);
            if (result.output) {
                setHistory(prev => [...prev, { type: 'output', text: result.output }]);
            }
            if (result.error) {
                setHistory(prev => [...prev, { type: 'error', text: result.error }]);
            }
        } catch (err) {
            setHistory(prev => [...prev, { type: 'error', text: err.message || 'Command failed' }]);
        } finally {
            setRunning(false);
        }
    }

    if (loading) {
        return <EmptyState loading title={t('app.shellTab.loadingContainers', 'Loading containers…')} />;
    }

    if (containers.length === 0) {
        return (
            <div className="events-tab__empty">
                <h3>{t('app.shellTab.noRunningContainers', 'No running containers')}</h3>
                <p>{t('app.shellTab.startTheServiceToAccessThe', 'Start the service to access the shell.')}</p>
            </div>
        );
    }

    return (
        <div className="shell-tab">
            <div className="shell-tab__container">
                <div className="shell-tab__header">
                    <span className="shell-tab__title">{t('app.shellTab.containerShell', 'Container shell')}</span>
                    {containers.length > 1 && (
                        <Select
                            value={selectedContainer || ''}
                            onValueChange={setSelectedContainer}
                        >
                            <SelectTrigger className="shell-tab__container-select">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {containers.map(c => (
                                    <SelectItem key={c.Id} value={c.Id}>
                                        {c.Names?.[0]?.replace(/^\//, '') || c.Id.substring(0, 12)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>

                <div className="shell-tab__terminal" ref={terminalRef}>
                    {history.length === 0 && (
                        <div className="shell-tab__hint">
                            {t('app.shellTab.typeACommandBelowToExecute', 'Type a command below to execute it in the container.')}
                        </div>
                    )}
                    {history.map((line, i) => (
                        <div key={i} className={`shell-tab__line shell-tab__line--${line.type}`}>
                            {line.type === 'input' && '$ '}
                            {line.text}
                        </div>
                    ))}
                    {running && <div className="shell-tab__hint">{t('app.shellTab.running', 'Running…')}</div>}
                </div>

                <form className="shell-tab__input-row" onSubmit={handleExec}>
                    <span className="shell-tab__prompt">$</span>
                    <Input
                        className="shell-tab__input"
                        type="text"
                        value={command}
                        onChange={(e) => setCommand(e.target.value)}
                        placeholder={t('app.shellTab.enterCommand', 'Enter command…')}
                        disabled={running}
                        autoFocus
                    />
                </form>
            </div>
        </div>
    );
};

export default ShellTab;
