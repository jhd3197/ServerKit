"""Detect whether a newer image is available for an application's Docker image
by comparing the locally-present digest with the registry's current digest for
the same tag. Shells out to `docker` like the rest of the Docker layer."""
import logging
from datetime import datetime

from app import db
from app.exceptions import ValidationError, not_found
from app.models import Application
from app.models.image_update import ImageUpdateCheck
from app.services.docker_service import DockerService

logger = logging.getLogger(__name__)


class ImageUpdateService:

    @staticmethod
    def _docker(args, timeout=60):
        """Run ``docker <args>`` — via DockerService.run (§G3).

        The seam stays (tests stub it), but the result shape is now the one
        every other docker caller gets. This wrapper used to hand back a raw
        ``CompletedProcess`` while the two other private ``_docker`` wrappers
        returned dicts — three names, three contracts.
        """
        return DockerService.run(args, timeout=timeout)

    @classmethod
    def _local_digest(cls, image_ref):
        """RepoDigest (sha256:...) of the locally-present image, or None when the
        image isn't pulled or was built locally (no registry digest)."""
        result = cls._docker(['image', 'inspect', image_ref, '--format', '{{index .RepoDigests 0}}'])
        if not result['success']:
            return None
        out = result['output'].strip()
        return out.split('@', 1)[1].strip() if '@sha256:' in out else None

    @classmethod
    def _registry_digest(cls, image_ref):
        """Current index digest (sha256:...) for the ref's tag in its registry,
        or None when the registry is unreachable or buildx is unavailable."""
        result = cls._docker(
            ['buildx', 'imagetools', 'inspect', image_ref, '--format', '{{.Manifest.Digest}}'],
            timeout=30,
        )
        if not result['success']:
            return None
        out = result['output'].strip()
        return out if out.startswith('sha256:') else None

    @classmethod
    def check_application(cls, application_id):
        # query_active: this runs `docker manifest inspect` against the registry
        # (and a `docker login` when a private registry is bound).
        app = Application.query_active().filter_by(id=application_id).first()
        if not app:
            raise not_found('service')
        image_ref = app.docker_image
        if not image_ref:
            raise ValidationError('Application has no Docker image')

        check = ImageUpdateCheck(application_id=application_id, image_ref=image_ref, status='pending')
        db.session.add(check)
        db.session.commit()

        local = cls._local_digest(image_ref)
        remote = cls._registry_digest(image_ref)

        if local is None:
            check.status = 'failed'
            check.error_message = 'Could not read the local image digest (image not pulled, or built locally).'
        elif remote is None:
            check.status = 'failed'
            check.error_message = 'Could not query the registry digest (registry unreachable or buildx unavailable).'
        else:
            check.current_digest = local
            check.latest_digest = remote
            check.update_available = (local != remote)
            check.status = 'completed'

        check.checked_at = datetime.utcnow()
        db.session.commit()
        logger.info('Image-update check %s: %s (local=%s remote=%s)',
                    image_ref, check.status, local, remote)
        return check.to_dict()

    @classmethod
    def latest_check(cls, application_id):
        return ImageUpdateCheck.query.filter_by(application_id=application_id).order_by(
            ImageUpdateCheck.checked_at.desc()).first()
