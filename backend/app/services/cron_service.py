"""
Cron Job Management Service

Manages scheduled tasks using cron (Linux) or provides a simple job scheduler
for cross-platform compatibility.
"""

import os
import re
import subprocess
import platform
from typing import Dict, List, Optional
from datetime import datetime
import json

# Path for storing job metadata
JOBS_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'cron_jobs.json')


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
        cls._ensure_data_dir()
        if os.path.exists(JOBS_FILE):
            try:
                with open(JOBS_FILE, 'r') as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                pass
        return {'jobs': {}}

    @classmethod
    def _save_jobs_metadata(cls, data: Dict):
        """Save job metadata to file."""
        cls._ensure_data_dir()
        with open(JOBS_FILE, 'w') as f:
            json.dump(data, f, indent=2)

    @classmethod
    def is_linux(cls) -> bool:
        """Check if running on Linux."""
        return platform.system() == 'Linux'

    @classmethod
    def get_status(cls) -> Dict:
        """Get cron service status."""
        if cls.is_linux():
            # Check if cron daemon is running
            try:
                result = subprocess.run(
                    ['systemctl', 'is-active', 'cron'],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                cron_active = result.stdout.strip() == 'active'
            except (subprocess.SubprocessError, FileNotFoundError):
                # Try alternative check
                try:
                    result = subprocess.run(
                        ['pgrep', '-x', 'cron'],
                        capture_output=True,
                        text=True,
                        timeout=5
                    )
                    cron_active = result.returncode == 0
                except (subprocess.SubprocessError, FileNotFoundError):
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
                result = subprocess.run(
                    ['crontab', '-l'],
                    capture_output=True,
                    text=True,
                    timeout=10
                )

                if result.returncode == 0:
                    lines = result.stdout.strip().split('\n')
                    for i, line in enumerate(lines):
                        line = line.strip()
                        # Skip empty lines and comments
                        if not line or line.startswith('#'):
                            continue

                        # Parse cron line
                        job = cls._parse_cron_line(line, i)
                        if job:
                            # Add metadata if available
                            job_id = job.get('id', str(i))
                            if job_id in metadata.get('jobs', {}):
                                job.update(metadata['jobs'][job_id])
                            jobs.append(job)

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

    @classmethod
    def add_job(cls, schedule: str, command: str, name: str = None,
                description: str = None) -> Dict:
        """Add a new cron job."""
        # Validate schedule format
        if not cls._validate_schedule(schedule):
            return {'success': False, 'error': 'Invalid cron schedule format'}

        # Validate command (basic security check)
        if not command or not command.strip():
            return {'success': False, 'error': 'Command cannot be empty'}

        # Generate job ID
        job_id = f"job_{datetime.now().strftime('%Y%m%d%H%M%S')}"

        metadata = cls._load_jobs_metadata()

        if cls.is_linux():
            try:
                # Get current crontab
                result = subprocess.run(
                    ['crontab', '-l'],
                    capture_output=True,
                    text=True,
                    timeout=10
                )

                current_crontab = result.stdout if result.returncode == 0 else ''

                # Add comment and new job
                comment = f"# ServerKit Job: {name or job_id}"
                new_line = f"{schedule} {command}"
                new_crontab = f"{current_crontab.rstrip()}\n{comment}\n{new_line}\n"

                # Install new crontab
                process = subprocess.Popen(
                    ['crontab', '-'],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True
                )
                stdout, stderr = process.communicate(input=new_crontab, timeout=10)

                if process.returncode != 0:
                    return {'success': False, 'error': stderr or 'Failed to install crontab'}

            except subprocess.SubprocessError as e:
                return {'success': False, 'error': str(e)}

        # Save metadata
        metadata['jobs'][job_id] = {
            'name': name or f'Job {job_id}',
            'schedule': schedule,
            'command': command,
            'description': description or cls._describe_schedule(schedule),
            'enabled': True,
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

        if cls.is_linux() and job_data:
            try:
                # Get current crontab
                result = subprocess.run(
                    ['crontab', '-l'],
                    capture_output=True,
                    text=True,
                    timeout=10
                )

                if result.returncode == 0:
                    lines = result.stdout.split('\n')
                    command = job_data.get('command', '')
                    schedule = job_data.get('schedule', '')

                    # Filter out the job and its comment
                    new_lines = []
                    skip_next = False
                    for line in lines:
                        if skip_next:
                            skip_next = False
                            continue
                        if f"# ServerKit Job:" in line and job_id in line:
                            skip_next = True
                            continue
                        if command and schedule and f"{schedule} {command}" in line:
                            continue
                        new_lines.append(line)

                    new_crontab = '\n'.join(new_lines)

                    # Install updated crontab
                    process = subprocess.Popen(
                        ['crontab', '-'],
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True
                    )
                    stdout, stderr = process.communicate(input=new_crontab, timeout=10)

                    if process.returncode != 0:
                        return {'success': False, 'error': stderr or 'Failed to update crontab'}

            except subprocess.SubprocessError as e:
                return {'success': False, 'error': str(e)}

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

        if cls.is_linux():
            try:
                result = subprocess.run(
                    ['crontab', '-l'],
                    capture_output=True,
                    text=True,
                    timeout=10
                )

                if result.returncode == 0:
                    lines = result.stdout.split('\n')
                    command = job_data.get('command', '')
                    schedule = job_data.get('schedule', '')
                    job_line = f"{schedule} {command}"

                    new_lines = []
                    for line in lines:
                        if job_line in line:
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

                    new_crontab = '\n'.join(new_lines)

                    process = subprocess.Popen(
                        ['crontab', '-'],
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        text=True
                    )
                    stdout, stderr = process.communicate(input=new_crontab, timeout=10)

                    if process.returncode != 0:
                        return {'success': False, 'error': stderr}

            except subprocess.SubprocessError as e:
                return {'success': False, 'error': str(e)}

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
            'presets': [
                {'name': name, 'schedule': schedule, 'description': cls._describe_schedule(schedule)}
                for name, schedule in cls.PRESETS.items()
            ]
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

        try:
            # Run the command
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                timeout=60
            )

            return {
                'success': True,
                'exit_code': result.returncode,
                'stdout': result.stdout,
                'stderr': result.stderr,
                'message': 'Job executed'
            }

        except subprocess.TimeoutExpired:
            return {'success': False, 'error': 'Job execution timed out (60s limit)'}
        except subprocess.SubprocessError as e:
            return {'success': False, 'error': str(e)}
