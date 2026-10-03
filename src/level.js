// Letter values and tile counts from English Scrabble (blanks left out).
export const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

export const TILE_COUNTS = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4, M: 2,
  N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
};

// Penrose stairs: a square ring of strips where each side is lifted along
// (1, 1, 1). The lifts are invisible from the isometric viewpoint, so the ring
// looks closed there and a word can run around it forever. From anywhere else
// it is an open spiral: walk it one way and you climb a floor at three
// corners, yet arrive back where you started. The fourth corner hides the
// drop, the same cheat Penrose's drawing makes. These lifts are ones where no
// side covers a tile of another from the isometric view.
function penroseLoop(origin, size, lifts = [0, 3, 2, 1]) {
  const sides = [
    { from: [0, 0, 0], dir: [1, 0, 0], length: size },
    { from: [size - 1, 0, 1], dir: [0, 0, 1], length: size - 1 },
    { from: [size - 2, 0, size - 1], dir: [-1, 0, 0], length: size - 1 },
    { from: [0, 0, size - 2], dir: [0, 0, -1], length: size - 2 },
  ];
  const blocks = [];
  const path = [];
  sides.forEach(({ from, dir, length }, side) => {
    const start = from.map((v, i) => origin[i] + v + lifts[side]);
    blocks.push({ start, dir, length });
    for (let i = 0; i < length; i++) path.push(start.map((v, j) => v + dir[j] * i));
  });
  return { blocks, loop: { view: [1, 1, 1], face: '+y', path } };
}

const STAIRS = penroseLoop([-9, -4, 6], 5);

// The broken cube. Blocks are listed as straight runs of unit cubes; every
// exposed face of every block can hold a letter. Run `npm run vantages` to
// list the viewpoints where lines join.
//
// The LOVE and ABLE ledges are far apart in 3D, but ABLE starts exactly one
// isometric step (+3, +3, +3) past the end of LOVE, so from the (1, 1, 1)
// viewpoint they read as one line: LOVEABLE. The floating ledges at the end
// of the list are placed the same way against the main loop, each from a
// different viewpoint.
export const BROKEN_CUBE = {
  id: 'broken-cube',
  seed: 20251003,
  turns: 12,
  blocks: [
    { start: [0, -3, 0], dir: [1, 0, 0], length: 4 }, // LOVE ledge
    { start: [7, 0, 3], dir: [1, 0, 0], length: 4 }, // ABLE ledge
    { start: [0, 0, 1], dir: [0, 0, 1], length: 4 }, // rise
    { start: [0, 1, 6], dir: [0, 1, 0], length: 5 }, // tower
    { start: [1, 6, 6], dir: [1, 0, 0], length: 5 }, // top
    { start: [6, 6, 5], dir: [0, 0, -1], length: 4 }, // back
    { start: [6, 5, 0], dir: [0, -1, 0], length: 4 }, // drop
    { start: [2, -2, 3], dir: [0, 0, 1], length: 4 }, // joins rise from (-1, 1, 1)
    { start: [1, 1, -1], dir: [0, 0, -1], length: 4 }, // joins rise from (1, 1, -1)
    { start: [0, 3, 3], dir: [-1, 0, 0], length: 4 }, // joins top from (0, 1, 1)
    { start: [6, 8, 4], dir: [1, 0, 0], length: 4 }, // joins top from (0, 1, -1)
    ...STAIRS.blocks,
  ],
  // Closed rings of tiles, each seen as one from a single viewpoint.
  loops: [STAIRS.loop],
  // Bonus squares, each painted as an anamorphic marker that only reads
  // correctly, and only counts, from its own viewpoint.
  bonuses: [
    { cell: [9, 0, 3], face: '+z', kind: 'TW', view: [1, 1, 1] }, // on the ABLE ledge
    { cell: [3, 6, 6], face: '+y', kind: 'DW', view: [0, 1, 1] }, // on the top beam
    { cell: [-7, -4, 6], face: '+y', kind: 'TL', view: [1, 1, 1] }, // on the Penrose stairs
    { cell: [1, 1, -2], face: '+y', kind: 'DL', view: [0, 1, 0] }, // on the back ledge
  ],
  // Letters already on the board. Each text runs from start along dir, on the
  // given face of each block; spaces are left empty.
  words: [
    { start: [0, -3, 0], dir: [1, 0, 0], face: '+y', text: 'LOVE' },
    { start: [7, 0, 3], dir: [1, 0, 0], face: '+y', text: 'ABLE' },
    { start: [0, 0, 1], dir: [0, 0, 1], face: '+y', text: 'R  E' },
    { start: [0, 3, 6], dir: [0, 1, 0], face: '+z', text: 'N' },
    { start: [6, 6, 5], dir: [0, 0, -1], face: '+y', text: 'S' },
    { start: [6, 3, 0], dir: [0, 1, 0], face: '+z', text: 'T' },
  ],
};
