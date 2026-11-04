import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isExternalReset } from './searchFieldSync';

// Self-contained search box: an icon + debounced text input. Keeps its own
// internal text state and only lifts the (debounced) value up via onSearch, so
// it can be hosted anywhere — including a re-published PageTopbar action node —
// without losing focus between keystrokes. Reusable across any table/list.
export function SearchField({
    value = '',
    onSearch,
    placeholder = 'Search…',
    debounce = 200,
    className,
}) {
    const [text, setText] = useState(value);
    const timer = useRef(null);
    // The last text we lifted up. The parent echoing it back as `value` is not
    // a programmatic change — resyncing then would clobber keystrokes typed
    // since the emit (and cancel their pending search).
    const emitted = useRef(value);

    // Sync when the parent resets/changes the value programmatically (e.g. a
    // "Reset filters" action). Cancel any pending search so it cannot restore
    // the old query after the parent has cleared it.
    useEffect(() => {
        if (!isExternalReset(value, emitted.current)) return;
        emitted.current = value;
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
        setText(value);
    }, [value]);
    useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

    const handleChange = (next) => {
        setText(next);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            timer.current = null;
            emitted.current = next;
            onSearch?.(next);
        }, debounce);
    };

    return (
        <div className={cn('sk-searchfield', className)}>
            <Search className="sk-searchfield__icon" aria-hidden="true" />
            <input
                type="search"
                className="sk-searchfield__input"
                placeholder={placeholder}
                value={text}
                onChange={(event) => handleChange(event.target.value)}
                aria-label={placeholder}
            />
        </div>
    );
}

export default SearchField;
