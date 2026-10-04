import { Card as SharedCard } from '@/components/ui/card';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
    Box, ChefHat, Play, Lock, Zap, Database, Globe, Shield, Search,
    AlertTriangle, Check, X, Loader2,
} from 'lucide-react';

import { Drawer } from '../components/ds';
import EmptyState from '../components/EmptyState';
import FormField from '../components/FormField';
import { runRecipe, useRecipeCatalog } from '../hooks/useRecipeCatalog';
import { useToast } from '../contexts/useToast.js';
import { formatBytes } from '../utils/formatBytes';
import { Button as SharedButton } from '@/components/ui/button';

// Recipe catalog (serverkit-recipes registry). A Recipe is a ready-to-go
// installer: pick one, point it at a server, fill in the non-secret inputs,
// run it. Secret inputs pause the run mid-way and arrive as handoffs in
// Operations. This page only browses and starts — progress lives in the
// deployment console like every other long operation.

const ICONS = {
    box: Box,
    play: Play,
    lock: Lock,
    zap: Zap,
    database: Database,
    globe: Globe,
    shield: Shield,
};

function RecipeIcon({ icon }) {
    const Icon = ICONS[icon] || ChefHat;
    return <Icon size={17} />;
}

const GB = 1024 * 1024 * 1024;

function preflight(requirements, server) {
    if (!server || !requirements) return [];
    const rows = [];
    if (requirements.cpuCores) {
        rows.push({
            key: 'cpu',
            need: `${requirements.cpuCores} vCPU`,
            have: server.cpu_cores ? `${server.cpu_cores} vCPU` : '—',
            ok: !!server.cpu_cores && server.cpu_cores >= requirements.cpuCores,
        });
    }
    if (requirements.memoryMB) {
        rows.push({
            key: 'mem',
            need: formatBytes(requirements.memoryMB * GB, { decimals: 0 }),
            have: formatBytes(server.total_memory, { decimals: 0 }),
            ok: !!server.total_memory && server.total_memory >= requirements.memoryMB * GB,
        });
    }
    if (requirements.diskGB) {
        rows.push({
            key: 'disk',
            need: formatBytes(requirements.diskGB * GB, { decimals: 0 }),
            have: formatBytes(server.total_disk, { decimals: 0 }),
            ok: !!server.total_disk && server.total_disk >= requirements.diskGB * GB,
        });
    }
    return rows;
}

const blockersOf = rows => rows.filter(r => !r.ok);

