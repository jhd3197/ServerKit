# Bucket: PER-APP (plan 29 #9). Per-app cron routes gate via the app-grant
# family (can_access_app / can_edit_app). See docs/WORKSPACE_SCOPING.md.
"""
Cron Job Management API

Endpoints for managing scheduled tasks and cron jobs.
"""

from flask import Blueprint, request, jsonify

from app.middleware.rbac import admin_required, viewer_required, require_app_member
from app.services.cron_service import CronService

cron_bp = Blueprint('cron', __name__)


_INVALID_APP = object()  # sentinel: an application_id was given but doesn't exist


def _validate_application_id(raw):
    """Normalize an incoming application_id.

    Returns None (no association), an int (validated, app exists), or the
    _INVALID_APP sentinel when a non-empty value doesn't resolve to an app.
    """
    if raw in (None, ''):
        return None
    from app.models import Application
    try:
        aid = int(raw)
    except (TypeError, ValueError):
        return _INVALID_APP
    # query_active: a deleted app is not a legal cron target — its jobs were
    # suspended by the delete, so attaching a new one would resurrect work for
    # something that is in the bin.
    return aid if Application.query_active().filter_by(id=aid).first() else _INVALID_APP


def _attach_attribution(jobs):
    """Resolve each job's `application_id` into live app/workspace/project names.

    Scope is derived, never duplicated: a job only stores `application_id`, and
    the workspace/project it belongs to are resolved through the app at read
    time (Decision 3). Jobs with no association are left untouched (System
    bucket).
    """
    from app.models import Application, Workspace

    ids = {int(j['application_id']) for j in jobs
           if j.get('application_id') not in (None, '')}
    if not ids:
        return jobs

    # Deliberately unfiltered. This is attribution only — no side effects — and
    # the jobs of a deleted app are suspended, not removed. Naming the app they
    # belonged to explains why they are suspended; dropping to the unattributed
    # "System" bucket would make them look like they were never linked.
    apps = {a.id: a for a in Application.query.filter(Application.id.in_(ids)).all()}
    ws_ids = {a.workspace_id for a in apps.values() if a.workspace_id}
    workspaces = ({w.id: w for w in Workspace.query.filter(Workspace.id.in_(ws_ids)).all()}
                  if ws_ids else {})

    for job in jobs:
        aid = job.get('application_id')
        app = apps.get(int(aid)) if aid not in (None, '') else None
        if not app:
            continue
        job['app'] = {'id': app.id, 'name': app.name, 'type': app.app_type}
        if app.workspace_id and app.workspace_id in workspaces:
            w = workspaces[app.workspace_id]
            job['workspace'] = {'id': w.id, 'name': w.name}
        if app.project_id:
            job['project'] = {'id': app.project_id,
                              'name': app.project.name if app.project else None}
    return jobs


@cron_bp.route('/status', methods=['GET'])
@viewer_required
def get_status():
    """Get cron service status."""
    status = CronService.get_status()
    return jsonify(status)


@cron_bp.route('/jobs', methods=['GET'])
@viewer_required
def list_jobs():
    """List all cron jobs (admin surface), with live app/workspace attribution."""
    result = CronService.list_jobs()
    if result.get('jobs'):
        _attach_attribution(result['jobs'])
    return jsonify(result)


@cron_bp.route('/jobs', methods=['POST'])
@admin_required
def create_job():
    """Create a new cron job."""
    data = request.get_json()

    schedule = data.get('schedule')
    command = data.get('command')
    name = data.get('name')
    description = data.get('description')

    if not schedule:
        return jsonify({'success': False, 'error': 'Schedule is required'}), 400

    if not command:
        return jsonify({'success': False, 'error': 'Command is required'}), 400

    application_id = _validate_application_id(data.get('application_id'))
    if application_id is _INVALID_APP:
        return jsonify({'success': False, 'error': 'Service not found'}), 400

    result = CronService.add_job(
        schedule=schedule,
        command=command,
        name=name,
        description=description,
        application_id=application_id,
    )

    if result.get('success'):
        return jsonify(result), 201
    return jsonify(result), 400


@cron_bp.route('/jobs/<job_id>', methods=['PUT'])
@admin_required
def update_job(job_id):
    """Update a cron job."""
    data = request.get_json()

    set_application = 'application_id' in data
    application_id = None
    if set_application:
        application_id = _validate_application_id(data.get('application_id'))
        if application_id is _INVALID_APP:
            return jsonify({'success': False, 'error': 'Service not found'}), 400

    result = CronService.update_job(
        job_id=job_id,
        name=data.get('name'),
        command=data.get('command'),
        schedule=data.get('schedule'),
        description=data.get('description'),
        application_id=application_id,
        _set_application=set_application,
    )

    if result.get('success'):
        return jsonify(result)
    return jsonify(result), 400


@cron_bp.route('/jobs/<job_id>', methods=['DELETE'])
@admin_required
def delete_job(job_id):
    """Delete a cron job."""
    result = CronService.remove_job(job_id)

    if result.get('success'):
        return jsonify(result)
    return jsonify(result), 400


@cron_bp.route('/jobs/<job_id>/toggle', methods=['POST'])
@admin_required
def toggle_job(job_id):
    """Enable or disable a cron job."""
    data = request.get_json()
    enabled = data.get('enabled', True)

    result = CronService.toggle_job(job_id, enabled)

    if result.get('success'):
        return jsonify(result)
    return jsonify(result), 400


@cron_bp.route('/jobs/<job_id>/run', methods=['POST'])
@admin_required
def run_job(job_id):
    """Run a job immediately."""
    result = CronService.run_job_now(job_id)

    if result.get('success'):
        return jsonify(result)
    return jsonify(result), 400


