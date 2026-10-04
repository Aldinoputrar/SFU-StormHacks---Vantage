import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildBoard, chainsForView, isJoined, slotKey } from '../src/board.js';
import { createDictionary } from '../src/dictionary.js';
import {
  BINGO,
  RACK_SIZE,
  commitPlay,
  createGame,
  finishRun,
  isOver,
  letterAt,
  placeTile,
  preparePlay,
  refillRack,
  swapRack,
} from '../src/game.js';
import { normalize, rayHitsVoxel } from '../src/geometry.js';
import { MONUMENT, VIEWS } from '../src/level.js';

const board = buildBoard(MONUMENT);
const HOME = normalize(VIEWS.southEast);
const lettersOf = (game, chain) => chain.slots.map((key) => letterAt(game, key) || '.').join('');

// A game with a known rack and no bonus squares, for predictable scores.
function freshGame(rack) {
  const game = createGame(MONUMENT, board);
  game.bonuses = new Map();
  game.rack = [...rack];
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

test('LOVE on the plaza and ABLE on the far arm read as one line from the home view', () => {
  const game = createGame(MONUMENT, board);
  const words = chainsForView(board, HOME).chains.filter(isJoined).map((chain) => lettersOf(game, chain));
  assert.ok(words.includes('...LOVEABLE'), `got ${words}`);
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

test('tiles hidden from the locked view are cut out of lines', () => {
  // From straight above, the crown hangs over the plaza's back row.
  const above = normalize([0.001, 1, 0.001]);
  const { bySlot } = chainsForView(board, above, undefined, true);
  assert.equal(bySlot.get(slotKey([1, 0, 0], '+y')), undefined);
  assert.ok(bySlot.get(slotKey([-1, 0, 0], '+y')));
});

test('tiles off the selected line are rejected', () => {
  const game = freshGame(['U', 'N', 'E', 'E', 'E', 'E', 'E']);
  const chain = chainsForView(board, HOME).chains.find((c) => lettersOf(game, c) === '...LOVEABLE');
  place(game, [slotKey([1, 0, 1], '-y')], 'U');
  assert.match(preparePlay(game, chain, HOME).error, /selected line/);
});

test('tiles must not leave gaps', () => {
  const game = freshGame(['U', 'N', 'E', 'E', 'E', 'E', 'E']);
  const chain = chainsForView(board, HOME).chains.find((c) => lettersOf(game, c) === '...LOVEABLE');
  place(game, [chain.slots[0], chain.slots[2]], 'UN');
  assert.match(preparePlay(game, chain, HOME).error, /gaps/);
});

test('a new word must use a letter already on the board', () => {
  const game = freshGame(['A', 'T', 'E', 'E', 'E', 'E', 'E']);
  // The plaza's front row has no letters and nothing next to it.
  const row = [-2, -1].map((x) => slotKey([x, 0, 2], '+y'));
  const chain = chainsForView(board, HOME).chains.find((c) => row.every((key) => c.slots.includes(key)));
  place(game, chain.slots.filter((key) => row.includes(key)), 'AT');
  assert.match(preparePlay(game, chain, HOME).error, /letter already on the board/);
});

test('a joined word scores its letters times the surfaces it spans', () => {
  const game = freshGame(['U', 'N', 'E', 'E', 'E', 'E', 'E']);
  const chain = chainsForView(board, HOME).chains.find((c) => lettersOf(game, c) === '...LOVEABLE');
  place(game, [chain.slots[1], chain.slots[2]], 'UN');
  const prepared = preparePlay(game, chain, HOME);
  assert.deepEqual(prepared.words, ['UNLOVEABLE']);
  const { points } = commitPlay(game, prepared);
  // U N L O V E A B L E = 1+1+1+1+4+1+1+3+1+1 = 15, across two surfaces.
  assert.equal(points.total, 30);
  assert.equal(game.score, 30);
  assert.equal(game.turnsLeft, MONUMENT.turns - 1);
});

test('words made sideways on the same face are checked and scored', () => {
  const game = freshGame(['A', 'X', 'E', 'E', 'E', 'E', 'E']);
  // Row z = 2 of the plaza runs alongside LOVE (row z = 1).
  const keys = [1, 2].map((x) => slotKey([x, 0, 2], '+y'));
  const chain = chainsForView(board, HOME).chains.find((c) => keys.every((key) => c.slots.includes(key)));
  place(game, keys, 'AX');
  const prepared = preparePlay(game, chain, HOME);
  assert.equal(prepared.cross.length, 2);
  assert.deepEqual(prepared.cross.map((word) => word.word.length), [2, 2]);
  assert.ok(prepared.cross.every((word) => /L|O/.test(word.word)));
  const { points } = commitPlay(game, prepared);
  // AX (9) plus the two cross words (A+L = 2, X+O = 9).
  assert.equal(points.total, 9 + 2 + 9);
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
  const chain = chainsForView(board, HOME).chains.find((c) => lettersOf(game, c) === '...LOVEABLE');
  game.bonuses = new Map([[chain.slots[1], 'TW'], [chain.slots[2], 'DL']]);
  place(game, [chain.slots[1], chain.slots[2]], 'UN');
  const { points } = play(game, chain);
  // (15 + 1 for the doubled N) x 3 for the triple word x 2 surfaces.
  assert.equal(points.total, 16 * 3 * 2);
  assert.deepEqual(points.bonuses, ['TW', 'DL']);
});

test('the offline dictionary accepts real words and rejects others', () => {
  const isWord = createDictionary(readFileSync('node_modules/word-list/words.txt', 'utf8'));
  assert.ok(isWord('LOVEABLE'));
  assert.ok(isWord('larch'));
  assert.ok(!isWord('CHARL'));
});
