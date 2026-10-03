import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBoard, chainsForView, isJoined, slotKey } from '../src/board.js';
import { createGame, currentLevel, letterAt, placeTile, playWord, turnTurntable } from '../src/game.js';
import { normalize, rayHitsVoxel } from '../src/geometry.js';
import { createDictionary } from '../src/dictionary.js';
import { readFileSync } from 'node:fs';
import { BROKEN_CUBE } from '../src/level.js';

const board = buildBoard(BROKEN_CUBE);
const anyWord = () => true;
const ISO = normalize([1, 1, 1]);
const lettersOf = (game, chain) => chain.slots.map((key) => letterAt(game, key) || '.').join('');

test('every exposed face is a slot and hidden faces are not', () => {
  assert.ok(board.slots.has(slotKey([0, -3, 0], '+y')));
  assert.ok(board.slots.has(slotKey([0, -3, 0], '-y')));
  // (1, -3, 0) sits between two LOVE blocks, so its ±x faces are covered.
  assert.ok(!board.slots.has(slotKey([1, -3, 0], '+x')));
});

test('LOVE and ABLE join into one line from the isometric view', () => {
  const game = createGame(BROKEN_CUBE, board);
  const { chains } = chainsForView(board, ISO);
  const words = chains.filter(isJoined).map((chain) => lettersOf(game, chain));
  assert.ok(words.includes('LOVEABLE'), `got ${words}`);
});

test('the join disappears a few degrees away from the vantage point', () => {
  const { chains } = chainsForView(board, normalize([1, 1, 1.15]));
  assert.equal(chains.filter(isJoined).length, 0);
});

test('every vantage point is a cube symmetry direction with a joined line', () => {
  assert.ok(board.vantages.length >= 5);
  for (const { dir } of board.vantages) {
    const largest = Math.max(...dir.map(Math.abs));
    for (const v of dir) assert.ok([0, 1].some((t) => Math.abs(Math.abs(v) / largest - t) < 1e-9));
    assert.ok(chainsForView(board, dir).chains.some(isJoined));
  }
});

test('rays stop at solid voxels', () => {
  const solid = (x, y, z) => x === 3 && y === 0 && z === 0;
  assert.equal(rayHitsVoxel([0, 0, 0], [1, 0, 0], solid), true);
  assert.equal(rayHitsVoxel([0, 0, 0], [-1, 0, 0], solid), false);
  assert.equal(rayHitsVoxel([0, 0.6, 0], [1, 0, 0], solid), false);
});

test('tiles off the selected line are rejected', () => {
  const game = createGame(BROKEN_CUBE, board);
  const chain = chainsForView(board, ISO).chains.find((c) => lettersOf(game, c) === 'LOVEABLE');
  // Put any rack tile on the bottom face of the LOVE ledge: not on this line.
  placeTile(game, slotKey([0, -3, 0], '-y'), 0);
  assert.match(playWord(game, chain, ISO, anyWord).error, /selected line/);
});

test('tiles must not leave gaps', () => {
  const game = createGame(BROKEN_CUBE, board);
  const { chains } = chainsForView(board, ISO);
  const chain = chains.find((c) => c.slots.length >= 8 && c.slots.every((key) => !letterAt(game, key)));
  placeTile(game, chain.slots[0], 0);
  placeTile(game, chain.slots[2], 0);
  assert.match(playWord(game, chain, ISO, anyWord).error, /gaps/);
  placeTile(game, chain.slots[1], 0);
  const result = playWord(game, chain, ISO, anyWord);
  assert.equal(result.word.length, 3);
  assert.equal(game.rack.length, 7);
  assert.equal(game.turnsLeft, BROKEN_CUBE.turns - 1);
});

test('the Penrose stairs close into a loop only from the isometric view', () => {
  const loop = chainsForView(board, ISO).chains.find((chain) => chain.cyclic);
  assert.equal(loop?.slots.length, 16);
  assert.ok(!chainsForView(board, normalize([1, 1, 0.8])).chains.some((chain) => chain.cyclic));
});

test('a word on the loop can wrap past where the loop was declared to start', () => {
  const game = createGame(BROKEN_CUBE, board);
  const loop = chainsForView(board, ISO).chains.find((chain) => chain.cyclic);
  const n = loop.slots.length;
  const rackTiles = game.rack.slice(0, 3).join('');
  for (const i of [n - 1, 0, 1]) placeTile(game, loop.slots[i], 0);
  const result = playWord(game, loop, ISO, anyWord);
  assert.equal(result.word, rackTiles);
});

