// Radix Dialog props that stop overlay click / Escape from closing a dialog.
// Explicit close buttons (Cancel, the header X) still work.
const block = (event) => event.preventDefault();

export function dismissGuards(closeOnDismiss = true) {
    return closeOnDismiss
        ? {}
        : { onPointerDownOutside: block, onInteractOutside: block, onEscapeKeyDown: block };
}
