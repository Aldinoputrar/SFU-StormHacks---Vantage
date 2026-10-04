import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  IDENTITY,
  abs,
  apply,
  compose,
  distance,
  drawnRadius,
  generateRound,
  radiusDrawnAs,
  polar,
  rotation,
  stride,
  triangle,
  turnAtCentre,
  sub,
  tilingMirror,
  toCentre,
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