export default function Recipes() {
    const { t } = useTranslation();
    const toast = useToast();
    const navigate = useNavigate();
    const { recipes, source, isLoading, servers, startRun } = useRecipeCatalog();

    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('all');

    // Install drawer state.
    const [selected, setSelected] = useState(null);
    const [targetId, setTargetId] = useState(null);
    const [paramValues, setParamValues] = useState({});
    const [starting, setStarting] = useState(false);

    // Reset the drawer target once the server list arrives so the pre-selected
    // server is always one that exists in the current workspace scope.
    useEffect(() => {
        if (!selected || targetId != null) return;
        const running = servers.find(s => s.status === 'running');
        setTargetId(running?.id ?? servers[0]?.id ?? null);
    }, [selected, servers, targetId]);

    const categories = useMemo(() => (
        ['all', ...new Set(recipes.map(r => r.category).filter(Boolean))]
    ), [recipes]);

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return recipes.filter(r => (
            (category === 'all' || r.category === category)
            && (!q || `${r.name} ${r.description}`.toLowerCase().includes(q))
        ));
    }, [recipes, search, category]);

    const targetServer = useMemo(
        () => servers.find(s => String(s.id) === String(targetId)) || null,
        [servers, targetId],
    );

    const openInstall = useCallback((recipe) => {
        setSelected(recipe);
        setTargetId(targetServer?.id ?? servers.find(s => s.status === 'running')?.id ?? null);
        setParamValues(Object.fromEntries(
            (recipe.inputs || []).map(i => [i.key, i.placeholder || '']),
        ));
    }, [servers, targetServer]);

    const selectedRows = useMemo(
        () => preflight(selected?.requirements, targetServer),
        [selected, targetServer],
    );
    const selectedBlockers = blockersOf(selectedRows);

    const handleStart = async () => {
        if (!selected || !targetServer) return;
        setStarting(true);
        const jobId = await runRecipe(
            { startRun, toast, t },
            {
                registry_slug: selected.slug,
                server_id: targetServer.id,
                params: paramValues,
            },
            { serverName: targetServer.name },
        );
        setStarting(false);
        if (!jobId) return;
        setSelected(null);
        navigate(`/deployments/${jobId}`);
    };

    return (
        <div className="recipes-page">
            <div className="recipes-page__head">
                <p className="recipes-page__lede">
                    {t('app.recipes.lede', 'Ready-to-go installers that run as real operations: probe, derive, apply, verify. Secrets are asked for mid-run and kept in the vault.')}
                </p>
                <label className="recipes-page__search">
                    <Search size={14} />
                    <input
                        type="search"
                        value={search}
                        placeholder={t('app.recipes.searchPlaceholder', 'Search recipes…')}
                        onChange={e => setSearch(e.target.value)}
                    />
                </label>
            </div>

            {categories.length > 1 && (
                <div className="recipes-page__cats">
                    {categories.map(cat => (
                        <SharedButton variant="unstyled"
                            key={cat}
                            type="button"
                            className={`sk-pill${category === cat ? ' is-active' : ''}`}
                            onClick={() => setCategory(cat)}
                        >
                            {cat === 'all' ? t('common.labels.all', 'All') : cat}
                        </SharedButton>
                    ))}
                </div>
            )}

            {isLoading ? (
                <div className="recipes-page__loading"><Loader2 size={18} className="spin" /></div>
            ) : !recipes.length ? (
                <EmptyState
                    icon={AlertTriangle}
                    title={t('app.recipes.unavailable', 'Recipe catalog unavailable')}
                    description={t('app.recipes.unavailableHint', 'The registry could not be reached and no bundled copy is present.')}
                />
            ) : !visible.length ? (
                <EmptyState
                    icon={ChefHat}
                    title={t('app.recipes.noneMatch', 'No recipes match')}
                    description={t('app.recipes.noneMatchHint', 'Try a different search or category.')}
                />
            ) : (
                <div className="recipes-page__grid">
                    {visible.map(recipe => {
                        const handoffCount = (recipe.handoffs || []).length;
                        return (
                            <div className="recipe-card" key={recipe.slug}>
                                <div className="recipe-card__top">
                                    <span className="recipe-card__ico"><RecipeIcon icon={recipe.icon} /></span>
                                    <div className="recipe-card__id">
                                        <div className="recipe-card__name">{recipe.name}</div>
                                        <div className="recipe-card__meta">
                                            v{recipe.version}{recipe.category ? ` · ${recipe.category}` : ''}
                                            {recipe.minutes ? ` · ~${recipe.minutes} min` : ''}
                                        </div>
                                    </div>
                                    {recipe.featured && (
                                        <span className="sk-pill recipe-card__featured">
                                            {t('app.recipes.featured', 'Featured')}
                                        </span>
                                    )}
                                </div>
                                <p className="recipe-card__desc">{recipe.description}</p>
                                <div className="recipe-card__reqs">
                                    {(recipe.requirements?.cpuCores)
                                        && <span>{recipe.requirements.cpuCores} vCPU</span>}
                                    {(recipe.requirements?.memoryMB)
                                        && <span>{formatBytes(recipe.requirements.memoryMB * GB, { decimals: 0 })}</span>}
                                    {(recipe.requirements?.diskGB)
                                        && <span>{formatBytes(recipe.requirements.diskGB * GB, { decimals: 0 })}</span>}
                                    {(recipe.requirements?.igpu && recipe.requirements.igpu !== 'none')
                                        && <span className={recipe.requirements.igpu === 'required' ? 'is-hard' : ''}>
                                            iGPU {recipe.requirements.igpu}
                                        </span>}
                                    {(recipe.requirements?.gpu && recipe.requirements.gpu !== 'none')
                                        && <span className={recipe.requirements.gpu === 'required' ? 'is-hard' : ''}>
                                            GPU {recipe.requirements.gpu}
                                        </span>}
                                </div>
                                <div className="recipe-card__foot">
                                    <span className="recipe-card__steps">
                                        {t('app.recipes.stepsLine', '{{steps}} steps · {{handoffs}} secret ask{{plural}}', {
                                            steps: recipe.steps ?? '?',
                                            handoffs: handoffCount || 0,
                                            plural: handoffCount === 1 ? '' : 's',
                                        })}
                                    </span>
                                    <SharedButton variant="primary"
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={() => openInstall(recipe)}
                                    >
                                        <Play size={13} />
                                        {t('app.recipes.install', 'Install')}
                                    </SharedButton>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <Drawer
                open={!!selected}
                onOpenChange={open => { if (!open) setSelected(null); }}
                title={selected ? t('app.recipes.runTitle', 'Run {{name}}', { name: selected.name }) : ''}
                subtitle={selected ? `recipe ${selected.slug}@${selected.version}` : ''}
                icon={selected ? <RecipeIcon icon={selected.icon} /> : null}
                width={520}
            >
                {selected && (
                    <div className="recipe-install">
                        <FormField label={t('app.recipes.runOn', 'Run on')}>
                            <SharedCard variant="legacy" className="recipe-install__servers card">
                                {servers.filter(s => s.status === 'running').map(server => (
                                    <SharedButton variant="unstyled"
                                        type="button"
                                        key={server.id}
                                        className={`recipe-install__server${String(targetId) === String(server.id) ? ' is-on' : ''}`}
                                        onClick={() => setTargetId(server.id)}
                                    >
                                        <span className="recipe-install__radio" aria-hidden="true" />
                                        <span className="recipe-install__srvname">{server.name}</span>
                                        <span className="recipe-install__srvspec">
                                            {server.cpu_cores ? `${server.cpu_cores} vCPU · ` : ''}
                                            {formatBytes(server.total_memory, { decimals: 0 })}
                                        </span>
                                        {String(targetId) === String(server.id) && <Check size={15} />}
                                    </SharedButton>
                                ))}
                                {!servers.some(s => s.status === 'running') && (
                                    <p className="recipe-install__nosrv">
                                        {t('app.recipes.noServers', 'No running servers. Start one first.')}
                                    </p>
                                )}
                            </SharedCard>
                        </FormField>

                        {!!selectedRows.length && (
                            <FormField label={t('app.recipes.preflight', 'Preflight')}>
                                <SharedCard variant="legacy" className="recipe-install__preflight card">
                                    {selectedRows.map(row => {
                                        const label = row.key === 'cpu'
                                            ? t('app.recipes.cpu', 'CPU')
                                            : row.key === 'mem'
                                                ? t('app.recipes.memory', 'Memory')
                                                : t('app.recipes.disk', 'Disk');
                                        return (
                                            <div key={row.key} className={`recipe-preflight${row.ok ? ' is-ok' : ' is-bad'}`}>
                                                {row.ok ? <Check size={13} /> : <X size={13} />}
                                                <span className="recipe-preflight__k">{label}</span>
                                                <span className="recipe-preflight__need">{row.need}</span>
                                                <span className="recipe-preflight__have">{row.have}</span>
                                            </div>
                                        );
                                    })}
                                </SharedCard>
                                {!!selectedBlockers.length && (
                                    <p className="recipe-install__blocked">
                                        {t('app.recipes.blocked', 'This server does not meet the requirements above. Pick another server.')}
                                    </p>
                                )}
                            </FormField>
                        )}

                        {!!(selected.inputs || []).length && selected.inputs.map(input => (
                            <FormField
                                key={input.key}
                                label={input.label}
                                htmlFor={`ri-${input.key}`}
                                hint={input.help}
                            >
                                <input
                                    id={`ri-${input.key}`}
                                    className="form-input"
                                    value={paramValues[input.key] ?? ''}
                                    placeholder={input.placeholder}
                                    onChange={e => setParamValues(v => ({ ...v, [input.key]: e.target.value }))}
                                />
                            </FormField>
                        ))}

                        <FormField label={t('app.recipes.askedDuringRun', 'Asked for during the run')}>
                            {(selected.handoffs || []).length ? (
                                <SharedCard variant="legacy" className="recipe-install__handoffs card">
                                    {selected.handoffs.map(handoff => (
                                        <div className="recipe-handoff-row" key={handoff.key}>
                                            <Lock size={13} />
                                            <span className="recipe-handoff-row__k">{handoff.label}</span>
                                            {handoff.url && (
                                                <a href={handoff.url} target="_blank" rel="noreferrer" className="recipe-handoff-row__url">
                                                    {handoff.url.replace(/^https?:\/\//, '')}
                                                </a>
                                            )}
                                        </div>
                                    ))}
                                </SharedCard>
                            ) : (
                                <p className="recipe-install__unattended">
                                    {t('app.recipes.noHandoffs', 'Nothing. This recipe runs unattended.')}
                                </p>
                            )}
                        </FormField>

                        <div className="recipe-install__actions">
                            <SharedButton variant="unstyled" type="button" className="btn" onClick={() => setSelected(null)}>
                                {t('common.actions.cancel', 'Cancel')}
                            </SharedButton>
                            <SharedButton variant="primary"
                                type="button"
                                className="btn btn-primary"
                                disabled={!targetServer || !!selectedBlockers.length || starting}
                                onClick={handleStart}
                            >
                                {starting ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
                                {t('app.recipes.runRecipe', 'Run recipe')}
                            </SharedButton>
                        </div>
                    </div>
                )}
            </Drawer>

            {source === 'bundled' && !!recipes.length && (
                <p className="recipes-page__source">
                    {t('app.recipes.bundledSource', 'Showing the bundled catalog. The live registry is unreachable right now.')}
                </p>
            )}
        </div>
    );
}
