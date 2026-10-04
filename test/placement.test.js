import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard, chainsForView, slotKey } from '../src/board.js';
import { normalize } from '../src/geometry.js';
import { placementDirection, placementOptions } from '../src/placement.js';

const board = buildBoard({ blocks: [
  { start: [0, 0, 0], dir: [1, 0, 0], length: 4 },
  { start: [0, 0, 1], dir: [1, 0, 0], length: 4 },
  { start: [0, 0, 2], dir: [1, 0, 0], length: 4 },
] });

test('the direction indicator distinguishes across and down through the same tile', () => {
  const dir = normalize([0, 1, 0.001]);
  const options = chainsForView(board, dir, undefined, true).bySlot.get(slotKey([1, 0, 1], '+y'));
  assert.deepEqual(new Set(options.map((line) => placementDirection(board, line, dir))), new Set(['Across →', 'Down ↓']));
});

test('direction follows the view instead of treating a world axis as always horizontal', () => {
  const a = normalize([0, 1, 0.001]);
  const b = normalize([0.001, 1, 0]);
  const row = (dir) => chainsForView(board, dir, undefined, true).bySlot.get(slotKey([1, 0, 1], '+y')).find((line) => line.slots.length === 4);
  assert.equal(placementDirection(board, row(a), a), 'Across →');
  assert.equal(placementDirection(board, row(b), b), 'Down ↓');
});

test('diagonal strips and loops are not labelled as horizontal words', () => {
  const dir = normalize([1, 1, 1]);
  const row = chainsForView(board, dir).bySlot.get(slotKey([1, 0, 1], '+y')).find((line) => line.slots.length === 4);
  assert.equal(placementDirection(board, row, dir), 'Diagonal ↘');
  assert.equal(placementDirection(board, { cyclic: true }, dir), 'Clockwise ↻');
});

test('an intersection defaults across even when the down column is longer', () => {
  const board = buildBoard({ blocks: Array.from({ length: 6 }, (_, z) => (
    { start: [0, 0, z], dir: [1, 0, 0], length: 3 }
  )) });
  const dir = normalize([0, 1, 0.001]);
  const options = placementOptions(board, chainsForView(board, dir, undefined, true), slotKey([1, 0, 1], '+y'), dir);
  assert.equal(options[0].slots.length, 3);
  assert.equal(placementDirection(board, options[0], dir), 'Across →');
  assert.equal(options[1].slots.length, 6);
  assert.equal(placementDirection(board, options[1], dir), 'Down ↓');
});
