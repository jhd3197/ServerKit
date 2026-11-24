"""Unit tests for the transparent build-pack layer (BuildpackService).

Pure / no network / no Flask app needed — detection runs against temp dirs full
of marker files, and generation is pure string production.
"""

import json

import pytest

from app.services.buildpack_service import BuildpackService


# --------------------------------------------------------------------------- #
# detect()
# --------------------------------------------------------------------------- #
def test_detect_node_express(tmp_path):
    (tmp_path / 'package.json').write_text(json.dumps({
        'name': 'demo',
        'dependencies': {'express': '^4.18.0'},
        'scripts': {'start': 'node server.js'},
        'engines': {'node': '>=20'},
    }), encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))

    assert plan['builder'] == 'nixpacks'
    assert plan['language'] == 'node'
    assert plan['framework'] == 'express'
    assert plan['versions']['node'] == '20'
    assert plan['start_command'] == 'node server.js'
    assert plan['port'] == 3000
    assert plan['confidence'] > 0


def test_detect_node_nextjs_build_command(tmp_path):
    (tmp_path / 'package.json').write_text(json.dumps({
        'dependencies': {'next': '14.0.0', 'react': '18'},
        'scripts': {'build': 'next build', 'start': 'next start'},
    }), encoding='utf-8')
    (tmp_path / 'next.config.js').write_text('module.exports = {}', encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))

    assert plan['framework'] == 'nextjs'
    assert plan['build_command'] == 'npm run build'


def test_detect_python_flask(tmp_path):
    (tmp_path / 'requirements.txt').write_text('Flask==3.0\ngunicorn\n', encoding='utf-8')
    (tmp_path / 'app.py').write_text('app = None\n', encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))

    assert plan['builder'] == 'nixpacks'
    assert plan['language'] == 'python'
    assert plan['framework'] == 'flask'
    assert 'gunicorn' in plan['start_command']
    assert plan['build_command'].startswith('pip install')


def test_detect_python_installs_invented_server(tmp_path):
    """When the buildpack invents a gunicorn/uvicorn start command, the build
    must install that server -- a repo that never asked for it won't declare
    it, and the container would die at boot with `gunicorn: not found`."""
    (tmp_path / 'requirements.txt').write_text('Flask==3.0\n', encoding='utf-8')
    (tmp_path / 'app.py').write_text('app = None\n', encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))

    assert plan['start_command'].startswith('gunicorn')
    assert 'pip install --no-cache-dir gunicorn' in plan['build_command']


def test_detect_python_version_from_pyproject(tmp_path):
    (tmp_path / 'pyproject.toml').write_text(
        '[project]\nname="x"\nrequires-python = ">=3.12"\n', encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))

    assert plan['language'] == 'python'
    assert plan['versions']['python'] == '3.12'


def test_detect_go(tmp_path):
    (tmp_path / 'go.mod').write_text('module example.com/app\n\ngo 1.21\n', encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))

    assert plan['builder'] == 'nixpacks'
    assert plan['language'] == 'go'
    assert plan['versions']['go'] == '1.21'
    assert plan['build_command'] == 'go build -o /app/server ./...'


def test_detect_static(tmp_path):
    (tmp_path / 'index.html').write_text('<html></html>', encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))

    assert plan['builder'] == 'static'
    assert plan['language'] == 'static'
    assert plan['port'] == 80


def test_detect_dockerfile_present_wins(tmp_path):
    # Dockerfile present alongside a package.json — defer to the author's build.
    (tmp_path / 'Dockerfile').write_text('FROM node:20\n', encoding='utf-8')
    (tmp_path / 'package.json').write_text('{}', encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))

    assert plan['builder'] == 'dockerfile-present'
    assert plan['confidence'] == 1.0
    assert plan['language'] == 'node'  # still labeled for display


def test_detect_unknown(tmp_path):
    (tmp_path / 'README.md').write_text('# nothing here', encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))

    assert plan['builder'] == 'unknown'
    assert plan['confidence'] == 0.0
    assert plan['notes']


