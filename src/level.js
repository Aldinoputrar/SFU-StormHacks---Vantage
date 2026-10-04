// Letter values and tile counts from English Scrabble (blanks left out).
export const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

export const TILE_COUNTS = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
};

// Monument Valley's palette: each part of the monument has its own colour.
const SAND = '#f3cba5';
const MINT = '#a7d8c9';
const LAVENDER = '#b7a6db';
const CORAL = '#f19a8e';
const SKY = '#9cc9ec';

const add = (a, b) => a.map((v, i) => v + b[i]);
const times = (a, k) => a.map((v) => v * k);

// A flat slab of blocks, as runs along x.
function slab([x0, x1], y, [z0, z1], color) {
  const runs = [];
  for (let z = z0; z <= z1; z++) runs.push({ start: [x0, y, z], dir: [1, 0, 0], length: x1 - x0 + 1, color });
  return runs;
}

// The four isometric views from above, named by where the camera stands.
export const VIEWS = {
  southEast: [1, 1, 1], // the home view
  northEast: [1, 1, -1],
  northWest: [-1, 1, -1],
  southWest: [-1, 1, 1],
};

// An arm leaves the plaza's edge along dir: two blocks attached to the plaza,
// then four more shifted one step along a view direction. A shift along the
// view is invisible from that view, so the arm only looks whole, and its
// lines only join up, from that one corner. From anywhere else it is a broken
// bridge.
function arm(edge, dir, view, near = 2, color = MINT) {
  const far = add(add(edge, times(dir, near)), view);
  return [
    { start: edge, dir, length: near, color },
    { start: far, dir, length: 4, color },
  ];
}

// An arm with a hook word on its far end: the letters a word can finish on.
function hook(edge, dir, view, text, near = 2, color = MINT) {
  const start = add(add(edge, times(dir, near)), view);
  return { blocks: arm(edge, dir, view, near, color), word: { start, dir, face: '+y', text } };
}

// Penrose stairs crowning the tower: a square ring whose sides are lifted
// along the home view. The lifts are invisible from that view, so the ring
// looks closed and a word can run round it forever; from anywhere else it is
// an open staircase that climbs at three corners and still returns to where
// it started. The first side rests on the tower, so the crown is part of the
// monument. These lifts keep every tile visible from the home view.
function penroseCrown(origin, size, lifts = [0, 3, 2, 1]) {
  const sides = [
    { from: [0, 0, 0], dir: [1, 0, 0], length: size },
    { from: [size - 1, 0, 1], dir: [0, 0, 1], length: size - 1 },
    { from: [size - 2, 0, size - 1], dir: [-1, 0, 0], length: size - 1 },
    { from: [0, 0, size - 2], dir: [0, 0, -1], length: size - 2 },
  ];
  const blocks = [];
  const path = [];
  sides.forEach(({ from, dir, length }, side) => {
    const start = add(add(origin, from), times(VIEWS.southEast, lifts[side]));
    blocks.push({ start, dir, length, color: CORAL });
    for (let i = 0; i < length; i++) path.push(add(start, times(dir, i)));
  });
  return { blocks, loop: { view: VIEWS.southEast, face: '+y', path } };
}

const CROWN = penroseCrown([0, 7, 0], 4);

// A swing bridge, floating beside the tower: four blocks that turn a quarter
// turn about the first one, between two positions. In the first, seen from
// the home view, it runs straight into the crown and the O on it (TRI-O,
// ECH-O); in the second, seen from the opposite corner, it runs into TION
// from a new side (MO-TION). Found by searching every floating spot for one
// whose positions each join a different line (see the tests).
const BRIDGE = { pivot: [-6, 5, -2], length: 4, dirs: [[1, 0, 0], [0, 0, 1]], color: SKY };

// The monument: a sand plaza with a lavender tower in the middle, the Penrose
// crown on top, and four mint arms in a pinwheel. Each arm leaves the plaza on
// the side facing its own view, so the tower never stands between that view
// and the arm's line. Run `npm run vantages` to list where lines join.
export const MONUMENT = {
  id: 'monument',
  name: 'The Monument',
  blurb: 'The original: a plaza, a tower, four floating arms, the endless crown and a swing bridge. Hooks: …ABLE, …RISE, …STAR, …TION.',
  seed: 20261004,
  turns: 12,
  blocks: [
    ...slab([-2, 2], 0, [-2, 2], SAND),
    { start: [0, 1, 0], dir: [0, 1, 0], length: 6, color: LAVENDER },
    ...CROWN.blocks,
    ...arm([3, 0, 1], [1, 0, 0], VIEWS.southEast),
    ...arm([1, 0, -3], [0, 0, -1], VIEWS.northEast),
    ...arm([-3, 0, -1], [-1, 0, 0], VIEWS.northWest),
    ...arm([-1, 0, 3], [0, 0, 1], VIEWS.southWest),
  ],
  bridge: BRIDGE,
  bridgePosition: 0,
  // Where the traveller waits at the start, in sight of every corner.
  start: { cell: [-1, 0, 1], face: '+y' },
  // Closed rings of tiles, each seen as one from a single viewpoint.
  loops: [CROWN.loop],
  // Letters already on the board: each text runs from start along dir, on
  // the given face of each block, and spaces are left empty. Every joined line
  // reads from the plaza out along its arm, and only the far end holds
  // letters, so the player writes the start of a word on the plaza and, from
  // the right corner, it runs on into the arm: (LOVE)ABLE, (T)ABLE, (SUN)RISE,
  // (LODE)STAR, (MO)TION. A word already complete across the gap could never
  // be extended, so the hooks are left open.
  words: [
    { start: [6, 1, 2], dir: [1, 0, 0], face: '+y', text: 'ABLE' },
    { start: [2, 1, -6], dir: [0, 0, -1], face: '+y', text: 'RISE' },
    { start: [-6, 1, -2], dir: [-1, 0, 0], face: '+y', text: 'STAR' },
    { start: [-2, 1, 6], dir: [0, 0, 1], face: '+y', text: 'TION' },
    { start: [2, 7, 0], dir: [1, 0, 0], face: '+y', text: 'O' },
  ],
};

