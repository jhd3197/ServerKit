import os
import json
import hashlib
import ipaddress
from datetime import datetime
from typing import Dict, List, Optional
from urllib.parse import urlparse

from app.utils.config_store import load_json_config, save_json_config
from app import paths
from app.utils.crypto import encrypt_secret, decrypt_secret_safe, is_encrypted
from app.utils.formatting import format_bytes


class StorageProviderService:
    """Service for managing remote backup storage (S3-compatible, Backblaze B2)."""

    CONFIG_FILE = os.path.join(paths.SERVERKIT_CONFIG_DIR, 'storage.json')

    # Secret fields encrypted at rest (Fernet) in storage.json.
    SECRET_FIELDS = {'s3': ['access_key', 'secret_key'], 'b2': ['key_id', 'application_key']}

    @classmethod
    def _decrypt_config(cls, config: Dict) -> Dict:
        """Decrypt secret fields in-place (plaintext fallback for legacy values)."""
        for provider, fields in cls.SECRET_FIELDS.items():
            section = config.get(provider)
            if isinstance(section, dict):
                for field in fields:
                    if section.get(field):
                        section[field] = decrypt_secret_safe(section[field])
        return config

    @classmethod
    def get_config(cls) -> Dict:
        """Get storage provider configuration (secrets decrypted in memory)."""
        # An unreadable file is moved aside rather than silently read as
        # "local", which would quietly stop off-site backups.
        stored = load_json_config(cls.CONFIG_FILE, None)
        if stored is not None:
            return cls._decrypt_config(stored)

        return {
            'provider': 'local',
            's3': {
                'bucket': '',
                'region': 'us-east-1',
                'access_key': '',
                'secret_key': '',
                'endpoint_url': '',
                'path_prefix': 'serverkit-backups'
            },
            'b2': {
                'bucket': '',
                'key_id': '',
                'application_key': '',
                'endpoint_url': '',
                'path_prefix': 'serverkit-backups'
            },
            'auto_upload': False,
            'keep_local_copy': True
        }

    @classmethod
    def get_config_masked(cls) -> Dict:
        """Get storage config with secrets masked."""
        config = cls.get_config()
        masked = json.loads(json.dumps(config))

        secret_fields = {
            's3': ['access_key', 'secret_key'],
            'b2': ['key_id', 'application_key']
        }

        for provider, fields in secret_fields.items():
            if provider in masked:
                for field in fields:
                    val = masked[provider].get(field, '')
                    if val and len(val) > 4:
                        masked[provider][field] = val[:4] + '*' * (len(val) - 4)

        return masked

    @classmethod
    def save_config(cls, config: Dict) -> Dict:
        """Save storage provider configuration."""
        try:
            # Ensure the parent of the file we actually write exists. Using
            # cls.CONFIG_FILE (not the hardcoded SERVERKIT_CONFIG_DIR) honors a
            # CONFIG_FILE override — e.g. tests pointing it at a tmp dir — and
            # is identical in production, where CONFIG_FILE lives in
            # SERVERKIT_CONFIG_DIR. Previously this tried to create the real
            # config dir unconditionally, which raised on a sandboxed CI runner
            # and (because the except below swallows it) left the file unwritten.
            os.makedirs(os.path.dirname(cls.CONFIG_FILE) or '.', exist_ok=True)

            # Merge with existing config to preserve unmasked secrets
            existing = cls.get_config()
            secret_fields = {
                's3': ['access_key', 'secret_key'],
                'b2': ['key_id', 'application_key']
            }

            for provider, fields in secret_fields.items():
                if provider in config:
                    for field in fields:
                        new_val = config[provider].get(field, '')
                        # Detect our masking pattern: 4 visible chars followed by only asterisks
                        if new_val and len(new_val) > 4 and new_val[4:] == '*' * (len(new_val) - 4):
                            # Keep existing value if masked
                            config[provider][field] = existing.get(provider, {}).get(field, '')

            # Encrypt secrets at rest (idempotent — skip already-encrypted values).
            for provider, fields in secret_fields.items():
                if provider in config:
                    for field in fields:
                        val = config[provider].get(field, '')
                        if val and not is_encrypted(val):
                            config[provider][field] = encrypt_secret(val)

            saved = save_json_config(cls.CONFIG_FILE, config)
            if not saved['success']:
                return saved
            if os.name != 'nt':
                os.chmod(cls.CONFIG_FILE, 0o600)
            return {'success': True, 'message': 'Storage configuration saved'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def _validate_endpoint_url(cls, url: str) -> None:
        """Validate an S3 endpoint URL to prevent SSRF attacks.

        Blocks private/internal IP ranges and requires http(s) scheme.
        Raises ValueError if the URL is invalid or targets a private network.
        """
        if not url:
            return

        parsed = urlparse(url)

        if parsed.scheme not in ('http', 'https'):
            raise ValueError(f"Endpoint URL must use http or https scheme, got '{parsed.scheme}'")

        hostname = parsed.hostname
        if not hostname:
            raise ValueError("Endpoint URL has no hostname")

        try:
            addr = ipaddress.ip_address(hostname)
            if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved:
                raise ValueError(f"Endpoint URL must not target private/internal IP: {hostname}")
        except ValueError as e:
            # If it's our own raised ValueError, re-raise
            if "must not target" in str(e) or "must use" in str(e):
                raise
            # Otherwise it's not a valid IP — it's a hostname, which is allowed

    @classmethod
    def _get_client(cls, config: Dict = None):
        """Get boto3 S3 client based on config."""
        import boto3

        if config is None:
            config = cls.get_config()

        provider = config.get('provider', 'local')
        if provider == 'local':
            return None, None, None

        if provider == 's3':
            provider_config = config.get('s3', {})
            endpoint_url = provider_config.get('endpoint_url') or None
            if endpoint_url:
                cls._validate_endpoint_url(endpoint_url)
            client = boto3.client(
                's3',
                region_name=provider_config.get('region', 'us-east-1'),
                aws_access_key_id=provider_config.get('access_key'),
                aws_secret_access_key=provider_config.get('secret_key'),
                endpoint_url=endpoint_url
            )
            bucket = provider_config.get('bucket', '')
            prefix = provider_config.get('path_prefix', 'serverkit-backups')

        elif provider == 'b2':
            provider_config = config.get('b2', {})
            endpoint_url = provider_config.get('endpoint_url') or None
            if endpoint_url:
                cls._validate_endpoint_url(endpoint_url)
            client = boto3.client(
                's3',
                endpoint_url=endpoint_url,
                aws_access_key_id=provider_config.get('key_id'),
                aws_secret_access_key=provider_config.get('application_key')
            )
            bucket = provider_config.get('bucket', '')
            prefix = provider_config.get('path_prefix', 'serverkit-backups')

        else:
            return None, None, None

        return client, bucket, prefix

    @classmethod
    def test_connection(cls, config: Dict = None) -> Dict:
        """Test connection to storage provider."""
        try:
            client, bucket, prefix = cls._get_client(config)
            if client is None:
                return {'success': False, 'error': 'No remote provider configured'}

            # Try to list objects (limited to 1) to verify access
            client.list_objects_v2(Bucket=bucket, Prefix=prefix, MaxKeys=1)

            return {
                'success': True,
                'message': f'Connected to bucket "{bucket}" successfully'
            }
        except Exception as e:
            error_msg = str(e)
            if 'NoSuchBucket' in error_msg:
                return {'success': False, 'error': f'Bucket "{bucket}" does not exist'}
            if 'AccessDenied' in error_msg or 'InvalidAccessKeyId' in error_msg:
                return {'success': False, 'error': 'Access denied - check your credentials'}
            return {'success': False, 'error': error_msg}

    @classmethod
    def upload_file(cls, local_path: str, remote_key: str = None) -> Dict:
        """Upload a file to remote storage."""
        try:
            client, bucket, prefix = cls._get_client()
            if client is None:
                return {'success': False, 'error': 'No remote provider configured'}

            if not os.path.exists(local_path):
                return {'success': False, 'error': f'Local file not found: {local_path}'}

            if remote_key is None:
                # Use relative path from backup dir as key
                remote_key = os.path.relpath(local_path, paths.SERVERKIT_BACKUP_DIR)

            full_key = f"{prefix}/{remote_key}" if prefix else remote_key

            file_size = os.path.getsize(local_path)

            # Use multipart upload for files > 100MB
            from boto3.s3.transfer import TransferConfig
            transfer_config = TransferConfig(
                multipart_threshold=100 * 1024 * 1024,
                multipart_chunksize=50 * 1024 * 1024
            )

            client.upload_file(
                local_path, bucket, full_key,
                Config=transfer_config
            )

            return {
                'success': True,
                'message': f'Uploaded to {full_key}',
                'remote_key': full_key,
                'size': file_size
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def upload_directory(cls, local_dir: str, remote_prefix: str = None) -> Dict:
        """Upload all files in a directory to remote storage."""
        try:
            client, bucket, prefix = cls._get_client()
            if client is None:
                return {'success': False, 'error': 'No remote provider configured'}

            if not os.path.isdir(local_dir):
                return {'success': False, 'error': f'Directory not found: {local_dir}'}

            if remote_prefix is None:
                remote_prefix = os.path.relpath(local_dir, paths.SERVERKIT_BACKUP_DIR)

            uploaded = 0
            total_size = 0

            for root, dirs, files in os.walk(local_dir, followlinks=False):
                for filename in files:
                    local_path = os.path.join(root, filename)
                    if os.path.islink(local_path):
                        continue
                    rel_path = os.path.relpath(local_path, local_dir)
                    full_key = f"{prefix}/{remote_prefix}/{rel_path}" if prefix else f"{remote_prefix}/{rel_path}"

                    client.upload_file(local_path, bucket, full_key)
                    uploaded += 1
                    total_size += os.path.getsize(local_path)

            return {
                'success': True,
                'message': f'Uploaded {uploaded} file(s)',
                'files_uploaded': uploaded,
                'total_size': total_size
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def download_file(cls, remote_key: str, local_path: str) -> Dict:
        """Download a file from remote storage."""
        try:
            client, bucket, prefix = cls._get_client()
            if client is None:
                return {'success': False, 'error': 'No remote provider configured'}

            os.makedirs(os.path.dirname(local_path), exist_ok=True)

            client.download_file(bucket, remote_key, local_path)

            return {
                'success': True,
                'message': f'Downloaded to {local_path}',
                'local_path': local_path,
                'size': os.path.getsize(local_path)
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_file(cls, remote_key: str) -> Dict:
        """Delete a file from remote storage."""
        try:
            client, bucket, prefix = cls._get_client()
            if client is None:
                return {'success': False, 'error': 'No remote provider configured'}

            client.delete_object(Bucket=bucket, Key=remote_key)

            return {'success': True, 'message': f'Deleted {remote_key}'}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def list_files(cls, prefix_filter: str = None) -> Dict:
        """List files in remote storage."""
        try:
            client, bucket, prefix = cls._get_client()
            if client is None:
                return {'success': False, 'error': 'No remote provider configured'}

            search_prefix = prefix or ''
            if prefix_filter:
                search_prefix = f"{search_prefix}/{prefix_filter}" if search_prefix else prefix_filter

            files = []
            paginator = client.get_paginator('list_objects_v2')

            for page in paginator.paginate(Bucket=bucket, Prefix=search_prefix):
                for obj in page.get('Contents', []):
                    files.append({
                        'key': obj['Key'],
                        'size': obj['Size'],
                        'last_modified': obj['LastModified'].isoformat(),
                        'etag': obj.get('ETag', '').strip('"')
                    })

            return {
                'success': True,
                'files': files,
                'total_count': len(files),
                'total_size': sum(f['size'] for f in files)
            }
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def verify_file(cls, remote_key: str, local_path: str) -> Dict:
        """Verify a remote file matches the local file (size + MD5)."""
        try:
            client, bucket, prefix = cls._get_client()
            if client is None:
                return {'success': False, 'error': 'No remote provider configured'}

            if not os.path.exists(local_path):
                return {'success': False, 'error': 'Local file not found', 'verified': False}

            # Get remote file metadata
            response = client.head_object(Bucket=bucket, Key=remote_key)
            remote_size = response['ContentLength']
            remote_etag = response.get('ETag', '').strip('"')

            # Compare size
            local_size = os.path.getsize(local_path)
            size_match = remote_size == local_size

            # Compute local MD5 for simple files (non-multipart)
            md5_match = None
            if '-' not in remote_etag:
                md5 = hashlib.md5(usedforsecurity=False)
                with open(local_path, 'rb') as f:
                    for chunk in iter(lambda: f.read(8192), b''):
                        md5.update(chunk)
                local_md5 = md5.hexdigest()
                md5_match = local_md5 == remote_etag

            verified = size_match and (md5_match is None or md5_match)

            return {
                'success': True,
                'verified': verified,
                'local_size': local_size,
                'remote_size': remote_size,
                'size_match': size_match,
                'md5_match': md5_match
            }
        except Exception as e:
            return {'success': False, 'error': str(e), 'verified': False}

    @classmethod
    def get_remote_stats(cls) -> Dict:
        """Get statistics about remote storage usage."""
        result = cls.list_files()
        if not result.get('success'):
            return {
                'remote_count': 0,
                'remote_size': 0,
                'remote_size_human': '0 B'
            }

        total_size = result.get('total_size', 0)
        return {
            'remote_count': result.get('total_count', 0),
            'remote_size': total_size,
            'remote_size_human': cls._format_size(total_size)
        }

    @staticmethod
    def _format_size(size: int) -> str:
        """Format size in human readable format."""
        return format_bytes(size, suffix_sep=' ')

    # ── File-browser access (powers the Files app's "S3 bucket" target) ──
    # Paths arrive slash-rooted from the UI (e.g. "/photos/cat.jpg"); we strip the
    # leading slash to an S3 key. Root "/" → "" (bucket root). The configured
    # backup path_prefix is intentionally ignored so the browser sees the whole
    # bucket. All methods reuse the same boto3 client as backups (S3 / B2).

    S3_MAX_EDIT_SIZE = 5 * 1024 * 1024  # 5 MB
    _EDITABLE_EXT = {
        '.txt', '.md', '.markdown', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg',
        '.conf', '.env', '.csv', '.tsv', '.log', '.xml', '.html', '.htm', '.css', '.scss',
        '.js', '.jsx', '.ts', '.tsx', '.py', '.rb', '.php', '.go', '.rs', '.java', '.c',
        '.h', '.cpp', '.sh', '.bash', '.sql', '.svg',
    }

    @classmethod
    def _s3_client_bucket(cls):
        client, bucket, _ = cls._get_client()
        if client is None or not bucket:
            return None, None
        return client, bucket

    @staticmethod
    def _key_from_path(path):
        return (path or '').lstrip('/')

    @classmethod
    def _is_editable_key(cls, key, size):
        ext = os.path.splitext(key)[1].lower()
        return size <= cls.S3_MAX_EDIT_SIZE and ext in cls._EDITABLE_EXT

    @classmethod
    def s3_browse(cls, path='/'):
        client, bucket = cls._s3_client_bucket()
        if client is None:
            return {'success': False, 'error': 'No S3-compatible storage is configured'}
        import mimetypes
        prefix = cls._key_from_path(path)
        if prefix and not prefix.endswith('/'):
            prefix += '/'
        try:
            entries = []
            paginator = client.get_paginator('list_objects_v2')
            for page in paginator.paginate(Bucket=bucket, Prefix=prefix, Delimiter='/'):
                for cp in page.get('CommonPrefixes', []):
                    full = cp['Prefix'].rstrip('/')
                    entries.append({
                        'name': full.split('/')[-1], 'path': '/' + full,
                        'is_dir': True, 'is_file': False, 'is_link': False,
                        'size': 0, 'size_human': '—', 'modified': None,
                        'mime_type': None, 'is_editable': False,
                        'is_readable': True, 'is_writable': True,
                    })
                for obj in page.get('Contents', []):
                    key = obj['Key']
                    if key == prefix:  # the folder placeholder object itself
                        continue
                    name = key.split('/')[-1]
                    if not name:
                        continue
                    size = obj.get('Size', 0)
                    mime, _ = mimetypes.guess_type(name)
                    entries.append({
                        'name': name, 'path': '/' + key,
                        'is_dir': False, 'is_file': True, 'is_link': False,
                        'size': size, 'size_human': cls._format_size(size),
                        'modified': obj['LastModified'].isoformat() if obj.get('LastModified') else None,
                        'mime_type': mime, 'is_editable': cls._is_editable_key(key, size),
                        'is_readable': True, 'is_writable': True,
                    })
            entries.sort(key=lambda x: (not x['is_dir'], x['name'].lower()))

            parent = None
            stripped = prefix.rstrip('/')
            if stripped:
                parent = '/' + stripped.rsplit('/', 1)[0] if '/' in stripped else '/'
            return {'success': True, 'path': path or '/', 'parent': parent,
                    'entries': entries, 'total': len(entries)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def s3_read(cls, path):
        client, bucket = cls._s3_client_bucket()
        if client is None:
            return {'success': False, 'error': 'No S3-compatible storage is configured'}
        key = cls._key_from_path(path)
        try:
            head = client.head_object(Bucket=bucket, Key=key)
            size = head.get('ContentLength', 0)
            if size > cls.S3_MAX_EDIT_SIZE:
                return {'success': False, 'error': f'File too large to edit ({cls._format_size(size)})'}
            obj = client.get_object(Bucket=bucket, Key=key)
            raw = obj['Body'].read()
            try:
                content = raw.decode('utf-8')
            except UnicodeDecodeError:
                return {'success': False, 'error': 'Binary file cannot be edited', 'is_binary': True}
            return {'success': True, 'path': path, 'content': content,
                    'encoding': 'utf-8', 'size': size, 'is_binary': False}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def s3_write(cls, path, content):
        client, bucket = cls._s3_client_bucket()
        if client is None:
            return {'success': False, 'error': 'No S3-compatible storage is configured'}
        key = cls._key_from_path(path)
        if not key:
            return {'success': False, 'error': 'A key is required'}
        try:
            body = (content or '').encode('utf-8')
            client.put_object(Bucket=bucket, Key=key, Body=body)
            return {'success': True, 'path': path, 'size': len(body)}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def s3_upload(cls, dest_path, filename, fileobj):
        client, bucket = cls._s3_client_bucket()
        if client is None:
            return {'success': False, 'error': 'No S3-compatible storage is configured'}
        prefix = cls._key_from_path(dest_path)
        if prefix and not prefix.endswith('/'):
            prefix += '/'
        key = f'{prefix}{filename}'
        try:
            client.upload_fileobj(fileobj, bucket, key)
            return {'success': True, 'path': '/' + key}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def s3_delete(cls, path):
        client, bucket = cls._s3_client_bucket()
        if client is None:
            return {'success': False, 'error': 'No S3-compatible storage is configured'}
        key = cls._key_from_path(path)
        if not key:
            return {'success': False, 'error': 'A key is required'}
        try:
            # Collect the object itself plus anything beneath it (folder delete).
            to_delete = set()
            paginator = client.get_paginator('list_objects_v2')
            for p in (key, key + '/'):
                for page in paginator.paginate(Bucket=bucket, Prefix=p):
                    for obj in page.get('Contents', []):
                        to_delete.add(obj['Key'])
            if not to_delete:
                client.delete_object(Bucket=bucket, Key=key)
            else:
                objs = [{'Key': k} for k in to_delete]
                for i in range(0, len(objs), 1000):
                    client.delete_objects(Bucket=bucket, Delete={'Objects': objs[i:i + 1000]})
            return {'success': True, 'path': path}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def s3_presigned_get(cls, path, expires=300):
        client, bucket = cls._s3_client_bucket()
        if client is None:
            return {'success': False, 'error': 'No S3-compatible storage is configured'}
        key = cls._key_from_path(path)
        try:
            url = client.generate_presigned_url(
                'get_object', Params={'Bucket': bucket, 'Key': key}, ExpiresIn=expires)
            return {'success': True, 'url': url}
        except Exception as e:
            return {'success': False, 'error': str(e)}

    @classmethod
    def encrypt_legacy_secrets(cls) -> int:
        """One-time, idempotent: encrypt any storage secrets still stored in
        plaintext in storage.json (configs saved before encryption-at-rest)."""
        if not os.path.exists(cls.CONFIG_FILE):
            return 0
        try:
            with open(cls.CONFIG_FILE, 'r') as f:
                raw = json.load(f)
        except Exception:
            return 0
        changed = 0
        for provider, fields in cls.SECRET_FIELDS.items():
            section = raw.get(provider)
            if isinstance(section, dict):
                for field in fields:
                    val = section.get(field, '')
                    if val and not is_encrypted(val):
                        section[field] = encrypt_secret(val)
                        changed += 1
        if changed:
            try:
                with open(cls.CONFIG_FILE, 'w') as f:
                    json.dump(raw, f, indent=2)
                if os.name != 'nt':
                    os.chmod(cls.CONFIG_FILE, 0o600)
            except Exception:
                return 0
        return changed
