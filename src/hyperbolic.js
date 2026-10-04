import { shuffled } from './random.js';

// Maths for the Hyperbolic Chamber and the Lab, in the Poincaré disk model:
// the whole infinite hyperbolic plane drawn inside a unit disk. Points are
// complex numbers [re, im] with |z| < 1. Straight lines (geodesics) are arcs
// that meet the rim at right angles, and distances grow without limit towards
// the rim, so things near the edge are much farther away than they look.
//
// The same formulas cover all three geometries of constant curvature K, with
// lengths measured by ds = 2|dz| / (1 + K|z|²):
//   K = -1  hyperbolic: the Poincaré disk (the default everywhere)
//   K =  0  flat: the ordinary plane, scaled by 2
//   K = +1  spherical: a unit sphere seen by stereographic projection, the
//           unit circle being the equator around the point at the centre
// Only the sign of K changes the isometry that slides a point to the centre,
// z -> (z - p) / (1 + K p̄ z), and how distance from the centre grows.

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

export const HYPERBOLIC = -1;
export const FLAT = 0;
export const SPHERICAL = 1;

// The distance from the centre to a point drawn at Euclidean radius r, and
// the radius at which a point that far away is drawn.
export const fromCentre = (r, K = HYPERBOLIC) => (K < 0 ? 2 * Math.atanh(r) : K > 0 ? 2 * Math.atan(r) : 2 * r);
export const radiusAt = (d, K = HYPERBOLIC) => (K < 0 ? Math.tanh(d / 2) : K > 0 ? Math.tan(d / 2) : d / 2);

// The isometry that slides the disk so point p lands on the centre.
export const toCentre = (p, K = HYPERBOLIC) => [ONE, neg(p), scaleBy(conj(p), K), ONE];

// A rotation of the whole disk about its centre.
export const rotation = (angle) => [polar(1, angle), [0, 0], [0, 0], ONE];

// The distance between two points: slide one to the centre and measure.
export function distance(p, q, K = HYPERBOLIC) {
  return fromCentre(abs(apply(toCentre(p, K), q)), K);
}

// The isometry that moves the world a fraction t of the way along the
// geodesic from `to` towards `from`: at t = 1 the point `to` sits where
// `from` was. Used to walk the player to a crystal while the player stays put
// on screen and the world flows past.
export function walk(from, to, t, K = HYPERBOLIC) {
  const v = apply(toCentre(from, K), to); // the target, seen from the player
  const r = abs(v);
  if (r < 1e-12) return IDENTITY;
  const step = scaleBy(v, radiusAt(t * fromCentre(r, K), K) / r);
  return compose(invert(toCentre(from, K)), compose(toCentre(step, K), toCentre(from, K)));
}

// The point halfway along the geodesic from p to q.
export function midpoint(p, q, K = HYPERBOLIC) {
  const v = apply(toCentre(p, K), q);
  const r = abs(v);
  if (r < 1e-12) return p;
  return apply(invert(toCentre(p, K)), scaleBy(v, radiusAt(fromCentre(r, K) / 2, K) / r));
}

// The angle at p between the geodesics to q and to r. Sliding p to the centre
// keeps angles (Möbius maps are conformal) and turns both geodesics into
// straight diameters, so it is the ordinary angle between two vectors there.
export function angleAt(p, q, r, K = HYPERBOLIC) {
  const centred = toCentre(p, K);
  const u = apply(centred, q);
  const v = apply(centred, r);
  const cos = (u[0] * v[0] + u[1] * v[1]) / (abs(u) * abs(v));
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

// A geodesic triangle's angles and area. In a flat plane the angles add up
// to π. By Gauss-Bonnet, with curvature K they add up to π + K × area: less
// on the hyperbolic plane, more on the sphere, the difference being exactly
// the area. Flat triangles are ordinary ones, four times their area in z
// because lengths are doubled.
export function triangle(p, q, r, K = HYPERBOLIC) {
  const angles = [angleAt(p, q, r, K), angleAt(q, r, p, K), angleAt(r, p, q, K)];
  const sum = angles[0] + angles[1] + angles[2];
  const flat = 2 * Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1]));
  return { angles, sum, area: K ? (sum - Math.PI) / K : flat };
}

