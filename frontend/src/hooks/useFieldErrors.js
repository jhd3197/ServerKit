import { useCallback, useState } from 'react';
import { mapServerFormError } from './formState';

/**
 * Inline-error timing for a dialog form. The caller computes `problems`
 * ({ field: 'message' } for every field that is currently invalid) on each
 * render; this hook decides when to show them: after the field was blurred,
 * or after a submit attempt. Fresh dialogs show nothing.
 *
 *   const fe = useFieldErrors(problems, 'project');   // control ids: project-<field>
 *   <FormField error={fe.error('name')}><Input onBlur={() => fe.touch('name')} /></FormField>
 *   onSubmit: if (!fe.attempt()) return;   // focuses the first invalid control
 *
 * `fromServer(err)` pins field-keyed server errors (400 `errors`/`field_errors`)
 * to the matching fields and returns true if any matched, so the caller can
 * skip its toast; `clear(field)` drops one on edit, `reset()` drops all.
 */
export default function useFieldErrors(problems, idPrefix) {
    const [touched, setTouched] = useState({});
    const [attempted, setAttempted] = useState(false);
    const [server, setServer] = useState({});

    const touch = useCallback((name) => setTouched((s) => (s[name] ? s : { ...s, [name]: true })), []);
    const clear = useCallback((name) => setServer((s) => (s[name] ? { ...s, [name]: undefined } : s)), []);
    const reset = useCallback(() => { setTouched({}); setAttempted(false); setServer({}); }, []);

    const fromServer = (err) => {
        const known = Object.entries(mapServerFormError(err).fieldErrors).filter(([k]) => k in problems);
        if (known.length) setServer((s) => ({ ...s, ...Object.fromEntries(known) }));
        return known.length > 0;
    };

    const error = (name) => server[name] || ((attempted || touched[name]) ? problems[name] : undefined);

    // Returns true when the form may be submitted; otherwise reveals every
    // error and moves focus to the first invalid control.
    const attempt = () => {
        const first = Object.keys(problems).find((k) => problems[k]);
        if (!first) return true;
        setAttempted(true);
        document.getElementById(`${idPrefix}-${first}`)?.focus();
        return false;
    };

    return { error, touch, clear, reset, fromServer, attempt };
}
