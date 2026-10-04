import { createDisk } from './disk.js';
import {
  CRYSTAL_LOOK,
  IDENTITY,
  abs,
  compose,
  distance,
  generateRound,
  generateStraightRound,
  normalized,
  radiusDrawnAs,
  rotation,
  triangle,
  walk,
} from './hyperbolic.js';

// The Hyperbolic Chamber: a short minigame played before each turn to earn
// letters, in a Poincaré disk. Every tile of the triangle tiling is the same
// size in hyperbolic terms, so tiles shrink towards the rim and counting them
// is a fair way to judge distance. Two kinds of round:
//   closest   three crystals look about equally far away and equally big;
//             only one is truly the closest.
//   straight  three paths lead to a crystal; only one is the geodesic, and it
//             is not the one that looks straight.
// After the last round, the three crystals mark a triangle whose angles add
// up to less than 180°.

const KINDS = ['closest', 'straight', 'closest']; // the last must be closest, for the triangle
const ROUNDS = KINDS.length;
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

  function setup() {
    disk = createDisk(canvas);
    disk.setAnimationLoop(() => {
      if (root.hidden) return;
      animation?.(performance.now());
      draw();
      disk.render();
    });
    canvas.addEventListener('pointerup', (event) =>
      onPick?.(round.kind === 'straight' ? pathAt(event) : crystalAt(event)),
    );
    window.addEventListener('keydown', (event) => {
      if (root.hidden || !onPick) return;
      const index = ['1', '2', '3'].indexOf(event.key) + 1 || ['a', 'b', 'c'].indexOf(event.key.toLowerCase()) + 1;
      if (index) onPick(index - 1);
    });
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
    // How far the pointer is outside each crystal, in hyperbolic terms.
    const near = round.crystals.map((z, i) => distance(disk.toScreen(z), point) - round.radii[i]);
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
    if (!round) return;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    if (round.kind === 'straight') drawStraight(ctx);
    else drawClosest();
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
  // round needs the player out towards the rim, so the world first slides
  // them there.
  async function startRound(index) {
    const spot = player ? disk.toScreen(player) : null;
    const kind = KINDS[index];
    if (kind === 'straight') {
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
      const layout = generateRound(Math.random, spot);
      const crystals = layout.crystals.map(disk.toWorld);
      round = { ...layout, kind, crystals, goal: crystals[layout.answer] };
      player = disk.toWorld(layout.player);
    }
    Object.assign(round, { pick: -1, revealed: false });
    reveal = 0;
    roundText.textContent = `Round ${index + 1} of ${ROUNDS}`;
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

  function showAnswer(pick) {
    round.pick = pick;
    round.revealed = true;
    if (round.kind === 'straight') return showStraightAnswer(pick);
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

  // Walks the player to the round's goal: the player stays put on screen and
  // the world flows past, so the far crystals sink towards the rim. The walk
  // follows the geodesic, so in a straight-line round it runs along the answer.
  async function walkToAnswer() {
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
        await unlessSkipped(startRound(index));
        result.textContent = '';
        if (KINDS[index] === 'straight') {
          prompt.textContent = 'Three paths lead to the gold crystal. Which one is truly straight: the shortest way there?';
        } else {
          prompt.textContent =
            index === 0
              ? 'Space stretches towards the rim: every floor tile is the same size. Which crystal is truly closest to you?'
              : 'Which crystal is truly closest? Count the tiles, not the pixels.';
        }
        const pick = await unlessSkipped(choose());
        sound?.pick();
        if (await unlessSkipped(showAnswer(pick))) score++;
        await unlessSkipped(wait(500));
        await unlessSkipped(walkToAnswer());
        if (index < ROUNDS - 1) await unlessSkipped(spin());
      }
    } catch (error) {
      if (error !== SKIP) throw error;
      onPick = null;
      animation = null;
      skipButton.hidden = true;
      root.hidden = true;
      return { score: 0, skipped: true };
    }

    skipButton.hidden = true;
    roundText.textContent = `${score} of ${ROUNDS}`;
    prompt.textContent = '';
    prompt.textContent = await showLesson();
    result.className = '';
    result.textContent =
      score === ROUNDS
        ? 'Perfect: each new letter is the best of four draws.'
        : `You won ${score} of ${ROUNDS} rounds: each new letter is the best of ${score + 1} draw${score ? 's' : ''}.`;
    await waitForButton('Collect your letters');
    root.hidden = true;
    return { score, skipped: false };
  }

  return { play, isOpen: () => !root.hidden };
}
