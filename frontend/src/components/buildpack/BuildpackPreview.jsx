import { useMemo, useState } from 'react';
import { Boxes, ChevronDown, FileCode2, Layers, Terminal, Zap } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import PortField from '@/components/PortField';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Map a plan's language to the primary version-override field.
const VERSION_FIELD = {
    node: { key: 'node_version', labelKey: 'app.buildpackPreview.nodeVersion', label: 'Node version', versionKey: 'node' },
    python: { key: 'python_version', labelKey: 'app.buildpackPreview.pythonVersion', label: 'Python version', versionKey: 'python' },
    go: { key: 'go_version', labelKey: 'app.buildpackPreview.goVersion', label: 'Go version', versionKey: 'go' },
    php: { key: 'php_version', labelKey: 'app.buildpackPreview.phpVersion', label: 'PHP version', versionKey: 'php' },
    ruby: { key: 'ruby_version', labelKey: 'app.buildpackPreview.rubyVersion', label: 'Ruby version', versionKey: 'ruby' },
    rust: { key: 'rust_version', labelKey: 'app.buildpackPreview.rustVersion', label: 'Rust version', versionKey: 'rust' },
};

const BUILDER_LABEL = {
    nixpacks: 'Build pack',
    static: 'Static site',
    'dockerfile-present': 'Existing Dockerfile',
    unknown: 'Not detected',
};

function confidenceLabel(confidence) {
    if (confidence >= 0.85) return 'High';
    if (confidence >= 0.6) return 'Medium';
    if (confidence > 0) return 'Low';
    return 'None';
}

/**
 * BuildpackPreview — renders a detected build plan, lets the user override the
 * runtime version / build command / start command / port, and shows the
 * generated Dockerfile (collapsible). Override changes are emitted via onChange.
 *
 * Props:
 *   plan        — the detected plan dict from /buildpacks/detect
 *   dockerfile  — generated Dockerfile string (preview)
 *   overrides   — current overrides object (controlled)
 *   onChange    — (overrides) => void
 *   loading     — bool, shows a loading shell
 */
