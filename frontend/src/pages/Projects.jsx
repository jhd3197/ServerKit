import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderKanban, Plus } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/useToast.js';
import ResourceListPage from '../components/layouts/ResourceListPage';
import { useTopbarActions } from '@/hooks/useTopbarActions';
import useFocusParam from '@/hooks/useFocusParam';
import { SearchField, ServiceTile } from '@/components/ds';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import Modal from '@/components/Modal';
import { useTranslation } from 'react-i18next';

// Preset views. A project list is short, so these are about SHAPE rather than
// status: which projects are actually carrying anything, and which are empty
// shells someone made and forgot.
const PROJECT_VIEWS = [
    {
        name: 'All projects',
        state: { search: '', sorts: [], hiddenKeys: [], columnFilters: null },
    },
    {
        name: 'Has services',
        state: {
            search: '',
            sorts: [{ key: 'apps', direction: 'desc' }],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'pv1', field: 'apps', op: 'gt', value: 0 }],
            },
        },
    },
    {
        name: 'Empty',
        state: {
            search: '',
            sorts: [],
            hiddenKeys: [],
            columnFilters: {
                match: 'all',
                rules: [{ id: 'pv2', field: 'apps', op: 'eq', value: 0 }],
            },
        },
    },
];

const Projects = () => {
    const { t } = useTranslation();
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [showCreate, setShowCreate] = useState(false);
    const [search, setSearch] = useState('');
    // Quick-create deep link: /projects?focus=create:project opens the dialog.
    useFocusParam('create', () => setShowCreate(true));
    const navigate = useNavigate();

    const loadProjects = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getProjects();
            setProjects(Array.isArray(data?.projects) ? data.projects : []);
            setLoadError(null);
        } catch (err) {
            setLoadError(err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadProjects();
    }, [loadProjects]);

    useTopbarActions(() => (
        <>
            <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus size={16} /> {t('app.projects.newProject', 'New project')}
            </Button>
            <SearchField value={search} onSearch={setSearch} placeholder={t('app.projects.searchProjects', 'Search projects…')} />
        </>
    ), [search]);

    const rows = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return projects;
        return projects.filter((p) => (
            p.name?.toLowerCase().includes(q)
            || p.slug?.toLowerCase().includes(q)
            || p.description?.toLowerCase().includes(q)
        ));
    }, [projects, search]);

    const columns = useMemo(() => [
        {
            key: 'name',
            headerKey: 'common.labels.project', header: 'Project',
            sortable: true,
            hideable: false,
            value: (p) => p.name,
            render: (p) => (
                <div className="sk-cell-name">
                    <ServiceTile name={p.name} size={30} className="wp-list__tile" aria-hidden="true" />
                    <span>
                        <div>{p.name}</div>
                        <div className="sk-cell-sub">{p.slug}</div>
                    </span>
                </div>
            ),
        },
        {
            key: 'description',
            headerKey: 'common.labels.description', header: 'Description',
            sortable: true,
            value: (p) => p.description || '',
            render: (p) => p.description || <span className="wp-list__dash">—</span>,
        },
        // `value` feeds sorting and the filter rules; `render` is what the cell
        // shows. DataTable falls back to row[key] when there is no render, and
        // these are derived counts with no matching key on the row — so both.
        {
            key: 'environments',
            headerKey: 'app.projects.environments', header: 'Environments',
            type: 'number',
            sortable: true,
            width: 140,
            cellClassName: 'sk-cell-dim',
            value: (p) => p.environment_count ?? 0,
            render: (p) => p.environment_count ?? 0,
        },
        {
            key: 'apps',
            headerKey: 'common.labels.services', header: 'Services',
            type: 'number',
            sortable: true,
            width: 120,
            cellClassName: 'sk-cell-dim',
            value: (p) => p.app_count ?? 0,
            render: (p) => p.app_count ?? 0,
        },
    ], []);

    return (
        <ResourceListPage
            className="projects-page"
            loading={loading}
            loadingTitle="Loading projects…"
            storageKey="serverkit-list-projects"
            viewPageKey="projects"
            noun="projects"
            builtinViews={PROJECT_VIEWS}
            totalCount={projects.length}
            error={loadError}
            errorTitle={t('app.projects.couldntLoadProjects', "Couldn't load projects")}
            onRetry={loadProjects}
            items={rows}
            columns={columns}
            keyField="id"
            onRowClick={(p) => navigate(`/projects/${p.id}`)}
            emptyIcon={FolderKanban}
            emptyTitle="No projects yet"
            emptyDescription="Group your applications into projects and environments (production, staging, development) to keep things organized."
            emptyAction={(
                <Button onClick={() => setShowCreate(true)}>
                    <Plus size={16} /> {t('app.projects.createYourFirstProject', 'Create your first project')}
                </Button>
            )}
            filteredEmptyIcon={FolderKanban}
            filteredEmptyTitle="No projects found"
            filteredEmptyDescription="Try adjusting your search or filters."
        >
            <CreateProjectDialog
                open={showCreate}
                onOpenChange={setShowCreate}
                onCreated={() => {
                    setShowCreate(false);
                    loadProjects();
                }}
            />
        </ResourceListPage>
    );
};

const CreateProjectDialog = ({ open, onOpenChange, onCreated }) => {
    const { t } = useTranslation();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const toast = useToast();

    function reset() {
        setName('');
        setDescription('');
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!name.trim()) {
            toast.error(t('app.projects.projectNameIsRequired', 'Project name is required'));
            return;
        }
        setSubmitting(true);
        try {
            await api.createProject({
                name: name.trim(),
                description: description.trim() || undefined,
            });
            toast.success(t('app.projects.projectCreated', 'Project created'));
            reset();
            onCreated();
        } catch (err) {
            toast.error(err.message || t('app.projects.failedToCreateProject', 'Failed to create project'));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <Modal open={open} onClose={() => { reset(); onOpenChange(false); }} title={t('app.projects.newProject', 'New project')}>
            <form onSubmit={handleSubmit}>
                <p className="sk-modal__subtitle">
                    {t('app.projects.aProjectGroupsYourApplicationsIt', 'A project groups your services. It starts with a default "production" environment you can rename or expand.')}
                </p>

                <div className="projects-form">
                        <div className="projects-form__field">
                            <Label htmlFor="project-name">{t('common.labels.name', 'Name')}</Label>
                            <Input
                                id="project-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={t('app.projects.myProject', 'My project')}
                                autoFocus
                                required
                            />
                        </div>
                        <div className="projects-form__field">
                            <Label htmlFor="project-description">{t('app.projects.descriptionOptional', 'Description (optional)')}</Label>
                            <Textarea
                                id="project-description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={t('app.projects.whatThisProjectIsFor', 'What this project is for…')}
                                rows={3}
                            />
                        </div>
                    </div>

                    <div className="modal-actions">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            {t('common.actions.cancel', 'Cancel')}
                        </Button>
                        <Button type="submit" disabled={submitting || !name.trim()}>
                            {submitting ? 'Creating…' : 'Create Project'}
                        </Button>
                    </div>
                </form>
        </Modal>
    );
};

export default Projects;
