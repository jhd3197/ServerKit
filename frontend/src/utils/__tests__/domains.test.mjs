import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDomain, isValidDomain, slugifyLabel, labelUnderBase } from '../domains.js';

test('normalizeDomain strips scheme, path, port, case and trailing dot', () => {
    assert.equal(normalizeDomain('  HTTPS://Shop.Example.com/path?q=1 '), 'shop.example.com');
    assert.equal(normalizeDomain('example.com:8080'), 'example.com');
    assert.equal(normalizeDomain('example.com.'), 'example.com');
    assert.equal(normalizeDomain(null), '');
});

test('isValidDomain accepts hostnames and rejects junk', () => {
    assert.equal(isValidDomain('example.com'), true);
    assert.equal(isValidDomain('a.b-c.example.co.uk'), true);
    assert.equal(isValidDomain('https://example.com/'), true);
    assert.equal(isValidDomain('localhost'), false);
    assert.equal(isValidDomain('-bad.example.com'), false);
    assert.equal(isValidDomain('bad-.example.com'), false);
    assert.equal(isValidDomain('ex ample.com'), false);
    assert.equal(isValidDomain('*.example.com'), false);
    assert.equal(isValidDomain('*.example.com', { allowWildcard: true }), true);
});

test('slugifyLabel keeps subdomain labels typeable', () => {
    assert.equal(slugifyLabel('My App!'), 'my-app-');
    assert.equal(slugifyLabel('blog.staging'), 'blog.staging');
    assert.equal(slugifyLabel('--x..y'), 'x.y');
});

test('labelUnderBase splits a host from its base domain', () => {
    assert.equal(labelUnderBase('blog.acme.dev', 'acme.dev'), 'blog');
    assert.equal(labelUnderBase('a.b.acme.dev', 'acme.dev'), 'a.b');
    assert.equal(labelUnderBase('acme.dev', 'acme.dev'), null);
    assert.equal(labelUnderBase('notacme.dev', 'acme.dev'), null);
    assert.equal(labelUnderBase('blog.acme.dev', ''), null);
});
