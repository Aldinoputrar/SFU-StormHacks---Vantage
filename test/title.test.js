import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard, chainsForView, isJoined, slotKey, slotVisible } from '../src/board.js';
import { createGame } from '../src/game.js';
import { normalize } from '../src/geometry.js';
import { MONUMENT, TITLE_WORD } from '../src/level.js';

test('VAN and TAGE use exactly seven new blocks above the crown during normal play', () => {
  const board = buildBoard(MONUMENT);
  const game = createGame(MONUMENT, board);
  const dir = normalize(TITLE_WORD.view);
  const cells = TITLE_WORD.parts.flatMap(({ start, dir, text }) =>
    [...text].map((_, i) => start.map((v, axis) => v + dir[axis] * i)),
  );
  const keys = cells.map((cell) => slotKey(cell, TITLE_WORD.face));
  assert.equal(board.cells.length, 64);
  assert.deepEqual(TITLE_WORD.parts.map((part) => part.text), ['VAN', 'TAGE']);
  assert.deepEqual(TITLE_WORD.parts.map((part) => part.text.length), [3, 4]);
  const titleCells = new Set(cells.map((cell) => cell.join(',')));
  const crownHeight = Math.max(...board.cells.filter((cell) => !titleCells.has(cell.join(','))).map((cell) => cell[1]));
  assert.ok(cells.every((cell) => cell[1] > crownHeight));
  const chain = chainsForView(board, dir, undefined, true).chains.find((chain) =>
    isJoined(chain) && keys.every((key) => chain.slots.includes(key)),
  );
  assert.ok(chain);
  assert.deepEqual(chain.slots, keys);
  assert.equal(new Set(chain.slotLines).size, 2);
  assert.equal(keys.map((key) => game.letters.get(key)).join(''), 'VANTAGE');
  assert.ok(keys.every((key) => slotVisible(board, key, dir)));
  assert.equal(game.letters.get(slotKey([6, 1, 2], '+y')), 'A');
  assert.equal(game.letters.has(slotKey([1, 0, 1], '+y')), false);
});
