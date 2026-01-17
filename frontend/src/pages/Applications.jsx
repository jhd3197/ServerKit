import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const Applications = () => {
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        loadApps();
    }, []);

    async function loadApps() {
        try {
            const data = await api.getApps();
            setApps(data.apps || []);
        } catch (err) {
            console.error('Failed to load apps:', err);
        } finally {
            setLoading(false);
        }
    }

    function getStackColor(type) {
        const colors = {
            'php': '#a78bfa',
            'wordpress': '#21759b',
            'flask': '#fcd34d',
            'django': '#34d399',
            'docker': '#2496ed',
            'static': '#60a5fa',
        };
        return colors[type] || '#a1a1aa';
    }

    function getStatusClass(status) {
        switch (status) {
            case 'running': return 'status-active';
            case 'stopped': return 'status-stopped';
            case 'error': return 'status-error';
            default: return 'status-warning';
        }
    }

    async function handleAction(appId, action) {
        try {
            if (action === 'start') {
                await api.startApp(appId);
            } else if (action === 'stop') {
                await api.stopApp(appId);
            } else if (action === 'restart') {
                await api.restartApp(appId);
            }
            loadApps();
        } catch (err) {
            console.error(`Failed to ${action} app:`, err);
        }
    }

    if (loading) {
        return <div className="loading">Loading applications...</div>;
    }

    return (
        <div>
            <header className="top-bar">
                <div>
                    <h1>Applications</h1>
                    <div className="subtitle">Manage your web applications</div>
                </div>
                <div className="top-bar-actions">
                    <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" fill="none" strokeWidth="2">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        New Application
                    </button>
                </div>
            </header>

            {apps.length === 0 ? (
                <div className="empty-state">
                    <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" strokeWidth="1.5">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                    </svg>
                    <h3>No applications yet</h3>
                    <p>Create your first application to get started.</p>
                    <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        Create Application
                    </button>
                </div>
            ) : (
                <div className="apps-list">
                    {apps.map(app => (
                        <div key={app.id} className="app-row">
                            <div className="app-info">
                                <div className="app-icon" style={{ background: getStackColor(app.app_type) }}>
                                    {app.app_type === 'wordpress' ? 'W' : app.app_type.charAt(0).toUpperCase()}
                                </div>
                                <div className="app-details">
                                    <h3>{app.name}</h3>
                                    <div className="app-meta">
                                        <span className="app-type">{app.app_type.toUpperCase()}</span>
                                        {app.php_version && <span>PHP {app.php_version}</span>}
                                        {app.python_version && <span>Python {app.python_version}</span>}
                                        {app.domains && app.domains[0] && (
                                            <a href={`https://${app.domains[0].name}`} target="_blank" rel="noopener noreferrer">
                                                {app.domains[0].name}
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="app-status">
                                <span className={`status-badge ${getStatusClass(app.status)}`}>
                                    <span className="status-dot"/>
                                    {app.status}
                                </span>
                            </div>
                            <div className="app-actions">
                                {app.status === 'running' ? (
                                    <>
                                        <button className="btn btn-secondary btn-sm" onClick={() => handleAction(app.id, 'restart')}>
                                            Restart
                                        </button>
                                        <button className="btn btn-secondary btn-sm" onClick={() => handleAction(app.id, 'stop')}>
                                            Stop
                                        </button>
                                    </>
                                ) : (
                                    <button className="btn btn-primary btn-sm" onClick={() => handleAction(app.id, 'start')}>
                                        Start
                                    </button>
                                )}
                                <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/apps/${app.id}`)}>
                                    Manage
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {showCreateModal && (
                <CreateAppModal onClose={() => setShowCreateModal(false)} onCreated={loadApps} />
            )}
        </div>
    );
};

const CreateAppModal = ({ onClose, onCreated }) => {
    const [step, setStep] = useState(1);
    const [appType, setAppType] = useState('');
    const [formData, setFormData] = useState({
        name: '',
        app_type: '',
        php_version: '8.2',
        python_version: '3.11',
        port: 8000,
        root_path: '/var/www/',
        // WordPress specific
        site_url: '',
        site_title: '',
        admin_user: 'admin',
        admin_email: '',
        db_name: '',
        db_user: '',
        db_password: '',
        // Docker specific
        docker_image: '',
        docker_ports: '',
        docker_volumes: '',
        docker_env: '',
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const appTypes = [
        { id: 'wordpress', name: 'WordPress', icon: 'W', color: '#21759b', description: 'Full WordPress installation with WP-CLI' },
        { id: 'php', name: 'PHP', icon: 'P', color: '#777bb4', description: 'PHP application with FPM' },
        { id: 'flask', name: 'Flask', icon: 'F', color: '#fcd34d', description: 'Python Flask application' },
        { id: 'django', name: 'Django', icon: 'D', color: '#34d399', description: 'Python Django application' },
        { id: 'docker', name: 'Docker', icon: 'D', color: '#2496ed', description: 'Docker container application' },
        { id: 'static', name: 'Static', icon: 'S', color: '#60a5fa', description: 'Static HTML/CSS/JS site' },
    ];

    function handleChange(e) {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    }

    function selectAppType(type) {
        setAppType(type);
        setFormData({ ...formData, app_type: type, root_path: `/var/www/${formData.name || 'mysite'}` });
        setStep(2);
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (appType === 'wordpress') {
                // Install WordPress
                await api.installWordPress({
                    path: formData.root_path,
                    site_url: formData.site_url,
                    site_title: formData.site_title || formData.name,
                    admin_user: formData.admin_user,
                    admin_email: formData.admin_email,
                    db_name: formData.db_name,
                    db_user: formData.db_user,
                    db_password: formData.db_password,
                    php_version: formData.php_version,
                });
            } else if (appType === 'flask') {
                // Create Flask app
                await api.createFlaskApp({
                    name: formData.name,
                    path: formData.root_path,
                    python_version: formData.python_version,
                    port: formData.port,
                    workers: formData.workers || 2,
                });
            } else if (appType === 'django') {
                // Create Django app
                await api.createDjangoApp({
                    name: formData.name,
                    path: formData.root_path,
                    python_version: formData.python_version,
                    port: formData.port,
                    workers: formData.workers || 2,
                });
            } else if (appType === 'docker') {
                // Create Docker app
                const ports = formData.docker_ports ? formData.docker_ports.split(',').map(p => p.trim()) : [];
                const volumes = formData.docker_volumes ? formData.docker_volumes.split(',').map(v => v.trim()) : [];
                const env = formData.docker_env ? Object.fromEntries(
                    formData.docker_env.split('\n').filter(l => l.includes('=')).map(l => {
                        const [key, ...rest] = l.split('=');
                        return [key.trim(), rest.join('=').trim()];
                    })
                ) : {};

                await api.createDockerApp({
                    name: formData.name,
                    path: formData.root_path,
                    image: formData.docker_image,
                    ports,
                    volumes,
                    env,
                });
            } else {
                // Create regular app (PHP, static)
                await api.createApp({
                    name: formData.name,
                    app_type: appType,
                    php_version: appType === 'php' ? formData.php_version : null,
                    root_path: formData.root_path,
                });
            }

            onCreated();
            onClose();
        } catch (err) {
            setError(err.message || 'Failed to create application');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>{step === 1 ? 'Select Application Type' : `Create ${appTypes.find(t => t.id === appType)?.name} App`}</h2>
                    <button className="modal-close" onClick={onClose}>&times;</button>
                </div>

                {error && <div className="error-message">{error}</div>}

                {step === 1 ? (
                    <div className="app-type-grid">
                        {appTypes.map(type => (
                            <button
                                key={type.id}
                                className="app-type-card"
                                onClick={() => selectAppType(type.id)}
                            >
                                <div className="app-type-icon" style={{ background: type.color }}>
                                    {type.icon}
                                </div>
                                <h3>{type.name}</h3>
                                <p>{type.description}</p>
                            </button>
                        ))}
                    </div>
                ) : (
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label>Site Name</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                placeholder="My Awesome Site"
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label>Root Path</label>
                            <input
                                type="text"
                                name="root_path"
                                value={formData.root_path}
                                onChange={handleChange}
                                placeholder="/var/www/mysite"
                                required
                            />
                        </div>

                        {appType === 'wordpress' && (
                            <>
                                <div className="form-group">
                                    <label>Site URL</label>
                                    <input
                                        type="url"
                                        name="site_url"
                                        value={formData.site_url}
                                        onChange={handleChange}
                                        placeholder="https://example.com"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Admin Email</label>
                                    <input
                                        type="email"
                                        name="admin_email"
                                        value={formData.admin_email}
                                        onChange={handleChange}
                                        placeholder="admin@example.com"
                                        required
                                    />
                                </div>

                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Database Name</label>
                                        <input
                                            type="text"
                                            name="db_name"
                                            value={formData.db_name}
                                            onChange={handleChange}
                                            required
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Database User</label>
                                        <input
                                            type="text"
                                            name="db_user"
                                            value={formData.db_user}
                                            onChange={handleChange}
                                            required
                                        />
                                    </div>
                                </div>

                                <div className="form-group">
                                    <label>Database Password</label>
                                    <input
                                        type="password"
                                        name="db_password"
                                        value={formData.db_password}
                                        onChange={handleChange}
                                        required
                                    />
                                </div>
                            </>
                        )}

                        {(appType === 'php' || appType === 'wordpress') && (
                            <div className="form-group">
                                <label>PHP Version</label>
                                <select name="php_version" value={formData.php_version} onChange={handleChange}>
                                    <option value="8.0">PHP 8.0</option>
                                    <option value="8.1">PHP 8.1</option>
                                    <option value="8.2">PHP 8.2</option>
                                    <option value="8.3">PHP 8.3</option>
                                </select>
                            </div>
                        )}

                        {['flask', 'django'].includes(appType) && (
                            <>
                                <div className="form-group">
                                    <label>Python Version</label>
                                    <select name="python_version" value={formData.python_version} onChange={handleChange}>
                                        <option value="3.9">Python 3.9</option>
                                        <option value="3.10">Python 3.10</option>
                                        <option value="3.11">Python 3.11</option>
                                        <option value="3.12">Python 3.12</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Port</label>
                                    <input
                                        type="number"
                                        name="port"
                                        value={formData.port}
                                        onChange={handleChange}
                                        min="1024"
                                        max="65535"
                                    />
                                </div>
                            </>
                        )}

                        {appType === 'docker' && (
                            <>
                                <div className="form-group">
                                    <label>Docker Image *</label>
                                    <input
                                        type="text"
                                        name="docker_image"
                                        value={formData.docker_image}
                                        onChange={handleChange}
                                        placeholder="nginx:latest, mysql:8, redis:alpine"
                                        required
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Ports (comma-separated)</label>
                                    <input
                                        type="text"
                                        name="docker_ports"
                                        value={formData.docker_ports}
                                        onChange={handleChange}
                                        placeholder="8080:80, 3306:3306"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Volumes (comma-separated)</label>
                                    <input
                                        type="text"
                                        name="docker_volumes"
                                        value={formData.docker_volumes}
                                        onChange={handleChange}
                                        placeholder="/host/data:/container/data"
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Environment Variables (one per line, KEY=value)</label>
                                    <textarea
                                        name="docker_env"
                                        value={formData.docker_env}
                                        onChange={handleChange}
                                        placeholder="MYSQL_ROOT_PASSWORD=secret&#10;MYSQL_DATABASE=mydb"
                                        rows={4}
                                    />
                                </div>
                            </>
                        )}

                        <div className="modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>
                                Back
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={loading}>
                                {loading ? 'Creating...' : 'Create Application'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default Applications;
