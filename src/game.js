import { add, angleBetween, normalize, scale } from './geometry.js';
import { ALIGN_TOLERANCE, faceOf, slotKey, slotVisible } from './board.js';
import { LETTER_VALUES, TILE_COUNTS } from './level.js';
import { turnOnce, turnedLevel, turntableCells } from './turntable.js';

export const RACK_SIZE = 7;
export const BINGO = 50; // for using all seven tiles in one word, as in Scrabble

export const BONUS_KINDS = {
  DL: { letter: 2, word: 1, label: '2× LETTER' },
  TL: { letter: 3, word: 1, label: '3× LETTER' },
  DW: { letter: 1, word: 2, label: '2× WORD' },
  TW: { letter: 1, word: 3, label: '3× WORD' },
};

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

  // Bonus squares only count when played from the viewpoint that reveals them.
  const bonuses = (level.bonuses ?? []).map(({ cell, face, kind, view }) => {
    const slot = slotKey(cell, face);
    const dir = normalize(view);
    if (!board.slots.has(slot) || !slotVisible(board, slot, dir)) {
      throw new Error(`Bonus ${kind} at ${slot} cannot be seen from its viewpoint`);
    }
    return { slot, kind, dir };
  });

  const game = {
    level,
    quarters: 0, // quarter turns of the turntable so far
    bonuses,
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
  const points = scoreWord(game, span, placed, viewDir);
  for (const tile of placed) game.letters.set(tile.slot, tile.letter);
  game.pending = [];
  game.history.push({ type: 'word', view: viewDir, slots: span.slots, placed, word: span.word, points });
  game.score += points.total;
  game.turnsLeft--;
  refillRack(game);
  return { ...span, placed, points };
}

// The level as it stands, with the turntable turned.
export const currentLevel = (game) => turnedLevel(game.level, game.quarters);

// Spends a turn turning the turntable a quarter turn. Letters on it turn
// with it. board is the board before the turn.
export function turnTurntable(game, board) {
  if (game.pending.length || game.turnsLeft <= 0) return false;
  const level = currentLevel(game);
  const cells = turntableCells(level);
  const letters = new Map();
  for (const [key, letter] of game.letters) {
    const { cell, normal } = board.slots.get(key);
    if (!cells.has(cell.join(','))) {
      letters.set(key, letter);
      continue;
    }
    const moved = turnOnce(level, cell, normal);
    letters.set(slotKey(moved.cell, faceOf(moved.normal)), letter);
  }
  game.letters = letters;
  game.quarters = (game.quarters + 1) % 4;
  game.history.push({ type: 'turn' });
  game.turnsLeft--;
  return true;
}

// Bonuses revealed from viewDir, by slot.
export function activeBonuses(game, viewDir) {
  const active = new Map();
  for (const bonus of game.bonuses) {
    if (angleBetween(bonus.dir, viewDir) <= ALIGN_TOLERANCE) active.set(bonus.slot, bonus.kind);
  }
  return active;
}

// Scrabble scoring: letter values, with bonus squares counting only under
// newly placed tiles. The total is then multiplied by the number of surfaces
// the word spans, so a word joined across two strips scores double.
function scoreWord(game, span, placed, viewDir) {
  const active = activeBonuses(game, viewDir);
  const fresh = new Set(placed.map((tile) => tile.slot));
  const used = span.slots.filter((key) => fresh.has(key) && active.has(key)).map((key) => active.get(key));

  let letters = 0;
  let wordMultiplier = 1;
  for (const key of span.slots) {
    const bonus = fresh.has(key) && active.has(key) ? BONUS_KINDS[active.get(key)] : null;
    letters += LETTER_VALUES[letterAt(game, key)] * (bonus?.letter ?? 1);
    wordMultiplier *= bonus?.word ?? 1;
  }
  const bingo = placed.length === RACK_SIZE ? BINGO : 0;
  const total = letters * wordMultiplier * span.surfaces + bingo;
  return { letters, wordMultiplier, surfaces: span.surfaces, bingo, bonuses: used, total };
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
