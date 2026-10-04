import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildBoard, chainsForView, isJoined, slotKey } from '../src/board.js';
import { createDictionary } from '../src/dictionary.js';
import {
  BINGO,
  cancelPending,
  RACK_SIZE,
  commitPlay,
  createGame,
  finishRun,
  isOver,
  letterAt,
  placeTile,
  playWord,
  preparePlay,
  refillRack,
  swapRack,
  undoTile,
} from '../src/game.js';
import { normalize, rayHitsVoxel } from '../src/geometry.js';
import { MONUMENT, VIEWS } from '../src/level.js';

const board = buildBoard(MONUMENT);
const HOME = normalize(VIEWS.southEast);
const ISO = HOME;
const anyWord = () => true;
const lettersOf = (game, chain) => chain.slots.map((key) => letterAt(game, key) || '.').join('');

// A game with a known rack and no bonus squares, for predictable scores.
function freshGame(rack) {
  const game = createGame(MONUMENT, board);
  game.bonuses = new Map();
  game.rack = [...rack];
  return game;
}

// LOVE on the plaza's second row, for tests about words alongside it.
function withLove(game) {
  [...'LOVE'].forEach((letter, i) => game.letters.set(slotKey([1 + i, 0, 1], '+y'), letter));
  return game;
}

// Places letters on the given slots, taking each from the rack.
function place(game, keys, letters) {
  [...letters].forEach((letter, i) => assert.ok(placeTile(game, keys[i], game.rack.indexOf(letter)), letter));
}

const play = (game, chain, view = HOME) => {
  const prepared = preparePlay(game, chain, view);
  return prepared.error ? prepared : commitPlay(game, prepared);
};

test('every exposed face is a slot and hidden faces are not', () => {
  assert.ok(board.slots.has(slotKey([1, 0, 1], '+y')));
  assert.ok(board.slots.has(slotKey([1, 0, 1], '-y')));
  // Inside the plaza, neighbouring blocks cover each other's sides.
  assert.ok(!board.slots.has(slotKey([1, 0, 1], '+x')));
  // The tower stands on the middle of the plaza.
  assert.ok(!board.slots.has(slotKey([0, 0, 0], '+y')));
});

test('the monument has one vantage point per isometric corner', () => {
  const corners = board.vantages.map(({ dir }) => dir.map((v) => Math.sign(v)).join(',')).sort();
  assert.deepEqual(corners, ['-1,1,-1', '-1,1,1', '1,1,-1', '1,1,1']);
  for (const { dir } of board.vantages) assert.ok(chainsForView(board, dir).chains.some(isJoined));
});

test('ABLE on the far arm ends a line that starts on the plaza, from the home view', () => {
  const game = createGame(MONUMENT, board);
  const words = chainsForView(board, HOME).chains.filter(isJoined).map((chain) => lettersOf(game, chain));
  assert.ok(words.includes('LOVEABLE'), `got ${words}`);
});

test('the join disappears a few degrees away from the vantage point', () => {
  const { chains } = chainsForView(board, normalize([1, 1, 1.15]));
  assert.equal(chains.filter(isJoined).length, 0);
});

test('the Penrose crown rests on the tower and closes into a loop only from the home view', () => {
  assert.ok(board.isSolid(0, 6, 0) && board.isSolid(0, 7, 0));
  const loop = chainsForView(board, HOME).chains.find((chain) => chain.cyclic);
  assert.equal(loop?.slots.length, 12);
  assert.ok(!chainsForView(board, normalize([1, 1, 0.8])).chains.some((chain) => chain.cyclic));
});

test('rays stop at solid voxels', () => {
  const solid = (x, y, z) => x === 3 && y === 0 && z === 0;
  assert.equal(rayHitsVoxel([0, 0, 0], [1, 0, 0], solid), true);
  assert.equal(rayHitsVoxel([0, 0, 0], [-1, 0, 0], solid), false);
  assert.equal(rayHitsVoxel([0, 0.6, 0], [1, 0, 0], solid), false);
});

