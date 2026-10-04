import {
  abs,
  apply,
  arcThrough,
  bounce,
  compose,
  distance,
  geodesicCircle,
  geodesicStep,
  headingTowards,
  midpoint,
  normalized,
  polar,
  stepTowards,
  stride,
  wallSide,
} from './hyperbolic.js';

// The chamber's action games, each a short burst on the hyperbolic floor that
// scores 0 to 2 stars:
//   dash    run about for 15 seconds collecting crystals; quick catches
//           build a combo, and gold crystals are worth three.
//   swarm   survive 15 seconds while shadows chase you.
//   golf    putt a ball along a true straight line, which curves on screen,
//           into the hole in three shots.
//   bounce  fire a shot that bounces off the walls to reach the target.
//
// Each game is { prompt, markers(), segments(), draw(ctx, pixel), update(dt),
// pointer(type, point), key(type, key), done }, where done resolves to
// { stars, text }. Walking games keep the player at the centre and slide the
// world past (as the Lab does), so their positions are in world coordinates;
// golf and bounce leave the view still and work in screen coordinates, which
// are a Poincaré disk just as good.

export const ACTION_GAMES = ['dash', 'swarm', 'golf', 'bounce'];

const PLAYER_RADIUS = 0.16;
const WALK_SPEED = 2.2;
const GAME_S = 15;
const COMBO_S = 2.2; // catch another crystal this soon and the combo grows
const CRYSTAL_COLORS = ['#f2777a', '#35b394', '#8c70d8', '#f4b942', '#1fbfae'];
const KEYS = {
  ArrowUp: Math.PI / 2,
  w: Math.PI / 2,
  ArrowDown: -Math.PI / 2,
  s: -Math.PI / 2,
  ArrowLeft: Math.PI,
  a: Math.PI,
  ArrowRight: 0,
  d: 0,
};

const headingOfKey = (key) => KEYS[key.length === 1 ? key.toLowerCase() : key];
const seconds = (s) => `0:${String(Math.max(0, Math.ceil(s))).padStart(2, '0')}`;

export function createAction(kind, context) {
  const make = { dash, swarm, golf, bounce: bounceShot }[kind];
  return make(context);
}

// Walking for the player at the centre: keys held, or the floor held down.
function walker(disk) {
  const held = new Set();
  let pointer = null;
  return {
    pointer(type, point) {
      if (type === 'down' || (type === 'move' && pointer)) pointer = point;
      if (type === 'up') pointer = null;
    },
    key(type, key) {
      const heading = headingOfKey(key);
      if (heading === undefined) return false;
      if (type === 'down') held.add(heading);
      else held.delete(heading);
      return true;
    },
    // Moves the world so the player walks for dt seconds. If the world was
    // recentred on the way, calls carry with the symmetry applied, so the
    // game can move its own points along.
    step(dt, carry) {
      let heading = null;
      if (pointer && Math.hypot(...pointer) > 0.06) heading = Math.atan2(pointer[1], pointer[0]);
      else if (held.size) {
        let x = 0;
        let y = 0;
        for (const h of held) {
          x += Math.cos(h);
          y += Math.sin(h);
        }
        if (Math.hypot(x, y) > 1e-6) heading = Math.atan2(y, x);
      }
      if (heading === null) return false;
      disk.view = normalized(compose(stride(heading, WALK_SPEED * dt), disk.view));
      const moved = disk.recentre?.();
      if (moved) carry?.((z) => apply(moved, z));
      return true;
    },
    stop() {
      held.clear();
      pointer = null;
    },
  };
}

// A point `far` away from the player, in a random direction, in the world.
const around = (disk, far, random) => disk.toWorld(polar(Math.tanh(far / 2), 2 * Math.PI * random()));

// Draws the time left as a ring round the disk.
function timerRing(ctx, frame, left) {
  const { width, height, scale } = frame;
  ctx.strokeStyle = left < 5 ? 'rgba(209, 73, 91, 0.85)' : 'rgba(74, 63, 87, 0.55)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, scale + 9, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * (left / GAME_S));
  ctx.stroke();
}

function settle() {
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  return { done, finish };
}

