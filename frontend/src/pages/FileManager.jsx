import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';
import {
    Folder, File, FileCode, FileText, FileImage, FileVideo, FileAudio,
    FileArchive, Database, Terminal, Upload, FolderPlus, FilePlus,
    ArrowLeft, Search, X, RefreshCw, Eye, EyeOff, Download, Edit3,
    Trash2, Lock, BarChart3, ChevronDown, ChevronRight, HardDrive,
    PieChart, Clock, PanelRightClose, PanelRightOpen
} from 'lucide-react';
import { PieChart as RechartsPie, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

// LocalStorage keys
const SIDEBAR_VISIBLE_KEY = 'serverkit-fm-sidebar';
const DISK_COLLAPSED_KEY = 'serverkit-fm-disk-collapsed';

function FileManager() {
    const [currentPath, setCurrentPath] = useState('/home');
    const [entries, setEntries] = useState([]);
    const [parentPath, setParentPath] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showHidden, setShowHidden] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState(null);
    const [selectedFile, setSelectedFile] = useState(null);
    const [fileContent, setFileContent] = useState('');
    const [editingFile, setEditingFile] = useState(null);
    const [showNewFileModal, setShowNewFileModal] = useState(false);
    const [showNewFolderModal, setShowNewFolderModal] = useState(false);
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [showPermissionsModal, setShowPermissionsModal] = useState(false);
    const [newFileName, setNewFileName] = useState('');
    const [newFolderName, setNewFolderName] = useState('');
    const [renameTarget, setRenameTarget] = useState(null);
    const [newName, setNewName] = useState('');
    const [permissionsTarget, setPermissionsTarget] = useState(null);
    const [newPermissions, setNewPermissions] = useState('');
    const [uploadProgress, setUploadProgress] = useState(null);
    const [confirmDialog, setConfirmDialog] = useState(null);
    const fileInputRef = useRef(null);
    const toast = useToast();

    // Sidebar and disk usage state
    const [sidebarVisible, setSidebarVisible] = useState(() => {
        const saved = localStorage.getItem(SIDEBAR_VISIBLE_KEY);
        return saved !== null ? saved === 'true' : true;
    });
    const [diskCollapsed, setDiskCollapsed] = useState(() => {
        const saved = localStorage.getItem(DISK_COLLAPSED_KEY);
        return saved !== null ? saved === 'true' : false;
    });
    const [diskMounts, setDiskMounts] = useState([]);
    const [diskLastUpdated, setDiskLastUpdated] = useState(null);
    const [diskLoading, setDiskLoading] = useState(false);

    // Analysis state
    const [analysisLoading, setAnalysisLoading] = useState(false);
    const [directoryAnalysis, setDirectoryAnalysis] = useState(null);
    const [typeBreakdown, setTypeBreakdown] = useState(null);
    const [analysisView, setAnalysisView] = useState('directories'); // 'directories' | 'files'

    useEffect(() => {
        loadDirectory(currentPath);
        loadDiskMounts();
    }, [currentPath, showHidden]);

    useEffect(() => {
        localStorage.setItem(SIDEBAR_VISIBLE_KEY, sidebarVisible);
    }, [sidebarVisible]);

    useEffect(() => {
        localStorage.setItem(DISK_COLLAPSED_KEY, diskCollapsed);
    }, [diskCollapsed]);

    const loadDirectory = async (path) => {
        setLoading(true);
        setSearchResults(null);
        setDirectoryAnalysis(null);
        setTypeBreakdown(null);
        try {
            const data = await api.browseFiles(path, showHidden);
            setEntries(data.entries || []);
            setParentPath(data.parent);
            setCurrentPath(data.path);
        } catch (error) {
            toast.error(`Failed to load directory: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const loadDiskMounts = async () => {
        setDiskLoading(true);
        try {
            const data = await api.getAllDiskMounts();
            setDiskMounts(data.mounts || []);
            setDiskLastUpdated(new Date());
        } catch (error) {
            console.error('Failed to load disk mounts:', error);
        } finally {
            setDiskLoading(false);
        }
    };

    const analyzeDirectory = async () => {
        setAnalysisLoading(true);
        try {
            const [analysisData, breakdownData] = await Promise.all([
                api.analyzeDirectory(currentPath, 2, 15),
                api.getFileTypeBreakdown(currentPath, 3)
            ]);
            setDirectoryAnalysis(analysisData);
            setTypeBreakdown(breakdownData);
        } catch (error) {
            toast.error(`Analysis failed: ${error.message}`);
        } finally {
            setAnalysisLoading(false);
        }
    };

    const closeAnalysis = () => {
        setDirectoryAnalysis(null);
        setTypeBreakdown(null);
    };

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            setSearchResults(null);
            return;
        }
        setLoading(true);
        try {
            const data = await api.searchFiles(currentPath, searchQuery);
            setSearchResults(data.results || []);
        } catch (error) {
            toast.error(`Search failed: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleNavigate = (entry) => {
        if (entry.is_dir) {
            setCurrentPath(entry.path);
            setSelectedFile(null);
            setEditingFile(null);
        } else {
            handleFileClick(entry);
        }
    };

    const handleFileClick = async (entry) => {
        setSelectedFile(entry);
        if (entry.is_editable) {
            try {
                const data = await api.readFile(entry.path);
                setFileContent(data.content);
            } catch (error) {
                toast.error(`Failed to read file: ${error.message}`);
            }
        }
    };

    const handleEditFile = () => {
        if (selectedFile && selectedFile.is_editable) {
            setEditingFile(selectedFile);
        }
    };

    const handleSaveFile = async () => {
        if (!editingFile) return;
        try {
            await api.writeFile(editingFile.path, fileContent);
            toast.success('File saved successfully');
            setEditingFile(null);
            loadDirectory(currentPath);
        } catch (error) {
            toast.error(`Failed to save file: ${error.message}`);
        }
    };

    const handleCreateFile = async () => {
        if (!newFileName.trim()) return;
        const filePath = `${currentPath}/${newFileName}`;
        try {
            await api.createFile(filePath);
            toast.success('File created successfully');
            setShowNewFileModal(false);
            setNewFileName('');
            loadDirectory(currentPath);
        } catch (error) {
            toast.error(`Failed to create file: ${error.message}`);
        }
    };

    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;
        const folderPath = `${currentPath}/${newFolderName}`;
        try {
            await api.createDirectory(folderPath);
            toast.success('Folder created successfully');
            setShowNewFolderModal(false);
            setNewFolderName('');
            loadDirectory(currentPath);
        } catch (error) {
            toast.error(`Failed to create folder: ${error.message}`);
        }
    };

    const handleDelete = async (entry) => {
        setConfirmDialog({
            title: 'Delete Confirmation',
            message: `Are you sure you want to delete "${entry.name}"? ${entry.is_dir ? 'This will delete all contents inside.' : ''}`,
            confirmText: 'Delete',
            variant: 'danger',
            onConfirm: async () => {
                try {
                    await api.deleteFile(entry.path);
                    toast.success(`${entry.is_dir ? 'Folder' : 'File'} deleted successfully`);
                    setSelectedFile(null);
                    loadDirectory(currentPath);
                } catch (error) {
                    toast.error(`Failed to delete: ${error.message}`);
                }
                setConfirmDialog(null);
            },
            onCancel: () => setConfirmDialog(null)
        });
    };

    const handleRename = async () => {
        if (!renameTarget || !newName.trim()) return;
        try {
            await api.renameFile(renameTarget.path, newName);
            toast.success('Renamed successfully');
            setShowRenameModal(false);
            setRenameTarget(null);
            setNewName('');
            loadDirectory(currentPath);
        } catch (error) {
            toast.error(`Failed to rename: ${error.message}`);
        }
    };

    const handleChangePermissions = async () => {
        if (!permissionsTarget || !newPermissions.trim()) return;
        try {
            await api.changeFilePermissions(permissionsTarget.path, newPermissions);
            toast.success('Permissions changed successfully');
            setShowPermissionsModal(false);
            setPermissionsTarget(null);
            setNewPermissions('');
            loadDirectory(currentPath);
        } catch (error) {
            toast.error(`Failed to change permissions: ${error.message}`);
        }
    };

    const handleUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            await api.uploadFile(currentPath, file, (progress) => {
                setUploadProgress(progress);
            });
            toast.success('File uploaded successfully');
            loadDirectory(currentPath);
        } catch (error) {
            toast.error(`Upload failed: ${error.message}`);
        } finally {
            setUploadProgress(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    const handleDownload = (entry) => {
        api.downloadFile(entry.path);
    };

    const openRenameModal = (entry) => {
        setRenameTarget(entry);
        setNewName(entry.name);
        setShowRenameModal(true);
    };

    const openPermissionsModal = (entry) => {
        setPermissionsTarget(entry);
        setNewPermissions(entry.permissions_octal || '755');
        setShowPermissionsModal(true);
    };

    const getFileIcon = (entry) => {
        if (entry.is_dir) return <Folder size={18} className="file-icon-svg folder" />;

        const ext = entry.name.split('.').pop().toLowerCase();
        const codeExts = ['js', 'jsx', 'ts', 'tsx', 'py', 'rb', 'php', 'java', 'c', 'cpp', 'h', 'go', 'rs'];
        const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'];
        const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'webm'];
        const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma'];
        const archiveExts = ['zip', 'tar', 'gz', 'rar', '7z', 'bz2'];
        const dataExts = ['json', 'xml', 'yaml', 'yml', 'csv', 'db', 'sqlite', 'sql'];
        const textExts = ['txt', 'md', 'log', 'ini', 'conf', 'cfg'];

        if (codeExts.includes(ext)) return <FileCode size={18} className="file-icon-svg code" />;
        if (imageExts.includes(ext)) return <FileImage size={18} className="file-icon-svg image" />;
        if (videoExts.includes(ext)) return <FileVideo size={18} className="file-icon-svg video" />;
        if (audioExts.includes(ext)) return <FileAudio size={18} className="file-icon-svg audio" />;
        if (archiveExts.includes(ext)) return <FileArchive size={18} className="file-icon-svg archive" />;
        if (dataExts.includes(ext)) return <Database size={18} className="file-icon-svg data" />;
        if (textExts.includes(ext)) return <FileText size={18} className="file-icon-svg text" />;
        if (['sh', 'bash', 'zsh'].includes(ext)) return <Terminal size={18} className="file-icon-svg terminal" />;

        return <File size={18} className="file-icon-svg" />;
    };

    const getDiskColor = (percent) => {
        if (percent >= 90) return 'critical';
        if (percent >= 70) return 'warning';
        return 'healthy';
    };

    const displayedEntries = searchResults || entries;

    return (
        <div className={`file-manager ${sidebarVisible ? 'sidebar-open' : ''}`}>
            <div className="page-header">
                <div className="page-header-content">
                    <h1>File Manager</h1>
                    <p className="page-description">Browse, edit, and manage your server files</p>
                </div>
                <div className="page-header-actions">
                    <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                        <Upload size={16} />
                        Upload
                    </button>
                    <button className="btn btn-secondary" onClick={() => setShowNewFolderModal(true)}>
                        <FolderPlus size={16} />
                        New Folder
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowNewFileModal(true)}>
                        <FilePlus size={16} />
                        New File
                    </button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleUpload}
                    />
                </div>
            </div>

            {uploadProgress !== null && (
                <div className="upload-progress">
                    <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${uploadProgress}%` }}></div>
                    </div>
                    <span>{Math.round(uploadProgress)}%</span>
                </div>
            )}

            <div className="file-manager-toolbar">
                <div className="path-breadcrumb">
                    <button
                        className="btn btn-icon"
                        onClick={() => parentPath && setCurrentPath(parentPath)}
                        disabled={!parentPath}
                    >
                        <ArrowLeft size={16} />
                    </button>
                    <span className="current-path">{currentPath}</span>
                </div>
                <div className="toolbar-actions">
                    <div className="search-box">
                        <Search size={16} className="search-icon" />
                        <input
                            type="text"
                            placeholder="Search files..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        />
                        {searchResults && (
                            <button className="btn btn-icon btn-sm" onClick={() => setSearchResults(null)}>
                                <X size={14} />
                            </button>
                        )}
                    </div>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={analyzeDirectory}
                        disabled={analysisLoading}
                        title="Analyze directory sizes"
                    >
                        <BarChart3 size={14} />
                        Analyze
                    </button>
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={showHidden}
                            onChange={(e) => setShowHidden(e.target.checked)}
                        />
                        {showHidden ? <Eye size={14} /> : <EyeOff size={14} />}
                        Hidden
                    </label>
                    <button className="btn btn-icon" onClick={() => loadDirectory(currentPath)} title="Refresh">
                        <RefreshCw size={16} />
                    </button>
                    <button
                        className="btn btn-icon"
                        onClick={() => setSidebarVisible(!sidebarVisible)}
                        title={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
                    >
                        {sidebarVisible ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
                    </button>
                </div>
            </div>

            <div className="file-manager-layout">
                <div className="file-manager-main">
                    <div className="file-manager-content">
                        <div className="file-list-container">
                            {loading ? (
                                <div className="loading-state">
                                    <Spinner />
                                </div>
                            ) : displayedEntries.length === 0 ? (
                                <div className="empty-state">
                                    <Folder size={48} strokeWidth={1.5} />
                                    <p>{searchResults ? 'No files found matching your search' : 'This directory is empty'}</p>
                                </div>
                            ) : (
                                <div className="file-list">
                                    <div className="file-list-header">
                                        <span className="col-name">Name</span>
                                        <span className="col-size">Size</span>
                                        <span className="col-modified">Modified</span>
                                        <span className="col-permissions">Permissions</span>
                                        <span className="col-actions">Actions</span>
                                    </div>
                                    {displayedEntries.map((entry) => (
                                        <div
                                            key={entry.path}
                                            className={`file-item ${selectedFile?.path === entry.path ? 'selected' : ''}`}
                                            onClick={() => handleNavigate(entry)}
                                        >
                                            <span className="col-name">
                                                {getFileIcon(entry)}
                                                {entry.name}
                                                {entry.is_link && <span className="link-indicator">→</span>}
                                            </span>
                                            <span className="col-size">{entry.is_dir ? '-' : entry.size_human}</span>
                                            <span className="col-modified">
                                                {new Date(entry.modified).toLocaleDateString()}
                                            </span>
                                            <span className="col-permissions">{entry.permissions}</span>
                                            <span className="col-actions" onClick={(e) => e.stopPropagation()}>
                                                {!entry.is_dir && (
                                                    <button
                                                        className="btn btn-icon btn-sm"
                                                        onClick={() => handleDownload(entry)}
                                                        title="Download"
                                                    >
                                                        <Download size={14} />
                                                    </button>
                                                )}
                                                <button
                                                    className="btn btn-icon btn-sm"
                                                    onClick={() => openRenameModal(entry)}
                                                    title="Rename"
                                                >
                                                    <Edit3 size={14} />
                                                </button>
                                                <button
                                                    className="btn btn-icon btn-sm"
                                                    onClick={() => openPermissionsModal(entry)}
                                                    title="Permissions"
                                                >
                                                    <Lock size={14} />
                                                </button>
                                                <button
                                                    className="btn btn-icon btn-sm btn-danger"
                                                    onClick={() => handleDelete(entry)}
                                                    title="Delete"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {selectedFile && !selectedFile.is_dir && (
                            <div className="file-preview">
                                <div className="preview-header">
                                    <h3>{selectedFile.name}</h3>
                                    <div className="preview-actions">
                                        {selectedFile.is_editable && !editingFile && (
                                            <button className="btn btn-primary btn-sm" onClick={handleEditFile}>
                                                <Edit3 size={14} />
                                                Edit
                                            </button>
                                        )}
                                        {editingFile && (
                                            <>
                                                <button className="btn btn-secondary btn-sm" onClick={() => setEditingFile(null)}>
                                                    Cancel
                                                </button>
                                                <button className="btn btn-primary btn-sm" onClick={handleSaveFile}>
                                                    Save
                                                </button>
                                            </>
                                        )}
                                        <button className="btn btn-icon btn-sm" onClick={() => setSelectedFile(null)}>
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>
                                <div className="preview-info">
                                    <span>Size: {selectedFile.size_human}</span>
                                    <span>Owner: {selectedFile.owner}</span>
                                    <span>Group: {selectedFile.group}</span>
                                    {selectedFile.mime_type && <span>Type: {selectedFile.mime_type}</span>}
                                </div>
                                {selectedFile.is_editable ? (
                                    <textarea
                                        className="file-editor"
                                        value={fileContent}
                                        onChange={(e) => setFileContent(e.target.value)}
                                        readOnly={!editingFile}
                                        spellCheck={false}
                                    />
                                ) : (
                                    <div className="preview-unavailable">
                                        <EyeOff size={48} strokeWidth={1.5} />
                                        <p>Preview not available for this file type</p>
                                        <button className="btn btn-primary" onClick={() => handleDownload(selectedFile)}>
                                            <Download size={16} />
                                            Download File
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Sidebar */}
                {sidebarVisible && (
                    <div className="file-manager-sidebar">
                        {/* Disk Usage Section */}
                        <div className="sidebar-section">
                            <button
                                className="sidebar-section-header"
                                onClick={() => setDiskCollapsed(!diskCollapsed)}
                            >
                                <HardDrive size={16} />
                                <span>Disk Usage</span>
                                {diskCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                            </button>

                            {!diskCollapsed && (
                                <div className="sidebar-section-content">
                                    <div className="disk-header-row">
                                        {diskLastUpdated && (
                                            <span className="disk-updated">
                                                <Clock size={12} />
                                                {diskLastUpdated.toLocaleTimeString()}
                                            </span>
                                        )}
                                        <button
                                            className="btn btn-icon btn-sm"
                                            onClick={loadDiskMounts}
                                            disabled={diskLoading}
                                            title="Refresh"
                                        >
                                            <RefreshCw size={12} className={diskLoading ? 'spinning' : ''} />
                                        </button>
                                    </div>

                                    {diskMounts.map((mount, idx) => (
                                        <div key={idx} className="disk-mount-item">
                                            <div className="disk-mount-header">
                                                <span className="disk-mount-point">{mount.mountpoint}</span>
                                                <span className={`disk-percent ${getDiskColor(mount.percent)}`}>
                                                    {mount.percent}%
                                                </span>
                                            </div>
                                            <div className={`disk-progress ${getDiskColor(mount.percent)}`}>
                                                <div
                                                    className="disk-progress-fill"
                                                    style={{ width: `${mount.percent}%` }}
                                                />
                                            </div>
                                            <div className="disk-mount-info">
                                                <span>{mount.used_human} / {mount.total_human}</span>
                                                <span className="disk-device">{mount.device}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Analysis Section */}
                        {(directoryAnalysis || analysisLoading) && (
                            <div className="sidebar-section analysis-section">
                                <div className="sidebar-section-header static">
                                    <BarChart3 size={16} />
                                    <span>Directory Analysis</span>
                                    <button
                                        className="btn btn-icon btn-sm close-btn"
                                        onClick={closeAnalysis}
                                    >
                                        <X size={14} />
                                    </button>
                                </div>

                                <div className="sidebar-section-content">
                                    {analysisLoading ? (
                                        <div className="analysis-loading">
                                            <Spinner />
                                            <span>Analyzing...</span>
                                        </div>
                                    ) : (
                                        <>
                                            <div className="analysis-total">
                                                Total: {directoryAnalysis.total_size_human}
                                            </div>

                                            {/* View Toggle */}
                                            <div className="analysis-tabs">
                                                <button
                                                    className={`analysis-tab ${analysisView === 'directories' ? 'active' : ''}`}
                                                    onClick={() => setAnalysisView('directories')}
                                                >
                                                    <Folder size={14} />
                                                    Directories
                                                </button>
                                                <button
                                                    className={`analysis-tab ${analysisView === 'files' ? 'active' : ''}`}
                                                    onClick={() => setAnalysisView('files')}
                                                >
                                                    <File size={14} />
                                                    Files
                                                </button>
                                            </div>

                                            {/* Directory Sizes */}
                                            {analysisView === 'directories' && (
                                                <div className="analysis-bars">
                                                    {directoryAnalysis.directories.slice(0, 10).map((dir, idx) => (
                                                        <div
                                                            key={idx}
                                                            className="analysis-bar-item"
                                                            onClick={() => setCurrentPath(dir.path)}
                                                        >
                                                            <div className="analysis-bar-header">
                                                                <span className="analysis-bar-name">
                                                                    <Folder size={12} />
                                                                    {dir.name}
                                                                </span>
                                                                <span className="analysis-bar-size">{dir.size_human}</span>
                                                            </div>
                                                            <div className="analysis-bar-track">
                                                                <div
                                                                    className="analysis-bar-fill"
                                                                    style={{ width: `${dir.percent}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                    ))}
                                                    {directoryAnalysis.directories.length === 0 && (
                                                        <div className="analysis-empty">No subdirectories</div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Largest Files */}
                                            {analysisView === 'files' && (
                                                <div className="analysis-files">
                                                    {directoryAnalysis.largest_files.slice(0, 10).map((file, idx) => (
                                                        <div
                                                            key={idx}
                                                            className="analysis-file-item"
                                                            onClick={() => handleFileClick(file)}
                                                        >
                                                            <File size={12} />
                                                            <span className="analysis-file-name">{file.name}</span>
                                                            <span className="analysis-file-size">{file.size_human}</span>
                                                        </div>
                                                    ))}
                                                    {directoryAnalysis.largest_files.length === 0 && (
                                                        <div className="analysis-empty">No files</div>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Type Breakdown Section */}
                        {typeBreakdown && typeBreakdown.breakdown && typeBreakdown.breakdown.length > 0 && (
                            <div className="sidebar-section">
                                <div className="sidebar-section-header static">
                                    <PieChart size={16} />
                                    <span>File Types</span>
                                </div>
                                <div className="sidebar-section-content">
                                    <div className="type-breakdown-chart">
                                        <ResponsiveContainer width="100%" height={180}>
                                            <RechartsPie>
                                                <Pie
                                                    data={typeBreakdown.breakdown}
                                                    dataKey="size"
                                                    nameKey="name"
                                                    cx="50%"
                                                    cy="50%"
                                                    outerRadius={60}
                                                    innerRadius={35}
                                                    paddingAngle={2}
                                                >
                                                    {typeBreakdown.breakdown.map((entry, idx) => (
                                                        <Cell key={idx} fill={entry.color} />
                                                    ))}
                                                </Pie>
                                                <Tooltip
                                                    formatter={(value, name) => [
                                                        typeBreakdown.breakdown.find(b => b.name === name)?.size_human || value,
                                                        name
                                                    ]}
                                                />
                                            </RechartsPie>
                                        </ResponsiveContainer>
                                    </div>
                                    <div className="type-breakdown-legend">
                                        {typeBreakdown.breakdown.map((cat, idx) => (
                                            <div key={idx} className="type-legend-item">
                                                <span
                                                    className="type-legend-color"
                                                    style={{ background: cat.color }}
                                                />
                                                <span className="type-legend-name">{cat.name}</span>
                                                <span className="type-legend-size">{cat.size_human}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* New File Modal */}
            {showNewFileModal && (
                <div className="modal-overlay" onClick={() => setShowNewFileModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create New File</h2>
                            <button className="btn btn-icon" onClick={() => setShowNewFileModal(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>File Name</label>
                                <input
                                    type="text"
                                    value={newFileName}
                                    onChange={(e) => setNewFileName(e.target.value)}
                                    placeholder="example.txt"
                                    autoFocus
                                />
                            </div>
                            <p className="text-muted">File will be created in: {currentPath}</p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowNewFileModal(false)}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={handleCreateFile}>
                                Create File
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* New Folder Modal */}
            {showNewFolderModal && (
                <div className="modal-overlay" onClick={() => setShowNewFolderModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Create New Folder</h2>
                            <button className="btn btn-icon" onClick={() => setShowNewFolderModal(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Folder Name</label>
                                <input
                                    type="text"
                                    value={newFolderName}
                                    onChange={(e) => setNewFolderName(e.target.value)}
                                    placeholder="new-folder"
                                    autoFocus
                                />
                            </div>
                            <p className="text-muted">Folder will be created in: {currentPath}</p>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowNewFolderModal(false)}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={handleCreateFolder}>
                                Create Folder
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Rename Modal */}
            {showRenameModal && (
                <div className="modal-overlay" onClick={() => setShowRenameModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Rename {renameTarget?.is_dir ? 'Folder' : 'File'}</h2>
                            <button className="btn btn-icon" onClick={() => setShowRenameModal(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>New Name</label>
                                <input
                                    type="text"
                                    value={newName}
                                    onChange={(e) => setNewName(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowRenameModal(false)}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={handleRename}>
                                Rename
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Permissions Modal */}
            {showPermissionsModal && (
                <div className="modal-overlay" onClick={() => setShowPermissionsModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Change Permissions</h2>
                            <button className="btn btn-icon" onClick={() => setShowPermissionsModal(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        <div className="modal-body">
                            <div className="form-group">
                                <label>Permissions (Octal)</label>
                                <input
                                    type="text"
                                    value={newPermissions}
                                    onChange={(e) => setNewPermissions(e.target.value)}
                                    placeholder="755"
                                    maxLength={4}
                                    autoFocus
                                />
                            </div>
                            <p className="text-muted">
                                Current: {permissionsTarget?.permissions} ({permissionsTarget?.permissions_octal})
                            </p>
                            <div className="permissions-help">
                                <p>Common permissions:</p>
                                <ul>
                                    <li><code>755</code> - Owner: rwx, Group/Other: rx (directories)</li>
                                    <li><code>644</code> - Owner: rw, Group/Other: r (files)</li>
                                    <li><code>600</code> - Owner: rw only (private files)</li>
                                </ul>
                            </div>
                        </div>
                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setShowPermissionsModal(false)}>
                                Cancel
                            </button>
                            <button className="btn btn-primary" onClick={handleChangePermissions}>
                                Apply
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Dialog */}
            {confirmDialog && (
                <ConfirmDialog
                    title={confirmDialog.title}
                    message={confirmDialog.message}
                    confirmText={confirmDialog.confirmText}
                    variant={confirmDialog.variant}
                    onConfirm={confirmDialog.onConfirm}
                    onCancel={confirmDialog.onCancel}
                />
            )}
        </div>
    );
}

export default FileManager;
