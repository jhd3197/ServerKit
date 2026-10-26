"""Agent install scripts, agent updates and fleet rollout routes.

Registered on the shared ``servers_bp`` blueprint (see app.api.servers)."""
import os
import re
import requests
from app.models.server import AgentVersion, Server
from flask import Response, current_app, jsonify, redirect, request
from app.middleware.rbac import admin_required, developer_required
from app.exceptions import agent_offline, field_required
from app.services.agent_registry import agent_registry
from datetime import datetime, timedelta
from app import db
from app.services.discovery_service import discovery_service
from app.services.remote_command_dispatcher import dispatch_agent_command
from app.services.agent_fleet_service import fleet_service
from flask_jwt_extended import get_jwt_identity, jwt_required
from app.api._request import json_object
from app.api.servers import _get_external_base_url, _get_operable_server, servers_bp


# ==================== Installation Scripts ====================

def _get_scripts_dir():
    """Resolve the directory holding the fleet-agent installer scripts.

    Every shipped layout has to land on a real directory here:

    * git checkout / release tarball -> ``<tree root>/scripts``
    * Docker image                   -> ``/app/scripts``, which exists only
      because the Dockerfile explicitly copies the two installers there.

    ``SERVERKIT_SCRIPTS_DIR`` overrides the guess for layouts that split the
    backend away from the rest of the tree.
    """
    override = os.environ.get('SERVERKIT_SCRIPTS_DIR')
    if override:
        return override
    # Go up from backend/app/api to backend, then to scripts
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    return os.path.join(base_dir, 'scripts')