// Crystal dash: grab crystals for fifteen seconds. Those near the rim look
// close but are far; the near ones are worth chasing. Catching one soon
// after another builds a combo worth up to three each, and a gold crystal
// is worth three on its own.
function dash({ disk, sound, status, random = Math.random }) {
  const { done, finish } = settle();
  const walk = walker(disk);
  const crystals = [];
  const floats = []; // points scored, rising and fading where they were won
  let left = GAME_S;
  let score = 0;
  let caught = 0;
  let combo = 0;
  let sinceCatch = Infinity;
  let over = false;
  const spawn = () => {
    const gold = random() < 0.2;
    crystals.push({
      at: around(disk, 0.7 + 1.9 * random(), random),
      gold,
      color: gold ? '#f4b942' : CRYSTAL_COLORS[crystals.length % 3],
    });
  };
  for (let i = 0; i < 8; i++) spawn();
  const hud = () => status(`Score ${score}${combo > 1 ? ` · combo ×${combo}` : ''} · ${seconds(left)} left`);
  hud();

  return {
    prompt: 'Crystal dash! Run with W A S D or hold the floor. Catch crystals quickly for a combo; gold ones are worth three. The ones near the rim are further than they look.',
    pointer: walk.pointer,
    key: walk.key,
    update(dt) {
      if (over) return;
      left -= dt;
      sinceCatch += dt;
      if (sinceCatch > COMBO_S) combo = 0;
      walk.step(dt, (move) => {
        for (const crystal of crystals) crystal.at = move(crystal.at);
        for (const float of floats) float.at = move(float.at);
      });
      const here = disk.toWorld([0, 0]);
      for (let i = crystals.length - 1; i >= 0; i--) {
        if (distance(here, crystals[i].at) > 0.36) continue;
        const [crystal] = crystals.splice(i, 1);
        combo = Math.min(3, combo + 1);
        sinceCatch = 0;
        caught++;
        const won = crystal.gold ? 3 : combo;
        score += won;
        floats.push({ at: crystal.at, text: `+${won}`, life: 0.8, gold: crystal.gold });
        sound?.place(combo + (crystal.gold ? 2 : 0));
        spawn();
      }
      for (let i = floats.length - 1; i >= 0; i--) if ((floats[i].life -= dt) <= 0) floats.splice(i, 1);
      hud();
      if (left <= 0) {
        over = true;
        walk.stop();
        finish({
          // A perfect chase scores about 85; aimless running, under 10.
          stars: score >= 32 ? 2 : score >= 14 ? 1 : 0,
          text: `${score} points from ${caught} crystal${caught === 1 ? '' : 's'}. The ones near the rim were never as close as they looked.`,
        });
      }
    },
    markers: () => [
      ...crystals.map(({ at, color, gold }) => ({ at, radius: gold ? 0.2 : 0.16, color, style: gold ? 'star' : 'gem' })),
      { at: disk.toWorld([0, 0]), radius: PLAYER_RADIUS, color: '#ffffff', style: 'player' },
    ],
    segments: () => [],
    draw(ctx, frame, pixel) {
      timerRing(ctx, frame, left);
      ctx.textAlign = 'center';
      ctx.font = '800 18px "Nunito Variable", system-ui, sans-serif';
      for (const { at, text, life, gold } of floats) {
        const [x, y] = pixel(disk.toScreen(at));
        ctx.globalAlpha = Math.min(1, life * 2.5);
        ctx.fillStyle = gold ? '#c98a00' : '#2f8a5b';
        ctx.fillText(text, x, y - 26 * (1 - life / 0.8) - 10);
      }
      ctx.globalAlpha = 1;
    },
    stop: walk.stop,
    done,
  };
}

