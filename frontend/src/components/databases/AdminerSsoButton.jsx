import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/useToast.js';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/utils/errorMessage';

// Adminer accepts a plain form POST into its login screen; submitting the
// descriptor from a hidden form means the single-use password never touches
// the URL, storage, or our own state beyond this handler.
function postToAdminer(descriptor) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = descriptor.url;
    form.target = '_blank';
    form.rel = 'noopener';

    const fields = {
        'auth[driver]': descriptor.driver,
        'auth[server]': descriptor.server,
        'auth[username]': descriptor.username,
        'auth[password]': descriptor.password,
        'auth[db]': descriptor.database,
    };
    Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value ?? '';
        form.appendChild(input);
    });

    document.body.appendChild(form);
    form.submit();
    form.remove();
}

// One-click DB admin: mints a 5-minute, single-database credential server-side
// and opens Adminer in a new tab already logged in as it.
export default function AdminerSsoButton({ databaseId, disabled = false }) {
    const { t } = useTranslation();
    const toast = useToast();
    const [busy, setBusy] = useState(false);

    async function launch() {
        setBusy(true);
        try {
            const descriptor = await api.launchManagedDbSso(databaseId);
            postToAdminer(descriptor);
            toast.success(t('app.adminerSsoButton.openedAdminerWithA5Minute', 'Opened Adminer with a 5-minute scoped credential'));
        } catch (err) {
            toastError(toast, t('app.adminerSsoButton.failedToLaunchAdminer', "Couldn't open Adminer."), err);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Button type="button" size="sm" variant="outline"
            disabled={disabled || busy} onClick={launch}>
            <ExternalLink size={14} /> {busy ? 'Opening…' : 'Open in Adminer'}
        </Button>
    );
}
