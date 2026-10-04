import { toastError } from './errorMessage.js';
// useServerMutation exposes an async `mutate`; recipe navigation waits for its
// job ID, while this adapter owns the catalog's success/failure messages.
export async function runRecipe({ startRun, toast, t }, body, { serverName }) {
    try {
        const result = await startRun.mutate(body);
        toast.success(t('app.recipes.started', 'Recipe started on {{server}}', {
            server: serverName,
        }));
        return result.job_id;
    } catch (err) {
        toastError(toast, t('app.recipes.startFailed', "Couldn't start the recipe."), err);
        return null;
    }
}
