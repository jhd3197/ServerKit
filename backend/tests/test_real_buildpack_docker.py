"""Generated Dockerfiles through the REAL docker daemon.

test_buildpacks.py asserts on the generated Dockerfile *text*; nothing ever
executed one, so a generation bug that only fails at build or boot time
(the `npm install --omit=dev || npm install` dead fallback — `--omit=dev`
exits 0, so `npm run build` died with `vite: not found` on a user's box)
sailed through the suite. Each test here runs the full deploy path over a
minimal fixture repo: detect() -> generate_dockerfile() -> `docker build`
-> `docker run` -> HTTP 200 from the plan's port.

Real image pulls and builds — gated like the real-binaries leg, behind its
own opt-in (docker works on any dev OS, so no Linux skip). Run with:

    SERVERKIT_DOCKER_BUILDS=1 pytest tests -m docker_builds
"""
import json
import os
import shutil
import subprocess
import time
import urllib.request
import uuid

import pytest

from app.services.buildpack_service import BuildpackService


def _docker_ready() -> bool:
    if shutil.which('docker') is None:
        return False
    try:
        return subprocess.run(
            ['docker', 'info'], capture_output=True, timeout=20,
        ).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


pytestmark = [
    pytest.mark.docker_builds,
    pytest.mark.skipif(os.environ.get('SERVERKIT_DOCKER_BUILDS') != '1',
                       reason='docker-builds leg; opt in with '
                              'SERVERKIT_DOCKER_BUILDS=1'),
    pytest.mark.skipif(not _docker_ready(),
                       reason='docker daemon not reachable'),
]


def _write(root, files):
    for rel, content in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding='utf-8')


def _deploy_and_probe(repo_path, expect_language, expect_framework=None,
                      probe_path='/'):
    """detect -> generate -> build -> run -> HTTP GET, with full teardown.

    Returns (plan, response_body). Any failing stage raises with the docker
    output attached so the build log is readable in the pytest report.
    """
    plan = BuildpackService.detect(str(repo_path))
    assert plan['language'] == expect_language, plan
    if expect_framework is not None:
        assert plan['framework'] == expect_framework, plan

    dockerfile = BuildpackService.generate_dockerfile(plan)
    (repo_path / 'Dockerfile.serverkit').write_text(dockerfile,
                                                    encoding='utf-8')

    tag = f'sk-buildpack-smoke-{uuid.uuid4().hex[:12]}'
    build = subprocess.run(
        ['docker', 'build', '-f', str(repo_path / 'Dockerfile.serverkit'),
         '-t', tag, str(repo_path)],
        # Docker emits UTF-8 build logs even when Windows uses a legacy locale.
        capture_output=True, text=True, encoding='utf-8', errors='replace',
        timeout=600,
    )
    try:
        assert build.returncode == 0, (
            f'docker build failed for generated Dockerfile:\n{dockerfile}\n'
            f'--- stderr ---\n{build.stderr[-4000:]}'
        )

        # Static plans EXPOSE 80 via nginx; others use the plan port.
        port = 80 if plan['language'] == 'static' else plan['port']
        run = subprocess.run(
            ['docker', 'run', '-d', '--rm', '--name', tag,
             '-p', f'127.0.0.1:0:{port}', tag],
            capture_output=True, text=True, encoding='utf-8', errors='replace',
            timeout=60,
        )
        assert run.returncode == 0, run.stderr
        try:
            mapped = subprocess.run(
                ['docker', 'port', tag, str(port)],
                capture_output=True, text=True, encoding='utf-8', errors='replace',
                timeout=20,
            ).stdout.strip().splitlines()[0]  # e.g. 127.0.0.1:49321
            url = f'http://{mapped}{probe_path}'

            body = None
            for _ in range(30):
                try:
                    with urllib.request.urlopen(url, timeout=2) as resp:
                        assert resp.status == 200
                        body = resp.read().decode('utf-8', 'replace')
                        break
                except (OSError, AssertionError):
                    time.sleep(1)
            if body is not None:
                # Behind the panel's proxy the request carries the app's
                # DOMAIN as Host, not 127.0.0.1 -- a server that host-checks
                # (vite preview's preview.allowedHosts) answers localhost
                # probes fine and blocks every real visitor. Every generated
                # container must serve regardless of Host.
                req = urllib.request.Request(
                    url, headers={'Host': 'app.example.com'})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    assert resp.status == 200, (
                        'container refused a foreign Host header -- it would '
                        'block every request forwarded by the panel proxy'
                    )
                    foreign_body = resp.read().decode('utf-8', 'replace')
                assert 'not allowed' not in foreign_body.lower(), (
                    'container host-blocked the proxied domain: '
                    + foreign_body[:300]
                )
            if body is None:
                logs = subprocess.run(
                    ['docker', 'logs', tag],
                    capture_output=True, text=True, encoding='utf-8', errors='replace',
                    timeout=20,
                )
                raise AssertionError(
                    f'container never answered {url}; logs:\n'
                    f'{logs.stdout[-2000:]}\n{logs.stderr[-2000:]}'
                )
            return plan, body
        finally:
            subprocess.run(['docker', 'stop', tag],
                           capture_output=True, timeout=60)
    finally:
        subprocess.run(['docker', 'rmi', '-f', tag],
                       capture_output=True, timeout=60)