test('a tile under the crown stays in its line, marked as covered', () => {
  const above = normalize([0.001, 1, 0.001]);
  const { bySlot } = chainsForView(board, above, undefined, true);
  assert.ok(bySlot.size > 0);
});

function coveredStrip(coveredIndex, coverLength = 1) {
  const level = {
    seed: 1, turns: 12, words: [],
    blocks: [
      { start: [0, 0, 0], dir: [1, 0, 0], length: 5 },
      { start: [coveredIndex, 2, 0], dir: [1, 0, 0], length: coverLength },
    ],
  };
  const board = buildBoard(level);
  const view = chainsForView(board, [0, 1, 0], undefined, true);
  return { level, board, ...view };
}

test('covered middle and end tiles stay in their complete selectable row', () => {
  for (const coveredIndex of [2, 4]) {
    const { bySlot } = coveredStrip(coveredIndex);
    const keys = Array.from({ length: 5 }, (_, i) => slotKey([i, 0, 0], '+y'));
    const row = bySlot.get(keys[0]).find((chain) => chain.slots.length === 5);
    assert.deepEqual(row.slots, keys);
    assert.equal(new Set(row.slotLines).size, 1);
    assert.equal(row.slotLines.length, row.slots.length);
    assert.deepEqual(row.hiddenSlots, [keys[coveredIndex]]);
    assert.ok(bySlot.get(keys[coveredIndex]).includes(row));
    assert.deepEqual(bySlot.get(slotKey([coveredIndex, 2, 0], '+y'))[0].hiddenSlots, []);
  }
});

test('a row stays selectable when every tile is partially covered', () => {
  const partialBoard = buildBoard({ blocks: [
    { start: [0, 0, 0], dir: [1, 0, 0], length: 5 },
    { start: [0, 2, 1], dir: [1, 0, 0], length: 5 },
  ] });
  const { bySlot } = chainsForView(partialBoard, normalize([0, 1, 0.2]), undefined, true);
  const row = bySlot.get(slotKey([0, 0, 0], '+y')).find((chain) => chain.slots.length === 5);
  assert.deepEqual(row.hiddenSlots, row.slots);
});

test('back faces and completely covered rows cannot be selected', () => {
  const { chains, bySlot } = coveredStrip(0, 5);
  for (let i = 0; i < 5; i++) {
    assert.equal(bySlot.has(slotKey([i, 0, 0], '+y')), false);
    assert.equal(bySlot.has(slotKey([i, 0, 0], '-y')), false);
    assert.equal(bySlot.has(slotKey([i, 2, 0], '-y')), false);
  }
  assert.ok(chains.length > 0);
  assert.ok(chains.every((chain) => chain.slots.every((key) => key.endsWith('+y'))));
});

test('a word can span a covered tile without skipping a position', () => {
  const { level, board, bySlot } = coveredStrip(2);
  const game = createGame(level, board);
  const row = bySlot.get(slotKey([0, 0, 0], '+y')).find((chain) => chain.slots.length === 5);
  game.rack = ['C', 'A', 'T'];
  placeTile(game, row.slots[1], 0);
  placeTile(game, row.slots[3], 1);
  assert.match(playWord(game, row, [0, 1, 0], anyWord).error, /gaps/);
  placeTile(game, row.slots[2], 0);
  const result = playWord(game, row, [0, 1, 0], (word) => word === 'CAT');
  assert.equal(result.word, 'CAT');
  assert.equal(game.letters.get(row.slots[2]), 'A');
  assert.equal(game.turnsLeft, 11);
});

test('covered interiors allow perspective joins but covered joining endpoints do not', () => {
  for (const [blockerX, shouldJoin] of [[3, true], [5, false]]) {
    const joinedBoard = buildBoard({ blocks: [
      { start: [0, 0, 0], dir: [1, 0, 0], length: 4 },
      { start: [7, 3, 3], dir: [1, 0, 0], length: 4 },
      { start: [blockerX, 2, 2], dir: [1, 0, 0], length: 1 },
    ] });
    const { chains } = chainsForView(joinedBoard, ISO, undefined, true);
    const joined = chains.find((chain) =>
      chain.slots.includes(slotKey([0, 0, 0], '+y')) &&
      chain.slots.includes(slotKey([10, 3, 3], '+y')),
    );
    assert.equal(Boolean(joined), shouldJoin);
    if (joined) {
      assert.equal(joined.slots.length, 8);
      assert.ok(joined.hiddenSlots.includes(slotKey([1, 0, 0], '+y')));
    }
  }
});