// Escape the swarm: survive fifteen seconds while shadows close in, a little
// slower than you. Hyperbolic space opens up so fast that a few steps
// sideways leave a chaser far behind.
function swarm({ disk, sound, status, random = Math.random }) {
  const { done, finish } = settle();
  const walk = walker(disk);
  const shadows = [];
  let left = GAME_S;
  let hearts = 3;
  let nextSpawn = 0.5;
  let over = false;
  const hud = () => status(`${'♥'.repeat(hearts)}${'♡'.repeat(3 - hearts)} · ${seconds(left)} left`);
  hud();

  const end = () => {
    over = true;
    walk.stop();
    const stars = hearts === 3 ? 2 : hearts > 0 ? 1 : 0;
    finish({
      stars,
      text: hearts
        ? `You survived with ${hearts} heart${hearts === 1 ? '' : 's'} left. Space opens up so fast here that a few steps sideways leave a chaser far behind.`
        : 'Caught! Try running sideways to the chasers: here, space opens up fast.',
    });
  };

  return {
    prompt: 'Escape the swarm! Shadows are coming, a little slower than you. Run with W A S D or hold the floor, and stay away from them for 15 seconds.',
    pointer: walk.pointer,
    key: walk.key,
    update(dt) {
      if (over) return;
      left -= dt;
      nextSpawn -= dt;
      walk.step(dt, (move) => shadows.forEach((at, i) => (shadows[i] = move(at))));
      const here = disk.toWorld([0, 0]);
      if (nextSpawn <= 0 && shadows.length < 7) {
        shadows.push(around(disk, 2.4 + 0.4 * random(), random));
        nextSpawn = 1.5;
      }
      for (let i = shadows.length - 1; i >= 0; i--) {
        shadows[i] = stepTowards(shadows[i], here, 1.5 * dt);
        if (distance(shadows[i], here) < 0.3) {
          shadows.splice(i, 1);
          hearts--;
          sound?.error();
        }
      }
      hud();
      if (hearts <= 0 || left <= 0) end();
    },
    markers: () => [
      ...shadows.map((at) => ({ at, radius: 0.18, color: '#4a3f57', ring: '#2b2433', ringAlpha: 0.5 })),
      { at: disk.toWorld([0, 0]), radius: PLAYER_RADIUS, color: '#ffffff', style: 'player' },
    ],
    segments: () => [],
    draw(ctx, frame) {
      timerRing(ctx, frame, left);
    },
    stop: walk.stop,
    done,
  };
}

// Lays out a ball and a target out towards the rim, where geodesics bow
// enough to matter, at least `apart` from each other.
function teeAndHole(random, apart) {
  for (let attempt = 0; attempt < 500; attempt++) {
    const turn = 2 * Math.PI * random();
    const tee = polar(0.5 + 0.1 * random(), turn);
    const hole = polar(0.5 + 0.12 * random(), turn + (random() < 0.5 ? -1 : 1) * (1.7 + 0.6 * random()));
    const gap = distance(tee, hole);
    if (gap > apart[0] && gap < apart[1]) return { tee, hole };
  }
  return { tee: [-0.5, 0], hole: [0.5, 0] };
}

// Samples a geodesic path from z along heading, `length` long, for drawing.
function pathFrom(z, heading, length, step = 0.04, walls = []) {
  const points = [z];
  let here = { z, heading };
  for (let walked = 0; walked < length; walked += step) {
    const next = geodesicStep(here.z, here.heading, step);
    const hit = walls.find((wall) => crosses(wall, here.z, next.z));
    if (hit) {
      here = { z: here.z, heading: bounce(hit.wall, here.z, here.heading) };
      continue;
    }
    here = next;
    if (abs(here.z) > 0.985) break;
    points.push(here.z);
  }
  return points;
}

// Whether moving from a to b crosses a wall (a whole circle, or a geodesic
// segment between two ends).
function crosses(wall, a, b) {
  if (Math.sign(wallSide(wall.wall, a)) === Math.sign(wallSide(wall.wall, b))) return false;
  if (!wall.ends) return true;
  const [p, q] = wall.ends;
  const span = distance(p, q);
  return distance(p, b) < span && distance(q, b) < span;
}

function strokePoints(ctx, points, pixel) {
  ctx.beginPath();
  points.forEach((z, i) => {
    const [x, y] = pixel(z);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  });
  ctx.stroke();
}

