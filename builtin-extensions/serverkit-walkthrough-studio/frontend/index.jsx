import {
    ArrowDown,
    ArrowUp,
    BookOpenCheck,
    Braces,
    Copy,
    Download,
    Eye,
    FileUp,
    GripVertical,
    Plus,
    Save,
    Sparkles,
    Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    api,
    Button,
    copyToClipboard,
    downloadBlob,
    emitWalkthroughSignal,
    PageTopbar,
    useAuth,
    useConfirm,
    useToast,
    useWalkthroughs,
    validateWalkthroughDefinition,
    WALKTHROUGH_COMPLETION_TYPES,
} from '../sdk';

import './styles/walkthrough-studio.scss';


function createInitialStep(t) {
    return {
        id: 'open-page',
        title: t('walkthroughStudio.initialStepTitle', 'Open the page'),
        description: t('walkthroughStudio.initialStepDescription', 'Navigate to the place where this task begins.'),
        action: t('walkthroughStudio.initialStepAction', 'Open page'),
        path: '/',
        target: '',
        completion: { type: 'route', path: '/' },
    };
}

function createGuide(t) {
    return {
        id: 'my-walkthrough',
        title: t('walkthroughStudio.initialTitle', 'My walkthrough'),
        description: t('walkthroughStudio.initialDescription', 'Help an operator complete one clear outcome.'),
        duration: t('walkthroughStudio.initialDuration', 'About 5 minutes'),
        icon: 'guide',
        tone: 'cyan',
        secondary: true,
        permissions: [],
        steps: [createInitialStep(t)],
    };
}

function slugify(value, fallback) {
    const slug = String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || fallback;
}

function completionTypeLabel(t, value) {
    const labels = {
        manual: t('walkthroughStudio.completionManual', 'Manual confirmation'),
        route: t('walkthroughStudio.completionRouteReached', 'Route reached'),
        signal: t('walkthroughStudio.completionSignal', 'Success signal received'),
        check: t('walkthroughStudio.completionCheck', 'Named status check'),
        target: t('walkthroughStudio.completionTarget', 'Target becomes visible'),
    };
    return labels[value] || value;
}

function Field({ label, hint, children }) {
    return (
        <label className="wts-field">
            <span className="wts-field__label">{label}</span>
            {children}
            {hint && <small>{hint}</small>}
        </label>
    );
}

function CompletionFields({ step, onChange, t }) {
    const type = step.completion?.type || 'manual';
    if (type === 'signal') {
        return (
            <Field
                label={t('walkthroughStudio.signalName', 'Success signal')}
                hint={t('walkthroughStudio.signalHint', 'Emit this token only after the operation succeeds.')}
            >
                <input
                    value={step.completion.signal || ''}
                    onChange={(event) => onChange({ ...step.completion, signal: slugify(event.target.value, '') })}
                    placeholder="extension.resource-created"
                />
            </Field>
        );
    }
    if (type === 'check') {
        return (
            <Field
                label={t('walkthroughStudio.checkName', 'Named host check')}
                hint={t('walkthroughStudio.checkHint', 'Checks must be implemented and allowlisted by the host.')}
            >
                <input
                    value={step.completion.check || ''}
                    onChange={(event) => onChange({ ...step.completion, check: slugify(event.target.value, '') })}
                    placeholder="extension.resource-ready"
                />
            </Field>
        );
    }
    if (type === 'route') {
        return (
            <Field label={t('walkthroughStudio.completionRoute', 'Completion route')}>
                <input
                    value={step.completion.path || ''}
                    onChange={(event) => onChange({ ...step.completion, path: event.target.value })}
                    placeholder="/services"
                />
            </Field>
        );
    }
    if (type === 'target') {
        return (
            <p className="wts-callout">
                {t('walkthroughStudio.targetCompletionHint', 'This step completes when its data-walkthrough target becomes visible.')}
            </p>
        );
    }
    return (
        <p className="wts-callout">
            {t('walkthroughStudio.manualCompletionHint', 'The operator uses Done · next step after completing the instruction.')}
        </p>
    );
}