def test_detect_missing_path():
    plan = BuildpackService.detect('/path/that/does/not/exist/xyz')
    assert plan['builder'] == 'unknown'
    assert plan['notes']


def test_procfile_overrides_start_command(tmp_path):
    (tmp_path / 'requirements.txt').write_text('flask\n', encoding='utf-8')
    (tmp_path / 'Procfile').write_text('web: gunicorn wsgi:application\n', encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))

    assert plan['start_command'] == 'gunicorn wsgi:application'


# --------------------------------------------------------------------------- #
# generate_dockerfile()
# --------------------------------------------------------------------------- #
def test_generate_dockerfile_node():
    plan = {
        'builder': 'nixpacks', 'language': 'node', 'framework': 'express',
        'versions': {'node': '20'}, 'build_command': 'npm run build',
        'start_command': 'node server.js', 'port': 3000,
    }
    df = BuildpackService.generate_dockerfile(plan)
    assert 'FROM node:20-slim' in df
    assert 'npm run build' in df
    assert 'EXPOSE 3000' in df
    assert 'server.js' in df


def test_generate_dockerfile_node_build_keeps_dev_dependencies():
    """A build step needs devDependencies (vite, tsc, ...).

    `npm install --omit=dev` exits 0, so an `|| npm install` fallback never
    fires and `npm run build` dies with `vite: not found`.
    """
    plan = {
        'builder': 'nixpacks', 'language': 'node', 'framework': 'vite',
        'versions': {'node': '24'}, 'build_command': 'npm run build',
        'start_command': 'vite preview --host --port 4173', 'port': 4173,
    }
    df = BuildpackService.generate_dockerfile(plan)
    assert '--omit=dev' not in df
    assert 'RUN npm install\n' in df
    # Locally installed CLIs are only reachable via node_modules/.bin.
    assert 'ENV PATH=/app/node_modules/.bin:$PATH' in df
    assert df.index('RUN npm install\n') < df.index('RUN npm run build')


def test_generate_dockerfile_node_skips_browser_downloads():
    """devDependencies stay, but their browser binaries must not.

    Keeping devDependencies (see above) also drags in puppeteer/playwright/
    cypress postinstalls, which fetch a full Chrome (~500MB) into the build
    layer. Nothing in a production build drives a browser, and on a small
    host that download is what exhausts the disk during image export.
    """
    plan = {
        'builder': 'nixpacks', 'language': 'node', 'framework': 'vite',
        'versions': {'node': '24'}, 'build_command': 'npm run build',
        'start_command': 'serve -s dist -l tcp://0.0.0.0:4173', 'port': 4173,
    }
    df = BuildpackService.generate_dockerfile(plan)
    assert 'PUPPETEER_SKIP_DOWNLOAD=1' in df
    assert 'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1' in df
    assert 'CYPRESS_INSTALL_BINARY=0' in df
    # The opt-out only works if it is exported before the install runs.
    assert df.index('PUPPETEER_SKIP_DOWNLOAD=1') < df.index('RUN npm install')


def test_detect_vite_defaults_to_serve_not_preview(tmp_path):
    """`vite preview` host-checks against preview.allowedHosts and blocks
    every domain the panel proxy forwards -- the default start command must
    be a host-agnostic static server, and the generator must preinstall it
    (the repo never declares serve)."""
    (tmp_path / 'package.json').write_text(json.dumps({
        'name': 'v', 'scripts': {'build': 'vite build'},
        'devDependencies': {'vite': '^6.0.0'},
    }), encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))
    assert plan['framework'] == 'vite'
    assert plan['start_command'].startswith('serve ')
    assert 'preview' not in plan['start_command']

    df = BuildpackService.generate_dockerfile(plan)
    assert 'RUN npm install -g serve' in df


