import { useState } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { useConfirm } from '../../hooks/useConfirm';
import { Button } from '@/components/ui/button';
import { useServer } from './dockerHelpers';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

const PruneButton = ({ onPruned }) => {
    const { t } = useTranslation();
    const toast = useToast();
    const { isRemote } = useServer();
    const [loading, setLoading] = useState(false);
    const { confirm } = useConfirm();

    async function handlePrune() {
        if (isRemote) {
            toast.error(t('app.pruneButton.pruneIsOnlyAvailableOnThe', 'Prune is only available on the panel server right now'));
            return;
        }
        const confirmed = await confirm({ title: t('app.pruneButton.dockerCleanup', 'Docker cleanup'), message: t('app.pruneButton.removeUnusedDockerResourcesThisWill', 'Delete unused Docker resources? This deletes stopped containers, unused images, and unused networks.') });
        if (!confirmed) return;

        setLoading(true);
        try {
            await api.request('/docker/cleanup', { method: 'POST', body: {} });
            toast.success(t('app.pruneButton.dockerCleanupCompleted', 'Docker cleanup completed'));
            onPruned?.();
        } catch (err) {
            toastError(toast, t('app.pruneButton.failedToCleanupDockerResources', 'Failed to cleanup Docker resources'), err);
        } finally {
            setLoading(false);
        }
    }

    return (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={handlePrune}
                disabled={loading || isRemote}
                title={isRemote ? t('app.pruneButton.pruneIsOnlyAvailableOnThe', 'Prune is only available on the panel server right now') : t('app.pruneButton.pruneUnusedDockerResources', 'Prune unused Docker resources')}
            >
                {loading ? 'Cleaning...' : 'Prune Unused'}
            </Button>
        </>
    );
};

export default PruneButton;
