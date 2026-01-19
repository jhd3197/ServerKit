"""File Manager API endpoints for browsing, editing, and managing files."""

from flask import Blueprint, request, jsonify, send_file
from flask_jwt_extended import jwt_required
from ..services.file_service import FileService
import os
import tempfile

files_bp = Blueprint('files', __name__)


@files_bp.route('/browse', methods=['GET'])
@jwt_required()
def browse_directory():
    """List directory contents."""
    path = request.args.get('path', '/home')
    show_hidden = request.args.get('show_hidden', 'false').lower() == 'true'

    result = FileService.list_directory(path, show_hidden=show_hidden)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@files_bp.route('/info', methods=['GET'])
@jwt_required()
def get_file_info():
    """Get information about a file or directory."""
    path = request.args.get('path')

    if not path:
        return jsonify({'success': False, 'error': 'Path is required'}), 400

    if not FileService.is_path_allowed(path):
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    info = FileService.get_file_info(path)

    if info and 'error' not in info:
        return jsonify({'success': True, 'file': info}), 200

    error = info.get('error', 'File not found') if info else 'File not found'
    return jsonify({'success': False, 'error': error}), 404


@files_bp.route('/read', methods=['GET'])
@jwt_required()
def read_file():
    """Read file contents."""
    path = request.args.get('path')

    if not path:
        return jsonify({'success': False, 'error': 'Path is required'}), 400

    result = FileService.read_file(path)

    if result.get('success'):
        return jsonify(result), 200

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/write', methods=['POST'])
@jwt_required()
def write_file():
    """Write content to a file."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body is required'}), 400

    path = data.get('path')
    content = data.get('content')
    create_backup = data.get('create_backup', True)

    if not path:
        return jsonify({'success': False, 'error': 'Path is required'}), 400

    if content is None:
        return jsonify({'success': False, 'error': 'Content is required'}), 400

    result = FileService.write_file(path, content, create_backup=create_backup)

    if result.get('success'):
        return jsonify(result), 200

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/create', methods=['POST'])
@jwt_required()
def create_file():
    """Create a new file."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body is required'}), 400

    path = data.get('path')
    content = data.get('content', '')

    if not path:
        return jsonify({'success': False, 'error': 'Path is required'}), 400

    result = FileService.create_file(path, content)

    if result.get('success'):
        return jsonify(result), 201

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/mkdir', methods=['POST'])
@jwt_required()
def create_directory():
    """Create a new directory."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body is required'}), 400

    path = data.get('path')

    if not path:
        return jsonify({'success': False, 'error': 'Path is required'}), 400

    result = FileService.create_directory(path)

    if result.get('success'):
        return jsonify(result), 201

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/delete', methods=['DELETE'])
@jwt_required()
def delete_path():
    """Delete a file or directory."""
    path = request.args.get('path')

    if not path:
        return jsonify({'success': False, 'error': 'Path is required'}), 400

    result = FileService.delete(path)

    if result.get('success'):
        return jsonify(result), 200

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/rename', methods=['POST'])
@jwt_required()
def rename_path():
    """Rename a file or directory."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body is required'}), 400

    path = data.get('path')
    new_name = data.get('new_name')

    if not path or not new_name:
        return jsonify({'success': False, 'error': 'Path and new_name are required'}), 400

    result = FileService.rename(path, new_name)

    if result.get('success'):
        return jsonify(result), 200

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/copy', methods=['POST'])
@jwt_required()
def copy_path():
    """Copy a file or directory."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body is required'}), 400

    src = data.get('src')
    dest = data.get('dest')

    if not src or not dest:
        return jsonify({'success': False, 'error': 'Source and destination paths are required'}), 400

    result = FileService.copy(src, dest)

    if result.get('success'):
        return jsonify(result), 200

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/move', methods=['POST'])
@jwt_required()
def move_path():
    """Move a file or directory."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body is required'}), 400

    src = data.get('src')
    dest = data.get('dest')

    if not src or not dest:
        return jsonify({'success': False, 'error': 'Source and destination paths are required'}), 400

    result = FileService.move(src, dest)

    if result.get('success'):
        return jsonify(result), 200

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/chmod', methods=['POST'])
@jwt_required()
def change_permissions():
    """Change file/directory permissions."""
    data = request.get_json()

    if not data:
        return jsonify({'success': False, 'error': 'Request body is required'}), 400

    path = data.get('path')
    mode = data.get('mode')

    if not path or not mode:
        return jsonify({'success': False, 'error': 'Path and mode are required'}), 400

    result = FileService.change_permissions(path, mode)

    if result.get('success'):
        return jsonify(result), 200

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/search', methods=['GET'])
@jwt_required()
def search_files():
    """Search for files matching a pattern."""
    directory = request.args.get('directory', '/home')
    pattern = request.args.get('pattern')
    max_results = request.args.get('max_results', 100, type=int)

    if not pattern:
        return jsonify({'success': False, 'error': 'Search pattern is required'}), 400

    result = FileService.search(directory, pattern, max_results=max_results)

    if result.get('success'):
        return jsonify(result), 200

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/disk-usage', methods=['GET'])
@jwt_required()
def get_disk_usage():
    """Get disk usage for a path."""
    path = request.args.get('path', '/')

    result = FileService.get_disk_usage(path)

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@files_bp.route('/disk-mounts', methods=['GET'])
@jwt_required()
def get_disk_mounts():
    """Get disk usage for all mount points."""
    result = FileService.get_all_disk_mounts()

    if result.get('success'):
        return jsonify(result), 200
    return jsonify(result), 400


