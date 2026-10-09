import { useMemo, useState } from 'react';
import { Check, AlertTriangle } from 'lucide-react';
import { SegControl } from '@/components/ds';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useTranslation } from 'react-i18next';
import { Button as SharedButton } from '@/components/ui/button';

// SchedulePicker — one friendly cron schedule picker shared by CronJobs, the
// Backups ScheduleCard, the server-detail Cron tab, and extensions (via the SDK).
// Three ways in — Presets / Builder / Advanced — over a single 5-field cron
// string, with a live preview footer (validity + plain-language description +
// the next few run times). The preview is computed client-side so the picker
// renders standalone without a round-trip; the cron string is the single source
// of truth passed up via onChange.
//
//   <SchedulePicker value={cron} onChange={setCron} compact />
//
// Props: value (cron string), onChange(cronString), compact?, presets?.

const DEFAULT_PRESETS = [
    { labelKey: 'app.schedulePicker.every15Minutes', label: 'Every 15 minutes', desc: '*/15 * * * *', cron: '*/15 * * * *' },
    { labelKey: 'app.schedulePicker.hourly', label: 'Hourly', desc: 'On the hour', cron: '0 * * * *' },
    { labelKey: 'app.schedulePicker.every6Hours', label: 'Every 6 hours', desc: '00:00, 06:00 …', cron: '0 */6 * * *' },
    { labelKey: 'app.schedulePicker.daily', label: 'Daily', desc: 'Midnight', cron: '0 0 * * *' },
    { labelKey: 'app.schedulePicker.dailyAt2Am', label: 'Daily at 2 AM', desc: 'Quiet hours', cron: '0 2 * * *' },
    { labelKey: 'app.schedulePicker.weekly', label: 'Weekly', desc: 'Sunday midnight', cron: '0 0 * * 0' },
    { labelKey: 'app.schedulePicker.monthly', label: 'Monthly', desc: '1st, midnight', cron: '0 0 1 * *' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const FIELD_HINTS = [
    { code: '*', label: 'min' },
    { code: '*', label: 'hour' },
    { code: '*', label: 'day' },
    { code: '*', label: 'month' },
    { code: '*', label: 'wday' },
];

const pad2 = (n) => String(n).padStart(2, '0');

// Parse a single cron field into the sorted set of values it matches within
// [min, max]. Supports *, */step, a-b, a-b/step, and comma lists. Returns null
// on anything malformed so the caller can flag the whole expression invalid.
function parseField(field, min, max) {
    const values = new Set();
    for (const part of String(field).split(',')) {
        const [range, stepRaw] = part.split('/');
        const step = stepRaw === undefined ? 1 : Number(stepRaw);
        if (!Number.isInteger(step) || step < 1) return null;

        let lo = min;
        let hi = max;
        if (range !== '*') {
            const bounds = range.split('-');
            if (bounds.length === 1) {
                lo = hi = Number(bounds[0]);
            } else if (bounds.length === 2) {
                lo = Number(bounds[0]);
                hi = Number(bounds[1]);
            } else {
                return null;
            }
            if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
            if (lo < min || hi > max || lo > hi) return null;
        }
        for (let v = lo; v <= hi; v += step) values.add(v);
    }
    return [...values].sort((a, b) => a - b);
}

// Parse a whole 5-field cron string into matcher sets, or null if invalid.
function parseCron(cron) {
    const fields = String(cron || '').trim().split(/\s+/);
    if (fields.length !== 5) return null;
    const minute = parseField(fields[0], 0, 59);
    const hour = parseField(fields[1], 0, 23);
    const dom = parseField(fields[2], 1, 31);
    const month = parseField(fields[3], 1, 12);
    // cron day-of-week: 0-6 (Sunday = 0); 7 is also Sunday, normalize it.
    const dowRaw = parseField(fields[4], 0, 7);
    if (!minute || !hour || !dom || !month || !dowRaw) return null;
    const dow = [...new Set(dowRaw.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b);
    return { minute, hour, dom, month, dow, fields };
}

function isFull(list, min, max) {
    return list.length === (max - min + 1);
}

// A short plain-language summary of a parsed cron. Covers the common shapes and
// falls back to a generic sentence rather than trying to narrate every cron.
function describeCron(parsed) {
    if (!parsed) return 'Not a valid schedule';
    const { minute, hour, dom, month, dow } = parsed;
    const at = (h, m) => `${pad2(h)}:${pad2(m)}`;
    const single = (list, min, max) => (list.length === 1 && !isFull(list, min, max) ? list[0] : null);

    const m = single(minute, 0, 59);
    const h = single(hour, 0, 23);
    const domFull = isFull(dom, 1, 31);
    const monthFull = isFull(month, 1, 12);
    const dowFull = isFull(dow, 0, 6);

    // Every minute.
    if (isFull(minute, 0, 59) && isFull(hour, 0, 23) && domFull && monthFull && dowFull) {
        return 'Every minute';
    }
    // Every N minutes (step over a full minute range).
    if (minute.length > 1 && isFull(hour, 0, 23) && domFull && monthFull && dowFull) {
        const step = minute[1] - minute[0];
        if (step > 0 && minute.every((v, i) => v === minute[0] + i * step)) {
            return `Every ${step} minutes`;
        }
    }
    // Hourly at minute m.
    if (m != null && isFull(hour, 0, 23) && domFull && monthFull && dowFull) {
        return `Every hour at :${pad2(m)}`;
    }
    if (m != null && h != null) {
        // Weekly (specific weekdays).
        if (!dowFull && domFull && monthFull) {
            const days = dow.map((d) => WEEKDAYS[d]).join(', ');
            return `Every ${days} at ${at(h, m)}`;
        }
        // Monthly (specific days of month).
        if (dowFull && !domFull && monthFull) {
            const days = dom.join(', ');
            return `Monthly on day ${days} at ${at(h, m)}`;
        }
        // Daily.
        if (dowFull && domFull && monthFull) {
            return `Every day at ${at(h, m)}`;
        }
    }
    return 'Custom schedule';
}

// Compute the next few run times by stepping minute-by-minute from now. Bounded
// so an unusual schedule can't spin: caps at ~90 days of lookahead.
function nextRuns(parsed, howMany = 3) {
    if (!parsed) return [];
    const { minute, hour, dom, month, dow } = parsed;
    const mSet = new Set(minute);
    const hSet = new Set(hour);
    const domSet = new Set(dom);
    const monSet = new Set(month);
    const dowSet = new Set(dow);
    const domRestricted = !isFull(dom, 1, 31);
    const dowRestricted = !isFull(dow, 0, 6);

    const out = [];
    const t = new Date();
    t.setSeconds(0, 0);
    t.setMinutes(t.getMinutes() + 1);
    const capMinutes = 90 * 24 * 60;
    for (let i = 0; i < capMinutes && out.length < howMany; i++) {
        const matchDom = domSet.has(t.getDate());
        const matchDow = dowSet.has(t.getDay());
        // Vixie-cron rule: when both day-of-month and day-of-week are
        // restricted, either match qualifies the day.
        let dayOk;
        if (domRestricted && dowRestricted) dayOk = matchDom || matchDow;
        else if (domRestricted) dayOk = matchDom;
        else if (dowRestricted) dayOk = matchDow;
        else dayOk = true;

        if (
            mSet.has(t.getMinutes()) &&
            hSet.has(t.getHours()) &&
            monSet.has(t.getMonth() + 1) &&
            dayOk
        ) {
            out.push(new Date(t));
        }
        t.setMinutes(t.getMinutes() + 1);
    }
    return out;
}

function formatRun(date) {
    return `${WEEKDAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

// Read the current cron into rough builder state (best-effort; the builder only
// drives the common shapes and falls back to daily).
function cronToBuilder(cron) {
    const parsed = parseCron(cron);
    const base = { frequency: 'daily', minute: 0, hour: 2, weekdays: [1], dayOfMonth: 1 };
    if (!parsed) return base;
    const one = (list, fallback) => (list.length === 1 ? list[0] : fallback);
    base.minute = one(parsed.minute, 0);
    base.hour = one(parsed.hour, 2);
    if (!isFull(parsed.dow, 0, 6)) {
        base.frequency = 'weekly';
        base.weekdays = parsed.dow.length ? parsed.dow : [1];
    } else if (!isFull(parsed.dom, 1, 31)) {
        base.frequency = 'monthly';
        base.dayOfMonth = one(parsed.dom, 1);
    } else if (isFull(parsed.hour, 0, 23)) {
        base.frequency = 'hourly';
    } else {
        base.frequency = 'daily';
    }
    return base;
}

function builderToCron(b) {
    const min = Math.min(59, Math.max(0, Number(b.minute) || 0));
    const hr = Math.min(23, Math.max(0, Number(b.hour) || 0));
    switch (b.frequency) {
        case 'hourly':
            return `${min} * * * *`;
        case 'weekly': {
            const days = (b.weekdays.length ? [...b.weekdays].sort((a, c) => a - c) : [0]).join(',');
            return `${min} ${hr} * * ${days}`;
        }
        case 'monthly':
            return `${min} ${hr} ${Math.min(31, Math.max(1, Number(b.dayOfMonth) || 1))} * *`;
        case 'daily':
        default:
            return `${min} ${hr} * * *`;
    }
}

const MODES = [
    { value: 'presets', labelKey: 'app.schedulePicker.presets', label: 'Presets' },
    { value: 'builder', labelKey: 'app.schedulePicker.builder', label: 'Builder' },
    { value: 'advanced', labelKey: 'app.schedulePicker.advanced', label: 'Advanced' },
];

export default function SchedulePicker({ value = '', onChange, compact = false, presets = DEFAULT_PRESETS }) {
    const { t } = useTranslation();
    const [mode, setMode] = useState('presets');
    const builder = useMemo(() => cronToBuilder(value), [value]);

    const parsed = useMemo(() => parseCron(value), [value]);
    const valid = !!parsed;
    const human = useMemo(() => describeCron(parsed), [parsed]);
    const runs = useMemo(() => (valid ? nextRuns(parsed, 3) : []), [parsed, valid]);

    const emit = (cron) => { if (onChange) onChange(cron); };

    const patchBuilder = (patch) => emit(builderToCron({ ...builder, ...patch }));

    const toggleWeekday = (d) => {
        const set = new Set(builder.weekdays);
        if (set.has(d)) set.delete(d); else set.add(d);
        patchBuilder({ weekdays: [...set] });
    };

    return (
        <div className={`schedule-picker${compact ? ' schedule-picker--compact' : ''}`}>
            <SegControl options={MODES} value={mode} onChange={setMode} />

            {mode === 'presets' && (
                <div className="schedule-picker__presets">
                    {presets.map((p) => (
                        <SharedButton variant="unstyled"
                            key={p.cron}
                            type="button"
                            className={`schedule-picker__preset${value.trim() === p.cron ? ' is-active' : ''}`}
                            onClick={() => emit(p.cron)}
                        >
                            <span className="schedule-picker__preset-label">{p.label}</span>
                            <span className="schedule-picker__preset-desc">{p.desc}</span>
                        </SharedButton>
                    ))}
                </div>
            )}

            {mode === 'builder' && (
                <div className="schedule-picker__builder">
                    <div className="schedule-picker__row">
                        <label id="sp-frequency">{t('app.schedulePicker.frequency', 'Frequency')}</label>
                        <SegControl
                            aria-labelledby="sp-frequency"
                            value={builder.frequency}
                            onChange={(frequency) => patchBuilder({ frequency })}
                            options={[
                                { value: 'hourly', label: t('app.schedulePicker.hourly', 'Hourly') },
                                { value: 'daily', label: t('app.schedulePicker.daily', 'Daily') },
                                { value: 'weekly', label: t('app.schedulePicker.weekly', 'Weekly') },
                                { value: 'monthly', label: t('app.schedulePicker.monthly', 'Monthly') },
                            ]}
                        />
                    </div>

                    {builder.frequency !== 'hourly' && (
                        <div className="schedule-picker__row">
                            <label htmlFor="sp-hour">{t('app.schedulePicker.atHour', 'At hour')}</label>
                            <Select
                                value={String(builder.hour)}
                                onValueChange={(v) => patchBuilder({ hour: Number(v) })}
                            >
                                <SelectTrigger id="sp-hour" size="sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Array.from({ length: 24 }).map((_, h) => (
                                        <SelectItem key={h} value={String(h)}>{pad2(h)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <label htmlFor="sp-minute">minute</label>
                            <Select
                                value={String(builder.minute)}
                                onValueChange={(v) => patchBuilder({ minute: Number(v) })}
                            >
                                <SelectTrigger id="sp-minute" size="sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Array.from({ length: 60 }).map((_, m) => (
                                        <SelectItem key={m} value={String(m)}>{pad2(m)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {builder.frequency === 'hourly' && (
                        <div className="schedule-picker__row">
                            <label htmlFor="sp-minute-h">{t('app.schedulePicker.atMinute', 'At minute')}</label>
                            <Select
                                value={String(builder.minute)}
                                onValueChange={(v) => patchBuilder({ minute: Number(v) })}
                            >
                                <SelectTrigger id="sp-minute-h" size="sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {Array.from({ length: 60 }).map((_, m) => (
                                        <SelectItem key={m} value={String(m)}>{pad2(m)}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {builder.frequency === 'weekly' && (
                        <div className="schedule-picker__row">
                            <label>{t('app.schedulePicker.onDays', 'On days')}</label>
                            <div className="schedule-picker__days">
                                {WEEKDAYS.map((name, d) => (
                                    <SharedButton variant="unstyled"
                                        key={name}
                                        type="button"
                                        className={`schedule-picker__day${builder.weekdays.includes(d) ? ' is-active' : ''}`}
                                        onClick={() => toggleWeekday(d)}
                                    >
                                        {name}
                                    </SharedButton>
                                ))}
                            </div>
                        </div>
                    )}

                    {builder.frequency === 'monthly' && (
                        <div className="schedule-picker__row">
                            <label htmlFor="sp-dom">{t('app.schedulePicker.onDay', 'On day')}</label>
                            <Input
                                id="sp-dom"
                                type="number"
                                min={1}
                                max={31}
                                value={builder.dayOfMonth}
                                onChange={(e) => patchBuilder({ dayOfMonth: Number(e.target.value) })}
                            />
                        </div>
                    )}
                </div>
            )}

            {mode === 'advanced' && (
                <div className="schedule-picker__advanced">
                    <Input
                        className="schedule-picker__cron-input"
                        value={value}
                        placeholder="0 2 * * *"
                        onChange={(e) => emit(e.target.value)}
                        spellCheck={false}
                    />
                    <div className="schedule-picker__fieldhints">
                        {FIELD_HINTS.map((f, i) => (
                            <div key={i} className="schedule-picker__fieldhint">
                                <code>{f.code}</code>
                                <em>{f.label}</em>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="schedule-picker__footer">
                <div className="schedule-picker__cronline">
                    {valid ? (
                        <Check size={15} className="schedule-picker__icon schedule-picker__icon--ok" />
                    ) : (
                        <AlertTriangle size={15} className="schedule-picker__icon schedule-picker__icon--error" />
                    )}
                    <code>{value.trim() || '— — — — —'}</code>
                    <span className="schedule-picker__human">{human}</span>
                </div>
                {runs.length > 0 && (
                    <div className="schedule-picker__nextruns">
                        <span className="schedule-picker__nextruns-label">{t('app.schedulePicker.next', 'Next')}</span>
                        {runs.map((r, i) => (
                            <span key={i} className="schedule-picker__nextrun">{formatRun(r)}</span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