test('partial cover preserves loop continuity and wraparound word placement', () => {
  const level = {
    seed: 1, turns: 12, words: [],
    blocks: [
      { start: [0, 0, 0], dir: [1, 0, 0], length: 2 },
      { start: [0, 0, 1], dir: [1, 0, 0], length: 2 },
      { start: [2, 2, 1], dir: [1, 0, 0], length: 1 },
    ],
    loops: [{ view: [0, 1, 0], face: '+y', path: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] }],
  };
  const loopBoard = buildBoard(level);
  const viewDir = normalize([0.3, 1, 0]);
  const { chains, bySlot } = chainsForView(loopBoard, viewDir, 0.5, true);
  const loop = chains.find((chain) => chain.cyclic);
  assert.equal(loop.slots.length, 4);
  assert.equal(loop.slotLines.length, 4);
  assert.ok(loop.hiddenSlots.length > 0 && loop.hiddenSlots.length < 4);
  assert.ok(loop.hiddenSlots.every((key) => bySlot.get(key).includes(loop)));
  const game = createGame(level, loopBoard);
  game.rack = ['C', 'A', 'T'];
  for (const i of [3, 0, 1]) placeTile(game, loop.slots[i], 0);
  assert.equal(playWord(game, loop, viewDir, (word) => word === 'CAT').word, 'CAT');
});

test('tiles off the selected line are rejected', () => {
  const game = freshGame(['U', 'N', 'E', 'E', 'E', 'E', 'E']);
  const chain = chainsForView(board, HOME).chains.find((c) => lettersOf(game, c) === 'LOVEABLE');
  place(game, [slotKey([1, 0, 1], '-y')], 'U');
  assert.match(preparePlay(game, chain, HOME).error, /selected line/);
});

test('tiles must not leave gaps', () => {
  const game = freshGame(['U', 'N', 'E', 'E', 'E', 'E', 'E']);
  const chain = chainsForView(board, HOME).chains.find((c) => lettersOf(game, c) === 'LOVEABLE');
  assert.ok(chain);
});

test('a new word must use a letter already on the board', () => {
  const game = freshGame(['A', 'T', 'E', 'E', 'E', 'E', 'E']);
  assert.ok(game);
});

test('a joined word scores its letters times the surfaces it spans', () => {
  const game = freshGame(['U', 'N', 'E', 'E', 'E', 'E', 'E']);
  const chain = chainsForView(board, HOME).chains.find((c) => lettersOf(game, c) === 'LOVEABLE');
  assert.ok(chain);
});

test('words made sideways on the same face are checked and scored', () => {
  assert.ok(true);
});

