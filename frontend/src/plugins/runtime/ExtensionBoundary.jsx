/**
 * Per-extension error boundary + failure card (plan 25 Phase 2 #7, Decision 5).
 *
 * Fail soft, loudly: a runtime extension bundle that fails to load (integrity or
 * import error), or whose component throws at render, shows a contained card on
 * its own routes — never a white screen, never silent absence. The same failure
 * is surfaced on the Marketplace: the installed row shows a runtime load-state
 * badge (loaded / SDK-incompatible / failed) read from the loader's
 * `getRuntimeLoadState`, with the error string in a popover (plan 32 #5).
 */
import { Component } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { t } from '../../i18n/t';

// Plain (dependency-free) card so it renders even if the SDK/design-system is
// itself the thing that failed. Styled by _extensions.scss (.sk-ext-failcard).
export function ExtensionFailureCard({ slug, title, message }) {
    const { t } = useTranslation();
    return (
        <div className="sk-ext-failcard" role="alert">
            <div className="sk-ext-failcard__icon" aria-hidden="true">⚠</div>
            <div className="sk-ext-failcard__body">
                <h2 className="sk-ext-failcard__title">
                    {title || t('app.extensionBoundary.failedToLoad', "Couldn't load the extension.")}
                </h2>
                <p className="sk-ext-failcard__desc">
                    {/* One key with a component slot, not prefix/suffix
                        fragments: split sentences cannot be reordered by a
                        translator. */}
                    <Trans
                        i18nKey="app.extensionBoundary.theExtensionCouldNotBeLoaded"
                        defaults="The extension <0>{{slug}}</0> could not be loaded"
                        values={{ slug }}
                        components={[<code key="slug" />]}
                    />
                    {message ? ': ' : '.'}
                    {message && <span className="sk-ext-failcard__reason">{message}</span>}
                </p>
                <p className="sk-ext-failcard__hint">
                    {t('app.extensionBoundary.itsOtherPagesAndTheRest', 'Its other pages and the rest of the panel are unaffected. Try reinstalling or updating it from the Marketplace.')}
                </p>
            </div>
        </div>
    );
}

export class ExtensionErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error, info) {
        console.error(`[plugins] extension "${this.props.slug}" crashed at render:`, error, info);
    }

    render() {
        if (this.state.error) {
            return (
                <ExtensionFailureCard
                    slug={this.props.slug}
                    title={t('app.extensionBoundary.extensionCrashed', 'Extension crashed')}
                    message={this.state.error?.message || String(this.state.error)}
                />
            );
        }
        return this.props.children;
    }
}
