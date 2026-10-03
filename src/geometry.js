// The maths behind Vantage, on plain [x, y, z] arrays so it runs (and is
// tested) without Three.js.
//
// An orthographic camera looking back along a unit direction d keeps only the
// part of each point that is perpendicular to d. Two points therefore land on
// the same spot on screen exactly when their difference is parallel to d.
// Every "impossible" connection in the game comes from that one fact.

export const EPSILON = 1e-9;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => scale(a, 1 / length(a));

// Where v lands on screen, in world units, for a camera looking along -d.
export function onScreen(v, d) {
  return sub(v, scale(d, dot(v, d)));
}

export function angleBetween(a, b) {
  const cos = dot(a, b) / (length(a) * length(b));
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

// Screen right and up, in world space, for a camera at direction d from its
// target with world +y as up. Matches Three.js's Object3D.lookAt.
export function screenBasis(d) {
  let right = cross([0, 1, 0], d);
  right = length(right) < 1e-6 ? [1, 0, 0] : normalize(right);
  return { right, up: cross(d, right) };
}

// Walks the unit voxels a ray passes through (Amanatides & Woo) and reports
// whether any of them is solid. Voxel k spans [k - 0.5, k + 0.5] on each axis.
export function rayHitsVoxel(origin, dir, isSolid, maxDistance = 64) {
  const pos = origin.map((v) => v + 0.5);
  const cell = pos.map(Math.floor);
  const step = dir.map(Math.sign);
  const tMax = [0, 0, 0];
  const tDelta = [0, 0, 0];

  for (let i = 0; i < 3; i++) {
    if (step[i] === 0) {
      tMax[i] = Infinity;
      tDelta[i] = Infinity;
      continue;
    }
    const boundary = step[i] > 0 ? cell[i] + 1 : cell[i];
    tMax[i] = (boundary - pos[i]) / dir[i];
    tDelta[i] = Math.abs(1 / dir[i]);
  }

  let t = 0;
  while (t <= maxDistance) {
    if (isSolid(cell[0], cell[1], cell[2])) return true;
    const axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    t = tMax[axis];
    cell[axis] += step[axis];
    tMax[axis] += tDelta[axis];
  }
  return false;
}
