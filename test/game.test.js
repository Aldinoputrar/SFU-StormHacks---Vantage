import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard, chainsForView, slotKey } from '../src/board.js';
import {
  createGame,
  letterAt,
  placeTile,
  placeTileBehind,
  playWord,
  refillRack,
  restore,
  snapshot,
  swapRack,
  swingBridge,
  undoTile,
} from '../src/game.js';
import { PLAZA } from '../src/level.js';

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

test('a game restored from a snapshot on another device plays on identically', () => {
  // Two devices start the same seeded game.
  const mine = createGame(PLAZA, buildBoard(PLAZA));
  const theirs = createGame(PLAZA, buildBoard(PLAZA));
  refillRack(mine);

  // On mine: swing the bridge and play TABLE across the gap.
  swingBridge(mine);
  const home = [1, 1, 1].map((v) => v / Math.sqrt(3));
  const board = restore(mine, snapshot(mine)); // restoring your own snapshot changes nothing
  const chain = chainsForView(board, home).chains.find((c) => c.slots.includes(slotKey([6, 1, 2], '+y')) && c.slots.length === 11);
  mine.rack[0] = 'T';
  assert.ok(placeTile(mine, chain.slots[6], 0));
  assert.equal(playWord(mine, chain, home, () => true).word, 'TABLE');

  // Send it across, as JSON, and restore it on theirs.
  const sent = JSON.parse(JSON.stringify(snapshot(mine)));
  const theirBoard = restore(theirs, sent);
  assert.deepEqual([...theirs.letters].sort(), [...mine.letters].sort());
  assert.deepEqual(theirs.bag, mine.bag);
  assert.equal(theirs.turnsLeft, mine.turnsLeft);
  assert.equal(theirs.bridge, 1);
  assert.ok(theirBoard.bridgeCells.has('-6,5,1'), 'their board has the bridge in its swung position');
  assert.equal(theirs.history.at(-1).word, 'TABLE');
  assert.equal(theirs.history.at(-1).points.total, mine.history.at(-1).points.total);
  // Bonus squares come from the seed, so both devices already agree on them.
  assert.deepEqual([...theirs.bonuses].sort(), [...mine.bonuses].sort());
});

// A strip with ABLE on it, for power-up tests.
function hookGame(rack) {
  const hook = {
    seed: 1,
    turns: 3,
    blocks: [{ start: [0, 0, 0], dir: [1, 0, 0], length: 8 }],
    words: [{ start: [4, 0, 0], dir: [1, 0, 0], face: '+y', text: 'ABLE' }],
  };
  const hookBoard = buildBoard(hook);
  const game = createGame(hook, hookBoard);
  game.bonuses = new Map();
  game.rack = [...rack];
  const slots = [0, 1, 2, 3, 4, 5, 6, 7].map((x) => slotKey([x, 0, 0], '+y'));
  const chain = chainsForView(hookBoard, view).chains.find((c) => c.slots.includes(slots[0]) && c.slots.includes(slots[7]));
  return { game, slots, chain };
}

test('a wild tile stands for any letter, scores nothing, and comes back wild when undone', () => {
  const { game, slots, chain } = hookGame(['?', 'X']);
  assert.equal(placeTile(game, slots[3], 0), false, 'a wild tile needs a letter');
  assert.ok(placeTile(game, slots[3], 0, 'T'));
  assert.equal(letterAt(game, slots[3]), 'T');
  assert.equal(undoTile(game), slots[3]);
  assert.deepEqual(game.rack, ['?', 'X']);

  assert.ok(placeTile(game, slots[3], 0, 'T'));
  const { word, points } = playWord(game, chain, view, () => true);
  assert.equal(word, 'TABLE');
  // A B L E = 1 + 3 + 1 + 1 = 6; the wild T adds nothing.
  assert.equal(points.total, 6);
  assert.ok(game.wilds.has(slots[3]));
  assert.deepEqual(snapshot(game).wilds, [slots[3]]);
});

test('an armed double-score token doubles the next word only', () => {
  const { game, slots, chain } = hookGame(['T', 'S']);
  game.boost = 2;
  placeTile(game, slots[3], 0);
  const first = playWord(game, chain, view, () => true);
  assert.equal(first.points.total, 14); // TABLE is 7, doubled
  assert.equal(first.points.boost, 2);
  assert.equal(game.boost, 1);
});

test('a free swap keeps the turn, and any swap keeps a wild tile', () => {
  const { game } = hookGame(['A', '?', 'B']);
  const turns = game.turnsLeft;
  assert.ok(swapRack(game, { free: true }));
  assert.equal(game.turnsLeft, turns);
  assert.deepEqual(game.rack, ['?']);
  assert.equal(swapRack(game), false, 'nothing but a wild tile left to swap');
  game.rack.push('C');
  assert.ok(swapRack(game));
  assert.equal(game.turnsLeft, turns - 1);
});
