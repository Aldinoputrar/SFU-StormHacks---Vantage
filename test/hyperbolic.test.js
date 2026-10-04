import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FLAT,
  HYPERBOLIC,
  IDENTITY,
  SPHERICAL,
  abs,
  abs2,
  arcThrough,
  bounce,
  apply,
  compose,
  distance,
  drawnRadius,
  generateRound,
  geodesicCircle,
  geodesicStep,
  headingTowards,
  generateStraightRound,
  generateSquareRound,
  generateTriangleRound,
  midpoint,
  radiusDrawnAs,
  polar,
  radiusAt,
  rotation,
  stepTowards,
  stride,
  triangle,
  turnAtCentre,
  sub,
  tilingMirror,
  toCentre,
  wallSide,
  walk,
} from '../src/hyperbolic.js';
import { mulberry32 } from '../src/random.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('distance from the centre is 2 artanh(r)', () => {
  close(distance([0, 0], [0.5, 0]), 2 * Math.atanh(0.5));
  close(distance([0, 0], [0, -0.9]), 2 * Math.atanh(0.9));
});

test('points near the rim are much farther than they look', () => {
  // Both 0.1 apart on screen, but the pair near the rim is far apart.
  assert.ok(distance([0.85, 0], [0.95, 0]) > 4 * distance([0, 0], [0.1, 0]));
});

test('isometries of the disk keep distances', () => {
  const random = mulberry32(7);
  const point = () => [random() * 1.2 - 0.6, random() * 1.2 - 0.6];
  for (let i = 0; i < 20; i++) {
    const move = compose(toCentre(point()), rotation(random() * 6));
    const [p, q] = [point(), point()];
    close(distance(apply(move, p), apply(move, q)), distance(p, q), 1e-8);
  }
});

test('walking carries the target exactly onto the player', () => {
  const player = [0.4, -0.2];
  const crystal = [0.1, 0.35];
  close(abs(sub(apply(walk(player, crystal, 1), crystal), player)), 0, 1e-12);
  close(distance(player, apply(walk(player, crystal, 0.5), crystal)), distance(player, crystal) / 2, 1e-9);
});

test('the tiling mirror meets the rim at right angles', () => {
  const { centre, radius } = tilingMirror(6, 4);
  close(centre, Math.SQRT2);
  close(radius, 1);
  const other = tilingMirror(5, 4);
  close(other.centre ** 2, 1 + other.radius ** 2);
});

test('rounds have a clear answer the eye cannot spot', () => {
  const random = mulberry32(42);
  for (let i = 0; i < 200; i++) {
    const { player, crystals, distances, answer } = generateRound(random);
    const looks = crystals.map((z) => abs(sub(z, player)));
    assert.ok(Math.max(...looks) / Math.min(...looks) < 1.2, 'crystals look about equally far');
    assert.equal(answer, distances.indexOf(Math.min(...distances)));
    assert.notEqual(looks.indexOf(Math.min(...looks)), answer);
    for (const k of [0, 1, 2]) if (k !== answer) assert.ok(distances[k] >= 1.2 * distances[answer]);
    assert.ok(crystals.every((z) => abs(z) <= 0.93));
  }
});

test('a round can keep the player where they stand', () => {
  const round = generateRound(mulberry32(3), [0.45, 0.1]);
  assert.deepEqual(round.player, [0.45, 0.1]);
});

test('a crystal is drawn at the size radiusDrawnAs asks for', () => {
  for (const r of [0, 0.3, 0.6, 0.85]) close(drawnRadius(r, radiusDrawnAs(r, 0.065)), 0.065);
});

test('the biggest-looking crystal is not a reliable guide to the answer', () => {
  const random = mulberry32(7);
  let biggest = 0;
  const rounds = 600;
  for (let i = 0; i < rounds; i++) {
    const { crystals, radii, answer } = generateRound(random);
    const looks = crystals.map((z, k) => drawnRadius(abs(z), radii[k]));
    if (looks.indexOf(Math.max(...looks)) === answer) biggest++;
  }
  assert.ok(biggest / rounds < 0.45, `biggest crystal was the answer ${biggest} of ${rounds} times`);
});

