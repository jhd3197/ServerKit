"""File management service for browsing, editing, and managing files."""

import os
import sys
import shutil
import stat
import mimetypes
import hashlib
import psutil
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime

try:
    import pwd
except ImportError:
    # Provide a Windows-compatible alternative here
    pwd = None

if sys.platform != "win32":
    import grp
else:
    # Use Windows-specific logic or a placeholder
    grp = None 

class FileService:
    """Service for file system operations."""

    # Allowed root directories for browsing (security)
    ALLOWED_ROOTS = ['/home', '/var/www', '/opt', '/srv', '/var/log', '/var/serverkit']

    # File extensions that can be edited in browser
    EDITABLE_EXTENSIONS = {
        '.txt', '.md', '.json', '.xml', '.yml', '.yaml', '.ini', '.conf', '.cfg',
        '.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.less', '.scss',
        '.php', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.sh', '.bash',
        '.sql', '.env', '.htaccess', '.gitignore', '.dockerfile', '.toml'
    }

    # Maximum file size for editing (5MB)
    MAX_EDIT_SIZE = 5 * 1024 * 1024

    # Maximum file size for upload (100MB)
    MAX_UPLOAD_SIZE = 100 * 1024 * 1024

    @classmethod
    def is_path_allowed(cls, path: str) -> bool:
        """Check if path is within allowed directories."""
        try:
            real_path = os.path.realpath(path)
            return any(real_path.startswith(root) for root in cls.ALLOWED_ROOTS)
        except (ValueError, OSError):
            return False

    @classmethod
    def get_file_info(cls, path: str) -> Optional[Dict]:
        """Get detailed information about a file or directory."""
        try:
            if not os.path.exists(path):
                return None

            stat_info = os.stat(path)
            is_dir = os.path.isdir(path)

            # Get owner and group names
            try:
                if pwd:
                    owner = pwd.getpwuid(stat_info.st_uid).pw_name
                else:
                    owner = str(stat_info.st_uid)
            except (KeyError, AttributeError, TypeError):
                owner = str(stat_info.st_uid)

            try:
                if grp:
                    group = grp.getgrgid(stat_info.st_gid).gr_name
                else:
                    group = str(stat_info.st_gid)
            except (KeyError, AttributeError, TypeError):
                group = str(stat_info.st_gid)

            # Get permissions string
            mode = stat_info.st_mode
            perms = stat.filemode(mode)

            # Get MIME type for files
            mime_type = None
            if not is_dir:
                mime_type, _ = mimetypes.guess_type(path)

            return {
                'name': os.path.basename(path),
                'path': path,
                'is_dir': is_dir,
                'is_file': not is_dir,
                'is_link': os.path.islink(path),
                'size': stat_info.st_size if not is_dir else cls._get_dir_size(path),
                'size_human': cls._format_size(stat_info.st_size),
                'modified': datetime.fromtimestamp(stat_info.st_mtime).isoformat(),
                'created': datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
                'accessed': datetime.fromtimestamp(stat_info.st_atime).isoformat(),
                'permissions': perms,
                'permissions_octal': oct(mode)[-3:],
                'owner': owner,
                'group': group,
                'mime_type': mime_type,
                'is_editable': cls._is_editable(path),
                'is_readable': os.access(path, os.R_OK),
                'is_writable': os.access(path, os.W_OK),
                'is_executable': os.access(path, os.X_OK),
            }
        except (OSError, PermissionError) as e:
            return {'error': str(e), 'path': path}

    @classmethod
    def list_directory(cls, path: str, show_hidden: bool = False) -> Dict:
        """List contents of a directory."""
        if not cls.is_path_allowed(path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(path):
            return {'success': False, 'error': 'Directory not found'}

        if not os.path.isdir(path):
            return {'success': False, 'error': 'Not a directory'}

        try:
            entries = []
            for name in os.listdir(path):
                if not show_hidden and name.startswith('.'):
                    continue

                full_path = os.path.join(path, name)
                info = cls.get_file_info(full_path)
                if info:
                    entries.append(info)

            # Sort: directories first, then by name
            entries.sort(key=lambda x: (not x.get('is_dir', False), x.get('name', '').lower()))

            # Get parent directory
            parent = os.path.dirname(path)
            if not cls.is_path_allowed(parent):
                parent = None

            return {
                'success': True,
                'path': path,
                'parent': parent,
                'entries': entries,
                'total': len(entries)
            }
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def read_file(cls, path: str) -> Dict:
        """Read file contents."""
        if not cls.is_path_allowed(path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(path):
            return {'success': False, 'error': 'File not found'}

        if os.path.isdir(path):
            return {'success': False, 'error': 'Cannot read directory'}

        try:
            size = os.path.getsize(path)
            if size > cls.MAX_EDIT_SIZE:
                return {
                    'success': False,
                    'error': f'File too large to edit ({cls._format_size(size)}). Maximum is {cls._format_size(cls.MAX_EDIT_SIZE)}'
                }

            # Try to read as text
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                return {
                    'success': True,
                    'path': path,
                    'content': content,
                    'encoding': 'utf-8',
                    'size': size,
                    'is_binary': False
                }
            except UnicodeDecodeError:
                # File is binary
                return {
                    'success': False,
                    'error': 'Binary file cannot be edited',
                    'is_binary': True
                }

        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def write_file(cls, path: str, content: str, create_backup: bool = True) -> Dict:
        """Write content to file."""
        if not cls.is_path_allowed(path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        try:
            # Create backup if file exists
            if create_backup and os.path.exists(path):
                backup_path = f"{path}.bak"
                shutil.copy2(path, backup_path)

            # Write file
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)

            return {
                'success': True,
                'path': path,
                'size': len(content.encode('utf-8'))
            }
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def create_file(cls, path: str, content: str = '') -> Dict:
        """Create a new file."""
        if not cls.is_path_allowed(path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if os.path.exists(path):
            return {'success': False, 'error': 'File already exists'}

        try:
            # Ensure parent directory exists
            parent = os.path.dirname(path)
            if not os.path.exists(parent):
                os.makedirs(parent)

            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)

            return {'success': True, 'path': path}
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def create_directory(cls, path: str) -> Dict:
        """Create a new directory."""
        if not cls.is_path_allowed(path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if os.path.exists(path):
            return {'success': False, 'error': 'Directory already exists'}

        try:
            os.makedirs(path)
            return {'success': True, 'path': path}
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete(cls, path: str) -> Dict:
        """Delete a file or directory."""
        if not cls.is_path_allowed(path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(path):
            return {'success': False, 'error': 'Path not found'}

        try:
            if os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
            return {'success': True, 'path': path}
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def rename(cls, old_path: str, new_name: str) -> Dict:
        """Rename a file or directory."""
        if not cls.is_path_allowed(old_path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(old_path):
            return {'success': False, 'error': 'Path not found'}

        new_path = os.path.join(os.path.dirname(old_path), new_name)

        if not cls.is_path_allowed(new_path):
            return {'success': False, 'error': 'Access denied: target path not allowed'}

        if os.path.exists(new_path):
            return {'success': False, 'error': 'Target already exists'}

        try:
            os.rename(old_path, new_path)
            return {'success': True, 'old_path': old_path, 'new_path': new_path}
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def copy(cls, src_path: str, dest_path: str) -> Dict:
        """Copy a file or directory."""
        if not cls.is_path_allowed(src_path) or not cls.is_path_allowed(dest_path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(src_path):
            return {'success': False, 'error': 'Source not found'}

        if os.path.exists(dest_path):
            return {'success': False, 'error': 'Destination already exists'}

        try:
            if os.path.isdir(src_path):
                shutil.copytree(src_path, dest_path)
            else:
                shutil.copy2(src_path, dest_path)
            return {'success': True, 'src': src_path, 'dest': dest_path}
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def move(cls, src_path: str, dest_path: str) -> Dict:
        """Move a file or directory."""
        if not cls.is_path_allowed(src_path) or not cls.is_path_allowed(dest_path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(src_path):
            return {'success': False, 'error': 'Source not found'}

        if os.path.exists(dest_path):
            return {'success': False, 'error': 'Destination already exists'}

        try:
            shutil.move(src_path, dest_path)
            return {'success': True, 'src': src_path, 'dest': dest_path}
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def change_permissions(cls, path: str, mode: str) -> Dict:
        """Change file/directory permissions."""
        if not cls.is_path_allowed(path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(path):
            return {'success': False, 'error': 'Path not found'}

        try:
            # Convert octal string to int
            mode_int = int(mode, 8)
            os.chmod(path, mode_int)
            return {'success': True, 'path': path, 'mode': mode}
        except ValueError:
            return {'success': False, 'error': 'Invalid permission mode'}
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def search(cls, directory: str, pattern: str, max_results: int = 100) -> Dict:
        """Search for files matching pattern."""
        if not cls.is_path_allowed(directory):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.isdir(directory):
            return {'success': False, 'error': 'Directory not found'}

        try:
            results = []
            pattern_lower = pattern.lower()

            for root, dirs, files in os.walk(directory):
                # Skip hidden directories
                dirs[:] = [d for d in dirs if not d.startswith('.')]

                for name in files + dirs:
                    if pattern_lower in name.lower():
                        full_path = os.path.join(root, name)
                        if cls.is_path_allowed(full_path):
                            info = cls.get_file_info(full_path)
                            if info:
                                results.append(info)
                                if len(results) >= max_results:
                                    return {
                                        'success': True,
                                        'results': results,
                                        'truncated': True
                                    }

            return {'success': True, 'results': results, 'truncated': False}
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_disk_usage(cls, path: str) -> Dict:
        """Get disk usage for a path."""
        try:
            # Validate path exists
            if not os.path.exists(path):
                return {'success': False, 'error': 'Path not found'}

            usage = shutil.disk_usage(path)
            return {
                'success': True,
                'path': path,
                'total': usage.total,
                'used': usage.used,
                'free': usage.free,
                'percent': round((usage.used / usage.total) * 100, 1) if usage.total > 0 else 0,
                'total_human': cls._format_size(usage.total),
                'used_human': cls._format_size(usage.used),
                'free_human': cls._format_size(usage.free)
            }
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except (OSError, Exception) as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _is_editable(cls, path: str) -> bool:
        """Check if file can be edited in browser."""
        if os.path.isdir(path):
            return False

        ext = os.path.splitext(path)[1].lower()
        if ext in cls.EDITABLE_EXTENSIONS:
            return os.path.getsize(path) <= cls.MAX_EDIT_SIZE

        # Check if file has no extension but is text
        if not ext:
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    f.read(1024)
                return os.path.getsize(path) <= cls.MAX_EDIT_SIZE
            except (UnicodeDecodeError, PermissionError):
                return False

        return False

    @classmethod
    def _get_dir_size(cls, path: str) -> int:
        """Get total size of directory (non-recursive for performance)."""
        try:
            total = 0
            for entry in os.scandir(path):
                if entry.is_file():
                    total += entry.stat().st_size
            return total
        except (OSError, PermissionError):
            return 0

    @staticmethod
    def _format_size(size: int) -> str:
        """Format size in human-readable format."""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024:
                return f"{size:.1f} {unit}"
            size /= 1024
        return f"{size:.1f} PB"

    @classmethod
    def get_all_disk_mounts(cls) -> Dict:
        """Get disk usage for all mount points."""
        try:
            partitions = psutil.disk_partitions(all=False)
            mounts = []

            for partition in partitions:
                try:
                    usage = psutil.disk_usage(partition.mountpoint)
                    mounts.append({
                        'device': partition.device,
                        'mountpoint': partition.mountpoint,
                        'fstype': partition.fstype,
                        'total': usage.total,
                        'used': usage.used,
                        'free': usage.free,
                        'percent': usage.percent,
                        'total_human': cls._format_size(usage.total),
                        'used_human': cls._format_size(usage.used),
                        'free_human': cls._format_size(usage.free)
                    })
                except (PermissionError, OSError):
                    # Skip mounts we can't access
                    continue

            return {'success': True, 'mounts': mounts}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def analyze_directory_sizes(cls, path: str, depth: int = 1, limit: int = 20) -> Dict:
        """Analyze directory to get sizes of subdirectories and large files."""
        if not cls.is_path_allowed(path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(path):
            return {'success': False, 'error': 'Path not found'}

        if not os.path.isdir(path):
            return {'success': False, 'error': 'Path is not a directory'}

        try:
            entries = []
            total_size = 0

            # Scan directory entries
            with os.scandir(path) as scanner:
                for entry in scanner:
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            # Calculate directory size recursively (with limit)
                            size = cls._get_dir_size_recursive(entry.path, max_depth=depth)
                            entries.append({
                                'name': entry.name,
                                'path': entry.path,
                                'size': size,
                                'size_human': cls._format_size(size),
                                'is_dir': True
                            })
                        else:
                            size = entry.stat().st_size
                            entries.append({
                                'name': entry.name,
                                'path': entry.path,
                                'size': size,
                                'size_human': cls._format_size(size),
                                'is_dir': False
                            })
                        total_size += size
                    except (PermissionError, OSError):
                        continue

            # Sort by size descending
            entries.sort(key=lambda x: x['size'], reverse=True)

            # Calculate percentages
            for entry in entries:
                entry['percent'] = round((entry['size'] / total_size * 100), 1) if total_size > 0 else 0

            # Separate directories and files
            directories = [e for e in entries if e['is_dir']][:limit]
            files = [e for e in entries if not e['is_dir']][:limit]

            return {
                'success': True,
                'path': path,
                'total_size': total_size,
                'total_size_human': cls._format_size(total_size),
                'directories': directories,
                'largest_files': files
            }
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _get_dir_size_recursive(cls, path: str, max_depth: int = 2, current_depth: int = 0) -> int:
        """Get total size of directory recursively with depth limit."""
        if current_depth > max_depth:
            return 0

        total = 0
        try:
            with os.scandir(path) as scanner:
                for entry in scanner:
                    try:
                        if entry.is_file(follow_symlinks=False):
                            total += entry.stat().st_size
                        elif entry.is_dir(follow_symlinks=False):
                            total += cls._get_dir_size_recursive(
                                entry.path, max_depth, current_depth + 1
                            )
                    except (PermissionError, OSError):
                        continue
        except (PermissionError, OSError):
            pass
        return total

    @classmethod
    def get_file_type_breakdown(cls, path: str, max_depth: int = 3) -> Dict:
        """Get breakdown of file sizes by type category."""
        if not cls.is_path_allowed(path):
            return {'success': False, 'error': 'Access denied: path not in allowed directories'}

        if not os.path.exists(path):
            return {'success': False, 'error': 'Path not found'}

        if not os.path.isdir(path):
            return {'success': False, 'error': 'Path is not a directory'}

        # File type categories with extensions
        categories = {
            'images': {
                'extensions': {'.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.ico', '.tiff'},
                'color': '#10b981',  # green
                'size': 0,
                'count': 0
            },
            'videos': {
                'extensions': {'.mp4', '.avi', '.mkv', '.mov', '.wmv', '.flv', '.webm', '.m4v'},
                'color': '#8b5cf6',  # purple
                'size': 0,
                'count': 0
            },
            'audio': {
                'extensions': {'.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a'},
                'color': '#f59e0b',  # amber
                'size': 0,
                'count': 0
            },
            'documents': {
                'extensions': {'.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt'},
                'color': '#3b82f6',  # blue
                'size': 0,
                'count': 0
            },
            'code': {
                'extensions': {'.py', '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.less', '.scss',
                              '.php', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.sh', '.sql'},
                'color': '#6366f1',  # indigo
                'size': 0,
                'count': 0
            },
            'archives': {
                'extensions': {'.zip', '.tar', '.gz', '.rar', '.7z', '.bz2', '.xz', '.tgz'},
                'color': '#ef4444',  # red
                'size': 0,
                'count': 0
            },
            'data': {
                'extensions': {'.json', '.xml', '.yaml', '.yml', '.csv', '.db', '.sqlite', '.sql'},
                'color': '#14b8a6',  # teal
                'size': 0,
                'count': 0
            },
            'other': {
                'extensions': set(),
                'color': '#71717a',  # gray
                'size': 0,
                'count': 0
            }
        }

        try:
            cls._categorize_files_recursive(path, categories, max_depth, 0)

            # Build result array
            breakdown = []
            total_size = sum(cat['size'] for cat in categories.values())

            for name, cat in categories.items():
                if cat['size'] > 0:
                    breakdown.append({
                        'name': name.capitalize(),
                        'size': cat['size'],
                        'size_human': cls._format_size(cat['size']),
                        'count': cat['count'],
                        'color': cat['color'],
                        'percent': round((cat['size'] / total_size * 100), 1) if total_size > 0 else 0
                    })

            # Sort by size descending
            breakdown.sort(key=lambda x: x['size'], reverse=True)

            return {
                'success': True,
                'path': path,
                'total_size': total_size,
                'total_size_human': cls._format_size(total_size),
                'breakdown': breakdown
            }
        except PermissionError:
            return {'success': False, 'error': 'Permission denied'}
        except OSError as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _categorize_files_recursive(cls, path: str, categories: Dict, max_depth: int, current_depth: int) -> None:
        """Recursively categorize files by type."""
        if current_depth > max_depth:
            return

        try:
            with os.scandir(path) as scanner:
                for entry in scanner:
                    try:
                        if entry.is_file(follow_symlinks=False):
                            ext = os.path.splitext(entry.name)[1].lower()
                            size = entry.stat().st_size

                            # Find matching category
                            categorized = False
                            for cat_name, cat in categories.items():
                                if cat_name != 'other' and ext in cat['extensions']:
                                    cat['size'] += size
                                    cat['count'] += 1
                                    categorized = True
                                    break

                            if not categorized:
                                categories['other']['size'] += size
                                categories['other']['count'] += 1

                        elif entry.is_dir(follow_symlinks=False):
                            cls._categorize_files_recursive(
                                entry.path, categories, max_depth, current_depth + 1
                            )
                    except (PermissionError, OSError):
                        continue
        except (PermissionError, OSError):
            pass
