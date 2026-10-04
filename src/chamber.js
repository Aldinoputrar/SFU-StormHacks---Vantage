import { ACTION_GAMES, createAction } from './arcade.js';
import { createDisk } from './disk.js';
import {
  CRYSTAL_LOOK,
  IDENTITY,
  abs,
  compose,
  distance,
  generateRound,
  generateSquareRound,
  generateStraightRound,
  generateTriangleRound,
  normalized,
  polar,
  radiusDrawnAs,
  rotation,
  stride,
  triangle,
  walk,
} from './hyperbolic.js';
import { shuffled } from './random.js';

// The Hyperbolic Chamber: a short minigame played before each turn to earn
// letters, in a Poincaré disk. Every tile of the triangle tiling is the same
// size in hyperbolic terms, so tiles shrink towards the rim and counting them
// is a fair way to judge distance. Four kinds of round:
//   closest   three crystals look about equally far away and equally big;
//             only one is truly the closest.
//   straight  three paths lead to a crystal; only one is the geodesic, and it
//             is not the one that looks straight.
//   triangle  three triangles look the same size; the one nearest the rim
//             holds far more.
//   square    you will walk a square: where do you end up? Not where you
//             started.
// Each visit is two rounds: an action game from arcade.js (dash, swarm,
// golf or bounce: up to two stars) and then one of those quizzes (one more
// star), so a perfect visit scores three. The first visit is always the
// crystal dash and then the closest crystal. After a closest-crystal quiz,
// its three crystals mark a triangle whose angles add up to less than 180°.

const FIRST_VISIT = ['dash', 'closest'];
const QUIZZES = ['closest', 'straight', 'triangle', 'square'];
const ROUNDS = FIRST_VISIT.length;
const BEST = 3; // two stars from the action game, one from the quiz
const LEG_MS = 650; // each side of the square walk
const TARGET_COLOR = '#f4b942';
const PLAYER_RADIUS = 0.16; // hyperbolic
const WALK_MS = 1300;
const SPIN_MS = 700;
const CRYSTALS = [
  { name: 'A', color: '#f2777a' },
  { name: 'B', color: '#35b394' },
  { name: 'C', color: '#8c70d8' },
];
const TRIANGLE_INK = '#4a3f57';
const SKIP = Symbol('skip');

// The middle of three points.
const middle = (points) => [0, 1].map((k) => (points[0][k] + points[1][k] + points[2][k]) / 3);

// Pixel distance from point p to the segment from a to b.
function toSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ease = (t) => 1 - (1 - t) ** 3;
const fixed = (d) => d.toFixed(1);
const lengthText = (d) => d.toFixed(2);
const degrees = (radians) => Math.round((radians * 180) / Math.PI);

