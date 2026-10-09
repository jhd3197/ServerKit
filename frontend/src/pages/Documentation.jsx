import { useMemo, useState } from 'react';
import { BookOpen, Search, ExternalLink, FileText } from 'lucide-react';
import { Input } from '@/components/ui/input';
import PageLayout from '../layouts/PageLayout';
import EmptyState from '../components/EmptyState';
import { useTranslation } from 'react-i18next';

const REPO_DOCS_URL = 'https://github.com/jhd3197/ServerKit/blob/main/docs';

const DOC_GROUPS = [
    {
        id: 'getting-started',
        titleKey: 'app.documentation.gettingStarted', title: 'Getting started',
        docs: [
            { file: 'README.md', titleKey: 'app.documentation.docsHome', title: 'Docs home', desc: 'Documentation index' },
            { file: 'INSTALLATION.md', titleKey: 'app.documentation.installation', title: 'Installation', desc: 'Install ServerKit on a server' },
            { file: 'LOCAL_DEVELOPMENT.md', titleKey: 'app.documentation.localDevelopment', title: 'Local development', desc: 'Run the panel locally' },
            { file: 'DEPLOYMENT.md', titleKey: 'app.documentation.deployment', title: 'Deployment', desc: 'Production deployment guide' },
        ],
    },
    {
        id: 'reference',
        titleKey: 'app.documentation.reference', title: 'Reference',
        docs: [
            { file: 'ARCHITECTURE.md', titleKey: 'app.documentation.architecture', title: 'Architecture', desc: 'How ServerKit is structured' },
            { file: 'API.md', titleKey: 'app.documentation.apiReference', title: 'API reference', desc: 'REST API documentation' },
            { file: 'MULTI_ENVIRONMENT.md', titleKey: 'app.documentation.multiEnvironment', title: 'Multi-environment', desc: 'Manage multiple environments' },
            { file: 'MCP_SERVER_ACCESS.md', titleKey: 'app.documentation.mcpServerAccess', title: 'MCP server access', desc: 'Model Context Protocol access' },
            { file: 'pairing.md', titleKey: 'app.documentation.pairing', title: 'Pairing', desc: 'Pairing servers with the panel' },
            { file: 'PLAN_AGENT_FLEET.md', titleKey: 'app.documentation.agentFleetPlan', title: 'Agent fleet plan', desc: 'Multi-server agent design' },
        ],
    },
    {
        id: 'product',
        titleKey: 'app.documentation.productNotes', title: 'Product notes',
        docs: [
            { file: 'FEATURE_GAPS.md', titleKey: 'app.documentation.featureGaps', title: 'Feature gaps', desc: 'Known gaps and limitations' },
            { file: 'COMPETITIVE_ANALYSIS.md', titleKey: 'app.documentation.competitiveAnalysis', title: 'Competitive analysis', desc: 'Market comparison' },
            { file: 'MARKET_POSITIONING.md', titleKey: 'app.documentation.marketPositioning', title: 'Market positioning', desc: 'Product positioning notes' },
        ],
    },
    {
        id: 'translations',
        titleKey: 'app.documentation.translations', title: 'Translations',
        docs: [
            { file: 'README.es.md', titleKey: 'app.documentation.readmeEspaOl', title: 'README (Español)', desc: 'Spanish translation' },
            { file: 'README.pt.md', titleKey: 'app.documentation.readmePortuguS', title: 'README (Português)', desc: 'Portuguese translation' },
            { file: 'README.zh-CN.md', titleKey: 'app.documentation.readme', title: 'README (简体中文)', desc: 'Simplified Chinese translation' },
        ],
    },
];

const ROOT_DOCS = [
    { file: 'README.md', titleKey: 'app.documentation.projectReadme', title: 'Project README', desc: 'Top-level project overview', root: true },
    { file: 'CONTRIBUTING.md', titleKey: 'app.documentation.contributing', title: 'Contributing', desc: 'How to contribute', root: true },
    { file: 'AGENTS.md', titleKey: 'app.documentation.agentsMd', title: 'AGENTS.md', desc: 'Guidance for AI/agent contributors', root: true },
    { file: 'CLAUDE.md', titleKey: 'app.documentation.claudeMd', title: 'CLAUDE.md', desc: 'Guidance for Claude Code', root: true },
    { file: 'ROADMAP.md', titleKey: 'app.documentation.roadmap', title: 'Roadmap', desc: 'Planned features', root: true },
    { file: 'SECURITY_AUDIT.md', titleKey: 'app.documentation.securityAudit', title: 'Security audit', desc: 'Security findings', root: true },
];

const REPO_ROOT_URL = 'https://github.com/jhd3197/ServerKit/blob/main';

export default function Documentation() {
    const { t } = useTranslation();
    const [query, setQuery] = useState('');

    const matches = (s) => s.toLowerCase().includes(query.trim().toLowerCase());

    const groups = useMemo(() => {
        if (!query.trim()) return DOC_GROUPS;
        return DOC_GROUPS.map(g => ({
            ...g,
            docs: g.docs.filter(d => matches(d.title) || matches(d.file) || matches(d.desc)),
        })).filter(g => g.docs.length);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    const rootDocs = useMemo(() => {
        if (!query.trim()) return ROOT_DOCS;
        return ROOT_DOCS.filter(d => matches(d.title) || matches(d.file) || matches(d.desc));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    const empty = !groups.length && !rootDocs.length;

    return (
        <PageLayout
            className="documentation"
            icon={<BookOpen size={18} />}
            title={t('app.documentation.documentation', 'Documentation')}
            meta={<>{t('app.documentation.devOnly', 'dev only')}</>}
            actions={(
                <div className="documentation__search">
                    <Search size={14} />
                    <Input
                        placeholder={t('app.documentation.filterDocs', 'Filter docs…')}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                    />
                </div>
            )}
        >
            {empty && (
                <EmptyState icon={BookOpen} title={t('app.documentation.noDocsMatch', 'No docs match "{{query}}".', { query: query })} />
            )}

            {!!rootDocs.length && (
                <section className="documentation__group">
                    <h3 className="documentation__group-title">{t('app.documentation.repositoryRoot', 'Repository root')}</h3>
                    <ul className="documentation__list">
                        {rootDocs.map(d => (
                            <DocItem key={d.file} doc={d} baseUrl={REPO_ROOT_URL} pathPrefix="" />
                        ))}
                    </ul>
                </section>
            )}

            {groups.map(g => (
                <section key={g.id} className="documentation__group">
                    <h3 className="documentation__group-title">{g.title}</h3>
                    <ul className="documentation__list">
                        {g.docs.map(d => (
                            <DocItem key={d.file} doc={d} baseUrl={REPO_DOCS_URL} pathPrefix="docs/" />
                        ))}
                    </ul>
                </section>
            ))}
        </PageLayout>
    );
}

function DocItem({ doc, baseUrl, pathPrefix }) {
    return (
        <li>
            <a
                href={`${baseUrl}/${doc.file}`}
                target="_blank"
                rel="noreferrer noopener"
                className="documentation__link"
            >
                <span className="documentation__icon">
                    <FileText size={14} />
                </span>
                <span className="documentation__label">{doc.title}</span>
                <span className="documentation__path">{pathPrefix}{doc.file}</span>
                <ExternalLink size={12} className="documentation__ext" />
            </a>
            {doc.desc && <span className="documentation__note">{doc.desc}</span>}
        </li>
    );
}
