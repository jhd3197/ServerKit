# Phase 6: Dashboard Historical Metrics - Execution Plan

## Objective
Add time-series graphs for CPU, Memory, and Disk usage on the Dashboard. Store metrics historically and allow querying by time period (1h, 6h, 24h, 7d, 30d).

## Context

### Current Implementation
- **Monitoring Service** (`backend/app/services/monitoring_service.py`): Uses `psutil` to get current metrics
- **WebSocket Metrics**: `useMetrics` hook subscribes to real-time metrics via WebSocket
- **Dashboard**: Displays current metrics in cards with progress bars
- **Frontend**: Already has `recharts` v2.12.3 installed

### Key Findings
- `MonitoringService.get_current_metrics()` returns CPU, memory, disk, load average
- Dashboard already uses WebSocket for real-time updates
- SQLite is used for all app data - can add MetricsHistory model
- Need to balance storage size with query performance

### Storage Decision
**Use SQLite** with automatic data aggregation:
- Keep 24h of minute-level data (~1440 rows/day)
- Aggregate to hourly for 7-day view (~168 rows)
- Aggregate to daily for 30-day view (~30 rows)
- Total: ~1640 rows maximum - very manageable

---

## Prerequisites

1. Backend running with SQLAlchemy
2. Frontend with recharts installed
3. Existing monitoring service working

---

## Tasks

### Task 1: Create MetricsHistory Model
**Type**: Backend - Database

Create `backend/app/models/metrics_history.py`:

```python
from datetime import datetime
from app import db

class MetricsHistory(db.Model):
    """Historical metrics storage with automatic aggregation levels."""
    __tablename__ = 'metrics_history'

    id = db.Column(db.Integer, primary_key=True)
    timestamp = db.Column(db.DateTime, nullable=False, index=True)

    # Aggregation level: 'minute', 'hour', 'day'
    level = db.Column(db.String(10), nullable=False, default='minute', index=True)

    # CPU metrics
    cpu_percent = db.Column(db.Float, nullable=False)
    cpu_percent_min = db.Column(db.Float, nullable=True)  # For aggregated records
    cpu_percent_max = db.Column(db.Float, nullable=True)

    # Memory metrics
    memory_percent = db.Column(db.Float, nullable=False)
    memory_used_bytes = db.Column(db.BigInteger, nullable=False)
    memory_total_bytes = db.Column(db.BigInteger, nullable=False)

    # Disk metrics (root partition)
    disk_percent = db.Column(db.Float, nullable=False)
    disk_used_bytes = db.Column(db.BigInteger, nullable=False)
    disk_total_bytes = db.Column(db.BigInteger, nullable=False)

    # Load average (Unix only)
    load_1m = db.Column(db.Float, nullable=True)
    load_5m = db.Column(db.Float, nullable=True)
    load_15m = db.Column(db.Float, nullable=True)

    # Sample count (for aggregated records)
    sample_count = db.Column(db.Integer, default=1)

    def to_dict(self):
        return {
            'timestamp': self.timestamp.isoformat(),
            'level': self.level,
            'cpu': {
                'percent': self.cpu_percent,
                'min': self.cpu_percent_min,
                'max': self.cpu_percent_max
            },
            'memory': {
                'percent': self.memory_percent,
                'used_bytes': self.memory_used_bytes,
                'total_bytes': self.memory_total_bytes
            },
            'disk': {
                'percent': self.disk_percent,
                'used_bytes': self.disk_used_bytes,
                'total_bytes': self.disk_total_bytes
            },
            'load': {
                '1m': self.load_1m,
                '5m': self.load_5m,
                '15m': self.load_15m
            }
        }
```

Update `backend/app/models/__init__.py` to export the new model.

**Expected Result**: MetricsHistory table created on app start

---

### Task 2: Create Metrics History Service
**Type**: Backend - Service

Create `backend/app/services/metrics_history_service.py`:

Key methods:
1. `record_metrics()` - Store current metrics snapshot
2. `get_history(period)` - Query historical data by time period
3. `aggregate_old_data()` - Aggregate minute data to hour/day
4. `cleanup_old_data()` - Remove data older than retention period

Retention policy:
- Minute-level: 24 hours
- Hour-level: 7 days
- Day-level: 30 days

Collection approach:
- Background thread or use existing monitoring thread
- Record every 60 seconds
- Run aggregation every hour (via cron or thread)

**Expected Result**: Service that records and retrieves historical metrics

---

### Task 3: Add Background Metrics Collection
**Type**: Backend - Service

Modify `backend/app/services/monitoring_service.py` or create a separate background task:

1. Start collection thread on app startup
2. Record metrics every 60 seconds
3. Run hourly aggregation
4. Run daily cleanup

Options:
- Add to existing monitoring thread
- Use Flask-APScheduler (if installed)
- Use simple threading.Timer

Recommendation: Extend existing MonitoringService with history recording.

**Expected Result**: Metrics automatically recorded every minute

---

### Task 4: Create Historical Metrics API
**Type**: Backend - API

Create `backend/app/api/metrics.py`:

```python
@metrics_bp.route('/history', methods=['GET'])
@jwt_required()
def get_metrics_history():
    """Get historical metrics data.

    Query params:
        period: 1h, 6h, 24h, 7d, 30d (default: 1h)
        metric: cpu, memory, disk, all (default: all)

    Returns:
        JSON with time-series data points
    """
```

Response format:
```json
{
    "period": "24h",
    "points": 60,
    "data": [
        {
            "timestamp": "2026-01-19T10:00:00",
            "cpu": {"percent": 45.2, "min": 30.1, "max": 78.5},
            "memory": {"percent": 62.1, "used_gb": 7.8, "total_gb": 16.0},
            "disk": {"percent": 45.0, "used_gb": 234.5, "total_gb": 512.0}
        }
    ],
    "summary": {
        "cpu_avg": 42.3,
        "memory_avg": 61.5,
        "disk_avg": 44.8
    }
}
```

Register blueprint in `backend/app/__init__.py`.

**Expected Result**: API endpoint returns historical metrics

---

### Task 5: Create MetricsGraph Component
**Type**: Frontend - Component

Create `frontend/src/components/MetricsGraph.jsx`:

Features:
- Uses Recharts (already installed)
- Responsive container
- Time period selector (1h, 6h, 24h, 7d, 30d)
- Line/Area chart for CPU, Memory, Disk
- Hover tooltips with exact values
- Color coding for thresholds
- Loading state

Props:
```jsx
<MetricsGraph
    data={timeSeriesData}
    metric="cpu|memory|disk"
    period="1h|6h|24h|7d|30d"
    onPeriodChange={handler}
    showMin={boolean}
    showMax={boolean}
/>
```

**Expected Result**: Reusable chart component for metrics

---

### Task 6: Create useMetricsHistory Hook
**Type**: Frontend - Hook

Create `frontend/src/hooks/useMetricsHistory.js`:

```javascript
export function useMetricsHistory(period = '1h') {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Fetch on mount and period change
    // Return { data, loading, error, refresh }
}
```

Add API method to `frontend/src/services/api.js`:
```javascript
async getMetricsHistory(period = '1h') {
    return this.request(`/metrics/history?period=${period}`);
}
```

**Expected Result**: Hook for fetching historical metrics

---

### Task 7: Add Graphs to Dashboard
**Type**: Frontend - Integration

Update `frontend/src/pages/Dashboard.jsx`:

1. Import MetricsGraph component
2. Add state for historical data period
3. Add period selector tabs/buttons
4. Render CPU, Memory, Disk graphs below current stats
5. Handle loading and error states

Layout:
```
[Status Bar]
[Current Stats Cards - CPU | Memory | Disk | Network]
[Period Selector: 1h | 6h | 24h | 7d | 30d]
[Graphs Section]
  - CPU History Graph
  - Memory History Graph
  - Disk History Graph
[Services & Apps Columns]
```

**Expected Result**: Dashboard shows historical graphs

---

### Task 8: Add Styles for Metrics Graphs
**Type**: Frontend - Styles

Create `frontend/src/styles/components/_metrics-graph.less`:

Styles for:
- Graph container with proper sizing
- Period selector tabs
- Recharts customization (tooltip, legend)
- Responsive behavior
- Loading/error states
- Color variables for metrics

Import in `main.less`.

**Expected Result**: Polished graph UI

---

### Task 9: Initialize Collection on App Start
**Type**: Backend - Startup

Ensure metrics collection starts automatically:

1. Check if collection should auto-start (config option)
2. Start background thread in `create_app()` or via `before_first_request`
3. Handle graceful shutdown
4. Log collection status

**Expected Result**: Metrics collection starts with server

---

## Verification Checklist

After completing all tasks:

- [ ] MetricsHistory model exists and table created
- [ ] Metrics recorded every 60 seconds
- [ ] API returns historical data for all periods
- [ ] Aggregation reduces minute data to hour/day
- [ ] Old data cleaned up per retention policy
- [ ] Dashboard displays CPU/Memory/Disk graphs
- [ ] Period selector switches time range
- [ ] Tooltips show exact values on hover
- [ ] Graphs responsive on different screen sizes
- [ ] No performance issues with 30-day view

---

## Success Criteria

- [ ] Metrics stored persistently
- [ ] Historical data queryable by time period
- [ ] Graphs display correctly with interactions
- [ ] Dashboard remains performant

---

## Implementation Notes

### Data Points Per Period
| Period | Level | Expected Points |
|--------|-------|-----------------|
| 1h | minute | 60 |
| 6h | minute | 360 |
| 24h | minute | 1440 |
| 7d | hour | 168 |
| 30d | day | 30 |

### Chart Library
Recharts is already installed. Key components to use:
- `<ResponsiveContainer>` for responsive sizing
- `<LineChart>` or `<AreaChart>` for time series
- `<Tooltip>` for hover info
- `<XAxis>`, `<YAxis>` for axes
- `<Legend>` for metric labels

### Performance Considerations
- Use SQLite indexes on timestamp and level
- Lazy load graphs (only fetch when visible)
- Consider WebSocket for live updates to latest point
- Cache API responses briefly (30 seconds)

---

## Output

After execution:
- MetricsHistory model in database
- Background collection running
- Historical metrics API available
- Dashboard with interactive graphs
- Ready for Phase 7 (Templates Page Polish)
