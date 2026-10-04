import { useState, useEffect } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { AlertTriangle, Info, AlertCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Styling lives in styles/components/_ui.scss (.sk-confirm*).
const iconMap = { danger: AlertTriangle, warning: AlertCircle, info: Info };

export function ConfirmDialog({
  isOpen,
  title,
  message,
  details,
  confirmText,
  cancelText,
  variant = 'danger',
  requireConfirmation,
  confirmationPlaceholder,
  onConfirm,
  onCancel,
}) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = useState('');

  useEffect(() => { if (isOpen) setInputValue(''); }, [isOpen]);

  const Icon = iconMap[variant] || AlertTriangle;
  const isConfirmDisabled = requireConfirmation && inputValue !== requireConfirmation;

  return (
    <AlertDialog open={isOpen} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent className="sk-confirm">
        <AlertDialogHeader>
          <div className="sk-confirm__head">
            <div className={`sk-confirm__icon sk-confirm__icon--${variant}`}>
              <Icon size={24} />
            </div>
            <div className="sk-confirm__body">
              <AlertDialogTitle>{title}</AlertDialogTitle>
              {message && <AlertDialogDescription>{message}</AlertDialogDescription>}
              {details && <p className="sk-confirm__details">{details}</p>}
            </div>
          </div>
          {requireConfirmation && (
            <div className="sk-confirm__confirm-field">
              <Label>
                {/* One key, not a prefix/suffix pair: word order around the
                    typed value differs by language, and split sentences cannot
                    be reordered by a translator. */}
                <Trans
                  i18nKey="common.confirm.typeToConfirm"
                  defaults="Type <0>{{value}}</0> to confirm:"
                  values={{ value: requireConfirmation }}
                  components={[<strong key="value" className="text-foreground" />]}
                />
              </Label>
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isConfirmDisabled && onConfirm()}
                placeholder={confirmationPlaceholder || requireConfirmation}
                autoFocus
              />
            </div>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="sk-confirm__footer">
          <AlertDialogCancel onClick={onCancel}>{cancelText ?? t('common.actions.cancel', 'Cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isConfirmDisabled}
            variant={variant === 'danger' ? 'destructive' : 'primary'}
          >
            {confirmText ?? t('common.actions.confirm', 'Confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default ConfirmDialog;