def test_detect_vite_repo_start_script_wins(tmp_path):
    """A repo-authored start script is the author's contract -- keep it,
    and don't preinstall serve for a command that doesn't use it."""
    (tmp_path / 'package.json').write_text(json.dumps({
        'name': 'v', 'scripts': {'build': 'vite build',
                                 'start': 'node server.mjs'},
        'devDependencies': {'vite': '^6.0.0'},
    }), encoding='utf-8')

    plan = BuildpackService.detect(str(tmp_path))
    assert plan['start_command'] == 'node server.mjs'
    assert 'RUN npm install -g serve' not in \
        BuildpackService.generate_dockerfile(plan)


def test_generate_dockerfile_node_without_build_omits_dev():
    plan = {
        'builder': 'nixpacks', 'language': 'node', 'framework': 'express',
        'versions': {'node': '20'}, 'start_command': 'node server.js',
        'port': 3000,
    }
    df = BuildpackService.generate_dockerfile(plan)
    assert 'RUN npm install --omit=dev || npm install' in df


def test_generate_dockerfile_python():
    plan = {
        'builder': 'nixpacks', 'language': 'python', 'framework': 'flask',
        'versions': {'python': '3.11'},
        'build_command': 'pip install --no-cache-dir -r requirements.txt',
        'start_command': 'gunicorn app:app', 'port': 8000,
    }
    df = BuildpackService.generate_dockerfile(plan)
    assert 'FROM python:3.11-slim' in df
    assert 'pip install' in df
    assert 'EXPOSE 8000' in df
    assert 'gunicorn app:app' in df


def test_generate_dockerfile_go_multistage():
    plan = {
        'builder': 'nixpacks', 'language': 'go', 'versions': {'go': '1.22'},
        'build_command': 'go build -o /app/server ./...', 'port': 8080,
        'start_command': '/app/server',
    }
    df = BuildpackService.generate_dockerfile(plan)
    assert 'FROM golang:1.22 AS build' in df
    assert 'distroless' in df
    assert 'EXPOSE 8080' in df


def test_generate_dockerfile_static_nginx():
    plan = {'builder': 'static', 'language': 'static', 'port': 80, 'versions': {}}
    df = BuildpackService.generate_dockerfile(plan)
    assert 'FROM nginx:alpine' in df
    assert '/usr/share/nginx/html' in df


def test_generate_dockerfile_present_is_noop():
    plan = {'builder': 'dockerfile-present', 'language': 'node'}
    df = BuildpackService.generate_dockerfile(plan)
    assert 'already provides a Dockerfile' in df


def test_generate_dockerfile_unknown():
    plan = {'builder': 'unknown'}
    df = BuildpackService.generate_dockerfile(plan)
    assert 'Unable to generate' in df


def test_generate_compose():
    plan = {'builder': 'nixpacks', 'language': 'node', 'port': 3000, 'versions': {}}
    compose = BuildpackService.generate_compose(plan, 'My App!')
    assert 'services:' in compose
    assert 'my-app' in compose
    assert '"3000:3000"' in compose


# --------------------------------------------------------------------------- #
# apply_overrides()
# --------------------------------------------------------------------------- #
def test_apply_overrides_merges():
    plan = {
        'builder': 'nixpacks', 'language': 'node', 'versions': {'node': '18'},
        'build_command': 'npm run build', 'start_command': 'node index.js',
        'port': 3000, 'notes': [],
    }
    merged = BuildpackService.apply_overrides(plan, {
        'node_version': '20',
        'build_command': 'npm run compile',
        'start_command': 'node dist/main.js',
        'port': 8080,
    })
    assert merged['versions']['node'] == '20'
    assert merged['build_command'] == 'npm run compile'
    assert merged['start_command'] == 'node dist/main.js'
    assert merged['port'] == 8080
    # Original plan must be untouched (non-mutating).
    assert plan['versions']['node'] == '18'
    assert plan['port'] == 3000


def test_apply_overrides_none_is_safe():
    plan = {'builder': 'nixpacks', 'language': 'go', 'versions': {'go': '1.22'}}
    merged = BuildpackService.apply_overrides(plan, None)
    assert merged['versions']['go'] == '1.22'