// Geodesic golf: drag back from the ball and let go to putt. The ball rolls
// along a true straight line, which on screen bows towards the centre, so
// aiming straight at the hole misses.
function golf({ disk, sound, status, random = Math.random }) {
  const { done, finish } = settle();
  const { tee, hole } = teeAndHole(random, [1.8, 3.4]);
  const HOLE = 0.2;
  let ball = tee;
  let shots = 0;
  let aim = null; // the pointer while dragging, in screen coordinates
  let roll = null; // { heading, length, walked, z }
  let trail = [];
  let over = false;
  const hud = () => status(`Shot ${Math.min(shots + 1, 3)} of 3`);
  hud();

  // Pulling back from the ball sets the heading (the other way) and the power.
  const shotFrom = (point) => {
    const pull = distance(ball, point);
    return { heading: headingTowards(ball, point) + Math.PI, length: Math.min(5, Math.max(0.5, pull * 1.8)) };
  };

  const end = (sunk) => {
    over = true;
    const stars = sunk ? (shots === 1 ? 2 : 1) : 0;
    finish({
      stars,
      text: sunk
        ? `In the hole in ${shots}! The straight line to it bows towards the centre, so aiming "straight" on screen misses.`
        : 'Out of shots. The straight line to the hole bows towards the centre: aim a little inward of it.',
    });
  };

  return {
    prompt: 'Geodesic golf! Drag back from the white ball and let go to putt it into the dark hole. It rolls along a true straight line, which curves on screen. Three shots.',
    pointer(type, point) {
      if (over || roll) return;
      if (type === 'down') aim = point;
      else if (type === 'move' && aim) aim = point;
      else if (type === 'up' && aim) {
        // Where the pointer is let go is what counts, even with no moves between.
        const shot = shotFrom(point);
        aim = null;
        if (distance(ball, point) < 0.08) return;
        shots++;
        roll = { ...shot, walked: 0, z: ball, start: ball };
        trail = [ball];
        sound?.pick();
      }
    },
    key: () => false,
    update(dt) {
      if (!roll || over) return;
      // Rolls fast, then slows to a stop.
      const left = roll.length - roll.walked;
      const ds = Math.min(left, Math.max(0.6, 3.2 * left) * dt);
      const steps = Math.ceil(ds / 0.02);
      for (let i = 0; i < steps; i++) {
        const next = geodesicStep(roll.z, roll.heading, ds / steps);
        roll.z = next.z;
        roll.heading = next.heading;
        roll.walked += ds / steps;
        trail.push(roll.z);
        if (distance(roll.z, hole) < HOLE) {
          ball = hole;
          roll = null;
          sound?.right();
          return end(true);
        }
        if (abs(roll.z) > 0.96) {
          // Off the green: back to where it was hit from.
          ball = roll.start;
          roll = null;
          sound?.error();
          hud();
          if (shots >= 3) end(false);
          return;
        }
      }
      ball = roll.z;
      if (roll.walked >= roll.length - 1e-9) {
        roll = null;
        hud();
        if (shots >= 3) end(false);
      }
    },
    markers: () => [
      { at: disk.toWorld(hole), radius: HOLE, color: '#2f2838', ring: '#f4b942', ringAlpha: 0.9 },
      { at: disk.toWorld(ball), radius: 0.15, color: '#ffffff', style: 'player' },
    ],
    segments: () => [],
    draw(ctx, frame, pixel) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (trail.length > 1) {
        ctx.strokeStyle = 'rgba(43, 108, 138, 0.6)';
        ctx.lineWidth = 3;
        strokePoints(ctx, trail, pixel);
      }
      if (aim) {
        const shot = shotFrom(aim);
        // The pull, and the first stretch of the roll it would give.
        ctx.strokeStyle = 'rgba(74, 63, 87, 0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 5]);
        strokePoints(ctx, [ball, aim], pixel);
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(255, 138, 0, 0.9)';
        ctx.lineWidth = 4;
        strokePoints(ctx, pathFrom(ball, shot.heading, Math.min(shot.length, 0.9)), pixel);
      }
    },
    stop: () => (aim = null),
    done,
  };
}