function GuidePreview({ guide, issues, onRun, t }) {
    return (
        <aside className="wts-preview" data-walkthrough="studio-preview">
            <div className="wts-panel-heading">
                <span>{t('common.labels.livePreview', 'Live preview')}</span>
                <span className={`wts-validity${issues.length ? ' is-invalid' : ''}`}>
                    {issues.length
                        ? t('walkthroughStudio.issueCount', '{{count}} issues', { count: issues.length })
                        : t('walkthroughStudio.valid', 'Valid')}
                </span>
            </div>

            <div className={`wts-guide-card is-${guide.tone || 'cyan'}`}>
                <span className="wts-guide-card__kicker">{guide.secondary
                    ? t('walkthroughStudio.optionalKicker', 'OPTIONAL GUIDE')
                    : t('walkthroughStudio.essentialKicker', 'ESSENTIAL GUIDE')}</span>
                <h2>{guide.title || t('walkthroughStudio.untitled', 'Untitled walkthrough')}</h2>
                <p>{guide.description || t('walkthroughStudio.addDescription', 'Add a description to explain the outcome.')}</p>
                <div className="wts-guide-card__meta">
                    <span>{guide.steps?.length || 0} {t('walkthroughStudio.steps', 'steps')}</span>
                    <span>{guide.duration || t('walkthroughStudio.noDuration', 'No duration')}</span>
                </div>
            </div>

            <ol className="wts-preview-steps">
                {(guide.steps || []).map((step, index) => (
                    <li key={`${step.id}-${index}`}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <div>
                            <strong>{step.title || t('walkthroughStudio.untitledStep', 'Untitled step')}</strong>
                            <small>{step.completion?.type || 'manual'} · {step.target || t('walkthroughStudio.noTarget', 'no target')}</small>
                        </div>
                    </li>
                ))}
            </ol>

            {issues.length > 0 && (
                <div className="wts-issues" role="alert">
                    {issues.slice(0, 6).map((item) => (
                        <p key={`${item.path}:${item.message}`}><strong>{item.path || 'guide'}</strong> {item.message}</p>
                    ))}
                </div>
            )}

            <Button type="button" variant="outline" onClick={onRun} disabled={issues.length > 0}>
                <Eye size={14} /> {t('walkthroughStudio.runInDock', 'Run in walkthrough dock')}
            </Button>

            <details className="wts-json">
                <summary><Braces size={14} /> {t('walkthroughStudio.definitionJson', 'Definition JSON')}</summary>
                <pre>{JSON.stringify(guide, null, 2)}</pre>
            </details>
        </aside>
    );
}

