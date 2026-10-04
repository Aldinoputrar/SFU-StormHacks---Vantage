import { add, scale } from './geometry.js';
import { buildBoard, faceOf, readingOrder, slotKey, swingCell, swingNormal, swingTurns } from './board.js';
import { BONUS_KINDS, placeBonuses } from './bonuses.js';
import { LETTER_VALUES, TILE_COUNTS } from './level.js';
import { mulberry32, shuffled } from './random.js';

// The rules of a run: the rack, placing tiles, playing words and scoring.
// Nothing here touches the screen, so it is all tested in Node.

export const RACK_SIZE = 7;
// The board each game is played on. Kept beside the game rather than in it,
// so a game stays plain data that can be copied or saved.
const boards = new WeakMap();
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

  // Bonus squares stay put, so none go on the swing bridge.
  const free = (slot) => !letters.has(slot.key) && !board.bridgeCells?.has(slot.cell.join(','));
  const game = {
    level,
    bridge: level.bridgePosition ?? 0, // which way the swing bridge points
    slots: new Set(board.slots.keys()), // the slots a tile can be placed on
    bonuses: placeBonuses(board, level.seed, free), // slot key -> 'DL' | 'TL' | 'DW' | 'TW'
    letters, // slot key -> letter on the board
    pending: [], // tiles placed this turn: { slot, letter, from (rack index) }
    rack: [],
    bag: createBag(level.seed),
    turnsLeft: level.turns,
    score: 0,
    finished: false,
    history: [], // every turn, with the view each word was played from
  };
  boards.set(game, board);
  return game;
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
  if (game.turnsLeft <= 0 || !game.slots.has(key) || letterAt(game, key)) return false;
  if (!Number.isInteger(rackIndex) || rackIndex < 0 || rackIndex >= game.rack.length) return false;
  const [letter] = game.rack.splice(rackIndex, 1);
  game.pending.push({ slot: key, letter, from: rackIndex });
  return true;
}

// Takes back the most recently placed tile, returning it to the spot in the
// rack it came from, and returns its slot.
export function undoTile(game) {
  const tile = game.pending.pop();
  if (!tile) return null;
  game.rack.splice(Math.min(tile.from ?? game.rack.length, game.rack.length), 0, tile.letter);
  return tile.slot;
}

export function cancelPending(game) {
  const slots = game.pending.map((tile) => tile.slot);
  while (game.pending.length) undoTile(game);
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

// Swings the bridge to its other position, carrying any letters on it, and
// returns the board as it now stands. It costs no turn, so players can try
// both positions freely, but not while tiles are waiting to be played.
export function swingBridge(game) {
  const { bridge } = game.level;
  if (!bridge || game.pending.length || game.finished) return null;
  const board = boards.get(game);
  const from = game.bridge;
  const to = (from + 1) % bridge.dirs.length;
  const turns = swingTurns(bridge, from, to);
  const letters = new Map();
  for (const [key, letter] of game.letters) {
    const { cell, normal } = board.slots.get(key);
    if (!board.bridgeCells.has(cell.join(','))) {
      letters.set(key, letter);
      continue;
    }
    letters.set(slotKey(swingCell(bridge, cell, turns), faceOf(swingNormal(normal, turns))), letter);
  }
  const next = buildBoard({ ...game.level, bridgePosition: to });
  game.letters = letters;
  game.bridge = to;
  game.slots = new Set(next.slots.keys());
  boards.set(game, next);
  return { board: next, turns };
}

export function finishRun(game) {
  cancelPending(game);
  game.finished = true;
}

// Checks this turn's tiles against the rules, without changing anything:
// they must form one word along the chain (read from viewDir), use a letter
// already on the board (unless the board is still empty, like Scrabble's
// first move), and any word they make sideways on the same face counts too.
// Returns { error } or a play whose words still need checking against the
// dictionary before commitPlay.
export function preparePlay(game, chain, viewDir) {
  if (game.turnsLeft <= 0) return { error: 'No turns left. Your run is complete.' };
  if (!game.pending.length) return { error: 'Place at least one tile first.' };
  if (!chain?.slots?.length) return { error: 'Choose a line before playing your word.' };
  if (game.pending.some((tile) => !chain.slots.includes(tile.slot))) {
    return { error: 'All your tiles must be on the selected line.' };
  }

  let main;
  for (const line of unroll(game, chain)) {
    main = findSpan(game, line);
    if (!main.error) break;
  }
  let cross = game.pending.map((tile) => crossWord(game, chain, tile.slot, viewDir)).filter(Boolean);
  // As in Scrabble, a single tile may make its word sideways only: then that
  // word is the one played.
  if (main.short && cross.length === 1) {
    main = { ...cross[0], surfaces: 1 };
    cross = [];
  }
  if (main.error) return main;

  if (game.letters.size && !main.slots.some((key) => game.letters.has(key)) && !cross.length) {
    return { error: 'Your word must use a letter already on the board.' };
  }
  return { viewDir, main, cross, cyclic: Boolean(chain.cyclic), words: [main.word, ...cross.map((word) => word.word)] };
}

// Plays a word in one go with a dictionary that answers straight away, as
// tests and tools do. The game itself checks words online, between
// preparePlay and commitPlay.
export function playWord(game, chain, viewDir, isWord) {
  const play = preparePlay(game, chain, viewDir);
  if (play.error) return play;
  const rejected = play.words.find((word) => !isWord(word));
  if (rejected) return { error: `${rejected} isn't in the dictionary.` };
  return commitPlay(game, play);
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

  const board = boards.get(game);
  const onBridge = play.main.slots.some((key) => board.bridgeCells?.has(board.slots.get(key).cell.join(',')));
  for (const tile of placed) game.letters.set(tile.slot, tile.letter);
  game.pending = [];
  game.history.push({
    type: 'word',
    view: play.viewDir,
    word: play.main.word,
    slots: play.main.slots,
    placed,
    points,
    cyclic: play.cyclic,
    onBridge,
  });
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
  const board = boards.get(game);
  const slot = board.slots.get(key);
  const i = chain.slots.indexOf(key);
  const n = chain.slots.length;
  const neighbours = [];
  if (chain.cyclic || i > 0) neighbours.push(chain.slots[(i + n - 1) % n]);
  if (chain.cyclic || i < n - 1) neighbours.push(chain.slots[(i + 1) % n]);
  const touches = (id) => board.lines[id].slots.some((k) => neighbours.includes(k));
  // At a corner of a flat loop both lines run along the word, so neither is
  // sideways.
  const across = slot.lines.find((id) => !touches(id));
  if (!slot.lines.some(touches) || across === undefined) return null;

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
  if (word.length < 2) return { error: 'Words need at least two letters.', short: true };
  return { slots, word, surfaces: new Set(line.slotLines.slice(start, end + 1)).size };
}
