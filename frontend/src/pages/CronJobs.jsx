import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const CronJobs = () => {
    const toast = useToast();
    const [status, setStatus] = useState(null);
    const [jobs, setJobs] = useState([]);
    const [presets, setPresets] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Modal states
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [runningJobId, setRunningJobId] = useState(null);

    // Form state
    const [jobForm, setJobForm] = useState({
        name: '',
        command: '',
        schedule: '',
        description: '',
        usePreset: true,
        preset: 'daily'
    });

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [statusRes, jobsRes, presetsRes] = await Promise.all([
                api.getCronStatus(),
                api.getCronJobs(),
                api.getCronPresets()
            ]);

            setStatus(statusRes);
            setJobs(jobsRes.jobs || []);
            setPresets(presetsRes.presets || {});
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateJob = async (e) => {
        e.preventDefault();
        try {
            const schedule = jobForm.usePreset
                ? presets[jobForm.preset]
                : jobForm.schedule;

            await api.createCronJob({
                name: jobForm.name,
                command: jobForm.command,
                schedule: schedule,
                description: jobForm.description
            });

            toast.success('Cron job created successfully');
            setShowCreateModal(false);
            resetForm();
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleDeleteJob = async (jobId) => {
        if (!window.confirm('Are you sure you want to delete this cron job?')) return;
        try {
            await api.deleteCronJob(jobId);
            toast.success('Cron job deleted');
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleToggleJob = async (jobId, currentEnabled) => {
        try {
            await api.toggleCronJob(jobId, !currentEnabled);
            toast.success(`Cron job ${!currentEnabled ? 'enabled' : 'disabled'}`);
            loadData();
        } catch (err) {
            toast.error(err.message);
        }
    };

    const handleRunJob = async (jobId) => {
        try {
            setRunningJobId(jobId);
            const result = await api.runCronJob(jobId);
            if (result.success) {
                toast.success('Job executed successfully');
            } else {
                toast.error(result.error || 'Job execution failed');
            }
        } catch (err) {
            toast.error(err.message);
        } finally {
            setRunningJobId(null);
        }
    };

    const resetForm = () => {
        setJobForm({
            name: '',
            command: '',
            schedule: '',
            description: '',
            usePreset: true,
            preset: 'daily'
        });
    };

    const formatSchedule = (schedule) => {
        const presetEntry = Object.entries(presets).find(([, value]) => value === schedule);
        if (presetEntry) {
            return presetEntry[0].replace(/_/g, ' ');
        }
        return schedule;
    };

    const getScheduleDescription = (schedule) => {
        const descriptions = {
            '* * * * *': 'Every minute',
            '0 * * * *': 'Every hour',
            '0 0 * * *': 'Daily at midnight',
            '0 0 * * 0': 'Weekly on Sunday',
            '0 0 1 * *': 'Monthly on the 1st',
            '0 0 * * 1-5': 'Weekdays at midnight',
            '0 */6 * * *': 'Every 6 hours',
            '0 */12 * * *': 'Every 12 hours',
            '*/5 * * * *': 'Every 5 minutes',
            '*/15 * * * *': 'Every 15 minutes',
            '*/30 * * * *': 'Every 30 minutes'
        };
        return descriptions[schedule] || schedule;
    };

    if (loading) {
        return <div className="page"><div className="loading">Loading cron jobs...</div></div>;
    }

    return (
        <div className="page cron-page">
            <div className="page-header">
                <div>
                    <h1>Cron Jobs</h1>
                    <p className="page-subtitle">Manage scheduled tasks and automated jobs</p>
                </div>
                <div className="page-actions">
                    <button className="btn btn-secondary" onClick={loadData}>
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <polyline points="23 4 23 10 17 10"/>
                            <polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                        </svg>
                        Refresh
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        Create Job
                    </button>
                </div>
            </div>

            {error && (
                <div className="alert alert-danger">
                    {error}
                    <button onClick={() => setError(null)} className="alert-close">&times;</button>
                </div>
            )}

            {/* Status Cards */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon cron">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Cron Service</span>
                        <span className="stat-value">{status?.cron_available ? 'Available' : 'Not Available'}</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon jobs">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                            <polyline points="10 9 9 9 8 9"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Total Jobs</span>
                        <span className="stat-value">{jobs.length}</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon active">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Active Jobs</span>
                        <span className="stat-value">{jobs.filter(j => j.enabled).length}</span>
                    </div>
                </div>

                <div className="stat-card">
                    <div className="stat-icon platform">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                            <line x1="8" y1="21" x2="16" y2="21"/>
                            <line x1="12" y1="17" x2="12" y2="21"/>
                        </svg>
                    </div>
                    <div className="stat-content">
                        <span className="stat-label">Platform</span>
                        <span className="stat-value">{status?.platform || 'Unknown'}</span>
                    </div>
                </div>
            </div>

            {/* Jobs List */}
            <div className="card">
                <div className="card-header">
                    <h3>Scheduled Jobs</h3>
                </div>
                <div className="card-body">
                    {jobs.length === 0 ? (
                        <div className="empty-state">
                            <svg viewBox="0 0 24 24" width="48" height="48">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                            </svg>
                            <h3>No Cron Jobs</h3>
                            <p>No scheduled jobs found. Create your first cron job to automate tasks.</p>
                            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                                Create Job
                            </button>
                        </div>
                    ) : (
                        <div className="cron-list">
                            {jobs.map((job) => (
                                <div key={job.id} className={`cron-item ${!job.enabled ? 'disabled' : ''}`}>
                                    <div className="cron-item-info">
                                        <div className="cron-item-icon">
                                            <svg viewBox="0 0 24 24" width="20" height="20">
                                                <circle cx="12" cy="12" r="10"/>
                                                <polyline points="12 6 12 12 16 14"/>
                                            </svg>
                                        </div>
                                        <div className="cron-item-details">
                                            <h3>{job.name || 'Unnamed Job'}</h3>
                                            <div className="cron-item-meta">
                                                <span className="mono" title={job.schedule}>
                                                    {getScheduleDescription(job.schedule)}
                                                </span>
                                                {job.description && (
                                                    <span className="description">{job.description}</span>
                                                )}
                                            </div>
                                            <div className="cron-item-command">
                                                <code>{job.command}</code>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="cron-item-status">
                                        <span className={`badge badge-${job.enabled ? 'success' : 'secondary'}`}>
                                            {job.enabled ? 'Active' : 'Disabled'}
                                        </span>
                                    </div>

                                    <div className="cron-item-actions">
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => handleRunJob(job.id)}
                                            disabled={runningJobId === job.id}
                                            title="Run now"
                                        >
                                            {runningJobId === job.id ? (
                                                <span className="spinner-inline"></span>
                                            ) : (
                                                <svg viewBox="0 0 24 24" width="14" height="14">
                                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                                </svg>
                                            )}
                                        </button>
                                        <button
                                            className={`btn btn-sm ${job.enabled ? 'btn-warning' : 'btn-success'}`}
                                            onClick={() => handleToggleJob(job.id, job.enabled)}
                                            title={job.enabled ? 'Disable' : 'Enable'}
                                        >
                                            {job.enabled ? (
                                                <svg viewBox="0 0 24 24" width="14" height="14">
                                                    <rect x="6" y="4" width="4" height="16"/>
                                                    <rect x="14" y="4" width="4" height="16"/>
                                                </svg>
                                            ) : (
                                                <svg viewBox="0 0 24 24" width="14" height="14">
                                                    <polygon points="5 3 19 12 5 21 5 3"/>
                                                </svg>
                                            )}
                                        </button>
                                        <button
                                            className="btn btn-sm btn-danger"
                                            onClick={() => handleDeleteJob(job.id)}
                                            title="Delete"
                                        >
                                            <svg viewBox="0 0 24 24" width="14" height="14">
                                                <polyline points="3 6 5 6 21 6"/>
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Create Job Modal */}
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create Cron Job</h2>
                            <button className="modal-close" onClick={() => setShowCreateModal(false)}>&times;</button>
                        </div>
                        <form onSubmit={handleCreateJob}>
                            <div className="modal-body">
                                <div className="form-group">
                                    <label>Job Name</label>
                                    <input
                                        type="text"
                                        value={jobForm.name}
                                        onChange={(e) => setJobForm({...jobForm, name: e.target.value})}
                                        placeholder="My Backup Job"
                                        required
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Command</label>
                                    <input
                                        type="text"
                                        value={jobForm.command}
                                        onChange={(e) => setJobForm({...jobForm, command: e.target.value})}
                                        placeholder="/usr/bin/backup.sh"
                                        required
                                    />
                                    <span className="form-help">The command or script to execute</span>
                                </div>

                                <div className="form-group">
                                    <label className="checkbox-label">
                                        <input
                                            type="checkbox"
                                            checked={jobForm.usePreset}
                                            onChange={(e) => setJobForm({...jobForm, usePreset: e.target.checked})}
                                        />
                                        <span>Use preset schedule</span>
                                    </label>
                                </div>

                                {jobForm.usePreset ? (
                                    <div className="form-group">
                                        <label>Schedule Preset</label>
                                        <select
                                            value={jobForm.preset}
                                            onChange={(e) => setJobForm({...jobForm, preset: e.target.value})}
                                        >
                                            {Object.entries(presets).map(([key, value]) => (
                                                <option key={key} value={key}>
                                                    {key.replace(/_/g, ' ')} ({value})
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ) : (
                                    <div className="form-group">
                                        <label>Cron Schedule</label>
                                        <input
                                            type="text"
                                            value={jobForm.schedule}
                                            onChange={(e) => setJobForm({...jobForm, schedule: e.target.value})}
                                            placeholder="0 0 * * *"
                                            required={!jobForm.usePreset}
                                        />
                                        <span className="form-help">
                                            Format: minute hour day month weekday (e.g., "0 0 * * *" for daily at midnight)
                                        </span>
                                    </div>
                                )}

                                <div className="form-group">
                                    <label>Description (optional)</label>
                                    <textarea
                                        value={jobForm.description}
                                        onChange={(e) => setJobForm({...jobForm, description: e.target.value})}
                                        placeholder="What does this job do?"
                                        rows="2"
                                    />
                                </div>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                                    Cancel
                                </button>
                                <button type="submit" className="btn btn-primary">Create Job</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CronJobs;
