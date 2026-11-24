"""Scaffold a brand-new project from a registered framework and deploy it.

"Start from a framework" in the New Service wizard lands here. For Laravel the
job (a registered deployment kind, so it gets the Deploy Console, logs and
retry for free) does, in order:

1. ``composer create-project`` into a ServerKit-managed app directory. Composer
   runs in the official ``composer`` container, so the host needs Docker but
   not PHP; a host ``composer`` + ``php`` is used only when Docker is absent.
2. Writes the Dockerfile (the shared PHP-FPM + nginx image from
   ``BuildpackService``), a ``.dockerignore`` and a production ``.env`` from
   ``.env.example`` with a fresh ``APP_KEY``.
3. Installs the MySQL engine template as ``<name>-db`` (the same primitives the
   manifest applier uses for engines) and wires ``DB_*`` onto the app as
   ``fromService`` env references, so no password is typed or stored in files.
4. Builds and starts the app, then runs ``php artisan migrate --force`` in the
   container once the database accepts connections. A failed migration fails
   the job; it is never swallowed.

All subprocess work goes through :meth:`FrameworkScaffoldService._run`, which
tests replace with :meth:`set_runner`.
"""

import base64
import logging
import os
import re
import shutil
import time
from typing import Any, Callable, Dict, List, Optional

from app import db, paths
from app.models.application import Application
from app.services.buildpack_service import BuildpackService
from app.services.framework_registry import COMPOSER_IMAGE, get_framework
from app.utils.slug import slugify

logger = logging.getLogger(__name__)

JOB_KIND = 'framework.scaffold'

_HOST_RE = re.compile(
    r'^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$')

STEPS = [
    'Scaffold project', 'Write image and environment', 'Provision database',
    'Build and start', 'Run migrations',
]


class FrameworkError(ValueError):
    """A request the picker cannot satisfy (bad name, unknown framework, ...)."""


