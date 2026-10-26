"""A bare % in a crontab command is cron syntax: it ends the command there
and pipes the rest to it as stdin. `date +%F >> log` therefore ran as
`date +` on schedule while "Run now" (bash -c) ran the real thing, so
testing it in the panel looked fine. Lines are written escaped, and every
lookup still finds both escaped and legacy unescaped lines."""
from app.services.cron_service import CronService

from test_cron_crontab_join import linux_cron  # noqa: F401  (fixture)

CMD = '/usr/bin/date +%F'
SCHEDULE = '0 3 * * *'


def _job_line(crontab):
    return [line for line in crontab.split('\n') if line.lstrip('# ').startswith(SCHEDULE)]


def test_written_line_escapes_percent(linux_cron):
    job_id = CronService.add_job(SCHEDULE, CMD, name='stamp')['job_id']
    assert _job_line(linux_cron['crontab']) == [f'{SCHEDULE} /usr/bin/date +\%F']
    job = next(j for j in CronService.list_jobs()['jobs'] if j['id'] == job_id)
    assert job['command'] == CMD


def test_toggle_track_and_edit_find_the_escaped_line(linux_cron):
    job_id = CronService.add_job(SCHEDULE, CMD, name='stamp')['job_id']
    assert CronService.toggle_job(job_id, False)['success']
    assert _job_line(linux_cron['crontab']) == [f'# {SCHEDULE} /usr/bin/date +\%F']
    assert CronService.toggle_job(job_id, True)['success']
    assert CronService.set_tracking(job_id, True)['success']
    [line] = _job_line(linux_cron['crontab'])
    assert line.endswith(f'{job_id} -- /usr/bin/date +\%F')
    assert CronService.update_job(job_id, command='/usr/bin/date +%H%M')['success']
    [line] = _job_line(linux_cron['crontab'])
    assert line.endswith(f'{job_id} -- /usr/bin/date +\%H\%M')


def test_legacy_unescaped_line_is_still_found_and_fixed(linux_cron):
    job_id = CronService.add_job(SCHEDULE, CMD, name='stamp')['job_id']
    linux_cron['crontab'] = linux_cron['crontab'].replace('\%', '%')  # pre-fix line
    assert CronService.update_job(job_id, schedule='0 4 * * *')['success']
    assert '0 4 * * * /usr/bin/date +\%F' in linux_cron['crontab']
    assert '+%F' not in linux_cron['crontab'].replace('\%', '')
