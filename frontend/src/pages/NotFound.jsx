import { useLocation, useNavigate } from 'react-router-dom';
import { FileQuestion, LayoutDashboard, Blocks } from 'lucide-react';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/EmptyState';
import { useContributions } from '@/plugins/contributions';
import PageLayout from '../layouts/PageLayout';
import { useTranslation } from 'react-i18next';

// Catch-all route (App.jsx `path="*"`). Reached for a genuinely unknown URL and,
// importantly, for an extension route whose extension isn't installed/active
// (that route is never registered, so React Router falls through to here instead
// of rendering a blank page).
//
// Contributed routes load asynchronously from /api/v1/plugins/contributions, so
// on a hard refresh straight onto an *installed* extension route this component
// can mount for a beat before the route registers. We key off the contributions
// `__ready` flag to show a loading skeleton until then, and only show the real
// 404 once we know the route set is complete — no "Not found" flash.
export default function NotFound() {
    const { t } = useTranslation();
    const location = useLocation();
    const navigate = useNavigate();
    const { __ready } = useContributions();

    if (!__ready) {
        return (
            <PageLayout title={t('app.notFound.loading', 'Loading')}>
                <EmptyState loading title={t('app.notFound.loading', 'Loading')} />
            </PageLayout>
        );
    }

    return (
        <PageLayout title={t('app.notFound.pageNotFound', 'Page not found')}>
            <EmptyState
                icon={FileQuestion}
                title={t('app.notFound.pageNotFound', 'Page not found')}
                description={t('app.notFound.description', 'We couldn\'t find {{pathname}}. It may have moved, or it belongs to an extension that isn\'t installed. Check Extensions to install it.', { pathname: location.pathname })}
                action={(
                    <div className="not-found__actions">
                        <Button onClick={() => navigate('/')}>
                            <LayoutDashboard size={16} />
                            {t('app.notFound.goToDashboard', 'Go to dashboard')}
                        </Button>
                        <Button variant="outline" onClick={() => navigate('/extensions')}>
                            <Blocks size={16} />
                            {t('app.notFound.browseExtensions', 'Browse extensions')}
                        </Button>
                    </div>
                )}
            />
        </PageLayout>
    );
}
