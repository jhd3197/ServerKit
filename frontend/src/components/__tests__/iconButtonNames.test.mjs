import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { infoTipName, nearbyText } from '../infoTipName.js';

// Same interpolation as i18next, minus the dependency on an initialised instance.
const t = (_key, fallback, vars = {}) => fallback.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k]);

test('InfoTip is named after what it explains', () => {
    assert.equal(infoTipName({ subject: 'Server group' }, t), 'More info about Server group');
    assert.equal(infoTipName({ title: 'Retention' }, t), 'More info about Retention');
    assert.equal(infoTipName({ nearby: 'Auto-renew' }, t), 'More info about Auto-renew');
});

test('InfoTip subject beats title beats nearby text; label overrides all; plain fallback', () => {
    assert.equal(infoTipName({ subject: 'A', title: 'B', nearby: 'C' }, t), 'More info about A');
    assert.equal(infoTipName({ title: 'B', nearby: 'C' }, t), 'More info about B');
    assert.equal(infoTipName({ label: 'Why?', subject: 'A' }, t), 'Why?');
    assert.equal(infoTipName({ title: { type: 'span' }, nearby: '  ' }, t), 'More info');
});

test('theme gallery cards name the tip after the theme, not its description', () => {
    assert.equal(infoTipName({ subject: 'Apamate', nearby: 'Warm dark palette' }, t), 'More info about Apamate');
    const gallery = readFileSync(new URL('../settings/ThemeGallery.jsx', import.meta.url), 'utf8');
    assert.match(gallery, /<InfoTip subject=\{themeEntry\.name \|\| themeEntry\.slug\}>/);
});

test('nearbyText reads the label printed before the button, trimmed', () => {
    const el = { previousSibling: { textContent: ' ', previousSibling: { textContent: ' Cert   expiry ' } } };
    assert.equal(nearbyText(el), 'Cert expiry');
    const control = { nodeType: 1, matches: () => true, textContent: 'Preview routing' };
    assert.equal(nearbyText({ previousSibling: control }), '');
    assert.equal(nearbyText({ previousSibling: null }), '');
});

// No jsdom: guard the wiring of the Files toolbar toggle and the file rows.
test('Files toolbar toggles expose aria-pressed; Button names icon-only controls from title', () => {
    const toolbar = readFileSync(new URL('../file-manager/FileManagerToolbar.jsx', import.meta.url), 'utf8');
    assert.match(toolbar, /aria-pressed=\{viewMode === 'grid'\}/);
    assert.match(toolbar, /aria-pressed=\{showHidden\}/);
    const row = readFileSync(new URL('../file-manager/FileRow.jsx', import.meta.url), 'utf8');
    assert.match(row, /aria-pressed=\{selected\}/);
    assert.match(row, /aria-label=\{named\(/);
    const button = readFileSync(new URL('../ui/button.jsx', import.meta.url), 'utf8');
    assert.match(button, /aria-label=\{title && \(reasoned \|\| !hasText\(children\)\) \? title : undefined\}/);
});
