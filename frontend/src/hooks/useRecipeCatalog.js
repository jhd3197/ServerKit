import { useTranslation } from 'react-i18next';

import { api } from '../services/api';
import { useToast } from '../contexts/useToast.js';
import { useServerMutation, useServerQuery } from './useServerQuery';
import { toastError } from '@/utils/errorMessage';

// Data door for the Recipe catalog (serverkit-recipes registry). Pages render
// from this hook; raw api.* calls and query-layer error presentation stay here.

export function useRecipeCatalog() {
    const { t } = useTranslation();
    const toast = useToast();

    const registryQuery = useServerQuery(
        ['recipes', 'registry'],
        () => api.getRecipeRegistry(),
        {
            // The backend serves last-good/bundled when upstream is down, so
            // failures here are local (auth/network); surface once.
            staleTime: 60_000,
            onError: (err) => toastError(toast, t('app.recipes.loadFailed', "Couldn't load the recipe catalog."), err),
        },
    );

    const serversQuery = useServerQuery(
        ['recipes', 'target-servers'],
        () => api.getServers(),
        { staleTime: 15_000 },
    );

    const startRun = useServerMutation(
        (body) => api.startRecipeRun(body),
    );

    return {
        recipes: registryQuery.data?.recipes ?? [],
        source: registryQuery.data?.source ?? null,
        isLoading: registryQuery.isLoading || serversQuery.isLoading,
        servers: serversQuery.data?.servers ?? [],
        startRun,
    };
}

export { runRecipe } from '../utils/runRecipe.js';
