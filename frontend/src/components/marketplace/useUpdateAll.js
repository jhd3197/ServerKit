import { useState } from 'react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { t } from '@/i18n/t';
import { partitionUpdates } from './extensionUpdates';

// "Update all": sequentially applies every ready (compatible, no-ack) update.
// Failures are skipped and counted; entries needing review are NEVER
// acknowledged here — they are reported so the operator updates them one by one.
export function useUpdateAll(updates, onDone) {
    const toast = useToast();
    const [progress, setProgress] = useState(null); // { done, total } while running
    const { ready, review } = partitionUpdates(updates);

    const run = async () => {
        if (progress || ready.length === 0) return;
        const batch = ready;
        let ok = 0;
        let failed = 0;
        let needReview = review.length;
        setProgress({ done: 0, total: batch.length });
        for (let i = 0; i < batch.length; i += 1) {
            try {
                await api.updatePlugin(batch[i].plugin_id);
                ok += 1;
            } catch (err) {
                if (err.status === 409 && err.data?.requires_acknowledgment) needReview += 1;
                else failed += 1;
            }
            setProgress({ done: i + 1, total: batch.length });
        }
        setProgress(null);
        await onDone();
        const msg = t('app.marketplace.updateAllSummary', '{{ok}} updated · {{review}} need review · {{failed}} failed', { ok, review: needReview, failed });
        if (failed || needReview) toast.warning(msg); else toast.success(msg);
    };

    return { run, progress, readyCount: ready.length, reviewCount: review.length };
}
