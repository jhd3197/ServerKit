import React, { useState } from 'react';
import { Globe, Code, Server, GitBranch, Check } from 'lucide-react';

const USE_CASE_OPTIONS = [
    {
        id: 'wordpress',
        label: 'WordPress Sites',
        description: 'Blogs, stores, content sites with managed MySQL & PHP',
        icon: Globe,
    },
    {
        id: 'web-apps',
        label: 'Web Applications',
        description: 'Node.js, Python, PHP, or Docker-based apps',
        icon: Code,
    },
    {
        id: 'self-hosted',
        label: 'Self-Hosted Services',
        description: 'Nextcloud, Vaultwarden, Wiki.js, media servers',
        icon: Server,
    },
    {
        id: 'devops',
        label: 'DevOps & Monitoring',
        description: 'CI/CD, Grafana, Prometheus, log aggregation',
        icon: GitBranch,
    },
];

const SetupStepIntent = ({ selections, onComplete }) => {
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
            <h2 className="wizard-step-title">What will you use this server for?</h2>
            <p className="wizard-step-description">
                Select all that apply. This helps us tailor recommendations for you.
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

            <div className="wizard-nav" style={{ borderTop: 'none', marginTop: 0, paddingTop: 0 }}>
                <button className="btn-wizard-next" onClick={handleContinue}>
                    Continue
                </button>
            </div>
        </div>
    );
};

export default SetupStepIntent;
