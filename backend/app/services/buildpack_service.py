"""
Buildpack Service — zero-Dockerfile, transparent build planning.

Where ``build_service.py`` shells out to nixpacks (an opaque external binary),
this service produces a *transparent* build plan from a cloned repository:

  * ``detect(repo_path)``       — pure, filesystem-only stack detection.
  * ``generate_dockerfile(plan)`` — a readable Dockerfile for the detected stack.
  * ``generate_compose(plan, name)`` — a compose wrapper for the generated image.
  * ``apply_overrides(plan, overrides)`` — merge user tweaks onto a plan.

Everything here is deterministic and side-effect free: it reads files and
returns strings/dicts. It NEVER executes a build, clones, or runs a container —
that is the job of the API layer (clone) and ``build_service`` (docker build).

The plan dict shape (the contract the API + UI rely on):

    {
        'builder':        'nixpacks' | 'static' | 'dockerfile-present' | 'unknown',
        'language':       str | None,
        'framework':      str | None,
        'versions':       {'node': '20', 'python': '3.11', ...},
        'build_command':  str | None,
        'start_command':  str | None,
        'port':           int | None,
        'confidence':     float,   # 0.0–1.0
        'notes':          [str, ...],
    }

``builder`` semantics:
  * ``dockerfile-present`` — repo already ships a Dockerfile; we defer to it.
  * ``static``             — no server runtime, just files to serve (nginx).
  * ``nixpacks``           — a real language/runtime we can generate for.
  * ``unknown``            — no confident match; caller should ask the user.
"""

import json
import os
import re
import hashlib
from typing import Dict, List, Optional

from app.services.cache_service import CacheService


