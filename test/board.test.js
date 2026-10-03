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

test('tiles hidden from the locked view are cut out of lines', () => {
  // From straight above, the floating ledge at (0, 3, 3) covers the rise's
  // tile at (0, 0, 3), so the rise's top line splits around it.
  const above = normalize([0.001, 1, 0.001]);
  const hidden = slotKey([0, 0, 3], '+y');
  const { bySlot } = chainsForView(board, above, undefined, true);
  assert.equal(bySlot.get(hidden), undefined);
  assert.ok(bySlot.get(slotKey([0, 0, 2], '+y')).every((chain) => !chain.slots.includes(hidden)));
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
