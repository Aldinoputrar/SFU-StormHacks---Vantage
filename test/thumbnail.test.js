import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard, chainsForView, isJoined, slotKey, slotVisible } from '../src/board.js';
import { normalize } from '../src/geometry.js';
import { MONUMENT, THUMBNAIL_WORD } from '../src/level.js';

test('the VANTAGE thumbnail reuses seven visible tiles across an existing perspective join', () => {
  const board = buildBoard(MONUMENT);
  const dir = normalize(THUMBNAIL_WORD.view);
  const keys = THUMBNAIL_WORD.cells.map((cell) => slotKey(cell, THUMBNAIL_WORD.face));
  assert.equal(board.cells.length, 57);
  assert.equal(keys.length, THUMBNAIL_WORD.text.length);
  const chain = chainsForView(board, dir, undefined, true).chains.find((chain) =>
    isJoined(chain) && keys.every((key) => chain.slots.includes(key)),
  );
  assert.ok(chain);
  assert.deepEqual(chain.slots.slice(0, 7), keys);
  assert.equal(new Set(keys.map((key) => chain.slotLines[chain.slots.indexOf(key)])).size, 2);
  assert.ok(keys.every((key) => slotVisible(board, key, dir)));
  assert.ok(!chainsForView(board, normalize([1, 1, 0.5])).chains.some((chain) =>
    keys.every((key) => chain.slots.includes(key)),
  ));
});