export function createChamber({ sound } = {}) {
  const root = $('chamber');
  const canvas = $('chamber-canvas');
  const overlay = $('chamber-paths');
  const labels = $('chamber-labels');
  const prompt = $('chamber-prompt');
  const result = $('chamber-result');
  const button = $('chamber-go');
  const skipButton = $('chamber-skip');
  const roundText = $('chamber-round');

  let disk = null;
  let player = null; // the player's world position
  // closest: { kind, crystals (world), radii, distances, answer, goal, pick, revealed }
  // straight: { kind, target (world), paths (world), lengths, kinds, answer, goal, pick, revealed }
  let round = null;
  let reveal = 0; // 0..1: how much of the geodesics to show
  let lesson = null; // the triangle shown after the last round
  let animation = null;
  let onPick = null;
  let kinds = FIRST_VISIT; // this visit's rounds
  let visits = 0;
  let lastAction = null;
  let action = null; // the action game being played, if any

  function setup() {
    disk = createDisk(canvas);
    let last = 0;
    disk.setAnimationLoop((time) => {
      if (root.hidden) return;
      const dt = Math.min(0.1, (time - (last || time)) / 1000);
      last = time;
      animation?.(performance.now());
      action?.update(dt);
      draw();
      disk.render();
    });
    // Action games get every pointer and key; quizzes get a pick.
    for (const type of ['down', 'move', 'up', 'cancel']) {
      canvas.addEventListener(`pointer${type}`, (event) => {
        if (!action) return;
        if (type === 'down') canvas.setPointerCapture(event.pointerId);
        action.pointer(type === 'cancel' ? 'up' : type, disk.pointAt(event));
        event.preventDefault();
      });
    }
    canvas.addEventListener('pointerup', (event) => {
      if (action || !round) return;
      onPick?.(round.kind === 'straight' ? pathAt(event) : round.kind === 'triangle' ? triangleAt(event) : crystalAt(event));
    });
    window.addEventListener('keydown', (event) => {
      if (root.hidden) return;
      if (action) {
        if (action.key('down', event.key)) event.preventDefault();
        return;
      }
      if (!onPick) return;
      const index = ['1', '2', '3'].indexOf(event.key) + 1 || ['a', 'b', 'c'].indexOf(event.key.toLowerCase()) + 1;
      if (index) onPick(index - 1);
    });
    window.addEventListener('keyup', (event) => action?.key('up', event.key));
    window.addEventListener('blur', () => action?.stop());
    window.addEventListener('resize', () => !root.hidden && resize());
  }

  function resize() {
    disk.resize();
    const box = overlay.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio, 2);
    overlay.width = box.width * ratio;
    overlay.height = box.height * ratio;
  }

  function crystalAt(event) {
    const point = disk.pointAt(event);
    if (Math.hypot(...point) >= 1) return null;
    // How far the pointer is outside each crystal (or place to end up), in
    // hyperbolic terms.
    const near = (round.crystals ?? round.options).map((z, i) => distance(disk.toScreen(z), point) - round.radii[i]);
    const best = near.indexOf(Math.min(...near));
    return near[best] < 0.25 ? best : null;
  }

  // The triangle under the pointer, or the one whose middle is nearest.
  function triangleAt(event) {
    const [x, y] = disk.pointAt(event);
    const corners = round.triangles.map((points) => points.map(disk.toScreen));
    const inside = corners.findIndex(([a, b, c]) => {
      const side = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
      const s = [side(a, b), side(b, c), side(c, a)];
      return s.every((v) => v >= 0) || s.every((v) => v <= 0);
    });
    if (inside !== -1) return inside;
    const near = corners.map((points) => Math.hypot(x - middle(points)[0], y - middle(points)[1]));
    const best = near.indexOf(Math.min(...near));
    return near[best] < 0.25 ? best : null;
  }

  // The path nearest the pointer, if it is within a finger's width.
  function pathAt(event) {
    const box = canvas.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    const near = round.paths.map((points) => {
      const pixels = points.map(disk.pixelOf);
      let best = Infinity;
      for (let i = 1; i < pixels.length; i++) best = Math.min(best, toSegment([x, y], pixels[i - 1], pixels[i]));
      return best;
    });
    const best = near.indexOf(Math.min(...near));
    return near[best] < 26 ? best : null;
  }

  function draw() {
    if (action) return drawAction();
    if (!round) return;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (round.kind === 'straight') drawStraight(ctx);
    else if (round.kind === 'triangle') drawTriangles();
    else if (round.kind === 'square') drawSquare(ctx);
    else drawClosest();
  }

  // An action game draws its own markers, segments and overlay. Its overlay
  // points are in screen coordinates.
  function drawAction() {
    const ctx = overlay.getContext('2d');
    const ratio = overlay.width / overlay.getBoundingClientRect().width || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    disk.setMarkers(action.markers());
    disk.setSegments(action.segments());
    const { box, scale } = disk.frame();
    action.draw(ctx, { width: box.width, height: box.height, scale }, (z) => disk.pixelOf(z, true));
  }

  // Plays one action game; resolves to its stars.
  async function playAction(kind) {
    round = null;
    labels.replaceChildren();
    if (player) await slide(disk.toScreen(player), [0, 0]);
    action = createAction(kind, { disk, sound, status: (text) => (result.textContent = text) });
    prompt.textContent = action.prompt;
    result.className = '';
    const { stars, text } = await action.done;
    action = null;
    player = disk.toWorld([0, 0]);
    result.textContent = `${'★'.repeat(stars)}${'☆'.repeat(2 - stars)} ${text}`;
    result.className = stars ? 'right' : 'wrong';
    sound?.[stars ? 'right' : 'wrong']();
    return stars;
  }

  // The triangle round: three geodesic triangles, labelled at their middles.
  function drawTriangles() {
    const { triangles, answer, revealed } = round;
    disk.setMarkers([]);
    disk.setSegments(
      triangles.flatMap((points, i) =>
        points.map((from, k) => ({
          from,
          to: points[(k + 1) % 3],
          color: revealed && i === answer ? TARGET_COLOR : CRYSTALS[i].color,
          dashed: false,
        })),
      ),
    );
    // Labels go at each triangle's middle as drawn.
    triangles.forEach((points, i) => place(labels.children[i], disk.pixelOf(middle(points.map(disk.toScreen)), true)));
  }

  // The square round: three places to end up, the player, and the path
  // walked once the answer is revealed.
  function drawSquare(ctx) {
    const { options, radii, pick, answer, revealed, trail } = round;
    disk.setSegments([]);
    disk.setMarkers([
      ...options.map((at, i) => ({
        at,
        radius: radii[i],
        color: CRYSTALS[i].color,
        ring: revealed && i === answer ? '#ffd54a' : i === pick ? '#ffffff' : null,
        ringAlpha: revealed && i === answer ? 0.85 : 1,
      })),
      { at: player, radius: PLAYER_RADIUS, color: '#ffffff', style: 'player' },
    ]);
    if (trail.length > 1) {
      const ratio = overlay.width / overlay.getBoundingClientRect().width || 1;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(43, 108, 138, 0.8)';
      ctx.lineWidth = 3;
      stroke(ctx, trail);
    }
    options.forEach((z, i) => place(labels.children[i], disk.pixelOf(z)));
  }

  // The straight-line round: the crystal, the player and three paths.
  function drawStraight(ctx) {
    const { target, paths, pick, answer, revealed } = round;
    disk.setSegments([]);
    disk.setMarkers([
      { at: target, radius: round.targetRadius, color: TARGET_COLOR },
      { at: player, radius: PLAYER_RADIUS, color: '#ffffff', style: 'player' },
    ]);
    const ratio = overlay.width / overlay.getBoundingClientRect().width || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    paths.forEach((points, i) => {
      const faded = revealed && i !== answer && i !== pick;
      ctx.globalAlpha = faded ? 0.3 : 1;
      if (revealed && i === answer) {
        ctx.strokeStyle = 'rgba(255, 213, 74, 0.9)';
        ctx.lineWidth = 11;
        stroke(ctx, points);
      }
      ctx.strokeStyle = CRYSTALS[i].color;
      ctx.lineWidth = i === pick ? 6 : 4;
      stroke(ctx, points);
    });
    ctx.globalAlpha = 1;
    // Labels sit at the middle of each path, pushed out to the side it bows
    // towards, so they do not pile up where the paths are close.
    const [ex, ey] = disk.pixelOf(paths[0][0]);
    const [fx, fy] = disk.pixelOf(paths[0].at(-1));
    const chord = [(ex + fx) / 2, (ey + fy) / 2];
    paths.forEach((points, i) => {
      const [x, y] = disk.pixelOf(points[Math.floor(points.length / 2)]);
      const away = Math.hypot(x - chord[0], y - chord[1]);
      const push = away > 1 ? 14 / away : 0;
      place(labels.children[i], [x + (x - chord[0]) * push, y + (y - chord[1]) * push]);
    });
  }

  function stroke(ctx, points) {
    ctx.beginPath();
    points.forEach((z, i) => {
      const [x, y] = disk.pixelOf(z);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  function place(label, [x, y]) {
    label.style.left = `${x}px`;
    label.style.top = `${y}px`;
  }

  function drawClosest() {
    const { crystals, radii, pick, answer, revealed } = round;
    disk.setMarkers([
      ...crystals.map((at, i) => ({
        at,
        radius: radii[i],
        color: CRYSTALS[i].color,
        ring: lesson ? null : revealed && i === answer ? '#ffd54a' : i === pick ? '#ffffff' : null,
        ringAlpha: revealed && i === answer ? 0.85 : 1,
      })),
      ...(lesson ? [] : [{ at: player, radius: PLAYER_RADIUS, color: '#ffffff', style: 'player' }]),
    ]);
    disk.setSegments(
      lesson
        ? [0, 1, 2].map((i) => ({ from: crystals[i], to: crystals[(i + 1) % 3], color: TRIANGLE_INK, dashed: false }))
        : crystals.map((to, i) => ({ from: player, to, color: CRYSTALS[i].color, reveal })),
    );
    crystals.forEach((z, i) => place(labels.children[i], disk.pixelOf(z)));
  }

  function animate(ms, step) {
    return new Promise((resolve) => {
      const start = performance.now();
      animation = (now) => {
        const t = Math.min(1, (now - start) / ms);
        step(ease(t));
        if (t === 1) {
          animation = null;
          resolve();
        }
      };
    });
  }

  // Lays out a round around the player's spot on screen. A straight-line
  // round needs the player out towards the rim, and a square round needs
  // them at the centre, so the world first slides them there.
  async function startRound(index) {
    const spot = player ? disk.toScreen(player) : null;
    const kind = kinds[index];
    if (kind === 'triangle') {
      const layout = generateTriangleRound(Math.random);
      round = { ...layout, kind, triangles: layout.triangles.map((points) => points.map(disk.toWorld)), goal: null };
    } else if (kind === 'square') {
      const layout = generateSquareRound(Math.random);
      round = null;
      labels.replaceChildren();
      if (spot) await slide(spot, [0, 0]);
      player = disk.toWorld([0, 0]);
      const options = layout.options.map(disk.toWorld);
      round = {
        ...layout,
        kind,
        options,
        radii: layout.options.map((z) => radiusDrawnAs(abs(z), CRYSTAL_LOOK)),
        trail: [],
        home: layout.options.findIndex((z) => abs(z) < 1e-12),
        goal: null,
      };
    } else if (kind === 'straight') {
      const layout = generateStraightRound(Math.random);
      round = null;
      labels.replaceChildren();
      if (spot) await slide(spot, layout.player);
      const target = disk.toWorld(layout.target);
      round = {
        ...layout,
        kind,
        target,
        targetRadius: radiusDrawnAs(abs(layout.target), CRYSTAL_LOOK),
        paths: layout.paths.map((points) => points.map(disk.toWorld)),
        goal: target,
      };
      player = disk.toWorld(layout.player);
    } else {
      // Seen from the centre, nearer always looks nearer, so the player
      // first steps out from it.
      let at = spot;
      if (!at || abs(at) < 0.3) {
        const to = polar(0.36 + 0.2 * Math.random(), 2 * Math.PI * Math.random());
        if (at) await slide(at, to);
        at = to;
      }
      const layout = generateRound(Math.random, at);
      const crystals = layout.crystals.map(disk.toWorld);
      round = { ...layout, kind, crystals, goal: crystals[layout.answer] };
      player = disk.toWorld(layout.player);
    }
    Object.assign(round, { pick: -1, revealed: false });
    reveal = 0;
    prompt.textContent = promptFor(kind);
    labels.replaceChildren(
      ...CRYSTALS.map(({ name, color }) => {
        const label = document.createElement('span');
        label.textContent = name;
        label.style.setProperty('--crystal', color);
        return label;
      }),
    );
  }

  function choose() {
    return new Promise((resolve) => {
      onPick = (index) => {
        if (index === null) return;
        onPick = null;
        resolve(index);
      };
    });
  }

  function promptFor(kind) {
    if (kind === 'straight') return 'Three paths lead to the gold crystal. Which one is truly straight: the shortest way there?';
    if (kind === 'triangle') return 'Three triangles look about the same size. Which one is truly the biggest?';
    if (kind === 'square') {
      const side = round.side.toFixed(1);
      return `You will walk ${side} up, ${side} right, ${side} down and ${side} left, turning 90° each time. Where do you end up?`;
    }
    return visits === 1
      ? 'Space stretches towards the rim: every floor tile is the same size. Which crystal is truly closest to you?'
      : 'Which crystal is truly closest? Count the tiles, not the pixels.';
  }

  function showAnswer(pick) {
    round.pick = pick;
    round.revealed = true;
    if (round.kind === 'straight') return showStraightAnswer(pick);
    if (round.kind === 'triangle') return showTriangleAnswer(pick);
    if (round.kind === 'square') return showSquareAnswer(pick);
    const { distances, answer } = round;
    [...labels.children].forEach((label, i) => {
      label.textContent = `${CRYSTALS[i].name} · ${fixed(distances[i])}`;
      label.classList.toggle('answer', i === answer);
    });
    const right = pick === answer;
    sound?.[right ? 'right' : 'wrong']();
    result.textContent = right
      ? `Yes! ${CRYSTALS[answer].name} is only ${fixed(distances[answer])} away.`
      : `Not quite: ${CRYSTALS[answer].name} is closest at ${fixed(distances[answer])}, not ${CRYSTALS[pick].name} at ${fixed(distances[pick])}.`;
    result.className = right ? 'right' : 'wrong';
    return animate(700, (t) => (reveal = t)).then(() => right);
  }

  function showStraightAnswer(pick) {
    const { lengths, kinds, answer } = round;
    [...labels.children].forEach((label, i) => {
      label.textContent = `${CRYSTALS[i].name} · ${lengthText(lengths[i])}`;
      label.classList.toggle('answer', i === answer);
    });
    const right = pick === answer;
    sound?.[right ? 'right' : 'wrong']();
    const segment = kinds.indexOf('segment');
    const name = (i) => CRYSTALS[i].name;
    if (right) {
      result.textContent = `Yes! ${name(answer)} is the straight line, ${lengthText(lengths[answer])} long. The one that looks straight, ${name(segment)}, is ${lengthText(lengths[segment])}.`;
    } else if (pick === segment) {
      result.textContent = `It looks straight, but ${name(pick)} is ${lengthText(lengths[pick])} long. ${name(answer)} is shorter, ${lengthText(lengths[answer])}: straight lines here bow towards the centre, where space is least stretched.`;
    } else {
      result.textContent = `Not quite: ${name(pick)} is ${lengthText(lengths[pick])} long, ${name(answer)} only ${lengthText(lengths[answer])}. Straight lines here are arcs that would meet the rim at right angles.`;
    }
    result.className = right ? 'right' : 'wrong';
    return wait(700).then(() => right);
  }

  function showTriangleAnswer(pick) {
    const { areas, answer } = round;
    [...labels.children].forEach((label, i) => {
      label.textContent = `${CRYSTALS[i].name} · ${areas[i].toFixed(2)}`;
      label.classList.toggle('answer', i === answer);
    });
    const right = pick === answer;
    sound?.[right ? 'right' : 'wrong']();
    const { sum } = triangle(...round.triangles[answer]);
    const lesson = `Its angles add up to only ${degrees(sum)}°: the ${180 - degrees(sum)}° missing is its area.`;
    result.textContent = right
      ? `Yes! ${CRYSTALS[answer].name} holds ${areas[answer].toFixed(2)}. ${lesson}`
      : `Not quite: ${CRYSTALS[answer].name} is biggest, ${areas[answer].toFixed(2)} to ${CRYSTALS[pick].name}'s ${areas[pick].toFixed(2)}. ${lesson}`;
    result.className = right ? 'right' : 'wrong';
    return wait(700).then(() => right);
  }

  // Walks the square for real, leaving a trail, so the player sees where it
  // ends.
  async function showSquareAnswer(pick) {
    const { side, answer, gap, options } = round;
    round.trail = [player];
    const start = disk.view;
    sound?.walk();
    await animate(4 * LEG_MS, (t) => {
      let walked = t * 4 * side;
      let view = start;
      for (let leg = 0; leg < 4 && walked > 0; leg++) {
        const length = Math.min(side, walked);
        view = compose(stride(Math.PI / 2 - (leg * Math.PI) / 2, length), view);
        walked -= length;
      }
      disk.view = normalized(view);
      player = disk.toWorld([0, 0]);
      round.trail.push(player);
    });
    player = options[answer];
    const right = pick === answer;
    sound?.[right ? 'right' : 'wrong']();
    result.textContent = right
      ? `Yes! You end up ${gap.toFixed(2)} from where you started: in curved space a square does not close.`
      : pick === round.home
        ? `On a flat floor you'd be back where you started. Here you end up at ${CRYSTALS[answer].name}, ${gap.toFixed(2)} away.`
        : `Not quite: you end up at ${CRYSTALS[answer].name}, ${gap.toFixed(2)} from where you started.`;
    result.className = right ? 'right' : 'wrong';
    return right;
  }

  // Walks the player to the round's goal: the player stays put on screen and
  // the world flows past, so the far crystals sink towards the rim. The walk
  // follows the geodesic, so in a straight-line round it runs along the answer.
  async function walkToAnswer() {
    if (!round.goal) return;
    const start = disk.view;
    const spot = disk.toScreen(player);
    const to = disk.toScreen(round.goal);
    sound?.walk();
    await animate(WALK_MS, (t) => {
      disk.view = normalized(compose(walk(spot, to, t), start));
      player = disk.toWorld(spot);
    });
    player = round.goal;
  }

  // Moves the world so the player's spot on screen goes from one point to
  // another along a geodesic, keeping the player on it.
  async function slide(from, to) {
    const start = disk.view;
    const here = player;
    await animate(SPIN_MS, (t) => (disk.view = normalized(compose(walk(to, from, t), start))));
    player = here;
  }

  // Turns the whole world about the centre, so the next round starts from a
  // different spot on screen.
  async function spin() {
    const start = disk.view;
    const angle = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.6);
    await animate(SPIN_MS, (t) => (disk.view = normalized(compose(rotation(angle * t), start))));
  }

  // The last round's crystals as a geodesic triangle, with its angles,
  // slid to the middle of the disk where it is easiest to see.
  async function showLesson() {
    const { angles, sum, area } = triangle(...round.crystals);
    lesson = { angles };
    const start = disk.view;
    const middle = round.crystals.map(disk.toScreen).reduce((sum, z) => [sum[0] + z[0] / 3, sum[1] + z[1] / 3], [0, 0]);
    sound?.walk();
    await animate(WALK_MS, (t) => (disk.view = normalized(compose(walk([0, 0], middle, t), start))));
    [...labels.children].forEach((label, i) => {
      label.textContent = `${CRYSTALS[i].name} · ${degrees(angles[i])}°`;
      label.classList.remove('answer');
    });
    return `The three crystals mark a triangle. Its angles add up to ${degrees(sum)}°, not 180°: in hyperbolic space the missing ${degrees(Math.PI - sum)}° is exactly its area, ${area.toFixed(2)}. Each floor tile is a triangle too, with three 45° corners.`;
  }

  function waitForButton(text) {
    button.textContent = text;
    button.hidden = false;
    return new Promise((resolve) => {
      button.onclick = () => {
        button.hidden = true;
        resolve();
      };
    });
  }

  // Plays a session of the chamber and resolves to { score, skipped }: the
  // number of rounds won, and whether the player skipped the session.
  // skippable offers a plain draw instead, for players who know the chamber.
  async function play({ title, skippable = false }) {
    root.hidden = false;
    if (!disk) setup();
    resize();
    disk.view = IDENTITY;
    animation = null;
    player = null;
    lesson = null;
    action = null;
    if (visits++ === 0) kinds = FIRST_VISIT;
    else {
      const games = shuffled(ACTION_GAMES, Math.random).filter((game) => game !== lastAction);
      kinds = [games[0], shuffled(QUIZZES, Math.random)[0]];
    }
    // The address can ask for a game or a quiz (?game=golf&quiz=square), for
    // demos and testing.
    const asked = new URLSearchParams(window.location.search);
    if (ACTION_GAMES.includes(asked.get('game'))) kinds = [asked.get('game'), kinds[1]];
    if (QUIZZES.includes(asked.get('quiz'))) kinds = [kinds[0], asked.get('quiz')];
    lastAction = kinds[0];
    let score = 0;
    $('chamber-title').textContent = title;
    skipButton.hidden = !skippable;
    const skipped = new Promise((resolve) => (skipButton.onclick = () => resolve(SKIP)));
    const unlessSkipped = (step) =>
      Promise.race([step, skipped]).then((value) => {
        if (value === SKIP) throw SKIP;
        return value;
      });

    try {
      for (let index = 0; index < ROUNDS; index++) {
        result.textContent = '';
        roundText.textContent = `Round ${index + 1} of ${ROUNDS}`;
        if (ACTION_GAMES.includes(kinds[index])) {
          score += await unlessSkipped(playAction(kinds[index]));
          await unlessSkipped(wait(2200));
        } else {
          await unlessSkipped(startRound(index));
          const pick = await unlessSkipped(choose());
          sound?.pick();
          if (await unlessSkipped(showAnswer(pick))) score++;
          await unlessSkipped(wait(500));
          await unlessSkipped(walkToAnswer());
        }
        if (index < ROUNDS - 1) await unlessSkipped(spin());
      }
    } catch (error) {
      if (error !== SKIP) throw error;
      action?.stop();
      action = null;
      onPick = null;
      animation = null;
      skipButton.hidden = true;
      root.hidden = true;
      return { score: 0, skipped: true };
    }

    skipButton.hidden = true;
    roundText.textContent = `${'★'.repeat(score)}${'☆'.repeat(BEST - score)}`;
    if (round?.kind === 'closest') {
      prompt.textContent = '';
      prompt.textContent = await showLesson();
    }
    result.className = '';
    result.textContent =
      score === BEST
        ? 'Perfect: three stars! Each new letter is the best of four draws.'
        : `${score} star${score === 1 ? '' : 's'} of ${BEST}: each new letter is the best of ${score + 1} draw${score ? 's' : ''}.`;
    await waitForButton('Collect your letters');
    root.hidden = true;
    return { score, skipped: false };
  }

  return { play, isOpen: () => !root.hidden };
}