def test_node_vite_build_and_serve(tmp_path):
    """The gods-eye-view regressions: vite is a devDependency the build
    needs at build time, and the container must answer requests for the
    app's real domain -- `vite preview` host-blocked everything the panel
    proxy forwarded (the helper's foreign-Host probe pins that)."""
    _write(tmp_path, {
        'package.json': json.dumps({
            'name': 'vite-smoke', 'version': '0.1.0', 'private': True,
            'scripts': {'dev': 'vite', 'build': 'vite build',
                        'preview': 'vite preview'},
            'devDependencies': {'vite': '^6.0.0'},
        }),
        'index.html': (
            '<!doctype html><html><head><title>vite-smoke</title></head>'
            '<body><div id="app"></div>'
            '<script type="module" src="/src/main.js"></script>'
            '</body></html>'
        ),
        'src/main.js':
            "document.getElementById('app').textContent = 'ok';\n",
    })
    plan, body = _deploy_and_probe(tmp_path, 'node', 'vite')
    assert plan['build_command'] == 'npm run build'
    assert plan['start_command'].startswith('serve ')
    assert 'vite-smoke' in body


def test_node_express_no_build_prod_install(tmp_path):
    """No build step -> the production-only install branch must still yield
    a bootable server (runtime deps are NOT dev deps here)."""
    _write(tmp_path, {
        'package.json': json.dumps({
            'name': 'express-smoke', 'version': '0.1.0', 'private': True,
            'scripts': {'start': 'node server.js'},
            'dependencies': {'express': '^4.19.0'},
        }),
        'server.js': (
            "const app = require('express')();\n"
            "app.get('/', (_req, res) => res.send('express-smoke-ok'));\n"
            "app.listen(3000, '0.0.0.0');\n"
        ),
    })
    plan, body = _deploy_and_probe(tmp_path, 'node', 'express')
    assert plan['build_command'] is None
    assert 'express-smoke-ok' in body


def test_python_flask_gunicorn_not_declared(tmp_path):
    """The buildpack invents `gunicorn app:app` as the start command; a repo
    that never asked for gunicorn doesn't declare it, so the build command
    must install it or the container dies at boot with
    `gunicorn: not found` -- same dead-at-boot class as the vite bug."""
    _write(tmp_path, {
        'requirements.txt': 'flask\n',  # deliberately NO gunicorn
        'app.py': (
            'from flask import Flask\n'
            'app = Flask(__name__)\n\n'
            "@app.route('/')\n"
            'def index():\n'
            "    return 'flask-smoke-ok'\n"
        ),
    })
    plan, body = _deploy_and_probe(tmp_path, 'python', 'flask')
    assert plan['start_command'].startswith('gunicorn')
    assert 'flask-smoke-ok' in body


def test_static_site(tmp_path):
    _write(tmp_path, {
        'index.html': '<!doctype html><title>static-smoke</title>'
                      '<p>static-smoke-ok</p>',
    })
    plan, body = _deploy_and_probe(tmp_path, 'static')
    assert 'static-smoke-ok' in body


def test_php_laravel_layout_served_by_fpm_from_public(tmp_path):
    """Laravel-shaped repo: composer.json + artisan + public/. The image must
    build (Composer failures are fatal now), serve public/ through nginx +
    PHP-FPM, and load every extension Laravel needs."""
    _write(tmp_path, {
        # artisan flips detection to Laravel; no Composer packages are needed.
        'composer.json': json.dumps({
            'name': 'smoke/laravel-ish',
            'require': {'php': '>=8.2'},
            'extra': {'laravel': {}},
        }),
        'artisan': '#!/usr/bin/env php\n',
        'public/index.php': (
            "<?php $need = ['pdo_mysql','mbstring','tokenizer','xml','ctype',"
            "'json','bcmath','openssl','fileinfo','intl','zip','exif','pcntl',"
            "'gd','Zend OPcache'];\n"
            "$missing = array_filter($need, fn($e) => !extension_loaded($e));\n"
            "echo 'php-smoke-ok ' . ($missing ? 'missing:' . implode(',', $missing) : 'ext-ok');\n"
        ),
    })
    plan, body = _deploy_and_probe(tmp_path, 'php')
    assert plan['framework'] == 'laravel'  # via the artisan file
    assert 'php -S' not in plan['start_command']
    assert 'php-smoke-ok ext-ok' in body
