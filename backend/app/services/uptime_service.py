"""
Uptime Tracking Service

Tracks server uptime history and provides uptime statistics.
"""

import os
import json
import time
import psutil
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from pathlib import Path
import threading


class UptimeService:
    """Service for tracking and reporting server uptime."""

    DATA_DIR = '/var/lib/serverkit'
    UPTIME_FILE = os.path.join(DATA_DIR, 'uptime_history.json')

    # For Windows compatibility
    if os.name == 'nt':
        DATA_DIR = os.path.join(os.environ.get('APPDATA', '.'), 'ServerKit')
        UPTIME_FILE = os.path.join(DATA_DIR, 'uptime_history.json')

    # Check interval in seconds (every 5 minutes)
    CHECK_INTERVAL = 300

    # How many data points to keep (90 days worth at 5-minute intervals)
    MAX_DATA_POINTS = 90 * 24 * 12

    _tracking_thread = None
    _stop_tracking = False

    @classmethod
    def _ensure_data_dir(cls) -> None:
        """Ensure data directory exists."""
        os.makedirs(cls.DATA_DIR, exist_ok=True)

    @classmethod
    def _load_history(cls) -> Dict:
        """Load uptime history from file."""
        cls._ensure_data_dir()

        if os.path.exists(cls.UPTIME_FILE):
            try:
                with open(cls.UPTIME_FILE, 'r') as f:
                    return json.load(f)
            except Exception:
                pass

        return {
            'start_time': datetime.now().isoformat(),
            'checks': [],
            'incidents': []
        }

    @classmethod
    def _save_history(cls, history: Dict) -> None:
        """Save uptime history to file."""
        cls._ensure_data_dir()

        try:
            with open(cls.UPTIME_FILE, 'w') as f:
                json.dump(history, f)
        except Exception:
            pass

    @classmethod
    def get_boot_time(cls) -> datetime:
        """Get system boot time."""
        return datetime.fromtimestamp(psutil.boot_time())

    @classmethod
    def get_current_uptime(cls) -> Dict:
        """Get current uptime information."""
        boot_time = cls.get_boot_time()
        now = datetime.now()
        uptime_delta = now - boot_time

        total_seconds = int(uptime_delta.total_seconds())
        days = total_seconds // 86400
        hours = (total_seconds % 86400) // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60

        return {
            'boot_time': boot_time.isoformat(),
            'current_time': now.isoformat(),
            'uptime_seconds': total_seconds,
            'uptime_formatted': {
                'days': days,
                'hours': hours,
                'minutes': minutes,
                'seconds': seconds
            },
            'uptime_string': f"{days}d {hours}h {minutes}m {seconds}s"
        }

    @classmethod
    def record_check(cls, status: str = 'up') -> None:
        """Record an uptime check."""
        history = cls._load_history()

        check = {
            'timestamp': datetime.now().isoformat(),
            'status': status,
            'uptime_seconds': cls.get_current_uptime()['uptime_seconds']
        }

        history['checks'].append(check)

        # Trim old data points
        if len(history['checks']) > cls.MAX_DATA_POINTS:
            history['checks'] = history['checks'][-cls.MAX_DATA_POINTS:]

        cls._save_history(history)

    @classmethod
    def record_incident(cls, incident_type: str, details: str = '') -> None:
        """Record a downtime incident."""
        history = cls._load_history()

        incident = {
            'timestamp': datetime.now().isoformat(),
            'type': incident_type,
            'details': details
        }

        history['incidents'].append(incident)
        cls._save_history(history)

    @classmethod
    def get_uptime_history(cls, hours: int = 24) -> List[Dict]:
        """Get uptime history for the specified number of hours."""
        history = cls._load_history()
        cutoff = datetime.now() - timedelta(hours=hours)

        checks = []
        for check in history.get('checks', []):
            try:
                check_time = datetime.fromisoformat(check['timestamp'])
                if check_time >= cutoff:
                    checks.append(check)
            except Exception:
                pass

        return checks

    @classmethod
    def get_uptime_graph_data(cls, period: str = '24h') -> Dict:
        """
        Get data formatted for uptime graph visualization.

        period: '24h', '7d', '30d', '90d'
        """
        period_hours = {
            '24h': 24,
            '7d': 24 * 7,
            '30d': 24 * 30,
            '90d': 24 * 90
        }

        hours = period_hours.get(period, 24)
        history = cls._load_history()
        now = datetime.now()
        cutoff = now - timedelta(hours=hours)

        # Determine the number of segments based on period
        if period == '24h':
            num_segments = 48  # 30-minute segments
            segment_duration = timedelta(minutes=30)
        elif period == '7d':
            num_segments = 84  # 2-hour segments
            segment_duration = timedelta(hours=2)
        elif period == '30d':
            num_segments = 60  # 12-hour segments
            segment_duration = timedelta(hours=12)
        else:  # 90d
            num_segments = 90  # Daily segments
            segment_duration = timedelta(days=1)

        # Create segments
        segments = []
        segment_start = cutoff

        for i in range(num_segments):
            segment_end = segment_start + segment_duration

            # Find checks within this segment
            segment_checks = []
            for check in history.get('checks', []):
                try:
                    check_time = datetime.fromisoformat(check['timestamp'])
                    if segment_start <= check_time < segment_end:
                        segment_checks.append(check)
                except Exception:
                    pass

            # Determine segment status
            if segment_checks:
                down_checks = sum(1 for c in segment_checks if c.get('status') != 'up')
                total_checks = len(segment_checks)
                uptime_ratio = (total_checks - down_checks) / total_checks if total_checks > 0 else 1

                if uptime_ratio >= 0.99:
                    status = 'up'
                elif uptime_ratio >= 0.9:
                    status = 'degraded'
                else:
                    status = 'down'
            else:
                # No data for this segment (before tracking started or gap)
                status = 'no_data' if segment_start < datetime.fromisoformat(history.get('start_time', now.isoformat())) else 'up'

            segments.append({
                'start': segment_start.isoformat(),
                'end': segment_end.isoformat(),
                'status': status,
                'checks_count': len(segment_checks)
            })

            segment_start = segment_end

        # Calculate overall uptime percentage
        all_checks = cls.get_uptime_history(hours)
        if all_checks:
            up_checks = sum(1 for c in all_checks if c.get('status') == 'up')
            uptime_percentage = (up_checks / len(all_checks)) * 100
        else:
            uptime_percentage = 100.0  # Assume 100% if no data yet

        return {
            'period': period,
            'segments': segments,
            'total_segments': num_segments,
            'uptime_percentage': round(uptime_percentage, 2),
            'total_checks': len(all_checks),
            'current_status': 'up'  # We're running, so we're up
        }

    @classmethod
    def get_uptime_stats(cls) -> Dict:
        """Get comprehensive uptime statistics."""
        current = cls.get_current_uptime()
        history = cls._load_history()

        # Calculate stats for different periods
        periods = {
            '24h': 24,
            '7d': 24 * 7,
            '30d': 24 * 30,
            '90d': 24 * 90
        }

        stats = {}
        for period_name, hours in periods.items():
            checks = cls.get_uptime_history(hours)
            if checks:
                up_checks = sum(1 for c in checks if c.get('status') == 'up')
                stats[period_name] = {
                    'total_checks': len(checks),
                    'up_checks': up_checks,
                    'uptime_percentage': round((up_checks / len(checks)) * 100, 2)
                }
            else:
                stats[period_name] = {
                    'total_checks': 0,
                    'up_checks': 0,
                    'uptime_percentage': 100.0
                }

        return {
            'current': current,
            'periods': stats,
            'incidents': history.get('incidents', [])[-10:],  # Last 10 incidents
            'tracking_since': history.get('start_time')
        }

    @classmethod
    def start_tracking(cls) -> Dict:
        """Start background uptime tracking."""
        if cls._tracking_thread and cls._tracking_thread.is_alive():
            return {'success': False, 'error': 'Tracking already running'}

        cls._stop_tracking = False
        cls._tracking_thread = threading.Thread(target=cls._tracking_loop, daemon=True)
        cls._tracking_thread.start()

        # Record initial check
        cls.record_check('up')

        return {'success': True, 'message': 'Uptime tracking started'}

    @classmethod
    def stop_tracking(cls) -> Dict:
        """Stop background uptime tracking."""
        cls._stop_tracking = True
        return {'success': True, 'message': 'Uptime tracking stopped'}

    @classmethod
    def _tracking_loop(cls) -> None:
        """Background tracking loop."""
        while not cls._stop_tracking:
            try:
                cls.record_check('up')
            except Exception:
                pass

            time.sleep(cls.CHECK_INTERVAL)

    @classmethod
    def is_tracking(cls) -> bool:
        """Check if uptime tracking is active."""
        return cls._tracking_thread is not None and cls._tracking_thread.is_alive()
