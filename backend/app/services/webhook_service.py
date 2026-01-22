"""Webhook Service for Git repository sync via webhooks."""

import hmac
import hashlib
import secrets
import json
from datetime import datetime
from typing import Dict, List, Optional


class WebhookService:
    """Service for managing Git webhooks and processing incoming events."""

    @classmethod
    def list_webhooks(cls) -> Dict:
        """List all configured webhooks."""
        from app.models import GitWebhook

        webhooks = GitWebhook.query.order_by(GitWebhook.created_at.desc()).all()
        return {
            'success': True,
            'webhooks': [w.to_dict() for w in webhooks],
            'count': len(webhooks)
        }

    @classmethod
    def get_webhook(cls, webhook_id: int) -> Dict:
        """Get a specific webhook by ID."""
        from app.models import GitWebhook

        webhook = GitWebhook.query.get(webhook_id)
        if not webhook:
            return {'success': False, 'error': 'Webhook not found'}

        return {
            'success': True,
            'webhook': webhook.to_dict()
        }

    @classmethod
    def create_webhook(cls, name: str, source: str, source_repo_url: str,
                       source_branch: str = 'main', local_repo_name: str = None,
                       sync_direction: str = 'pull', auto_sync: bool = True,
                       app_id: int = None, deploy_on_push: bool = False,
                       pre_deploy_script: str = None, post_deploy_script: str = None,
                       zero_downtime: bool = False) -> Dict:
        """Create a new webhook configuration."""
        from app import db
        from app.models import GitWebhook, Application

        # Validate required fields
        if not name:
            return {'success': False, 'error': 'Name is required'}
        if not source:
            return {'success': False, 'error': 'Source is required'}
        if source not in ['github', 'gitlab', 'bitbucket']:
            return {'success': False, 'error': 'Source must be github, gitlab, or bitbucket'}
        if not source_repo_url:
            return {'success': False, 'error': 'Source repository URL is required'}

        # Validate app_id if provided
        if app_id:
            app = Application.query.get(app_id)
            if not app:
                return {'success': False, 'error': 'Application not found'}

        # Generate secure tokens
        secret = secrets.token_hex(32)
        webhook_token = secrets.token_urlsafe(16)

        try:
            webhook = GitWebhook(
                name=name,
                source=source,
                source_repo_url=source_repo_url,
                source_branch=source_branch,
                local_repo_name=local_repo_name,
                secret=secret,
                webhook_token=webhook_token,
                sync_direction=sync_direction,
                auto_sync=auto_sync,
                app_id=app_id,
                deploy_on_push=deploy_on_push,
                pre_deploy_script=pre_deploy_script,
                post_deploy_script=post_deploy_script,
                zero_downtime=zero_downtime
            )

            db.session.add(webhook)
            db.session.commit()

            return {
                'success': True,
                'webhook': webhook.to_dict(),
                'secret': secret,  # Only returned once at creation
                'message': 'Webhook created successfully. Save the secret - it will not be shown again!'
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def update_webhook(cls, webhook_id: int, data: Dict) -> Dict:
        """Update a webhook configuration."""
        from app import db
        from app.models import GitWebhook

        webhook = GitWebhook.query.get(webhook_id)
        if not webhook:
            return {'success': False, 'error': 'Webhook not found'}

        try:
            # Update allowed fields
            if 'name' in data:
                webhook.name = data['name']
            if 'sourceBranch' in data:
                webhook.source_branch = data['sourceBranch']
            if 'localRepoName' in data:
                webhook.local_repo_name = data['localRepoName']
            if 'syncDirection' in data:
                webhook.sync_direction = data['syncDirection']
            if 'autoSync' in data:
                webhook.auto_sync = data['autoSync']
            if 'isActive' in data:
                webhook.is_active = data['isActive']

            # Deployment configuration
            if 'appId' in data:
                webhook.app_id = data['appId'] if data['appId'] else None
            if 'deployOnPush' in data:
                webhook.deploy_on_push = data['deployOnPush']
            if 'preDeployScript' in data:
                webhook.pre_deploy_script = data['preDeployScript'] if data['preDeployScript'] else None
            if 'postDeployScript' in data:
                webhook.post_deploy_script = data['postDeployScript'] if data['postDeployScript'] else None
            if 'zeroDowntime' in data:
                webhook.zero_downtime = data['zeroDowntime']

            db.session.commit()

            return {
                'success': True,
                'webhook': webhook.to_dict(),
                'message': 'Webhook updated successfully'
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def delete_webhook(cls, webhook_id: int) -> Dict:
        """Delete a webhook."""
        from app import db
        from app.models import GitWebhook, WebhookLog

        webhook = GitWebhook.query.get(webhook_id)
        if not webhook:
            return {'success': False, 'error': 'Webhook not found'}

        try:
            # Delete associated logs
            WebhookLog.query.filter_by(webhook_id=webhook_id).delete()

            # Delete webhook
            db.session.delete(webhook)
            db.session.commit()

            return {
                'success': True,
                'message': 'Webhook deleted successfully'
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def toggle_webhook(cls, webhook_id: int) -> Dict:
        """Toggle a webhook's active status."""
        from app import db
        from app.models import GitWebhook

        webhook = GitWebhook.query.get(webhook_id)
        if not webhook:
            return {'success': False, 'error': 'Webhook not found'}

        try:
            webhook.is_active = not webhook.is_active
            db.session.commit()

            return {
                'success': True,
                'webhook': webhook.to_dict(),
                'message': f'Webhook {"activated" if webhook.is_active else "deactivated"}'
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def regenerate_secret(cls, webhook_id: int) -> Dict:
        """Regenerate the webhook secret."""
        from app import db
        from app.models import GitWebhook

        webhook = GitWebhook.query.get(webhook_id)
        if not webhook:
            return {'success': False, 'error': 'Webhook not found'}

        try:
            new_secret = secrets.token_hex(32)
            webhook.secret = new_secret
            db.session.commit()

            return {
                'success': True,
                'secret': new_secret,
                'message': 'Secret regenerated. Update your webhook settings in the source repository.'
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_webhook_logs(cls, webhook_id: int = None, limit: int = 50) -> Dict:
        """Get webhook logs."""
        from app.models import WebhookLog

        query = WebhookLog.query
        if webhook_id:
            query = query.filter_by(webhook_id=webhook_id)

        logs = query.order_by(WebhookLog.received_at.desc()).limit(limit).all()

        return {
            'success': True,
            'logs': [log.to_dict() for log in logs],
            'count': len(logs)
        }

    @classmethod
    def handle_webhook(cls, token: str, source: str, event_type: str,
                       signature: str, delivery_id: str, headers: Dict,
                       payload: bytes, payload_json: Dict) -> Dict:
        """Handle an incoming webhook event."""
        from app import db
        from app.models import GitWebhook, WebhookLog

        # Find webhook by token
        webhook = GitWebhook.query.filter_by(webhook_token=token).first()

        # Create log entry
        log = WebhookLog(
            webhook_id=webhook.id if webhook else None,
            source=source,
            event_type=event_type,
            delivery_id=delivery_id,
            headers_json=json.dumps(dict(headers))[:2000],
            payload_preview=payload[:1000].decode('utf-8', errors='replace') if payload else None,
            status='received'
        )

        if not webhook:
            log.status = 'failed'
            log.status_message = 'Unknown webhook token'
            db.session.add(log)
            db.session.commit()
            return {'success': False, 'error': 'Unknown webhook'}

        if not webhook.is_active:
            log.status = 'ignored'
            log.status_message = 'Webhook is inactive'
            db.session.add(log)
            db.session.commit()
            return {'success': True, 'message': 'Webhook is inactive', 'action': 'ignored'}

        # Verify signature
        if not cls._verify_signature(webhook, source, signature, payload):
            log.status = 'failed'
            log.status_message = 'Invalid signature'
            db.session.add(log)
            db.session.commit()
            return {'success': False, 'error': 'Invalid signature'}

        # Parse payload for logging
        if payload_json:
            cls._extract_payload_info(log, source, event_type, payload_json)

        # Handle ping events
        if event_type in ['ping', 'Push Hook']:
            log.status = 'processed'
            log.status_message = 'Ping received'
            log.processed_at = datetime.utcnow()
            db.session.add(log)
            db.session.commit()
            return {'success': True, 'message': 'Pong!', 'action': 'ping'}

        # Handle push events
        if event_type in ['push', 'Push Hook', 'repo:push']:
            result = cls._handle_push_event(webhook, log, payload_json)
            db.session.add(log)
            db.session.commit()
            return result

        # Unhandled event type
        log.status = 'ignored'
        log.status_message = f'Unhandled event type: {event_type}'
        log.processed_at = datetime.utcnow()
        db.session.add(log)
        db.session.commit()

        return {'success': True, 'message': f'Event {event_type} ignored', 'action': 'ignored'}

    @classmethod
    def _verify_signature(cls, webhook, source: str, signature: str, payload: bytes) -> bool:
        """Verify the webhook signature based on source."""
        if not signature:
            return False

        secret = webhook.secret.encode()

        if source == 'github':
            # GitHub: X-Hub-Signature-256 header with sha256=<hex>
            expected = 'sha256=' + hmac.new(secret, payload, hashlib.sha256).hexdigest()
            return hmac.compare_digest(signature, expected)

        elif source == 'gitlab':
            # GitLab: X-Gitlab-Token header contains the secret directly
            return hmac.compare_digest(signature, webhook.secret)

        elif source == 'bitbucket':
            # Bitbucket: X-Hub-Signature header with sha256=<hex>
            if signature.startswith('sha256='):
                expected = 'sha256=' + hmac.new(secret, payload, hashlib.sha256).hexdigest()
                return hmac.compare_digest(signature, expected)

        return False

    @classmethod
    def _extract_payload_info(cls, log, source: str, event_type: str, payload: Dict):
        """Extract relevant info from payload for logging."""
        try:
            if source == 'github':
                log.ref = payload.get('ref')
                if 'head_commit' in payload and payload['head_commit']:
                    log.commit_sha = payload['head_commit'].get('id')
                    log.commit_message = payload['head_commit'].get('message', '')[:500]
                if 'pusher' in payload:
                    log.pusher = payload['pusher'].get('name')

            elif source == 'gitlab':
                log.ref = payload.get('ref')
                if 'commits' in payload and payload['commits']:
                    log.commit_sha = payload['commits'][0].get('id')
                    log.commit_message = payload['commits'][0].get('message', '')[:500]
                log.pusher = payload.get('user_name')

            elif source == 'bitbucket':
                if 'push' in payload and 'changes' in payload['push']:
                    changes = payload['push']['changes']
                    if changes:
                        new_ref = changes[0].get('new', {})
                        log.ref = new_ref.get('name')
                        log.commit_sha = new_ref.get('target', {}).get('hash')
                        log.commit_message = new_ref.get('target', {}).get('message', '')[:500]
                if 'actor' in payload:
                    log.pusher = payload['actor'].get('display_name')

        except Exception:
            pass  # Log extraction is best-effort

    @classmethod
    def _handle_push_event(cls, webhook, log, payload: Dict) -> Dict:
        """Handle a push event - sync the repository and optionally deploy."""
        from app import db
        from app.services.git_deploy_service import GitDeployService

        # Check if push is to the configured branch
        ref = log.ref or ''
        configured_branch = webhook.source_branch

        # Extract branch name from ref (refs/heads/main -> main)
        pushed_branch = ref.replace('refs/heads/', '') if ref.startswith('refs/heads/') else ref

        if pushed_branch != configured_branch:
            log.status = 'ignored'
            log.status_message = f'Push to {pushed_branch}, configured for {configured_branch}'
            log.processed_at = datetime.utcnow()
            return {
                'success': True,
                'message': f'Ignoring push to {pushed_branch}',
                'action': 'ignored'
            }

        # Check if auto-sync is enabled
        if not webhook.auto_sync:
            log.status = 'ignored'
            log.status_message = 'Auto-sync is disabled'
            log.processed_at = datetime.utcnow()
            return {
                'success': True,
                'message': 'Auto-sync is disabled',
                'action': 'ignored'
            }

        # Perform sync and optional deployment
        try:
            actions = ['synced']
            deployment_result = None

            # Trigger deployment if configured
            if webhook.deploy_on_push and webhook.app_id:
                deployment_result = GitDeployService.deploy(
                    app_id=webhook.app_id,
                    webhook_id=webhook.id,
                    commit_sha=log.commit_sha,
                    commit_message=log.commit_message,
                    branch=pushed_branch,
                    triggered_by='webhook'
                )

                if deployment_result.get('success'):
                    actions.append('deployed')
                    log.status = 'processed'
                    log.status_message = f'Deployed v{deployment_result.get("version")} ({log.commit_sha[:7] if log.commit_sha else "unknown"})'
                else:
                    log.status = 'failed'
                    log.status_message = f'Deployment failed: {deployment_result.get("error")}'
                    log.processed_at = datetime.utcnow()

                    webhook.last_sync_at = datetime.utcnow()
                    webhook.last_sync_status = 'failed'
                    webhook.last_sync_message = deployment_result.get('error')

                    return {
                        'success': False,
                        'error': deployment_result.get('error'),
                        'action': 'deploy_failed',
                        'deployment_id': deployment_result.get('deployment_id')
                    }
            else:
                log.status = 'processed'
                log.status_message = f'Push from {webhook.source} processed (no deployment configured)'

            log.processed_at = datetime.utcnow()

            # Update webhook stats
            webhook.last_sync_at = datetime.utcnow()
            webhook.last_sync_status = 'success'
            webhook.last_sync_message = f'Synced commit {log.commit_sha[:7] if log.commit_sha else "unknown"}'
            webhook.sync_count += 1

            result = {
                'success': True,
                'message': 'Push event processed',
                'action': ','.join(actions),
                'commit': log.commit_sha
            }

            if deployment_result:
                result['deployment_id'] = deployment_result.get('deployment_id')
                result['deployment_version'] = deployment_result.get('version')

            return result

        except Exception as e:
            log.status = 'failed'
            log.status_message = str(e)
            log.processed_at = datetime.utcnow()

            webhook.last_sync_at = datetime.utcnow()
            webhook.last_sync_status = 'failed'
            webhook.last_sync_message = str(e)

            return {'success': False, 'error': str(e)}

    @classmethod
    def test_webhook(cls, webhook_id: int) -> Dict:
        """Test a webhook by logging a test event."""
        from app import db
        from app.models import GitWebhook, WebhookLog

        webhook = GitWebhook.query.get(webhook_id)
        if not webhook:
            return {'success': False, 'error': 'Webhook not found'}

        try:
            # Create a test log entry
            log = WebhookLog(
                webhook_id=webhook_id,
                source=webhook.source,
                event_type='test',
                status='processed',
                status_message='Manual test triggered',
                processed_at=datetime.utcnow()
            )

            db.session.add(log)
            db.session.commit()

            return {
                'success': True,
                'message': 'Test event logged successfully',
                'webhook_url': webhook.to_dict()['webhook_url']
            }

        except Exception as e:
            db.session.rollback()
            return {'success': False, 'error': str(e)}

    @classmethod
    def get_webhook_setup_instructions(cls, webhook_id: int) -> Dict:
        """Get setup instructions for a webhook."""
        from app.models import GitWebhook

        webhook = GitWebhook.query.get(webhook_id)
        if not webhook:
            return {'success': False, 'error': 'Webhook not found'}

        webhook_url = webhook.to_dict()['webhook_url']

        instructions = {
            'github': {
                'title': 'GitHub Webhook Setup',
                'steps': [
                    'Go to your GitHub repository Settings > Webhooks',
                    'Click "Add webhook"',
                    f'Payload URL: YOUR_SERVER_URL{webhook_url}',
                    'Content type: application/json',
                    f'Secret: (the secret provided when creating this webhook)',
                    'Select "Just the push event" or customize events',
                    'Click "Add webhook"'
                ]
            },
            'gitlab': {
                'title': 'GitLab Webhook Setup',
                'steps': [
                    'Go to your GitLab project Settings > Webhooks',
                    f'URL: YOUR_SERVER_URL{webhook_url}',
                    f'Secret token: (the secret provided when creating this webhook)',
                    'Select "Push events" trigger',
                    'Click "Add webhook"'
                ]
            },
            'bitbucket': {
                'title': 'Bitbucket Webhook Setup',
                'steps': [
                    'Go to your Bitbucket repository Settings > Webhooks',
                    'Click "Add webhook"',
                    f'URL: YOUR_SERVER_URL{webhook_url}',
                    'Select "Repository push" trigger',
                    'Click "Save"'
                ]
            }
        }

        return {
            'success': True,
            'source': webhook.source,
            'webhook_url': webhook_url,
            'instructions': instructions.get(webhook.source, {})
        }
