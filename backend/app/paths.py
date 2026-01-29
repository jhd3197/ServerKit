import os

# Base directories (override via env vars; defaults = production)
SERVERKIT_DIR = os.environ.get('SERVERKIT_DIR', '/var/serverkit')
SERVERKIT_CONFIG_DIR = os.environ.get('SERVERKIT_CONFIG_DIR', '/etc/serverkit')
SERVERKIT_LOG_DIR = os.environ.get('SERVERKIT_LOG_DIR', '/var/log/serverkit')
SERVERKIT_BACKUP_DIR = os.environ.get('SERVERKIT_BACKUP_DIR', '/var/backups/serverkit')
SERVERKIT_CACHE_DIR = os.environ.get('SERVERKIT_CACHE_DIR', '/var/cache/serverkit')
SERVERKIT_QUARANTINE_DIR = os.environ.get('SERVERKIT_QUARANTINE_DIR', '/var/quarantine')

# Derived paths
APPS_DIR = os.path.join(SERVERKIT_DIR, 'apps')
DEPLOYMENTS_DIR = os.path.join(SERVERKIT_DIR, 'deployments')
TEMPLATES_DIR = os.path.join(SERVERKIT_CONFIG_DIR, 'templates')
BUILD_LOG_DIR = os.path.join(SERVERKIT_LOG_DIR, 'builds')
BUILD_CACHE_DIR = os.path.join(SERVERKIT_CACHE_DIR, 'builds')
DB_BACKUP_DIR = os.path.join(SERVERKIT_BACKUP_DIR, 'databases')
WP_BACKUP_DIR = os.path.join(SERVERKIT_BACKUP_DIR, 'wordpress')
SNAPSHOT_DIR = os.path.join(SERVERKIT_BACKUP_DIR, 'snapshots')
