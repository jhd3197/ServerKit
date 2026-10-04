import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CopyButton } from './CopyButton';

const MASK = '••••••••••••';

/**
 * The one way to show a value someone will copy: commands, IPs, URLs,
 * connection strings, tokens, passwords.
 *
 *   <CopyField value="curl -fsSL https://… | bash" />
 *   <CopyField label="Password" value={password} secret />
 *   <CopyField value={dotenv} multiline />
 *
 * `secret` hides the value until the eye is pressed; copying works either way,
 * so a secret never has to be shown to be used. Use the bare CopyButton only
 * when the copied text is not on screen (a "Copy command" action).
 */
export default function CopyField({
    value,
    label,
    secret = false,
    multiline = false,
    className,
    onCopy,
}) {
    const { t } = useTranslation();
    const [revealed, setRevealed] = useState(false);
    const text = value == null ? '' : String(value);
    const hidden = secret && !revealed;

    return (
        <div className={cn('sk-copy-field', multiline && 'sk-copy-field--multiline', className)}>
            {label && <span className="sk-copy-field__label">{label}</span>}
            <div className="sk-copy-field__box">
                {multiline
                    ? <pre className="sk-copy-field__value">{hidden ? MASK : text}</pre>
                    : <code className="sk-copy-field__value" title={hidden ? undefined : text}>{hidden ? MASK : text}</code>}
                <span className="sk-copy-field__actions">
                    {secret && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setRevealed((v) => !v)}
                            aria-label={revealed ? t('app.copyField.hide', 'Hide') : t('app.copyField.show', 'Show')}
                            title={revealed ? t('app.copyField.hide', 'Hide') : t('app.copyField.show', 'Show')}
                        >
                            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
                        </Button>
                    )}
                    <CopyButton
                        value={text}
                        label={label ? t('app.copyField.copyLabel', 'Copy {{label}}', { label }) : t('app.copyField.copy', 'Copy')}
                        copiedLabel={t('app.copyField.copied', 'Copied')}
                        onCopy={onCopy}
                    />
                </span>
            </div>
        </div>
    );
}
