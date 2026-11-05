import { HardDrive, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import InfoTip from '../InfoTip';

// Persistent, non-dismissable: the backup directory is unusable until fixed.
export default function BackupStorageNotice({ onStorage }) {
    const { t } = useTranslation();
    return (
        <div className="backup-storage-notice" role="status">
            <HardDrive size={16} className="backup-storage-notice__icon" />
            <div className="backup-storage-notice__text">
                <strong>{t('app.backups.storageUnavailable', 'Backup storage unavailable')}</strong>
                <InfoTip>{t('app.backups.storageUnavailableHelp', 'ServerKit can\'t create or read its backup directory, so backups can\'t run or be listed. Check the directory\'s ownership and permissions on the server, or add a remote destination under Storage.')}</InfoTip>
                <span className="backup-storage-notice__sub">{t('app.backups.storageUnavailableSub', 'Backups can\'t run')}</span>
            </div>
            {onStorage && (
                <Button variant="ghost" size="sm" type="button" onClick={onStorage}>
                    {t('app.backups.storage', 'Storage')} <ArrowRight size={14} />
                </Button>
            )}
        </div>
    );
}