test('a tile of the {3, 8} floor is a triangle with three 45° angles', () => {
  // Corners of the central tile: cosh R = cot(π/3) cot(π/8).
  const R = Math.acosh(1 / Math.tan(Math.PI / 3) / Math.tan(Math.PI / 8));
  const corners = [Math.PI / 3, Math.PI, -Math.PI / 3].map((angle) => polar(Math.tanh(R / 2), angle));
  const { angles, area } = triangle(...corners);
  for (const angle of angles) close(angle, Math.PI / 4, 1e-9);
  close(area, Math.PI / 4, 1e-9);
});

test('triangles add up to less than 180°, and tiny ones to almost exactly 180°', () => {
  const random = mulberry32(11);
  for (let i = 0; i < 100; i++) {
    const corners = [0, 1, 2].map(() => polar(0.9 * random(), 2 * Math.PI * random()));
    const { sum, area } = triangle(...corners);
    assert.ok(sum < Math.PI + 1e-9);
    assert.ok(area > -1e-9);
  }
  const tiny = triangle([0.001, 0], [0, 0.001], [-0.001, -0.0005]);
  close(tiny.sum, Math.PI, 1e-5);
});

test('walking a square does not bring you home', () => {
  // Four equal legs with right-angle turns, all pure translations.
  let view = IDENTITY;
  for (let leg = 0; leg < 4; leg++) view = compose(stride((leg * Math.PI) / 2, 1.5), view);
  const home = apply(view, [0, 0]); // where the starting point is now, seen from the player
  assert.ok(distance(home, [0, 0]) > 0.5, `ended ${distance(home, [0, 0])} from home`);

  // In a tiny square, almost flat, you do get home.
  view = IDENTITY;
  for (let leg = 0; leg < 4; leg++) view = compose(stride((leg * Math.PI) / 2, 0.001), view);
  assert.ok(distance(apply(view, [0, 0]), [0, 0]) < 1e-5);
});

test('walking round a closed loop turns you by the area it encloses', () => {
  // Out along one diameter, round an arc and back: a triangle with corners
  // at home, A and B. Steps are short so the path follows the triangle.
  const A = polar(Math.tanh(1.2 / 2), 0);
  const B = polar(Math.tanh(1.2 / 2), 1.1);
  let view = IDENTITY;
  const walkTo = (target) => {
    for (let k = 0; k < 400; k++) {
      const here = apply(view, target); // the target, seen from the player
      const left = distance([0, 0], here);
      if (left < 1e-9) break;
      view = compose(stride(Math.atan2(here[1], here[0]), Math.min(left, 0.05)), view);
    }
  };
  walkTo(A);
  walkTo(B);
  walkTo([0, 0]);
  const { area } = triangle([0, 0], A, B);
  close(Math.abs(turnAtCentre(view)), area, 1e-6);
});

test('on the sphere, distance from the centre is 2 arctan(r) and the equator is a quarter turn away', () => {
  close(distance([0, 0], [0.4, 0], SPHERICAL), 2 * Math.atan(0.4));
  close(distance([0, 0], [1, 0], SPHERICAL), Math.PI / 2);
  close(distance([0.3, 0.2], [-0.5, 0.6], SPHERICAL), distance([0, 0], apply(toCentre([0.3, 0.2], SPHERICAL), [-0.5, 0.6]), SPHERICAL));
});

test('a triangle on the sphere with three right angles covers an eighth of it', () => {
  // The pole and two points on the equator a quarter turn apart.
  const { angles, sum, area } = triangle([0, 0], [1, 0], [0, 1], SPHERICAL);
  for (const angle of angles) close(angle, Math.PI / 2);
  close(sum, (3 * Math.PI) / 2);
  close(area, (4 * Math.PI) / 8);
});

test('flat triangles add up to exactly 180°', () => {
  const random = mulberry32(5);
  for (let i = 0; i < 50; i++) {
    const corners = [0, 1, 2].map(() => polar(random(), 2 * Math.PI * random()));
    close(triangle(...corners, FLAT).sum, Math.PI);
  }
  // A right triangle with legs 1 and 1 (0.5 in z, since lengths are doubled).
  close(triangle([0, 0], [0.5, 0], [0, 0.5], FLAT).area, 0.5);
});

