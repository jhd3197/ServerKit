import { useState } from 'react';
import { X, Plus, FolderTree } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';

// Smart tracked-path selector for WordPress Git connections. Replaces the raw
// textarea with removable chips, common-path shortcuts, and custom-path input.
const QUICK_PATHS = [
    { labelKey: 'app.pathSelector.themes', label: 'Themes', value: 'wp-content/themes' },
    { labelKey: 'app.pathSelector.plugins', label: 'Plugins', value: 'wp-content/plugins' },
    { labelKey: 'app.pathSelector.uploads', label: 'Uploads', value: 'wp-content/uploads' },
    { labelKey: 'app.pathSelector.muPlugins', label: 'MU plugins', value: 'wp-content/mu-plugins' },
];

function normalizePath(value) {
    return value
        .replace(/\\/g, '/')
        .split('/')
        .filter((p) => p.trim())
        .join('/')
        .replace(/^\//, '')
        .replace(/\/$/, '');
}

const PathSelector = ({ paths, onChange, label, hint, id }) => {
    const { t } = useTranslation();
    const [inputValue, setInputValue] = useState('');

    function addPath(raw) {
        const normalized = normalizePath(raw);
        if (!normalized) return;
        if (paths.includes(normalized)) return;
        onChange([...paths, normalized]);
        setInputValue('');
    }

    function removePath(path) {
        onChange(paths.filter((p) => p !== path));
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            addPath(inputValue);
        }
    }

    return (
        <div className="git-path-selector">
            {label && <label htmlFor={id} className="git-path-selector__label">{label}</label>}

            <div className="git-path-selector__quick">
                {QUICK_PATHS.map(({ label: quickLabel, value }) => {
                    const active = paths.includes(value);
                    return (
                        <Button variant="unstyled"
                            type="button"
                            key={value}
                            className={`git-path-selector__chip git-path-selector__chip--quick${active ? ' is-active' : ''}`}
                            onClick={() => (active ? removePath(value) : addPath(value))}
                            aria-pressed={active}
                        >
                            {active ? <X size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
                            {quickLabel}
                        </Button>
                    );
                })}
            </div>

            <div className="git-path-selector__add">
                <span className="git-path-selector__add-icon"><FolderTree size={14} aria-hidden="true" /></span>
                <input
                    id={id}
                    type="text"
                    className="ui-input"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="wp-content/custom-path"
                />
                <Button type="button" variant="outline" size="sm" onClick={() => addPath(inputValue)}>
                    <Plus size={14} aria-hidden="true" /> {t('common.actions.add', 'Add')}
                </Button>
            </div>

            {paths.length > 0 ? (
                <ul className="git-path-selector__list">
                    {paths.map((path) => (
                        <li key={path} className="git-path-selector__item">
                            <code>{path}</code>
                            <Button variant="unstyled"
                                type="button"
                                className="git-path-selector__remove"
                                onClick={() => removePath(path)}
                                aria-label={t('app.pathSelector.remove', 'Remove {{path}}', { path: path })}
                            >
                                <X size={12} aria-hidden="true" />
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="git-path-selector__empty">{t('app.pathSelector.noPathsTrackedYetChooseA', 'No paths tracked yet. Choose a shortcut above or type a custom path.')}</p>
            )}

            {hint && <span className="git-connect__field-hint">{hint}</span>}
        </div>
    );
};

export default PathSelector;
