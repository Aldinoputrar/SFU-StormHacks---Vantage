import { createDisk } from './disk.js';
import { IDENTITY, compose, distance, generateRound, normalized, rotation, triangle, walk } from './hyperbolic.js';

// The Hyperbolic Chamber: a short minigame played before each turn to earn
// letters. The player stands in a Poincaré disk with three crystals that look
// about equally far away and equally big; only one is truly the closest.
// Every tile of the triangle tiling is the same size in hyperbolic terms, so
// tiles shrink towards the rim and counting them is a fair way to judge
// distance. After the last round, the three crystals mark a triangle whose
// angles add up to less than 180°.

const ROUNDS = 3;
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

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ease = (t) => 1 - (1 - t) ** 3;
const fixed = (d) => d.toFixed(1);
const degrees = (radians) => Math.round((radians * 180) / Math.PI);

export function createChamber({ sound } = {}) {
  const root = $('chamber');
  const canvas = $('chamber-canvas');
  const labels = $('chamber-labels');
  const prompt = $('chamber-prompt');
  const result = $('chamber-result');
  const button = $('chamber-go');
  const skipButton = $('chamber-skip');
  const roundText = $('chamber-round');

  let disk = null;
  let player = null; // the player's world position
  let round = null; // { crystals (world), radii, distances, answer, pick, revealed }
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
    canvas.addEventListener('pointerup', (event) => onPick?.(crystalAt(event)));
    window.addEventListener('keydown', (event) => {
      if (root.hidden || !onPick) return;
      const index = ['1', '2', '3'].indexOf(event.key) + 1 || ['a', 'b', 'c'].indexOf(event.key.toLowerCase()) + 1;
      if (index) onPick(index - 1);
    });
    window.addEventListener('resize', () => !root.hidden && disk.resize());
  }

  function crystalAt(event) {
    const point = disk.pointAt(event);
    if (Math.hypot(...point) >= 1) return null;
    // How far the pointer is outside each crystal, in hyperbolic terms.
    const near = round.crystals.map((z, i) => distance(disk.toScreen(z), point) - round.radii[i]);
    const best = near.indexOf(Math.min(...near));
    return near[best] < 0.25 ? best : null;
  }

  function draw() {
    if (!round) return;
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
    crystals.forEach((z, i) => {
      const [x, y] = disk.pixelOf(z);
      const label = labels.children[i];
      label.style.left = `${x}px`;
      label.style.top = `${y}px`;
    });
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

  // Lays out a round around the player's spot on screen.
  function startRound(index) {
    const spot = player ? disk.toScreen(player) : null;
    const layout = generateRound(Math.random, spot);
    player = disk.toWorld(layout.player);
    round = { ...layout, crystals: layout.crystals.map(disk.toWorld), pick: -1, revealed: false };
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

  // Walks the player to the closest crystal: the player stays put on screen
  // and the world flows past, so the far crystals sink towards the rim.
  async function walkToAnswer() {
    const start = disk.view;
    const spot = disk.toScreen(player);
    const to = disk.toScreen(round.crystals[round.answer]);
    sound?.walk();
    await animate(WALK_MS, (t) => {
      disk.view = normalized(compose(walk(spot, to, t), start));
      player = disk.toWorld(spot);
    });
    player = round.crystals[round.answer];
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
    disk.resize();
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
        startRound(index);
        result.textContent = '';
        prompt.textContent =
          index === 0
            ? 'Space stretches towards the rim: every floor tile is the same size. Which crystal is truly closest to you?'
            : 'Which crystal is truly closest? Count the tiles, not the pixels.';
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
        : `You found the closest crystal ${score} of ${ROUNDS} times: each new letter is the best of ${score + 1} draw${score ? 's' : ''}.`;
    await waitForButton('Collect your letters');
    root.hidden = true;
    return { score, skipped: false };
  }

  return { play, isOpen: () => !root.hidden };
}
