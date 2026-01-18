import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const Templates = () => {
    const navigate = useNavigate();
    const toast = useToast();
    const [templates, setTemplates] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCategory, setSelectedCategory] = useState(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedTemplate, setSelectedTemplate] = useState(null);
    const [showInstallModal, setShowInstallModal] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        loadTemplates();
    }, [selectedCategory, searchQuery]);

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
            publishing: '📰'
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
                    <input
                        type="text"
                        placeholder="Search templates..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                <div className="category-filters">
                    <button
                        className={`category-btn ${!selectedCategory ? 'active' : ''}`}
                        onClick={() => setSelectedCategory(null)}
                    >
                        All
                    </button>
                    {categories.map(category => (
                        <button
                            key={category}
                            className={`category-btn ${selectedCategory === category ? 'active' : ''}`}
                            onClick={() => setSelectedCategory(category)}
                        >
                            {getCategoryIcon(category)} {category}
                        </button>
                    ))}
                </div>
            </div>

            {/* Templates Grid */}
            <div className="templates-grid">
                {templates.length === 0 ? (
                    <div className="empty-state">
                        <p>No templates found</p>
                    </div>
                ) : (
                    templates.map(template => (
                        <div key={template.id} className="template-card" onClick={() => handleViewTemplate(template)}>
                            <div className="template-icon">
                                {template.icon ? (
                                    <img src={template.icon} alt={template.name} />
                                ) : (
                                    <span className="template-icon-placeholder">
                                        {template.name?.charAt(0).toUpperCase()}
                                    </span>
                                )}
                            </div>
                            <div className="template-info">
                                <h3>{template.name}</h3>
                                <p className="template-description">{template.description}</p>
                                <div className="template-meta">
                                    <span className="template-version">v{template.version}</span>
                                    <div className="template-categories">
                                        {(template.categories || []).slice(0, 2).map(cat => (
                                            <span key={cat} className="category-badge">
                                                {getCategoryIcon(cat)} {cat}
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
                                    {selectedTemplate.icon ? (
                                        <img src={selectedTemplate.icon} alt={selectedTemplate.name} />
                                    ) : (
                                        <span className="template-icon-placeholder">
                                            {selectedTemplate.name?.charAt(0).toUpperCase()}
                                        </span>
                                    )}
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
                                        Website
                                    </a>
                                )}
                                {selectedTemplate.documentation && (
                                    <a href={selectedTemplate.documentation} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
                                        Documentation
                                    </a>
                                )}
                            </div>

                            <div className="template-details-grid">
                                <div className="detail-section">
                                    <h4>Categories</h4>
                                    <div className="template-categories">
                                        {(selectedTemplate.categories || []).map(cat => (
                                            <span key={cat} className="category-badge">
                                                {getCategoryIcon(cat)} {cat}
                                            </span>
                                        ))}
                                    </div>
                                </div>

                                {selectedTemplate.variables && selectedTemplate.variables.length > 0 && (
                                    <div className="detail-section">
                                        <h4>Configuration Variables</h4>
                                        <div className="variables-list">
                                            {selectedTemplate.variables.map(variable => (
                                                <div key={variable.name} className="variable-item">
                                                    <span className="variable-name">{variable.name}</span>
                                                    <span className="variable-description">{variable.description}</span>
                                                    {variable.default && (
                                                        <span className="variable-default">Default: {variable.default}</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {selectedTemplate.ports && selectedTemplate.ports.length > 0 && (
                                    <div className="detail-section">
                                        <h4>Exposed Ports</h4>
                                        <div className="ports-list">
                                            {selectedTemplate.ports.map((port, index) => (
                                                <div key={index} className="port-item">
                                                    <span className="port-number">{port.port}</span>
                                                    <span className="port-protocol">{port.protocol}</span>
                                                    <span className="port-description">{port.description}</span>
                                                </div>
                                            ))}
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
                                onChange={(e) => setAppName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                                placeholder="my-app"
                                pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
                                minLength={3}
                                required
                            />
                            <span className="form-help">Lowercase letters, numbers, and hyphens only</span>
                        </div>

                        {(template.variables || []).length > 0 && (
                            <>
                                <h4>Configuration</h4>
                                {template.variables.map(variable => (
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