test('each geometry tiles with triangles whose corners add to 180°, more, or less', () => {
  const corners = (q, K) => {
    // Corner distance R of a {3, q} tile: cosh R or cos R = cot(π/3) cot(π/q).
    const c = 1 / Math.tan(Math.PI / 3) / Math.tan(Math.PI / q);
    const R = K < 0 ? Math.acosh(c) : Math.acos(c);
    const r = K < 0 ? Math.tanh(R / 2) : Math.tan(R / 2);
    return [Math.PI / 3, Math.PI, -Math.PI / 3].map((angle) => polar(r, angle));
  };
  for (const [q, K] of [
    [8, HYPERBOLIC],
    [4, SPHERICAL],
  ]) {
    const { angles } = triangle(...corners(q, K), K);
    for (const angle of angles) close(angle, (2 * Math.PI) / q, 1e-9);
  }
  // The sphere's mirror circle passes through antipodal points of the equator.
  const { centre, radius } = tilingMirror(3, 4, SPHERICAL);
  close(radius ** 2, 1 + centre ** 2);
});

test('a square closes in flat space, and fails on the sphere and the hyperbolic plane', () => {
  const gap = (K) => {
    let view = IDENTITY;
    for (let leg = 0; leg < 4; leg++) view = compose(stride((leg * Math.PI) / 2, 1, K), view);
    return distance(apply(view, [0, 0]), [0, 0], K);
  };
  assert.ok(gap(FLAT) < 1e-9);
  assert.ok(gap(SPHERICAL) > 0.2, `sphere ${gap(SPHERICAL)}`);
  assert.ok(gap(HYPERBOLIC) > 0.2, `hyperbolic ${gap(HYPERBOLIC)}`);
});

test('walking a loop turns you by its area: one way on the sphere, the other on the hyperbolic plane, not at all when flat', () => {
  const loopTurn = (K) => {
    const A = polar(radiusAt(1, K), 0);
    const B = polar(radiusAt(1, K), 1.2);
    let view = IDENTITY;
    const walkTo = (target) => {
      for (let k = 0; k < 400; k++) {
        const here = apply(view, target);
        const left = distance([0, 0], here, K);
        if (left < 1e-9) break;
        view = compose(stride(Math.atan2(here[1], here[0]), Math.min(left, 0.05), K), view);
      }
    };
    walkTo(A);
    walkTo(B);
    walkTo([0, 0]);
    return { turn: turnAtCentre(view), area: triangle([0, 0], A, B, K).area };
  };
  // An anticlockwise loop turns the walker's frame anticlockwise by the area
  // on the sphere and clockwise on the hyperbolic plane, so the world seen on
  // screen turns the other way.
  const sphere = loopTurn(SPHERICAL);
  const hyperbolic = loopTurn(HYPERBOLIC);
  close(sphere.turn, -sphere.area, 1e-6);
  close(hyperbolic.turn, hyperbolic.area, 1e-6);
  close(loopTurn(FLAT).turn, 0, 1e-9);
});

test('the midpoint of a geodesic is equally far from both ends', () => {
  for (const K of [HYPERBOLIC, FLAT, SPHERICAL]) {
    const p = [0.3, -0.2];
    const q = [-0.4, 0.5];
    const m = midpoint(p, q, K);
    close(distance(p, m, K), distance(m, q, K), 1e-9);
    close(distance(p, m, K) * 2, distance(p, q, K), 1e-9);
  }
});

test('an arc through three points passes through all three', () => {
  const points = arcThrough([0.1, 0.2], [0.3, 0.5], [0.6, 0.1], 64);
  close(points[0][0], 0.1);
  close(points.at(-1)[1], 0.1);
  assert.ok(points.some((z) => Math.hypot(z[0] - 0.3, z[1] - 0.5) < 0.02));
  const straight = arcThrough([0, 0], [0.5, 0.5], [1, 1], 4);
  close(straight[2][0], 0.5);
});

