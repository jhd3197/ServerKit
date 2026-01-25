import React, { useState, useEffect } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import wordpressApi from '../services/wordpress';
import { useToast } from '../contexts/ToastContext';
import { WordPressSiteCard, CreateSiteModal } from '../components/wordpress';

const WordPress = () => {
    const toast = useToast();
    const [sites, setSites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [stats, setStats] = useState({
        total: 0,
        running: 0,
        production: 0,
        development: 0
    });

    useEffect(() => {
        loadSites();
    }, []);

    async function loadSites() {
        setLoading(true);
        try {
            const data = await wordpressApi.getSites();
            const siteList = data.sites || [];
            setSites(siteList);

            // Calculate stats
            const running = siteList.filter(s => s.status === 'running').length;
            const production = siteList.filter(s => s.is_production).length;
            const development = siteList.filter(s => !s.is_production).length;

            setStats({
                total: siteList.length,
                running,
                production,
                development
            });
        } catch (err) {
            console.error('Failed to load WordPress sites:', err);
            toast.error('Failed to load WordPress sites');
        } finally {
            setLoading(false);
        }
    }

    async function handleCreateSite(data) {
        const result = await wordpressApi.createSite(data);
        toast.success('WordPress site created successfully');
        loadSites();
        return result;
    }

    async function handleDeleteSite(siteId) {
        try {
            await wordpressApi.deleteSite(siteId);
            toast.success('WordPress site deleted');
            loadSites();
        } catch (err) {
            console.error('Failed to delete site:', err);
            toast.error(err.message || 'Failed to delete site');
        }
    }

    const filteredSites = sites.filter(site => {
        if (!searchTerm) return true;
        const search = searchTerm.toLowerCase();
        return site.name?.toLowerCase().includes(search) ||
               site.url?.toLowerCase().includes(search) ||
               site.domain?.toLowerCase().includes(search);
    });

    // Skeleton Card Component for loading state
    const SiteCardSkeleton = () => (
        <div className="wp-site-card-skeleton">
            <div className="wp-site-card-skeleton-header">
                <div className="wp-site-card-skeleton-icon" />
                <div className="wp-site-card-skeleton-info">
                    <div className="wp-site-card-skeleton-name" />
                    <div className="wp-site-card-skeleton-url" />
                </div>
                <div className="wp-site-card-skeleton-status" />
            </div>
            <div className="wp-site-card-skeleton-body">
                <div className="wp-site-card-skeleton-meta">
                    <div className="wp-site-card-skeleton-label" />
                    <div className="wp-site-card-skeleton-value" />
                </div>
                <div className="wp-site-card-skeleton-meta">
                    <div className="wp-site-card-skeleton-label" />
                    <div className="wp-site-card-skeleton-value" />
                </div>
            </div>
            <div className="wp-site-card-skeleton-footer">
                <div className="wp-site-card-skeleton-btn" />
                <div className="wp-site-card-skeleton-btn" />
                <div className="wp-site-card-skeleton-btn" />
            </div>
        </div>
    );

    const StatCardSkeleton = () => (
        <div className="docker-stat-card-skeleton">
            <div className="docker-stat-card-skeleton-label" />
            <div className="docker-stat-card-skeleton-value" />
            <div className="docker-stat-card-skeleton-meta" />
        </div>
    );

    return (
        <div className="docker-page-new wordpress-page">
            <div className="docker-page-header">
                <div className="docker-page-title">
                    <h2>WordPress Sites</h2>
                    <div className="docker-page-subtitle">
                        Manage your WordPress installations
                    </div>
                </div>
                <div className="docker-page-actions">
                    <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        <Plus size={16} /> New Site
                    </button>
                </div>
            </div>

            <div className="docker-stats-row">
                {loading ? (
                    <>
                        <StatCardSkeleton />
                        <StatCardSkeleton />
                        <StatCardSkeleton />
                        <StatCardSkeleton />
                    </>
                ) : (
                    <>
                        <div className="docker-stat-card">
                            <div className="docker-stat-label">Total Sites</div>
                            <div className="docker-stat-value">{stats.total}</div>
                            <div className="docker-stat-meta">
                                <span className="docker-stat-running">{stats.running} Running</span>
                            </div>
                        </div>
                        <div className="docker-stat-card">
                            <div className="docker-stat-label">Production</div>
                            <div className="docker-stat-value">{stats.production}</div>
                            <div className="docker-stat-meta">Live sites</div>
                        </div>
                        <div className="docker-stat-card">
                            <div className="docker-stat-label">Development</div>
                            <div className="docker-stat-value">{stats.development}</div>
                            <div className="docker-stat-meta">Dev/staging environments</div>
                        </div>
                        <div className="docker-stat-card">
                            <div className="docker-stat-label">Running</div>
                            <div className="docker-stat-value">{stats.running}</div>
                            <div className="docker-stat-meta">Active sites</div>
                        </div>
                    </>
                )}
            </div>

            <div className="docker-panel">
                <div className="docker-panel-header">
                    <div className="docker-panel-tabs">
                        <div className="docker-panel-tab active">All Sites</div>
                    </div>
                    <div className="docker-panel-actions">
                        <button className="btn btn-secondary btn-sm" onClick={loadSites}>
                            <RefreshCw size={14} /> Refresh
                        </button>
                    </div>
                </div>

                <div className="docker-panel-content">
                    <div className="docker-table-header">
                        <div />
                        <input
                            type="text"
                            className="docker-search"
                            placeholder="Search sites..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {loading ? (
                        <div className="wp-sites-grid">
                            <SiteCardSkeleton />
                            <SiteCardSkeleton />
                            <SiteCardSkeleton />
                        </div>
                    ) : filteredSites.length === 0 ? (
                        <div className="docker-empty">
                            <div className="wp-empty-icon">
                                <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <circle cx="12" cy="12" r="10"/>
                                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                                    <path d="M2 12h20"/>
                                </svg>
                            </div>
                            <h3>No WordPress sites</h3>
                            <p>Create your first WordPress site to get started.</p>
                            <button
                                className="btn btn-primary"
                                onClick={() => setShowCreateModal(true)}
                            >
                                <Plus size={16} /> Create Site
                            </button>
                        </div>
                    ) : (
                        <div className="wp-sites-grid">
                            {filteredSites.map(site => (
                                <WordPressSiteCard
                                    key={site.id}
                                    site={site}
                                    onDelete={handleDeleteSite}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {showCreateModal && (
                <CreateSiteModal
                    onClose={() => setShowCreateModal(false)}
                    onCreate={handleCreateSite}
                />
            )}
        </div>
    );
};

export default WordPress;