function BuildpackPreview({ plan, dockerfile, overrides = {}, onChange, loading = false }) {
    const { t } = useTranslation();
    const [dockerfileOpen, setDockerfileOpen] = useState(false);

    const versionField = useMemo(() => {
        if (!plan?.language) return null;
        return VERSION_FIELD[plan.language] || null;
    }, [plan]);

    if (loading) {
        return (
            <div className="buildpack-preview buildpack-preview--loading">
                <div className="buildpack-preview__head">
                    <Zap size={16} className="spinning" />
                    <span>{t('app.buildpackPreview.detectingBuildPack', 'Detecting build pack…')}</span>
                </div>
            </div>
        );
    }

    if (!plan) return null;

    const builder = plan.builder || 'unknown';
    const unknown = builder === 'unknown';
    const present = builder === 'dockerfile-present';

    const emit = (key, value) => {
        if (!onChange) return;
        const next = { ...overrides };
        if (value === '' || value === null || value === undefined) {
            delete next[key];
        } else {
            next[key] = value;
        }
        onChange(next);
    };

    const versionValue = versionField
        ? (overrides[versionField.key] ?? plan.versions?.[versionField.versionKey] ?? '')
        : '';
    const buildValue = overrides.build_command ?? plan.build_command ?? '';
    const startValue = overrides.start_command ?? plan.start_command ?? '';
    const portValue = overrides.port ?? plan.port ?? '';

    return (
        <div className={`buildpack-preview ${unknown ? 'buildpack-preview--unknown' : ''}`}>
            <div className="buildpack-preview__head">
                <span className="buildpack-preview__head-icon">
                    <Boxes size={16} />
                </span>
                <div className="buildpack-preview__head-text">
                    <strong>{BUILDER_LABEL[builder] || builder}</strong>
                    <span>
                        {present
                            ? t('app.buildpackPreview.shipsOwnDockerfile', 'This repository ships its own Dockerfile. ServerKit will build it directly.')
                            : unknown
                                ? t('app.buildpackPreview.couldNotDetectStack', "Couldn't detect the stack with confidence. Pick a build method manually or add a Dockerfile.")
                                : t('app.buildpackPreview.willGenerateDockerfile', 'ServerKit will generate a Dockerfile from the detected stack.')}
                    </span>
                </div>
                <span className="buildpack-preview__confidence" data-level={confidenceLabel(plan.confidence).toLowerCase()}>
                    {confidenceLabel(plan.confidence)}
                </span>
            </div>

            <div className="buildpack-preview__facts">
                <div className="buildpack-preview__fact">
                    <span><Layers size={13} /> {t('app.buildpackPreview.language', 'Language')}</span>
                    <strong>{plan.language || '—'}</strong>
                </div>
                <div className="buildpack-preview__fact">
                    <span><Zap size={13} /> {t('app.buildpackPreview.framework', 'Framework')}</span>
                    <strong>{plan.framework || t('app.buildpackPreview.generic', 'Generic')}</strong>
                </div>
                <div className="buildpack-preview__fact">
                    <span><Boxes size={13} /> {t('common.labels.port', 'Port')}</span>
                    <strong>{plan.port || t('app.buildpackPreview.auto', 'Auto')}</strong>
                </div>
            </div>

            {plan.notes?.length > 0 && (
                <ul className="buildpack-preview__notes">
                    {plan.notes.map((note, i) => (
                        <li key={i}>{note}</li>
                    ))}
                </ul>
            )}

            {!present && !unknown && (
                <div className="buildpack-preview__overrides">
                    {versionField && (
                        <div className="buildpack-preview__field">
                            <Label htmlFor="bp-version">{versionField.label}</Label>
                            <Input
                                id="bp-version"
                                value={versionValue}
                                onChange={(e) => emit(versionField.key, e.target.value)}
                                placeholder={plan.versions?.[versionField.versionKey] || 'default'}
                                autoComplete="off"
                            />
                        </div>
                    )}
                    <div className="buildpack-preview__field">
                        <Label htmlFor="bp-port">{t('common.labels.port', 'Port')}</Label>
                        {/* The port the app listens on inside its container. */}
                        <PortField
                            id="bp-port"
                            host={false}
                            value={portValue}
                            onChange={(next) => emit('port', next === '' ? '' : String(next))}
                            placeholder={String(plan.port || '')}
                        />
                    </div>
                    <div className="buildpack-preview__field buildpack-preview__field--wide">
                        <Label htmlFor="bp-build">{t('app.buildpackPreview.buildCommand', 'Build command')}</Label>
                        <Input
                            id="bp-build"
                            value={buildValue}
                            onChange={(e) => emit('build_command', e.target.value)}
                            placeholder={plan.build_command || t('app.buildpackPreview.noBuildStep', 'No build step')}
                            autoComplete="off"
                        />
                    </div>
                    <div className="buildpack-preview__field buildpack-preview__field--wide">
                        <Label htmlFor="bp-start">{t('app.buildpackPreview.startCommand', 'Start command')}</Label>
                        <Input
                            id="bp-start"
                            value={startValue}
                            onChange={(e) => emit('start_command', e.target.value)}
                            placeholder={plan.start_command || ''}
                            autoComplete="off"
                        />
                    </div>
                </div>
            )}

            {dockerfile && !present && (
                <div className="buildpack-preview__dockerfile">
                    <SharedButton variant="unstyled"
                        type="button"
                        className="buildpack-preview__dockerfile-toggle"
                        onClick={() => setDockerfileOpen((open) => !open)}
                        aria-expanded={dockerfileOpen}
                    >
                        <span>
                            <FileCode2 size={15} />
                            {t('app.buildpackPreview.generatedDockerfile', 'Generated Dockerfile')}
                        </span>
                        <ChevronDown
                            size={16}
                            className={dockerfileOpen ? 'buildpack-preview__chevron--open' : ''}
                        />
                    </SharedButton>
                    {dockerfileOpen && (
                        <pre className="buildpack-preview__code">
                            <code>{dockerfile}</code>
                        </pre>
                    )}
                </div>
            )}

            {present && dockerfile && (
                <div className="buildpack-preview__present-note">
                    <Terminal size={14} />
                    <span>{t('app.buildpackPreview.usingTheRepositorySOwnDockerfile', 'Using the repository\'s own Dockerfile.')}</span>
                </div>
            )}
        </div>
    );
}

export default BuildpackPreview;
