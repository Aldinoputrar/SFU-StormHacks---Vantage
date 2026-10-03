import {
  EPSILON,
  add,
  angleBetween,
  cross,
  dot,
  length,
  normalize,
  onScreen,
  rayHitsVoxel,
  scale,
  screenBasis,
  sub,
} from './geometry.js';

// The board model. Blocks are unit cubes on an integer grid and every exposed
// face of every block is a slot that can hold a letter. Slots on the same
// face plane form lines along that plane's two axes, like the rows and columns
// of a Scrabble board. From special viewpoints the end of one line lines up on
// screen with the end of another, and the two become one longer line.

export const FACE_NORMALS = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};
const AXES = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const MIN_FACING = 0.2; // a face must point at least this much toward the camera
const MIN_STEP = 0.5; // tiles squashed below this on screen are unreadable
const MAX_ELEVATION = 0.99; // orbit controls cannot look straight up or down
const MIN_JOIN_PART = 2; // single tiles would join with something from almost anywhere
export const ALIGN_TOLERANCE = (2 * Math.PI) / 180;

const cellKey = (cell) => cell.join(',');
export const slotKey = (cell, face) => `${cellKey(cell)}${face}`;

export function faceOf(normal) {
  return Object.keys(FACE_NORMALS).find((face) => dot(FACE_NORMALS[face], normal) > 0.5);
}

function expandBlocks(runs) {
  const cells = new Map();
  for (const { start, dir, length: count } of runs) {
    for (let i = 0; i < count; i++) {
      const cell = add(start, scale(dir, i));
      cells.set(cellKey(cell), cell);
    }
  }
  return [...cells.values()];
}

export function buildBoard(level) {
  const cells = expandBlocks(level.blocks);
  const solid = new Set(cells.map(cellKey));
  const isSolid = (x, y, z) => solid.has(`${x},${y},${z}`);

  const slots = new Map();
  for (const cell of cells) {
    for (const [face, normal] of Object.entries(FACE_NORMALS)) {
      if (solid.has(cellKey(add(cell, normal)))) continue;
      slots.set(slotKey(cell, face), {
        key: slotKey(cell, face),
        cell,
        face,
        normal,
        center: add(cell, scale(normal, 0.5)),
        axes: AXES.filter((axis) => dot(axis, normal) === 0),
        lines: [],
      });
    }
  }

  // A line starts at a slot with no same-face neighbour behind it.
  const lines = [];
  for (const slot of slots.values()) {
    for (const axis of slot.axes) {
      if (slots.has(slotKey(sub(slot.cell, axis), slot.face))) continue;
      const keys = [];
      for (let c = slot.cell; slots.has(slotKey(c, slot.face)); c = add(c, axis)) {
        keys.push(slotKey(c, slot.face));
      }
      const line = { id: lines.length, face: slot.face, normal: slot.normal, axis, slots: keys };
      lines.push(line);
      for (const key of keys) slots.get(key).lines.push(line.id);
    }
  }

  const board = { cells, isSolid, slots, lines };
  board.joins = findJoins(board);
  board.vantages = findVantages(board);
  return board;
}

function lineEnds(board, line) {
  return [0, 1].map((end) => {
    const slot = board.slots.get(end === 0 ? line.slots[0] : line.slots.at(-1));
    return { line, end, slot, outward: end === 0 ? scale(line.axis, -1) : line.axis };
  });
}

// The view direction from which end b continues end a on screen, or null.
//
// Line a would put its next tile at N = a.center + a.outward, one step past
// its end. Line b continues it when, on screen, b's end tile sits exactly at
// N and b's own step points the same way with the same length:
//   (b.center - N)              is parallel to d   (same screen position)
//   (a.outward - b.inward) = w  is parallel to d   (same screen step)
// where b.inward = -b.outward. Both differences must lie along d, which fixes d
// up to sign; the sign is chosen so both faces point toward the camera.
//
// Only the cube's 26 symmetry directions (towards its faces, edges and
// corners) count, like the fixed views in Monument Valley. Any two parallel
// strips line up from *some* angle; limiting the angles keeps that special.
function joinDirection(a, b) {
  const w = add(a.outward, b.outward);
  const offset = sub(b.slot.center, add(a.slot.center, a.outward));

  let d;
  if (length(w) < EPSILON) {
    if (length(offset) < EPSILON) return null;
    d = normalize(offset);
  } else {
    if (length(cross(offset, w)) > 1e-6) return null;
    d = normalize(w);
  }
  if (!isSymmetryDirection(d)) return null;

  for (const sign of [1, -1]) {
    const dir = scale(d, sign);
    if (dot(a.slot.normal, dir) < MIN_FACING || dot(b.slot.normal, dir) < MIN_FACING) continue;
    if (length(onScreen(a.outward, dir)) < MIN_STEP) continue;
    if (Math.abs(dir[1]) > MAX_ELEVATION) continue;
    return dir;
  }
  return null;
}

