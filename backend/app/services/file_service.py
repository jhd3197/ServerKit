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

from app import paths
from app.exceptions import (
    ConflictError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)
from app.utils.formatting import format_bytes


def _install_roots(install_dir: str) -> List[str]:
    """*install_dir* plus its blue/green sibling when it is an update slot.

    Updates install into the idle slot (``/opt/serverkit-a`` / ``-b``) and
    flip the ``/opt/serverkit`` symlink, so the previous version — with its
    own ``.env`` and JWT key — stays on disk next to the running one.
    Protecting only the running slot leaves that copy readable.
    """
    roots = [install_dir]
    parent, name = os.path.split(install_dir)
    if name.endswith(('-a', '-b')):
        base = name[:-2]
        roots += [os.path.join(parent, f'{base}-{s}') for s in ('a', 'b')
                  if f'{base}-{s}' != name]
    return roots


class FileService:
    """Service for file system operations."""

    # Allowed root directories for browsing (security). Reachability is gated
    # here; mutation is gated again by READ_ONLY_ROOTS below, by the
    # files.write RBAC permission, and by the OS's own permissions.
    # /etc/nginx backs the File Manager's "Web config" shortcut; it is only
    # this subtree, not /etc — panel-internal paths stay blocked by
    # PROTECTED_ROOTS below regardless (GHSA-rm3m-9mvw-68fh).
    ALLOWED_ROOTS = ['/home', '/var/www', '/opt', '/srv', '/var/log', '/etc/nginx', paths.SERVERKIT_DIR]

    # Roots that may be browsed and read but never modified through the file
    # manager. Reading the effective nginx configuration is the point of the
    # "Web config" shortcut; hand-editing it from here is not. The panel
    # generates these vhosts itself, so a manual edit is overwritten without
    # warning on the next domain change, and an editable /etc/nginx would hand
    # anyone holding files.write a root-owned config that the panel itself
    # reloads. Config changes belong to the nginx/domain surfaces, which
    # regenerate and validate. Order matters: a read-only root only takes
    # effect while it is also inside ALLOWED_ROOTS.
    READ_ONLY_ROOTS = ['/etc/nginx']

    # Panel-internal directories that must NEVER be reachable through the file
    # manager, for any role. The backend .env (JWT_SECRET_KEY, encryption key,
    # DB creds), the SQLite instance dir and the generated deploy config all
    # live here; on the documented install.sh layout the install dir sits under
    # the allowed root /opt, so without this exclusion any user with files.read
    # (including the default viewer role) could read the panel's own secrets
    # and forge admin sessions (GHSA-rm3m-9mvw-68fh).
    # __file__ = <install>/backend/app/services/file_service.py — two levels up
    # is the backend dir, three is the install root. Getting this wrong by one
    # level silently un-protects <install>/.env and frontend/dist.
    _BACKEND_DIR = os.path.realpath(
        os.path.join(os.path.dirname(__file__), '..', '..'))
    _INSTALL_DIR = os.path.realpath(os.path.join(_BACKEND_DIR, '..'))
    PROTECTED_ROOTS = [
        *_install_roots(_INSTALL_DIR),
        _BACKEND_DIR,  # covers flat layouts (e.g. code at /app, install=/ inert)
        os.path.realpath(paths.SERVERKIT_CONFIG_DIR),
    ]

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
        """Check if path is within allowed directories and not panel-internal."""
        try:
            real_path = os.path.realpath(path)
            if any(real_path == root or real_path.startswith(root + os.sep)
                   for root in cls.PROTECTED_ROOTS):
                return False
            return any(real_path == root or real_path.startswith(root + os.sep)
                       for root in cls.ALLOWED_ROOTS)
        except (ValueError, OSError):
            return False

    @classmethod
    def is_path_readonly(cls, path: str) -> bool:
        """True when *path* sits inside a browse-but-don't-touch root."""
        try:
            real_path = os.path.realpath(path)
        except (ValueError, OSError):
            return True
        return any(real_path == root or real_path.startswith(root + os.sep)
                   for root in cls.READ_ONLY_ROOTS)

    @classmethod
    def is_path_writable(cls, path: str) -> bool:
        """Allowed *and* not read-only. Every mutating operation gates on this
        rather than on is_path_allowed, so adding a root to READ_ONLY_ROOTS is
        enough to make the whole write surface refuse it."""
        return cls.is_path_allowed(path) and not cls.is_path_readonly(path)

    # Denial reasons, kept identical in shape to the pre-existing messages so
    # the frontend's error rendering is unchanged.
    _DENIED = 'Access denied: path not in allowed directories'
    _READONLY = ('Access denied: this location is read-only in the file '
                 'manager — edit it through the panel surface that owns it')

    @classmethod
    def _require_allowed(cls, path: str) -> None:
        """Raise unless *path* is inside an allowed root."""
        if not cls.is_path_allowed(path):
            raise PermissionDeniedError(cls._DENIED)

    @classmethod
    def _require_no_protected_inside(cls, path: str) -> None:
        """Raise when a protected root sits inside *path*. The path checks only
        look at the path itself, so copying, moving or deleting a parent such
        as /opt would otherwise carry the panel's .env along with it."""
        try:
            real_path = os.path.realpath(path)
        except (ValueError, OSError):
            raise PermissionDeniedError(cls._DENIED)
        prefix = real_path.rstrip(os.sep) + os.sep
        if any(root.startswith(prefix) for root in cls.PROTECTED_ROOTS):
            raise PermissionDeniedError(cls._DENIED)

    @classmethod
    def _require_writable(cls, path: str) -> None:
        """Raise unless a mutating operation may touch *path*."""
        cls._require_allowed(path)
        if cls.is_path_readonly(path):
            raise PermissionDeniedError(cls._READONLY)

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
            raise PermissionDeniedError(cls._DENIED)

        if not os.path.exists(path):
            raise NotFoundError('Directory not found')

        if not os.path.isdir(path):
            raise ValidationError('Not a directory')

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
                'path': path,
                'parent': parent,
                'entries': entries,
                'total': len(entries)
            }
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def read_file(cls, path: str) -> Dict:
        """Read file contents."""
        if not cls.is_path_allowed(path):
            raise PermissionDeniedError(cls._DENIED)

        if not os.path.exists(path):
            raise NotFoundError('File not found')

        if os.path.isdir(path):
            raise ValidationError('Cannot read directory')

        try:
            size = os.path.getsize(path)
            if size > cls.MAX_EDIT_SIZE:
                raise ValidationError(
                    f'File too large to edit ({cls._format_size(size)}). '
                    f'Maximum is {cls._format_size(cls.MAX_EDIT_SIZE)}')

            # Try to read as text
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    content = f.read()
                return {
                    'path': path,
                    'content': content,
                    'encoding': 'utf-8',
                    'size': size,
                    'is_binary': False
                }
            except UnicodeDecodeError as e:
                raise ValidationError('Binary file cannot be edited',
                                      details={'is_binary': True}) from e

        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def write_file(cls, path: str, content: str, create_backup: bool = True) -> Dict:
        """Write content to file."""
        cls._require_writable(path)

        try:
            # Create backup if file exists
            if create_backup and os.path.exists(path):
                backup_path = f"{path}.bak"
                shutil.copy2(path, backup_path)

            # Write file
            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)

            return {
                'path': path,
                'size': len(content.encode('utf-8'))
            }
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def create_file(cls, path: str, content: str = '') -> Dict:
        """Create a new file."""
        cls._require_writable(path)

        if os.path.exists(path):
            raise ConflictError('File already exists')

        try:
            # Ensure parent directory exists
            parent = os.path.dirname(path)
            if not os.path.exists(parent):
                os.makedirs(parent)

            with open(path, 'w', encoding='utf-8') as f:
                f.write(content)

            return {'path': path}
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def create_directory(cls, path: str) -> Dict:
        """Create a new directory."""
        cls._require_writable(path)

        if os.path.exists(path):
            raise ConflictError('Directory already exists')

        try:
            os.makedirs(path)
            return {'path': path}
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def delete(cls, path: str) -> Dict:
        """Delete a file or directory."""
        cls._require_writable(path)
        cls._require_no_protected_inside(path)

        if not os.path.exists(path):
            raise NotFoundError('Path not found')

        try:
            if os.path.isdir(path):
                shutil.rmtree(path)
            else:
                os.remove(path)
            return {'path': path}
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def rename(cls, old_path: str, new_name: str) -> Dict:
        """Rename a file or directory."""
        cls._require_writable(old_path)
        cls._require_no_protected_inside(old_path)

        if not os.path.exists(old_path):
            raise NotFoundError('Path not found')

        # Validate new_name has no path separators
        if '/' in new_name or '\\' in new_name or '..' in new_name:
            raise ValidationError('Invalid filename: path separators not allowed')

        new_path = os.path.join(os.path.dirname(old_path), new_name)

        # Re-validate the constructed path
        if not cls.is_path_writable(new_path):
            raise PermissionDeniedError('Access denied: target path not allowed')

        if os.path.exists(new_path):
            raise ConflictError('Target already exists')

        try:
            os.rename(old_path, new_path)
            return {'old_path': old_path, 'new_path': new_path}
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def copy(cls, src_path: str, dest_path: str) -> Dict:
        """Copy a file or directory."""
        # The source is only read, so copying *out* of a read-only root (e.g.
        # taking a vhost off /etc/nginx to keep) is allowed; the destination
        # is written, so it gets the full check.
        if not cls.is_path_allowed(src_path):
            raise PermissionDeniedError(cls._DENIED)
        cls._require_no_protected_inside(src_path)
        cls._require_writable(dest_path)

        if not os.path.exists(src_path):
            raise NotFoundError('Source not found')

        if os.path.exists(dest_path):
            raise ConflictError('Destination already exists')

        try:
            if os.path.isdir(src_path):
                # Links stay links: following one would copy whatever it
                # points at, protected roots included.
                shutil.copytree(src_path, dest_path, symlinks=True)
            else:
                shutil.copy2(src_path, dest_path)
            return {'src': src_path, 'dest': dest_path}
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def move(cls, src_path: str, dest_path: str) -> Dict:
        """Move a file or directory."""
        # A move removes the source, so unlike copy both ends must be writable.
        for candidate in (src_path, dest_path):
            cls._require_writable(candidate)
        cls._require_no_protected_inside(src_path)

        if not os.path.exists(src_path):
            raise NotFoundError('Source not found')

        if os.path.exists(dest_path):
            raise ConflictError('Destination already exists')

        try:
            shutil.move(src_path, dest_path)
            return {'src': src_path, 'dest': dest_path}
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def change_permissions(cls, path: str, mode: str) -> Dict:
        """Change file/directory permissions."""
        cls._require_writable(path)

        if not os.path.exists(path):
            raise NotFoundError('Path not found')

        # Convert octal string to int (parsed outside the chmod try so a
        # ValidationError below is never re-caught as a generic ValueError).
        try:
            mode_int = int(mode, 8)
        except ValueError as e:
            raise ValidationError('Invalid permission mode') from e
        if mode_int < 0o000 or mode_int > 0o777:
            raise ValidationError('Invalid permission mode. Must be between 000 and 777.')

        try:
            os.chmod(path, mode_int)
            return {'path': path, 'mode': mode}
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def search(cls, directory: str, pattern: str, max_results: int = 100) -> Dict:
        """Search for files matching pattern."""
        if not cls.is_path_allowed(directory):
            raise PermissionDeniedError(cls._DENIED)

        if not os.path.isdir(directory):
            raise NotFoundError('Directory not found')

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
                                        'results': results,
                                        'truncated': True
                                    }

            return {'results': results, 'truncated': False}
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def get_disk_usage(cls, path: str) -> Dict:
        """Get disk usage for a path."""
        try:
            # Validate path exists
            if not os.path.exists(path):
                raise NotFoundError('Path not found')

            usage = shutil.disk_usage(path)
            return {
                'path': path,
                'total': usage.total,
                'used': usage.used,
                'free': usage.free,
                'percent': round((usage.used / usage.total) * 100, 1) if usage.total > 0 else 0,
                'total_human': cls._format_size(usage.total),
                'used_human': cls._format_size(usage.used),
                'free_human': cls._format_size(usage.free)
            }
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

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
        return format_bytes(size, suffix_sep=' ')

    # Virtual/pseudo filesystem types to hide from disk usage
    _VIRTUAL_FSTYPES = {
        'squashfs', 'tmpfs', 'devtmpfs', 'devfs', 'overlay', 'aufs',
        'proc', 'sysfs', 'cgroup', 'cgroup2', 'debugfs', 'tracefs',
        'securityfs', 'pstore', 'efivarfs', 'bpf', 'fusectl',
        'configfs', 'hugetlbfs', 'mqueue', 'ramfs', 'nsfs',
    }

    # Mount-point prefixes that are always noise
    _SKIP_MOUNT_PREFIXES = ('/snap/', '/var/lib/docker/', '/run/')

    @classmethod
    def get_all_disk_mounts(cls) -> Dict:
        """Get disk usage for all physical mount points, deduplicated by device."""
        try:
            partitions = psutil.disk_partitions(all=False)
            mounts = []
            seen_devices = set()

            for partition in partitions:
                # Skip virtual/pseudo filesystems
                if partition.fstype in cls._VIRTUAL_FSTYPES:
                    continue
                # Skip noisy mount prefixes (snaps, docker layers, etc.)
                if any(partition.mountpoint.startswith(p) for p in cls._SKIP_MOUNT_PREFIXES):
                    continue
                # Deduplicate: keep only the shortest mount path per device
                if partition.device in seen_devices:
                    continue
                seen_devices.add(partition.device)

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

            return {'mounts': mounts}
        except (PermissionError, OSError) as e:
            raise ValidationError(str(e), code='filesystem_error') from e

    @classmethod
    def analyze_directory_sizes(cls, path: str, depth: int = 1, limit: int = 20) -> Dict:
        """Analyze directory to get sizes of subdirectories and large files."""
        if not cls.is_path_allowed(path):
            raise PermissionDeniedError(cls._DENIED)

        if not os.path.exists(path):
            raise NotFoundError('Path not found')

        if not os.path.isdir(path):
            raise ValidationError('Path is not a directory')

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
                'path': path,
                'total_size': total_size,
                'total_size_human': cls._format_size(total_size),
                'directories': directories,
                'largest_files': files
            }
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

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
            raise PermissionDeniedError(cls._DENIED)

        if not os.path.exists(path):
            raise NotFoundError('Path not found')

        if not os.path.isdir(path):
            raise ValidationError('Path is not a directory')

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
                'path': path,
                'total_size': total_size,
                'total_size_human': cls._format_size(total_size),
                'breakdown': breakdown
            }
        except PermissionError as e:
            raise PermissionDeniedError('Permission denied') from e
        except OSError as e:
            raise ValidationError(str(e), code='filesystem_error') from e

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
