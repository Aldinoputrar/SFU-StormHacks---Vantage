import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findFits, hintWords } from '../src/hint.js';

const words = hintWords(readFileSync('node_modules/word-list/words.txt', 'utf8'));
const line = (text) => [...text].map((c) => (c === '.' ? '' : c));

test('hints finish a hook with the letters in hand, best across the gap first', () => {
  // Seven empty squares on one strip, then ABLE on another.
  const pattern = line('.......ABLE');
  const surfaces = [...Array(7).fill('near'), ...Array(4).fill('far')];
  const fits = findFits(pattern, [...'TLOVEXQ'], words, surfaces);
  const found = fits.map(({ word }) => word);
  assert.ok(found.includes('TABLE'));
  assert.ok(found.includes('LOVEABLE'));
  assert.equal(fits[0].spans, 2);
  const table = fits.find(({ word }) => word === 'TABLE');
  assert.deepEqual(table.tiles, [{ index: 6, letter: 'T' }]);
  assert.equal(table.offset, 6);
});

test('a hint never needs more of a letter than the rack holds, nor joins stray letters', () => {
  const fits = findFits(line('....ING.'), [...'SRKW'], words);
  const found = fits.map(({ word }) => word);
  assert.ok(found.includes('RING') && found.includes('KING') && found.includes('WING'));
  assert.ok(!found.includes('SINGS'), 'only one S in the rack');
  // Every fit uses a board letter and a rack letter, and stops at empty squares or the ends.
  for (const { word, offset, tiles } of fits) {
    assert.ok(tiles.length > 0 && tiles.length < word.length);
    assert.ok(word.includes('ING') || word.includes('IN'), word);
    assert.ok(offset + word.length <= 8);
  }
  // ABLE with a letter right before it: a word must take that letter in.
  assert.ok(findFits(line('..XABLE'), [...'TS'], words).every(({ word }) => word.includes('XABLE')));
});

test('a full line or an empty one has no hints', () => {
  assert.deepEqual(findFits(line('LOVEABLE'), [...'UN'], words), []);
  assert.deepEqual(findFits(line('....'), [...'CATS'], words), []);
});