@cron_bp.route('/presets', methods=['GET'])
@viewer_required
def get_presets():
    """Get available schedule presets."""
    result = CronService.get_presets()
    return jsonify(result)


@cron_bp.route('/jobs/for-app/<int:app_id>', methods=['GET'])
@require_app_member(min_role='viewer', arg='app_id')
def jobs_for_app(app_id):
    """Read-only list of the jobs attributed to an application.

    Gated by workspace membership (member+ of the app's workspace, or admin) —
    NOT @admin_required. This is the member-facing surface (Decision 2): workspace
    members see the scheduled tasks that keep their app healthy, without being
    handed the keys to the host crontab. No mutation routes live at this gate,
    and the raw host command is intentionally omitted.
    """
    jobs = CronService.jobs_for_application(app_id)
    visible = [{
        'id': j['id'],
        'name': j.get('name'),
        'schedule': j.get('schedule'),
        'schedule_human': j.get('schedule_human'),
        'next_run': j.get('next_run'),
        'enabled': j.get('enabled', True),
        'last_run': j.get('last_run'),
        'last_status': j.get('last_status'),
    } for j in jobs]
    return jsonify({'success': True, 'jobs': visible, 'count': len(visible)})


@cron_bp.route('/jobs/<job_id>/track', methods=['POST'])
@admin_required
def toggle_tracking(job_id):
    """Enable/disable run tracking for a job (rewrites its crontab line with the
    serverkit-cron-run shim; disabling restores the bare command)."""
    data = request.get_json(silent=True) or {}
    enabled = bool(data.get('enabled', True))
    options = {}
    if 'alert_on_failure' in data:
        options['alert_on_failure'] = data['alert_on_failure']
    result = CronService.set_tracking(job_id, enabled, **options)
    if result.get('success'):
        return jsonify(result)
    return jsonify(result), 400


@cron_bp.route('/jobs/<job_id>/runs', methods=['GET'])
@admin_required
def job_runs(job_id):
    """Recent run history + success-rate for a job (admin surface)."""
    from app.services.cron_run_service import CronRunService
    return jsonify({
        'success': True,
        'runs': CronRunService.recent_runs(job_id, limit=20),
        'stats': CronRunService.stats(job_id),
    })


@cron_bp.route('/runs/ingest', methods=['POST'])
@admin_required
def ingest_run():
    """Ingest a run reported by the serverkit-cron-run shim.

    Localhost-only + a short-mint break-glass admin token (Decision 9, mirroring
    the CLI break-glass client). Records the run and fires an edge-triggered
    failure/recovery notification on a status TRANSITION only.
    """
    # The cron-run shim posts DIRECTLY to the panel's loopback gunicorn port
    # (cli_api_client base http://127.0.0.1:<port>), never through nginx, so no
    # X-Forwarded-For is present and ProxyFix (plan 48) leaves remote_addr as the
    # real 127.0.0.1 peer. A request routed through nginx instead carries the
    # real client as the rightmost hop, so this gate can't be spoofed to 127.0.0.1.
    remote = (request.remote_addr or '')
    if remote not in ('127.0.0.1', '::1', 'localhost'):
        return jsonify({'error': 'Ingest is restricted to localhost'}), 403

    data = request.get_json(silent=True) or {}
    job_id = data.get('job_id')
    if not job_id:
        return jsonify({'error': 'job_id is required'}), 400

    from app.services.cron_run_service import CronRunService
    run, transition = CronRunService.record_run(
        job_id=job_id,
        started_at=data.get('started_at'),
        finished_at=data.get('finished_at'),
        exit_code=data.get('exit_code'),
        output_tail=data.get('output_tail'),
    )

    if transition:
        _notify_run_transition(job_id, transition, run)

    return jsonify({'success': True, 'run_id': run.id, 'status': run.status}), 201


def _notify_run_transition(job_id, transition, run):
    """Edge-triggered failure/recovery alert for a tracked job."""
    job = CronService.get_job(job_id) or {}
    # Alerts default on for tracked jobs; a per-job flag can opt out.
    if not job.get('alert_on_failure', True):
        return

    name = job.get('name') or job_id
    payload = {'name': name, 'job_id': job_id, 'exit_code': run.exit_code,
               'status': run.status}

    aid = job.get('application_id')
    if aid:
        from app.models import Application
        # Unfiltered for the same reason as _attach_attribution: this only
        # labels an alert, and a run reported for a deleted app is exactly the
        # case where the operator needs to see which app it was.
        app = Application.query.get(int(aid))
        if app:
            payload['app'] = app.name
            if app.workspace_id:
                from app.models import Workspace
                ws = Workspace.query.get(app.workspace_id)
                if ws:
                    payload['workspace'] = ws.name

    event = 'cron.job_failed' if transition == 'failure' else 'cron.job_recovered'
    try:
        from app.plugins_sdk import notify
        notify.send(event, to='admins', data=payload, category='system')
    except Exception:  # noqa: BLE001 - alerting must never break ingest
        pass


@cron_bp.route('/preview', methods=['POST'])
@viewer_required
def preview_schedule():
    """Validate + humanize a cron schedule and return the next run times.

    Cheap and side-effect-free (computes over its input only), so it matches the
    existing cron read gate rather than the admin write gate — the Backups and
    server-detail embedders shouldn't need admin to preview a schedule.
    """
    data = request.get_json(silent=True) or {}
    schedule = data.get('schedule', '')
    result = CronService.preview_schedule(schedule)
    return jsonify(result)
