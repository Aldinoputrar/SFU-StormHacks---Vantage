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

// An arm leaves the tower's base along dir: four blocks extending outwards,
// then four more shifted one step along a view direction. A shift along the
// view is invisible from that view, so the arm only looks whole, and its
// lines only join up, from that one corner. From anywhere else it is a broken
// bridge.
function arm(edge, dir, view) {
  const far = add(add(edge, times(dir, 4)), view);
  return [
    { start: edge, dir, length: 4, color: MINT },
    { start: far, dir, length: 4, color: MINT },
  ];
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

// Reuse the home arm for a photograph: VANT and AGE are physically separate,
// but their seven existing top faces meet from the home vantage point.
export const THUMBNAIL_WORD = {
  text: 'VANTAGE',
  face: '+y',
  view: VIEWS.southEast,
  cells: [[1, 0, 1], [2, 0, 1], [3, 0, 1], [4, 0, 1], [6, 1, 2], [7, 1, 2], [8, 1, 2]],
  blankCells: [[9, 1, 2]], // hide the final E of ABLE while photographing
};

// The monument: a lavender tower in the middle, the Penrose crown on top,
// and four mint arms in a pinwheel. Run `npm run vantages` to list where lines join.
export const MONUMENT = {
  id: 'monument',
  seed: 20261004,
  turns: 12,
  blocks: [
    { start: [0, 0, 0], dir: [0, 1, 0], length: 7, color: LAVENDER },
    ...CROWN.blocks,
    ...arm([1, 0, 1], [1, 0, 0], VIEWS.southEast),
    ...arm([1, 0, -1], [0, 0, -1], VIEWS.northEast),
    ...arm([-1, 0, -1], [-1, 0, 0], VIEWS.northWest),
    ...arm([-1, 0, 1], [0, 0, 1], VIEWS.southWest),
    // Two short extensions: one more perspective join on each western arm.
    { start: [-11, 2, -3], dir: [-1, 0, 0], length: 3, color: MINT },
    { start: [-3, 2, 11], dir: [0, 0, 1], length: 3, color: MINT },
  ],
  // Closed rings of tiles, each seen as one from a single viewpoint.
  loops: [CROWN.loop],
  // Letters already on the board: each text runs from start along dir, on
  // the given face of each block, and spaces are left empty. Every joined line
  // reads from the plaza out along its arm, so the far ends invite words that
  // finish there: LOVE...ABLE, ...RISE, ...STAR, ...TION.
  words: [
    { start: [6, 1, 2], dir: [1, 0, 0], face: '+y', text: 'ABLE' },
    { start: [2, 1, -6], dir: [0, 0, -1], face: '+y', text: 'RISE' },
    { start: [-6, 1, -2], dir: [-1, 0, 0], face: '+y', text: 'STAR' },
    { start: [-2, 1, 6], dir: [0, 0, 1], face: '+y', text: 'TION' },
    { start: [2, 7, 0], dir: [1, 0, 0], face: '+y', text: 'O' },
  ],
};
