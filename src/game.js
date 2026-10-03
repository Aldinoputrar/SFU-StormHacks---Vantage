import { add, scale } from './geometry.js';
import { slotKey } from './board.js';
import { LETTER_VALUES, TILE_COUNTS } from './level.js';

export const RACK_SIZE = 7;
export const BINGO = 50; // for using all seven tiles in one word, as in Scrabble

// Small seeded PRNG so every player of a challenge draws the same tiles.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createBag(seed) {
  const tiles = Object.entries(TILE_COUNTS).flatMap(([letter, count]) => Array(count).fill(letter));
  const random = mulberry32(seed);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles;
}

export function createGame(level, board) {
  const letters = new Map();
  for (const word of level.words) {
    [...word.text].forEach((letter, i) => {
      if (letter === ' ') return;
      const key = slotKey(add(word.start, scale(word.dir, i)), word.face);
      if (!board.slots.has(key)) throw new Error(`Level word "${word.text}" is off the board at ${key}`);
      letters.set(key, letter);
    });
  }

  const game = {
    letters, // slot key -> committed letter
    pending: [], // tiles placed this turn: { slot, letter }
    rack: [],
    bag: createBag(level.seed),
    turnsLeft: level.turns,
    score: 0,
    history: [], // every play, with the view it was made from
  };
  refillRack(game);
  return game;
}

function refillRack(game) {
  while (game.rack.length < RACK_SIZE && game.bag.length) game.rack.push(game.bag.pop());
}

export function letterAt(game, key) {
  return game.letters.get(key) ?? game.pending.find((tile) => tile.slot === key)?.letter ?? '';
}

export function placeTile(game, key, rackIndex) {
  if (letterAt(game, key)) return false;
  const [letter] = game.rack.splice(rackIndex, 1);
  game.pending.push({ slot: key, letter });
  return true;
}

// Takes back the most recently placed tile and returns its slot.
export function undoTile(game) {
  const tile = game.pending.pop();
  if (!tile) return null;
  game.rack.push(tile.letter);
  return tile.slot;
}

export function cancelPending(game) {
  const slots = game.pending.map((tile) => tile.slot);
  game.rack.push(...game.pending.map((tile) => tile.letter));
  game.pending = [];
  return slots;
}

// Commits this turn's tiles as a word along the chain, read from viewDir, if
// isWord accepts it.
export function playWord(game, chain, viewDir, isWord) {
  if (!game.pending.length) return { error: 'Place at least one tile first.' };
  if (game.pending.some((tile) => !chain.slots.includes(tile.slot))) {
    return { error: 'All your tiles must be on the selected line.' };
  }

  let span;
  for (const line of unroll(game, chain)) {
    span = findSpan(game, line);
    if (!span.error) break;
  }
  if (span.error) return span;
  if (!isWord(span.word)) return { error: `${span.word} isn't in the dictionary.` };

  const placed = game.pending;
  const points = scoreWord(game, span, placed);
  for (const tile of placed) game.letters.set(tile.slot, tile.letter);
  game.pending = [];
  game.history.push({ type: 'word', view: viewDir, slots: span.slots, placed, word: span.word, points });
  game.score += points.total;
  game.turnsLeft--;
  refillRack(game);
  return { ...span, placed, points };
}

// Scrabble letter values, multiplied by the number of surfaces the word
// spans: a word joined across two strips scores double, three triple.
function scoreWord(game, span, placed) {
  const letters = span.slots.reduce((sum, key) => sum + LETTER_VALUES[letterAt(game, key)], 0);
  const bingo = placed.length === RACK_SIZE ? BINGO : 0;
  return { letters, surfaces: span.surfaces, bingo, total: letters * span.surfaces + bingo };
}

// A loop has no ends, so a word on it may run past any point. Cutting the
// loop just after each empty slot gives the straight lines a word could lie
// on; a full loop is cut at the first new tile.
function unroll(game, chain) {
  if (!chain.cyclic) return [chain];
  const n = chain.slots.length;
  const cuts = chain.slots.flatMap((key, i) => (letterAt(game, key) ? [] : [(i + 1) % n]));
  if (!cuts.length) cuts.push(chain.slots.indexOf(game.pending[0].slot));
  return cuts.map((cut) => {
    const order = Array.from({ length: n }, (_, k) => (cut + k) % n);
    return { slots: order.map((i) => chain.slots[i]), slotLines: order.map((i) => chain.slotLines[i]) };
  });
}

// The word made by this turn's tiles on a straight line, or an error.
function findSpan(game, line) {
  const positions = game.pending.map((tile) => line.slots.indexOf(tile.slot));
  let start = Math.min(...positions);
  let end = Math.max(...positions);
  for (let i = start; i <= end; i++) {
    if (!letterAt(game, line.slots[i])) return { error: 'Leave no gaps between your tiles.' };
  }
  while (start > 0 && letterAt(game, line.slots[start - 1])) start--;
  while (end < line.slots.length - 1 && letterAt(game, line.slots[end + 1])) end++;

  const slots = line.slots.slice(start, end + 1);
  const word = slots.map((key) => letterAt(game, key)).join('');
  if (word.length < 2) return { error: 'Words need at least two letters.' };
  return { slots, word, surfaces: new Set(line.slotLines.slice(start, end + 1)).size };
}
