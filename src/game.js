import { add, scale } from './geometry.js';
import { readingOrder, slotKey } from './board.js';
import { BONUS_KINDS, placeBonuses } from './bonuses.js';
import { LETTER_VALUES, TILE_COUNTS } from './level.js';
import { mulberry32, shuffled } from './random.js';

// The rules of a run: the rack, placing tiles, playing words and scoring.
// Nothing here touches the screen, so it is all tested in Node.

export const RACK_SIZE = 7;
export const BINGO = 50; // for using all seven tiles in one word, as in Scrabble
const VOWELS = new Set('AEIOU');

function createBag(seed) {
  const tiles = Object.entries(TILE_COUNTS).flatMap(([letter, count]) => Array(count).fill(letter));
  return shuffled(tiles, mulberry32(seed));
}

// A new run. The rack starts empty: letters are earned in the Hyperbolic
// Chamber before each turn (see refillRack).
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

  return {
    board,
    bonuses: placeBonuses(board, level.seed, (slot) => !letters.has(slot.key)), // slot key -> 'DL' | 'TL' | 'DW' | 'TW'
    letters, // slot key -> letter on the board
    pending: [], // tiles placed this turn: { slot, letter }
    rack: [],
    bag: createBag(level.seed),
    turnsLeft: level.turns,
    score: 0,
    finished: false,
    history: [], // every turn, with the view each word was played from
  };
}

// The run ends when turns run out, the player stops, or no tiles are left.
export const isOver = (game) =>
  game.finished || game.turnsLeft <= 0 || (!game.rack.length && !game.bag.length && !game.pending.length);

// How much a rack would like this tile: vowels when it is short of them,
// consonants when it has plenty, then high-scoring letters; a Q without a U
// and duplicates count against.
function usefulness(rack, letter) {
  const vowels = rack.filter((l) => VOWELS.has(l)).length;
  let score = LETTER_VALUES[letter];
  if (VOWELS.has(letter)) score += vowels < 2 ? 12 : vowels >= 4 ? -12 : 0;
  else if (vowels >= 4) score += 6;
  if (letter === 'Q' && !rack.includes('U')) score -= 9;
  if (rack.includes(letter)) score -= 4;
  return score;
}

// Fills the rack up to seven tiles. Each new tile is the best of `picks`
// drawn from the bag, so a better chamber score means better letters; the
// tiles not taken go back to the bottom of the bag. Returns the new tiles.
export function refillRack(game, picks = 1) {
  const drawn = [];
  while (game.rack.length < RACK_SIZE && game.bag.length) {
    const options = game.bag.splice(-Math.min(picks, game.bag.length));
    options.sort((a, b) => usefulness(game.rack, b) - usefulness(game.rack, a));
    const [best, ...rest] = options;
    game.rack.push(best);
    drawn.push(best);
    game.bag.unshift(...rest);
  }
  return drawn;
}

export function letterAt(game, key) {
  return game.letters.get(key) ?? game.pending.find((tile) => tile.slot === key)?.letter ?? '';
}

