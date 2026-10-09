import {
    Archive,
    BookOpenCheck,
    Boxes,
    Check,
    Clock3,
    Globe2,
    Radar,
    Server,
    ShieldCheck,
    Square,
    UserPlus,
    WandSparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { useShellDock } from '../contexts/useShellDock.js';
import { useWalkthroughs } from '../contexts/walkthroughContextValue';
import { getWalkthroughProgress } from '../services/walkthroughState';
import Pill from './ds/Pill';
import ShellDockTabs from './ShellDockTabs';

const ICONS = {
    service: Boxes,
    security: ShieldCheck,
    domain: Globe2,
    monitor: Radar,
    backup: Archive,
    server: Server,
    team: UserPlus,
    guide: WandSparkles,
    wordpress: Globe2,
};

// Recipes console — the prototype's guided-walkthrough surface: a library of
// recipe cards, and for the running recipe a split view with the step rail on
// the left and one step's story + deep-link action on the right. The engine
// (auto-completion via routes/signals/checks, saved progress) is untouched;
// only the shell changed from a floating card stack to the docked console.
function RecipeLibrary({ walkthroughs, state, onStart, onStop, t }) {
    const [showMore, setShowMore] = useState(false);
    const primary = walkthroughs.filter((walkthrough) => !walkthrough.secondary);
    const secondary = walkthroughs.filter((walkthrough) => walkthrough.secondary);
    const visible = showMore ? [...primary, ...secondary] : [
        ...primary,
        ...secondary.filter((walkthrough) => state.progress?.[walkthrough.id]?.status === 'active'),
    ];

    return (
        <div className="shell-recipes__grid">
            {visible.map((walkthrough) => {
                const Icon = ICONS[walkthrough.icon] || BookOpenCheck;
                const progress = getWalkthroughProgress(state, walkthrough);
                const status = progress.entry?.status;
                const active = status === 'active';
                const completed = status === 'completed';
                return (
                    <div key={walkthrough.id} className={`shell-recipes__card${active ? ' is-active' : ''}`}>
                        <Button variant="unstyled"
                            type="button"
                            className="shell-recipes__card-hit"
                            onClick={() => onStart(walkthrough.id)}
                        >
                            <span className={`shell-recipes__card-icon is-${walkthrough.tone}`}><Icon size={16} /></span>
                            <span className="shell-recipes__card-name">{walkthrough.title}</span>
                            <span className="shell-recipes__card-desc">{walkthrough.description}</span>
                        </Button>
                        <span className="shell-recipes__card-meta">
                            <Clock3 size={11} aria-hidden="true" />
                            {t('app.walkthroughs.stepsMeta', '{{count}} steps · {{duration}}', {
                                count: walkthrough.steps.length,
                                duration: walkthrough.duration,
                            })}
                            {completed && <Pill kind="green">{t('app.walkthroughs.completed', 'Completed')}</Pill>}
                            {active && <Pill kind="cyan">{progress.count}/{progress.total}</Pill>}
                            {walkthrough.origin?.plugin && (
                                <Pill kind="neutral">{walkthrough.origin.plugin.replace(/^serverkit-/, '')}</Pill>
                            )}
                            {active && (
                                <Button variant="unstyled"
                                    type="button"
                                    className="shell-recipes__card-stop"
                                    onClick={() => onStop(walkthrough.id)}
                                >
                                    <Square size={10} aria-hidden="true" /> {t('app.walkthroughs.stopShort', 'Stop')}
                                </Button>
                            )}
                        </span>
                    </div>
                );
            })}
            {secondary.length > 0 && (
                <Button variant="unstyled"
                    type="button"
                    className="shell-recipes__more"
                    onClick={() => setShowMore((current) => !current)}
                    aria-expanded={showMore}
                >
                    <BookOpenCheck size={15} aria-hidden="true" />
                    <span>
                        <strong>{showMore
                            ? t('app.walkthroughs.hideMoreGuides', 'Show fewer guides')
                            : t('app.walkthroughs.moreGuides', 'More walkthroughs')}
                        </strong>
                        <small>{showMore
                            ? t('app.walkthroughs.keepLibraryFocused', 'Keep the library focused on the essentials')
                            : t('app.walkthroughs.moreGuidesCount', '{{count}} optional guides', { count: secondary.length })}
                        </small>
                    </span>
                </Button>
            )}
        </div>
    );
}

export default function WalkthroughHub() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { activeTab, expanded } = useShellDock();
    const {
        state,
        walkthroughs,
        activeWalkthrough,
        activeProgress,
        currentStep,
        start,
        dismiss,
        completeStep,
        checkCurrent,
    } = useWalkthroughs();
    const [browse, setBrowse] = useState(false);
    const [viewStepId, setViewStepId] = useState(null);
    const [checking, setChecking] = useState(false);

    // Follow the walkthrough that is running: switching recipes resets the
    // step selection back to "wherever the engine is".
    useEffect(() => {
        setViewStepId(null);
        setBrowse(false);
    }, [activeWalkthrough?.id]);

    const steps = useMemo(() => activeWalkthrough?.steps || [], [activeWalkthrough?.steps]);
    const viewStep = useMemo(() => {
        const chosen = steps.find((step) => step.id === viewStepId);
        return chosen || currentStep || steps[steps.length - 1] || null;
    }, [currentStep, steps, viewStepId]);
    const viewIndex = viewStep ? steps.indexOf(viewStep) : -1;

    if (activeTab !== 'recipes') return null;

    const showLibrary = !activeWalkthrough || browse;
    const completedSteps = activeProgress?.completed || [];
    const isDone = viewStep ? completedSteps.includes(viewStep.id) : false;
    const isCurrent = viewStep && currentStep && viewStep.id === currentStep.id;
    const isLast = viewIndex === steps.length - 1;

    const runAction = async () => {
        if (!viewStep) return;
        // Verification steps (e.g. 2FA) run the live check instead of a jump;
        // every other step deep-links to the page that hosts the work, with
        // the console staying open underneath.
        if (viewStep.check && isCurrent) {
            setChecking(true);
            try { await checkCurrent(); } finally { setChecking(false); }
            return;
        }
        if (viewStep.path) navigate(viewStep.path);
    };

    const markDoneNext = () => {
        if (!activeWalkthrough || !viewStep) return;
        completeStep(activeWalkthrough.id, viewStep.id);
        setViewStepId(null);
    };

    const startRecipe = (id) => {
        start(id);
        setBrowse(false);
        setViewStepId(null);
    };

    return (
        <section
            className={`shell-panel shell-recipes${expanded ? ' is-expanded' : ''}`}
            aria-label={t('app.walkthroughs.title', 'Walkthroughs')}
        >
            <header className="shell-panel__head">
                <ShellDockTabs />
            </header>

            {showLibrary ? (
                <RecipeLibrary
                    walkthroughs={walkthroughs}
                    state={state}
                    onStart={startRecipe}
                    onStop={(id) => dismiss(id)}
                    t={t}
                />
            ) : (
                <div className="shell-recipes__split">
                    <div className="shell-recipes__rail">
                        <div className="shell-recipes__railhead">
                            <div className="shell-recipes__railtitle">
                                <strong>{activeWalkthrough.title}</strong>
                                <span>
                                    {t('app.walkthroughs.doneCount', '{{count}} of {{total}} done', {
                                        count: activeProgress?.count || 0,
                                        total: activeProgress?.total || steps.length,
                                    })}
                                </span>
                            </div>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setBrowse(true)}>
                                {t('app.walkthroughs.all', 'All walkthroughs')}
                            </Button>
                        </div>
                        <div className="shell-recipes__steps" role="tablist" aria-label={activeWalkthrough.title}>
                            {steps.map((step, index) => {
                                const done = completedSteps.includes(step.id);
                                const viewing = viewStep && step.id === viewStep.id;
                                return (
                                    <Button variant="unstyled"
                                        key={step.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={viewing}
                                        className={`shell-recipes__step${viewing ? ' is-viewing' : ''}${done ? ' is-done' : ''}`}
                                        onClick={() => setViewStepId(step.id)}
                                    >
                                        <span className="shell-recipes__step-marker">
                                            {done ? <Check size={12} /> : <span>{index + 1}</span>}
                                        </span>
                                        <span className="shell-recipes__step-title">{step.title}</span>
                                    </Button>
                                );
                            })}
                        </div>
                    </div>

                    {viewStep && (
                        <div className="shell-recipes__detail">
                            <div className="shell-recipes__eyebrow">
                                {t('app.walkthroughs.stepCount', 'Step {{current}} of {{total}}', {
                                    current: viewIndex + 1,
                                    total: steps.length,
                                })}
                            </div>
                            <h3 className="shell-recipes__step-heading">{viewStep.title}</h3>
                            <p className="shell-recipes__body">{viewStep.description}</p>
                            <footer className="shell-recipes__foot">
                                {(viewStep.path || viewStep.check) && (
                                    <Button type="button" size="sm" onClick={runAction} disabled={checking}>
                                        {checking ? t('common.checking', 'Checking…') : viewStep.action}
                                    </Button>
                                )}
                                {!viewStep.check && !isDone && (
                                    <Button type="button" variant="outline" size="sm" onClick={markDoneNext}>
                                        {isLast
                                            ? t('app.walkthroughs.markDone', 'Mark done')
                                            : t('app.walkthroughs.doneNextStep', 'Done · next step')}
                                    </Button>
                                )}
                                <span className="shell-panel__spacer" />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={viewIndex <= 0}
                                    onClick={() => setViewStepId(steps[Math.max(0, viewIndex - 1)]?.id)}
                                >
                                    {t('common.actions.back', 'Back')}
                                </Button>
                            </footer>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}
