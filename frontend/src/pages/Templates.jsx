import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    Search, X, Star, ExternalLink, BookOpen, Container, Globe, BarChart3,
    Database, Shield, Cloud, MessageSquare, Video, Music, Image, Home,
    Code, Server, GitBranch, Workflow, HardDrive, Lock, Users, FileText,
    Settings, Layers, ChevronDown, Copy, Check, Tag, Cpu, HardDriveIcon
} from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

// Featured templates (curated list)
const FEATURED_TEMPLATES = [
    'wordpress', 'nextcloud', 'grafana', 'portainer', 'uptime-kuma',
    'gitea', 'vaultwarden', 'jellyfin', 'ghost', 'n8n'
];

// Icon mapping for templates
const TEMPLATE_ICONS = {
    // Monitoring
    'uptime-kuma': BarChart3,
    'grafana': BarChart3,
    'prometheus': BarChart3,
    'netdata': BarChart3,
    'loki': BarChart3,
    'jaeger': BarChart3,
    'plausible': BarChart3,
    'umami': BarChart3,
    // CMS / Blog
    'wordpress': Globe,
    'ghost': FileText,
    'strapi': Layers,
    'directus': Database,
    'payload': Layers,
    'grav': FileText,
    // DevOps
    'portainer': Container,
    'jenkins': Workflow,
    'drone': Workflow,
    'gitlab-runner': GitBranch,
    'sonarqube': Code,
    'registry': Container,
    'vault': Lock,
    // Storage
    'nextcloud': Cloud,
    'minio': Cloud,
    'seafile': Cloud,
    'filebrowser': HardDrive,
    'syncthing': Cloud,
    'duplicati': HardDrive,
    // Collaboration
    'rocketchat': MessageSquare,
    'mattermost': MessageSquare,
    'matrix-synapse': MessageSquare,
    'jitsi': Video,
    // Media
    'jellyfin': Video,
    'plex': Video,
    'photoprism': Image,
    'immich': Image,
    'navidrome': Music,
    // Productivity
    'bookstack': BookOpen,
    'wikijs': BookOpen,
    'outline': FileText,
    'excalidraw': FileText,
    'n8n': Workflow,
    // Security
    'vaultwarden': Lock,
    'authelia': Shield,
    'keycloak': Shield,
    'crowdsec': Shield,
    // Database tools
    'phpmyadmin': Database,
    'pgadmin': Database,
    'redis-commander': Database,
    'mongo-express': Database,
    // Home Automation
    'homeassistant': Home,
    'nodered': Workflow,
    'mosquitto': Home,
    'zigbee2mqtt': Home,
    // Development
    'code-server': Code,
    'gitea': GitBranch,
    // Networking
    'traefik': Server,
    'caddy': Server,
    'nginx-proxy-manager': Server,
    // Custom apps
    'php-app': Code,
    'python-app': Code,
    'node-app': Code
};

