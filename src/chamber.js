import * as THREE from 'three';
import {
  IDENTITY,
  apply,
  compose,
  distance,
  generateRound,
  invert,
  normalized,
  rotation,
  tilingMirror,
  toCentre,
  walk,
} from './hyperbolic.js';

// The Hyperbolic Chamber: a short minigame played before each turn to earn
// letters. The player stands in a Poincaré disk with three crystals that look
// about equally far away; only one is truly the closest. Every tile of the
// triangle tiling is the same size in hyperbolic terms, so tiles shrink
// towards the rim and counting them is a fair way to judge distance.

const ROUNDS = 3;
const SIDES = 3; // triangles...
const MEETING = 8; // ...eight at each corner: small tiles, and an even count so they two-colour
const CRYSTAL_RADIUS = 0.22; // hyperbolic
const PLAYER_RADIUS = 0.16;
const WALK_MS = 1300;
const SPIN_MS = 700;
const CRYSTALS = [
  { name: 'A', color: '#f2777a' },
  { name: 'B', color: '#35b394' },
  { name: 'C', color: '#8c70d8' },
];

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec2 uSize;
  uniform vec2 uA, uB, uC, uD;   // screen disk -> world disk
  uniform vec2 uMirror;          // tiling mirror circle: centre on the real axis, radius
  uniform float uSides;
  uniform vec2 uPlayer;          // world
  uniform vec2 uCrystal[3];      // world
  uniform vec3 uCrystalColor[3];
  uniform vec2 uSeen[3];         // crystals as seen from the player (player at the centre)
  uniform float uReveal;         // 0..1: how much of the geodesics to show
  uniform float uPick;           // the crystal chosen, or -1
  uniform float uAnswer;         // the closest crystal, shown once revealed

  const float PI = 3.14159265;

  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  vec2 cdiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }
  float acosh1(float x) { return log(x + sqrt(max(x * x - 1.0, 0.0))); }
  float atanh1(float x) { return 0.5 * log((1.0 + x) / (1.0 - x)); }
  float hdist(vec2 p, vec2 q) {
    vec2 d = p - q;
    return acosh1(1.0 + 2.0 * dot(d, d) / max((1.0 - dot(p, p)) * (1.0 - dot(q, q)), 1e-9));
  }

  void main() {
    vec2 s = (vUv - 0.5) * uSize / (0.48 * min(uSize.x, uSize.y));
    float r = length(s);
    if (r >= 1.0) {
      float halo = smoothstep(1.05, 1.0, r);
      gl_FragColor = vec4(0.71, 0.62, 0.84, 0.55 * halo);
      return;
    }
    vec2 w = cdiv(cmul(uA, s) + uB, cmul(uC, s) + uD);

    // Fold the point into the central tile, counting how many edges it
    // crosses on the way: the parity of that count two-colours the tiling.
    vec2 z = w;
    float crossings = 0.0;
    float sector = 2.0 * PI / uSides;
    vec2 centre = vec2(uMirror.x, 0.0);
    float rr = uMirror.y * uMirror.y;
    for (int i = 0; i < 60; i++) {
      float turn = -floor((atan(z.y, z.x) + 0.5 * sector) / sector) * sector;
      z = vec2(cos(turn) * z.x - sin(turn) * z.y, sin(turn) * z.x + cos(turn) * z.y);
      z.y = abs(z.y);
      vec2 d = z - centre;
      float dd = dot(d, d);
      if (dd >= rr) break;
      z = centre + d * (rr / dd);
      crossings += 1.0;
    }
    vec3 tileA = vec3(0.99, 0.91, 0.84);
    vec3 tileB = vec3(0.96, 0.80, 0.75);
    vec3 color = mod(crossings, 2.0) < 0.5 ? tileA : tileB;
    float edge = abs(length(z - centre) - uMirror.y);
    float edgeWidth = 0.008;
    float edgeAa = fwidth(edge) + 1e-5;
    color = mix(vec3(0.62, 0.52, 0.72), color, smoothstep(edgeWidth, edgeWidth + edgeAa, edge));
    color *= 1.0 - 0.18 * r * r; // the rim sinks away

    // Geodesics from the player to each crystal, dashed every half unit of
    // hyperbolic distance, once the answer is revealed.
    vec2 u = cdiv(w - uPlayer, vec2(1.0, 0.0) - cmul(vec2(uPlayer.x, -uPlayer.y), w));
    float scale = 2.0 / max(1.0 - dot(u, u), 1e-4);
    for (int i = 0; i < 3; i++) {
      vec2 v = uSeen[i];
      float len = length(v);
      vec2 dir = v / len;
      float along = dot(u, dir);
      float across = abs(u.x * dir.y - u.y * dir.x) * scale;
      if (along > 0.0 && along < len * uReveal && across < 0.035) {
        float dash = fract(2.0 * atanh1(min(along, 0.999)) / 0.5);
        if (dash < 0.6) color = mix(color, uCrystalColor[i] * 0.8, 0.9);
      }
    }

    for (int i = 0; i < 3; i++) {
      float d = hdist(w, uCrystal[i]);
      if (d < ${CRYSTAL_RADIUS.toFixed(2)}) {
        vec3 gem = mix(uCrystalColor[i] * 1.18, uCrystalColor[i] * 0.78, d / ${CRYSTAL_RADIUS.toFixed(2)});
        if (d > ${(CRYSTAL_RADIUS * 0.82).toFixed(3)}) gem = uCrystalColor[i] * 0.6;
        color = gem;
      } else if (d < ${(CRYSTAL_RADIUS + 0.09).toFixed(2)}) {
        if (abs(uPick - float(i)) < 0.5) color = vec3(1.0);
        if (uReveal > 0.0 && abs(uAnswer - float(i)) < 0.5) color = mix(color, vec3(1.0, 0.85, 0.3), 0.85);
      }
    }

    float p = hdist(w, uPlayer);
    if (p < ${PLAYER_RADIUS.toFixed(2)}) color = p > ${(PLAYER_RADIUS * 0.75).toFixed(3)} ? vec3(0.29, 0.25, 0.34) : vec3(1.0);

    gl_FragColor = vec4(color, 1.0);
  }
