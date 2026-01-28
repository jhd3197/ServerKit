import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Plus, GitBranch, Layers } from 'lucide-react';
import wordpressApi from '../services/wordpress';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';

const WordPressProjects = () => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const toast = useToast();

    useEffect(() => {
        loadProjects();
    }, []);

    async function loadProjects() {
        setLoading(true);
        try {
            const data = await wordpressApi.getProjects();
            setProjects(data.projects || []);
        } catch (err) {
            console.error('Failed to load projects:', err);
            toast.error('Failed to load WordPress projects');
        } finally {
            setLoading(false);
        }
    }

    if (loading) {
        return (
            <div className="page-loading">
                <Spinner size="lg" />
            </div>
        );
    }

    return (
        <div className="wp-projects-page">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>WordPress Projects</h1>
                    <p className="page-description">Manage WordPress sites with environment pipelines</p>
                </div>
            </div>

            {projects.length === 0 ? (
                <div className="empty-state-large">
                    <div className="empty-icon">
                        <Layers size={48} strokeWidth={1.5} />
                    </div>
                    <h2>No WordPress Projects</h2>
                    <p>WordPress projects with environment pipelines will appear here. Create a WordPress site with environments enabled to get started.</p>
                </div>
            ) : (
                <div className="wp-projects-grid">
                    {projects.map(project => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            onClick={() => navigate(`/wordpress/projects/${project.id}`)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const ProjectCard = ({ project, onClick }) => {
    const isRunning = project.status === 'running';
    const envCount = project.environment_count || 0;
    const envTypes = project.environment_types || [];
    const domain = project.application?.domains?.[0] || project.url || '';

    return (
        <div className="wp-project-card" onClick={onClick}>
            <div className="wp-project-card-header">
                <div className="wp-site-icon">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                        <path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 19.542c-5.261 0-9.542-4.281-9.542-9.542S6.739 2.458 12 2.458 21.542 6.739 21.542 12 17.261 21.542 12 21.542z" />
                    </svg>
                </div>
                <div className="wp-project-info">
                    <h3 className="wp-project-name">{project.name}</h3>
                    {domain && (
                        <span className="wp-project-domain">{domain}</span>
                    )}
                </div>
                <span className={`wp-env-status ${isRunning ? 'running' : 'stopped'}`}>
                    <span className="status-dot" />
                    {isRunning ? 'Running' : 'Stopped'}
                </span>
            </div>

            <div className="wp-project-card-body">
                <div className="wp-project-meta">
                    <div className="wp-project-meta-item">
                        <Layers size={14} />
                        <span>{envCount + 1} environment{envCount !== 0 ? 's' : ''}</span>
                    </div>
                    {envTypes.length > 0 && (
                        <div className="wp-project-env-badges">
                            <span className="wp-env-badge env-production">PROD</span>
                            {envTypes.includes('staging') && (
                                <span className="wp-env-badge env-staging">STG</span>
                            )}
                            {envTypes.includes('development') && (
                                <span className="wp-env-badge env-development">DEV</span>
                            )}
                            {envTypes.includes('multidev') && (
                                <span className="wp-env-badge env-multidev">MD</span>
                            )}
                        </div>
                    )}
                    {project.wp_version && (
                        <div className="wp-project-meta-item">
                            <span>WordPress {project.wp_version}</span>
                        </div>
                    )}
                    {project.git_repo_url && (
                        <div className="wp-project-meta-item">
                            <GitBranch size={14} />
                            <span>Git connected</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="wp-project-card-footer">
                <span className="wp-project-card-cta">View Pipeline</span>
                <ExternalLink size={14} />
            </div>
        </div>
    );
};

export default WordPressProjects;