test('in a straight-line round the geodesic is the shortest path and really is a geodesic', () => {
  const random = mulberry32(21);
  for (let i = 0; i < 100; i++) {
    const { player, target, paths, lengths, kinds, answer } = generateStraightRound(random);
    assert.equal(kinds[answer], 'geodesic');
    for (let k = 0; k < 3; k++) if (k !== answer) assert.ok(lengths[k] > lengths[answer] + 1e-3, `${kinds[k]} not longer`);
    const whole = distance(player, target);
    close(lengths[answer], whole, 1e-3);
    for (const z of paths[answer]) close(distance(player, z) + distance(z, target), whole, 1e-6);
    assert.ok(kinds.includes('segment'));
  }
});

test('in a triangle round the biggest triangle does not look biggest', () => {
  const random = mulberry32(31);
  for (let i = 0; i < 60; i++) {
    const { triangles, areas, looks, answer } = generateTriangleRound(random);
    assert.equal(areas.indexOf(Math.max(...areas)), answer);
    assert.notEqual(looks.indexOf(Math.max(...looks)), answer);
    assert.ok(Math.max(...looks) <= 1.3 * Math.min(...looks));
    assert.ok(triangles.flat().every((z) => abs(z) <= 0.93));
  }
});

test('a square walk from the centre ends where the round says, and not back at the start', () => {
  const random = mulberry32(8);
  for (let i = 0; i < 30; i++) {
    const { side, end, options, answer, gap } = generateSquareRound(random);
    assert.equal(options[answer], end);
    assert.ok(options.some((z) => abs(z) < 1e-12), 'the flat answer is offered');
    assert.ok(gap > 0.5);
    // Walking it for real: the end point arrives at the centre.
    let view = IDENTITY;
    for (let leg = 0; leg < 4; leg++) view = compose(stride(Math.PI / 2 - (leg * Math.PI) / 2, side), view);
    close(abs(apply(view, end)), 0, 1e-9);
  }
});

test('many short geodesic steps land where one long one does, along the same line', () => {
  const start = [0.4, -0.3];
  const heading = 2.1;
  let z = start;
  let h = heading;
  for (let i = 0; i < 200; i++) ({ z, heading: h } = geodesicStep(z, h, 0.01));
  const once = geodesicStep(start, heading, 2);
  close(z[0], once.z[0], 1e-9);
  close(z[1], once.z[1], 1e-9);
  close(distance(start, z), 2, 1e-9);
  close(Math.cos(h - once.heading), 1, 1e-9);
});

test('heading towards a point and stepping gets there', () => {
  const p = [0.5, 0.2];
  const q = [-0.3, 0.6];
  const { z } = geodesicStep(p, headingTowards(p, q), distance(p, q));
  close(distance(z, q), 0, 1e-9);
  let chaser = [0.6, -0.5];
  for (let i = 0; i < 400; i++) chaser = stepTowards(chaser, q, 0.05);
  close(distance(chaser, q), 0, 1e-12);
});

test('a wall through two points is a geodesic, and bouncing mirrors the heading in it', () => {
  const a = [0.3, 0.4];
  const b = [-0.5, 0.2];
  const wall = geodesicCircle(a, b);
  close(wallSide(wall, a), 0, 1e-9);
  close(wallSide(wall, b), 0, 1e-9);
  close(abs2(wall.centre), 1 + wall.radius ** 2, 1e-9); // meets the rim at right angles
  close(wallSide(wall, midpoint(a, b)), 0, 1e-9); // the midpoint lies on it too
  // Bouncing twice gives back the heading; head-on bounces reverse it.
  const h = 0.7;
  close(Math.cos(bounce(wall, a, bounce(wall, a, h)) - h), 1, 1e-12);
  const across = Math.atan2(a[1] - wall.centre[1], a[0] - wall.centre[0]);
  close(Math.cos(bounce(wall, a, across) - (across + Math.PI)), 1, 1e-12);
  const line = geodesicCircle([0.2, 0.2], [-0.4, -0.4]);
  assert.ok(line.line);
});
