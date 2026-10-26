"""
Cron Job Management Service

Manages scheduled tasks using cron (Linux) or provides a simple job scheduler
for cross-platform compatibility.
"""

import os
import re
import sys
import secrets
import shlex
import subprocess
import platform
from typing import Dict, List, Optional
from datetime import datetime
import json

from app.utils.config_store import quarantine, save_json_config
from app.utils.system import run_checked, unit_is_active

# Path for storing job metadata
JOBS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'cron_jobs.json')

# The run-tracking shim (serverkit-cron-run) lives at the backend root so a
# tracked crontab line can invoke it by absolute path. app/services/ -> app/ ->
# backend/.
SHIM_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    'serverkit_cron_run.py',
)

_UNSET = object()

# Marker comment written above every ServerKit-managed crontab line. The first
# token after the colon is the job's metadata id — the id, not the display
# name, is what lets list/edit/delete find the line again (#117).
_MARKER_RE = re.compile(r'^#\s*ServerKit Job:\s*(\S+)')


def _auto_capture_cron(action):
    """Best-effort local CRON checkpoint without burdening utility callers.

    Several unit-level and bootstrap callers use CronService outside a Flask
    application context. Restore points are database-backed, so those callers
    must retain the pre-existing standalone service behaviour.
    """
    from flask import has_app_context

    if not has_app_context():
        return None
    from app.services.restore_point_service import auto_capture, get_adapter

    if get_adapter('cron') is None:
        return None
    return auto_capture('cron', 'cron', action)


