// Maths for the Hyperbolic Chamber, in the Poincaré disk model: the whole
// infinite hyperbolic plane drawn inside a unit disk. Points are complex
// numbers [re, im] with |z| < 1. Straight lines (geodesics) are arcs that meet
// the rim at right angles, and distances grow without limit towards the rim,
// so things near the edge are much farther away than they look.

export const ONE = [1, 0];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
export const div = (a, b) => {
  const d = b[0] * b[0] + b[1] * b[1];
  return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d];
};
export const conj = (a) => [a[0], -a[1]];
export const neg = (a) => [-a[0], -a[1]];
export const abs2 = (a) => a[0] * a[0] + a[1] * a[1];
export const abs = (a) => Math.hypot(a[0], a[1]);
export const polar = (r, angle) => [r * Math.cos(angle), r * Math.sin(angle)];
export const scaleBy = (a, k) => [a[0] * k, a[1] * k];

// Isometries of the disk are Möbius transformations z -> (az + b) / (cz + d),
// stored as [a, b, c, d].
export const apply = ([a, b, c, d], z) => div(add(mul(a, z), b), add(mul(c, z), d));
export const compose = ([a1, b1, c1, d1], [a2, b2, c2, d2]) => [
  add(mul(a1, a2), mul(b1, c2)),
  add(mul(a1, b2), mul(b1, d2)),
  add(mul(c1, a2), mul(d1, c2)),
  add(mul(c1, b2), mul(d1, d2)),
];
export const invert = ([a, b, c, d]) => [d, neg(b), neg(c), a];
// Rescales a transformation so repeated composing does not drift in size.
export function normalized(m) {
  const [a, b, c, d] = m;
  const k = 1 / Math.sqrt(abs(sub(mul(a, d), mul(b, c))));
  return m.map((z) => scaleBy(z, k));
}
export const IDENTITY = [ONE, [0, 0], [0, 0], ONE];

// The isometry that slides the disk so point p lands on the centre.
export const toCentre = (p) => [ONE, neg(p), neg(conj(p)), ONE];

// A rotation of the whole disk about its centre.
export const rotation = (angle) => [polar(1, angle), [0, 0], [0, 0], ONE];

// Hyperbolic distance between two points of the disk.
export function distance(p, q) {
  const gap = (2 * abs2(sub(p, q))) / ((1 - abs2(p)) * (1 - abs2(q)));
  return Math.acosh(1 + gap);
}

// The isometry that moves the world a fraction t of the way along the
// geodesic from `to` towards `from`: at t = 1 the point `to` sits where
// `from` was. Used to walk the player to a crystal while the player stays put
// on screen and the world flows past.
export function walk(from, to, t) {
  const v = apply(toCentre(from), to); // the target, seen from the player
  const r = abs(v);
  if (r < 1e-12) return IDENTITY;
  const step = scaleBy(v, Math.tanh(t * Math.atanh(r)) / r);
  return compose(invert(toCentre(from)), compose(toCentre(step), toCentre(from)));
}

// The mirror circle of a regular {p, q} tiling (p-gons, q meeting at each
// corner): it carries the central tile's edge whose midpoint lies on the
// positive real axis. From the right-angled triangle with angles π/p and π/q,
// cosh(centre to edge) = cos(π/q) / sin(π/p).
export function tilingMirror(p, q) {
  const s = Math.tanh(Math.acosh(Math.cos(Math.PI / q) / Math.sin(Math.PI / p)) / 2);
  return { centre: (1 + s * s) / (2 * s), radius: (1 - s * s) / (2 * s) };
}

// A round of the chamber, in screen coordinates: the player, and three
// crystals that look about equally far away (within ±8% on screen) but are
// not equally far in hyperbolic distance. The one that looks nearest is never
// the answer, so the eye alone cannot win; the truly nearest is clearly
// nearer than the rest.
export function generateRound(random = Math.random, player = null) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const at = player ?? polar(0.36 + 0.2 * random(), 2 * Math.PI * random());
    const reach = 0.4 + 0.1 * random();
    const turn = 2 * Math.PI * random();
    const crystals = [0, 1, 2].map((i) =>
      add(at, polar(reach * (0.92 + 0.16 * random()), turn + (i * 2 * Math.PI) / 3 + (random() - 0.5) * 0.7)),
    );
    if (crystals.some((z) => abs(z) > 0.93)) continue;

    const looks = crystals.map((z) => abs(sub(z, at)));
    const distances = crystals.map((z) => distance(at, z));
    const ranked = [0, 1, 2].sort((a, b) => distances[a] - distances[b]);
    const answer = ranked[0];
    if (distances[ranked[1]] < 1.2 * distances[answer]) continue;
    if (looks.indexOf(Math.min(...looks)) === answer) continue;
    return { player: at, crystals, distances, answer };
  }
  throw new Error('Could not lay out a chamber round');
}