def test_apply_overrides_bad_port_ignored():
    plan = {'builder': 'nixpacks', 'port': 3000, 'versions': {}}
    merged = BuildpackService.apply_overrides(plan, {'port': 'not-a-number'})
    assert merged['port'] == 3000


# --------------------------------------------------------------------------- #
# cache key
# --------------------------------------------------------------------------- #
def test_plan_cache_key_stable_and_distinct():
    k1 = BuildpackService.plan_cache_key('https://github.com/a/b.git', 'abc')
    k2 = BuildpackService.plan_cache_key('https://github.com/a/b.git', 'abc')
    k3 = BuildpackService.plan_cache_key('https://github.com/a/b.git', 'def')
    assert k1 == k2
    assert k1 != k3
    assert k1.startswith('buildpack:plan:')


# --------------------------------------------------------------------------- #
# PHP / Laravel image
# --------------------------------------------------------------------------- #
def _laravel_repo(tmp_path):
    (tmp_path / 'composer.json').write_text(json.dumps({
        'require': {'php': '^8.2', 'laravel/framework': '^11.0'},
    }), encoding='utf-8')
    (tmp_path / 'artisan').write_text('#!/usr/bin/env php\n', encoding='utf-8')
    (tmp_path / 'public').mkdir()
    return tmp_path


def test_detect_laravel_still_detected_and_serves_public(tmp_path):
    plan = BuildpackService.detect(str(_laravel_repo(tmp_path)))

    assert plan['language'] == 'php'
    assert plan['framework'] == 'laravel'
    assert plan['docroot'] == 'public'
    assert 'php -S' not in plan['start_command']


def test_php_dockerfile_does_not_swallow_failures(tmp_path):
    plan = BuildpackService.detect(str(_laravel_repo(tmp_path)))
    dockerfile = BuildpackService.generate_dockerfile(plan)

    assert '|| true' not in dockerfile
    assert 'composer install --no-dev' in dockerfile
    # Composer comes from the official image, not a piped installer.
    assert 'getcomposer.org/installer' not in dockerfile


def test_php_dockerfile_has_laravel_extensions(tmp_path):
    plan = BuildpackService.detect(str(_laravel_repo(tmp_path)))
    dockerfile = BuildpackService.generate_dockerfile(plan)

    for ext in ('pdo_mysql', 'bcmath', 'intl', 'zip', 'exif', 'pcntl', 'gd', 'opcache'):
        assert ext in dockerfile
    assert 'FROM php:8.3-fpm' in dockerfile


def test_php_dockerfile_uses_fpm_and_nginx_with_public_docroot(tmp_path):
    plan = BuildpackService.detect(str(_laravel_repo(tmp_path)))
    dockerfile = BuildpackService.generate_dockerfile(plan)

    assert 'php -S' not in dockerfile
    assert 'root /var/www/html/public;' in dockerfile
    assert 'fastcgi_pass 127.0.0.1:9000;' in dockerfile
    assert 'command=php-fpm -F' in dockerfile
    assert 'supervisord' in dockerfile.splitlines()[-1]


def test_php_dockerfile_plain_repo_serves_root(tmp_path):
    (tmp_path / 'composer.json').write_text('{}', encoding='utf-8')
    dockerfile = BuildpackService.generate_dockerfile(BuildpackService.detect(str(tmp_path)))

    assert 'root /var/www/html;' in dockerfile
    assert '|| true' not in dockerfile


def test_php_dockerfile_upgrades_legacy_persisted_plan():
    legacy = {'language': 'php', 'port': 8080, 'versions': {'php': '8.3'},
              'build_command': 'composer install',
              'start_command': 'php -S 0.0.0.0:8080 -t public'}
    dockerfile = BuildpackService.generate_dockerfile(legacy)

    assert 'php -S' not in dockerfile
    assert 'root /var/www/html/public;' in dockerfile