export function WalkthroughStudioPage() {
    const { t } = useTranslation();
    const toast = useToast();
    const { confirm } = useConfirm();
    const { isAdmin } = useAuth();
    const { preview, refreshDefinitions } = useWalkthroughs();
    const importRef = useRef(null);
    const [library, setLibrary] = useState([]);
    const [draft, setDraft] = useState(() => createGuide(t));
    const [originalId, setOriginalId] = useState(null);
    const [stepIndex, setStepIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);

    const issues = useMemo(() => validateWalkthroughDefinition(draft), [draft]);
    const activeStep = draft.steps?.[stepIndex] || null;

    const loadLibrary = useCallback(async () => {
        setLoading(true);
        try {
            const response = await api.getWalkthroughDefinitions();
            setLibrary(Array.isArray(response?.definitions) ? response.definitions : []);
        } catch (error) {
            toast.error(error.message || t('walkthroughStudio.loadFailed', 'Couldn\'t load the walkthrough library'));
        } finally {
            setLoading(false);
        }
    }, [t, toast]);

    useEffect(() => { loadLibrary(); }, [loadLibrary]);

    const updateGuide = (patch) => setDraft((current) => ({ ...current, ...patch }));
    const updateStep = (patch) => setDraft((current) => ({
        ...current,
        steps: current.steps.map((step, index) => (
            index === stepIndex ? { ...step, ...patch } : step
        )),
    }));

    const selectGuide = (guide) => {
        setDraft(JSON.parse(JSON.stringify(guide)));
        setOriginalId(guide.id);
        setStepIndex(0);
    };

    const newGuide = () => {
        setDraft(createGuide(t));
        setOriginalId(null);
        setStepIndex(0);
    };

    const addStep = () => {
        // The appended list and the index that selects into it must come from
        // one snapshot. Reading draft.steps.length *after* a functional
        // setDraft can observe a different list than the one just appended
        // to, which selects the wrong step or an index past the end.
        const nextNumber = draft.steps.length + 1;
        const steps = [...draft.steps, {
            id: `step-${nextNumber}`,
            title: t('walkthroughStudio.numberedStep', 'Step {{number}}', { number: nextNumber }),
            description: t('walkthroughStudio.newStepDescription', 'Describe the operator action and the expected outcome.'),
            action: t('walkthroughStudio.initialStepAction', 'Open page'),
            path: '/',
            target: '',
            completion: { type: 'manual' },
        }];
        setDraft({ ...draft, steps });
        setStepIndex(steps.length - 1);
    };

    const moveStep = (direction) => {
        const nextIndex = stepIndex + direction;
        if (nextIndex < 0 || nextIndex >= draft.steps.length) return;
        setDraft((current) => {
            const steps = [...current.steps];
            [steps[stepIndex], steps[nextIndex]] = [steps[nextIndex], steps[stepIndex]];
            return { ...current, steps };
        });
        setStepIndex(nextIndex);
    };

    const deleteStep = () => {
        if (draft.steps.length <= 1) {
            toast.warning(t('walkthroughStudio.keepOneStep', 'A walkthrough needs at least one step.'));
            return;
        }
        setDraft((current) => ({
            ...current,
            steps: current.steps.filter((_, index) => index !== stepIndex),
        }));
        setStepIndex((current) => Math.max(0, current - 1));
    };

    const saveGuide = async () => {
        if (!isAdmin) {
            toast.error(t('walkthroughStudio.adminRequired', 'Administrator access is required to publish walkthroughs.'));
            return;
        }
        if (issues.length > 0) {
            toast.warning(t('walkthroughStudio.fixIssues', 'Fix the validation issues before publishing.'));
            return;
        }
        setSaving(true);
        try {
            const withoutOriginal = library.filter((guide) => guide.id !== originalId && guide.id !== draft.id);
            const nextLibrary = [...withoutOriginal, draft];
            const response = await api.updateWalkthroughDefinitions(nextLibrary);
            setLibrary(response.definitions || nextLibrary);
            setOriginalId(draft.id);
            await refreshDefinitions();
            emitWalkthroughSignal('walkthrough-studio-guide-saved', { guideId: draft.id });
            toast.success(t('walkthroughStudio.published', 'Walkthrough published'));
        } catch (error) {
            toast.error(error.message || t('walkthroughStudio.publishFailed', 'Couldn\'t publish the walkthrough'));
        } finally {
            setSaving(false);
        }
    };

    const deleteGuide = async (guide) => {
        if (!await confirm({
            title: t('walkthroughStudio.deleteTitle', 'Delete walkthrough'),
            message: t('walkthroughStudio.deleteMessage', 'Delete "{{title}}"? It\'s removed from the shared library and the walkthrough dock for everyone. This can\'t be undone.', { title: guide.title }),
            confirmText: t('common.actions.delete', 'Delete'),
        })) return;
        try {
            const nextLibrary = library.filter((item) => item.id !== guide.id);
            await api.updateWalkthroughDefinitions(nextLibrary);
            setLibrary(nextLibrary);
            if (originalId === guide.id) newGuide();
            await refreshDefinitions();
            toast.success(t('walkthroughStudio.deleted', 'Walkthrough deleted'));
        } catch (error) {
            toast.error(error.message || t('walkthroughStudio.deleteFailed', 'Couldn\'t delete the walkthrough'));
        }
    };

    const importFile = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            const imported = Array.isArray(parsed)
                ? parsed[0]
                : (parsed.walkthroughs?.[0] || parsed.contributions?.walkthroughs?.[0] || parsed);
            if (validateWalkthroughDefinition(imported).length > 0) {
                throw new Error(t('walkthroughStudio.importInvalid', 'The file does not contain a valid walkthrough.'));
            }
            setDraft(imported);
            setOriginalId(null);
            setStepIndex(0);
            toast.success(t('walkthroughStudio.imported', 'Walkthrough imported as a draft'));
        } catch (error) {
            toast.error(error.message || t('walkthroughStudio.importFailed', 'Couldn\'t import this file'));
        }
    };

    const copyContribution = async () => {
        await copyToClipboard(JSON.stringify({ walkthroughs: [draft] }, null, 2));
        toast.success(t('walkthroughStudio.contributionCopied', 'Extension contribution copied'));
    };

    const runPreview = () => {
        if (!preview(draft)) {
            toast.error(t('walkthroughStudio.previewFailed', 'Couldn\'t preview the draft'));
            return;
        }
        toast.info(t('walkthroughStudio.previewOpened', 'Draft opened in the walkthrough dock.'));
    };

    const actions = (
        <>
            <input ref={importRef} className="wts-file-input" type="file" accept="application/json,.json" onChange={importFile} />
            <Button type="button" variant="ghost" size="sm" onClick={() => importRef.current?.click()}>
                <FileUp size={14} /> {t('common.actions.import', 'Import')}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => downloadBlob(`${JSON.stringify(draft, null, 2)}\n`, `${draft.id || 'walkthrough'}.json`, { type: 'application/json' })}>
                <Download size={14} /> {t('common.actions.export', 'Export')}
            </Button>
            <Button type="button" size="sm" onClick={saveGuide} disabled={saving || issues.length > 0} data-walkthrough="studio-publish">
                <Save size={14} /> {saving ? t('common.saving', 'Saving…') : t('common.actions.publish', 'Publish')}
            </Button>
        </>
    );

    return (
        <div className="page-container page-container--full-bleed wts-page">
            <PageTopbar
                icon={<BookOpenCheck size={18} />}
                title={t('walkthroughStudio.title', 'Walkthrough Studio')}
                meta={t('walkthroughStudio.meta', 'Declarative guide authoring')}
                actions={actions}
            />

            <div className="wts-shell">
                <aside className="wts-library">
                    <div className="wts-panel-heading">
                        <span>{t('walkthroughStudio.library', 'Shared library')}</span>
                        <Button type="button" variant="ghost" size="icon" onClick={newGuide} aria-label={t('walkthroughStudio.newGuide', 'New walkthrough')}>
                            <Plus size={15} />
                        </Button>
                    </div>
                    <p className="wts-library__intro">
                        {t('walkthroughStudio.libraryIntro', 'Published guides appear in the walkthrough dock for everyone with the required permissions.')}
                    </p>
                    <div className="wts-library__list">
                        {loading && <p className="wts-muted">{t('common.loading', 'Loading…')}</p>}
                        {!loading && library.length === 0 && (
                            <Button variant="unstyled" type="button" className="wts-library__empty" onClick={newGuide}>
                                <Sparkles size={18} />
                                <strong>{t('walkthroughStudio.createFirst', 'Create the first custom guide')}</strong>
                                <span>{t('walkthroughStudio.noCodeRequired', 'No application code required')}</span>
                            </Button>
                        )}
                        {library.map((guide) => (
                            <div key={guide.id} className={`wts-library__item${originalId === guide.id ? ' is-active' : ''}`}>
                                <Button variant="unstyled" type="button" onClick={() => selectGuide(guide)}>
                                    <strong>{guide.title}</strong>
                                    <span>{guide.steps.length} {t('walkthroughStudio.steps', 'steps')}</span>
                                </Button>
                                <Button type="button" variant="ghost" size="icon" onClick={() => deleteGuide(guide)} aria-label={t('common.actions.delete', 'Delete')}>
                                    <Trash2 size={13} />
                                </Button>
                            </div>
                        ))}
                    </div>
                    <div className="wts-library__footer">
                        <Button type="button" variant="outline" size="sm" onClick={copyContribution}>
                            <Copy size={13} /> {t('walkthroughStudio.copyContribution', 'Copy contribution')}
                        </Button>
                    </div>
                </aside>

                <main className="wts-editor">
                    <section className="wts-section" data-walkthrough="studio-guide-meta">
                        <div className="wts-section__head">
                            <div>
                                <span className="wts-eyebrow">{t('walkthroughStudio.guideEyebrow', '01 / GUIDE')}</span>
                                <h2>{t('walkthroughStudio.outcome', 'Define the outcome')}</h2>
                            </div>
                            <label className="wts-toggle">
                                <input type="checkbox" checked={draft.secondary !== false} onChange={(event) => updateGuide({ secondary: event.target.checked })} />
                                <span>{t('walkthroughStudio.optional', 'Optional guide')}</span>
                            </label>
                        </div>
                        <div className="wts-form-grid">
                            <Field label={t('common.labels.title', 'Title')}>
                                <input value={draft.title} onChange={(event) => updateGuide({ title: event.target.value })} />
                            </Field>
                            <Field label={t('walkthroughStudio.stableId', 'Stable id')} hint={t('walkthroughStudio.stableIdHint', 'Do not rename after publishing; progress uses this id.')}>
                                <input value={draft.id} onChange={(event) => updateGuide({ id: slugify(event.target.value, '') })} />
                            </Field>
                            <Field label={t('walkthroughStudio.description', 'Outcome description')}>
                                <textarea rows="3" value={draft.description} onChange={(event) => updateGuide({ description: event.target.value })} />
                            </Field>
                            <div className="wts-form-grid__compact">
                                <Field label={t('common.labels.duration', 'Duration')}>
                                    <input value={draft.duration || ''} onChange={(event) => updateGuide({ duration: event.target.value })} />
                                </Field>
                                <Field label={t('walkthroughStudio.icon', 'Icon token')}>
                                    <input value={draft.icon || ''} onChange={(event) => updateGuide({ icon: slugify(event.target.value, '') })} />
                                </Field>
                                <Field label={t('walkthroughStudio.tone', 'Tone')}>
                                    <select value={draft.tone || 'cyan'} onChange={(event) => updateGuide({ tone: event.target.value })}>
                                        {['cyan', 'green', 'amber', 'blue', 'violet', 'neutral'].map((tone) => <option key={tone} value={tone}>{tone}</option>)}
                                    </select>
                                </Field>
                            </div>
                        </div>
                    </section>

                    <section className="wts-section" data-walkthrough="studio-step-list">
                        <div className="wts-section__head">
                            <div>
                                <span className="wts-eyebrow">{t('walkthroughStudio.flowEyebrow', '02 / FLOW')}</span>
                                <h2>{t('walkthroughStudio.stepsAndSignals', 'Shape the steps and signals')}</h2>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={addStep}>
                                <Plus size={13} /> {t('walkthroughStudio.addStep', 'Add step')}
                            </Button>
                        </div>

                        <div className="wts-step-workbench">
                            <div className="wts-step-rail">
                                {draft.steps.map((step, index) => (
                                    <Button variant="unstyled"
                                        key={`${step.id}-${index}`}
                                        type="button"
                                        className={index === stepIndex ? 'is-active' : ''}
                                        onClick={() => setStepIndex(index)}
                                    >
                                        <GripVertical size={13} />
                                        <span>{String(index + 1).padStart(2, '0')}</span>
                                        <strong>{step.title || t('walkthroughStudio.untitledStep', 'Untitled step')}</strong>
                                        <small>{step.completion?.type || 'manual'}</small>
                                    </Button>
                                ))}
                            </div>

                            {activeStep && (
                                <div className="wts-step-editor">
                                    <div className="wts-step-editor__tools">
                                        <span>{t('walkthroughStudio.stepEyebrow', 'STEP {{number}}', { number: String(stepIndex + 1).padStart(2, '0') })}</span>
                                        <Button type="button" variant="ghost" size="icon" onClick={() => moveStep(-1)} disabled={stepIndex === 0} aria-label={t('common.actions.moveUp', 'Move up')}><ArrowUp size={14} /></Button>
                                        <Button type="button" variant="ghost" size="icon" onClick={() => moveStep(1)} disabled={stepIndex === draft.steps.length - 1} aria-label={t('common.actions.moveDown', 'Move down')}><ArrowDown size={14} /></Button>
                                        <Button type="button" variant="ghost" size="icon" onClick={deleteStep} aria-label={t('common.actions.delete', 'Delete')}><Trash2 size={14} /></Button>
                                    </div>
                                    <div className="wts-form-grid">
                                        <Field label={t('walkthroughStudio.stepTitle', 'Step title')}>
                                            <input value={activeStep.title} onChange={(event) => updateStep({ title: event.target.value })} />
                                        </Field>
                                        <Field label={t('walkthroughStudio.stepId', 'Step id')}>
                                            <input value={activeStep.id} onChange={(event) => updateStep({ id: slugify(event.target.value, '') })} />
                                        </Field>
                                        <Field label={t('walkthroughStudio.instruction', 'Instruction')}>
                                            <textarea rows="3" value={activeStep.description} onChange={(event) => updateStep({ description: event.target.value })} />
                                        </Field>
                                        <div className="wts-form-grid__compact">
                                            <Field label={t('walkthroughStudio.openPath', 'Open path')}>
                                                <input value={activeStep.path || ''} onChange={(event) => updateStep({ path: event.target.value })} placeholder="/services" />
                                            </Field>
                                            <Field label={t('walkthroughStudio.actionLabel', 'Action label')}>
                                                <input value={activeStep.action || ''} onChange={(event) => updateStep({ action: event.target.value })} placeholder={t('walkthroughStudio.actionPlaceholder', 'Open services')} />
                                            </Field>
                                        </div>
                                        <Field label={t('walkthroughStudio.targetToken', 'Target token')} hint={t('walkthroughStudio.targetHint', 'Matches data-walkthrough="token" in the page markup.')}>
                                            <input value={activeStep.target || ''} onChange={(event) => updateStep({ target: slugify(event.target.value, '') })} placeholder="service-create-button" />
                                        </Field>
                                        <Field label={t('walkthroughStudio.completionType', 'Completion type')}>
                                            <select
                                                value={activeStep.completion?.type || 'manual'}
                                                onChange={(event) => updateStep({ completion: { type: event.target.value } })}
                                            >
                                                {WALKTHROUGH_COMPLETION_TYPES.map((type) => <option key={type.value} value={type.value}>{completionTypeLabel(t, type.value)}</option>)}
                                            </select>
                                        </Field>
                                        <CompletionFields step={activeStep} onChange={(completion) => updateStep({ completion })} t={t} />
                                    </div>
                                </div>
                            )}
                        </div>
                    </section>
                </main>

                <GuidePreview guide={draft} issues={issues} onRun={runPreview} t={t} />
            </div>
        </div>
    );
}

// No default export on purpose: the route contribution resolves the named
// WalkthroughStudioPage export, and a default export would make the legacy
// auto-render in PluginLoader mount this whole page globally on panels
// where the extension is not installed.
