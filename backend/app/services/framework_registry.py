"""Data-driven registry of frameworks the New Service wizard can scaffold.

Adding a framework (Next.js, Django, ...) is a new entry in :data:`FRAMEWORKS`
plus, if its scaffolder is not Composer, a runner in
``framework_scaffold_service``. The picker UI, the API and the review summary
all read this table, so none of them change.

Entries never carry secrets: database credentials are wired at deploy time
through ``fromService`` env references (see ``FrameworkScaffoldService``).
"""

from typing import Any, Dict, List, Optional

# Host-side name of the Composer container image used when the host has no
# PHP/Composer. Pinned to a major so a Composer 3 release cannot change scaffolds.
COMPOSER_IMAGE = 'composer:2'

FRAMEWORKS: Dict[str, Dict[str, Any]] = {
    'laravel': {
        'id': 'laravel',
        'name': 'Laravel',
        'description': 'PHP framework: Composer project, PHP-FPM + nginx image, '
                       'MySQL, APP_KEY and migrations handled for you.',
        'language': 'php',
        'available': True,
        # Laravel 11 needs PHP >= 8.2; the generated image defaults to 8.3
        # (BuildpackService.DEFAULT_PHP_VERSION, backend/templates/php-app.yaml).
        'scaffold': {
            'tool': 'composer',
            'package': 'laravel/laravel',
            'constraint': '^11.0',
            'php_version': '8.3',
        },
        'docroot': 'public',
        'database': {
            'default': True,          # "Add MySQL" starts ticked
            'template': 'mysql',      # engine template installed for the DB
            'engine_label': 'MySQL 8.4',
            'name_suffix': '-db',
            # Laravel env name -> fromService property of the DB service.
            'env': {
                'DB_HOST': 'host',
                'DB_PORT': 'port',
                'DB_DATABASE': 'database',
                'DB_USERNAME': 'username',
                'DB_PASSWORD': 'password',
            },
            'literal_env': {'DB_CONNECTION': 'mysql'},
        },
        'env': {
            'APP_ENV': 'production',
            'APP_DEBUG': 'false',
            'LOG_CHANNEL': 'stderr',
        },
        # Run, in order, once the app container is up and the DB accepts
        # connections. Executed inside the app container.
        'post_deploy': [['php', 'artisan', 'migrate', '--force']],
        'steps': ['scaffold', 'database', 'env', 'migrate', 'deploy'],
    },
}


def list_frameworks() -> List[Dict[str, Any]]:
    """Public, UI-safe view of every registered framework."""
    out = []
    for fw in FRAMEWORKS.values():
        db = fw.get('database') or {}
        out.append({
            'id': fw['id'],
            'name': fw['name'],
            'description': fw['description'],
            'language': fw['language'],
            'available': bool(fw.get('available')),
            'php_version': (fw.get('scaffold') or {}).get('php_version'),
            'database': {
                'supported': bool(db),
                'default': bool(db.get('default')),
                'label': db.get('engine_label'),
            },
            'steps': list(fw.get('steps') or []),
        })
    return out


def get_framework(framework_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """The full registry entry for an *available* framework, else None."""
    fw = FRAMEWORKS.get((framework_id or '').strip().lower())
    return fw if fw and fw.get('available') else None