// One step of walking for a player at the centre: the world slides so the
// point `length` away in direction `heading` comes to the centre. It is a pure
// translation along a diameter, so the player never turns.
export function stride(heading, length, K = HYPERBOLIC) {
  return toCentre(polar(radiusAt(length, K), heading), K);
}

// How far an isometry turns things at the centre, in radians: the argument of
// its derivative there, (ad - bc) / d².
export function turnAtCentre([a, b, c, d]) {
  const slope = div(sub(mul(a, d), mul(b, c)), mul(d, d));
  return Math.atan2(slope[1], slope[0]);
}

// The mirror of a regular {p, q} tiling (p-gons, q meeting at each corner):
// the geodesic carrying the central tile's edge whose midpoint lies on the
// positive real axis, at s. From the right-angled triangle with angles π/p
// and π/q, the centre-to-edge distance h has cosh h (hyperbolic) or cos h
// (spherical) equal to cos(π/q) / sin(π/p); a flat tiling can be any size.
// Hyperbolic geodesics are circles through s and its inverse 1/s, spherical
// ones circles through s and its antipode -1/s, flat ones straight lines.
export function tilingMirror(p, q, K = HYPERBOLIC, flatEdge = 0.36) {
  const ratio = Math.cos(Math.PI / q) / Math.sin(Math.PI / p);
  if (!K) return { line: radiusAt(flatEdge, K) };
  const s = radiusAt(K < 0 ? Math.acosh(ratio) : Math.acos(ratio), K);
  return { centre: (s * s - K) / (2 * s), radius: (1 + K * s * s) / (2 * s) };
}

// How big a crystal looks on screen, in disk units, when its round starts.
export const CRYSTAL_LOOK = 0.065;

// A hyperbolic disk of radius ρ centred at Euclidean distance r from the
// centre is drawn as a Euclidean disk. With a = r and b = tanh(ρ/2), its ends
// on the ray through the centre sit at (a ± b) / (1 ± ab), so its drawn
// radius is b(1 - a²) / (1 - a²b²).
export function drawnRadius(r, rho) {
  const b = Math.tanh(rho / 2);
  return (b * (1 - r * r)) / (1 - r * r * b * b);
}

// The hyperbolic radius that is drawn as Euclidean radius e at distance r
// from the centre: the positive root of e·a²·b² + (1 - a²)·b - e = 0.
export function radiusDrawnAs(r, e) {
  const a2 = r * r;
  const b = a2 < 1e-12 ? e : (Math.sqrt((1 - a2) ** 2 + 4 * e * e * a2) - (1 - a2)) / (2 * e * a2);
  return 2 * Math.atanh(b);
}

// A round of the chamber, in screen coordinates: the player, and three
// crystals that look about equally far away (within ±8% on screen) but are
// not equally far in hyperbolic distance. The one that looks nearest is never
// the answer, so the eye alone cannot win; the truly nearest is clearly
// nearer than the rest.
//
// Crystals come in different true sizes, chosen so they all look about the
// same size when the round starts. Otherwise the biggest-looking crystal
// would always be the answer (it sits where space is least stretched), and
// the round could be won without reading the tiling.
export function generateRound(random = Math.random, player = null) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const at = player ?? polar(0.05 + 0.28 * random(), 2 * Math.PI * random());
    const reach = 0.38 + 0.12 * random();
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
    const radii = crystals.map((z) => radiusDrawnAs(abs(z), CRYSTAL_LOOK * (0.88 + 0.24 * random())));
    return { player: at, crystals, radii, distances, answer };
  }
  throw new Error('Could not lay out a chamber round');
}

