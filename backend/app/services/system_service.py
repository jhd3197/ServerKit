import platform
import psutil
import subprocess
import os
from datetime import datetime


class SystemService:
    """Service for collecting system metrics and information."""

    @staticmethod
    def get_size(bytes_val):
        """Convert bytes to human readable format."""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if bytes_val < 1024:
                return f"{bytes_val:.1f}{unit}"
            bytes_val /= 1024
        return f"{bytes_val:.1f}PB"

    @classmethod
    def get_cpu_metrics(cls):
        """Get CPU usage metrics."""
        cpu_percent = psutil.cpu_percent(interval=0.1)
        cpu_count = psutil.cpu_count()
        cpu_count_logical = psutil.cpu_count(logical=True)
        cpu_freq = psutil.cpu_freq()

        # Per-core usage
        per_cpu = psutil.cpu_percent(interval=0.1, percpu=True)

        return {
            'percent': cpu_percent,
            'count_physical': cpu_count,
            'count_logical': cpu_count_logical,
            'frequency': {
                'current': cpu_freq.current if cpu_freq else 0,
                'min': cpu_freq.min if cpu_freq else 0,
                'max': cpu_freq.max if cpu_freq else 0
            },
            'per_cpu': per_cpu
        }

    @classmethod
    def get_memory_metrics(cls):
        """Get memory usage metrics."""
        memory = psutil.virtual_memory()
        swap = psutil.swap_memory()

        return {
            'ram': {
                'total': memory.total,
                'available': memory.available,
                'used': memory.used,
                'percent': memory.percent,
                'total_human': cls.get_size(memory.total),
                'available_human': cls.get_size(memory.available),
                'used_human': cls.get_size(memory.used)
            },
            'swap': {
                'total': swap.total,
                'used': swap.used,
                'free': swap.free,
                'percent': swap.percent,
                'total_human': cls.get_size(swap.total),
                'used_human': cls.get_size(swap.used)
            }
        }

    @classmethod
    def get_disk_metrics(cls):
        """Get disk usage metrics for all partitions."""
        partitions = psutil.disk_partitions()
        disks = []

        for partition in partitions:
            try:
                usage = psutil.disk_usage(partition.mountpoint)
                disks.append({
                    'device': partition.device,
                    'mountpoint': partition.mountpoint,
                    'fstype': partition.fstype,
                    'total': usage.total,
                    'used': usage.used,
                    'free': usage.free,
                    'percent': usage.percent,
                    'total_human': cls.get_size(usage.total),
                    'used_human': cls.get_size(usage.used),
                    'free_human': cls.get_size(usage.free)
                })
            except (PermissionError, OSError):
                continue

        # Disk I/O
        try:
            disk_io = psutil.disk_io_counters()
            io_stats = {
                'read_bytes': disk_io.read_bytes,
                'write_bytes': disk_io.write_bytes,
                'read_bytes_human': cls.get_size(disk_io.read_bytes),
                'write_bytes_human': cls.get_size(disk_io.write_bytes)
            }
        except Exception:
            io_stats = None

        return {
            'partitions': disks,
            'io': io_stats
        }

    @classmethod
    def get_network_metrics(cls):
        """Get network usage metrics."""
        net_io = psutil.net_io_counters()
        net_if = psutil.net_if_addrs()
        net_stats = psutil.net_if_stats()

        interfaces = []
        for name, addrs in net_if.items():
            stats = net_stats.get(name)
            interface = {
                'name': name,
                'is_up': stats.isup if stats else False,
                'speed': stats.speed if stats else 0,
                'addresses': []
            }
            for addr in addrs:
                interface['addresses'].append({
                    'family': str(addr.family),
                    'address': addr.address,
                    'netmask': addr.netmask
                })
            interfaces.append(interface)

        return {
            'bytes_sent': net_io.bytes_sent,
            'bytes_recv': net_io.bytes_recv,
            'packets_sent': net_io.packets_sent,
            'packets_recv': net_io.packets_recv,
            'bytes_sent_human': cls.get_size(net_io.bytes_sent),
            'bytes_recv_human': cls.get_size(net_io.bytes_recv),
            'interfaces': interfaces
        }

    @classmethod
    def get_load_average(cls):
        """Get system load average."""
        try:
            load = psutil.getloadavg()
            return {
                '1min': round(load[0], 2),
                '5min': round(load[1], 2),
                '15min': round(load[2], 2)
            }
        except (AttributeError, OSError):
            # Windows doesn't support getloadavg
            return {'1min': 0, '5min': 0, '15min': 0}

    @classmethod
    def get_system_info(cls):
        """Get general system information."""
        boot_time = datetime.fromtimestamp(psutil.boot_time())
        uptime = datetime.now() - boot_time

        return {
            'platform': platform.system(),
            'platform_release': platform.release(),
            'platform_version': platform.version(),
            'architecture': platform.machine(),
            'hostname': platform.node(),
            'processor': platform.processor(),
            'python_version': platform.python_version(),
            'boot_time': boot_time.isoformat(),
            'uptime_seconds': int(uptime.total_seconds()),
            'uptime_human': cls._format_uptime(uptime)
        }

    @staticmethod
    def _format_uptime(delta):
        """Format timedelta to human readable string."""
        days = delta.days
        hours, remainder = divmod(delta.seconds, 3600)
        minutes, _ = divmod(remainder, 60)

        parts = []
        if days > 0:
            parts.append(f"{days}d")
        if hours > 0:
            parts.append(f"{hours}h")
        if minutes > 0:
            parts.append(f"{minutes}m")

        return ' '.join(parts) if parts else '0m'

    @classmethod
    def get_all_metrics(cls):
        """Get all system metrics at once."""
        return {
            'cpu': cls.get_cpu_metrics(),
            'memory': cls.get_memory_metrics(),
            'disk': cls.get_disk_metrics(),
            'network': cls.get_network_metrics(),
            'load_average': cls.get_load_average(),
            'system': cls.get_system_info(),
            'timestamp': datetime.utcnow().isoformat()
        }
