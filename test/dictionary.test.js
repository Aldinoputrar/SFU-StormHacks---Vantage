import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWordChecker, readMerriamPage } from '../src/dictionary.js';

test('reads a page that says the word is valid', () => {
  assert.equal(readMerriamPage('<h1>LOVE</h1><p>love is a valid Scrabble word.</p>', 'LOVE'), true);
  assert.equal(readMerriamPage('<title>Is QI a valid Scrabble word?</title><p>QI is playable</p>', 'QI'), true);
  assert.equal(readMerriamPage('<div class="word">qi</div><span>Playable</span>', 'qi'), true);
});

test('reads a page that says the word is not valid', () => {
  assert.equal(readMerriamPage('<p>Sorry, zzzq is not a valid word.</p>', 'ZZZQ'), false);
  assert.equal(
    readMerriamPage('<title>Is ZZZQ a valid Scrabble word?</title><p>ZZZQ is not playable.</p>', 'ZZZQ'),
    false,
  );
  assert.equal(readMerriamPage('<title>Is ZZZQ valid?</title><p>No results found</p>', 'ZZZQ'), false);
  assert.equal(readMerriamPage('<p>Page</p>', 'ZZZQ', 404), false);
});

test("says nothing when the page doesn't say", () => {
  assert.equal(readMerriamPage('<p>Welcome to the word finder</p>', 'LOVE'), null);
});

test('falls back to the offline list when the site cannot be reached', async () => {
  const checker = createWordChecker({
    storage: false,
    fetchPage: async () => {
      throw new Error('offline');
    },
    loadOffline: async () => (word) => word === 'LOVE',
  });
  assert.deepEqual(await checker.check('love'), { word: 'LOVE', valid: true, source: 'offline list' });
  assert.equal((await checker.check('ZZZQ')).valid, false);
});

test('falls back to the offline list when the page cannot be read', async () => {
  const checker = createWordChecker({
    storage: false,
    fetchPage: async () => ({ status: 200, html: '<p>Please enable JavaScript</p>' }),
    loadOffline: async () => () => true,
  });
  assert.equal((await checker.check('LARCH')).source, 'offline list');
});

test('asks Merriam-Webster once per word', async () => {
  let lookups = 0;
  const checker = createWordChecker({
    storage: false,
    fetchPage: async (word) => {
      lookups++;
      return { status: 200, html: `<p>${word} is a valid Scrabble word</p>` };
    },
    loadOffline: async () => () => false,
  });
  const results = await checker.checkAll(['ABLE', 'ABLE', 'ABLE']);
  assert.ok(results.every((r) => r.valid && r.source === 'Merriam-Webster'));
  await checker.check('able');
  assert.equal(lookups, 1);
});

test('an error page says nothing about the word', () => {
  assert.equal(readMerriamPage('Host not in allowlist: scrabble.merriam.com', 'LOVE', 403), null);
  assert.equal(readMerriamPage('<p>love is a valid word</p>', 'LOVE', 500), null);
});