`;

const $ = (id) => document.getElementById(id);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ease = (t) => 1 - (1 - t) ** 3;
const fixed = (d) => d.toFixed(1);

export function createChamber() {
  const root = $('chamber');
  const canvas = $('chamber-canvas');
  const labels = $('chamber-labels');
  const prompt = $('chamber-prompt');
  const result = $('chamber-result');
  const button = $('chamber-go');
  const roundText = $('chamber-round');

  let renderer = null;
  let uniforms = null;
  let view = IDENTITY; // world -> screen
  let player = null; // the player's world position
  let round = null; // { crystals (world), distances, answer }
  let animation = null;
  let onPick = null;

  const toScreen = (z) => apply(view, z);
  const toWorld = (z) => apply(invert(view), z);

  function setup() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    const { centre, radius } = tilingMirror(SIDES, MEETING);
    uniforms = {
      uSize: { value: new THREE.Vector2(1, 1) },
      uA: { value: new THREE.Vector2(1, 0) },
      uB: { value: new THREE.Vector2() },
      uC: { value: new THREE.Vector2() },
      uD: { value: new THREE.Vector2(1, 0) },
      uMirror: { value: new THREE.Vector2(centre, radius) },
      uSides: { value: SIDES },
      uPlayer: { value: new THREE.Vector2() },
      uCrystal: { value: [0, 1, 2].map(() => new THREE.Vector2()) },
      uCrystalColor: { value: CRYSTALS.map(({ color }) => new THREE.Color(color)) },
      uSeen: { value: [0, 1, 2].map(() => new THREE.Vector2(0.1, 0)) },
      uReveal: { value: 0 },
      uPick: { value: -1 },
      uAnswer: { value: -1 },
    };
    const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    renderer.setAnimationLoop(() => {
      if (root.hidden) return;
      animation?.(performance.now());
      draw();
      renderer.render(scene, camera);
    });
    canvas.addEventListener('pointerup', (event) => onPick?.(crystalAt(event)));
    window.addEventListener('keydown', (event) => {
      if (root.hidden || !onPick) return;
      const index = ['1', '2', '3'].indexOf(event.key) + 1 || ['a', 'b', 'c'].indexOf(event.key.toLowerCase()) + 1;
      if (index) onPick(index - 1);
    });
  }

  function resize() {
    const size = canvas.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(size.width, size.height, false);
    renderer.getDrawingBufferSize(uniforms.uSize.value);
  }

  // The point of the screen disk under a pointer event.
  function diskPoint(event) {
    const box = canvas.getBoundingClientRect();
    const scale = 0.48 * Math.min(box.width, box.height);
    return [(event.clientX - box.left - box.width / 2) / scale, -(event.clientY - box.top - box.height / 2) / scale];
  }

  function crystalAt(event) {
    const point = diskPoint(event);
    if (Math.hypot(...point) >= 1) return null;
    const near = round.crystals.map((z) => distance(toScreen(z), point));
    const best = near.indexOf(Math.min(...near));
    return near[best] < CRYSTAL_RADIUS + 0.25 ? best : null;
  }

  function draw() {
    const [a, b, c, d] = invert(view);
    uniforms.uA.value.set(...a);
    uniforms.uB.value.set(...b);
    uniforms.uC.value.set(...c);
    uniforms.uD.value.set(...d);
    uniforms.uPlayer.value.set(...player);
    // Crystals as seen from the player, for drawing the geodesics.
    const centred = toCentre(player);
    round.crystals.forEach((z, i) => uniforms.uSeen.value[i].set(...apply(centred, z)));
    const box = canvas.getBoundingClientRect();
    const scale = 0.48 * Math.min(box.width, box.height);
    round.crystals.forEach((z, i) => {
      uniforms.uCrystal.value[i].set(...z);
      const [x, y] = toScreen(z);
      const label = labels.children[i];
      label.style.left = `${box.width / 2 + x * scale}px`;
      label.style.top = `${box.height / 2 - y * scale}px`;
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
    const spot = player ? toScreen(player) : null;
    const layout = generateRound(Math.random, spot);
    player = toWorld(layout.player);
    round = { crystals: layout.crystals.map(toWorld), distances: layout.distances, answer: layout.answer };
    uniforms.uReveal.value = 0;
    uniforms.uPick.value = -1;
    uniforms.uAnswer.value = layout.answer;
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

  function reveal(pick) {
    uniforms.uPick.value = pick;
    const { distances, answer } = round;
    [...labels.children].forEach((label, i) => {
      label.textContent = `${CRYSTALS[i].name} · ${fixed(distances[i])}`;
      label.classList.toggle('answer', i === answer);
    });
    const right = pick === answer;
    result.textContent = right
      ? `Yes! ${CRYSTALS[answer].name} is only ${fixed(distances[answer])} away.`
      : `Not quite: ${CRYSTALS[answer].name} is closest at ${fixed(distances[answer])}, not ${CRYSTALS[pick].name} at ${fixed(distances[pick])}.`;
    result.className = right ? 'right' : 'wrong';
    return animate(700, (t) => (uniforms.uReveal.value = t)).then(() => right);
  }

  // Walks the player to the closest crystal: the player stays put on screen
  // and the world flows past, so the far crystals sink towards the rim.
  async function walkToAnswer() {
    const start = view;
    const spot = toScreen(player);
    const to = toScreen(round.crystals[round.answer]);
    await animate(WALK_MS, (t) => {
      view = normalized(compose(walk(spot, to, t), start));
      player = toWorld(spot);
    });
    player = round.crystals[round.answer];
  }

  // Turns the whole world about the centre, so the next round starts from a
  // different spot on screen.
  async function spin() {
    const start = view;
    const angle = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.6);
    await animate(SPIN_MS, (t) => (view = normalized(compose(rotation(angle * t), start))));
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

  // Plays a session of the chamber and resolves to the number of rounds won.
  async function play({ title }) {
    root.hidden = false;
    if (!renderer) setup();
    resize();
    view = IDENTITY;
    player = null;
    let score = 0;
    $('chamber-title').textContent = title;
    for (let index = 0; index < ROUNDS; index++) {
      startRound(index);
      result.textContent = '';
      prompt.textContent =
        index === 0
          ? 'Space stretches towards the rim: every tile is the same size. Which crystal is truly closest to you?'
          : 'Which crystal is truly closest?';
      const pick = await choose();
      if (await reveal(pick)) score++;
      await wait(500);
      await walkToAnswer();
      if (index < ROUNDS - 1) await spin();
    }
    prompt.textContent = `You found the closest crystal ${score} of ${ROUNDS} times.`;
    result.className = '';
    result.textContent =
      score === ROUNDS
        ? 'Perfect: each new letter is the best of four draws.'
        : `Each new letter is the best of ${score + 1} draw${score ? 's' : ''}.`;
    await waitForButton('Collect your letters');
    root.hidden = true;
    return score;
  }

  window.addEventListener('resize', () => renderer && !root.hidden && resize());
  return { play, isOpen: () => !root.hidden };
}