def _load_installer(filename):
    """Read an agent installer off disk and stamp this panel's coordinates in.

    Returns ``(content, None)`` on success or ``(None, error_response)`` when the
    file is absent, so the two endpoints below cannot drift apart.
    """
    script_path = os.path.join(_get_scripts_dir(), filename)

    if not os.path.exists(script_path):
        # A missing installer is a packaging fault on THIS panel, never a bad
        # request. The old 404 asserted "no such URL", which is exactly what sent
        # issue #101's reporter hunting for a wrong path -- they filed it as
        # "incorrect paths in setup" -- when the file had simply never been
        # shipped into the image. 503 says "this server is broken, not your URL",
        # and the log line names the path actually searched so an operator can
        # confirm it in one look instead of guessing.
        current_app.logger.error(
            'Agent installer %s is missing from this deployment (searched %s). '
            'Fleet enrollment via /api/v1/servers/%s cannot work until it is '
            'restored; see docs/ARCHITECTURE.md.',
            filename, script_path, filename
        )
        return None, (jsonify({
            'error': f'{filename} is not present on this ServerKit panel',
            'detail': (
                'The panel serves this installer from its own filesystem and the '
                'file is missing, so this is a packaging/deployment problem with '
                'this panel rather than a wrong URL. The panel log records the '
                'exact path searched.'
            ),
            'searched_path': script_path,
        }), 503)

    with open(script_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replace placeholders with actual values
    content = content.replace('https://your-serverkit.com', _get_external_base_url())
    content = content.replace('jhd3197/serverkit-agent', AGENT_GITHUB_REPO)
    return content, None


@servers_bp.route('/install.sh', methods=['GET'])
def get_install_script_linux():
    """
    Get the Linux installation script.

    This endpoint serves the bash installation script for installing
    the ServerKit agent on Linux systems.

    Usage (download-then-run, not `curl | bash`: a pipeline reports bash's exit
    status, so a failed download would exit 0 having installed nothing):
        curl -fsSL https://your-server/api/v1/servers/install.sh \\
            -o /tmp/serverkit-agent-install.sh \\
        && sudo bash /tmp/serverkit-agent-install.sh \\
            --token "YOUR_TOKEN" --server "https://your-server"
    """
    content, error = _load_installer('install.sh')
    if error is not None:
        return error

    # Inject the agent version the panel already resolved so enrollment does
    # not depend on the installer rediscovering it via the GitHub API. Best
    # effort: on failure the placeholder stays empty and the script falls
    # back to its own GitHub discovery.
    release = _get_latest_agent_release()
    version = (release or {}).get('version') or ''
    if version and all(c.isalnum() or c in '._-' for c in version):
        content = content.replace(
            'SERVERKIT_AGENT_VERSION=""',
            f'SERVERKIT_AGENT_VERSION="{version}"',
            1
        )

    return Response(
        content,
        mimetype='text/x-shellscript',
        headers={
            'Content-Disposition': 'inline; filename="install.sh"',
            'Cache-Control': 'no-cache'
        }
    )


@servers_bp.route('/install.ps1', methods=['GET'])
def get_install_script_windows():
    """
    Get the Windows installation script.

    This endpoint serves the PowerShell installation script for installing
    the ServerKit agent on Windows systems.

    Usage:
        irm https://your-server/api/v1/servers/install.ps1 | iex; \\
            Install-ServerKitAgent -Token "YOUR_TOKEN" -Server "https://your-server"
    """
    content, error = _load_installer('install.ps1')
    if error is not None:
        return error

    return Response(
        content,
        mimetype='text/plain',
        headers={
            'Content-Disposition': 'inline; filename="install.ps1"',
            'Cache-Control': 'no-cache'
        }
    )


@servers_bp.route('/install-instructions/<server_id>', methods=['GET'])
@jwt_required()
def get_install_instructions(server_id):
    """
    Get installation instructions for a specific server.

    Returns installation commands with the correct API endpoint. Registration
    tokens are only shown when they are generated, so the UI supplies the token.
    """
    server = _get_operable_server(server_id)

    # Check if server has a valid registration token
    if not server.registration_token_hash:
        return jsonify({
            'error': 'No registration token available',
            'message': 'Generate a new token using the regenerate-token endpoint'
        }), 400

    if server.registration_token_expires and server.registration_token_expires < datetime.utcnow():
        return jsonify({
            'error': 'Registration token expired',
            'message': 'Generate a new token using the regenerate-token endpoint'
        }), 400

    # Get base URL
    base_url = _get_external_base_url()
    api_url = f"{base_url}/api/v1/servers"

    return jsonify({
        'linux': {
            # Download-then-run rather than `curl … | sudo bash`: in a pipeline
            # the shell reports bash's exit status, so a failed download exits 0
            # and installs nothing without saying so (issue #101).
            'one_liner': (
                f'curl -fsSL {api_url}/install.sh -o /tmp/serverkit-agent-install.sh '
                f'&& sudo bash /tmp/serverkit-agent-install.sh '
                f'--token "YOUR_TOKEN" --server "{base_url}"'
            ),
            'manual': [
                f'# Download the script',
                f'curl -fsSL {api_url}/install.sh -o install.sh',
                f'chmod +x install.sh',
                f'',
                f'# Run installation',
                f'sudo ./install.sh --token "YOUR_TOKEN" --server "{base_url}"'
            ]
        },
        'windows': {
            'one_liner': f'irm {api_url}/install.ps1 | iex; Install-ServerKitAgent -Token "YOUR_TOKEN" -Server "{base_url}"',
            'manual': [
                f'# Download the script (run in PowerShell as Administrator)',
                f'Invoke-WebRequest -Uri "{api_url}/install.ps1" -OutFile install.ps1',
                f'',
                f'# Run installation',
                f'.\\install.ps1 -Token "YOUR_TOKEN" -Server "{base_url}"'
            ]
        },
        'note': 'Replace YOUR_TOKEN with the registration token shown in the UI'
    })


# ==================== Agent Updates ====================

# Cache for GitHub releases to avoid rate limiting
_releases_cache = {
    'data': None,
    'expires': None
}

# The agent is built and released from its own repo, tagged plain `vX.Y.Z`. It
# used to ship from this monorepo under `agent-v*` tags; when it moved out,
# nothing here followed it, so this lookup searched a repo that has no agent
# releases at all -- /agent/version answered 503 for every agent polling for an
# update, and the served installer downloaded from a 404. Point both at the
# repo that actually publishes the binaries.
AGENT_GITHUB_REPO = os.environ.get('SERVERKIT_AGENT_GITHUB_REPO', 'jhd3197/serverkit-agent')

# Matches vX.Y.Z but not the malformed release tagged just "v" that sits in the
# agent repo's release list -- that one parses to an empty version and builds
# download URLs like .../releases/download/v/serverkit-agent--linux-amd64.tar.gz.
_AGENT_TAG_RE = re.compile(r'^v(\d[^\s]*)$')


def _get_latest_agent_release():
    """Fetch latest agent release from GitHub with caching"""
    now = datetime.utcnow()

    # Check cache
    if _releases_cache['data'] and _releases_cache['expires'] and _releases_cache['expires'] > now:
        return _releases_cache['data']

    try:
        # Every release in the agent repo is an agent release, but ask for 100
        # anyway so a run of pre-release tags cannot hide the newest stable one.
        response = requests.get(
            f'https://api.github.com/repos/{AGENT_GITHUB_REPO}/releases',
            headers={'Accept': 'application/vnd.github.v3+json'},
            params={'per_page': 100},
            timeout=10
        )
        response.raise_for_status()
        releases = response.json()

        # Find latest agent release
        for release in releases:
            match = _AGENT_TAG_RE.match(release.get('tag_name', ''))
            if match:
                version = match.group(1)

                # Build assets map
                assets = {}
                for asset in release.get('assets', []):
                    name = asset['name']
                    if 'linux-amd64' in name:
                        assets['linux-amd64'] = asset['browser_download_url']
                    elif 'linux-arm64' in name:
                        assets['linux-arm64'] = asset['browser_download_url']
                    elif 'windows-amd64' in name:
                        assets['windows-amd64'] = asset['browser_download_url']
                    elif name == 'checksums.txt':
                        assets['checksums'] = asset['browser_download_url']

                result = {
                    'version': version,
                    'tag': release['tag_name'],
                    'published_at': release['published_at'],
                    'release_url': release['html_url'],
                    'assets': assets,
                    'body': release.get('body', '')
                }

                # Cache for 5 minutes
                _releases_cache['data'] = result
                _releases_cache['expires'] = now + timedelta(minutes=5)

                return result

        return None

    except Exception as e:
        current_app.logger.error(f"Failed to fetch GitHub releases: {e}")
        # Return cached data if available, even if expired
        if _releases_cache['data']:
            return _releases_cache['data']
        return None


@servers_bp.route('/agent/version', methods=['GET'])
def get_agent_version():
    """
    Get the latest agent version information.

    This endpoint is called by agents to check for updates.
    Returns version info and download URLs for all platforms.
    """
    release = _get_latest_agent_release()

    if not release:
        return jsonify({
            'error': 'Unable to fetch version information',
            'message': 'GitHub API may be unavailable'
        }), 503

    # Get base URL for local downloads (fallback)
    base_url = request.url_root.rstrip('/')

    return jsonify({
        'version': release['version'],
        'published_at': release['published_at'],
        'release_notes_url': release['release_url'],
        'downloads': {
            'linux-amd64': release['assets'].get('linux-amd64'),
            'linux-arm64': release['assets'].get('linux-arm64'),
            'windows-amd64': release['assets'].get('windows-amd64'),
        },
        'checksums_url': release['assets'].get('checksums'),
        'update_available_message': f"A new version of ServerKit Agent is available: v{release['version']}"
    })


@servers_bp.route('/agent/version/check', methods=['POST'])
def check_agent_version():
    """
    Check if an agent needs to be updated.

    Called by agents with their current version to check if an update is needed.

    Request body:
    {
        "current_version": "1.0.0",
        "os": "linux",
        "arch": "amd64"
    }
    """
    data = json_object()
    current_version = data.get('current_version', '0.0.0')
    agent_os = data.get('os', 'linux')
    agent_arch = data.get('arch', 'amd64')

    release = _get_latest_agent_release()

    if not release:
        return jsonify({
            'update_available': False,
            'error': 'Unable to check for updates'
        })

    latest_version = release['version']

    # Compare versions (simple string comparison works for semver)
    update_available = _compare_versions(current_version, latest_version) < 0

    platform_key = f"{agent_os}-{agent_arch}"
    download_url = release['assets'].get(platform_key)

    return jsonify({
        'update_available': update_available,
        'current_version': current_version,
        'latest_version': latest_version,
        'download_url': download_url,
        'checksums_url': release['assets'].get('checksums'),
        'release_notes_url': release['release_url'],
        'published_at': release['published_at']
    })


def _compare_versions(v1, v2):
    """
    Compare two semantic versions.
    Returns: -1 if v1 < v2, 0 if v1 == v2, 1 if v1 > v2
    """
    def parse_version(v):
        # Remove leading 'v' if present
        v = v.lstrip('v')
        # Split by dots and convert to integers
        parts = []
        for part in v.split('.'):
            # Handle pre-release versions like 1.0.0-beta.1
            if '-' in part:
                num, _ = part.split('-', 1)
                parts.append(int(num) if num.isdigit() else 0)
            else:
                parts.append(int(part) if part.isdigit() else 0)
        # Pad to at least 3 parts
        while len(parts) < 3:
            parts.append(0)
        return parts

    try:
        p1 = parse_version(v1)
        p2 = parse_version(v2)

        for a, b in zip(p1, p2):
            if a < b:
                return -1
            elif a > b:
                return 1
        return 0
    except:
        return 0


@servers_bp.route('/agent/download/<os_name>/<arch>', methods=['GET'])
def download_agent(os_name, arch):
    """
    Redirect to the appropriate agent download.

    This endpoint redirects to the GitHub release asset for the
    requested OS and architecture.
    """
    # Validate inputs
    valid_os = ['linux', 'windows', 'darwin']
    valid_arch = ['amd64', 'arm64']

    if os_name not in valid_os:
        return jsonify({'error': f'Invalid OS. Valid options: {valid_os}'}), 400

    if arch not in valid_arch:
        return jsonify({'error': f'Invalid architecture. Valid options: {valid_arch}'}), 400

    release = _get_latest_agent_release()

    if not release:
        return jsonify({'error': 'Unable to fetch release information'}), 503

    platform_key = f"{os_name}-{arch}"
    download_url = release['assets'].get(platform_key)

    if not download_url:
        return jsonify({
            'error': f'No release available for {os_name}-{arch}',
            'available': list(release['assets'].keys())
        }), 404

    # Redirect to GitHub release
    return redirect(download_url, code=302)


@servers_bp.route('/agent/checksums', methods=['GET'])
def get_agent_checksums():
    """
    Get SHA256 checksums for agent binaries.

    Returns the checksums.txt content from the latest release.
    """
    release = _get_latest_agent_release()

    if not release or not release['assets'].get('checksums'):
        return jsonify({'error': 'Checksums not available'}), 404

    try:
        response = requests.get(release['assets']['checksums'], timeout=10)
        response.raise_for_status()

        return Response(
            response.text,
            mimetype='text/plain',
            headers={
                'Content-Disposition': 'inline; filename="checksums.txt"',
                'X-Agent-Version': release['version']
            }
        )
    except Exception as e:
        current_app.logger.error(f"Failed to fetch checksums: {e}")
        return jsonify({'error': 'Failed to fetch checksums'}), 503


@servers_bp.route('/<server_id>/agent/update', methods=['POST'])
@developer_required
def trigger_agent_update(server_id):
    """
    Trigger an agent update on a specific server.

    Sends a command to the agent to check for and install updates.

    Developer role required — this replaces the agent binary and restarts the
    service across the fleet, so it must not be reachable by read-only viewers
    (every other state-changing server route is already @developer_required).
    """
    _get_operable_server(server_id)

    if not agent_registry.is_agent_connected(server_id):
        raise agent_offline()

    # Get latest version info
    release = _get_latest_agent_release()
    if not release:
        return jsonify({
            'success': False,
            'error': 'Unable to fetch latest version'
        }), 503

    # Send update command to agent
    result = dispatch_agent_command(
        server_id=server_id,
        action='agent:update',
        params={
            'version': release['version'],
            'force': json_object(optional=True).get('force', False)
        },
        timeout=60.0  # Updates may take a while
    )

    return jsonify(result)


# ==================== Agent Fleet Management ====================

@servers_bp.route('/fleet/health', methods=['GET'])
@admin_required
def get_fleet_health():
    """Get aggregated health metrics for the agent fleet"""
    return jsonify(fleet_service.get_fleet_health())


@servers_bp.route('/fleet/versions', methods=['GET'])
@admin_required
def list_agent_versions():
    """List all available agent versions"""
    versions = AgentVersion.query.order_by(AgentVersion.version.desc()).all()
    return jsonify([v.to_dict() for v in versions])


@servers_bp.route('/fleet/versions', methods=['POST'])
@admin_required
def add_agent_version():
    """Add a new available agent version"""
    data = json_object()
    
    if not data.get('version'):
        raise field_required('Version')
        
    version = AgentVersion(
        version=data['version'],
        channel=data.get('channel', 'stable'),
        min_panel_version=data.get('min_panel_version'),
        max_panel_version=data.get('max_panel_version'),
        release_notes=data.get('release_notes'),
        assets=data.get('assets', {}),
        published_at=datetime.fromisoformat(data['published_at']) if data.get('published_at') else datetime.utcnow()
    )
    
    db.session.add(version)
    db.session.commit()
    
    return jsonify(version.to_dict()), 201


@servers_bp.route('/fleet/upgrade', methods=['POST'])
@admin_required
def upgrade_fleet():
    """Trigger upgrade for selected servers or entire fleet"""
    data = json_object()
    server_ids = data.get('server_ids', [])
    version_id = data.get('version_id')
    user_id = get_jwt_identity()
    
    if not server_ids:
        # If no IDs provided, upgrade all online servers
        servers = Server.query.filter_by(status='online').all()
        server_ids = [s.id for s in servers]
        
    if not server_ids:
        return jsonify({'success': True, 'message': 'No online servers to upgrade'})
        
    result = fleet_service.upgrade_servers(server_ids, version_id, user_id)
    return jsonify(result)


@servers_bp.route('/fleet/rollout', methods=['POST'])
@admin_required
def start_staged_rollout():
    """Start a staged rollout"""
    data = json_object()
    group_id = data.get('group_id')
    version_id = data.get('version_id')
    batch_size = data.get('batch_size', 5)
    delay_minutes = data.get('delay_minutes', 10)
    strategy = data.get('strategy', 'staged')
    server_ids = data.get('server_ids')
    user_id = get_jwt_identity()

    if not version_id:
        raise field_required('version_id')

    result = fleet_service.staged_rollout(
        group_id, version_id, batch_size, delay_minutes,
        strategy, user_id, server_ids
    )
    return jsonify(result)


@servers_bp.route('/fleet/rollouts', methods=['GET'])
@admin_required
def list_rollouts():
    """List rollout history"""
    status = request.args.get('status')
    limit = request.args.get('limit', 20, type=int)
    return jsonify(fleet_service.get_rollouts(status, limit))


@servers_bp.route('/fleet/rollouts/<rollout_id>', methods=['GET'])
@admin_required
def get_rollout(rollout_id):
    """Get a specific rollout"""
    rollout = fleet_service.get_rollout(rollout_id)
    if not rollout:
        return jsonify({'error': 'Rollout not found'}), 404
    return jsonify(rollout)


@servers_bp.route('/fleet/rollouts/<rollout_id>/cancel', methods=['POST'])
@admin_required
def cancel_rollout(rollout_id):
    """Cancel an active rollout"""
    success = fleet_service.cancel_rollout(rollout_id)
    if not success:
        return jsonify({'error': 'Cannot cancel rollout (not running or not found)'}), 400
    return jsonify({'success': True, 'message': 'Rollout cancelled'})


@servers_bp.route('/fleet/discovery', methods=['POST'])
@admin_required
def start_discovery_scan():
    """Start a network scan for new agents"""
    duration = request.args.get('duration', 10, type=int)
    agents = discovery_service.start_scan(duration)
    return jsonify(agents)


@servers_bp.route('/fleet/discovery', methods=['GET'])
@admin_required
def get_discovered_agents():
    """Get results of last discovery scan"""
    return jsonify(discovery_service.get_discovered_agents())


@servers_bp.route('/fleet/approve/<server_id>', methods=['POST'])
@admin_required
def approve_agent_registration(server_id):
    """Approve a pending agent registration"""
    user_id = get_jwt_identity()
    success = fleet_service.approve_registration(server_id, user_id)

    if not success:
        return jsonify({'error': 'Failed to approve registration'}), 400

    return jsonify({'success': True, 'message': 'Registration approved'})


@servers_bp.route('/fleet/reject/<server_id>', methods=['POST'])
@admin_required
def reject_agent_registration(server_id):
    """Reject a pending agent registration"""
    success = fleet_service.reject_registration(server_id)

    if not success:
        return jsonify({'error': 'Failed to reject registration'}), 400

    return jsonify({'success': True, 'message': 'Registration rejected'})


@servers_bp.route('/fleet/commands/queued', methods=['GET'])
@admin_required
def get_queued_commands():
    """Get all pending queued commands"""
    server_id = request.args.get('server_id')
    commands = fleet_service.get_queued_commands(server_id)
    return jsonify(commands)


@servers_bp.route('/fleet/commands/<command_id>/retry', methods=['POST'])
@admin_required
def retry_command(command_id):
    """Retry a failed command"""
    result = fleet_service.retry_command(command_id)
    if not result.get('success'):
        return jsonify(result), 400
    return jsonify(result)


@servers_bp.route('/fleet/diagnostics/<server_id>', methods=['GET'])
@admin_required
def get_server_diagnostics(server_id):
    """Get detailed connection diagnostics for a server"""
    diagnostics = fleet_service.get_server_diagnostics(server_id)
    if 'error' in diagnostics:
        return jsonify(diagnostics), 404
    return jsonify(diagnostics)
