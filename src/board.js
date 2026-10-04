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
const MIN_JOIN_PART = 2; // a lone tile lines up with something from almost anywhere
const MIN_GAP = 0.9; // strips that touch round a block's edge are not an illusion
export const ALIGN_TOLERANCE = (2 * Math.PI) / 180;

const cellKey = (cell) => cell.join(',');
export const slotKey = (cell, face) => `${cellKey(cell)}${face}`;

export function faceOf(normal) {
  return Object.keys(FACE_NORMALS).find((face) => dot(FACE_NORMALS[face], normal) > 0.5);
}

// Cells of the level's block runs, and the colour of each (runs may give one).
function expandBlocks(runs) {
  const cells = new Map();
  const colors = new Map();
  for (const { start, dir, length: count, color } of runs) {
    for (let i = 0; i < count; i++) {
      const cell = add(start, scale(dir, i));
      cells.set(cellKey(cell), cell);
      if (color) colors.set(cellKey(cell), color);
    }
  }
  return { cells: [...cells.values()], colors };
}

export function buildBoard(level) {
  const { cells, colors } = expandBlocks(level.blocks);
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

  const board = { cells, colors, isSolid, slots, lines };
  board.joins = findJoins(board);
  board.loops = (level.loops ?? []).map((loop, i) => buildLoop(board, loop, i));
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
// Only the four isometric views from above count, the four rotations of a
// Monument Valley level. Any two parallel strips line up from *some* angle;
// limiting the angles keeps that special.
function joinDirection(a, b) {
  const w = add(a.outward, b.outward);
  const offset = sub(b.slot.center, add(a.slot.center, a.outward));

  let d;
  if (length(offset) < MIN_GAP) return null;
  if (length(w) < EPSILON) {
    d = normalize(offset);
  } else {
    if (length(cross(offset, w)) > 1e-6) return null;
    d = normalize(w);
  }
  if (!isIsometric(d)) return null;

  for (const sign of [1, -1]) {
    const dir = scale(d, sign);
    if (dir[1] <= 0) continue; // views from below are for looking, not lining up
    if (dot(a.slot.normal, dir) < MIN_FACING || dot(b.slot.normal, dir) < MIN_FACING) continue;
    if (length(onScreen(a.outward, dir)) < MIN_STEP) continue;
    return dir;
  }
  return null;
}

// Directions along a diagonal of the cube, like (1, 1, 1) or (-1, 1, 1).
function isIsometric(d) {
  return d.every((v) => Math.abs(Math.abs(v) - Math.abs(d[0])) < 1e-6);
}

// Sample a tile's centre and four corners. Any clear sample makes the tile
// selectable; any blocked sample marks it as covered in the line editor.
function visibilitySamples(board, key, dir) {
  const { center, normal, axes } = board.slots.get(key);
  const lifted = add(center, scale(normal, 0.01));
  const samples = [lifted];
  for (const u of [-0.4, 0.4]) {
    for (const v of [-0.4, 0.4]) samples.push(add(lifted, add(scale(axes[0], u), scale(axes[1], v))));
  }
  return samples.map((origin) => !rayHitsVoxel(origin, dir, board.isSolid));
}

// Perspective joins need fully readable endpoints, not just a visible corner.
function slotsVisible(board, keys, dir) {
  return keys.every((key) => visibilitySamples(board, key, dir).every(Boolean));
}

export const slotVisible = (board, key, dir) => slotsVisible(board, [key], dir);

function findJoins(board) {
  const ends = board.lines.flatMap((line) => lineEnds(board, line));
  const joins = [];
  for (let i = 0; i < ends.length; i++) {
    for (let j = i + 1; j < ends.length; j++) {
      const a = ends[i];
      const b = ends[j];
      if (a.line === b.line || Math.min(a.line.slots.length, b.line.slots.length) < MIN_JOIN_PART) continue;
      const dir = joinDirection(a, b);
      // A join is a visible meeting of two endpoints. A covered tile farther
      // along either strip does not change that strip's physical continuity.
      if (!dir || !slotsVisible(board, [a.slot.key, b.slot.key], dir)) continue;
      joins.push({ a: { line: a.line.id, end: a.end }, b: { line: b.line.id, end: b.end }, dir });
    }
  }
  return joins;
}

// A loop is a closed path of slots that, seen from its viewpoint, steps one
// tile at a time all the way round, including from the last slot back to the
// first. Levels declare loops; this checks the geometry really closes.
function buildLoop(board, loop, index) {
  const dir = normalize(loop.view);
  const slots = loop.path.map((cell) => slotKey(cell, loop.face));
  const missing = slots.find((key) => !board.slots.has(key));
  if (missing) throw new Error(`Loop ${index} has no slot at ${missing}`);

  const slotLines = [];
  let segment = 0;
  slots.forEach((key, i) => {
    const slot = board.slots.get(key);
    const step = sub(board.slots.get(slots[(i + 1) % slots.length]).center, slot.center);
    const oneTile = slot.axes.some((axis) =>
      [1, -1].some((sign) => length(onScreen(sub(step, scale(axis, sign)), dir)) < 1e-6),
    );
    if (!oneTile) throw new Error(`Loop ${index} does not close on screen after ${key}`);
    slotLines.push(`loop${index}:${segment}`);
    if (Math.abs(length(step) - 1) > 1e-6) segment++; // the next side floats elsewhere
  });
  if (!slotsVisible(board, slots, dir)) throw new Error(`Loop ${index} is hidden from its viewpoint`);
  return { dir, slots, slotLines };
}

// Vantage points: the view directions where lines join or loops close. The
// camera snaps to these.
function findVantages(board) {
  const groups = new Map();
  const group = (dir) => {
    const key = dir.map((v) => v.toFixed(5)).join(',');
    if (!groups.has(key)) groups.set(key, { dir, joins: [] });
    return groups.get(key);
  };
  for (const join of board.joins) group(join.dir).joins.push(join);
  for (const loop of board.loops) group(loop.dir);
  return [...groups.values()];
}

export const isJoined = (chain) => chain.cyclic || chain.lines.length > 1;

// Every line on the board as seen from viewDir, with lines that line up on
// screen merged into chains. Each chain's slots are in reading order. With
// visibleOnly, keep complete camera-facing chains with at least one visible
// tile. Covered tiles remain playable through the line editor; hiddenSlots
// lets the UI explain which tiles are behind other blocks.
export function chainsForView(board, viewDir, tolerance = ALIGN_TOLERANCE, visibleOnly = false) {
  const active = board.joins
    .map((join) => ({ join, error: angleBetween(join.dir, viewDir) }))
    .filter(({ error }) => error <= tolerance)
    .sort((p, q) => p.error - q.error)
    .map(({ join }) => join);
  const loops = board.loops.filter((loop) => angleBetween(loop.dir, viewDir) <= tolerance);
  const view = buildChains(board, active, viewDir, loops);
  return visibleOnly ? withVisibility(board, view.chains, viewDir) : view;
}

function withVisibility(board, chains, viewDir) {
  const visibility = new Map();
  const samples = (key) => {
    if (!visibility.has(key)) visibility.set(key, visibilitySamples(board, key, viewDir));
    return visibility.get(key);
  };
  const playable = [];
  for (const chain of chains) {
    if (chain.slots.some((key) => dot(board.slots.get(key).normal, viewDir) <= 0.05)) continue;
    if (!chain.slots.some((key) => samples(key).some(Boolean))) continue;
    const hiddenSlots = chain.slots.filter((key) => !samples(key).every(Boolean));
    playable.push({ ...chain, hiddenSlots });
  }
  return indexChains(playable);
}

export function nearestVantage(board, viewDir) {
  let best = null;
  for (const vantage of board.vantages) {
    const angle = angleBetween(vantage.dir, viewDir);
    if (!best || angle < best.angle) best = { vantage, angle };
  }
  return best;
}

function buildChains(board, joins, viewDir, loops = []) {
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
  for (const loop of loops) {
    chains.push(orientLoop(board, { lines: [], slots: loop.slots, slotLines: loop.slotLines, cyclic: true }, viewDir));
  }

  return indexChains(chains);
}

function indexChains(chains) {
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

// Loops read clockwise on screen.
function orientLoop(board, chain, viewDir) {
  const { right, up } = screenBasis(viewDir);
  const points = chain.slots.map((key) => {
    const center = board.slots.get(key).center;
    return [dot(center, right), dot(center, up)];
  });
  let area = 0;
  points.forEach(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  });
  if (area < 0) return chain;
  return { ...chain, slots: [...chain.slots].reverse(), slotLines: [...chain.slotLines].reverse() };
}

// The slots of a straight run in the order they read from viewDir.
export const readingOrder = (board, slots, viewDir) =>
  orient(board, { lines: [], slots, slotLines: slots.map(() => null) }, viewDir).slots;

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
