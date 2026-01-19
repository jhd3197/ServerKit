# Phase 6: Dashboard Historical Metrics - Summary

## Overview
Added time-series graphs to the dashboard showing CPU, Memory, and Disk usage trends over configurable time periods with automatic data collection and aggregation.

## Completed
- [x] Task 1: Create MetricsHistory Model
- [x] Task 2: Create Metrics History Service
- [x] Task 3: Add Background Metrics Collection
- [x] Task 4: Create Historical Metrics API
- [x] Task 5: Create MetricsGraph Component
- [x] Task 6: Create useMetricsHistory Hook (integrated in component)
- [x] Task 7: Add Graphs to Dashboard
- [x] Task 8: Add Styles for Metrics Graphs
- [x] Task 9: Initialize Collection on App Start

## Implementation Details

### Backend
- **MetricsHistory Model** (`backend/app/models/metrics_history.py`)
  - Stores CPU, Memory, Disk metrics at three aggregation levels: minute, hour, day
  - Composite index on (level, timestamp) for efficient queries
  - Retention: 24h minute data, 7 days hourly, 30 days daily

- **MetricsHistoryService** (`backend/app/services/metrics_history_service.py`)
  - Background thread collects metrics every 60 seconds
  - Auto-aggregates minute→hour (every hour) and hour→day (daily)
  - Auto-cleanup of expired data per retention policy
  - Period configurations: 1h, 6h, 24h use minute level; 7d uses hour; 30d uses day

- **Metrics API** (`backend/app/api/metrics.py`)
  - `GET /api/v1/metrics/history?period=1h` - Get historical data
  - `GET /api/v1/metrics/stats` - Get storage statistics
  - `POST /api/v1/metrics/collection/start|stop` - Control collection
  - `POST /api/v1/metrics/aggregate` - Trigger manual aggregation

### Frontend
- **MetricsGraph Component** (`frontend/src/components/MetricsGraph.jsx`)
  - Recharts-based LineChart with CPU, Memory, Disk lines
  - Period selector (1h, 6h, 24h, 7d, 30d)
  - Summary row with averages
  - Compact mode for smaller displays
  - Custom tooltip with data details

- **Styles** (`frontend/src/styles/components/_metrics-graph.less`)
  - Card layout matching design system
  - Loading, error, empty states
  - Responsive breakpoints for mobile

## API Response Format
```json
{
  "period": "1h",
  "level": "minute",
  "points": 60,
  "data": [
    {
      "timestamp": "2026-01-19T10:00:00",
      "cpu": { "percent": 45.2, "min": null, "max": null },
      "memory": { "percent": 62.1, "used_gb": 8.5, "total_gb": 16.0 },
      "disk": { "percent": 35.0, "used_gb": 200, "total_gb": 500 },
      "load": { "1m": 1.2, "5m": 1.1, "15m": 0.9 }
    }
  ],
  "summary": {
    "cpu_avg": 42.5,
    "memory_avg": 61.8,
    "disk_avg": 35.0
  }
}
```

## Files Changed
- `backend/app/models/metrics_history.py` (new)
- `backend/app/models/__init__.py` (export added)
- `backend/app/services/metrics_history_service.py` (new)
- `backend/app/api/metrics.py` (new)
- `backend/app/__init__.py` (blueprint + auto-start)
- `frontend/src/components/MetricsGraph.jsx` (new)
- `frontend/src/services/api.js` (API methods)
- `frontend/src/pages/Dashboard.jsx` (integration)
- `frontend/src/styles/components/_metrics-graph.less` (new)
- `frontend/src/styles/main.less` (import)

## Notes
- Collection starts automatically on app startup
- Windows compatibility: load averages will be null (not available on Windows)
- Database migration runs automatically (SQLAlchemy create_all)
- Charts update on period change; no auto-refresh (uses cached data)
