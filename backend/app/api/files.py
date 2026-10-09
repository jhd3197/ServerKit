"""File Manager API endpoints for browsing, editing, and managing files."""

from flask import Blueprint, request, jsonify, send_file
from app.error_reporting import unexpected_response
from app.exceptions import NotFoundError, PermissionDeniedError, ValidationError, permission_denied
from ..middleware.rbac import permission_required
from ..services.file_service import FileService
from ..services.storage_provider_service import StorageProviderService
import os
import tempfile

files_bp = Blueprint('files', __name__)


@files_bp.route('/browse', methods=['GET'])
@permission_required('files', 'read')
def browse_directory():
    """List directory contents."""
    path = request.args.get('path', '/home')
    show_hidden = request.args.get('show_hidden', 'false').lower() == 'true'

    result = FileService.list_directory(path, show_hidden=show_hidden)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/info', methods=['GET'])
@permission_required('files', 'read')
def get_file_info():
    """Get information about a file or directory."""
    path = request.args.get('path')

    if not path:
        raise ValidationError('Path is required')

    if not FileService.is_path_allowed(path):
        raise PermissionDeniedError('Access denied')

    info = FileService.get_file_info(path)

    if not info or 'error' in info:
        raise NotFoundError(info.get('error', 'File not found') if info else 'File not found')
    return jsonify({'success': True, 'file': info}), 200


@files_bp.route('/read', methods=['GET'])
@permission_required('files', 'read')
def read_file():
    """Read file contents."""
    path = request.args.get('path')

    if not path:
        raise ValidationError('Path is required')

    result = FileService.read_file(path)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/write', methods=['POST'])
@permission_required('files', 'write')
def write_file():
    """Write content to a file."""
    data = request.get_json()

    if not data:
        raise ValidationError('Request body is required')

    path = data.get('path')
    content = data.get('content')
    create_backup = data.get('create_backup', True)

    if not path:
        raise ValidationError('Path is required')

    if content is None:
        raise ValidationError('Content is required')

    result = FileService.write_file(path, content, create_backup=create_backup)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/create', methods=['POST'])
@permission_required('files', 'write')
def create_file():
    """Create a new file."""
    data = request.get_json()

    if not data:
        raise ValidationError('Request body is required')

    path = data.get('path')
    content = data.get('content', '')

    if not path:
        raise ValidationError('Path is required')

    result = FileService.create_file(path, content)

    return jsonify({'success': True, **result}), 201


@files_bp.route('/mkdir', methods=['POST'])
@permission_required('files', 'write')
def create_directory():
    """Create a new directory."""
    data = request.get_json()

    if not data:
        raise ValidationError('Request body is required')

    path = data.get('path')

    if not path:
        raise ValidationError('Path is required')

    result = FileService.create_directory(path)

    return jsonify({'success': True, **result}), 201


@files_bp.route('/delete', methods=['DELETE'])
@permission_required('files', 'write')
def delete_path():
    """Delete a file or directory."""
    path = request.args.get('path')

    if not path:
        raise ValidationError('Path is required')

    result = FileService.delete(path)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/rename', methods=['POST'])
@permission_required('files', 'write')
def rename_path():
    """Rename a file or directory."""
    data = request.get_json()

    if not data:
        raise ValidationError('Request body is required')

    path = data.get('path')
    new_name = data.get('new_name')

    if not path or not new_name:
        raise ValidationError('Path and new_name are required')

    result = FileService.rename(path, new_name)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/copy', methods=['POST'])
@permission_required('files', 'write')
def copy_path():
    """Copy a file or directory."""
    data = request.get_json()

    if not data:
        raise ValidationError('Request body is required')

    src = data.get('src')
    dest = data.get('dest')

    if not src or not dest:
        raise ValidationError('Source and destination paths are required')

    result = FileService.copy(src, dest)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/move', methods=['POST'])
@permission_required('files', 'write')
def move_path():
    """Move a file or directory."""
    data = request.get_json()

    if not data:
        raise ValidationError('Request body is required')

    src = data.get('src')
    dest = data.get('dest')

    if not src or not dest:
        raise ValidationError('Source and destination paths are required')

    result = FileService.move(src, dest)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/chmod', methods=['POST'])
@permission_required('files', 'write')
def change_permissions():
    """Change file/directory permissions."""
    data = request.get_json()

    if not data:
        raise ValidationError('Request body is required')

    path = data.get('path')
    mode = data.get('mode')

    if not path or not mode:
        raise ValidationError('Path and mode are required')

    result = FileService.change_permissions(path, mode)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/search', methods=['GET'])
@permission_required('files', 'read')
def search_files():
    """Search for files matching a pattern."""
    directory = request.args.get('directory', '/home')
    pattern = request.args.get('pattern')
    max_results = request.args.get('max_results', 100, type=int)

    if not pattern:
        raise ValidationError('Search pattern is required')

    result = FileService.search(directory, pattern, max_results=max_results)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/disk-usage', methods=['GET'])
@permission_required('files', 'read')
def get_disk_usage():
    """Get disk usage for a path."""
    path = request.args.get('path', '/')

    result = FileService.get_disk_usage(path)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/disk-mounts', methods=['GET'])