class BuildpackService:
    """Transparent build-pack detection and Dockerfile/compose generation."""

    # Cache TTL for a (repo_url, commit) detection result.
    CACHE_TTL = 1800  # 30 minutes

    # Sane defaults baked into generated Dockerfiles when the repo gives no hint.
    DEFAULT_NODE_VERSION = '20'
    DEFAULT_PYTHON_VERSION = '3.11'
    DEFAULT_GO_VERSION = '1.22'
    DEFAULT_PHP_VERSION = '8.3'
    PHP_START_COMMAND = 'supervisord -n -c /etc/supervisor/serverkit.conf'
    DEFAULT_PORT = 3000

    # ------------------------------------------------------------------ #
    # Detection
    # ------------------------------------------------------------------ #
    @classmethod
    def detect(cls, repo_path: str) -> Dict:
        """Inspect a cloned repo and return a build plan.

        Pure / filesystem-only / deterministic — safe to unit-test with a temp
        directory full of marker files.
        """
        plan = {
            'builder': 'unknown',
            'language': None,
            'framework': None,
            'versions': {},
            'build_command': None,
            'start_command': None,
            'port': None,
            'confidence': 0.0,
            'notes': [],
        }

        if not repo_path or not os.path.isdir(repo_path):
            plan['notes'].append('Repository path does not exist or is not a directory.')
            return plan

        try:
            files = set(os.listdir(repo_path))
        except OSError as exc:
            plan['notes'].append(f'Could not read repository: {exc}')
            return plan

        # 1) An existing Dockerfile always wins — we defer to the author's build.
        if 'Dockerfile' in files:
            plan.update({
                'builder': 'dockerfile-present',
                'confidence': 1.0,
            })
            plan['notes'].append('Repository ships a Dockerfile; ServerKit will build it directly.')
            # Still try to name the language for display purposes only.
            lang = cls._guess_language(files)
            if lang:
                plan['language'] = lang
            return plan

        # 2) Language-specific detection, in priority order.
        for detector in (
            cls._detect_node,
            cls._detect_python,
            cls._detect_go,
            cls._detect_php,
            cls._detect_ruby,
            cls._detect_rust,
            cls._detect_static,
        ):
            if detector(repo_path, files, plan):
                break

        # 3) A Procfile, if present, is an authoritative start command.
        cls._apply_procfile(repo_path, files, plan)

        if plan['builder'] == 'unknown':
            plan['notes'].append(
                'No clear language/framework match. Pick a build method manually '
                'or add a Dockerfile.'
            )

        return plan

    # ---- per-language detectors (each returns True if it claimed the repo) ----

    @classmethod
    def _detect_node(cls, repo_path: str, files: set, plan: Dict) -> bool:
        if 'package.json' not in files:
            return False

        pkg = cls._read_json(os.path.join(repo_path, 'package.json')) or {}
        scripts = pkg.get('scripts') or {}
        deps = {**(pkg.get('dependencies') or {}), **(pkg.get('devDependencies') or {})}

        plan['builder'] = 'nixpacks'
        plan['language'] = 'node'
        plan['confidence'] = 0.85

        # Node version from "engines" or .nvmrc.
        node_version = None
        engines = pkg.get('engines') or {}
        if isinstance(engines.get('node'), str):
            m = re.search(r'(\d+)', engines['node'])
            if m:
                node_version = m.group(1)
        if not node_version:
            nvmrc = os.path.join(repo_path, '.nvmrc')
            if os.path.isfile(nvmrc):
                try:
                    with open(nvmrc, 'r', encoding='utf-8') as fh:
                        m = re.search(r'(\d+)', fh.read())
                        if m:
                            node_version = m.group(1)
                except OSError:
                    pass
        plan['versions']['node'] = node_version or cls.DEFAULT_NODE_VERSION

        # Framework + start/build defaults.
        framework = None
        port = None
        if 'next' in deps or any(f in files for f in ('next.config.js', 'next.config.mjs', 'next.config.ts')):
            framework, port = 'nextjs', 3000
            plan['start_command'] = scripts.get('start') or 'next start'
        elif 'nuxt' in deps or 'nuxt3' in deps:
            framework, port = 'nuxt', 3000
            plan['start_command'] = scripts.get('start') or 'node .output/server/index.mjs'
        elif 'vite' in deps:
            framework, port = 'vite', 4173
            # NOT `vite preview`: preview host-checks the request against
            # `preview.allowedHosts` and blocks any domain the repo's vite
            # config doesn't list -- dead on arrival behind the panel's
            # proxy. `serve -s` does SPA fallback, no host check; the
            # generator preinstalls it when the start command needs it.
            plan['start_command'] = (scripts.get('start')
                                     or 'serve -s dist -l tcp://0.0.0.0:4173')
        elif 'express' in deps or 'fastify' in deps or 'koa' in deps:
            framework, port = ('express' if 'express' in deps else 'node'), 3000
            plan['start_command'] = scripts.get('start') or 'node index.js'
        else:
            port = 3000
            plan['start_command'] = scripts.get('start') or 'node index.js'

        plan['framework'] = framework
        plan['port'] = port
        if scripts.get('build'):
            plan['build_command'] = 'npm run build'
        plan['notes'].append(
            f"Detected Node.js{f' ({framework})' if framework else ''}; "
            f"using Node {plan['versions']['node']}."
        )
        return True

    @classmethod
    def _detect_python(cls, repo_path: str, files: set, plan: Dict) -> bool:
        markers = {'requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py'}
        if not (markers & files):
            return False

        plan['builder'] = 'nixpacks'
        plan['language'] = 'python'
        plan['confidence'] = 0.8
        plan['versions']['python'] = cls._python_version(repo_path, files)
        plan['port'] = 8000

        framework, start = cls._python_framework(repo_path, files)
        plan['framework'] = framework
        plan['start_command'] = start

        if 'requirements.txt' in files:
            plan['build_command'] = 'pip install --no-cache-dir -r requirements.txt'
        elif 'pyproject.toml' in files:
            plan['build_command'] = 'pip install --no-cache-dir .'
        elif 'Pipfile' in files:
            plan['build_command'] = 'pip install --no-cache-dir pipenv && pipenv install --system --deploy'

        # The start command above may name a server the buildpack chose
        # itself (gunicorn/uvicorn) -- a repo that never asked for it won't
        # declare it, and the container would die at boot with
        # `gunicorn: not found`. Installing it is a no-op when the repo
        # already pins it.
        server_pkg = (plan['start_command'] or '').split(' ', 1)[0]
        if server_pkg in ('gunicorn', 'uvicorn') and plan.get('build_command'):
            plan['build_command'] += f' && pip install --no-cache-dir {server_pkg}'

        plan['notes'].append(
            f"Detected Python{f' ({framework})' if framework else ''}; "
            f"using Python {plan['versions']['python']}."
        )
        return True

    @classmethod
    def _detect_go(cls, repo_path: str, files: set, plan: Dict) -> bool:
        if 'go.mod' not in files:
            return False
        plan['builder'] = 'nixpacks'
        plan['language'] = 'go'
        plan['confidence'] = 0.8
        plan['versions']['go'] = cls._go_version(repo_path)
        plan['port'] = 8080
        plan['build_command'] = 'go build -o /app/server ./...'
        plan['start_command'] = '/app/server'
        plan['notes'].append(f"Detected Go module; using Go {plan['versions']['go']}.")
        return True

    @classmethod
    def _detect_php(cls, repo_path: str, files: set, plan: Dict) -> bool:
        if 'composer.json' not in files:
            return False
        plan['builder'] = 'nixpacks'
        plan['language'] = 'php'
        plan['confidence'] = 0.7
        plan['versions']['php'] = cls.DEFAULT_PHP_VERSION
        plan['port'] = 8080
        plan['build_command'] = 'composer install --no-dev --no-interaction --optimize-autoloader'

        composer = cls._read_json(os.path.join(repo_path, 'composer.json')) or {}
        require = composer.get('require') or {}
        if 'laravel/framework' in require or 'artisan' in files:
            plan['framework'] = 'laravel'
            plan['notes'].append('Detected Laravel.')
        # Serve the public/ docroot if present, else the repo root. The
        # generated image runs PHP-FPM behind nginx (never `php -S`).
        docroot = 'public' if os.path.isdir(os.path.join(repo_path, 'public')) else '.'
        plan['docroot'] = docroot
        plan['start_command'] = cls.PHP_START_COMMAND
        plan['notes'].append(f"Detected PHP; using PHP {plan['versions']['php']}.")
        return True

    @classmethod
    def _detect_ruby(cls, repo_path: str, files: set, plan: Dict) -> bool:
        if 'Gemfile' not in files:
            return False
        plan['builder'] = 'nixpacks'
        plan['language'] = 'ruby'
        plan['confidence'] = 0.65
        plan['versions']['ruby'] = '3.3'
        plan['port'] = 3000
        plan['build_command'] = 'bundle install'
        if 'config.ru' in files or os.path.isfile(os.path.join(repo_path, 'bin', 'rails')):
            plan['framework'] = 'rails'
            plan['start_command'] = 'bundle exec rails server -b 0.0.0.0 -p 3000'
        else:
            plan['start_command'] = 'bundle exec ruby app.rb'
        plan['notes'].append('Detected Ruby.')
        return True

    @classmethod
    def _detect_rust(cls, repo_path: str, files: set, plan: Dict) -> bool:
        if 'Cargo.toml' not in files:
            return False
        plan['builder'] = 'nixpacks'
        plan['language'] = 'rust'
        plan['confidence'] = 0.7
        plan['versions']['rust'] = '1'
        plan['port'] = 8080
        plan['build_command'] = 'cargo build --release'
        plan['start_command'] = './target/release/app'
        plan['notes'].append('Detected Rust crate.')
        return True

    @classmethod
    def _detect_static(cls, repo_path: str, files: set, plan: Dict) -> bool:
        # Only treat as static if there's an index.html and no server runtime.
        if 'index.html' not in files and not os.path.isdir(os.path.join(repo_path, 'public')):
            return False
        plan['builder'] = 'static'
        plan['language'] = 'static'
        plan['framework'] = None
        plan['confidence'] = 0.6
        plan['port'] = 80
        plan['start_command'] = "nginx -g 'daemon off;'"
        plan['notes'].append('Detected a static site; will be served with nginx.')
        return True

    # ------------------------------------------------------------------ #
    # Detection helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def _read_json(path: str) -> Optional[Dict]:
        try:
            with open(path, 'r', encoding='utf-8') as fh:
                return json.load(fh)
        except (OSError, json.JSONDecodeError):
            return None

    @classmethod
    def _guess_language(cls, files: set) -> Optional[str]:
        """Best-effort language label (display only, used for dockerfile-present)."""
        if 'package.json' in files:
            return 'node'
        if {'requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py'} & files:
            return 'python'
        if 'go.mod' in files:
            return 'go'
        if 'composer.json' in files:
            return 'php'
        if 'Gemfile' in files:
            return 'ruby'
        if 'Cargo.toml' in files:
            return 'rust'
        return None

    @classmethod
    def _python_version(cls, repo_path: str, files: set) -> str:
        # .python-version takes precedence.
        pv = os.path.join(repo_path, '.python-version')
        if os.path.isfile(pv):
            try:
                with open(pv, 'r', encoding='utf-8') as fh:
                    m = re.search(r'(\d+\.\d+)', fh.read())
                    if m:
                        return m.group(1)
            except OSError:
                pass
        # pyproject.toml requires-python (e.g. ">=3.11").
        if 'pyproject.toml' in files:
            try:
                with open(os.path.join(repo_path, 'pyproject.toml'), 'r', encoding='utf-8') as fh:
                    m = re.search(r'requires-python\s*=\s*["\'][^0-9]*(\d+\.\d+)', fh.read())
                    if m:
                        return m.group(1)
            except OSError:
                pass
        return cls.DEFAULT_PYTHON_VERSION

    @classmethod
    def _python_framework(cls, repo_path: str, files: set):
        """Return (framework, start_command) for a Python repo."""
        reqs = ''
        for fname in ('requirements.txt', 'pyproject.toml', 'Pipfile'):
            fpath = os.path.join(repo_path, fname)
            if os.path.isfile(fpath):
                try:
                    with open(fpath, 'r', encoding='utf-8') as fh:
                        reqs += fh.read().lower()
                except OSError:
                    pass

        if 'manage.py' in files or 'django' in reqs:
            wsgi_module = cls._django_wsgi_module(repo_path)
            return 'django', f'gunicorn --bind 0.0.0.0:8000 {wsgi_module}.wsgi'
        if 'fastapi' in reqs:
            return 'fastapi', 'uvicorn main:app --host 0.0.0.0 --port 8000'
        if 'flask' in reqs:
            return 'flask', 'gunicorn --bind 0.0.0.0:8000 app:app'
        return None, 'python main.py'

    @staticmethod
    def _django_wsgi_module(repo_path: str) -> str:
        """Find the Django project package (the dir containing wsgi.py)."""
        try:
            for entry in sorted(os.listdir(repo_path)):
                wsgi = os.path.join(repo_path, entry, 'wsgi.py')
                if os.path.isfile(wsgi):
                    return entry
        except OSError:
            pass
        return 'app'

    @classmethod
    def _go_version(cls, repo_path: str) -> str:
        try:
            with open(os.path.join(repo_path, 'go.mod'), 'r', encoding='utf-8') as fh:
                m = re.search(r'^go\s+(\d+\.\d+)', fh.read(), re.MULTILINE)
                if m:
                    return m.group(1)
        except OSError:
            pass
        return cls.DEFAULT_GO_VERSION

    @classmethod
    def _apply_procfile(cls, repo_path: str, files: set, plan: Dict) -> None:
        """A Procfile ``web:`` line overrides the inferred start command; the
        other long-running lines become ``plan['processes']``,
        run as sibling containers of the same image at deploy."""
        if 'Procfile' not in files:
            return
        from app.services.worker_process_service import parse_procfile, worker_processes
        try:
            with open(os.path.join(repo_path, 'Procfile'), 'r', encoding='utf-8') as fh:
                text = fh.read()
        except OSError:
            return
        web = parse_procfile(text).get('web')
        if web:
            plan['start_command'] = web
            plan['notes'].append('Start command taken from Procfile (web:).')
            if plan['builder'] == 'unknown':
                plan['builder'] = 'nixpacks'
                plan['confidence'] = max(plan['confidence'], 0.5)
        workers = worker_processes(text)
        if workers:
            plan['processes'] = dict(workers)
            plan['notes'].append(
                'Procfile processes run alongside the web process: '
                + ', '.join(workers) + '.')

    # ------------------------------------------------------------------ #
    # Overrides
    # ------------------------------------------------------------------ #
    @classmethod
    def apply_overrides(cls, plan: Dict, overrides: Optional[Dict]) -> Dict:
        """Merge user overrides onto a plan, returning a NEW plan (non-mutating).

        Recognized override keys: node_version, python_version, go_version,
        php_version, build_command, start_command, port.
        """
        merged = json.loads(json.dumps(plan or {}))  # deep copy via JSON
        merged.setdefault('versions', {})
        merged.setdefault('notes', [])
        if not overrides:
            return merged

        version_keys = {
            'node_version': 'node',
            'python_version': 'python',
            'go_version': 'go',
            'php_version': 'php',
            'ruby_version': 'ruby',
            'rust_version': 'rust',
        }
        for ov_key, lang_key in version_keys.items():
            val = overrides.get(ov_key)
            if val:
                merged['versions'][lang_key] = str(val)

        if overrides.get('build_command') is not None:
            merged['build_command'] = overrides['build_command'] or None
        if overrides.get('start_command') is not None:
            merged['start_command'] = overrides['start_command'] or None
        if overrides.get('port') not in (None, ''):
            try:
                merged['port'] = int(overrides['port'])
            except (TypeError, ValueError):
                pass

        merged['overridden'] = True
        return merged

    # ------------------------------------------------------------------ #
    # Generation
    # ------------------------------------------------------------------ #
    @classmethod
    def generate_dockerfile(cls, plan: Dict) -> str:
        """Return a Dockerfile string for the detected stack.

        Never executes anything — pure string generation.
        """
        plan = plan or {}
        language = (plan.get('language') or '').lower()
        builder = plan.get('builder')

        if builder == 'dockerfile-present':
            return (
                '# Repository already provides a Dockerfile.\n'
                '# ServerKit will build that file directly; no generation needed.\n'
            )

        if language == 'node':
            return cls._dockerfile_node(plan)
        if language == 'python':
            return cls._dockerfile_python(plan)
        if language == 'go':
            return cls._dockerfile_go(plan)
        if language == 'php':
            return cls._dockerfile_php(plan)
        if language == 'static' or builder == 'static':
            return cls._dockerfile_static(plan)
        if language == 'ruby':
            return cls._dockerfile_ruby(plan)
        if language == 'rust':
            return cls._dockerfile_rust(plan)

        return (
            '# Unable to generate a Dockerfile: the build pack could not confidently\n'
            '# detect this stack. Add a Dockerfile or choose a build method manually.\n'
        )

    @classmethod
    def _port(cls, plan: Dict) -> int:
        port = plan.get('port')
        try:
            return int(port) if port else cls.DEFAULT_PORT
        except (TypeError, ValueError):
            return cls.DEFAULT_PORT

    @classmethod
    def _dockerfile_node(cls, plan: Dict) -> str:
        version = plan.get('versions', {}).get('node', cls.DEFAULT_NODE_VERSION)
        port = cls._port(plan)
        build = plan.get('build_command')
        start = plan.get('start_command') or 'node index.js'
        lines = [
            f'# syntax=docker/dockerfile:1',
            f'FROM node:{version}-slim',
            'WORKDIR /app',
            # Locally installed CLIs (vite, next, nest, ...) live in
            # node_modules/.bin, which is not on PATH for RUN/CMD.
            'ENV PATH=/app/node_modules/.bin:$PATH',
            # Browser-driver postinstalls each fetch a few hundred MB of
            # Chrome into the build layer (puppeteer alone is ~500MB). A
            # production build never drives a browser, and on a small host
            # that download is what fills the disk mid-export -- opt out.
            'ENV PUPPETEER_SKIP_DOWNLOAD=1 '
            'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 '
            'CYPRESS_INSTALL_BINARY=0',
            'COPY package*.json ./',
        ]
        if build:
            # Build tooling (vite, tsc, webpack) is almost always a
            # devDependency, and so is the server for preview-style start
            # commands -- install the full dependency set. `--omit=dev`
            # exits 0, so a `|| npm install` fallback would never fire.
            lines.append('RUN npm install')
        else:
            lines.append('RUN npm install --omit=dev || npm install')
        lines.append('COPY . .')
        if build:
            lines.append(f'RUN {build}')
        if start.split(' ', 1)[0] == 'serve':
            # The buildpack chose `serve` itself (vite default) -- the repo
            # won't declare it, so preinstall it globally.
            lines.append('RUN npm install -g serve')
        lines += [
            'ENV NODE_ENV=production',
            f'EXPOSE {port}',
            f'CMD {cls._cmd(start)}',
        ]
        return '\n'.join(lines) + '\n'

    @classmethod
    def _dockerfile_python(cls, plan: Dict) -> str:
        version = plan.get('versions', {}).get('python', cls.DEFAULT_PYTHON_VERSION)
        port = cls._port(plan)
        build = plan.get('build_command') or 'pip install --no-cache-dir -r requirements.txt'
        start = plan.get('start_command') or 'python main.py'
        lines = [
            f'# syntax=docker/dockerfile:1',
            f'FROM python:{version}-slim',
            'WORKDIR /app',
            'ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1',
            'COPY . .',
            f'RUN {build}',
            f'EXPOSE {port}',
            f'CMD {cls._cmd(start)}',
        ]
        return '\n'.join(lines) + '\n'

    @classmethod
    def _dockerfile_go(cls, plan: Dict) -> str:
        version = plan.get('versions', {}).get('go', cls.DEFAULT_GO_VERSION)
        port = cls._port(plan)
        build = plan.get('build_command') or 'go build -o /app/server ./...'
        lines = [
            f'# syntax=docker/dockerfile:1',
            f'FROM golang:{version} AS build',
            'WORKDIR /src',
            'COPY go.* ./',
            'RUN go mod download',
            'COPY . .',
            f'RUN {build}',
            '',
            'FROM gcr.io/distroless/base-debian12',
            'COPY --from=build /app/server /app/server',
            f'EXPOSE {port}',
            'ENTRYPOINT ["/app/server"]',
        ]
        return '\n'.join(lines) + '\n'

    # Extensions Laravel (and most Composer packages) need. ctype, fileinfo,
    # json, mbstring, openssl, tokenizer and xml/dom ship compiled into the
    # official php image, so only the optional ones are built here.
    PHP_EXTENSIONS = (
        'pdo_mysql', 'mysqli', 'bcmath', 'intl', 'zip', 'exif', 'pcntl', 'gd', 'opcache',
    )

    @classmethod
    def _dockerfile_php(cls, plan: Dict) -> str:
        """PHP-FPM + nginx image with Composer; docroot is ``public/`` when present.

        A failing Composer install or build command fails the image build --
        nothing here swallows errors.
        """
        version = plan.get('versions', {}).get('php', cls.DEFAULT_PHP_VERSION)
        port = cls._port(plan)
        build = plan.get('build_command')
        start = plan.get('start_command') or cls.PHP_START_COMMAND
        # A plan persisted before the FPM image existed still carries the old
        # `php -S ... -t <docroot>` start command; recover its docroot and
        # serve it properly instead.
        legacy = re.match(r'php -S \S+ -t (\S+)', start)
        if legacy:
            start = cls.PHP_START_COMMAND
        docroot = plan.get('docroot') or (legacy.group(1) if legacy else '.')
        root = '/var/www/html' if docroot in ('', '.') else f'/var/www/html/{docroot.strip("/")}'

        nginx_conf = '\n'.join([
            'server {',
            f'    listen {port};',
            '    server_name _;',
            f'    root {root};',
            '    index index.php index.html;',
            '    client_max_body_size 64m;',
            '    error_log /dev/stderr;',
            '    access_log /dev/stdout;',
            '    location / {',
            '        try_files $uri $uri/ /index.php?$query_string;',
            '    }',
            '    location ~ \\.php$ {',
            '        include fastcgi_params;',
            '        fastcgi_pass 127.0.0.1:9000;',
            '        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;',
            '        fastcgi_param DOCUMENT_ROOT $realpath_root;',
            '    }',
            '    location ~ /\\.(?!well-known) {',
            '        deny all;',
            '    }',
            '}',
        ])
        supervisor_conf = '\n'.join([
            '[supervisord]',
            'nodaemon=true',
            'user=root',
            'logfile=/dev/null',
            'logfile_maxbytes=0',
            'pidfile=/run/supervisord.pid',
            '',
            '[program:php-fpm]',
            'command=php-fpm -F',
            'autorestart=true',
            'stdout_logfile=/dev/stdout',
            'stdout_logfile_maxbytes=0',
            'stderr_logfile=/dev/stderr',
            'stderr_logfile_maxbytes=0',
            '',
            '[program:nginx]',
            "command=nginx -g 'daemon off;'",
            'autorestart=true',
            'stdout_logfile=/dev/stdout',
            'stdout_logfile_maxbytes=0',
            'stderr_logfile=/dev/stderr',
            'stderr_logfile_maxbytes=0',
        ])
        lines = [
            '# syntax=docker/dockerfile:1',
            f'FROM php:{version}-fpm',
            'RUN apt-get update && apt-get install -y --no-install-recommends '
            'nginx supervisor git unzip libzip-dev libicu-dev libpng-dev '
            'libjpeg-dev libfreetype6-dev libonig-dev libxml2-dev \\',
            ' && docker-php-ext-configure gd --with-freetype --with-jpeg \\',
            f' && docker-php-ext-install -j"$(nproc)" {" ".join(cls.PHP_EXTENSIONS)} \\',
            ' && mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini" \\',
            ' && rm -f /etc/nginx/sites-enabled/default \\',
            ' && rm -rf /var/lib/apt/lists/*',
            'COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer',
            'ENV COMPOSER_ALLOW_SUPERUSER=1 COMPOSER_NO_INTERACTION=1',
            "COPY <<'EOF' /etc/nginx/conf.d/default.conf",
            nginx_conf,
            'EOF',
            "COPY <<'EOF' /etc/supervisor/serverkit.conf",
            supervisor_conf,
            'EOF',
            'WORKDIR /var/www/html',
            'COPY . .',
        ]
        if build:
            lines.append(f'RUN {build}')
        lines += [
            # Laravel writes to storage/ and bootstrap/cache as www-data (FPM).
            'RUN mkdir -p storage bootstrap/cache && chown -R www-data:www-data . '
            '&& chmod -R ug+rwX storage bootstrap/cache',
            f'EXPOSE {port}',
            f'CMD {cls._cmd(start)}',
        ]
        return '\n'.join(lines) + '\n'

    @classmethod
    def _dockerfile_static(cls, plan: Dict) -> str:
        build = plan.get('build_command')
        # If there's a build step (e.g. a static-site generator), build with node
        # then copy the artifacts into nginx.
        if build:
            node_version = plan.get('versions', {}).get('node', cls.DEFAULT_NODE_VERSION)
            return '\n'.join([
                '# syntax=docker/dockerfile:1',
                f'FROM node:{node_version}-slim AS build',
                'WORKDIR /app',
                'COPY package*.json ./',
                'RUN npm install',
                'COPY . .',
                f'RUN {build}',
                '',
                'FROM nginx:alpine',
                'COPY --from=build /app/dist /usr/share/nginx/html',
                'EXPOSE 80',
                'CMD ["nginx", "-g", "daemon off;"]',
            ]) + '\n'
        return '\n'.join([
            '# syntax=docker/dockerfile:1',
            'FROM nginx:alpine',
            'COPY . /usr/share/nginx/html',
            'EXPOSE 80',
            'CMD ["nginx", "-g", "daemon off;"]',
        ]) + '\n'

    @classmethod
    def _dockerfile_ruby(cls, plan: Dict) -> str:
        version = plan.get('versions', {}).get('ruby', '3.3')
        port = cls._port(plan)
        build = plan.get('build_command') or 'bundle install'
        start = plan.get('start_command') or 'bundle exec ruby app.rb'
        return '\n'.join([
            '# syntax=docker/dockerfile:1',
            f'FROM ruby:{version}-slim',
            'WORKDIR /app',
            'COPY . .',
            f'RUN {build}',
            f'EXPOSE {port}',
            f'CMD {cls._cmd(start)}',
        ]) + '\n'

    @classmethod
    def _dockerfile_rust(cls, plan: Dict) -> str:
        version = plan.get('versions', {}).get('rust', '1')
        port = cls._port(plan)
        build = plan.get('build_command') or 'cargo build --release'
        start = plan.get('start_command') or './target/release/app'
        return '\n'.join([
            '# syntax=docker/dockerfile:1',
            f'FROM rust:{version} AS build',
            'WORKDIR /src',
            'COPY . .',
            f'RUN {build}',
            '',
            'FROM debian:bookworm-slim',
            'WORKDIR /app',
            'COPY --from=build /src/target/release/ /app/',
            f'EXPOSE {port}',
            f'CMD {cls._cmd(start)}',
        ]) + '\n'

    @staticmethod
    def _cmd(command: str) -> str:
        """Render a shell command as a Docker CMD exec-form array."""
        return json.dumps(['sh', '-c', command])

    @classmethod
    def generate_compose(cls, plan: Dict, app_name: str, extra_ports: Optional[list] = None,
                         volumes: Optional[list] = None,
                         named_volumes: Optional[list] = None,
                         networks: Optional[list] = None) -> str:
        """Return a docker-compose snippet wrapping the generated image.

        Appliance tier: ``extra_ports`` are raw compose publish
        strings (typed L4 ports) appended to the app's own HTTP port;
        ``volumes`` are service mount specs and ``named_volumes`` declare the
        top-level named volumes they reference.
        """
        plan = plan or {}
        safe_name = re.sub(r'[^a-z0-9_-]', '-', (app_name or 'app').lower()).strip('-') or 'app'
        port = cls._port(plan)
        lines = [
            'services:',
            f'  {safe_name}:',
            '    build:',
            '      context: .',
            '      dockerfile: Dockerfile',
            f'    image: serverkit-{safe_name}:latest',
            '    restart: unless-stopped',
            '    ports:',
            f'      - "{port}:{port}"',
        ]
        for spec in (extra_ports or []):
            lines.append(f'      - "{spec}"')
        if volumes:
            lines.append('    volumes:')
            for spec in volumes:
                lines.append(f'      - "{spec}"')
        if networks:
            lines.append('    networks:')
            for net in networks:
                lines.append(f'      - {net}')
        for process, command in ((plan.get('processes') or {}).items()):
            # Same image, the Procfile command, no port.
            lines += [
                f'  {safe_name}-{process}:',
                f'    image: serverkit-{safe_name}:latest',
                '    restart: unless-stopped',
                f'    command: {json.dumps(["sh", "-c", command])}',
            ]
        if named_volumes:
            lines.append('volumes:')
            for name in named_volumes:
                lines.append(f'  {name}: {{}}')
        if networks:
            lines.append('networks:')
            for net in networks:
                lines.append(f'  {net}:')
                lines.append('    external: true')
        return '\n'.join(lines) + '\n'

    # ------------------------------------------------------------------ #
    # Caching
    # ------------------------------------------------------------------ #
    @classmethod
    def plan_cache_key(cls, repo_url: str, commit: Optional[str] = None) -> str:
        """Stable cache key for a (repo, commit) detection result."""
        raw = f'{repo_url or ""}@{commit or "HEAD"}'
        digest = hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]
        return f'buildpack:plan:{digest}'

    @classmethod
    def get_cached_plan(cls, repo_url: str, commit: Optional[str] = None) -> Optional[Dict]:
        return CacheService.get(cls.plan_cache_key(repo_url, commit))

    @classmethod
    def cache_plan(cls, repo_url: str, plan: Dict, commit: Optional[str] = None) -> None:
        CacheService.set(cls.plan_cache_key(repo_url, commit), plan, ttl=cls.CACHE_TTL)
