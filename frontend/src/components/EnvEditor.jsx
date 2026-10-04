import { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { parseDotenv, isValidEnvKey, looksSecret } from '../utils/dotenv';

/**
 * The one KEY=value editor for forms (run a container, deploy a template,
 * shared variable groups). The per-app variables table with history and
 * import/export is EnvironmentVariables; this is its in-form sibling.
 *
 *   <EnvEditor value={rows} onChange={setRows} />
 *
 * `value` is [{ key, value }]; convert with envToObject / envFromObject from
 * utils/dotenv. Pasting a multi-line .env into any key box splits it into
 * rows. Values whose key looks like a credential are masked until revealed.
 */
export default function EnvEditor({
    value = [],
    onChange,
    disabled = false,
    className,
}) {
    const { t } = useTranslation();
    const [revealed, setRevealed] = useState(() => new Set());
    const rows = value.length ? value : [{ key: '', value: '' }];

    const emit = (next) => onChange?.(next);
    const update = (index, patch) => emit(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    const remove = (index) => emit(rows.filter((_, i) => i !== index));
    const add = () => emit([...rows, { key: '', value: '' }]);

    const onPaste = (index, event) => {
        const text = event.clipboardData?.getData('text') || '';
        if (!text.includes('\n') && !text.includes('=')) return;
        const parsed = parseDotenv(text);
        if (!parsed.length) return;
        event.preventDefault();
        const before = rows.slice(0, index).filter((r) => r.key || r.value);
        const after = rows.slice(index + 1).filter((r) => r.key || r.value);
        emit([...before, ...parsed, ...after]);
    };

    const counts = rows.reduce((acc, row) => {
        const k = row.key.trim();
        if (k) acc[k] = (acc[k] || 0) + 1;
        return acc;
    }, {});

    const toggle = (index) => setRevealed((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index); else next.add(index);
        return next;
    });

    return (
        <div className={cn('sk-env-editor', className)}>
            {rows.map((row, index) => {
                const key = row.key.trim();
                const badKey = key && !isValidEnvKey(key);
                const duplicate = key && counts[key] > 1;
                const masked = looksSecret(key) && !revealed.has(index);
                return (
                    // Rows have no identity beyond their position while being typed.
                    <div className="sk-env-editor__row" key={index}>
                        <Input
                            value={row.key}
                            onChange={(e) => update(index, { key: e.target.value })}
                            onPaste={(e) => onPaste(index, e)}
                            placeholder="KEY"
                            disabled={disabled}
                            spellCheck={false}
                            autoComplete="off"
                            aria-invalid={Boolean(badKey || duplicate)}
                            aria-label={t('app.envEditor.key', 'Key')}
                            className="sk-env-editor__key"
                        />
                        <Input
                            value={row.value}
                            onChange={(e) => update(index, { value: e.target.value })}
                            placeholder="value"
                            type={masked ? 'password' : 'text'}
                            disabled={disabled}
                            spellCheck={false}
                            autoComplete="off"
                            aria-label={t('app.envEditor.value', 'Value')}
                            className="sk-env-editor__value"
                        />
                        {looksSecret(key) ? (
                            <Button type="button" variant="ghost" size="icon" onClick={() => toggle(index)}
                                aria-label={masked ? t('app.copyField.show', 'Show') : t('app.copyField.hide', 'Hide')}>
                                {masked ? <Eye size={14} /> : <EyeOff size={14} />}
                            </Button>
                        ) : <span className="sk-env-editor__spacer" />}
                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}
                            disabled={disabled} aria-label={t('app.envEditor.remove', 'Remove {{key}}', { key: key || t('app.envEditor.row', 'row') })}>
                            <Trash2 size={14} />
                        </Button>
                        {(badKey || duplicate) && (
                            <p className="sk-env-editor__error">
                                {badKey
                                    ? t('app.envEditor.badKey', 'Use letters, digits and _, not starting with a digit.')
                                    : t('app.envEditor.duplicate', '{{key}} is set more than once; the last one wins.', { key })}
                            </p>
                        )}
                    </div>
                );
            })}
            <div className="sk-env-editor__foot">
                <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
                    <Plus size={14} /> {t('app.envEditor.add', 'Add variable')}
                </Button>
                <span className="sk-env-editor__hint">{t('app.envEditor.pasteHint', 'Paste a .env file into a key box to fill several rows.')}</span>
            </div>
        </div>
    );
}