@permission_required('files', 'read')
def get_disk_mounts():
    """Get disk usage for all mount points."""
    result = FileService.get_all_disk_mounts()

    return jsonify({'success': True, **result}), 200


@files_bp.route('/analyze', methods=['GET'])
@permission_required('files', 'read')
def analyze_directory():
    """Analyze directory sizes."""
    path = request.args.get('path', '/home')
    depth = request.args.get('depth', 2, type=int)
    limit = request.args.get('limit', 20, type=int)

    result = FileService.analyze_directory_sizes(path, depth=depth, limit=limit)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/type-breakdown', methods=['GET'])
@permission_required('files', 'read')
def get_type_breakdown():
    """Get file type breakdown for a directory."""
    path = request.args.get('path', '/home')
    max_depth = request.args.get('max_depth', 3, type=int)

    result = FileService.get_file_type_breakdown(path, max_depth=max_depth)

    return jsonify({'success': True, **result}), 200


@files_bp.route('/download', methods=['GET'])
@permission_required('files', 'read')
def download_file():
    """Download a file."""
    path = request.args.get('path')

    if not path:
        raise ValidationError('Path is required')

    if not FileService.is_path_allowed(path):
        raise permission_denied()

    if not os.path.exists(path):
        return jsonify({'error': 'File not found'}), 404

    if os.path.isdir(path):
        return jsonify({'error': 'Cannot download directory'}), 400

    try:
        return send_file(
            path,
            as_attachment=True,
            download_name=os.path.basename(path)
        )
    except Exception as e:  # noqa: BLE001 - reported, not swallowed
        return unexpected_response(e)


@files_bp.route('/upload', methods=['POST'])
@permission_required('files', 'write')
def upload_file():
    """Upload a file."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    destination = request.form.get('destination')

    if not destination:
        raise ValidationError('Destination path is required')

    # Upload writes straight to disk without going through FileService's
    # mutating methods, so it has to repeat the writable check itself.
    if not FileService.is_path_writable(destination):
        raise permission_denied()

    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    # Check file size
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)

    if size > FileService.MAX_UPLOAD_SIZE:
        return jsonify({
            'error': f'File too large. Maximum size is {FileService._format_size(FileService.MAX_UPLOAD_SIZE)}'
        }), 400

    try:
        # Determine full path
        if os.path.isdir(destination):
            full_path = os.path.join(destination, file.filename)
        else:
            full_path = destination

        if not FileService.is_path_writable(full_path):
            return jsonify({'error': 'Access denied'}), 403

        # Ensure parent directory exists
        parent = os.path.dirname(full_path)
        if not os.path.exists(parent):
            os.makedirs(parent)

        # Save file
        file.save(full_path)

        return jsonify({
            'success': True,
            'path': full_path,
            'size': size
        }), 201

    except PermissionError:
        return jsonify({'error': 'Permission denied'}), 403
    except Exception as e:  # noqa: BLE001 - reported, not swallowed
        return unexpected_response(e)


# ── S3 / object-storage browser (reuses the configured backup storage creds) ──

@files_bp.route('/s3/browse', methods=['GET'])
@permission_required('files', 'read')
def s3_browse():
    """List a bucket prefix in the same entry shape as the local browser."""
    path = request.args.get('path', '/')
    result = StorageProviderService.s3_browse(path)
    return jsonify(result), 200 if result.get('success') else 400


@files_bp.route('/s3/read', methods=['GET'])
@permission_required('files', 'read')
def s3_read():
    """Read a text object for in-app editing."""
    path = request.args.get('path')
    if not path:
        raise ValidationError('Path is required')
    result = StorageProviderService.s3_read(path)
    return jsonify(result), 200 if result.get('success') else 400


@files_bp.route('/s3/write', methods=['POST'])
@permission_required('files', 'write')
def s3_write():
    """Write (create or overwrite) an object from text content."""
    data = request.get_json() or {}
    path = data.get('path')
    content = data.get('content')
    if not path:
        raise ValidationError('Path is required')
    if content is None:
        raise ValidationError('Content is required')
    result = StorageProviderService.s3_write(path, content)
    return jsonify(result), 200 if result.get('success') else 400


@files_bp.route('/s3/delete', methods=['DELETE'])
@permission_required('files', 'write')
def s3_delete():
    """Delete an object (or every object beneath a prefix)."""
    path = request.args.get('path')
    if not path:
        raise ValidationError('Path is required')
    result = StorageProviderService.s3_delete(path)
    return jsonify(result), 200 if result.get('success') else 400


@files_bp.route('/s3/download-url', methods=['GET'])
@permission_required('files', 'read')
def s3_download_url():
    """Return a short-lived presigned URL the browser can download directly."""
    path = request.args.get('path')
    if not path:
        raise ValidationError('Path is required')
    result = StorageProviderService.s3_presigned_get(path)
    return jsonify(result), 200 if result.get('success') else 400


@files_bp.route('/s3/upload', methods=['POST'])
@permission_required('files', 'write')
def s3_upload():
    """Upload a file into the bucket at the given prefix."""
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    file = request.files['file']
    destination = request.form.get('destination', '/')
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    result = StorageProviderService.s3_upload(destination, file.filename, file.stream)
    return jsonify(result), 201 if result.get('success') else 400