const Templates = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [searchParams, setSearchParams] = useSearchParams();

    const [templates, setTemplates] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [failedIcons, setFailedIcons] = useState(new Set());
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [showInstallModal, setShowInstallModal] = useState(false);
    const [copiedCompose, setCopiedCompose] = useState(false);

    // Initialize from URL params
    const selectedCategory = searchParams.get('category') || null;
    const searchQuery = searchParams.get('search') || '';
    const sortBy = searchParams.get('sort') || 'name-asc';
    const installTemplateId = searchParams.get('install');

    useEffect(() => {
        loadData();
    }, []);

    // Auto-open install modal if template ID is in URL
    useEffect(() => {
        if (installTemplateId && templates.length > 0 && !loading) {
            const template = templates.find(t => t.id === installTemplateId);
            if (template) {
                handleViewTemplate(template).then(() => {
                    setShowInstallModal(true);
                });
                // Clear the install param from URL
                const newParams = new URLSearchParams(searchParams);
                newParams.delete('install');
                setSearchParams(newParams, { replace: true });
            }
        }
    }, [installTemplateId, templates, loading]);

    useEffect(() => {
        loadTemplates();
    }, [selectedCategory, searchQuery]);

    function updateFilters(updates) {
        const newParams = new URLSearchParams(searchParams);
        Object.entries(updates).forEach(([key, value]) => {
            if (value) {
                newParams.set(key, value);
            } else {
                newParams.delete(key);
            }
        });
        setSearchParams(newParams);
    }

    function setSelectedCategoryFilter(category) {
        updateFilters({ category });
    }

    function setSearchQueryFilter(search) {
        updateFilters({ search: search || null });
    }

    function setSortByFilter(sort) {
        updateFilters({ sort });
    }

    function clearAllFilters() {
        setSearchParams(new URLSearchParams());
    }

    async function loadData() {
        try {
            const [templatesRes, categoriesRes] = await Promise.all([
                api.listTemplates(),
                api.getTemplateCategories()
            ]);
            setTemplates(templatesRes.templates || []);
            setCategories(categoriesRes.categories || []);
        } catch (err) {
            toast.error('Failed to load templates');
        } finally {
            setLoading(false);
        }
    }

    async function loadTemplates() {
        try {
            const result = await api.listTemplates(selectedCategory, searchQuery || null);
            setTemplates(result.templates || []);
        } catch (err) {
            console.error('Failed to load templates:', err);
        }
    }

    function handleIconError(templateId) {
        setFailedIcons(prev => new Set(prev).add(templateId));
    }

    function getTemplateIcon(templateId) {
        return TEMPLATE_ICONS[templateId] || Layers;
    }

    function renderIcon(template, size = 32) {
        const IconComponent = getTemplateIcon(template.id);
        const hasIcon = template.icon && !failedIcons.has(template.id);

        if (hasIcon) {
            return (
                <img
                    src={template.icon}
                    alt={template.name}
                    onError={() => handleIconError(template.id)}
                />
            );
        }
        return <IconComponent size={size} />;
    }

    function getCategoryIcon(category) {
        const icons = {
            monitoring: '📊',
            devops: '⚙️',
            docker: '🐳',
            cms: '📝',
            blog: '✍️',
            storage: '💾',
            collaboration: '👥',
            git: '🔀',
            development: '💻',
            networking: '🌐',
            proxy: '🔄',
            ssl: '🔒',
            productivity: '📋',
            management: '📁',
            publishing: '📰',
            media: '🎬',
            security: '🛡️',
            database: '🗄️',
            'home-automation': '🏠',
            analytics: '📈',
            iot: '📡'
        };
        return icons[category] || '📦';
    }

    async function handleViewTemplate(template) {
        try {
            const result = await api.getTemplate(template.id);
            if (result.template) {
                setSelectedTemplate(result.template);
            }
        } catch (err) {
            toast.error('Failed to load template details');
        }
    }

    function isFeatured(templateId) {
        return FEATURED_TEMPLATES.includes(templateId);
    }

    // Sort templates
    function sortTemplates(templates) {
        const sorted = [...templates];
        switch (sortBy) {
            case 'name-asc':
                return sorted.sort((a, b) => a.name.localeCompare(b.name));
            case 'name-desc':
                return sorted.sort((a, b) => b.name.localeCompare(a.name));
            case 'featured':
                return sorted.sort((a, b) => {
                    const aFeatured = isFeatured(a.id);
                    const bFeatured = isFeatured(b.id);
                    if (aFeatured && !bFeatured) return -1;
                    if (!aFeatured && bFeatured) return 1;
                    return a.name.localeCompare(b.name);
                });
            default:
                return sorted;
        }
    }

    const sortedTemplates = sortTemplates(templates);
    const hasActiveFilters = selectedCategory || searchQuery;

    if (loading) {
        return (
            <div className="page">
                <div className="loading">Loading templates...</div>
            </div>
        );
    }

    return (
        <div className="page templates-page">
            <div className="page-header">
                <h1>App Templates</h1>
                <p className="page-description">One-click deployment for popular self-hosted applications</p>
            </div>

            {/* Search and Filters */}
            <div className="templates-filters">
                <div className="search-box">
                    <Search size={18} className="search-icon" />
                    <input
                        type="text"
                        placeholder="Search templates..."
                        value={searchQuery}
                        onChange={(e) => setSearchQueryFilter(e.target.value)}
                    />
                    {searchQuery && (
                        <button className="search-clear" onClick={() => setSearchQueryFilter('')}>
                            <X size={16} />
                        </button>
                    )}
                </div>
                <div className="category-filters">
                    <button
                        className={`category-btn ${!selectedCategory ? 'active' : ''}`}
                        onClick={() => setSelectedCategoryFilter(null)}
                    >
                        All
                    </button>
                    {categories.slice(0, 12).map(category => (
                        <button
                            key={category}
                            className={`category-btn ${selectedCategory === category ? 'active' : ''}`}
                            onClick={() => setSelectedCategoryFilter(category)}
                        >
                            {getCategoryIcon(category)} {category}
                        </button>
                    ))}
                </div>
            </div>

            {/* Active Filters */}
            {hasActiveFilters && (
                <div className="active-filters">
                    {selectedCategory && (
                        <span className="filter-chip">
                            <Tag size={14} />
                            {selectedCategory}
                            <button onClick={() => setSelectedCategoryFilter(null)}>
                                <X size={14} />
                            </button>
                        </span>
                    )}
                    {searchQuery && (
                        <span className="filter-chip">
                            <Search size={14} />
                            "{searchQuery}"
                            <button onClick={() => setSearchQueryFilter('')}>
                                <X size={14} />
                            </button>
                        </span>
                    )}
                    <button className="clear-all-btn" onClick={clearAllFilters}>
                        Clear All
                    </button>
                </div>
            )}

            {/* Results Header */}
            <div className="templates-results-header">
                <span className="results-count">
                    {sortedTemplates.length} template{sortedTemplates.length !== 1 ? 's' : ''}
                </span>
                <div className="sort-dropdown">
                    <label>Sort by:</label>
                    <select value={sortBy} onChange={(e) => setSortByFilter(e.target.value)}>
                        <option value="name-asc">Name (A-Z)</option>
                        <option value="name-desc">Name (Z-A)</option>
                        <option value="featured">Featured First</option>
                    </select>
                    <ChevronDown size={16} className="dropdown-icon" />
                </div>
            </div>

            {/* Templates Grid */}
            <div className="templates-grid">
                {sortedTemplates.length === 0 ? (
                    <div className="empty-state">
                        <Layers size={48} />
                        <p>No templates found</p>
                        {hasActiveFilters && (
                            <button className="btn btn-secondary btn-sm" onClick={clearAllFilters}>
                                Clear Filters
                            </button>
                        )}
                    </div>
                ) : (
                    sortedTemplates.map(template => (
                        <div key={template.id} className="template-card" onClick={() => handleViewTemplate(template)}>
                            {isFeatured(template.id) && (
                                <span className="featured-badge">
                                    <Star size={12} /> Featured
                                </span>
                            )}
                            <div className="template-icon">
                                {renderIcon(template, 32)}
                            </div>
                            <div className="template-info">
                                <h3>{template.name}</h3>
                                <p className="template-description">{template.description}</p>
                                <div className="template-meta">
                                    <span className="template-version">v{template.version}</span>
                                    {template.website && (
                                        <span className="template-link-indicator" title="Has website">
                                            <ExternalLink size={12} />
                                        </span>
                                    )}
                                    {template.documentation && (
                                        <span className="template-link-indicator" title="Has documentation">
                                            <BookOpen size={12} />
                                        </span>
                                    )}
                                    <div className="template-categories">
                                        {(template.categories || []).slice(0, 2).map(cat => (
                                            <span key={cat} className="category-badge">
                                                {cat}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* Template Detail Modal */}
            {selectedTemplate && (
                <div className="modal-overlay" onClick={() => setSelectedTemplate(null)}>
                    <div className="modal modal-lg" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="template-detail-header">
                                <div className="template-icon-large">
                                    {renderIcon(selectedTemplate, 40)}
                                </div>
                                <div>
                                    <h2>{selectedTemplate.name}</h2>
                                    <span className="template-version">Version {selectedTemplate.version}</span>
                                </div>
                            </div>
                            <button className="modal-close" onClick={() => setSelectedTemplate(null)}>&times;</button>
                        </div>
                        <div className="modal-body">
                            <p className="template-full-description">{selectedTemplate.description}</p>

                            <div className="template-links">
                                {selectedTemplate.website && (
                                    <a href={selectedTemplate.website} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                                        <ExternalLink size={14} /> Website
                                    </a>
                                )}
                                {selectedTemplate.documentation && (
                                    <a href={selectedTemplate.documentation} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                                        <BookOpen size={14} /> Documentation
                                    </a>
                                )}
                            </div>

                            <div className="template-details-grid">
                                <div className="detail-section">
                                    <h4><Tag size={16} /> Categories</h4>
                                    <div className="template-categories">
                                        {(selectedTemplate.categories || []).map(cat => (
                                            <span key={cat} className="category-badge">
                                                {getCategoryIcon(cat)} {cat}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {selectedTemplate.requirements && (
                                    <div className="detail-section">
                                        <h4><Cpu size={16} /> Requirements</h4>
                                        <div className="requirements-list">
                                            {selectedTemplate.requirements.memory && (
                                                <div className="requirement-item">
                                                    <span className="requirement-label">Memory:</span>
                                                    <span className="requirement-value">{selectedTemplate.requirements.memory}</span>
                                                </div>
                                            )}
                                            {selectedTemplate.requirements.storage && (
                                                <div className="requirement-item">
                                                    <span className="requirement-label">Storage:</span>
                                                    <span className="requirement-value">{selectedTemplate.requirements.storage}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {selectedTemplate.variables && selectedTemplate.variables.length > 0 && (
                                    <div className="detail-section">
                                        <h4><Settings size={16} /> Configuration Variables</h4>
                                        <div className="variables-list">
                                            {selectedTemplate.variables
                                                .filter(v => !v.hidden)
                                                .sort((a, b) => (b.required ? 1 : 0) - (a.required ? 1 : 0))
                                                .map(variable => (
                                                <div key={variable.name} className={`variable-item ${variable.required ? 'required' : ''}`}>
                                                    <div className="variable-header">
                                                        <span className="variable-name">{variable.name}</span>
                                                        {variable.required && <span className="required-badge">Required</span>}
                                                        {variable.auto_generated && <span className="auto-badge">Auto</span>}
                                                    </div>
                                                    {variable.description && (
                                                        <span className="variable-description">{variable.description}</span>
                                                    )}
                                                    {variable.default && !variable.auto_generated && (
                                                        <span className="variable-default">Default: {variable.default}</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {selectedTemplate.ports && selectedTemplate.ports.length > 0 && (
                                    <div className="detail-section">
                                        <h4><Server size={16} /> Exposed Ports</h4>
                                        <div className="ports-list">
                                            {selectedTemplate.ports.map((port, index) => (
                                                <div key={index} className="port-item">
                                                    <span className="port-number">{port.port}</span>
                                                    <span className="port-protocol">{port.protocol}</span>
                                                    {port.description && (
                                                        <span className="port-description">{port.description}</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {selectedTemplate.has_compose && (
                                    <div className="detail-section">
                                        <h4>
                                            <Container size={16} /> Docker Compose
                                            <button
                                                className="copy-btn"
                                                onClick={() => {
                                                    navigator.clipboard.writeText('docker-compose.yml available after install');
                                                    setCopiedCompose(true);
                                                    setTimeout(() => setCopiedCompose(false), 2000);
                                                }}
                                            >
                                                {copiedCompose ? <Check size={14} /> : <Copy size={14} />}
                                            </button>
                                        </h4>
                                        <div className="compose-preview">
                                            <code>Docker Compose configuration will be generated during installation</code>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setSelectedTemplate(null)}>
                                Close
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => {
                                    setShowInstallModal(true);
                                }}
                            >
                                Install Template
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Install Modal */}
            {showInstallModal && selectedTemplate && (
                <InstallModal
                    template={selectedTemplate}
                    onClose={() => {
                        setShowInstallModal(false);
                        setSelectedTemplate(null);
                    }}
                    onSuccess={(appId) => {
                        setShowInstallModal(false);
                        setSelectedTemplate(null);
                        toast.success('Application installed successfully!');
                        navigate(`/apps/${appId}`);
                    }}
                />
            )}
        </div>
    );
};

const InstallModal = ({ template, onClose, onSuccess }) => {
    const toast = useToast();
    const [appName, setAppName] = useState(template.id.toLowerCase().replace(/[^a-z0-9-]/g, '-'));
    const [variables, setVariables] = useState({});
    const [installing, setInstalling] = useState(false);
    const [errors, setErrors] = useState([]);

    useEffect(() => {
        // Initialize variables with defaults
        const defaults = {};
        (template.variables || []).forEach(v => {
            if (v.default) {
                defaults[v.name] = v.default;
            }
        });
        setVariables(defaults);
    }, [template]);

    async function handleInstall(e) {
        e.preventDefault();
        setInstalling(true);
        setErrors([]);

        try {
            // Validate first
            const validation = await api.validateTemplateInstall(template.id, appName, variables);
            if (!validation.valid) {
                setErrors(validation.errors || ['Validation failed']);
                setInstalling(false);
                return;
            }

            // Install
            const result = await api.installTemplate(template.id, appName, variables);
            if (result.success) {
                onSuccess(result.app_id);
            } else {
                setErrors([result.error || 'Installation failed']);
            }
        } catch (err) {
            setErrors([err.message || 'Installation failed']);
        } finally {
            setInstalling(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Install {template.name}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>
                <form onSubmit={handleInstall}>
                    <div className="modal-body">
                        {errors.length > 0 && (
                            <div className="alert alert-danger">
                                <ul>
                                    {errors.map((error, i) => <li key={i}>{error}</li>)}
                                </ul>
                            </div>
                        )}

                        <div className="form-group">
                            <label>Application Name *</label>
                            <input
                                type="text"
                                value={appName}
                                onChange={(e) => setAppName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                placeholder="my-app"
                                minLength={2}
                                required
                            />
                            <span className="form-help">Lowercase letters, numbers, and hyphens only (min 2 chars)</span>
                        </div>

                        {(template.variables || []).filter(v => !v.hidden).length > 0 && (
                            <>
                                <h4>Configuration</h4>
                                {template.variables.filter(v => !v.hidden).map(variable => (
                                    <div key={variable.name} className="form-group">
                                        <label>
                                            {variable.name}
                                            {variable.required && ' *'}
                                        </label>
                                        {variable.options ? (
                                            <select
                                                value={variables[variable.name] || ''}
                                                onChange={(e) => setVariables({...variables, [variable.name]: e.target.value})}
                                                required={variable.required}
                                            >
                                                <option value="">Select...</option>
                                                {variable.options.map(opt => (
                                                    <option key={opt} value={opt}>{opt}</option>
                                                ))}
                                            </select>
                                        ) : variable.type === 'password' ? (
                                            <input
                                                type="password"
                                                value={variables[variable.name] || ''}
                                                onChange={(e) => setVariables({...variables, [variable.name]: e.target.value})}
                                                placeholder={variable.default ? '(auto-generated)' : ''}
                                                required={variable.required && !variable.default}
                                            />
                                        ) : (
                                            <input
                                                type={variable.type === 'port' ? 'number' : 'text'}
                                                value={variables[variable.name] || ''}
                                                onChange={(e) => setVariables({...variables, [variable.name]: e.target.value})}
                                                placeholder={variable.default || ''}
                                                required={variable.required}
                                            />
                                        )}
                                        {variable.description && (
                                            <span className="form-help">{variable.description}</span>
                                        )}
                                    </div>
                                ))}
                            </>
                        )}
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={installing}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary" disabled={installing}>
                            {installing ? 'Installing...' : 'Install'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Templates;
