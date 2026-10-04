import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  abs,
  apply,
  compose,
  distance,
  generateRound,
  rotation,
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
