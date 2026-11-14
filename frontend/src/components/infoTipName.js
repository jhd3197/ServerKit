// Accessible name of an InfoTip's (i) button: "More info about <subject>", or
// plain "More info" when nothing says what it explains. The subject is the
// explicit prop, else the sheet title, else the text printed just before the
// button (the label/heading the tip is placed after).
const MAX = 60;
const CONTROL = 'button,a,input,select,textarea,[role=button]';

// Nearest label text before the button; a neighbouring control is not a label.
export const nearbyText = (el) => {
    for (let n = el?.previousSibling; n; n = n.previousSibling) {
        const text = (n.textContent || '').replace(/\s+/g, ' ').trim();
        if (n.nodeType === 1 && n.matches?.(CONTROL)) return '';
        if (text) return text.length > MAX ? `${text.slice(0, MAX)}…` : text;
    }
    return '';
};

export function infoTipName({ label, subject, title, nearby }, t) {
    const about = [subject, typeof title === 'string' ? title : '', nearby].find((s) => s && s.trim());
    if (label) return label;
    return about
        ? t('common.moreInfoAbout', 'More info about {{subject}}', { subject: about.trim() })
        : t('common.moreInfo', 'More info');
}
