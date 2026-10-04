import { GitBranch, FolderOpen, FileArchive } from 'lucide-react';
import { SiGithub } from 'react-icons/si';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// Step 1 — Source. Four clean radio-cards; selecting one advances to Connect.
//
// No "Deploy Template" card: a curated template already declares its repo,
// branch, build method and port, so this wizard's detect-and-confirm steps had
// nothing left to ask. Templates deploy from the drawer on /templates, which is
// also what their cards and Deploy buttons open — one surface, not two.
const SOURCES = [
    { mode: 'github', Icon: SiGithub, titleKey: 'app.sourceStep.github', title: 'GitHub', sub: 'Connect with OAuth and choose a repository' },
    { mode: 'manual', Icon: GitBranch, titleKey: 'app.sourceStep.otherGitRemote', title: 'Other Git Remote', sub: 'GitLab, Bitbucket, Gitea, or SSH' },
    { mode: 'local', Icon: FolderOpen, titleKey: 'app.sourceStep.manualLocal', title: 'Manual / Local', sub: 'Register an app already on the server' },
    { mode: 'upload', Icon: FileArchive, titleKey: 'app.sourceStep.uploadZip', title: 'Upload ZIP', sub: 'Deploy or update from a zip archive' },
];

const SourceStep = ({ form }) => {
    const { t } = useTranslation();
    const choose = (mode) => {
        form.selectSource(mode);
        form.setStep(2);
    };

    return (
        <div className="new-service-page__step">
            <div className="new-service-page__step-head">
                <h2>{t('app.sourceStep.howDoYouWantToDeploy', 'How do you want to deploy?')}</h2>
            </div>
            <div className="new-service-page__sources" data-walkthrough="service-sources" role="radiogroup" aria-label={t('app.sourceStep.serviceSource', 'Service source')}>
                {SOURCES.map(({ mode, Icon, title, sub }) => (
                    <SharedButton variant="unstyled"
                        key={mode}
                        type="button"
                        role="radio"
                        aria-checked={form.sourceMode === mode}
                        className={`new-service-page__source-card ${form.sourceMode === mode ? 'new-service-page__source-card--on' : ''}`}
                        onClick={() => choose(mode)}
                    >
                        <span className="new-service-page__source-icon">
                            <Icon size={20} />
                        </span>
                        <span className="new-service-page__source-text">
                            <strong>{title}</strong>
                            <span>{sub}</span>
                        </span>
                    </SharedButton>
                ))}
            </div>
        </div>
    );
};

export default SourceStep;