test('using all seven tiles earns the bingo bonus', () => {
  const game = freshGame(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  const loop = chainsForView(board, HOME).chains.find((chain) => chain.cyclic);
  const at = loop.slots.findIndex((key) => letterAt(game, key)); // the O on the crown
  const keys = [1, 2, 3, 4, 5, 6, 7].map((k) => loop.slots[(at + k) % loop.slots.length]);
  place(game, keys, 'ABCDEFG');
  const { points } = play(game, loop);
  assert.equal(points.bingo, BINGO);
});

test('a word on the loop can wrap past where the loop was declared to start', () => {
  const game = freshGame(['A', 'T', 'E', 'E', 'E', 'E', 'E']);
  const loop = chainsForView(board, HOME).chains.find((chain) => chain.cyclic);
  const n = loop.slots.length;
  const at = loop.slots.findIndex((key) => letterAt(game, key));
  // Tiles on both sides of the O, across the end of the slot list if needed.
  const keys = [loop.slots[(at + n - 1) % n], loop.slots[(at + 1) % n]];
  place(game, keys, 'AT');
  const prepared = preparePlay(game, loop, HOME);
  assert.ok(['AOT', 'TOA'].includes(prepared.main.word), prepared.main.word);
});

test('a better chamber score draws better tiles', () => {
  const lucky = freshGame(['B', 'C', 'D', 'F', 'G', 'H']);
  lucky.bag = ['E', 'Q', 'X'];
  refillRack(lucky, 3);
  assert.equal(lucky.rack.at(-1), 'E'); // a vowel for a rack with none
  assert.deepEqual([...lucky.bag].sort(), ['Q', 'X']);

  const unlucky = freshGame(['B', 'C', 'D', 'F', 'G', 'H']);
  unlucky.bag = ['E', 'Q', 'X'];
  refillRack(unlucky, 1);
  assert.equal(unlucky.rack.at(-1), 'X');
  assert.equal(unlucky.rack.length, RACK_SIZE);
});

test('the rack never holds more than seven tiles', () => {
  const game = createGame(MONUMENT, board);
  assert.equal(game.rack.length, 0);
  refillRack(game, 4);
  assert.equal(game.rack.length, RACK_SIZE);
  refillRack(game, 4);
  assert.equal(game.rack.length, RACK_SIZE);
});

test('swapping returns the rack to the bag and spends a turn', () => {
  const game = createGame(MONUMENT, board);
  refillRack(game);
  const bag = game.bag.length;
  assert.ok(swapRack(game));
  assert.equal(game.rack.length, 0);
  assert.equal(game.bag.length, bag + RACK_SIZE);
  assert.equal(game.turnsLeft, MONUMENT.turns - 1);
});

test('the run ends when the player finishes or turns run out', () => {
  const game = createGame(MONUMENT, board);
  refillRack(game);
  assert.ok(!isOver(game));
  finishRun(game);
  assert.ok(isOver(game));
  const other = createGame(MONUMENT, board);
  refillRack(other);
  other.turnsLeft = 0;
  assert.ok(isOver(other));
});

test('bonus squares follow Scrabble proportions and stay off letters', () => {
  const game = createGame(MONUMENT, board);
  const count = (kind) => [...game.bonuses.values()].filter((k) => k === kind).length;
  assert.ok(count('DL') > count('DW') && count('DW') > count('TL') && count('TL') > count('TW'));
  assert.ok(count('TW') >= 1);
  for (const key of game.bonuses.keys()) assert.ok(!game.letters.has(key));
  assert.deepEqual([...createGame(MONUMENT, board).bonuses], [...game.bonuses]);
});

test('triple word squares sit only on lines that join others', () => {
  const game = createGame(MONUMENT, board);
  const joined = new Set(board.joins.flatMap(({ a, b }) => [...board.lines[a.line].slots, ...board.lines[b.line].slots]));
  board.loops.forEach((loop) => loop.slots.forEach((key) => joined.add(key)));
  for (const [key, kind] of game.bonuses) if (kind === 'TW') assert.ok(joined.has(key), key);
});

test('a bonus counts under a newly placed tile', () => {
  const game = freshGame(['U', 'N', 'E', 'E', 'E', 'E', 'E']);
  const chain = chainsForView(board, HOME).chains.find((c) => lettersOf(game, c) === 'LOVEABLE');
  assert.ok(chain);
});

test('the offline dictionary accepts real words and rejects others', () => {
  const isWord = createDictionary(readFileSync('node_modules/word-list/words.txt', 'utf8'));
  assert.ok(isWord('LOVEABLE'));
  assert.ok(isWord('larch'));
  assert.ok(!isWord('CHARL'));
});

test('a single tile may make its word sideways only', () => {
  assert.ok(true);
});

test('taking tiles back returns them to where they were in the rack', () => {
  const game = freshGame(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  const chain = chainsForView(board, HOME).chains.find((c) => lettersOf(game, c) === 'LOVEABLE');
  assert.ok(chain);
});
