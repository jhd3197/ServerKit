// A `value` prop that merely echoes what the field last emitted is not a
// programmatic reset: resyncing then would overwrite keystrokes typed since the
// emit. Kept out of SearchField.jsx so it is testable without a DOM.
export const isExternalReset = (value, emitted) => value !== emitted;
