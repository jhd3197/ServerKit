import { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { useToast } from '../contexts/ToastContext';
import Spinner from '../components/Spinner';
import ConfirmDialog from '../components/ConfirmDialog';

function FileManager() {
    const [currentPath, setCurrentPath] = useState('/home');
    const [entries, setEntries] = useState([]);
    const [parentPath, setParentPath] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showHidden, setShowHidden] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState(null);
    const [diskUsage, setDiskUsage] = useState(null);
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

    useEffect(() => {
        loadDirectory(currentPath);
        loadDiskUsage();
    }, [currentPath, showHidden]);

    const loadDirectory = async (path) => {
        setLoading(true);
        setSearchResults(null);
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

    const loadDiskUsage = async () => {
        try {
            const data = await api.getDiskUsage(currentPath);
            setDiskUsage(data);
        } catch (error) {
            console.error('Failed to load disk usage:', error);
        }
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
        if (entry.is_dir) return 'folder';
        const ext = entry.name.split('.').pop().toLowerCase();
        const iconMap = {
            js: 'javascript', jsx: 'javascript', ts: 'javascript', tsx: 'javascript',
            py: 'python', rb: 'ruby', php: 'php', java: 'java',
            html: 'html', css: 'css', less: 'css', scss: 'css',
            json: 'json', xml: 'xml', yaml: 'yaml', yml: 'yaml',
            md: 'markdown', txt: 'text', log: 'text',
            sh: 'terminal', bash: 'terminal',
            jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', svg: 'image',
            pdf: 'pdf', doc: 'document', docx: 'document',
            zip: 'archive', tar: 'archive', gz: 'archive', rar: 'archive'
        };
        return iconMap[ext] || 'file';
    };

    const displayedEntries = searchResults || entries;

    return (
        <div className="file-manager">
            <div className="page-header">
                <div className="page-header-content">
                    <h1>File Manager</h1>
                    <p className="page-description">Browse, edit, and manage your server files</p>
                </div>
                <div className="page-header-actions">
                    <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                        Upload
                    </button>
                    <button className="btn btn-secondary" onClick={() => setShowNewFolderModal(true)}>
                        New Folder
                    </button>
                    <button className="btn btn-primary" onClick={() => setShowNewFileModal(true)}>
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
                        <span className="icon">arrow_back</span>
                    </button>
                    <span className="current-path">{currentPath}</span>
                </div>
                <div className="toolbar-actions">
                    <div className="search-box">
                        <input
                            type="text"
                            placeholder="Search files..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                        />
                        <button className="btn btn-icon" onClick={handleSearch}>
                            <span className="icon">search</span>
                        </button>
                        {searchResults && (
                            <button className="btn btn-icon" onClick={() => setSearchResults(null)}>
                                <span className="icon">close</span>
                            </button>
                        )}
                    </div>
                    <label className="checkbox-label">
                        <input
                            type="checkbox"
                            checked={showHidden}
                            onChange={(e) => setShowHidden(e.target.checked)}
                        />
                        Show hidden
                    </label>
                    <button className="btn btn-icon" onClick={() => loadDirectory(currentPath)}>
                        <span className="icon">refresh</span>
                    </button>
                </div>
            </div>

            {diskUsage && (
                <div className="disk-usage-bar">
                    <div className="disk-usage-info">
                        <span>Disk Usage: {diskUsage.used_human} / {diskUsage.total_human}</span>
                        <span>{diskUsage.percent}% used</span>
                    </div>
                    <div className="disk-progress">
                        <div
                            className={`disk-progress-fill ${diskUsage.percent > 90 ? 'critical' : diskUsage.percent > 75 ? 'warning' : ''}`}
                            style={{ width: `${diskUsage.percent}%` }}
                        ></div>
                    </div>
                </div>
            )}

            <div className="file-manager-content">
                <div className="file-list-container">
                    {loading ? (
                        <div className="loading-state">
                            <Spinner />
                        </div>
                    ) : displayedEntries.length === 0 ? (
                        <div className="empty-state">
                            <span className="icon">folder_open</span>
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
                                        <span className={`file-icon ${getFileIcon(entry)}`}></span>
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
                                                <span className="icon">download</span>
                                            </button>
                                        )}
                                        <button
                                            className="btn btn-icon btn-sm"
                                            onClick={() => openRenameModal(entry)}
                                            title="Rename"
                                        >
                                            <span className="icon">edit</span>
                                        </button>
                                        <button
                                            className="btn btn-icon btn-sm"
                                            onClick={() => openPermissionsModal(entry)}
                                            title="Permissions"
                                        >
                                            <span className="icon">lock</span>
                                        </button>
                                        <button
                                            className="btn btn-icon btn-sm btn-danger"
                                            onClick={() => handleDelete(entry)}
                                            title="Delete"
                                        >
                                            <span className="icon">delete</span>
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
                                    <span className="icon">close</span>
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
                                <span className="icon">visibility_off</span>
                                <p>Preview not available for this file type</p>
                                <button className="btn btn-primary" onClick={() => handleDownload(selectedFile)}>
                                    Download File
                                </button>
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
                                <span className="icon">close</span>
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
                                <span className="icon">close</span>
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
                                <span className="icon">close</span>
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
                                <span className="icon">close</span>
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
