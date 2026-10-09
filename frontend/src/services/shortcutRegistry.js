export const isEditableTarget = (target) => {
    if (!target) return false;
    const tagName = String(target.tagName || '').toLowerCase();
    return target.isContentEditable
        || ['input', 'textarea', 'select'].includes(tagName)
        // A Radix Select (trigger = combobox, open list = listbox) owns its
        // keys the way a native <select> did: Escape closes the list, not
        // whatever page shortcut is bound to Escape.
        || Boolean(target.closest?.('[contenteditable="true"], [role="combobox"], [role="listbox"]'));
};

export const matchesShortcut = (event, shortcut) => {
    if (String(event.key).toLowerCase() !== String(shortcut.key).toLowerCase()) return false;
    const ctrlOrMeta = Boolean(event.ctrlKey || event.metaKey);
    if (Boolean(shortcut.ctrlOrMeta) !== ctrlOrMeta) return false;
    if (!shortcut.ctrlOrMeta) {
        if (Boolean(shortcut.ctrl) !== Boolean(event.ctrlKey)) return false;
        if (Boolean(shortcut.meta) !== Boolean(event.metaKey)) return false;
    }
    if (Boolean(shortcut.shift) !== Boolean(event.shiftKey)) return false;
    if (Boolean(shortcut.alt) !== Boolean(event.altKey)) return false;
    return true;
};

export function createShortcutRegistry() {
    const commands = new Map();

    const register = (command) => {
        if (!command?.id || !command?.handler || !command?.keys?.length) {
            throw new Error('A shortcut requires id, keys, and handler');
        }
        commands.set(command.id, command);
        return () => {
            if (commands.get(command.id) === command) commands.delete(command.id);
        };
    };

    const handle = (event) => {
        const ordered = [...commands.values()]
            .filter((command) => command.enabled !== false)
            .sort((left, right) => (right.priority || 0) - (left.priority || 0));
        for (const command of ordered) {
            if (!command.allowInInput && isEditableTarget(event.target)) continue;
            if (!command.keys.some((key) => matchesShortcut(event, key))) continue;
            if (command.preventDefault !== false) event.preventDefault?.();
            command.handler(event);
            return command.id;
        }
        return null;
    };

    const list = () => [...commands.values()].map(({ handler: _handler, ...command }) => command);

    return { register, handle, list };
}
