"""
Build Service - Handles application building with multiple strategies.

Supports:
- Dockerfile detection and building
- Nixpacks (Heroku-style auto-detection)
- Custom build commands
- Build log streaming
- Build caching
- Build timeout handling
"""

import os
import subprocess
import json
import shutil
import hashlib
import threading
import queue
from datetime import datetime
from typing import Dict, List, Optional, Callable, Generator
from pathlib import Path

from app import paths


class BuildService:
    """Service for building applications from source code."""

    CONFIG_DIR = paths.SERVERKIT_CONFIG_DIR
    BUILD_CONFIG = os.path.join(CONFIG_DIR, 'builds.json')
    BUILD_LOG_DIR = paths.BUILD_LOG_DIR
    BUILD_CACHE_DIR = paths.BUILD_CACHE_DIR

    # Default build timeout (10 minutes)
    DEFAULT_TIMEOUT = 600

    # Nixpacks language detection patterns
    LANGUAGE_PATTERNS = {
        'node': ['package.json'],
        'python': ['requirements.txt', 'Pipfile', 'pyproject.toml', 'setup.py'],
        'ruby': ['Gemfile'],
        'go': ['go.mod', 'go.sum'],
        'rust': ['Cargo.toml'],
        'php': ['composer.json'],
        'java': ['pom.xml', 'build.gradle', 'build.gradle.kts'],
        'dotnet': ['*.csproj', '*.fsproj', '*.sln'],
        'elixir': ['mix.exs'],
        'static': ['index.html'],
    }

    # Framework detection for better build configs
    FRAMEWORK_PATTERNS = {
        'nextjs': ['next.config.js', 'next.config.mjs', 'next.config.ts'],
        'nuxt': ['nuxt.config.js', 'nuxt.config.ts'],
        'remix': ['remix.config.js'],
        'astro': ['astro.config.mjs'],
        'sveltekit': ['svelte.config.js'],
        'vite': ['vite.config.js', 'vite.config.ts'],
        'django': ['manage.py', 'wsgi.py'],
        'flask': ['app.py', 'wsgi.py'],
        'fastapi': ['main.py'],
        'rails': ['config.ru', 'Rakefile'],
        'laravel': ['artisan'],
        'express': ['app.js', 'server.js', 'index.js'],
    }

    @classmethod
    def get_config(cls) -> Dict:
        """Get build configuration."""
        if os.path.exists(cls.BUILD_CONFIG):
            try:
                with open(cls.BUILD_CONFIG, 'r') as f:
                    return json.load(f)
            except Exception:
                pass
        return {'apps': {}}

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save build configuration."""
        try:
            os.makedirs(cls.CONFIG_DIR, exist_ok=True)
            with open(cls.BUILD_CONFIG, 'w') as f:
                json.dump(config, f, indent=2)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_app_build_config(cls, app_id: int) -> Optional[Dict]:
        """Get build config for an app."""
        config = cls.get_config()
        return config.get('apps', {}).get(str(app_id))

    @classmethod
    def configure_build(cls, app_id: int, app_path: str,
                       build_method: str = 'auto',
                       dockerfile_path: str = None,
                       custom_build_cmd: str = None,
                       custom_start_cmd: str = None,
                       build_args: Dict = None,
                       env_vars: Dict = None,
                       cache_enabled: bool = True,
                       timeout: int = None,
                       keep_deployments: int = 5) -> Dict:
        """Configure build settings for an app.

        Args:
            app_id: Application ID
            app_path: Path to application source code
            build_method: 'auto', 'dockerfile', 'nixpacks', 'custom'
            dockerfile_path: Path to Dockerfile (relative to app_path)
            custom_build_cmd: Custom build command
            custom_start_cmd: Custom start command
            build_args: Docker build arguments
            env_vars: Environment variables for build
            cache_enabled: Enable build caching
            timeout: Build timeout in seconds
            keep_deployments: Number of deployments to keep for rollback
        """
        config = cls.get_config()

        app_config = {
            'app_id': app_id,
            'app_path': app_path,
            'build_method': build_method,
            'dockerfile_path': dockerfile_path or 'Dockerfile',
            'custom_build_cmd': custom_build_cmd,
            'custom_start_cmd': custom_start_cmd,
            'build_args': build_args or {},
            'env_vars': env_vars or {},
            'cache_enabled': cache_enabled,
            'timeout': timeout or cls.DEFAULT_TIMEOUT,
            'keep_deployments': keep_deployments,
            'created_at': datetime.now().isoformat(),
            'last_build': None,
            'build_count': 0
        }

        config.setdefault('apps', {})[str(app_id)] = app_config
        result = cls.save_config(config)

        if result.get('success'):
            return {'success': True, 'config': app_config}
        return result

    @classmethod
    def detect_build_method(cls, app_path: str) -> Dict:
        """Auto-detect the best build method for an application.

        Returns detected language, framework, and recommended build method.
        """
        result = {
            'language': None,
            'framework': None,
            'build_method': 'custom',
            'has_dockerfile': False,
            'has_docker_compose': False,
            'detected_files': []
        }

        if not os.path.exists(app_path):
            return result

        files = os.listdir(app_path)
        result['detected_files'] = files

        # Check for Dockerfile
        if 'Dockerfile' in files:
            result['has_dockerfile'] = True
            result['build_method'] = 'dockerfile'

        # Check for docker-compose
        if 'docker-compose.yml' in files or 'docker-compose.yaml' in files:
            result['has_docker_compose'] = True

        # Detect language
        for lang, patterns in cls.LANGUAGE_PATTERNS.items():
            for pattern in patterns:
                if '*' in pattern:
                    # Glob pattern
                    import fnmatch
                    if any(fnmatch.fnmatch(f, pattern) for f in files):
                        result['language'] = lang
                        break
                elif pattern in files:
                    result['language'] = lang
                    break
            if result['language']:
                break

        # Detect framework
        for framework, patterns in cls.FRAMEWORK_PATTERNS.items():
            for pattern in patterns:
                if pattern in files:
                    result['framework'] = framework
                    break
                # Check in subdirectories for some patterns
                for subdir in ['src', 'app', 'config']:
                    subpath = os.path.join(app_path, subdir, pattern)
                    if os.path.exists(subpath):
                        result['framework'] = framework
                        break
            if result['framework']:
                break

        # Determine build method
        if result['has_dockerfile']:
            result['build_method'] = 'dockerfile'
        elif result['language']:
            result['build_method'] = 'nixpacks'
        else:
            result['build_method'] = 'custom'

        return result

    @classmethod
    def _compute_build_hash(cls, app_path: str) -> str:
        """Compute a hash of the source code for cache invalidation."""
        hasher = hashlib.sha256()

        for root, dirs, files in os.walk(app_path):
            # Skip common non-source directories
            dirs[:] = [d for d in dirs if d not in [
                'node_modules', '.git', '__pycache__', '.venv',
                'venv', 'vendor', 'target', 'dist', 'build'
            ]]

            for filename in sorted(files):
                filepath = os.path.join(root, filename)
                try:
                    with open(filepath, 'rb') as f:
                        hasher.update(f.read())
                except (IOError, PermissionError):
                    pass

        return hasher.hexdigest()[:16]

    @classmethod
    def _get_cache_key(cls, app_id: int, app_path: str) -> str:
        """Get cache key for a build."""
        source_hash = cls._compute_build_hash(app_path)
        return f"app-{app_id}-{source_hash}"

    @classmethod
    def build_with_dockerfile(cls, app_id: int, app_path: str,
                             dockerfile_path: str = 'Dockerfile',
                             image_tag: str = None,
                             build_args: Dict = None,
                             no_cache: bool = False,
                             timeout: int = None,
                             log_callback: Callable[[str], None] = None) -> Dict:
        """Build application using Dockerfile.

        Args:
            app_id: Application ID
            app_path: Path to application source
            dockerfile_path: Path to Dockerfile (relative to app_path)
            image_tag: Docker image tag
            build_args: Build arguments
            no_cache: Disable Docker build cache
            timeout: Build timeout in seconds
            log_callback: Callback function for streaming logs
        """
        if not image_tag:
            image_tag = f"serverkit-app-{app_id}:latest"

        dockerfile_full = os.path.join(app_path, dockerfile_path)
        if not os.path.exists(dockerfile_full):
            return {'success': False, 'error': f'Dockerfile not found: {dockerfile_path}'}

        build_log = {
            'app_id': app_id,
            'started_at': datetime.now().isoformat(),
            'build_method': 'dockerfile',
            'status': 'building',
            'logs': []
        }

        try:
            cmd = ['docker', 'build', '-t', image_tag]

            if dockerfile_path != 'Dockerfile':
                cmd.extend(['-f', dockerfile_full])

            if no_cache:
                cmd.append('--no-cache')

            if build_args:
                for key, value in build_args.items():
                    cmd.extend(['--build-arg', f'{key}={value}'])

            cmd.append(app_path)

            # Run build with streaming output
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )

            output_lines = []
            try:
                for line in process.stdout:
                    output_lines.append(line)
                    build_log['logs'].append(line.rstrip())
                    if log_callback:
                        log_callback(line.rstrip())

                process.wait(timeout=timeout or cls.DEFAULT_TIMEOUT)
            except subprocess.TimeoutExpired:
                process.kill()
                build_log['status'] = 'timeout'
                build_log['error'] = 'Build timed out'
                build_log['completed_at'] = datetime.now().isoformat()
                cls._save_build_log(app_id, build_log)
                return {'success': False, 'error': 'Build timed out', 'build_log': build_log}

            if process.returncode == 0:
                build_log['status'] = 'success'
                build_log['image_tag'] = image_tag
                build_log['completed_at'] = datetime.now().isoformat()
                cls._save_build_log(app_id, build_log)
                cls._update_build_stats(app_id)

                return {
                    'success': True,
                    'image_tag': image_tag,
                    'build_log': build_log
                }
            else:
                build_log['status'] = 'failed'
                build_log['error'] = 'Build failed'
                build_log['completed_at'] = datetime.now().isoformat()
                cls._save_build_log(app_id, build_log)

                return {
                    'success': False,
                    'error': 'Docker build failed',
                    'output': '\n'.join(output_lines),
                    'build_log': build_log
                }

        except Exception as e:
            build_log['status'] = 'error'
            build_log['error'] = str(e)
            build_log['completed_at'] = datetime.now().isoformat()
            cls._save_build_log(app_id, build_log)
            return {'success': False, 'error': str(e), 'build_log': build_log}

    @classmethod
    def build_with_nixpacks(cls, app_id: int, app_path: str,
                           image_tag: str = None,
                           env_vars: Dict = None,
                           build_cmd: str = None,
                           start_cmd: str = None,
                           no_cache: bool = False,
                           timeout: int = None,
                           log_callback: Callable[[str], None] = None) -> Dict:
        """Build application using Nixpacks (Heroku-style auto-detection).

        Nixpacks automatically detects the language and framework,
        then builds an optimized Docker image.
        """
        if not image_tag:
            image_tag = f"serverkit-app-{app_id}:latest"

        # Check if nixpacks is installed
        try:
            subprocess.run(['nixpacks', '--version'], capture_output=True, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            return {
                'success': False,
                'error': 'Nixpacks not installed. Install with: curl -sSL https://nixpacks.com/install.sh | bash'
            }

        build_log = {
            'app_id': app_id,
            'started_at': datetime.now().isoformat(),
            'build_method': 'nixpacks',
            'status': 'building',
            'logs': []
        }

        try:
            cmd = ['nixpacks', 'build', app_path, '--name', image_tag]

            if env_vars:
                for key, value in env_vars.items():
                    cmd.extend(['--env', f'{key}={value}'])

            if build_cmd:
                cmd.extend(['--build-cmd', build_cmd])

            if start_cmd:
                cmd.extend(['--start-cmd', start_cmd])

            if no_cache:
                cmd.append('--no-cache')

            # Run build with streaming output
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )

            output_lines = []
            try:
                for line in process.stdout:
                    output_lines.append(line)
                    build_log['logs'].append(line.rstrip())
                    if log_callback:
                        log_callback(line.rstrip())

                process.wait(timeout=timeout or cls.DEFAULT_TIMEOUT)
            except subprocess.TimeoutExpired:
                process.kill()
                build_log['status'] = 'timeout'
                build_log['error'] = 'Build timed out'
                build_log['completed_at'] = datetime.now().isoformat()
                cls._save_build_log(app_id, build_log)
                return {'success': False, 'error': 'Build timed out', 'build_log': build_log}

            if process.returncode == 0:
                build_log['status'] = 'success'
                build_log['image_tag'] = image_tag
                build_log['completed_at'] = datetime.now().isoformat()
                cls._save_build_log(app_id, build_log)
                cls._update_build_stats(app_id)

                return {
                    'success': True,
                    'image_tag': image_tag,
                    'build_log': build_log
                }
            else:
                build_log['status'] = 'failed'
                build_log['error'] = 'Build failed'
                build_log['completed_at'] = datetime.now().isoformat()
                cls._save_build_log(app_id, build_log)

                return {
                    'success': False,
                    'error': 'Nixpacks build failed',
                    'output': '\n'.join(output_lines),
                    'build_log': build_log
                }

        except Exception as e:
            build_log['status'] = 'error'
            build_log['error'] = str(e)
            build_log['completed_at'] = datetime.now().isoformat()
            cls._save_build_log(app_id, build_log)
            return {'success': False, 'error': str(e), 'build_log': build_log}

    @classmethod
    def build_with_custom_command(cls, app_id: int, app_path: str,
                                  build_cmd: str,
                                  env_vars: Dict = None,
                                  timeout: int = None,
                                  log_callback: Callable[[str], None] = None) -> Dict:
        """Build application using custom commands."""
        build_log = {
            'app_id': app_id,
            'started_at': datetime.now().isoformat(),
            'build_method': 'custom',
            'build_cmd': build_cmd,
            'status': 'building',
            'logs': []
        }

        try:
            env = os.environ.copy()
            if env_vars:
                env.update(env_vars)

            process = subprocess.Popen(
                build_cmd,
                shell=True,
                cwd=app_path,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )

            output_lines = []
            try:
                for line in process.stdout:
                    output_lines.append(line)
                    build_log['logs'].append(line.rstrip())
                    if log_callback:
                        log_callback(line.rstrip())

                process.wait(timeout=timeout or cls.DEFAULT_TIMEOUT)
            except subprocess.TimeoutExpired:
                process.kill()
                build_log['status'] = 'timeout'
                build_log['error'] = 'Build timed out'
                build_log['completed_at'] = datetime.now().isoformat()
                cls._save_build_log(app_id, build_log)
                return {'success': False, 'error': 'Build timed out', 'build_log': build_log}

            if process.returncode == 0:
                build_log['status'] = 'success'
                build_log['completed_at'] = datetime.now().isoformat()
                cls._save_build_log(app_id, build_log)
                cls._update_build_stats(app_id)

                return {
                    'success': True,
                    'build_log': build_log
                }
            else:
                build_log['status'] = 'failed'
                build_log['error'] = f'Build command exited with code {process.returncode}'
                build_log['completed_at'] = datetime.now().isoformat()
                cls._save_build_log(app_id, build_log)

                return {
                    'success': False,
                    'error': 'Custom build failed',
                    'output': '\n'.join(output_lines),
                    'build_log': build_log
                }

        except Exception as e:
            build_log['status'] = 'error'
            build_log['error'] = str(e)
            build_log['completed_at'] = datetime.now().isoformat()
            cls._save_build_log(app_id, build_log)
            return {'success': False, 'error': str(e), 'build_log': build_log}

    @classmethod
    def build(cls, app_id: int, no_cache: bool = False,
              log_callback: Callable[[str], None] = None) -> Dict:
        """Build an application using configured method.

        Auto-detects build method if set to 'auto'.
        """
        build_config = cls.get_app_build_config(app_id)
        if not build_config:
            return {'success': False, 'error': 'Build not configured for this app'}

        app_path = build_config['app_path']
        build_method = build_config.get('build_method', 'auto')
        timeout = build_config.get('timeout', cls.DEFAULT_TIMEOUT)

        # Auto-detect if needed
        if build_method == 'auto':
            detection = cls.detect_build_method(app_path)
            build_method = detection['build_method']

        # Build based on method
        if build_method == 'dockerfile':
            return cls.build_with_dockerfile(
                app_id=app_id,
                app_path=app_path,
                dockerfile_path=build_config.get('dockerfile_path', 'Dockerfile'),
                build_args=build_config.get('build_args'),
                no_cache=no_cache or not build_config.get('cache_enabled', True),
                timeout=timeout,
                log_callback=log_callback
            )
        elif build_method == 'nixpacks':
            return cls.build_with_nixpacks(
                app_id=app_id,
                app_path=app_path,
                env_vars=build_config.get('env_vars'),
                build_cmd=build_config.get('custom_build_cmd'),
                start_cmd=build_config.get('custom_start_cmd'),
                no_cache=no_cache or not build_config.get('cache_enabled', True),
                timeout=timeout,
                log_callback=log_callback
            )
        elif build_method == 'custom':
            custom_cmd = build_config.get('custom_build_cmd')
            if not custom_cmd:
                return {'success': False, 'error': 'No custom build command configured'}
            return cls.build_with_custom_command(
                app_id=app_id,
                app_path=app_path,
                build_cmd=custom_cmd,
                env_vars=build_config.get('env_vars'),
                timeout=timeout,
                log_callback=log_callback
            )
        else:
            return {'success': False, 'error': f'Unknown build method: {build_method}'}

    @classmethod
    def _save_build_log(cls, app_id: int, build_log: Dict) -> None:
        """Save build log to file."""
        try:
            log_dir = os.path.join(cls.BUILD_LOG_DIR, str(app_id))
            os.makedirs(log_dir, exist_ok=True)

            timestamp = build_log.get('started_at', datetime.now().isoformat())
            filename = f"build-{timestamp.replace(':', '-')}.json"
            filepath = os.path.join(log_dir, filename)

            with open(filepath, 'w') as f:
                json.dump(build_log, f, indent=2)
        except Exception:
            pass

    @classmethod
    def _update_build_stats(cls, app_id: int) -> None:
        """Update build statistics in config."""
        config = cls.get_config()
        if str(app_id) in config.get('apps', {}):
            config['apps'][str(app_id)]['last_build'] = datetime.now().isoformat()
            config['apps'][str(app_id)]['build_count'] = config['apps'][str(app_id)].get('build_count', 0) + 1
            cls.save_config(config)

    @classmethod
    def get_build_logs(cls, app_id: int, limit: int = 20) -> List[Dict]:
        """Get build logs for an application."""
        logs = []
        log_dir = os.path.join(cls.BUILD_LOG_DIR, str(app_id))

        if not os.path.exists(log_dir):
            return logs

        try:
            files = sorted(os.listdir(log_dir), reverse=True)[:limit]
            for filename in files:
                filepath = os.path.join(log_dir, filename)
                try:
                    with open(filepath, 'r') as f:
                        log_entry = json.load(f)
                        # Don't include full log output in list
                        log_entry['log_count'] = len(log_entry.get('logs', []))
                        log_entry.pop('logs', None)
                        logs.append(log_entry)
                except (json.JSONDecodeError, IOError):
                    pass
        except Exception:
            pass

        return logs

    @classmethod
    def get_build_log_detail(cls, app_id: int, timestamp: str) -> Optional[Dict]:
        """Get detailed build log including output."""
        log_dir = os.path.join(cls.BUILD_LOG_DIR, str(app_id))
        filename = f"build-{timestamp.replace(':', '-')}.json"
        filepath = os.path.join(log_dir, filename)

        if os.path.exists(filepath):
            try:
                with open(filepath, 'r') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass
        return None

    @classmethod
    def cancel_build(cls, app_id: int) -> Dict:
        """Cancel a running build (if possible)."""
        # This would need process tracking to implement fully
        # For now, just return a placeholder
        return {'success': False, 'error': 'Build cancellation not yet implemented'}

    @classmethod
    def clear_build_cache(cls, app_id: int = None) -> Dict:
        """Clear build cache for an app or all apps."""
        try:
            if app_id:
                cache_dir = os.path.join(cls.BUILD_CACHE_DIR, str(app_id))
                if os.path.exists(cache_dir):
                    shutil.rmtree(cache_dir)
            else:
                if os.path.exists(cls.BUILD_CACHE_DIR):
                    shutil.rmtree(cls.BUILD_CACHE_DIR)
            return {'success': True}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_nixpacks_plan(cls, app_path: str) -> Dict:
        """Get Nixpacks build plan for an application."""
        try:
            result = subprocess.run(
                ['nixpacks', 'plan', app_path, '--format', 'json'],
                capture_output=True,
                text=True
            )
            if result.returncode == 0:
                return {'success': True, 'plan': json.loads(result.stdout)}
            return {'success': False, 'error': result.stderr}
        except FileNotFoundError:
            return {'success': False, 'error': 'Nixpacks not installed'}
        except Exception as e:
            return {'success': False, 'error': str(e)}
