"""SecurityService.check_failed_logins must count only its time window.

The Security -> Events tab asks for the last 24 hours of failed logins
(``GET /api/v1/security/failed-logins?hours=24``), shows the number under
"Failed login attempts (24h)", and alerts with "... in the last 24 hours"
once it reaches the threshold. check_failed_logins computed the cutoff for
that window and never used it, so every failure still in the current auth
log was counted: on a stock weekly logrotate that is up to a week of SSH
noise, which keeps the alert firing on old attempts.

These tests write a throwaway auth log with failures on both sides of the
cutoff, in the two timestamp formats rsyslog writes, and point the service
at it.
"""
from datetime import datetime, timedelta

import pytest

from app.services.security_service import SecurityService

MONTHS = ('Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
          'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec')


def bsd_stamp(when):
    """Traditional syslog stamp, local time and no year: 'Oct  2 09:15:02'.

    Built by hand because strftime's %b follows the locale and syslog's
    month names do not."""
    return f'{MONTHS[when.month - 1]} {when.day:2d} {when:%H:%M:%S}'


def rfc3339_stamp(when):
    """rsyslog's high-precision stamp: '2026-10-22T09:15:02.123456+02:00'."""
    return when.astimezone().isoformat(timespec='microseconds')


def failure(stamp, n):
    return (f'{stamp} web1 sshd[{1000 + n}]: Failed password for root '
            f'from 203.0.113.{n} port {40000 + n} ssh2')


@pytest.fixture
def auth_log(tmp_path, monkeypatch):
    """A temp auth log the service reads instead of the host's, the default
    security config (threshold 5), and alerts captured instead of sent."""
    path = tmp_path / 'auth.log'
    monkeypatch.setattr(SecurityService, 'AUTH_LOGS', (str(path),))
    monkeypatch.setattr(SecurityService, 'SECURITY_CONFIG',
                        str(tmp_path / 'security.json'))
    sent = []
    monkeypatch.setattr(
        SecurityService, '_send_security_notification',
        classmethod(lambda cls, *args, **kwargs: sent.append((args, kwargs))))

    def write(lines):
        path.write_text('\n'.join(lines) + '\n')

    write.sent = sent
    return write


@pytest.mark.parametrize('stamp', [bsd_stamp, rfc3339_stamp],
                         ids=['bsd', 'rfc3339'])
def test_failures_older_than_the_window_are_not_counted(auth_log, stamp):
    now = datetime.now()
    stale = [failure(stamp(now - timedelta(days=days)), n)
             for n, days in enumerate((5, 3, 2), start=1)]
    recent = [failure(stamp(now - timedelta(hours=hours)), n)
              for n, hours in enumerate((2, 1), start=4)]
    auth_log(stale + recent)

    result = SecurityService.check_failed_logins(24)

    assert result['success'] is True
    assert result['failed_attempts'] == 2
    assert result['recent_failures'] == recent
    # Two failures sit under the default threshold of 5. All five lines
    # together reach it, which is what used to raise the alert.
    assert result['alert_triggered'] is False
    assert auth_log.sent == []


def test_the_window_follows_the_hours_requested(auth_log):
    now = datetime.now()
    auth_log([failure(bsd_stamp(now - timedelta(hours=hours)), n)
              for n, hours in enumerate((100, 50, 5), start=1)])

    assert SecurityService.check_failed_logins(24)['failed_attempts'] == 1
    assert SecurityService.check_failed_logins(72)['failed_attempts'] == 2
    assert SecurityService.check_failed_logins(168)['failed_attempts'] == 3


def test_the_alert_reports_the_count_inside_the_window(auth_log):
    now = datetime.now()
    stale = [failure(bsd_stamp(now - timedelta(days=3)), n)
             for n in range(1, 21)]
    recent = [failure(bsd_stamp(now - timedelta(minutes=10 * n)), n)
              for n in range(21, 27)]
    auth_log(stale + recent)

    result = SecurityService.check_failed_logins(24)

    assert result['failed_attempts'] == 6
    assert result['alert_triggered'] is True
    [(args, kwargs)] = auth_log.sent
    assert args == ('failed_logins',
                    'High number of failed login attempts: 6 in the last 24 hours')
    assert kwargs['details'] == {'count': 6}


def test_a_december_stamp_read_in_january_is_from_last_year():
    """The traditional stamp has no year. Taking the current one would put
    New Year's Eve failures eleven months in the future."""
    new_year = datetime(2027, 1, 1, 0, 30)

    assert SecurityService._auth_log_time(
        failure('Dec 31 23:50:07', 1), new_year) == datetime(2026, 12, 31, 23, 50, 7)
    assert SecurityService._auth_log_time(
        failure('Jan  1 00:10:00', 2), new_year) == datetime(2027, 1, 1, 0, 10)


def test_a_line_without_a_recognisable_stamp_is_still_counted(auth_log):
    """A custom rsyslog template the parser does not know cannot be placed
    in time. Counting it keeps the alert from going quiet on such a host."""
    line = 'web1 sshd[1001]: Failed password for root from 203.0.113.1 port 40001 ssh2'
    auth_log([line])

    result = SecurityService.check_failed_logins(24)

    assert result['failed_attempts'] == 1
    assert result['recent_failures'] == [line]