// Directions whose components, scaled so the largest is 1, are all 0 or 1.
function isSymmetryDirection(d) {
  const largest = Math.max(...d.map(Math.abs));
  return d.every((v) => {
    const ratio = Math.abs(v) / largest;
    return ratio < 1e-6 || ratio > 1 - 1e-6;
  });
}

// True when nothing blocks the view of any tile on the line from direction dir.
function lineVisible(board, line, dir) {
  return line.slots.every((key) => {
    const slot = board.slots.get(key);
    const origin = add(slot.center, scale(slot.normal, 0.01));
    return !rayHitsVoxel(origin, dir, board.isSolid);
  });
}

function findJoins(board) {
  const ends = board.lines
    .filter((line) => line.slots.length >= MIN_JOIN_PART)
    .flatMap((line) => lineEnds(board, line));
  const joins = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i];
      const b = ends[j];
      if (a.line === b.line) continue;
      const dir = joinDirection(a, b);
      if (!dir || !lineVisible(board, a.line, dir) || !lineVisible(board, b.line, dir)) continue;
      joins.push({ a: { line: a.line.id, end: a.end }, b: { line: b.line.id, end: b.end }, dir });
    }
  }
  return joins;
}

// Vantage points: the view directions where lines join. The camera snaps to
// these.
function findVantages(board) {
  const groups = new Map();
  for (const join of board.joins) {
    const key = join.dir.map((v) => v.toFixed(5)).join(',');
    if (!groups.has(key)) groups.set(key, { dir: join.dir, joins: [] });
    groups.get(key).joins.push(join);
  }
  return [...groups.values()];
}

export const isJoined = (chain) => chain.lines.length > 1;

// Every line on the board as seen from viewDir, with lines that line up on
// screen merged into chains. Each chain's slots are in reading order.
export function chainsForView(board, viewDir, tolerance = ALIGN_TOLERANCE) {
  const active = board.joins
    .map((join) => ({ join, error: angleBetween(join.dir, viewDir) }))
    .filter(({ error }) => error <= tolerance)
    .sort((p, q) => p.error - q.error)
    .map(({ join }) => join);
  return buildChains(board, active, viewDir);
}

export function nearestVantage(board, viewDir) {
  let best = null;
  for (const vantage of board.vantages) {
    const angle = angleBetween(vantage.dir, viewDir);
    if (!best || angle < best.angle) best = { vantage, angle };
  }
  return best;
}

function buildChains(board, joins, viewDir) {
  const endKey = (line, end) => `${line}:${end}`;
  const partner = new Map();
  for (const { a, b } of joins) {
    const ka = endKey(a.line, a.end);
    const kb = endKey(b.line, b.end);
    if (partner.has(ka) || partner.has(kb)) continue;
    partner.set(ka, b);
    partner.set(kb, a);
  }

  const visited = new Set();
  const walk = (startLine, startEnd) => {
    const lines = [];
    const slots = [];
    const slotLines = [];
    let line = startLine;
    let enter = startEnd;
    while (line && !visited.has(line.id)) {
      visited.add(line.id);
      lines.push(line.id);
      const ordered = enter === 0 ? line.slots : [...line.slots].reverse();
      slots.push(...ordered);
      slotLines.push(...ordered.map(() => line.id));
      const next = partner.get(endKey(line.id, 1 - enter));
      line = next && board.lines[next.line];
      enter = next?.end;
    }
    return orient(board, { lines, slots, slotLines }, viewDir);
  };

  const chains = [];
  for (const line of board.lines) {
    if (visited.has(line.id)) continue;
    if (!partner.has(endKey(line.id, 0))) chains.push(walk(line, 0));
    else if (!partner.has(endKey(line.id, 1))) chains.push(walk(line, 1));
  }
  // Whatever is left forms closed loops, like a Penrose triangle.
  for (const line of board.lines) {
    if (!visited.has(line.id)) chains.push(walk(line, 0));
  }

  const bySlot = new Map();
  chains.forEach((chain, id) => {
    chain.id = id;
    for (const key of chain.slots) {
      if (!bySlot.has(key)) bySlot.set(key, []);
      bySlot.get(key).push(chain);
    }
  });
  return { chains, bySlot };
}

// Words read left to right on screen, or top to bottom when nearly vertical.
function orient(board, chain, viewDir) {
  if (chain.slots.length < 2) return chain;
  const { right, up } = screenBasis(viewDir);
  const step = sub(board.slots.get(chain.slots[1]).center, board.slots.get(chain.slots[0]).center);
  const x = dot(step, right);
  const y = dot(step, up);
  const forward = Math.abs(x) >= 0.3 * Math.hypot(x, y) ? x > 0 : y < 0;
  if (forward) return chain;
  return {
    lines: [...chain.lines].reverse(),
    slots: [...chain.slots].reverse(),
    slotLines: [...chain.slotLines].reverse(),
  };
}
