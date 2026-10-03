import { slotKey } from './board.js';
import { mulberry32, shuffled } from './random.js';

// Premium squares, coloured as on a Scrabble board.
export const BONUS_KINDS = {
  DL: { letter: 2, word: 1, name: 'double letter' },
  TL: { letter: 3, word: 1, name: 'triple letter' },
  DW: { letter: 1, word: 2, name: 'double word' },
  TW: { letter: 1, word: 3, name: 'triple word' },
};

// Share of free squares for each kind: Scrabble's proportions (DL most
// common, TW rarest), scaled down because every face of every block holds
// tiles. Rarest first, so the rare kinds get first pick.
const SHARES = [
  ['TW', 0.02],
  ['DW', 0.045],
  ['TL', 0.035],
  ['DL', 0.07],
];

// Places bonus squares on the free slots, the same way for a given seed. Triple
// words only go on lines that join others from some vantage point, so finding
// hidden lines pays. No two bonus squares sit side by side on a face.
export function placeBonuses(board, seed, isFree) {
  const random = mulberry32(seed ^ 0x5bd1e995);
  const free = [...board.slots.values()].filter(isFree);
  const hidden = new Set(board.joins.flatMap(({ a, b }) => [...board.lines[a.line].slots, ...board.lines[b.line].slots]));
  for (const loop of board.loops) loop.slots.forEach((key) => hidden.add(key));

  const bonuses = new Map();
  const crowded = (slot) =>
    slot.axes.some((axis) =>
      [1, -1].some((sign) => bonuses.has(slotKey(slot.cell.map((v, i) => v + sign * axis[i]), slot.face))),
    );

  for (const [kind, share] of SHARES) {
    const pool = kind === 'TW' ? free.filter((slot) => hidden.has(slot.key)) : free;
    let wanted = Math.max(1, Math.round(share * free.length));
    for (const slot of shuffled(pool, random)) {
      if (!wanted) break;
      if (bonuses.has(slot.key) || crowded(slot)) continue;
      bonuses.set(slot.key, kind);
      wanted--;
    }
  }
  return bonuses;
}