export function placeTile(game, key, rackIndex) {
  if (letterAt(game, key) || rackIndex < 0 || rackIndex >= game.rack.length) return false;
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

// Spends a turn sending the whole rack back to the bag, to be refilled in the
// chamber. Returns false if tiles are on the board or no turns are left.
export function swapRack(game) {
  if (game.pending.length || game.turnsLeft <= 0 || !game.rack.length) return false;
  game.bag.unshift(...game.rack);
  game.rack = [];
  game.history.push({ type: 'swap' });
  game.turnsLeft--;
  return true;
}

export function finishRun(game) {
  cancelPending(game);
  game.finished = true;
}

// Checks this turn's tiles against the rules, without changing anything:
// they must form one word along the chain (read from viewDir), use a letter
// already on the board, and any word they make sideways on the same face
// counts too. Returns { error } or a play whose words still need checking
// against the dictionary before commitPlay.
export function preparePlay(game, chain, viewDir) {
  if (!game.pending.length) return { error: 'Place at least one tile first.' };
  if (game.pending.some((tile) => !chain.slots.includes(tile.slot))) {
    return { error: 'All your tiles must be on the selected line.' };
  }

  let main;
  for (const line of unroll(game, chain)) {
    main = findSpan(game, line);
    if (!main.error) break;
  }
  if (main.error) return main;

  const cross = game.pending.map((tile) => crossWord(game, chain, tile.slot, viewDir)).filter(Boolean);
  if (!main.slots.some((key) => game.letters.has(key)) && !cross.length) {
    return { error: 'Your word must use a letter already on the board.' };
  }
  return { viewDir, main, cross, words: [main.word, ...cross.map((word) => word.word)] };
}

// Commits a prepared play whose words were all accepted. Returns the score.
export function commitPlay(game, play) {
  const placed = game.pending;
  const fresh = new Set(placed.map((tile) => tile.slot));
  const main = scoreSlots(game, play.main.slots, fresh);
  const cross = play.cross.map((word) => ({ word: word.word, ...scoreSlots(game, word.slots, fresh) }));
  const bingo = placed.length === RACK_SIZE ? BINGO : 0;

  const mainTotal = main.letters * main.wordMultiplier * play.main.surfaces;
  const total = mainTotal + cross.reduce((sum, word) => sum + word.letters * word.wordMultiplier, 0) + bingo;
  const points = {
    letters: main.letters,
    wordMultiplier: main.wordMultiplier,
    surfaces: play.main.surfaces,
    cross: cross.map((word) => ({ word: word.word, total: word.letters * word.wordMultiplier })),
    bingo,
    bonuses: [...main.bonuses, ...cross.flatMap((word) => word.bonuses)],
    total,
  };

  for (const tile of placed) game.letters.set(tile.slot, tile.letter);
  game.pending = [];
  game.history.push({ type: 'word', view: play.viewDir, word: play.main.word, slots: play.main.slots, placed, points });
  game.score += total;
  game.turnsLeft--;
  return { word: play.main.word, placed, points };
}

// Scrabble scoring for one word: letter values, with bonus squares counting
// only under tiles placed this turn.
function scoreSlots(game, slots, fresh) {
  let letters = 0;
  let wordMultiplier = 1;
  const bonuses = [];
  for (const key of slots) {
    const kind = fresh.has(key) ? game.bonuses.get(key) : null;
    const bonus = kind ? BONUS_KINDS[kind] : null;
    if (kind) bonuses.push(kind);
    letters += LETTER_VALUES[letterAt(game, key)] * (bonus?.letter ?? 1);
    wordMultiplier *= bonus?.word ?? 1;
  }
  return { letters, wordMultiplier, bonuses };
}

// The word a new tile makes across the main line, on its own face: the run of
// letters through it along the face's other axis, if longer than one.
function crossWord(game, chain, key, viewDir) {
  const { board } = game;
  const slot = board.slots.get(key);
  const i = chain.slots.indexOf(key);
  const n = chain.slots.length;
  const neighbours = [];
  if (chain.cyclic || i > 0) neighbours.push(chain.slots[(i + n - 1) % n]);
  if (chain.cyclic || i < n - 1) neighbours.push(chain.slots[(i + 1) % n]);
  const along = slot.lines.find((id) => board.lines[id].slots.some((k) => neighbours.includes(k)));
  const across = slot.lines.find((id) => id !== along);
  if (along === undefined || across === undefined) return null;

  const line = board.lines[across].slots;
  let start = line.indexOf(key);
  let end = start;
  while (start > 0 && letterAt(game, line[start - 1])) start--;
  while (end < line.length - 1 && letterAt(game, line[end + 1])) end++;
  if (start === end) return null;
  const slots = readingOrder(board, line.slice(start, end + 1), viewDir);
  return { slots, word: slots.map((k) => letterAt(game, k)).join('') };
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