// Points along the circular arc from a through m to b (a straight segment if
// the three are in line), n + 1 of them including both ends.
export function arcThrough(a, m, b, n = 48) {
  const [ax, ay] = a;
  const [bx, by] = b;
  const [mx, my] = m;
  const d = 2 * (ax * (my - by) + mx * (by - ay) + bx * (ay - my));
  const line = () => Array.from({ length: n + 1 }, (_, i) => add(a, scaleBy(sub(b, a), i / n)));
  if (Math.abs(d) < 1e-9) return line();
  const ux = (abs2(a) * (my - by) + abs2(m) * (by - ay) + abs2(b) * (ay - my)) / d;
  const uy = (abs2(a) * (bx - mx) + abs2(m) * (ax - bx) + abs2(b) * (mx - ax)) / d;
  const centre = [ux, uy];
  const radius = abs(sub(a, centre));
  if (radius > 1e4) return line();
  const angle = (z) => Math.atan2(z[1] - uy, z[0] - ux);
  const start = angle(a);
  // Go round whichever way passes through m.
  const turn = (z) => (((angle(z) - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sweep = turn(m) <= turn(b) ? turn(b) : turn(b) - 2 * Math.PI;
  return Array.from({ length: n + 1 }, (_, i) => add(centre, polar(radius, start + (sweep * i) / n)));
}

// The length of a path given as points close together.
export const pathLength = (points, K = HYPERBOLIC) =>
  points.slice(1).reduce((sum, z, i) => sum + distance(points[i], z, K), 0);

// A "straight line" round, in screen coordinates: the player, a crystal and
// three paths between them. One is the geodesic, which in the Poincaré disk
// is an arc bowing towards the centre; one is the Euclidean straight segment,
// which looks straightest but is longer; the third bows the wrong way, or too
// far. The geodesic is always the shortest. Both ends sit well out from the
// centre, where geodesics bow enough to see.
export function generateStraightRound(random = Math.random) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const at = polar(0.55 + 0.15 * random(), 2 * Math.PI * random());
    const side = random() < 0.5 ? -1 : 1;
    const target = polar(0.6 + 0.2 * random(), Math.atan2(at[1], at[0]) + side * (1.6 + 0.8 * random()));
    const gap = distance(at, target);
    if (gap < 1.3 || gap > 4.2) continue;

    const chordMiddle = scaleBy(add(at, target), 0.5);
    const middle = midpoint(at, target);
    const bow = sub(middle, chordMiddle); // how far, and which way, the geodesic bows
    if (abs(bow) < 0.1) continue;
    const decoy = random() < 0.5 ? sub(chordMiddle, bow) : add(chordMiddle, scaleBy(bow, 2));
    if (arcThrough(at, decoy, target).some((z) => abs(z) > 0.95)) continue;

    const kinds = ['geodesic', 'segment', 'decoy'];
    const order = shuffled([0, 1, 2], random);
    const middles = { geodesic: middle, segment: chordMiddle, decoy };
    const paths = order.map((k) => arcThrough(at, middles[kinds[k]], target));
    const lengths = paths.map((points) => pathLength(points));
    return { player: at, target, paths, lengths, kinds: order.map((k) => kinds[k]), answer: order.indexOf(0) };
  }
  throw new Error('Could not lay out a straight-line round');
}

// A "biggest triangle" round, in screen coordinates: three geodesic
// triangles that look about the same size (within ±15% in drawn area) but
// differ in true area. Nearer the rim, where space is stretched, a triangle
// that looks the same holds far more. The one that looks biggest is never the
// answer, and the answer is clearly the biggest.
export function generateTriangleRound(random = Math.random) {
  const drawnArea = ([a, b, c]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  for (let attempt = 0; attempt < 2000; attempt++) {
    const turn = 2 * Math.PI * random();
    const radii = shuffled([0.22, 0.48, 0.7], random).map((r) => r + 0.06 * (random() - 0.5));
    const triangles = radii.map((r, i) => {
      const middle = polar(r, turn + (i * 2 * Math.PI) / 3);
      const size = 0.15 * (0.85 + 0.3 * random());
      const tilt = 2 * Math.PI * random();
      return [0, 1, 2].map((k) => add(middle, polar(size, tilt + (k * 2 * Math.PI) / 3 + 0.3 * (random() - 0.5))));
    });
    if (triangles.flat().some((z) => abs(z) > 0.93)) continue;
    const looks = triangles.map(drawnArea);
    if (Math.max(...looks) > 1.3 * Math.min(...looks)) continue;
    const areas = triangles.map((corners) => triangle(...corners).area);
    const ranked = [0, 1, 2].sort((a, b) => areas[b] - areas[a]);
    const answer = ranked[0];
    if (areas[answer] < 1.25 * areas[ranked[1]]) continue;
    if (looks.indexOf(Math.max(...looks)) === answer) continue;
    return { triangles, areas, looks, answer };
  }
  throw new Error('Could not lay out a triangle round');
}

// A "where will you end up" round: the player, at the centre, will walk a
// square of the given side (up, right, down, left). Where they truly end is
// one of three places to choose from; another is where they started, which
// is where they would end on a flat plane.
export function generateSquareRound(random = Math.random) {
  const side = 1 + 0.3 * random();
  let view = IDENTITY;
  for (let leg = 0; leg < 4; leg++) view = compose(stride(Math.PI / 2 - (leg * Math.PI) / 2, side), view);
  const end = apply(invert(view), [0, 0]); // where the walk ends, in today's screen
  const options = shuffled([end, [0, 0], [-end[1], end[0]]], random);
  return { side, end, options, answer: options.indexOf(end), gap: distance(end, [0, 0]) };
}

// Moving things along geodesics, for the chamber's action games. A moving
// thing is a point z and a heading φ: the direction it is going at z, as an
// ordinary angle in the disk (Möbius maps keep angles, so that is enough).
//
// One step of length ds: slide z to the centre, where the geodesic is the
// straight diameter at angle φ, step along it, and slide back with
// M(w) = (w + z) / (1 + z̄w). The heading turns by the argument of
// M'(w) = (1 - |z|²) / (1 + z̄w)², which is -2 arg(1 + z̄w).
export function geodesicStep(z, heading, ds) {
  const w = polar(Math.tanh(ds / 2), heading);
  const back = invert(toCentre(z));
  const lean = add(ONE, mul(conj(z), w));
  return { z: apply(back, w), heading: heading - 2 * Math.atan2(lean[1], lean[0]) };
}

// The heading at p that points along the geodesic towards q.
export function headingTowards(p, q) {
  const v = apply(toCentre(p), q);
  return Math.atan2(v[1], v[0]);
}

// A step of length ds from z towards p, stopping at p.
export function stepTowards(z, p, ds) {
  const left = distance(z, p);
  if (left <= ds) return p;
  return geodesicStep(z, headingTowards(z, p), ds).z;
}

// The geodesic through a and b, as the circle that carries it (centre and
// radius, meeting the rim at right angles) or, through the centre, a line
// (a point on it and its direction).
export function geodesicCircle(a, b) {
  // Circles orthogonal to the rim through a pass through its inverse a/|a|²
  // too, so the circle is the one through a, b and a/|a|².
  const far = abs2(a) > 1e-12 ? scaleBy(a, 1 / abs2(a)) : null;
  const d = far && 2 * (a[0] * (b[1] - far[1]) + b[0] * (far[1] - a[1]) + far[0] * (a[1] - b[1]));
  if (!far || Math.abs(d) < 1e-9) return { line: true, through: a, direction: Math.atan2(b[1] - a[1], b[0] - a[0]) };
  const ux = (abs2(a) * (b[1] - far[1]) + abs2(b) * (far[1] - a[1]) + abs2(far) * (a[1] - b[1])) / d;
  const uy = (abs2(a) * (far[0] - b[0]) + abs2(b) * (a[0] - far[0]) + abs2(far) * (b[0] - a[0])) / d;
  return { centre: [ux, uy], radius: abs(sub(a, [ux, uy])) };
}

// Which side of a wall a point is on (the sign), for spotting a crossing.
export function wallSide(wall, z) {
  if (wall.line) {
    const [x, y] = sub(z, wall.through);
    return Math.cos(wall.direction) * y - Math.sin(wall.direction) * x;
  }
  return abs2(sub(z, wall.centre)) - wall.radius * wall.radius;
}

// The heading after bouncing off a wall at z: mirrored in the wall's tangent
// there, the angle of incidence equalling the angle of reflection.
export function bounce(wall, z, heading) {
  const tangent = wall.line
    ? wall.direction
    : Math.atan2(z[1] - wall.centre[1], z[0] - wall.centre[0]) + Math.PI / 2;
  return 2 * tangent - heading;
}
