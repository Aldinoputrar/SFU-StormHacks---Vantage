// The "broken cube": strips of tiles floating around a cube's edges.
// Coordinates are in tile units. Each strip starts at `start` and runs
// `letters.length` tiles along `dir`. A space means an empty tile.
//
// LOVE and ABLE sit far apart in 3D, but ABLE starts exactly one isometric
// step (+3,+3,+3) away from the cell after LOVE, so from the (1,1,1) view
// they line up on screen as LOVEABLE.
export const STRIPS = [
  { id: 'love', start: [0, -3, 0], dir: [1, 0, 0], letters: 'LOVE' },
  { id: 'able', start: [7, 0, 3], dir: [1, 0, 0], letters: 'ABLE' },
  { id: 'rise', start: [0, 0, 1], dir: [0, 0, 1], letters: 'R  E' },
  { id: 'tower', start: [0, 1, 6], dir: [0, 1, 0], letters: '  N  ' },
  { id: 'top', start: [1, 6, 6], dir: [1, 0, 0], letters: '     ' },
  { id: 'back', start: [6, 6, 5], dir: [0, 0, -1], letters: 'S   ' },
  { id: 'drop', start: [6, 5, 0], dir: [0, -1, 0], letters: '  T ' },
];

// Standard Scrabble letter values.
export const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};