// The Spire: a thin tower on a small plaza, with ledges reaching out at four
// heights and the Penrose crown on top. Each ledge only meets its floating
// end from its own corner, so the four hooks are found one corner at a time.
const SPIRE_HOOKS = [
  hook([2, 2, 0], [1, 0, 0], VIEWS.southEast, 'IGHT', 2, SKY),
  hook([0, 4, -2], [0, 0, -1], VIEWS.northEast, 'OUND', 2, SKY),
  hook([-2, 6, 0], [-1, 0, 0], VIEWS.northWest, 'LESS', 2, SKY),
  hook([0, 8, 2], [0, 0, 1], VIEWS.southWest, 'NESS', 2, SKY),
];
const SPIRE_CROWN = penroseCrown([0, 11, 0], 4);

export const SPIRE = {
  id: 'spire',
  name: 'The Spire',
  blurb: 'A thin tower with ledges at four heights and the endless crown on top. Hooks: …IGHT, …OUND, …LESS, …NESS.',
  seed: 20261005,
  turns: 12,
  blocks: [
    ...slab([-1, 1], 0, [-1, 1], SAND),
    { start: [0, 1, 0], dir: [0, 1, 0], length: 10, color: LAVENDER },
    // Shelves around the tower that the ledges leave from.
    ...[2, 4, 6, 8].flatMap((y, i) => {
      const [dx, dz] = [[1, 0], [0, -1], [-1, 0], [0, 1]][i];
      return [{ start: [dx, y, dz], dir: [dx, 0, dz], length: 1, color: LAVENDER }];
    }),
    ...SPIRE_CROWN.blocks,
    ...SPIRE_HOOKS.flatMap(({ blocks }) => blocks),
  ],
  loops: [SPIRE_CROWN.loop],
  start: { cell: [1, 0, 1], face: '+y' },
  words: [...SPIRE_HOOKS.map(({ word }) => word), { start: [2, 11, 0], dir: [1, 0, 0], face: '+y', text: 'A' }],
};

// The Courtyard: a wide 7 by 7 plaza, the most room for ordinary Scrabble,
// with two arms leaving each side. Each side's two arms join from its two
// corners, so every corner has two hooks. From one of the two corners an arm
// reads outwards, so it ends a word (…ATE); from the other it reads inwards,
// so it starts one (OVER…), and its letters are laid from the far end.
const backwards = (text) => [...text].reverse().join('');
const COURTYARD_HOOKS = [
  hook([4, 0, 2], [1, 0, 0], VIEWS.southEast, 'ATE'),
  hook([4, 0, -2], [1, 0, 0], VIEWS.northEast, backwards('OVER')),
  hook([2, 0, -4], [0, 0, -1], VIEWS.northEast, 'ING'),
  hook([-2, 0, -4], [0, 0, -1], VIEWS.northWest, backwards('FORE')),
  hook([-4, 0, -2], [-1, 0, 0], VIEWS.northWest, 'LESS'),
  hook([-4, 0, 2], [-1, 0, 0], VIEWS.southWest, backwards('BACK')),
  hook([-2, 0, 4], [0, 0, 1], VIEWS.southWest, 'OUND'),
  hook([2, 0, 4], [0, 0, 1], VIEWS.southEast, backwards('DOWN')),
];

export const COURTYARD = {
  id: 'courtyard',
  name: 'The Courtyard',
  blurb: 'A wide 7 × 7 plaza with eight floating arms, two from each corner: …ATE, …ING, …LESS, …OUND and OVER…, FORE…, BACK…, DOWN….',
  seed: 20261006,
  turns: 12,
  blocks: [
    ...slab([-3, 3], 0, [-3, 3], SAND),
    { start: [0, 1, 0], dir: [0, 1, 0], length: 2, color: LAVENDER },
    ...COURTYARD_HOOKS.flatMap(({ blocks }) => blocks),
  ],
  start: { cell: [-1, 0, 1], face: '+y' },
  words: COURTYARD_HOOKS.map(({ word }) => word),
};

// Every map, in the order the title screen offers them.
export const MAPS = [MONUMENT, SPIRE, COURTYARD];
