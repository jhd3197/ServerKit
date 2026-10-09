import { useState } from 'react';
import { Globe, Code, Server, GitBranch, Check } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

const USE_CASE_OPTIONS = [
    {
        id: 'wordpress',
        labelKey: 'app.setupStepIntent.wordpressSites', label: 'WordPress sites',
        descriptionKey: 'app.setupStepIntent.blogsStoresContentSitesWithManaged', description: 'Blogs, stores, content sites with managed MySQL and PHP',
        icon: Globe,
    },
    {
        id: 'web-apps',
        labelKey: 'app.setupStepIntent.webApplications', label: 'Web services',
        descriptionKey: 'app.setupStepIntent.nodeJsPythonPhpOrDocker', description: 'Node.js, Python, PHP, or Docker-based services',
        icon: Code,
    },
    {
        id: 'self-hosted',
        labelKey: 'app.setupStepIntent.selfHostedServices', label: 'Self-hosted services',
        descriptionKey: 'app.setupStepIntent.nextcloudVaultwardenWikiJsMediaServers', description: 'Nextcloud, Vaultwarden, Wiki.js, media servers',
        icon: Server,
    },
    {
        id: 'devops',
        labelKey: 'app.setupStepIntent.devopsMonitoring', label: 'DevOps and monitoring',
        descriptionKey: 'app.setupStepIntent.ciCdGrafanaPrometheusLogAggregation', description: 'CI/CD, Grafana, Prometheus, log aggregation',
        icon: GitBranch,
    },
];

const SetupStepIntent = ({ selections, onComplete }) => {
    const { t } = useTranslation();
    const [selectedSet, setSelectedSet] = useState(new Set(selections || []));

    function toggleSelection(id) {
        setSelectedSet((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }

    function handleContinue() {
        onComplete(Array.from(selectedSet));
    }

    return (
        <div className="wizard-step">
            <h2 className="wizard-step-title">{t('app.setupStepIntent.whatWillYouUseThisServer', 'What will you use this server for?')}</h2>
            <p className="wizard-step-description">
                {t('app.setupStepIntent.selectAllThatApplyThisHelps', 'Select all that apply. This helps us tailor recommendations for you.')}
            </p>

            <div className="option-grid">
                {USE_CASE_OPTIONS.map((option) => {
                    const Icon = option.icon;
                    const isSelected = selectedSet.has(option.id);
                    return (
                        <div
                            key={option.id}
                            className={`option-card${isSelected ? ' selected' : ''}`}
                            onClick={() => toggleSelection(option.id)}
                        >
                            <div className="option-card-check">
                                <Check size={14} />
                            </div>
                            <div className="option-card-icon">
                                <Icon size={20} />
                            </div>
                            <div className="option-card-label">{option.label}</div>
                            <div className="option-card-desc">{option.description}</div>
                        </div>
                    );
                })}
            </div>

            <div className="wizard-nav wizard-nav--flush">
                <SharedButton variant="unstyled" type="button" className="btn-wizard-next" onClick={handleContinue}>
                    {t('common.actions.continue', 'Continue')}
                </SharedButton>
            </div>
        </div>
    );
};

export default SetupStepIntent;