class FrameworkScaffoldService:

    _runner: Optional[Callable] = None  # test seam

    # ------------------------------------------------------------------ #
    # Subprocess boundary
    # ------------------------------------------------------------------ #
    @classmethod
    def set_runner(cls, fn: Optional[Callable]) -> None:
        """Install/clear a fake runner ``fn(cmd, cwd=None, timeout=None)``
        returning the ``run_checked`` result shape."""
        cls._runner = fn

    @classmethod
    def _run(cls, cmd: List[str], cwd: Optional[str] = None,
             timeout: int = 600) -> Dict[str, Any]:
        if cls._runner is not None:
            return cls._runner(cmd, cwd=cwd, timeout=timeout)
        from app.utils.system import run_checked
        return run_checked(cmd, cwd=cwd, timeout=timeout, merge_stderr=True)

    # ------------------------------------------------------------------ #
    # Pure helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def generate_app_key() -> str:
        """Same format as ``php artisan key:generate`` (AES-256-CBC key)."""
        return 'base64:' + base64.b64encode(os.urandom(32)).decode('ascii')

    @staticmethod
    def render_env(example: str, values: Dict[str, str]) -> str:
        """Overlay ``values`` onto ``.env.example`` text.

        An existing ``KEY=`` (or commented ``# KEY=``) line is replaced in place;
        keys the template lacks are appended.
        """
        lines = example.splitlines()
        pending = dict(values)
        for i, line in enumerate(lines):
            m = re.match(r'^\s*#?\s*([A-Z][A-Z0-9_]*)=', line)
            if m and m.group(1) in pending:
                lines[i] = f'{m.group(1)}={pending.pop(m.group(1))}'
        lines += [f'{k}={v}' for k, v in pending.items()]
        return '\n'.join(lines) + '\n'

    @staticmethod
    def database_service_name(app_name: str, fw: Dict[str, Any]) -> str:
        return f"{app_name}{fw['database']['name_suffix']}"

    @classmethod
    def build_plan(cls, fw: Dict[str, Any], port: int) -> Dict[str, Any]:
        """Buildpack plan for the scaffold: the same plan ``detect()`` yields
        for a Laravel repo, with the framework's pinned PHP and our port."""
        scaffold = fw['scaffold']
        return {
            'language': fw['language'],
            'framework': fw['id'],
            'builder': 'dockerfile',
            'port': port,
            'docroot': fw['docroot'],
            'versions': {'php': scaffold['php_version']},
            'build_command': 'composer install --no-dev --no-interaction --optimize-autoloader',
            'start_command': BuildpackService.PHP_START_COMMAND,
        }

    @staticmethod
    def validate_domain(domain: Optional[str]) -> Optional[str]:
        domain = (domain or '').strip().lower()
        if not domain:
            return None
        if '://' in domain:
            domain = domain.split('://', 1)[1]
        domain = domain.split('/', 1)[0]
        if not _HOST_RE.match(domain):
            raise FrameworkError(f'"{domain}" is not a valid domain name')
        return domain

    # ------------------------------------------------------------------ #
    # Request -> job
    # ------------------------------------------------------------------ #
    @classmethod
    def start(cls, *, framework_id: str, name: str, user_id: Optional[int],
              domain: Optional[str] = None, add_database: Optional[bool] = None,
              project_id: Optional[int] = None, environment_id: Optional[int] = None,
              workspace_id: Optional[int] = None,
              public_host: Optional[str] = None) -> Dict[str, Any]:
        """Validate, create the Application row and queue the scaffold job."""
        fw = get_framework(framework_id)
        if fw is None:
            raise FrameworkError(f'Unknown or unavailable framework "{framework_id}"')

        name = slugify(name)
        if len(name) < 2:
            raise FrameworkError('Service name must be at least 2 characters')
        domain = cls.validate_domain(domain)
        if add_database is None:
            add_database = bool(fw['database']['default'])
        add_database = bool(add_database) and bool(fw.get('database'))

        names = [name] + ([cls.database_service_name(name, fw)] if add_database else [])
        for candidate in names:
            clash = Application.name_clash_error(candidate)
            if clash:
                raise FrameworkError(clash)

        base_dir = os.path.abspath(paths.APPS_DIR)
        app_path = os.path.abspath(os.path.join(base_dir, name))
        if not app_path.startswith(base_dir + os.sep):
            raise FrameworkError('Invalid application path')
        if os.path.exists(app_path):
            raise FrameworkError(
                f'A service directory already exists at {app_path}. Choose another name.')

        from app.services.template_service import TemplateService
        port = TemplateService._claim_port(TemplateService._managed_app_base_port() or 8100)

        app = Application(
            name=name, app_type='docker', status='stopped', root_path=app_path,
            user_id=user_id, port=port, project_id=project_id, workspace_id=workspace_id,
            environment_id=environment_id,
        )
        db.session.add(app)
        db.session.commit()

        from app.services.deployment_job_service import DeploymentJobService
        job = DeploymentJobService.start_registered(
            JOB_KIND, steps=STEPS, app_id=app.id, user_id=user_id, trigger='install',
            plan={'framework': fw['id'], 'domain': domain,
                  'add_database': add_database, 'public_host': public_host},
        )
        if not job.get('success'):
            db.session.delete(app)
            db.session.commit()
            raise FrameworkError(job.get('error') or 'Failed to queue the scaffold job')
        return {'app': app, 'job_id': job['job_id'], 'port': port}

    @classmethod
    def register_jobs(cls) -> None:
        from app.services import deploy_kind_registry
        deploy_kind_registry.register(JOB_KIND, cls.run, replace=True)

    # ------------------------------------------------------------------ #
    # The job
    # ------------------------------------------------------------------ #
    @classmethod
    def run(cls, job) -> Dict[str, Any]:
        """Deployment-kind handler. Raises on failure so the job is marked
        failed with the real reason; every step is safe to retry."""
        from app.services.run_log_service import stream_for
        stream = stream_for(job)
        plan = job.get_plan()
        fw = get_framework(plan.get('framework'))
        app = Application.query_active().filter_by(id=job.app_id).first()
        if fw is None or app is None:
            raise RuntimeError('Framework or application no longer exists')
        log = lambda msg: stream.log('info', msg)  # noqa: E731

        stream.set_step(1, STEPS[0])
        cls.scaffold_project(fw, app.root_path, log)

        stream.set_step(2, STEPS[1])
        app_url = cls._resolve_app_url(app, plan, log)
        app_key = cls.write_project_files(fw, app, app_url, plan['add_database'], log)

        stream.set_step(3, STEPS[2])
        cls.provision_database(fw, app, plan['add_database'], job.requested_by, log)
        cls.wire_env(fw, app, app_url, app_key, plan['add_database'], job.requested_by)

        stream.set_step(4, STEPS[3])
        from app.services.build_service import BuildService
        built = BuildService.configure_build(
            app_id=app.id, app_path=app.root_path,
            build_method='dockerfile', dockerfile_path='Dockerfile')
        if not built.get('success'):
            raise RuntimeError(built.get('error') or 'Failed to configure the build')
        from app.services.deployment_service import DeploymentService
        deployed = DeploymentService.deploy(
            app.id, user_id=job.requested_by, trigger='install', log_callback=log)
        if not deployed.get('success'):
            raise RuntimeError(deployed.get('error') or 'Deployment failed')

        stream.set_step(5, STEPS[4])
        cls.run_post_deploy(fw, app, plan['add_database'], log)

        log(f'{fw["name"]} is live at {app_url}')
        return {'success': True, 'app_id': app.id, 'app_url': app_url}

    # ------------------------------------------------------------------ #
    # Step 1: scaffold
    # ------------------------------------------------------------------ #
    @classmethod
    def scaffold_project(cls, fw: Dict[str, Any], app_path: str, log: Callable) -> None:
        if os.path.isfile(os.path.join(app_path, 'artisan')):
            log('Project already scaffolded; reusing it')
            return
        base_dir = os.path.abspath(paths.APPS_DIR)
        if os.path.abspath(app_path).startswith(base_dir + os.sep):
            shutil.rmtree(app_path, ignore_errors=True)  # partial earlier attempt
        os.makedirs(app_path, exist_ok=True)

        package = f"{fw['scaffold']['package']}:{fw['scaffold']['constraint']}"
        php = fw['scaffold']['php_version']
        # --no-scripts: the post-create hooks run key:generate/migrate against
        # sqlite inside the Composer container; we do both for real later.
        # config.platform.php pins resolution to the runtime image's PHP so a
        # newer Composer-image PHP cannot select packages the image cannot run.
        steps = (
            f'composer create-project {package} . --no-interaction --no-install '
            f'--no-scripts --prefer-dist && '
            f'composer config platform.php {php}.0 && '
            f'composer install --no-interaction --no-scripts --prefer-dist '
            f'--ignore-platform-req="ext-*"'
        )
        if shutil.which('docker'):
            user = []
            if hasattr(os, 'getuid'):
                user = ['--user', f'{os.getuid()}:{os.getgid()}']
            cmd = ['docker', 'run', '--rm', *user,
                   '-e', 'COMPOSER_HOME=/tmp/composer',
                   '-v', f'{app_path}:/app', '-w', '/app',
                   '--entrypoint', 'sh', COMPOSER_IMAGE, '-c', steps]
            log(f'Running Composer in {COMPOSER_IMAGE} (create-project {package})')
        elif shutil.which('composer') and shutil.which('php'):
            cmd = ['sh', '-c', steps]
            log(f'Docker not found; using host Composer (create-project {package})')
        else:
            raise RuntimeError(
                'Scaffolding needs Docker (preferred) or a host PHP + Composer; '
                'neither was found on this server.')
        result = cls._run(cmd, cwd=app_path, timeout=900)
        for line in (result.get('output') or '').splitlines()[-40:]:
            log(line)
        if not result.get('success') or not os.path.isfile(os.path.join(app_path, 'artisan')):
            raise RuntimeError(
                'composer create-project failed: '
                + (result.get('error') or (result.get('output') or '')[-500:] or 'no artisan file produced'))

    # ------------------------------------------------------------------ #
    # Step 2: files + APP_URL + APP_KEY
    # ------------------------------------------------------------------ #
    @classmethod
    def _resolve_app_url(cls, app, plan, log):
        domain = plan.get('domain')
        if domain:
            from app.services.domain_attach_service import DomainAttachService
            attached = DomainAttachService.attach(app, domain, ssl='auto', make_primary=True)
            for warning in attached.get('warnings') or []:
                log(f'Domain: {warning}')
            if not attached.get('success'):
                log(f'Domain not attached: {attached.get("error")}')
            ssl_on = bool((attached.get('ssl') or {}).get('enabled'))
            return f'{"https" if ssl_on else "http"}://{domain}'
        host = plan.get('public_host') or 'localhost'
        return f'http://{host}:{app.port}'

    @classmethod
    def write_project_files(cls, fw, app, app_url: str, add_database: bool,
                            log: Callable) -> str:
        """Dockerfile, .dockerignore and .env. Returns the APP_KEY (kept stable
        across retries by reading the existing .env)."""
        root = app.root_path
        with open(os.path.join(root, 'Dockerfile'), 'w', encoding='utf-8') as fh:
            fh.write(BuildpackService.generate_dockerfile(cls.build_plan(fw, app.port)))
        # .env stays out of the image: ServerKit injects the same values (and the
        # database credentials) as container env at deploy time.
        with open(os.path.join(root, '.dockerignore'), 'w', encoding='utf-8') as fh:
            fh.write('.git\n.env\nvendor\nnode_modules\nstorage/logs/*\n')

        env_path = os.path.join(root, '.env')
        app_key = None
        if os.path.isfile(env_path):
            with open(env_path, encoding='utf-8') as fh:
                m = re.search(r'^APP_KEY=(base64:\S+)', fh.read(), re.M)
            app_key = m.group(1) if m else None
        app_key = app_key or cls.generate_app_key()

        example = os.path.join(root, '.env.example')
        text = ''
        if os.path.isfile(example):
            with open(example, encoding='utf-8') as fh:
                text = fh.read()
        values = {'APP_NAME': app.name, 'APP_KEY': app_key, 'APP_URL': app_url,
                  **fw['env']}
        if add_database:
            values.update(fw['database']['literal_env'])
        else:
            # No database service: SQLite inside the container; keep sessions
            # and cache off the database so the app boots before migrating.
            values.update({'SESSION_DRIVER': 'file', 'CACHE_STORE': 'file'})
        with open(env_path, 'w', encoding='utf-8') as fh:
            fh.write(cls.render_env(text, values))
        if os.name != 'nt':
            os.chmod(env_path, 0o600)
        if not add_database:
            sqlite = os.path.join(root, 'database', 'database.sqlite')
            os.makedirs(os.path.dirname(sqlite), exist_ok=True)
            open(sqlite, 'a').close()
        log('Wrote Dockerfile, .dockerignore and .env (APP_KEY generated)')
        return app_key

    # ------------------------------------------------------------------ #
    # Step 3: database + env wiring
    # ------------------------------------------------------------------ #
    @classmethod
    def provision_database(cls, fw, app, add_database: bool, user_id, log: Callable) -> None:
        if not add_database:
            log('No database requested; using SQLite inside the container')
            return
        db_name = cls.database_service_name(app.name, fw)
        if Application.query_active().filter_by(name=db_name).first():
            log(f'Database service {db_name} already exists; reusing it')
            return
        from app.services import database_engine_service as engines
        from app.services.deployment_job_service import DeploymentJobService
        planned = engines.plan_install(
            template_id=fw['database']['template'], instance_name=db_name,
            initial_database=app.name.replace('-', '_'))
        if 'error' in planned:
            raise RuntimeError(planned['error'])
        log(f'Installing {fw["database"]["engine_label"]} as {planned["app_name"]}')
        result = DeploymentJobService.install_template(
            template_id=fw['database']['template'], app_name=planned['app_name'],
            user_variables=planned['variables'], user_id=user_id, wait=True)
        if not result.get('success'):
            raise RuntimeError(result.get('error') or 'Database install failed')

    @classmethod
    def wire_env(cls, fw, app, app_url, app_key, add_database: bool, user_id) -> None:
        from app.services.env_service import EnvService
        literals: Dict[str, Any] = {k: v for k, v in fw['env'].items()}
        literals['APP_URL'] = app_url
        literals['APP_KEY'] = {'value': app_key, 'is_secret': True}
        if add_database:
            literals.update(fw['database']['literal_env'])
        else:
            literals.update({'SESSION_DRIVER': 'file', 'CACHE_STORE': 'file'})
        _count, errors = EnvService.bulk_set_env_vars(app.id, literals, user_id)
        if errors:
            raise RuntimeError('; '.join(errors))
        if not add_database:
            return
        db_name = cls.database_service_name(app.name, fw)
        for key, prop in fw['database']['env'].items():
            _var, _created, err = EnvService.set_env_reference(
                app.id, key, {'kind': 'service', 'service': db_name, 'property': prop}, user_id)
            if err:
                raise RuntimeError(f'{key}: {err}')

    # ------------------------------------------------------------------ #
    # Step 5: migrate once ready
    # ------------------------------------------------------------------ #
    @classmethod
    def run_post_deploy(cls, fw, app, add_database: bool, log: Callable,
                        attempts: int = 30, delay: float = 4.0) -> None:
        """Run the framework's post-deploy commands in the app container.

        A fresh database engine needs a while before it accepts connections, so
        with a database the command is retried; the final failure is raised
        with the command's output, never swallowed.
        """
        container = f'serverkit-app-{app.id}'
        attempts = attempts if add_database else 1
        for command in fw.get('post_deploy') or []:
            shown = ' '.join(command)
            last = ''
            for attempt in range(1, attempts + 1):
                result = cls._run(
                    ['docker', 'exec', '-u', 'www-data', '-w', '/var/www/html',
                     container, *command], timeout=300)
                last = (result.get('output') or result.get('error') or '').strip()
                if result.get('success'):
                    for line in last.splitlines()[-20:]:
                        log(line)
                    log(f'{shown}: ok')
                    break
                log(f'{shown}: attempt {attempt}/{attempts} failed; '
                    f'{"waiting for the database" if attempt < attempts else "giving up"}')
                if attempt < attempts:
                    time.sleep(delay)
            else:
                raise RuntimeError(f'`{shown}` failed in {container}: {last[-800:]}')
