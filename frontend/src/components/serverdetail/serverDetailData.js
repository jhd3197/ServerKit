import { statusKind } from '../ds/status.js';

// Server status → ds Pill tone (shared by the header pill and the
// Overview "Status" row).
// Server connection states ride the shared vocabulary.
export const serverStatusKind = (status) => statusKind(status);

// The backend names an unpaired server "Pending pairing (<short id>)"
// (api/servers.py _placeholder_name); the id suffix is noise in a heading.
const PLACEHOLDER_NAME = /^Pending pairing \(.*\)$/;
export const isPlaceholderServerName = (name) => PLACEHOLDER_NAME.test(name ?? '');

export const PRESET_LABELS = {
    '* * * * *': 'Every minute',
    '*/5 * * * *': 'Every 5 minutes',
    '*/15 * * * *': 'Every 15 minutes',
    '*/30 * * * *': 'Every 30 minutes',
    '0 * * * *': 'Hourly',
    '0 0 * * *': 'Daily at midnight',
    '0 12 * * *': 'Daily at noon',
    '0 0 * * 0': 'Weekly (Sunday)',
    '0 0 1 * *': 'Monthly (1st)',
};

// Token-lifetime presets shown in the regenerate modal. Mirrors the values
// the Add Server modal uses (frontend/src/pages/Servers.jsx). Keep them in
// sync if you tweak either list.
export const TOKEN_EXPIRY_OPTIONS = [
    { labelKey: 'app.serverDetailShared.1Hour', label: '1 hour',   value: 60 * 60 },
    { labelKey: 'app.serverDetailShared.24Hours', label: '24 hours', value: 24 * 60 * 60 },
    { labelKey: 'app.serverDetailShared.7Days', label: '7 days',   value: 7 * 24 * 60 * 60 },
    { labelKey: 'app.serverDetailShared.30Days', label: '30 days',  value: 30 * 24 * 60 * 60 },
    { labelKey: 'app.serverDetailShared.never', label: 'Never',    value: -1 },
];