class CronService:
    """Service for managing cron jobs and scheduled tasks."""

    # Common cron schedule presets
    PRESETS = {
        'every_minute': '* * * * *',
        'every_5_minutes': '*/5 * * * *',
        'every_15_minutes': '*/15 * * * *',
        'every_30_minutes': '*/30 * * * *',
        'hourly': '0 * * * *',
        'daily': '0 0 * * *',
        'daily_midnight': '0 0 * * *',
        'daily_noon': '0 12 * * *',
        'weekly': '0 0 * * 0',
        'monthly': '0 0 1 * *',
        'yearly': '0 0 1 1 *',
    }

    @classmethod
    def _ensure_data_dir(cls):
        """Ensure data directory exists."""
        data_dir = os.path.dirname(JOBS_FILE)
        if not os.path.exists(data_dir):
            os.makedirs(data_dir, exist_ok=True)

    @classmethod
    def _load_jobs_metadata(cls) -> Dict:
        """Load job metadata from file."""
        try:
            return cls._load_jobs_metadata_strict()
        except (json.JSONDecodeError, ValueError):
            # Callers save what they load: without moving the file aside the
            # next add would replace every job's metadata with the new one.
            quarantine(JOBS_FILE)
            return {'jobs': {}}
        except IOError:
            return {'jobs': {}}

    @classmethod
    def _load_jobs_metadata_strict(cls) -> Dict:
        """Load metadata without converting corruption into an empty schedule."""
        cls._ensure_data_dir()
        if not os.path.exists(JOBS_FILE):
            return {'jobs': {}}
        with open(JOBS_FILE, 'r') as handle:
            data = json.load(handle)
        if not isinstance(data, dict) or not isinstance(data.get('jobs'), dict):
            raise ValueError('CRON metadata is malformed')
        return data

    @classmethod
    def _save_jobs_metadata(cls, data: Dict):
        """Save job metadata to file."""
        # Atomic: a full disk or a kill mid-write must not truncate the file.
        result = save_json_config(JOBS_FILE, data)
        if not result['success']:
            raise IOError(result['error'])

    @classmethod
    def is_linux(cls) -> bool:
        """Check if running on Linux."""
        return platform.system() == 'Linux'

    # ── the crontab door ────────────────────────────────────
    # `crontab -l` followed by a Popen-with-stdin `crontab -` was written out
    # five times in this file, each with its own capture_output/text/timeout
    # boilerplate and its own error wording. Two helpers, one run_checked.

    @classmethod
    def _read_crontab(cls) -> Optional[str]:
        """The current user's crontab, or ``None`` if it could not be read.

        ``None`` is "could not read", never "empty crontab". An empty
        crontab is ``''`` and ``crontab -l`` exits non-zero for it on some
        implementations, so callers that install a replacement treat a failed
        read as "start from nothing" only where that was already the behaviour.
        """
        result = run_checked(['crontab', '-l'], timeout=10)
        return result['output'] if result['success'] else None

    @classmethod
    def _install_crontab(cls, content: str) -> Optional[Dict]:
        """Install *content* as the crontab. ``None`` on success, error dict on failure.

        The five copies of this all built a Popen by hand purely to put the new
        crontab on stdin; ``run_checked(..., input=...)`` is the same thing
        without the five chances to forget a timeout.
        """
        result = run_checked(['crontab', '-'], input=content, timeout=10)
        if result['success']:
            return None
        return {'success': False,
                'error': result['error'] or 'Failed to install crontab'}

    @classmethod
    def get_status(cls) -> Dict:
        """Get cron service status."""
        if cls.is_linux():
            # Check if cron daemon is running
            active = unit_is_active('cron', timeout=5)
            if active is not None:
                cron_active = active
            else:
                # Try alternative check
                try:
                    cron_active = run_checked(['pgrep', '-x', 'cron'],
                                              timeout=5)['success']
                except Exception:  # noqa: BLE001 - fallback probe
                    cron_active = False

            return {
                'available': True,
                'running': cron_active,
                'platform': 'linux',
                'type': 'cron'
            }
        else:
            # Windows - use internal scheduler simulation
            return {
                'available': True,
                'running': True,
                'platform': 'windows',
                'type': 'serverkit_scheduler',
                'note': 'Using ServerKit internal scheduler (cron syntax supported for display)'
            }

    @classmethod
    def list_jobs(cls) -> Dict:
        """List all cron jobs."""
        jobs = []
        metadata = cls._load_jobs_metadata()

        if cls.is_linux():
            try:
                # Get current user's crontab
                current = cls._read_crontab()
                meta_jobs = metadata.get('jobs', {})
                matched_ids = set()

                if current is not None:
                    lines = current.strip().split('\n')
                    # Id carried over from a "# ServerKit Job: <id>" marker
                    # comment to the job line right below it (#117).
                    pending_id = None
                    for i, line in enumerate(lines):
                        line = line.strip()
                        if not line:
                            pending_id = None
                            continue
                        if line.startswith('#'):
                            marker = _MARKER_RE.match(line)
                            pending_id = marker.group(1) if marker else None
                            continue

                        # Parse cron line
                        job = cls._parse_cron_line(line, i)
                        if job:
                            # Join the crontab line back to its metadata: by the
                            # marker comment's id, or — for lines written before
                            # the marker carried the id (#117) — by matching
                            # schedule + command against the metadata store.
                            job_id = pending_id if pending_id in meta_jobs else None
                            if job_id is None:
                                job_id = cls._find_metadata_match(
                                    meta_jobs, job['schedule'], job['command'],
                                    exclude=matched_ids)
                            if job_id is not None:
                                job.update(meta_jobs[job_id])
                                job['id'] = job_id
                                job['source'] = 'serverkit'
                                matched_ids.add(job_id)
                            jobs.append(job)
                        pending_id = None

                # Metadata-only jobs: disabled ones (their crontab line is
                # commented out, so the scan above never sees them) and jobs
                # whose line was removed by hand. Listing them keeps them
                # editable/deletable from the panel.
                for job_id, job_data in meta_jobs.items():
                    if job_id not in matched_ids:
                        jobs.append({'id': job_id, **job_data,
                                     'source': 'serverkit'})

            except subprocess.SubprocessError as e:
                return {'success': False, 'error': str(e), 'jobs': []}
        else:
            # Return jobs from metadata for non-Linux systems
            for job_id, job_data in metadata.get('jobs', {}).items():
                jobs.append({
                    'id': job_id,
                    **job_data,
                    'source': 'serverkit'
                })

        # Enrich exactly like jobs_for_application(): a human schedule, the next
        # fire time, and the last-run join. The admin list page renders
        # Last run / Next run / Status columns off these, so both surfaces have
        # to agree — leaving it out here is what left /cron showing enabled-only.
        for job in jobs:
            job_id = str(job.get('id', ''))
            job['tracked'] = bool(job.get('tracked', False))
            job['schedule_human'] = (job.get('description')
                                     or cls._describe_schedule(job.get('schedule', '')))
            job['next_run'] = cls._next_run(job.get('schedule', ''))
            cls._attach_run_tracking(job, job_id)

        return {
            'success': True,
            'jobs': jobs,
            'count': len(jobs)
        }

    @classmethod
    def _parse_cron_line(cls, line: str, index: int) -> Optional[Dict]:
        """Parse a cron line into a job dict."""
        # Standard cron format: minute hour day month weekday command
        pattern = r'^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$'
        match = re.match(pattern, line)

        if not match:
            return None

        minute, hour, day, month, weekday, command = match.groups()
        schedule = f"{minute} {hour} {day} {month} {weekday}"
        # cron turns a bare % into a newline; lines we write escape it.
        command = command.replace('\\%', '%')

        return {
            'id': f"cron_{index}",
            'schedule': schedule,
            'command': command,
            'minute': minute,
            'hour': hour,
            'day': day,
            'month': month,
            'weekday': weekday,
            'enabled': True,
            'description': cls._describe_schedule(schedule),
            'source': 'crontab'
        }

    @classmethod
    def _find_metadata_match(cls, meta_jobs: Dict, schedule: str,
                             command: str, exclude=()) -> Optional[str]:
        """Metadata id for a crontab line, matched by schedule + command.

        Fallback join for lines whose marker comment predates carrying the id
        (#117). Matches the bare command or its serverkit-cron-run wrapped
        form. `exclude` holds ids already claimed by earlier lines so two
        identical entries can't collapse onto one."""
        for job_id, data in meta_jobs.items():
            if job_id in exclude or data.get('schedule') != schedule:
                continue
            bare = data.get('command', '')
            if not bare:
                continue
            if command == bare or command.endswith(f"{SHIM_PATH} {job_id} -- {bare}"):
                return job_id
        return None

    @classmethod
    def _line_is_job(cls, line: str, schedule: str, command: str,
                     job_id: str) -> bool:
        """Is this crontab line the given job's entry (bare or shim-wrapped,
        active or commented out)?"""
        if not (schedule and command and job_id):
            return False

        cleaned = line.strip()
        if cleaned.startswith('#'):
            cleaned = cleaned[1:].lstrip()
        parsed = cls._parse_cron_line(cleaned, 0)
        if not parsed or parsed['schedule'] != schedule:
            return False

        return parsed['command'] in {
            command,
            f"{SHIM_PATH} {job_id} -- {command}",
            cls._wrapped_command(command, True, job_id),
        }

    @classmethod
    def _describe_schedule(cls, schedule: str) -> str:
        """Generate human-readable description of cron schedule."""
        # Check against presets
        for name, preset in cls.PRESETS.items():
            if schedule == preset:
                return name.replace('_', ' ').title()

        parts = schedule.split()
        if len(parts) != 5:
            return schedule

        minute, hour, day, month, weekday = parts

        descriptions = []

        # Minute
        if minute == '*':
            descriptions.append('every minute')
        elif minute.startswith('*/'):
            descriptions.append(f'every {minute[2:]} minutes')
        elif minute == '0':
            pass  # Will be described with hour
        else:
            descriptions.append(f'at minute {minute}')

        # Hour
        if hour == '*':
            if minute != '*' and not minute.startswith('*/'):
                descriptions.append('every hour')
        elif hour.startswith('*/'):
            descriptions.append(f'every {hour[2:]} hours')
        else:
            descriptions.append(f'at {hour}:{minute.zfill(2) if minute != "*" else "00"}')

        # Day of month
        if day != '*':
            descriptions.append(f'on day {day}')

        # Month
        if month != '*':
            month_names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
            try:
                month_name = month_names[int(month)]
                descriptions.append(f'in {month_name}')
            except (ValueError, IndexError):
                descriptions.append(f'month {month}')

        # Day of week
        if weekday != '*':
            day_names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            try:
                day_name = day_names[int(weekday)]
                descriptions.append(f'on {day_name}')
            except (ValueError, IndexError):
                descriptions.append(f'weekday {weekday}')

        return ', '.join(descriptions) if descriptions else schedule

    BLOCKED_PATTERNS = [';', '&&', '||', '|', '`', '$(', '>', '<', '\n', '\r']

    @classmethod
    def _validate_command(cls, command: str) -> bool:
        """Validate cron command to prevent injection."""
        for pattern in cls.BLOCKED_PATTERNS:
            if pattern in command:
                return False
        # Require absolute paths
        parts = shlex.split(command)
        if parts and not parts[0].startswith('/'):
            return False
        return True

    @classmethod
    def add_job(cls, schedule: str, command: str, name: str = None,
                description: str = None, application_id=None) -> Dict:
        """Add a new cron job.

        `application_id` optionally attributes the job to an application so the
        member-facing /cron/jobs/for-app surface can show it. Scope
        (workspace/project) is never stored here — it is derived from the app at
        read time."""
        # Validate schedule format
        if not cls._validate_schedule(schedule):
            return {'success': False, 'error': 'Invalid cron schedule format'}

        # Validate command (basic security check)
        if not command or not command.strip():
            return {'success': False, 'error': 'Command cannot be empty'}

        if not cls._validate_command(command):
            return {'success': False, 'error': 'Invalid command: must use absolute paths and cannot contain shell operators (;, &&, ||, |, `, $())'}

        _auto_capture_cron('add_job')

        # The random tail keeps two jobs added in the same second apart.
        job_id = f"job_{datetime.now().strftime('%Y%m%d%H%M%S')}_{secrets.token_hex(3)}"

        metadata = cls._load_jobs_metadata()

        if cls.is_linux():
            current_crontab = cls._read_crontab() or ''

            # Marker comment + new job. The comment must carry the job_id —
            # it is the join key list/edit/delete use to find this line again;
            # writing the display name instead orphaned the job (#117). The
            # name rides along for `crontab -e` readability, newline-stripped
            # so user input can't inject crontab lines.
            comment = f"# ServerKit Job: {job_id}"
            if name:
                clean_name = re.sub(r'\s+', ' ', str(name)).strip()
                if clean_name:
                    comment += f" ({clean_name})"
            new_line = f"{schedule} {cls._crontab_command(command, False, job_id)}"
            new_crontab = f"{current_crontab.rstrip()}\n{comment}\n{new_line}\n"

            failure = cls._install_crontab(new_crontab)
            if failure:
                return failure

        # Save metadata
        metadata['jobs'][job_id] = {
            'name': name or f'Job {job_id}',
            'schedule': schedule,
            'command': command,
            'description': description or cls._describe_schedule(schedule),
            'enabled': True,
            'tracked': False,
            'application_id': application_id,
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat()
        }
        cls._save_jobs_metadata(metadata)

        return {
            'success': True,
            'job_id': job_id,
            'message': 'Job created successfully'
        }

    @classmethod
    def remove_job(cls, job_id: str) -> Dict:
        """Remove a cron job."""
        metadata = cls._load_jobs_metadata()

        if job_id not in metadata.get('jobs', {}):
            # Try to find by cron index
            pass

        job_data = metadata.get('jobs', {}).get(job_id)

        if job_data is not None:
            _auto_capture_cron('remove_job')

        if cls.is_linux() and job_data:
            current = cls._read_crontab()
            if current is not None:
                lines = current.split('\n')
                command = job_data.get('command', '')
                schedule = job_data.get('schedule', '')

                # Filter out the job and its marker comment. The line is
                # matched bare or shim-wrapped (tracked jobs, #117); when a
                # legacy marker comment carries the name instead of the id,
                # dropping the comment sitting right above the removed line
                # keeps it from being orphaned.
                new_lines = []
                skip_next = False
                for line in lines:
                    if skip_next:
                        skip_next = False
                        continue
                    if f"# ServerKit Job:" in line and job_id in line:
                        skip_next = True
                        continue
                    if cls._line_is_job(line, schedule, command, job_id):
                        if new_lines and _MARKER_RE.match(new_lines[-1].strip()):
                            new_lines.pop()
                        continue
                    new_lines.append(line)

                failure = cls._install_crontab('\n'.join(new_lines))
                if failure:
                    return failure

        # Remove from metadata
        if job_id in metadata.get('jobs', {}):
            del metadata['jobs'][job_id]
            cls._save_jobs_metadata(metadata)

        return {'success': True, 'message': 'Job removed successfully'}

    @classmethod
    def toggle_job(cls, job_id: str, enabled: bool) -> Dict:
        """Enable or disable a cron job."""
        metadata = cls._load_jobs_metadata()

        if job_id not in metadata.get('jobs', {}):
            return {'success': False, 'error': 'Job not found'}

        job_data = metadata['jobs'][job_id]
        _auto_capture_cron('toggle_job')

        if cls.is_linux():
            current = cls._read_crontab()
            if current is not None:
                lines = current.split('\n')
                command = job_data.get('command', '')
                schedule = job_data.get('schedule', '')

                new_lines = []
                for line in lines:
                    if cls._line_is_job(line, schedule, command, job_id):
                        if enabled:
                            # Remove leading # if present
                            new_lines.append(line.lstrip('# '))
                        else:
                            # Add # to comment out
                            if not line.startswith('#'):
                                new_lines.append(f"# {line}")
                            else:
                                new_lines.append(line)
                    else:
                        new_lines.append(line)

                failure = cls._install_crontab('\n'.join(new_lines))
                if failure:
                    return failure

        # Update metadata
        metadata['jobs'][job_id]['enabled'] = enabled
        metadata['jobs'][job_id]['updated_at'] = datetime.now().isoformat()
        cls._save_jobs_metadata(metadata)

        return {
            'success': True,
            'enabled': enabled,
            'message': f"Job {'enabled' if enabled else 'disabled'} successfully"
        }

    @classmethod
    def _validate_schedule(cls, schedule: str) -> bool:
        """Validate cron schedule format."""
        parts = schedule.split()
        if len(parts) != 5:
            return False

        # Basic validation for each field
        patterns = [
            r'^(\*|([0-9]|[1-5][0-9])(-([0-9]|[1-5][0-9]))?)(,(\*|([0-9]|[1-5][0-9])(-([0-9]|[1-5][0-9]))?))*(/[0-9]+)?$',  # minute
            r'^(\*|([0-9]|1[0-9]|2[0-3])(-([0-9]|1[0-9]|2[0-3]))?)(,(\*|([0-9]|1[0-9]|2[0-3])(-([0-9]|1[0-9]|2[0-3]))?))*(/[0-9]+)?$',  # hour
            r'^(\*|([1-9]|[12][0-9]|3[01])(-([1-9]|[12][0-9]|3[01]))?)(,(\*|([1-9]|[12][0-9]|3[01])(-([1-9]|[12][0-9]|3[01]))?))*(/[0-9]+)?$',  # day
            r'^(\*|([1-9]|1[0-2])(-([1-9]|1[0-2]))?)(,(\*|([1-9]|1[0-2])(-([1-9]|1[0-2]))?))*(/[0-9]+)?$',  # month
            r'^(\*|[0-6](-[0-6])?)(,(\*|[0-6](-[0-6])?))*(/[0-9]+)?$',  # weekday
        ]

        for i, part in enumerate(parts):
            # Simplified validation - accept common patterns
            if part == '*':
                continue
            if part.startswith('*/') and part[2:].isdigit():
                continue
            if part.isdigit():
                continue
            if ',' in part:
                # Check comma-separated values
                if all(p.isdigit() or p == '*' for p in part.split(',')):
                    continue
            if '-' in part:
                # Check range
                range_parts = part.split('-')
                if len(range_parts) == 2 and all(p.isdigit() for p in range_parts):
                    continue
            # Allow complex patterns
            try:
                if re.match(patterns[i], part):
                    continue
            except (re.error, IndexError):
                pass

            # If we got here with a simple pattern that looks valid, accept it
            if re.match(r'^[\d\*,\-/]+$', part):
                continue

            return False

        return True

    @classmethod
    def get_presets(cls) -> Dict:
        """Get available schedule presets."""
        return {
            'success': True,
            'presets': cls.PRESETS
        }

    @classmethod
    def update_job(cls, job_id: str, name: str = None, command: str = None,
                   schedule: str = None, description: str = None,
                   application_id=None, _set_application: bool = False) -> Dict:
        """Update an existing cron job.

        `application_id` is only touched when `_set_application` is True, so a
        PUT that omits the field leaves the association untouched, while an
        explicit `null` clears it (System bucket)."""
        metadata = cls._load_jobs_metadata()

        if job_id not in metadata.get('jobs', {}):
            return {'success': False, 'error': 'Job not found'}

        job_data = metadata['jobs'][job_id]
        old_schedule = job_data.get('schedule', '')
        old_command = job_data.get('command', '')

        new_schedule = schedule or old_schedule
        new_command = command or old_command

        if schedule and not cls._validate_schedule(schedule):
            return {'success': False, 'error': 'Invalid cron schedule format'}

        _auto_capture_cron('update_job')

        # Update crontab on Linux if schedule or command changed
        if cls.is_linux() and (new_schedule != old_schedule or new_command != old_command):
            current = cls._read_crontab()
            if current is not None:
                tracked = bool(job_data.get('tracked', False))
                new_line = f"{new_schedule} {cls._crontab_command(new_command, tracked, job_id)}"
                failure = cls._rewrite_job_line(old_schedule, old_command, job_id, new_line)
                if failure:
                    return failure

        # Update metadata
        if name is not None:
            job_data['name'] = name
        if command is not None:
            job_data['command'] = command
        if schedule is not None:
            job_data['schedule'] = schedule
        if description is not None:
            job_data['description'] = description
        if _set_application:
            job_data['application_id'] = application_id
        job_data['updated_at'] = datetime.now().isoformat()

        cls._save_jobs_metadata(metadata)

        return {
            'success': True,
            'job_id': job_id,
            'message': 'Job updated successfully'
        }

    @classmethod
    def run_job_now(cls, job_id: str) -> Dict:
        """Execute a job immediately."""
        metadata = cls._load_jobs_metadata()

        if job_id not in metadata.get('jobs', {}):
            return {'success': False, 'error': 'Job not found'}

        job_data = metadata['jobs'][job_id]
        command = job_data.get('command', '')

        if not command:
            return {'success': False, 'error': 'Job has no command'}

        started = datetime.now()
        try:
            # Run the command
            result = run_checked(['bash', '-c', command], timeout=60)

            # Record the run in history too (#18) — a manual "Run now" is a real
            # execution, so it shows up alongside cron-triggered runs. Best-effort:
            # a recording failure (e.g. no app context) must never fail the run.
            cls._record_run_safe(
                job_id,
                started=started,
                finished=datetime.now(),
                exit_code=result['returncode'],
                output_tail=result['output'] + result['stderr'],
            )

            if result['returncode'] is None:
                # No exit code means the job never ran (no bash, or it outlived
                # the 60s bound) — reporting exit_code None as a run would put a
                # fabricated success in the history.
                return {'success': False, 'error': result['error']}

            return {
                'success': True,
                'exit_code': result['returncode'],
                'stdout': result['output'],
                'stderr': result['stderr'],
                'message': 'Job executed'
            }

        except Exception as e:  # noqa: BLE001
            return {'success': False, 'error': str(e)}

    @classmethod
    def _record_run_safe(cls, job_id, started=None, finished=None,
                         exit_code=None, output_tail=None):
        """Record a CronRun without ever raising (best-effort history join)."""
        try:
            from app.services.cron_run_service import CronRunService
            CronRunService.record_run(
                job_id=job_id,
                started_at=started,
                finished_at=finished,
                exit_code=exit_code,
                output_tail=output_tail,
            )
        except Exception:  # noqa: BLE001 - history is best-effort
            pass

    # ------------------------------------------------------------------ #
    # Run tracking (the serverkit-cron-run shim) + read-time joins
    # ------------------------------------------------------------------ #

    @classmethod
    def _wrapped_command(cls, command: str, tracked: bool, job_id: str) -> str:
        """The command a job's line runs: tracked jobs are wrapped by the
        serverkit-cron-run shim so every run records its exit code + output
        tail; untracked jobs run the bare command."""
        if not tracked:
            return command
        python = sys.executable or 'python3'
        return f"{python} {SHIM_PATH} {job_id} -- {command}"

    @classmethod
    def _crontab_command(cls, command: str, tracked: bool, job_id: str) -> str:
        """The job's command as written into the crontab. An unescaped % ends
        the command there and feeds the rest to it as stdin, so
        `date +%F` would run as `date +`."""
        return cls._wrapped_command(command, tracked, job_id).replace('%', '\\%')

    @classmethod
    def get_job(cls, job_id: str) -> Optional[Dict]:
        """Return a single job's metadata (with a normalized `tracked` flag), or
        None when the id is unknown."""
        metadata = cls._load_jobs_metadata()
        job_data = metadata.get('jobs', {}).get(job_id)
        if job_data is None:
            return None
        job = {'id': job_id, **job_data}
        job['tracked'] = bool(job_data.get('tracked', False))
        return job

    @classmethod
    def set_tracking(cls, job_id: str, enabled: bool, *,
                     alert_on_failure=_UNSET) -> Dict:
        """Enable/disable run tracking for a job.

        On Linux this rewrites the job's crontab line to add/remove the
        serverkit-cron-run wrapper; everywhere it flips the persisted `tracked`
        flag. Returns {'success', 'tracked'}."""
        metadata = cls._load_jobs_metadata()
        if job_id not in metadata.get('jobs', {}):
            return {'success': False, 'error': 'Job not found'}

        job_data = metadata['jobs'][job_id]
        enabled = bool(enabled)
        was_tracked = bool(job_data.get('tracked', False))
        _auto_capture_cron('set_tracking')

        if cls.is_linux() and enabled != was_tracked:
            schedule = job_data.get('schedule', '')
            command = job_data.get('command', '')
            new_line = f"{schedule} {cls._crontab_command(command, enabled, job_id)}"
            err = cls._rewrite_job_line(schedule, command, job_id, new_line)
            if err is not None:
                return err

        job_data['tracked'] = enabled
        if alert_on_failure is not _UNSET:
            job_data['alert_on_failure'] = bool(alert_on_failure)
        job_data['updated_at'] = datetime.now().isoformat()
        cls._save_jobs_metadata(metadata)

        return {
            'success': True,
            'tracked': enabled,
            'message': f"Run tracking {'enabled' if enabled else 'disabled'}",
        }

    @classmethod
    def _rewrite_job_line(cls, schedule: str, command: str, job_id: str,
                          new_line: str) -> Optional[Dict]:
        """Replace the job's crontab line (found by parsing, so legacy unescaped
        and escaped lines both match), keeping a disabled job commented out.
        Returns None on success or an error dict. Linux-only."""
        current = cls._read_crontab()
        if current is None:
            return None
        new_lines = [
            (f"# {new_line}" if line.lstrip().startswith('#') else new_line)
            if cls._line_is_job(line, schedule, command, job_id) else line
            for line in current.split('\n')
        ]
        return cls._install_crontab('\n'.join(new_lines))

    # ------------------------------------------------------------------ #
    # Application attribution (member-facing surface)
    # ------------------------------------------------------------------ #

    # Plain @staticmethod — see the note on SystemService._is_iana_timezone.
    # @classmethod stacked on @staticmethod breaks on Python 3.13, which removed
    # classmethod descriptor chaining; cls then leaks in as the first argument.
    @staticmethod
    def _same_application(candidate, application_id) -> bool:
        """Do these two ids name the same app? Ids arrive as int or str."""
        if candidate in (None, ''):
            return False
        try:
            return int(candidate) == int(application_id)
        except (TypeError, ValueError):
            return str(candidate) == str(application_id)

    @classmethod
    def clear_application(cls, application_id) -> int:
        """Drop the association from every job attributed to `application_id`
        (called when the app is PURGED — jobs fall back to the System bucket
        rather than being deleted). Returns the number of jobs changed.

        This is lossy on purpose and therefore purge-only: it nulls the link
        without recording what it was, so nothing could put it back. A soft
        delete uses `suspend_for_application` instead, which is reversible.
        """
        metadata = cls._load_jobs_metadata()
        targets = [
            job_data for job_data in metadata.get('jobs', {}).values()
            if cls._same_application(job_data.get('application_id'), application_id)
        ]
        if targets:
            _auto_capture_cron('clear_application')
        changed = 0
        for job_data in targets:
            job_data['application_id'] = None
            job_data['suspended_by_app'] = False
            job_data['updated_at'] = datetime.now().isoformat()
            changed += 1
        if changed:
            cls._save_jobs_metadata(metadata)
        return changed

    @classmethod
    def suspend_for_application(cls, application_id) -> int:
        """Disable an app's cron jobs when the app is soft-deleted.

        This is the one piece of a soft delete that CANNOT be handled by making
        readers liveness-aware. Everything else that acts on an app is swept
        from a table we can join against; cron jobs are lines in the operating
        system's crontab, and the OS does not know the app is in the bin. Left
        alone they keep firing — running shell commands against a `root_path`
        the purge may later remove.

        Only jobs that are currently ENABLED are touched, and each one is
        stamped `suspended_by_app`. That flag is what makes this reversible:
        without it, restoring would re-enable jobs the user had deliberately
        turned off long before the app was deleted.
        """
        metadata = cls._load_jobs_metadata()
        targets = [
            job_id for job_id, job_data in metadata.get('jobs', {}).items()
            if cls._same_application(job_data.get('application_id'), application_id)
            and job_data.get('enabled')
        ]
        if targets:
            _auto_capture_cron('suspend_for_application')
        from app.services.restore_point_service import suppress_auto_capture
        with suppress_auto_capture():
            for job_id in targets:
                cls.toggle_job(job_id, False)

        if targets:
            # Re-read: toggle_job persists on each call, so the copy above is
            # stale by now and writing it back would undo those saves.
            metadata = cls._load_jobs_metadata()
            for job_id in targets:
                if job_id in metadata.get('jobs', {}):
                    metadata['jobs'][job_id]['suspended_by_app'] = True
            cls._save_jobs_metadata(metadata)
        return len(targets)

    @classmethod
    def resume_for_application(cls, application_id) -> int:
        """Re-enable exactly the jobs `suspend_for_application` disabled."""
        metadata = cls._load_jobs_metadata()
        targets = [
            job_id for job_id, job_data in metadata.get('jobs', {}).items()
            if cls._same_application(job_data.get('application_id'), application_id)
            and job_data.get('suspended_by_app')
        ]
        if targets:
            _auto_capture_cron('resume_for_application')
        from app.services.restore_point_service import suppress_auto_capture
        with suppress_auto_capture():
            for job_id in targets:
                cls.toggle_job(job_id, True)

        if targets:
            metadata = cls._load_jobs_metadata()
            for job_id in targets:
                if job_id in metadata.get('jobs', {}):
                    metadata['jobs'][job_id]['suspended_by_app'] = False
            cls._save_jobs_metadata(metadata)
        return len(targets)

    @classmethod
    def jobs_for_application(cls, application_id) -> List[Dict]:
        """All jobs attributed to `application_id`, enriched with a human
        schedule, the next run time, and a read-time last-run join."""
        metadata = cls._load_jobs_metadata()
        jobs = []
        for job_id, job_data in metadata.get('jobs', {}).items():
            aid = job_data.get('application_id')
            if aid in (None, ''):
                continue
            try:
                if int(aid) != int(application_id):
                    continue
            except (TypeError, ValueError):
                if str(aid) != str(application_id):
                    continue

            schedule = job_data.get('schedule', '')
            job = {'id': job_id, **job_data}
            job['tracked'] = bool(job_data.get('tracked', False))
            job['schedule_human'] = (job_data.get('description')
                                     or cls._describe_schedule(schedule))
            job['next_run'] = cls._next_run(schedule)
            cls._attach_run_tracking(job, job_id)
            jobs.append(job)
        return jobs

    @classmethod
    def _attach_run_tracking(cls, job: Dict, job_id: str):
        """Fold the latest run summary onto a job dict (best-effort)."""
        try:
            from app.services.cron_run_service import CronRunService
            stats = CronRunService.stats(job_id)
            job['last_run'] = stats.get('last_run')
            job['last_status'] = stats.get('last_status')
            job['success_rate'] = stats.get('success_rate')
        except Exception:  # noqa: BLE001 - run history is optional context
            job.setdefault('last_run', None)
            job.setdefault('last_status', None)

    # ------------------------------------------------------------------ #
    # Schedule preview (validate + humanize + next runs)
    # ------------------------------------------------------------------ #

    @classmethod
    def preview_schedule(cls, schedule: str, count: int = 5) -> Dict:
        """Validate a cron schedule and return its human description + the next
        `count` run times. Side-effect-free (computes over its input only)."""
        schedule = (schedule or '').strip()
        if not schedule:
            return {'success': False, 'valid': False, 'error': 'Schedule is required'}
        if not cls._validate_schedule(schedule):
            return {'success': False, 'valid': False,
                    'error': 'Invalid cron schedule format'}
        human = cls._describe_schedule(schedule)
        return {
            'success': True,
            'valid': True,
            'schedule': schedule,
            'human': human,
            'description': human,
            'next_runs': cls._next_runs(schedule, count),
        }

    @classmethod
    def _next_runs(cls, schedule: str, count: int = 5) -> List[str]:
        """Next `count` fire times for a schedule as ISO strings (best-effort)."""
        try:
            from croniter import croniter
            base = datetime.now()
            itr = croniter(schedule, base)
            return [itr.get_next(datetime).isoformat() for _ in range(count)]
        except Exception:  # noqa: BLE001 - preview is best-effort
            return []

    @classmethod
    def _next_run(cls, schedule: str) -> Optional[str]:
        runs = cls._next_runs(schedule, 1)
        return runs[0] if runs else None
