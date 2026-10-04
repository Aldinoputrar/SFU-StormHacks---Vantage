import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard, chainsForView, slotKey } from '../src/board.js';
import { createGame, letterAt, placeTile, placeTileBehind, playWord, refillRack, swapRack, undoTile } from '../src/game.js';

const strip = {
  seed: 1,
  turns: 2,
  blocks: [{ start: [0, 0, 0], dir: [1, 0, 0], length: 4 }],
  words: [],
};
const board = buildBoard(strip);
const top = slotKey([0, 0, 0], '+y');
const view = [0, 1, 1];

// A game whose rack has been filled, as after a visit to the chamber.
function readyGame(level = strip) {
  const game = createGame(level, board);
  refillRack(game);
  return game;
}

test('invalid rack indices cannot consume letters or create pending tiles', () => {
  const game = readyGame();
  const before = structuredClone(game);
  for (const index of [-1, 7, 100, 0.5, NaN, Infinity, undefined, null, '0']) {
    assert.equal(placeTile(game, top, index), false);
    assert.deepEqual(game, before);
  }
});

test('placements require an exposed empty board slot', () => {
  const game = readyGame();
  const before = structuredClone(game);
  for (const key of [slotKey([99, 0, 0], '+y'), slotKey([1, 0, 0], '+x'), undefined]) {
    assert.equal(placeTile(game, key, 0), false);
    assert.deepEqual(game, before);
  }
  assert.equal(placeTile(game, top, 0), true);
  const afterPlacement = structuredClone(game);
  assert.equal(placeTile(game, top, 0), false);
  assert.deepEqual(game, afterPlacement);
});

test('an empty rack cannot place tiles before the chamber fills it', () => {
  const game = createGame(strip, board);
  assert.equal(game.rack.length, 0);
  assert.equal(placeTile(game, top, 0), false);
  assert.equal(game.pending.length, 0);
});

test('the final word ends the run and further placements are rejected', () => {
  const game = createGame({ ...strip, turns: 1 }, board);
  const chain = chainsForView(board, view).bySlot.get(top).find((line) => line.slots.length === 4);
  game.rack = ['A', 'T', 'E'];
  for (const key of chain.slots.slice(0, 2)) assert.equal(placeTile(game, key, 0), true);
  assert.equal(playWord(game, chain, view, () => true).word, 'AT');
  assert.equal(game.turnsLeft, 0);
  const before = structuredClone(game);
  assert.equal(placeTile(game, chain.slots[2], 0), false);
  assert.match(playWord(game, chain, view, () => true).error, /No turns left/);
  assert.deepEqual(game, before);
});

test('an ended run cannot commit pending tiles or invoke the dictionary', () => {
  const game = readyGame();
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
  const game = readyGame();
  placeTile(game, top, 0);
  const before = structuredClone(game);
  assert.match(playWord(game, null, view, () => true).error, /Choose a line/);
  assert.deepEqual(game, before);
});

test('a rejected word leaves the board, rack and turns unchanged', () => {
  const game = createGame(strip, board);
  const chain = chainsForView(board, view).bySlot.get(top).find((line) => line.slots.length === 4);
  game.rack = ['Z', 'Q'];
  placeTile(game, chain.slots[0], 0);
  placeTile(game, chain.slots[1], 0);
  const before = structuredClone(game);
  assert.match(playWord(game, chain, view, () => false).error, /ZQ isn't in the dictionary/);
  assert.deepEqual(game, before);
});

test('swapping is refused while tiles are on the board or no turns are left', () => {
  const game = readyGame();
  placeTile(game, top, 0);
  assert.equal(swapRack(game), false);
  const ended = readyGame();
  ended.turnsLeft = 0;
  assert.equal(swapRack(ended), false);
});

test('typing up against a letter slides this turn\'s tiles back to make room', () => {
  const hook = {
    seed: 1,
    turns: 3,
    blocks: [{ start: [0, 0, 0], dir: [1, 0, 0], length: 8 }],
    words: [{ start: [4, 0, 0], dir: [1, 0, 0], face: '+y', text: 'ABLE' }],
  };
  const hookBoard = buildBoard(hook);
  const game = createGame(hook, hookBoard);
  game.rack = ['L', 'O', 'V', 'E', 'X'];
  const slots = [0, 1, 2, 3, 4, 5, 6, 7].map((x) => slotKey([x, 0, 0], '+y'));
  const written = () => slots.map((key) => letterAt(game, key) || '.').join('');

  // Click just before the A and type L, O, V, E.
  assert.ok(placeTile(game, slots[3], 0));
  assert.equal(written(), '...LABLE');
  for (const letter of 'OVE') assert.ok(placeTileBehind(game, slots, game.rack.indexOf(letter)), letter);
  assert.equal(written(), 'LOVEABLE');
  // No room left before the L: nothing changes.
  assert.equal(placeTileBehind(game, slots, 0), false);
  assert.equal(written(), 'LOVEABLE');
  assert.deepEqual(game.rack, ['X']);
  // Undo takes the newest tile, the one next to the A.
  assert.equal(undoTile(game), slots[3]);
  assert.equal(written(), 'LOV.ABLE');
});

test('tiles do not slide back over a letter, or when they are not side by side', () => {
  const level = {
    seed: 1,
    turns: 3,
    blocks: [{ start: [0, 0, 0], dir: [1, 0, 0], length: 6 }],
    words: [{ start: [0, 0, 0], dir: [1, 0, 0], face: '+y', text: 'A' }],
  };
  const game = createGame(level, buildBoard(level));
  game.rack = ['B', 'C', 'D'];
  const slots = [0, 1, 2, 3, 4, 5].map((x) => slotKey([x, 0, 0], '+y'));
  placeTile(game, slots[1], 0); // right after the A
  assert.equal(placeTileBehind(game, slots, 0), false, 'the A is in the way');
  placeTile(game, slots[4], 0);
  assert.equal(placeTileBehind(game, slots, 0), false, 'the tiles are apart');
});
