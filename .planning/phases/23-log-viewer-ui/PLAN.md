# Phase 23: Log Viewer UI - Execution Plan

## Goal
Create a real-time log viewer component in the application detail page that displays Docker container logs with terminal-style formatting, ANSI color support, auto-scroll, and streaming controls.

## Prerequisites
- Phase 22 completed (Container Logs API)
- Backend endpoints available:
  - `GET /apps/{id}/container-logs` (REST)
  - `GET /apps/{id}/containers` (REST)
  - WebSocket events: `subscribe_container_logs`, `container_log`, `container_log_ended`

## Architecture

### Existing Infrastructure

**Socket Service** (`frontend/src/services/socket.js`):
- Uses socket.io-client
- Event listener pattern: `socketService.on(event, callback)`
- Needs extension for container log events

**Application Detail Page** (`frontend/src/pages/ApplicationDetail.jsx`):
- Tab-based layout with Overview, Environment, Private URL, Linked Apps
- Will add new "Logs" tab
- Uses `useParams()` to get app ID

**Existing Styles** (`_terminal.less`, `_logs.less`):
- Terminal dark theme: background `#1a1a2e`, text `#e2e8f0`
- Monospace font: `'JetBrains Mono', 'Fira Code', monospace`
- Log content styling available to extend

### Component Structure
```
ApplicationDetail.jsx
└── Logs Tab
    └── ContainerLogs.jsx (main container)
        ├── LogViewer.jsx (terminal display)
        └── LogToolbar.jsx (controls)
```

## Tasks

### Task 1: Extend Socket Service for Container Logs
**File**: `frontend/src/services/socket.js`

Add methods and event handlers for container log streaming:
```javascript
// Add event handlers in connect()
this.socket.on('container_log', (data) => {
    this.emit('container_log', data);
});
this.socket.on('container_log_ended', (data) => {
    this.emit('container_log_ended', data);
});
this.socket.on('container_log_error', (data) => {
    this.emit('container_log_error', data);
});
this.socket.on('subscribed', (data) => {
    this.emit('subscribed', data);
});

// Add subscribe/unsubscribe methods
subscribeContainerLogs(appId, options = {}) {
    if (this.socket?.connected) {
        this.socket.emit('subscribe_container_logs', {
            app_id: appId,
            tail: options.tail || 100,
            since: options.since,
            service: options.service
        });
    }
}

unsubscribeContainerLogs() {
    if (this.socket?.connected) {
        this.socket.emit('unsubscribe_container_logs');
    }
}
```

### Task 2: Add API Methods for Container Logs
**File**: `frontend/src/services/api.js`

Add methods to fetch container logs and containers list:
```javascript
async getContainerLogs(appId, options = {}) {
    const params = new URLSearchParams();
    if (options.tail) params.append('tail', options.tail);
    if (options.since) params.append('since', options.since);
    if (options.format) params.append('format', options.format);
    if (options.service) params.append('service', options.service);

    const query = params.toString();
    return this.request(`/apps/${appId}/container-logs${query ? '?' + query : ''}`);
}

async getAppContainers(appId) {
    return this.request(`/apps/${appId}/containers`);
}
```

### Task 3: Create ANSI Color Parser Utility
**File**: `frontend/src/utils/ansiParser.js`

Create utility to parse ANSI color codes into HTML spans:
```javascript
// ANSI color code mapping
const ANSI_COLORS = {
    30: '#2e3436', 31: '#cc0000', 32: '#4e9a06', 33: '#c4a000',
    34: '#3465a4', 35: '#75507b', 36: '#06989a', 37: '#d3d7cf',
    90: '#555753', 91: '#ef2929', 92: '#8ae234', 93: '#fce94f',
    94: '#729fcf', 95: '#ad7fa8', 96: '#34e2e2', 97: '#eeeeec'
};

export function parseAnsi(text) {
    // Replace ANSI codes with span elements
    // Handle: colors (30-37, 90-97), bold (1), reset (0)
    // Return array of {text, style} objects for React rendering
}

export function stripAnsi(text) {
    // Remove all ANSI codes for plain text
    return text.replace(/\x1b\[[0-9;]*m/g, '');
}
```

### Task 4: Create LogViewer Component
**File**: `frontend/src/components/LogViewer.jsx`

Create the main log display component:
```jsx
const LogViewer = ({
    logs,           // Array of log entries
    autoScroll,     // Boolean for auto-scroll
    onScrollPause,  // Callback when user scrolls
    maxLines = 1000 // Buffer limit
}) => {
    // Features:
    // - Terminal-style dark theme
    // - ANSI color rendering
    // - Auto-scroll with pause on user scroll
    // - Virtual scrolling for performance (if needed)
    // - Line numbers (optional)
    // - Level-based coloring (error=red, warn=yellow)
};
```