test('a floating ledge does not shorten the rise underneath it', () => {
  // From straight above, the floating ledge at (0, 3, 3) covers the rise's
  // tile at (0, 0, 3), but the rise remains a four-tile line.
  const above = normalize([0.001, 1, 0.001]);
  const hidden = slotKey([0, 0, 3], '+y');
  const { bySlot } = chainsForView(board, above, undefined, true);
  const rise = bySlot.get(slotKey([0, 0, 2], '+y')).find((chain) => chain.slots.includes(slotKey([0, 0, 1], '+y')));
  assert.ok([1, 2, 3, 4].every((z) => rise.slots.includes(slotKey([0, 0, z], '+y'))));
  assert.ok(rise.slots.includes(hidden));
  assert.ok(rise.hiddenSlots.includes(hidden));
  assert.ok(bySlot.get(hidden).includes(rise));
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

test('the dictionary accepts real words and rejects others', () => {
  const isWord = createDictionary(readFileSync('node_modules/word-list/words.txt', 'utf8'));
  assert.ok(isWord('LOVEABLE'));
  assert.ok(isWord('larch'));
  assert.ok(!isWord('CHARL'));
});

test('words are scored by letter values times the surfaces they span', () => {
  const game = createGame(BROKEN_CUBE, board);
  const chain = chainsForView(board, ISO).chains.find((c) => c.slots.length === 8 && c.slots.every((key) => !letterAt(game, key)));
  // Spell CAN across the joint between the two ledges (4 tiles + 4 tiles).
  game.bonuses = new Map();
  game.rack = ['C', 'A', 'N', 'E', 'E', 'E', 'E'];
  for (const [i, letter] of [[3, 'C'], [4, 'A'], [5, 'N']]) placeTile(game, chain.slots[i], game.rack.indexOf(letter));
  assert.match(playWord(game, chain, ISO, () => false).error, /dictionary/);
  const { points } = playWord(game, chain, ISO, anyWord);
  assert.deepEqual(points, { letters: 5, wordMultiplier: 1, surfaces: 2, bingo: 0, bonuses: [], total: 10 });
  assert.equal(game.score, 10);
});

test('bonus squares follow Scrabble proportions and stay off letters', () => {
  const game = createGame(BROKEN_CUBE, board);
  const count = (kind) => [...game.bonuses.values()].filter((k) => k === kind).length;
  assert.ok(count('DL') > count('DW') && count('DW') > count('TL') && count('TL') > count('TW'));
  assert.ok(count('TW') >= 1);
  for (const key of game.bonuses.keys()) assert.ok(!game.letters.has(key));
  // The same seed always gives the same board.
  assert.deepEqual([...createGame(BROKEN_CUBE, board).bonuses], [...game.bonuses]);
});

test('triple word squares sit only on lines that join others', () => {
  const game = createGame(BROKEN_CUBE, board);
  const joined = new Set(board.joins.flatMap(({ a, b }) => [...board.lines[a.line].slots, ...board.lines[b.line].slots]));
  board.loops.forEach((loop) => loop.slots.forEach((key) => joined.add(key)));
  for (const [key, kind] of game.bonuses) if (kind === 'TW') assert.ok(joined.has(key), key);
});

test('word bonuses avoid tiles that overlap another line from a vantage point', () => {
  // From overhead, the floating ledge's top at (0, 3, 3) sits exactly over the
  // rise, so a bonus there would look like part of the rise's line.
  const game = createGame(BROKEN_CUBE, board);
  assert.ok(!['TW', 'DW'].includes(game.bonuses.get(slotKey([0, 3, 3], '+y'))));
});

test('a bonus counts under a newly placed tile', () => {
  const game = createGame(BROKEN_CUBE, board);
  const chain = chainsForView(board, ISO).chains.find((c) => c.slots.length === 8 && c.slots.every((key) => !letterAt(game, key)));
  game.bonuses = new Map([[chain.slots[0], 'TW'], [chain.slots[1], 'DL']]);
  game.rack = ['H', 'A', 'E', 'E', 'E', 'E', 'E'];
  placeTile(game, chain.slots[0], 0); // H, 4 points
  placeTile(game, chain.slots[0 + 1], 0); // A, 1 point doubled
  const { points } = playWord(game, chain, ISO, anyWord);
  assert.equal(points.total, (4 + 2) * 3);
  assert.deepEqual(points.bonuses, ['TW', 'DL']);
});

test('turning the turntable spends a turn and carries its letters round', () => {
  const game = createGame(BROKEN_CUBE, board);
  const top = slotKey([1, 1, -3], '+y'); // two blocks along the turntable from its pivot at (1, 1, -1)
  game.letters.set(top, 'Q');
  assert.ok(turnTurntable(game, board));
  const turned = buildBoard(currentLevel(game));
  // A quarter turn about +y takes the offset (0, 0, -2) to (-2, 0, 0).
  assert.equal(game.letters.get(slotKey([-1, 1, -1], '+y')), 'Q');
  assert.ok(turned.slots.has(slotKey([-1, 1, -1], '+y')));
  assert.equal(game.turnsLeft, BROKEN_CUBE.turns - 1);
});
