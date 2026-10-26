// Proving test for the Docker image accessors shared by the Docker page and the
// server detail Docker tab. The two transports describe the same image
// differently: the `docker images` CLI gives repository/tag strings and sizes
// like "142MB", the agent gives `repo_tags`, a byte count and epoch seconds.
// Both must render the same name, tag, size and date.
//
// Run: node --test src/components/docker/__tests__/dockerHelpers.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import { imageId, imageRef, imageSizeBytes, imageCreatedMs } from '../dockerHelpers.js';

test('imageRef splits an agent repo_tags entry into repository and tag', () => {
    assert.deepEqual(
        imageRef({ repo_tags: ['roundcube/roundcubemail:latest-apache'] }),
        { repository: 'roundcube/roundcubemail', tag: 'latest-apache' },
    );
    assert.deepEqual(
        imageRef({ repo_tags: ['ghcr.io/docker-mailserver/docker-mailserver:16.0.1'] }),
        { repository: 'ghcr.io/docker-mailserver/docker-mailserver', tag: '16.0.1' },
    );
});

test('imageRef does not split on a registry port', () => {
    assert.deepEqual(imageRef({ repo_tags: ['registry:5000/app'] }), { repository: 'registry:5000/app', tag: '<none>' });
    assert.deepEqual(imageRef({ repo_tags: ['registry:5000/app:1.2'] }), { repository: 'registry:5000/app', tag: '1.2' });
});

test('imageRef reports an untagged image as <none>', () => {
    assert.deepEqual(imageRef({ repo_tags: [] }), { repository: '<none>', tag: '<none>' });
    assert.deepEqual(imageRef({}), { repository: '<none>', tag: '<none>' });
});

test('imageRef passes CLI repository/tag fields through', () => {
    assert.deepEqual(imageRef({ repository: 'nginx', tag: 'latest' }), { repository: 'nginx', tag: 'latest' });
});

test('imageId drops the sha256: prefix', () => {
    assert.equal(imageId({ id: 'sha256:734d9162c522' }), '734d9162c522');
    assert.equal(imageId({ ID: '734d9162c522' }), '734d9162c522');
});

test('imageSizeBytes reads agent byte counts and CLI size strings', () => {
    assert.equal(imageSizeBytes({ size: 1044290102 }), 1044290102);
    assert.equal(imageSizeBytes({ size: '142MB' }), 142e6);
    assert.equal(imageSizeBytes({ size: '1.5GB' }), 1.5e9);
    assert.equal(imageSizeBytes({ size: 'n/a' }), null);
    assert.equal(imageSizeBytes({}), null);
});

test('imageCreatedMs reads agent epoch seconds and CLI date strings', () => {
    assert.equal(imageCreatedMs({ created: 1792605383 }), 1792605383000);
    assert.equal(imageCreatedMs({ created: 1792605383000 }), 1792605383000);
    assert.equal(imageCreatedMs({ CreatedAt: '2026-08-12T09:12:33Z' }), Date.parse('2026-08-12T09:12:33Z'));
    assert.equal(imageCreatedMs({ created: 'not a date' }), null);
});