Key implementation details:
- Use ref for scroll container
- Detect user scroll to pause auto-scroll
- Render parsed log lines with ANSI colors
- Apply level-based styles (error/warn/info/debug)
- Limit buffer to prevent memory issues

### Task 5: Create ContainerLogs Component
**File**: `frontend/src/components/ContainerLogs.jsx`

Create the main container component that manages state and WebSocket:
```jsx
const ContainerLogs = ({ appId }) => {
    const [logs, setLogs] = useState([]);
    const [streaming, setStreaming] = useState(false);
    const [autoScroll, setAutoScroll] = useState(true);
    const [containers, setContainers] = useState([]);
    const [selectedService, setSelectedService] = useState(null);
    const [error, setError] = useState(null);
    const [containerState, setContainerState] = useState(null);

    // Load initial logs via REST
    // Connect to WebSocket for streaming
    // Handle container selection for compose apps
    // Provide play/pause/clear/download controls
};
```

Toolbar controls:
- Play/Pause streaming button
- Clear logs button
- Download logs button
- Service selector (for compose apps)
- Line count selector (100, 500, 1000)
- Connection status indicator

### Task 6: Add Logs Tab to ApplicationDetail
**File**: `frontend/src/pages/ApplicationDetail.jsx`

Add the Logs tab to the existing tab navigation:
```jsx
// Add import
import ContainerLogs from '../components/ContainerLogs';

// Add to tabs array (around line 550)
{ id: 'logs', label: 'Logs', icon: Terminal }

// Add tab content (in renderTabContent)
case 'logs':
    return <ContainerLogs appId={app.id} />;
```

### Task 7: Add Styles for Log Viewer
**File**: `frontend/src/styles/components/_container-logs.less`

Create styles for the log viewer:
```less
.container-logs {
    display: flex;
    flex-direction: column;
    height: 500px; // Or flexible based on container

    .logs-toolbar {
        // Play/pause, clear, download buttons
        // Service selector
        // Status indicator
    }

    .log-viewer {
        flex: 1;
        overflow: auto;
        background: #1a1a2e;
        border-radius: @radius-lg;

        .log-line {
            // Individual log line styling
            // Timestamp, level indicator, message
        }

        // ANSI color classes
        .ansi-red { color: #ef2929; }
        .ansi-green { color: #8ae234; }
        .ansi-yellow { color: #fce94f; }
        // ... etc
    }
}
```

Import in main styles file.

## Success Criteria
- [ ] Logs display in real-time via WebSocket
- [ ] ANSI color codes render correctly
- [ ] Auto-scroll works with manual override (pause on user scroll)
- [ ] Can pause/resume streaming
- [ ] Can clear log buffer
- [ ] Can download logs
- [ ] Service selector works for compose apps
- [ ] Shows connection status
- [ ] Handles container stopped state gracefully

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/services/socket.js` | Modify | Add container log events and methods |
| `frontend/src/services/api.js` | Modify | Add container logs API methods |
| `frontend/src/utils/ansiParser.js` | Create | ANSI color code parsing |
| `frontend/src/components/LogViewer.jsx` | Create | Terminal-style log display |
| `frontend/src/components/ContainerLogs.jsx` | Create | Main container with controls |
| `frontend/src/pages/ApplicationDetail.jsx` | Modify | Add Logs tab |
| `frontend/src/styles/components/_container-logs.less` | Create | Log viewer styles |
| `frontend/src/styles/main.less` | Modify | Import new styles |

## Technical Notes

### Auto-Scroll Behavior
- Auto-scroll enabled by default
- Pauses when user scrolls up
- Resumes when user scrolls to bottom or clicks "Resume" button
- Visual indicator shows when paused

### Buffer Management
- Keep max 1000 lines in memory
- Older lines discarded when limit reached
- Download fetches from REST API (more lines available)

### ANSI Color Handling
Standard ANSI escape codes:
- `\x1b[0m` - Reset
- `\x1b[1m` - Bold
- `\x1b[30-37m` - Standard colors
- `\x1b[90-97m` - Bright colors

### WebSocket Event Data Format
```javascript
// container_log event
{
    app_id: 1,
    line: "2024-01-15T10:30:45.123Z INFO: Server started",
    parsed: {
        timestamp: "2024-01-15T10:30:45.123Z",
        message: "INFO: Server started",
        level: "info"
    },
    timestamp: 1705312245.123
}
```

## Estimated Commits
- feat(23-1): Add container log methods to socket and API services
- feat(23-2): Create ANSI color parser utility
- feat(23-3): Create LogViewer component with terminal display
- feat(23-4): Create ContainerLogs component with streaming controls
- feat(23-5): Add Logs tab to ApplicationDetail page
- feat(23-6): Add container logs styles
