import { useState } from 'react';
import {
    Github, FileText, HelpCircle, MessageSquare, Bug, Check, Download, CheckCircle,
    RefreshCw, ExternalLink, Star, X, Code, Search, Container, Globe, BarChart3,
    Database, Shield, Cloud, Video, Music, Image, Home, Server, GitBranch, Workflow,
    HardDrive, Lock, Users, Settings as SettingsIcon, Layers, ChevronDown, Copy, Tag,
    Cpu, AlertTriangle, Info, Activity, Terminal, Play, Square, Trash2, Plus, Package,
    ArrowRight, ArrowLeft, Eye, Save, Clock, Calendar, Edit3, Link, Unlink, Archive,
    Radio, Zap, MemoryStick, Monitor, Sun, Moon, ChevronRight, ChevronUp, LogOut,
    Loader, RotateCcw, FolderOpen, Layout, Palette, Camera, Newspaper, TrendingUp,
    Sparkles, ArrowUpCircle, AlertCircle, XCircle, GitCompare, GitCommit, Rocket,
    Minus, Unlock, ArrowDownLeft, ArrowUpRight
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useClipboard } from '@/hooks/useClipboard';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

const ICON_CATALOG = {
    'General': {
        Search, X, Check, Copy, Plus, Trash2, Edit3, Save, Eye, Info,
        HelpCircle, AlertTriangle, AlertCircle, ExternalLink, Link, Unlink,
        ChevronDown, ChevronRight, ChevronUp, ArrowRight, ArrowLeft,
        ArrowUpRight, ArrowDownLeft, ArrowUpCircle
    },
    'Status': {
        CheckCircle, XCircle, Loader, RefreshCw, RotateCcw, Activity,
        Zap, Sparkles
    },
    'Files & Data': {
        FileText, FolderOpen, Archive, Download, Package, Database,
        HardDrive, Layers, Tag
    },
    'Media': {
        Image, Video, Music, Camera
    },
    'Development': {
        Code, Terminal, GitBranch, GitCommit, GitCompare, Rocket,
        Bug, Container, Workflow, Layout
    },
    'Infrastructure': {
        Server, Globe, Cloud, Shield, Lock, Unlock, Cpu, MemoryStick,
        Radio, Monitor
    },
    'Communication': {
        MessageSquare, Users
    },
    'Navigation & UI': {
        Home, Star, Sun, Moon, Palette, Play, Square, Calendar, Clock,
        LogOut, SettingsIcon, Newspaper, TrendingUp, BarChart3, Minus
    },
    'Brands': {
        Github
    }
};

const IconReferenceTab = () => {
    const { t } = useTranslation();
    const [searchQuery, setSearchQuery] = useState('');
    const [copiedIcon, setCopiedIcon] = useState(null);
    const { copy } = useClipboard();

    async function handleCopyImport(name) {
        // The tile itself says "Copied!", so skip the success toast.
        if (!await copy(name, null)) return;
        setCopiedIcon(name);
        setTimeout(() => setCopiedIcon(null), 1500);
    }

    const filteredCatalog = Object.entries(ICON_CATALOG).reduce((acc, [group, icons]) => {
        if (!searchQuery) {
            acc[group] = icons;
            return acc;
        }
        const filtered = Object.entries(icons).filter(([name]) =>
            name.toLowerCase().includes(searchQuery.toLowerCase())
        );
        if (filtered.length > 0) {
            acc[group] = Object.fromEntries(filtered);
        }
        return acc;
    }, {});

    const totalIcons = Object.values(ICON_CATALOG).reduce((sum, icons) => sum + Object.keys(icons).length, 0);

    return (
        <div className="settings-section">
            <h2>{t('app.iconReferenceTab.iconReference', 'Icon reference')}</h2>
            <p className="section-description">
                {t('app.iconReferenceTab.lucideReactIconsAvailableInThe', 'Lucide React icons available in the project (')}{totalIcons} {t('app.iconReferenceTab.iconsClickAnIconNameTo', 'icons). Click an icon name to copy it.')}
            </p>

            <div className="settings-card">
                <div className="form-group">
                    <div className="search-input-wrapper">
                        <Search size={16} className="icon-search-ico" />
                        <Input
                            type="text"
                            placeholder={t('app.iconReferenceTab.searchIcons', 'Search icons…')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                </div>
            </div>

            {Object.entries(filteredCatalog).map(([group, icons]) => (
                <div key={group} className="settings-card">
                    <h3>{group}</h3>
                    <div className="icon-reference-grid">
                        {Object.entries(icons).map(([name, IconComp]) => (
                            <SharedButton variant="unstyled" type="button"
                                key={name}
                                className={`icon-reference-item ${copiedIcon === name ? 'copied' : ''}`}
                                onClick={() => handleCopyImport(name)}
                                title={t('app.iconReferenceTab.clickToCopy', 'Click to copy "{{name}}"', { name: name })}
                            >
                                <IconComp size={20} />
                                <span className="icon-reference-name">
                                    {copiedIcon === name ? 'Copied!' : name}
                                </span>
                            </SharedButton>
                        ))}
                    </div>
                </div>
            ))}

            {Object.keys(filteredCatalog).length === 0 && (
                <div className="settings-card">
                    <p className="icon-ref-empty">{t('app.iconReferenceTab.noIconsMatch', 'No icons match "{{query}}"', { query: searchQuery })}</p>
                </div>
            )}
        </div>
    );
};

export default IconReferenceTab;