// Bounce shot: a wall stands between the ball and the target. Aim and fire;
// the shot travels along geodesics and bounces off the round arena wall and
// the barrier, angle in equalling angle out. Three shots.
function bounceShot({ disk, sound, status, random = Math.random }) {
  const { done, finish } = settle();
  const ARENA = Math.tanh(2.2 / 2); // a hyperbolic circle of radius 2.2 round the centre
  const TARGET = 0.2;
  const SHOT_LENGTH = 9;
  const turn = 2 * Math.PI * random();
  const start = polar(0.5, turn + Math.PI);
  const target = polar(0.5, turn);
  // The barrier: a geodesic across the middle, open at one end.
  const side = random() < 0.5 ? 1 : -1;
  const barrierEnds = [polar(ARENA - 0.005, turn + side * (Math.PI / 2)), polar(0.12 + 0.2 * random(), turn - side * (Math.PI / 2))];
  const walls = [
    { wall: { centre: [0, 0], radius: ARENA } },
    { wall: geodesicCircle(...barrierEnds), ends: barrierEnds },
  ];
  const barrier = arcThrough(barrierEnds[0], midpoint(...barrierEnds), barrierEnds[1]);
  const ring = Array.from({ length: 97 }, (_, i) => polar(ARENA, (i * 2 * Math.PI) / 96));
  let shots = 0;
  let aim = null;
  let flight = null; // { z, heading, walked }
  let trail = [];
  let over = false;
  const hud = () => status(`Shot ${Math.min(shots + 1, 3)} of 3`);
  hud();

  const end = (hit) => {
    over = true;
    finish({
      stars: hit ? (shots === 1 ? 2 : 1) : 0,
      text: hit
        ? `Hit in ${shots}! Every bounce mirrors the angle, but between bounces the shot follows geodesics, so its path curves on screen.`
        : 'Out of shots. Use the guide line: it shows the true path, bounces and all.',
    });
  };

  return {
    prompt: 'Bounce shot! A wall blocks the way. Drag to aim from the white ball and let go to fire: the shot bounces off the walls. Hit the gold target in three shots.',
    pointer(type, point) {
      if (over || flight) return;
      if (type === 'down' || (type === 'move' && aim)) aim = point;
      else if (type === 'up' && aim) {
        aim = null;
        if (distance(start, point) < 0.05) return;
        shots++;
        flight = { z: start, heading: headingTowards(start, point), walked: 0 };
        trail = [start];
        sound?.pick();
      }
    },
    key: () => false,
    update(dt) {
      if (!flight || over) return;
      const ds = 4.5 * dt;
      const steps = Math.ceil(ds / 0.02);
      for (let i = 0; i < steps; i++) {
        const next = geodesicStep(flight.z, flight.heading, ds / steps);
        const hit = walls.find((wall) => crosses(wall, flight.z, next.z));
        if (hit) {
          flight.heading = bounce(hit.wall, flight.z, flight.heading);
          sound?.place(1);
          continue;
        }
        flight.z = next.z;
        flight.heading = next.heading;
        flight.walked += ds / steps;
        trail.push(flight.z);
        if (distance(flight.z, target) < TARGET) {
          flight = null;
          sound?.right();
          return end(true);
        }
      }
      if (flight.walked >= SHOT_LENGTH) {
        flight = null;
        hud();
        if (shots >= 3) end(false);
      }
    },
    markers: () => [
      { at: disk.toWorld(target), radius: TARGET, color: '#f4b942' },
      { at: disk.toWorld(flight?.z ?? start), radius: 0.11, color: '#ffffff', style: 'player' },
    ],
    segments: () => [],
    draw(ctx, frame, pixel) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(74, 63, 87, 0.75)';
      ctx.lineWidth = 4;
      strokePoints(ctx, ring, pixel);
      ctx.lineWidth = 7;
      strokePoints(ctx, barrier, pixel);
      if (trail.length > 1) {
        ctx.strokeStyle = 'rgba(43, 108, 138, 0.6)';
        ctx.lineWidth = 3;
        strokePoints(ctx, trail, pixel);
      }
      if (aim) {
        ctx.strokeStyle = 'rgba(255, 138, 0, 0.9)';
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 6]);
        strokePoints(ctx, pathFrom(start, headingTowards(start, aim), 3.2, 0.04, walls), pixel);
        ctx.setLineDash([]);
      }
    },
    stop: () => (aim = null),
    done,
  };
}
