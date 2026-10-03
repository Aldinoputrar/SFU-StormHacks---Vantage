import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard, chainsForView, slotKey } from '../src/board.js';
import { createGame, currentLevel, placeTile, playWord, turnTurntable } from '../src/game.js';
import { BROKEN_CUBE } from '../src/level.js';
import { turntableCells } from '../src/turntable.js';

const strip = {
  seed: 1,
  turns: 2,
  blocks: [{ start: [0, 0, 0], dir: [1, 0, 0], length: 4 }],
  words: [],
};
const board = buildBoard(strip);
const top = slotKey([0, 0, 0], '+y');
const view = [0, 1, 1];

test('invalid rack indices cannot consume letters or create pending tiles', () => {
  const game = createGame(strip, board);
  const before = structuredClone(game);
  for (const index of [-1, 7, 100, 0.5, NaN, Infinity, undefined, null, '0']) {
    assert.equal(placeTile(game, top, index), false);
    assert.deepEqual(game, before);
  }
});

test('placements require an exposed empty board slot', () => {
  const game = createGame(strip, board);
  const before = structuredClone(game);
  for (const key of [slotKey([99, 0, 0], '+y'), slotKey([0, 0, 0], '+x'), undefined]) {
    assert.equal(placeTile(game, key, 0), false);
    assert.deepEqual(game, before);
  }
  assert.equal(placeTile(game, top, 0), true);
  const afterPlacement = structuredClone(game);
  assert.equal(placeTile(game, top, 0), false);
  assert.deepEqual(game, afterPlacement);
});

test('the final word ends the run and further placements are rejected', () => {
  const game = createGame({ ...strip, turns: 1 }, board);
  const chain = chainsForView(board, view).bySlot.get(top).find((line) => line.slots.length === 4);
  game.rack = ['A', 'T'];
  for (const key of chain.slots.slice(0, 2)) assert.equal(placeTile(game, key, 0), true);
  assert.equal(playWord(game, chain, view, () => true).word, 'AT');
  assert.equal(game.turnsLeft, 0);
  const before = structuredClone(game);
  assert.equal(placeTile(game, chain.slots[2], 0), false);
  assert.match(playWord(game, chain, view, () => true).error, /No turns left/);
  assert.deepEqual(game, before);
});

test('an ended run cannot commit pending tiles or invoke the dictionary', () => {
  const game = createGame(strip, board);
  const chain = chainsForView(board, view).bySlot.get(top).find((line) => line.slots.length === 4);
  placeTile(game, chain.slots[0], 0);
  placeTile(game, chain.slots[1], 0);
  for (const turnsLeft of [0, -1]) {
    game.turnsLeft = turnsLeft;
    const before = structuredClone(game);
    assert.match(playWord(game, chain, view, () => assert.fail('Dictionary called after game over')).error, /No turns left/);
    assert.deepEqual(game, before);
  }
});

test('playing without a selected line leaves pending tiles intact', () => {
  const game = createGame(strip, board);
  placeTile(game, top, 0);
  const before = structuredClone(game);
  assert.match(playWord(game, null, view, () => true).error, /Choose a line/);
  assert.deepEqual(game, before);
});

test('all four ledge rotations preserve letters and update available placement slots', () => {
  let currentBoard = buildBoard(BROKEN_CUBE);
  const game = createGame(BROKEN_CUBE, currentBoard);
  const mobile = turntableCells(BROKEN_CUBE);
  for (const [key, slot] of currentBoard.slots) {
    if (mobile.has(slot.cell.join(','))) game.letters.set(key, 'A');
  }
  const original = new Map(game.letters);
  for (let quarter = 0; quarter < 4; quarter++) {
    assert.equal(turnTurntable(game, currentBoard), true);
    currentBoard = buildBoard(currentLevel(game));
    assert.deepEqual(game.slots, new Set(currentBoard.slots.keys()));
    assert.equal(game.letters.size, original.size);
    for (const key of game.letters.keys()) assert.ok(currentBoard.slots.has(key), key);
  }
  assert.deepEqual(game.letters, original);
  assert.equal(game.turnsLeft, BROKEN_CUBE.turns - 4);
});

test('a rotation cannot overlap another block or bury a committed letter', () => {
  for (const blockedBy of ['collision', 'letter']) {
    const level = {
      ...strip,
      blocks: [
        { start: [0, 0, 0], dir: [1, 0, 0], length: 2, turntable: true },
        { start: [0, 0, blockedBy === 'collision' ? -1 : -2], dir: [1, 0, 0], length: 1 },
      ],
    };
    const blockedBoard = buildBoard(level);
    const game = createGame(level, blockedBoard);
    if (blockedBy === 'letter') game.letters.set(slotKey([0, 0, -2], '+z'), 'A');
    const before = structuredClone(game);
    assert.equal(turnTurntable(game, blockedBoard), false);
    assert.deepEqual(game, before);
  }
});

test('a level without a turntable cannot spend a turn rotating', () => {
  const game = createGame(strip, board);
  const before = structuredClone(game);
  assert.equal(turnTurntable(game, board), false);
  assert.deepEqual(game, before);
});