@files_bp.route('/analyze', methods=['GET'])
@jwt_required()
def analyze_directory():
    """Analyze directory sizes."""
    path = request.args.get('path', '/home')
    depth = request.args.get('depth', 2, type=int)
    limit = request.args.get('limit', 20, type=int)

    result = FileService.analyze_directory_sizes(path, depth=depth, limit=limit)

    if result.get('success'):
        return jsonify(result), 200

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/type-breakdown', methods=['GET'])
@jwt_required()
def get_type_breakdown():
    """Get file type breakdown for a directory."""
    path = request.args.get('path', '/home')
    max_depth = request.args.get('max_depth', 3, type=int)

    result = FileService.get_file_type_breakdown(path, max_depth=max_depth)

    if result.get('success'):
        return jsonify(result), 200

    status = 403 if 'denied' in result.get('error', '').lower() else 400
    return jsonify(result), status


@files_bp.route('/download', methods=['GET'])
@jwt_required()
def download_file():
    """Download a file."""
    path = request.args.get('path')

    if not path:
        return jsonify({'success': False, 'error': 'Path is required'}), 400

    if not FileService.is_path_allowed(path):
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    if not os.path.exists(path):
        return jsonify({'success': False, 'error': 'File not found'}), 404

    if os.path.isdir(path):
        return jsonify({'success': False, 'error': 'Cannot download directory'}), 400

    try:
        return send_file(
            path,
            as_attachment=True,
            download_name=os.path.basename(path)
        )
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@files_bp.route('/upload', methods=['POST'])
@jwt_required()
def upload_file():
    """Upload a file."""
    if 'file' not in request.files:
        return jsonify({'success': False, 'error': 'No file provided'}), 400

    file = request.files['file']
    destination = request.form.get('destination')

    if not destination:
        return jsonify({'success': False, 'error': 'Destination path is required'}), 400

    if not FileService.is_path_allowed(destination):
        return jsonify({'success': False, 'error': 'Access denied'}), 403

    if file.filename == '':
        return jsonify({'success': False, 'error': 'No file selected'}), 400

    # Check file size
    file.seek(0, 2)
    size = file.tell()
    file.seek(0)

    if size > FileService.MAX_UPLOAD_SIZE:
        return jsonify({
            'success': False,
            'error': f'File too large. Maximum size is {FileService._format_size(FileService.MAX_UPLOAD_SIZE)}'
        }), 400

    try:
        # Determine full path
        if os.path.isdir(destination):
            full_path = os.path.join(destination, file.filename)
        else:
            full_path = destination

        if not FileService.is_path_allowed(full_path):
            return jsonify({'success': False, 'error': 'Access denied'}), 403

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
        return jsonify({'success': False, 'error': 'Permission denied'}), 403
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
