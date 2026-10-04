import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAction } from '../src/arcade.js';
import { IDENTITY, apply, distance, headingTowards, invert, polar } from '../src/hyperbolic.js';
import { mulberry32 } from '../src/random.js';

// Just enough of the disk renderer for the games: a view and its maps.
function fakeDisk() {
  return {
    view: IDENTITY,
    toScreen(z) {
      return apply(this.view, z);
    },
    toWorld(z) {
      return apply(invert(this.view), z);
    },
  };
}

// Runs a game for up to `seconds`, calling `each` before every frame.
async function run(game, seconds, each = () => {}) {
  let result = null;
  game.done.then((r) => (result = r));
  for (let t = 0; t < seconds && !result; t += 1 / 30) {
    each(t);
    game.update(1 / 30);
    await null;
  }
  await null;
  return result;
}

const setup = (kind, seed) => {
  const disk = fakeDisk();
  const game = createAction(kind, { disk, sound: null, status: () => {}, random: mulberry32(seed) });
  return { disk, game };
};

test('crystal dash: walking to the nearest crystal again and again collects plenty', async () => {
  const { disk, game } = setup('dash', 1);
  const result = await run(game, 25, () => {
    const here = disk.toWorld([0, 0]);
    const crystals = game.markers().slice(0, -1).map(({ at }) => at);
    const nearest = crystals.reduce((a, b) => (distance(here, a) < distance(here, b) ? a : b));
    const seen = disk.toScreen(nearest);
    game.pointer('down', [seen[0] * 0.5, seen[1] * 0.5]);
  });
  assert.ok(result, 'the game ends after twenty seconds');
  assert.equal(result.stars, 2, result.text);
});

test('crystal dash: standing still scores nothing', async () => {
  const { game } = setup('dash', 2);
  const result = await run(game, 25);
  assert.equal(result.stars, 0);
});

test('escape the swarm: standing still gets you caught; running keeps you safe for a while', async () => {
  const still = await run(setup('swarm', 3).game, 25);
  assert.equal(still.stars, 0, still.text);
  const { disk, game } = setup('swarm', 3);
  const result = await run(game, 25, () => {
    // Run directly away from the nearest shadow, veering sideways.
    const here = disk.toWorld([0, 0]);
    const shadows = game.markers().slice(0, -1).map(({ at }) => at);
    if (!shadows.length) return game.key('up', 'w');
    const nearest = shadows.reduce((a, b) => (distance(here, a) < distance(here, b) ? a : b));
    const seen = disk.toScreen(nearest);
    const away = Math.atan2(seen[1], seen[0]) + Math.PI - 0.6;
    game.pointer('down', polar(0.5, away));
  });
  assert.ok(result.stars >= 1, result.text);
});

test('geodesic golf: aiming along the true geodesic sinks it; aiming straight on screen can miss', async () => {
  let sunk = 0;
  for (let seed = 0; seed < 10; seed++) {
    const { disk, game } = setup('golf', seed);
    const [hole, ball] = game.markers().map(({ at }) => disk.toScreen(at));
    // Pull back exactly away from the hole along the geodesic, hard enough
    // to roll a little past it (power is 1.8 times the pull).
    const back = headingTowards(ball, hole) + Math.PI;
    const pull = polar(Math.tanh((distance(ball, hole) + 0.4) / 1.8 / 2), back);
    const from = apply(invert([[1, 0], [-ball[0], -ball[1]], [-ball[0], ball[1]], [1, 0]]), pull);
    game.pointer('down', from);
    game.pointer('up', from);
    const result = await run(game, 6);
    if (result?.stars === 2) sunk++;
  }
  assert.ok(sunk >= 8, `sank ${sunk} of 10 first-shot putts along the geodesic`);
});

test('bounce shot: some aim always reaches the target', async () => {
  for (let seed = 0; seed < 6; seed++) {
    let hit = false;
    for (let a = 0; a < 2 * Math.PI && !hit; a += Math.PI / 90) {
      const { disk, game } = setup('bounce', seed);
      const ball = disk.toScreen(game.markers()[1].at);
      const aim = [ball[0] + 0.1 * Math.cos(a), ball[1] + 0.1 * Math.sin(a)];
      game.pointer('down', aim);
      game.pointer('up', aim);
      const result = await run(game, 4);
      hit = result?.stars === 2;
    }
    assert.ok(hit, `no winning shot for seed ${seed}`);
  }
});

test('geodesic golf: aiming straight at the hole on screen misses', async () => {
  let missed = 0;
  for (let seed = 0; seed < 10; seed++) {
    const { disk, game } = setup('golf', seed);
    const [hole, ball] = game.markers().map(({ at }) => disk.toScreen(at));
    // Pull back along the screen's straight line through the hole and ball,
    // as hard as the true shot would need.
    const away = [ball[0] - hole[0], ball[1] - hole[1]];
    const unit = Math.hypot(...away);
    const want = (distance(ball, hole) + 0.4) / 1.8;
    let reach = 0.01;
    while (distance(ball, [ball[0] + (away[0] / unit) * reach, ball[1] + (away[1] / unit) * reach]) < want) reach += 0.002;
    const from = [ball[0] + (away[0] / unit) * reach, ball[1] + (away[1] / unit) * reach];
    game.pointer('down', from);
    game.pointer('up', from);
    const result = await run(game, 6);
    if (result?.stars !== 2) missed++;
  }
  assert.ok(missed >= 8, `the naive aim missed only ${missed} of 10`);
});
