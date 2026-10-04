import assert from 'node:assert/strict';
import test from 'node:test';

import { createShortcutRegistry, isEditableTarget, matchesShortcut } from '../shortcutRegistry.js';

const eventFor = (key, extras = {}) => ({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    target: { tagName: 'DIV', isContentEditable: false },
    preventDefault() { this.prevented = true; },
    ...extras,
});

test('matches platform command modifiers without accepting extra modifiers', () => {
    assert.equal(matchesShortcut(eventFor('k', { ctrlKey: true }), {
        key: 'k', ctrlOrMeta: true,
    }), true);
    assert.equal(matchesShortcut(eventFor('K', { metaKey: true, shiftKey: true }), {
        key: 'k', ctrlOrMeta: true,
    }), false);
});

test('recognizes typing and contenteditable targets', () => {
    assert.equal(isEditableTarget({ tagName: 'INPUT' }), true);
    assert.equal(isEditableTarget({ tagName: 'div', isContentEditable: true }), true);
    assert.equal(isEditableTarget({ tagName: 'div', isContentEditable: false }), false);
});

test('treats a Radix Select trigger or open list like a native select', () => {
    // closest() stand-in: matches when the selector names this node's role.
    const withRole = (tagName, role) => ({
        tagName,
        isContentEditable: false,
        closest: (selector) => (selector.includes(`[role="${role}"]`) ? {} : null),
    });
    assert.equal(isEditableTarget(withRole('BUTTON', 'combobox')), true);
    assert.equal(isEditableTarget(withRole('DIV', 'listbox')), true);
    assert.equal(isEditableTarget(withRole('BUTTON', 'menuitem')), false);
});

test('dispatches the highest-priority matching command and unregisters cleanly', () => {
    const registry = createShortcutRegistry();
    const called = [];
    registry.register({
        id: 'low', keys: [{ key: 'z', ctrlOrMeta: true }], priority: 1,
        handler: () => called.push('low'),
    });
    const unregister = registry.register({
        id: 'high', keys: [{ key: 'z', ctrlOrMeta: true }], priority: 2,
        handler: () => called.push('high'),
    });

    const first = eventFor('z', { ctrlKey: true });
    assert.equal(registry.handle(first), 'high');
    assert.equal(first.prevented, true);
    assert.deepEqual(called, ['high']);

    unregister();
    assert.equal(registry.handle(eventFor('z', { ctrlKey: true })), 'low');
    assert.deepEqual(called, ['high', 'low']);
});

test('suppresses editing shortcuts while the user is typing unless explicitly allowed', () => {
    const registry = createShortcutRegistry();
    const called = [];
    registry.register({
        id: 'undo', keys: [{ key: 'z', ctrlOrMeta: true }],
        handler: () => called.push('undo'),
    });
    registry.register({
        id: 'palette', keys: [{ key: 'k', ctrlOrMeta: true }], allowInInput: true,
        handler: () => called.push('palette'),
    });

    const input = { tagName: 'INPUT', isContentEditable: false };
    assert.equal(registry.handle(eventFor('z', { ctrlKey: true, target: input })), null);
    assert.equal(registry.handle(eventFor('k', { ctrlKey: true, target: input })), 'palette');
    assert.deepEqual(called, ['palette']);
});
