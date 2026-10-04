import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import wordsUrl from '../node_modules/word-list/words.txt?url';
import { createSound } from './audio.js';
import { buildBoard, chainsForView, isJoined, nearestVantage, slotKey } from './board.js';
import { BONUS_KINDS } from './bonuses.js';
import { normalize, screenBasis } from './geometry.js';
import { createChamber } from './chamber.js';
import { createConfetti } from './confetti.js';
import { createDictionary, createWordChecker } from './dictionary.js';
import {
  RACK_SIZE,
  cancelPending,
  commitPlay,
  createGame,
  finishRun,
  isOver,
  letterAt,
  placeTile,
  preparePlay,
  refillRack,
  swapRack,
  swingBridge,
  undoTile,
} from './game.js';
import { createHud } from './hud.js';
import { createLab } from './lab.js';
import { saveScores, topScores } from './leaderboard.js';
import { MAPS, MONUMENT, VIEWS } from './level.js';
import { MISSION_POINTS, completeMissions } from './missions.js';
import { MAX_PLAYERS, createPlayers, seat, standings, turnsFor } from './players.js';
import { placementDirection, placementOptions } from './placement.js';
import { BoardView } from './scene.js';
import { Traveller } from './traveller.js';

// A testing aid, in development only: ?raf=timer drives every animation from
// a timer, for browser panes that pause animation frames while hidden.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('raf') === 'timer') {
  window.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 16);
  window.cancelAnimationFrame = clearTimeout;
}

const SNAP_ANGLE = THREE.MathUtils.degToRad(10); // release this close to a vantage and the camera snaps
const HINT_ANGLE = THREE.MathUtils.degToRad(20);
const SNAP_MS = 350;
// Looking almost straight down, tilted a little so the tower's height shows
// while ledges stay horizontal on screen. The run starts here.
const OVERHEAD = [0.003, 1, 0.3];
const REVEAL_TURN = THREE.MathUtils.degToRad(40); // how far reveal swings the camera
const REVEAL_HOLD_MS = 2000;
// Behind the title screen the monument turns slowly, flashing as it passes
// each vantage point.
const INTRO_VIEW = [1, 0.75, 0.25];
const INTRO_SPIN = 0.09; // radians per second
const SWING_MS = 700;
const CELEBRATE_MS = 1500; // between a word scoring and the chamber opening

// Both change when the swing bridge turns: the board is rebuilt, and drawn again.
// The map comes from the address (?map=spire), so choosing one on the title
// screen is a reload, and the monument behind the title is the one chosen.
const LEVEL = MAPS.find(({ id }) => id === new URLSearchParams(window.location.search).get('map')) ?? MONUMENT;

let board = buildBoard(LEVEL);
const game = createGame(LEVEL, board);
// Pass-and-play: everyone shares the board; seat() swaps in the rack, score
// and missions of whoever's turn it is. Solo is one player.
let players = createPlayers(['You'], LEVEL);
let seated = seat(game, players, null, 0);
const confetti = createConfetti(document.getElementById('confetti'));
const sound = createSound();
const chamber = createChamber({ sound });
const lab = createLab({ sound });
const chamberStats = { right: 0, rounds: 0 };
// Merriam-Webster first; the offline list only loads if it is needed.
const words = createWordChecker({
  loadOffline: () =>
    fetch(wordsUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Word list request failed: ${response.status}`);
        return response.text();
      })
      .then(createDictionary),
});

// Transparent, so the page's pastel sky shows through.
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight('#fff6e8', '#8a7a99', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.4);
sun.position.set(10, 20, 6);
scene.add(sun);
// Undersides hold letters too, so light them from below.
const fill = new THREE.DirectionalLight('#ffffff', 0.9);
fill.position.set(-6, -12, -8);
scene.add(fill);

let view = new BoardView(board, scene, game.bonuses);
for (const [key, letter] of game.letters) view.setTile(key, letter, 'fixed');

// The traveller waits on the plaza and walks along every word played.
const traveller = new Traveller(scene);
const startSlot = () => board.slots.get(slotKey(LEVEL.start.cell, LEVEL.start.face));
traveller.standOn(startSlot());

const bounds = new THREE.Box3();
for (const cell of board.cells) bounds.expandByPoint(new THREE.Vector3(...cell));
const target = bounds.getCenter(new THREE.Vector3());
const viewHeight = bounds.getSize(new THREE.Vector3()).length() * 0.85;
// The widest the monument gets on screen, from any of the views the buttons
// and snapping use, measured either side of the orbit target.
const viewWidth = Math.max(
  ...[...Object.values(VIEWS), OVERHEAD].map((dir) => {
    const { right } = screenBasis(normalize(dir));
    let half = 0;
    for (const cell of board.cells) {
      for (const corner of [-0.5, 0.5].flatMap((x) => [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => [x, y, z])))) {
        const offset = new THREE.Vector3(...cell).add(new THREE.Vector3(...corner)).sub(target);
        half = Math.max(half, Math.abs(offset.dot(new THREE.Vector3(...right))));
      }
    }
    return 2 * half;
  }),
);

// Orthographic, so things at different depths can appear to touch.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 200);
function resize() {
  const aspect = window.innerWidth / window.innerHeight;
  // On narrow screens the monument's width is what has to fit.
  const height = Math.max(viewHeight, viewWidth / (0.94 * aspect));
  camera.left = (-height * aspect) / 2;
  camera.right = (height * aspect) / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
resize();
window.addEventListener('resize', resize);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(target);
controls.minZoom = 0.6;
controls.maxZoom = 4;
controls.enabled = false;
// The title screen turns the monument slowly; the run itself starts overhead,
// away from every vantage point, so the player has to find them.
camera.position.copy(target).add(new THREE.Vector3(...INTRO_VIEW).setLength(40));
controls.update();

// Measured from the orbit target, which moves when the player pans.
const viewDir = () => camera.position.clone().sub(controls.target).normalize().toArray();

// 'intro': title screen · 'chamber': earning letters · 'explore': orbiting ·
// 'placing': view locked, typing a word · 'checking': asking the dictionary ·
// 'over': run finished
let mode = 'intro';
let labOpen = false;
let summaryShown = false;
let hover = null; // while exploring, the chain a click on the tile under the pointer would choose
let current = chainsForView(board, viewDir()); // every line, as seen from the camera
let selection = null; // { chain, cursor, clicked } while placing
let lockedDir = null;
let snap = null;
let revealing = false; // showing how far apart joined strips really are
let swinging = null; // { start, angle, cells, next } while the bridge turns
let celebrating = false; // a word just scored
let message = null;
let messageTimer;
// The camera is moving, a screen is over the monument or words are being
// checked.
const busy = () =>
  Boolean(snap || revealing || swinging || celebrating) ||
  labOpen ||
  ['intro', 'chamber', 'checking', 'handoff'].includes(mode);
const canLook = () => !busy() && (mode === 'explore' || mode === 'over');

const hud = createHud({
  onRack: placeFromRack,
  onPlay: play,
  onUndo: undo,
  onCancel: exitPlacing,
  onIso: () => canLook() && animateTo(VIEWS.southEast),
  onOverhead: () => canLook() && animateTo(OVERHEAD),
  onReveal: reveal,
  onPattern: selectPatternSlot,
  onSwitchLine: () => {
    if (mode === 'placing' && selection && !game.pending.length && !busy()) selectSlot(selection.clicked, true);
  },
  onSwap: swap,
  onFinish: finish,
  onSwing: swing,
});

// Dashed bars across each hidden gap, drawn while revealing. WebGL lines are
// always one pixel wide, so the dashes are thin boxes instead.
const ghosts = new THREE.Group();
scene.add(ghosts);
const GHOST_DASH = 0.28;
const GHOST_GAP = 0.16;
const ghostMaterial = new THREE.MeshBasicMaterial({ color: '#12a99a', depthTest: false, transparent: true });
const ghostDash = new THREE.BoxGeometry(0.09, 1, 0.09);
const ghostEnd = new THREE.SphereGeometry(0.13, 16, 12);

function setMessage(text, tone = 'info', ms = 5000) {
  message = { text, tone };
  if (tone === 'error') sound.error();
  clearTimeout(messageTimer);
  if (ms) {
    messageTimer = setTimeout(() => {
      message = null;
      renderHud();
    }, ms);
  }
  renderHud();
}

let wasJoined = false;
function refresh() {
  if (mode !== 'placing' && mode !== 'checking' && !revealing) current = chainsForView(board, viewDir());
  view.orientLetters(camera);
  // A chime as strips come together.
  const joinedNow = current.chains.some(isJoined);
  if (joinedNow && !wasJoined && (mode === 'explore' || mode === 'over') && !revealing) sound.snap();
  wasJoined = joinedNow;

  const highlights = new Map();
  for (const chain of current.chains.filter(isJoined)) {
    for (const key of chain.slots) highlights.set(key, 'aligned');
  }
  if (hover && mode === 'explore' && !busy()) {
    for (const key of hover.slots) highlights.set(key, highlights.get(key) === 'aligned' ? 'hoverAligned' : 'hover');
  }
  if (selection) {
    for (const key of selection.chain.slots) highlights.set(key, 'selected');
    const cursor = selection.chain.slots[selection.cursor];
    if (cursor) highlights.set(cursor, 'cursor');
  }
  view.setHighlights(highlights);
  drawCompass();
  renderHud();
  if (mode === 'over' && !summaryShown && !busy()) showSummary();
}

function renderHud() {
  let headline;
  let hint = '';
  let pattern = null;

  if (revealing) {
    headline = 'Behind the illusion';
    hint = 'The dashed lines show how far apart the joined strips really are';
  } else if (mode === 'chamber') {
    headline = 'Earning letters in the Hyperbolic Chamber';
  } else if (mode === 'over') {
    const played = game.history.filter((turn) => turn.type === 'word');
    const best = played.reduce((top, turn) => (turn.points.total > (top?.points.total ?? -1) ? turn : top), null);
    headline = `Run complete: ${game.score} points`;
    hint = best
      ? `${played.length} word${played.length > 1 ? 's' : ''}, best ${best.word} for ${best.points.total}. Orbit as long as you like.`
      : 'No words this time. Orbit as long as you like.';
  } else if ((mode === 'placing' || mode === 'checking') && selection) {
    const { chain } = selection;
    const surfaces = new Set(chain.slotLines).size;
    const { bonuses } = game;
    headline = chain.cyclic
      ? `Endless loop of ${chain.slots.length} tiles: words can wrap around`
      : `${placementDirection(board, chain, lockedDir)} · ${chain.slots.length} tiles${surfaces > 1 ? ` across ${surfaces} surfaces` : ''}`;
    if (mode === 'checking') hint = 'Checking with the Scrabble dictionary…';
    else if (chain.hiddenSlots?.length) hint = 'Dashed squares are on this line, underneath another block: click them in the word strip.';
    else hint = 'Type or tap letters · Enter to play · Backspace to undo · Esc to cancel';
    pattern = chain.slots.map((key, i) => ({
      letter: letterAt(game, key),
      pending: game.pending.some((tile) => tile.slot === key),
      cursor: i === selection.cursor,
      joint: i > 0 && chain.slotLines[i] !== chain.slotLines[i - 1],
      bonus: !letterAt(game, key) ? (bonuses.get(key) ?? null) : null,
      covered: chain.hiddenSlots?.includes(key) ?? false,
    }));
    const reachable = chain.slots.filter((key) => !game.letters.has(key) && bonuses.has(key));
    if (reachable.length) headline += ` · ${reachable.map((key) => bonuses.get(key)).join(', ')} in reach`;
  } else if (mode === 'placing') {
    headline = 'View locked';
    hint = 'Click a tile to choose a line · Esc to unlock';
  } else {
    const joined = current.chains.filter(isJoined);
    const near = nearestVantage(board, viewDir());
    if (joined.length) {
      const loops = joined.filter((chain) => chain.cyclic).length;
      headline = `Vantage point! ${joined.length} line${joined.length > 1 ? 's' : ''} joined`;
      if (loops) headline += ' + an endless loop';
      hint = 'Click a glowing tile to play along it · Words must use a letter already on the board';
      // The first turn, from the home view: point at the illusion itself.
      // The first turn: point at the illusion itself.
      const hooked = joined.find((chain) => !chain.cyclic && chain.slots.some((key) => letterAt(game, key)));
      if (!game.history.length && hooked) {
        const letters = hooked.slots.map((key) => letterAt(game, key)).join('');
        hint = `${letters} floats blocks away, yet from here a row of empty tiles runs straight into it. Click a glowing tile next to it and type letters to make a word.`;
      }
    } else {
      headline = near && near.angle < HINT_ANGLE ? 'Something lines up nearby…' : 'Find where the strips line up';
      hint = !game.history.length
        ? 'Drag to orbit until two strips meet, or press Isometric view · The compass shows where to look'
        : 'Drag to orbit · Click any tile to start a word';
    }
  }

  const placing = mode === 'placing';
  const canSwitch = placing && Boolean(selection) && lineOptions(selection.clicked).length > 1;
  let switchLabel = 'Switch line';
  if (canSwitch) {
    const options = lineOptions(selection.clicked);
    const next = options[(options.indexOf(selection.chain) + 1) % options.length];
    switchLabel = `Switch to ${placementDirection(board, next, lockedDir)} (${next.slots.length} tiles)`;
  }
  hud.render({
    game,
    placing,
    busy: busy(),
    over: mode === 'over',
    canPlace: placing && Boolean(selection) && !busy(),
    canIso: canLook(),
    canReveal: canLook() && current.chains.some(isJoined),
    canSwing: canLook() && mode === 'explore' && Boolean(board.bridgeCells.size),
    canSwitch,
    switchLabel,
    headline,
    hint,
    pattern,
    message,
  });
  document.getElementById('lab-open').disabled = !canLook();
  document.getElementById('swing').hidden = !LEVEL.bridge;
  const strip = document.getElementById('players');
  strip.hidden = players.length < 2;
  if (players.length > 1) renderStandings(strip);
  // On the very first turn, point at the button that shows the trick.
  document
    .getElementById('iso')
    .classList.toggle('nudge', !game.history.length && canLook() && !current.chains.some(isJoined));
}

// The compass: every view direction seen from above, the centre straight down
// and the ring the horizon (distance from the centre is the angle from
// straight down). Each vantage point is a dot to click; the camera is the
// orange dot, so the player can see which way to orbit.
const COMPASS_RADIUS = 40;
const compassVantages = document.getElementById('compass-vantages');
const compassYou = document.getElementById('compass-you');
const compassPoint = (dir) => {
  const [x, y, z] = normalize(dir);
  const r = (COMPASS_RADIUS * Math.acos(Math.max(-1, Math.min(1, y)))) / (Math.PI / 2);
  const flat = Math.hypot(x, z) || 1;
  return [(r * x) / flat, (r * z) / flat];
};
// Vantage points are found again whenever the board is rebuilt, so they are
// matched by direction.
const dirKey = (dir) => dir.map((v) => Math.sign(Math.round(v * 1000))).join(',');
const compassDots = board.vantages.map((vantage) => {
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const [cx, cy] = compassPoint(vantage.dir);
  dot.setAttribute('cx', cx);
  dot.setAttribute('cy', cy);
  dot.setAttribute('r', 6);
  dot.setAttribute('class', 'vantage');
  dot.addEventListener('click', () => canLook() && animateTo(vantage.dir));
  compassVantages.append(dot);
  return { dot, key: dirKey(vantage.dir) };
});

function drawCompass() {
  const dir = viewDir();
  const [cx, cy] = compassPoint(dir);
  compassYou.setAttribute('cx', cx);
  compassYou.setAttribute('cy', cy);
  const near = nearestVantage(board, dir);
  const nearKey = near && dirKey(near.vantage.dir);
  for (const { dot, key } of compassDots) {
    const here = nearKey === key && current.chains.some(isJoined);
    dot.classList.toggle('here', here);
    dot.classList.toggle('near', !here && nearKey === key && near.angle < HINT_ANGLE);
  }
}

// Swings the camera around the target to look from dir.
function animateTo(dir, then) {
  const offset = camera.position.clone().sub(controls.target);
  snap = {
    target: controls.target.clone(),
    from: offset.clone().normalize(),
    to: new THREE.Vector3(...dir).normalize(),
    distance: offset.length(),
    start: performance.now(),
    then,
  };
  controls.enabled = false;
  renderHud();
}

function stepSnap(now) {
  const t = Math.min(1, (now - snap.start) / SNAP_MS);
  const eased = 1 - (1 - t) ** 3;
  const turn = new THREE.Quaternion().setFromUnitVectors(snap.from, snap.to);
  const dir = snap.from.clone().applyQuaternion(new THREE.Quaternion().slerp(turn, eased));
  camera.position.copy(snap.target).addScaledVector(dir, snap.distance);
  controls.update();
  if (t === 1) {
    const { then } = snap;
    snap = null;
    controls.enabled = (mode === 'explore' || mode === 'over') && !revealing;
    then?.();
  }
  refresh();
}

function snapIfNear(then) {
  const near = nearestVantage(board, viewDir());
  if (near && near.angle > 1e-4 && near.angle <= SNAP_ANGLE) animateTo(near.vantage.dir, then);
  else then?.();
}

let dragged = false;
controls.addEventListener('start', () => (dragged = false));
controls.addEventListener('change', () => {
  dragged = true;
  if (!snap) refresh();
});
controls.addEventListener('end', () => {
  if (dragged && mode === 'explore') snapIfNear();
});

// The Hyperbolic Chamber fills the rack: the better the score there, the
// better the letters (each new tile is the best of score + 1 draws).
// After the first visit the chamber can be skipped, for a plain draw.
async function earnLetters(title) {
  if (!game.bag.length || game.rack.length >= RACK_SIZE) return;
  mode = 'chamber';
  controls.enabled = false;
  renderHud();
  // ?skip in the address offers the skip from the very first visit, for demos.
  const skippable = chamberStats.rounds > 0 || new URLSearchParams(window.location.search).has('skip');
  const { score, skipped } = await chamber.play({ title, skippable });
  if (!skipped) {
    chamberStats.right += score;
    chamberStats.rounds += 3;
    rewardMissions(completeMissions(game.missions, { chamber: score }));
  }
  const drawn = refillRack(game, score + 1);
  mode = isOver(game) ? 'over' : 'explore';
  controls.enabled = true;
  const first = !game.history.length;
  setMessage(
    first
      ? `New letters: ${drawn.join(' ')}. Now press “Isometric view” at the top left.`
      : `New letters: ${drawn.join(' ')}`,
    'success',
    first ? 12000 : 5000,
  );
  refresh();
}

// Swings the camera away from the vantage point and back, with dashed lines
// across every hidden gap, so the player sees the strips come apart.
function reveal() {
  const joined = current.chains.filter(isJoined);
  if (!canLook() || !joined.length) return;
  revealing = true;
  sound.reveal();
  for (const chain of joined) drawGhosts(chain);
  const home = viewDir();
  const away = new THREE.Vector3(...home).applyAxisAngle(new THREE.Vector3(0, 1, 0), REVEAL_TURN).toArray();
  animateTo(away, () =>
    setTimeout(
      () =>
        animateTo(home, () => {
          revealing = false;
          ghosts.clear(); // the dash and dot geometries are shared and kept
          controls.enabled = mode === 'explore' || mode === 'over';
          refresh();
        }),
      REVEAL_HOLD_MS,
    ),
  );
  refresh();
}

function drawGhosts(chain) {
  const n = chain.slots.length;
  for (let i = 0; i < (chain.cyclic ? n : n - 1); i++) {
    const j = (i + 1) % n;
    if (chain.slotLines[i] === chain.slotLines[j]) continue;
    const [from, to] = [chain.slots[i], chain.slots[j]].map((key) => {
      const slot = board.slots.get(key);
      return new THREE.Vector3(...slot.center).addScaledVector(new THREE.Vector3(...slot.normal), 0.12);
    });
    const along = to.clone().sub(from);
    const gap = along.length();
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.clone().normalize());
    for (let s = 0; s < gap; s += GHOST_DASH + GHOST_GAP) {
      const size = Math.min(GHOST_DASH, gap - s);
      const dash = new THREE.Mesh(ghostDash, ghostMaterial);
      dash.position.copy(from).addScaledVector(along, (s + size / 2) / gap);
      dash.quaternion.copy(turn);
      dash.scale.y = size;
      dash.renderOrder = 2;
      ghosts.add(dash);
    }
    for (const end of [from, to]) {
      const dot = new THREE.Mesh(ghostEnd, ghostMaterial);
      dot.position.copy(end);
      dot.renderOrder = 2;
      ghosts.add(dot);
    }
  }
}

// Freezes the view as it is. Snapping here could move another block over the
// clicked tile, so the camera only snaps when a drag ends.
function lockView(key) {
  if (mode !== 'explore' || busy()) return;
  mode = 'placing';
  controls.enabled = false;
  lockedDir = viewDir();
  current = chainsForView(board, lockedDir, undefined, true);
  selection = null;
  if (key) selectSlot(key);
  else refresh();
}

function exitPlacing() {
  if (mode !== 'placing' || busy()) return;
  for (const key of cancelPending(game)) view.setTile(key, '', 'empty');
  selection = null;
  lockedDir = null;
  mode = isOver(game) ? 'over' : 'explore';
  controls.enabled = true;
  refresh();
}

// The lines through a slot, across first (see placement.js).
function lineOptions(key) {
  return placementOptions(board, current, key, lockedDir ?? viewDir());
}

// Picks a line through the slot. Choosing the same slot again, or the switch
// button, moves on to its next line.
function selectSlot(key, toggle = false) {
  const options = lineOptions(key);
  if (!options.length) {
    setMessage('No line runs through that tile from here.', 'error');
    return;
  }
  const chain = toggle && selection ? options[(options.indexOf(selection.chain) + 1) % options.length] : options[0];
  selection = { chain, cursor: 0, clicked: key };
  selection.cursor = cursorFrom(chain.slots.indexOf(key));
  refresh();
}

// Clicking a square in the word strip, which also reaches squares covered by
// another block, moves the cursor there.
function selectPatternSlot(index) {
  if (mode !== 'placing' || !selection || busy()) return;
  if (!Number.isInteger(index) || index < 0 || index >= selection.chain.slots.length) return;
  selection.cursor = cursorFrom(index);
  refresh();
}

// Where typing goes after choosing slot i: the first empty slot from there,
// or the first one on the line if everything after i is full.
function cursorFrom(i) {
  const at = nextEmpty(i);
  if (at !== -1) return at;
  const first = nextEmpty(0);
  return first === -1 ? selection.chain.slots.length : first;
}

// The first empty slot at or after from; loops wrap around.
function nextEmpty(from) {
  const { slots, cyclic } = selection.chain;
  for (let k = 0; k < slots.length; k++) {
    const i = cyclic ? (from + k) % slots.length : from + k;
    if (i >= slots.length) break;
    if (!letterAt(game, slots[i])) return i;
  }
  return -1;
}

function placeFromRack(index) {
  if (mode === 'over' || busy()) return;
  if (mode !== 'placing' || !selection) {
    setMessage('Click a tile first to choose where your word goes.', 'error');
    return;
  }
  const at = nextEmpty(selection.cursor);
  if (at === -1) {
    setMessage('No empty tiles left on this line.', 'error');
    return;
  }
  const key = selection.chain.slots[at];
  const letter = game.rack[index];
  if (!placeTile(game, key, index)) return;
  sound.place(game.pending.length - 1);
  view.setTile(key, letter, 'pending');
  const next = nextEmpty(at + 1);
  selection.cursor = next === -1 ? selection.chain.slots.length : next;
  refresh();
}

function typeLetter(letter) {
  const index = game.rack.indexOf(letter);
  if (index === -1 && mode === 'placing') setMessage(`There's no ${letter} in your rack.`, 'error');
  else placeFromRack(index);
}

function undo() {
  if (mode !== 'placing' || busy()) return;
  const key = undoTile(game);
  if (!key) return;
  sound.undo();
  view.setTile(key, '', 'empty');
  if (selection) selection.cursor = selection.chain.slots.indexOf(key);
  refresh();
}

// Checks the word (and any words made sideways) with the dictionary, then
// scores it and sends the player to earn more letters.
async function play() {
  if (mode !== 'placing' || !selection || busy()) return;
  const prepared = preparePlay(game, selection.chain, lockedDir);
  if (prepared.error) {
    setMessage(prepared.error, 'error');
    return;
  }

  mode = 'checking';
  setMessage(`Checking ${prepared.words.join(', ')}…`, 'info', 0);
  let results;
  try {
    results = await words.checkAll(prepared.words);
  } catch {
    mode = 'placing';
    setMessage('Could not reach a dictionary. Check your connection and try again.', 'error');
    return;
  }
  mode = 'placing';
  const rejected = results.filter((result) => !result.valid);
  if (rejected.length) {
    const source = rejected[0].source;
    setMessage(`${rejected.map((r) => r.word).join(', ')} isn't in the Scrabble dictionary (${source}).`, 'error');
    return;
  }

  const { word, placed, points } = commitPlay(game, prepared);
  game.history.at(-1).player = players[seated].name;
  for (const tile of placed) view.setTile(tile.slot, tile.letter, 'fixed');
  const sources = [...new Set(results.map((result) => result.source))].join(' + ');
  setMessage(`${word}: ${describePoints(points)} · checked with ${sources}`, 'success', 7000);
  exitPlacing();
  // A moment to enjoy the word, and watch the traveller walk it, before the
  // chamber opens.
  celebrating = true;
  celebrate(prepared, points);
  const walk = traveller.walkAlong(prepared.main.slots.map((key) => board.slots.get(key)));
  rewardMissions(completeMissions(game.missions, { turn: game.history.at(-1) }));
  await new Promise((resolve) => setTimeout(resolve, Math.max(CELEBRATE_MS, walk * 1000 + 400)));
  celebrating = false;
  refresh();
  if (mode !== 'over') await endTurn('Earn letters for your next word');
}

// The word's tiles bounce in turn, flashing gold if it crossed the illusion;
// the score rises over the monument; big words throw confetti.
function celebrate(prepared, points) {
  const crossed = points.surfaces > 1;
  view.celebrate(prepared.main.slots, crossed);
  sound.word(points.total);
  const details = [];
  if (crossed) details.push(`Across the illusion ×${points.surfaces}`);
  if (points.bingo) details.push('All seven tiles +50');
  showPopup(`+${points.total}`, details, points.total >= 40);
  if (crossed || points.total >= 40) confetti.burst(window.innerWidth / 2, window.innerHeight * 0.4, crossed ? 90 : 60);
}

function showPopup(points, details = [], big = false, tone = '') {
  const popup = document.getElementById('popup');
  const card = document.createElement('div');
  card.className = 'pop';
  const value = document.createElement('span');
  value.className = `points${big ? ' big' : ''}`;
  value.textContent = points;
  card.append(value);
  for (const text of details) {
    const detail = document.createElement('span');
    detail.className = `detail ${tone}`;
    detail.textContent = text;
    card.append(document.createElement('br'), detail);
  }
  popup.replaceChildren(card);
  card.addEventListener('animationend', () => card.remove());
}

// Missions just finished: points, a cheer and a tick.
function rewardMissions(finished) {
  if (!finished.length) return;
  for (const mission of finished) game.score += MISSION_POINTS;
  sound.right();
  const text = finished.map((mission) => `Mission: ${mission.text}`);
  setTimeout(() => {
    showPopup(`+${MISSION_POINTS * finished.length}`, text, false, 'mission');
    confetti.burst(130, 200, 50);
  }, 900);
  renderMissions(finished);
  renderHud();
}

function renderMissions(just = []) {
  document.getElementById('missions-title').textContent =
    players.length > 1 ? `${players[seated].name}'s missions` : 'Missions';
  document.getElementById('mission-list').replaceChildren(
    ...game.missions.map((mission) => {
      const item = document.createElement('li');
      item.textContent = mission.text;
      item.classList.toggle('done', mission.done);
      item.classList.toggle('just', just.includes(mission));
      return item;
    }),
  );
}
renderMissions();

// Swings the bridge to its other position: the blocks turn, then the board
// is rebuilt so its lines, joins and vantage points follow. Free, so players
// can try both ways round.
function swing() {
  if (!canLook() || mode !== 'explore') return;
  const cells = board.bridgeCells;
  const result = swingBridge(game);
  if (!result) return;
  // Each quarter turn takes +x to +z, a turn of -90° about the vertical.
  let angle = (-result.turns * Math.PI) / 2;
  if (angle < -Math.PI) angle += 2 * Math.PI;
  swinging = { start: performance.now(), angle, cells, next: result.board };
  controls.enabled = false;
  sound.walk();
  setHover(null);
  renderHud();
}

function stepSwing(now) {
  const t = Math.min(1, (now - swinging.start) / SWING_MS);
  const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
  view.swing(swinging.cells, LEVEL.bridge.pivot, swinging.angle * eased);
  if (t < 1) return;
  board = swinging.next;
  swinging = null;
  view.dispose();
  view = new BoardView(board, scene, game.bonuses);
  for (const [key, letter] of game.letters) view.setTile(key, letter, 'fixed');
  visibleCache = { key: '', view: null };
  if (!board.slots.has(traveller.slot?.key)) traveller.standOn(startSlot());
  else traveller.standOn(board.slots.get(traveller.slot.key));
  controls.enabled = mode === 'explore' || mode === 'over';
  sound.snap();
  const onBridge = (key) => board.bridgeCells.has(board.slots.get(key).cell.join(','));
  const joined = chainsForView(board, viewDir())
    .chains.filter(isJoined)
    .some((chain) => chain.slots.some(onBridge));
  setMessage(
    joined
      ? 'The bridge has joined a new line from here.'
      : game.bridge
        ? 'The bridge now points at TION. Find the corner where they meet: try the top-left dot on the compass.'
        : 'The bridge now points at the crown. Find the corner where they meet: try the bottom-right dot on the compass.',
    'success',
  );
  refresh();
}

function describePoints({ letters, wordMultiplier, surfaces, cross, bingo, bonuses, total }) {
  let sum = `${letters}`;
  if (wordMultiplier > 1) sum += ` × ${wordMultiplier} word bonus`;
  if (surfaces > 1) sum += ` × ${surfaces} surfaces`;
  for (const word of cross) sum += ` + ${word.word} ${word.total}`;
  if (bingo) sum += ` + ${bingo} for using all seven tiles`;
  const found = bonuses.length ? ` (${bonuses.map((kind) => BONUS_KINDS[kind].name).join(', ')})` : '';
  return sum === String(total) ? `${total} points${found}` : `${sum} = ${total} points${found}`;
}

async function swap() {
  if (mode !== 'explore' || busy() || !swapRack(game)) return;
  if (isOver(game)) {
    mode = 'over';
    refresh();
    return;
  }
  await endTurn('Earn new letters');
}

// After a word or a swap: with more than one player, the next one takes the
// seat and the screen is passed to them; then whoever is seated tops up
// their letters in the chamber.
async function endTurn(title) {
  if (players.length > 1) {
    seated = seat(game, players, seated, (seated + 1) % players.length);
    renderMissions();
    if (isOver(game)) {
      mode = 'over';
      refresh();
      return;
    }
    await handoff(players[seated]);
    title = game.rack.length ? title : 'Earn your first letters';
  }
  await earnLetters(players.length > 1 ? `${players[seated].name}: ${title.toLowerCase()}` : title);
}

// The card between turns, so the next player's letters stay hidden until
// they take the screen.
function handoff(player) {
  mode = 'handoff';
  controls.enabled = false;
  renderHud();
  const card = document.getElementById('handoff');
  document.getElementById('handoff-name').textContent = `${player.name}'s turn`;
  renderStandings(document.getElementById('handoff-scores'));
  card.hidden = false;
  sound.snap();
  return new Promise((resolve) => {
    document.getElementById('handoff-ready').onclick = () => {
      card.hidden = true;
      mode = 'explore';
      resolve();
    };
  });
}

// Every player's score, best first, with the one in the seat marked.
function renderStandings(list, { final = false } = {}) {
  seat(game, players, seated, seated); // bring the seated player's score up to date
  const ranked = standings(players);
  list.replaceChildren(
    ...ranked.map((player) => {
      const item = document.createElement('li');
      item.classList.toggle('active', !final && player.name === players[seated].name);
      item.classList.toggle('winner', final && player.place === 1);
      const name = document.createElement('span');
      name.textContent = `${final ? `${player.place}. ` : ''}${player.name}`;
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = player.score;
      item.append(name, score);
      return item;
    }),
  );
}

function finish() {
  if (busy() || mode === 'over') return;
  exitPlacing();
  finishRun(game);
  mode = 'over';
  controls.enabled = true;
  refresh();
}

const raycaster = new THREE.Raycaster();
const pointerDown = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerDown.set(event.clientX, event.clientY);
  setHover(null);
});

// While exploring, the line a click would choose lights up under the pointer.
// The visible lines are worked out once per view, as a click does.
let hoverPoint = null;
let hoverQueued = false;
let visibleCache = { key: '', view: null };
function visibleLines() {
  const dir = viewDir();
  const key = dir.map((v) => v.toFixed(4)).join(',');
  if (visibleCache.key !== key) visibleCache = { key, view: chainsForView(board, dir, undefined, true) };
  return visibleCache.view;
}
function setHover(chain) {
  if (chain === hover) return;
  hover = chain;
  renderer.domElement.style.cursor = chain ? 'pointer' : '';
  refresh();
}
function updateHover() {
  hoverQueued = false;
  if (!hoverPoint || mode !== 'explore' || busy() || controls.state !== -1) return setHover(null);
  raycaster.setFromCamera(hoverPoint, camera);
  const key = view.pick(raycaster);
  setHover(key ? (placementOptions(board, visibleLines(), key, viewDir())[0] ?? null) : null);
}
renderer.domElement.addEventListener('pointermove', (event) => {
  if (event.buttons) return;
  hoverPoint = new THREE.Vector2((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
  if (!hoverQueued) {
    hoverQueued = true;
    requestAnimationFrame(updateHover);
  }
});
renderer.domElement.addEventListener('pointerleave', () => {
  hoverPoint = null;
  setHover(null);
});
renderer.domElement.addEventListener('pointerup', (event) => {
  if (busy() || pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 6) {
    return;
  }
  const ndc = new THREE.Vector2(
    (event.clientX / window.innerWidth) * 2 - 1,
    -(event.clientY / window.innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, camera);
  const key = view.pick(raycaster);
  if (!key) return;

  if (mode === 'explore') {
    lockView(key);
  } else if (mode === 'placing') {
    const slots = selection?.chain.slots ?? [];
    if (key === selection?.clicked && !game.pending.length) {
      selectSlot(key, true);
    } else if (slots.includes(key)) {
      selection.clicked = key;
      selection.cursor = cursorFrom(slots.indexOf(key));
      refresh();
    } else if (game.pending.length) {
      setMessage('Play or cancel your word before choosing another line.', 'error');
    } else {
      selectSlot(key);
    }
  }
});

window.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || busy()) return;
  if (event.target.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  // Enter still plays after clicking the word strip or rack; other buttons
  // keep their own Enter, and Space always presses the focused button.
  if (event.target.closest?.('button')) {
    if (event.key === ' ') return;
    if (event.key === 'Enter' && (!game.pending.length || !event.target.closest('#pattern, #rack'))) return;
  }
  if (/^[a-z]$/i.test(event.key)) typeLetter(event.key.toUpperCase());
  else if (event.key === 'Enter') play();
  else if (event.key === 'Backspace') undo();
  else if (event.key === 'Escape') exitPlacing();
  else if (event.key === ' ' && mode === 'explore') lockView(null);
  else if (event.key === ' ' && mode === 'placing' && !game.pending.length) exitPlacing();
  else return;
  event.preventDefault();
});

// The end of a run: the score, every word and how the chamber went.
function showSummary() {
  summaryShown = true;
  sound.finish();
  const played = game.history.filter((turn) => turn.type === 'word');
  const best = played.reduce((top, turn) => (turn.points.total > (top?.points.total ?? -1) ? turn : top), null);
  const joined = played.filter((turn) => turn.points.surfaces > 1).length;
  seat(game, players, seated, seated); // bring the seated player's score up to date
  const ranked = standings(players);
  const multi = players.length > 1;
  const winners = ranked.filter(({ place }) => place === 1);
  document.getElementById('summary-title').textContent = !multi
    ? 'Run complete'
    : winners.length > 1
      ? `A tie: ${winners.map(({ name }) => name).join(' and ')}`
      : `${winners[0].name} wins!`;
  document.getElementById('summary-points').textContent = multi ? ranked[0].score : game.score;
  const standingsList = document.getElementById('summary-standings');
  standingsList.hidden = !multi;
  if (multi) renderStandings(standingsList, { final: true });
  const fresh = saveScores(
    players.map(({ name, score }) => ({
      name,
      score,
      map: LEVEL.id,
      words: played.filter((turn) => turn.player === name).length,
    })),
  );
  renderScores(document.getElementById('summary-scores'), fresh);
  const stats = [
    ['Words', played.length],
    ['Across the illusion', joined],
    ['Crystals found', chamberStats.rounds ? `${chamberStats.right} of ${chamberStats.rounds}` : '—'],
  ];
  document.getElementById('summary-stats').replaceChildren(
    ...stats.map(([label, value]) => {
      const item = document.createElement('div');
      item.innerHTML = '<dt></dt><dd></dd>';
      item.querySelector('dt').textContent = label;
      item.querySelector('dd').textContent = value;
      return item;
    }),
  );
  document.getElementById('summary-words').replaceChildren(
    ...(played.length ? played : [null]).map((turn) => {
      const item = document.createElement('li');
      if (!turn) {
        item.textContent = 'No words this time. The strips are still waiting to meet.';
        return item;
      }
      item.classList.toggle('best', turn === best);
      const detail = turn.points.surfaces > 1 ? ` · ${turn.points.surfaces} surfaces` : '';
      item.innerHTML = '<span class="word"></span><span class="detail"></span>';
      item.querySelector('.word').textContent = multi ? `${turn.word} · ${turn.player}` : turn.word;
      item.querySelector('.detail').textContent = `${turn.points.total} pts${detail}`;
      return item;
    }),
  );
  document.getElementById('summary-missions').replaceChildren(
    // Everyone has the same missions: one row each, naming who finished it.
    ...players[0].missions.map((mission, i) => {
      const finishers = players.filter((player) => player.missions[i].done).map(({ name }) => name);
      const item = document.createElement('li');
      const credit = !finishers.length ? '' : multi ? ` (${finishers.join(', ')} +${MISSION_POINTS})` : ` (+${MISSION_POINTS})`;
      item.textContent = `${mission.text}${credit}`;
      item.classList.toggle('done', finishers.length > 0);
      return item;
    }),
  );
  document.getElementById('summary').hidden = false;
  if (game.score > 0) confetti.burst(window.innerWidth / 2, window.innerHeight * 0.35, 120);
}

document.getElementById('summary-again').addEventListener('click', () => window.location.reload());
document.getElementById('summary-look').addEventListener('click', () => {
  document.getElementById('summary').hidden = true;
});

// The Hyperbolic Lab can be opened from the title screen or between turns.
async function openLab() {
  if (labOpen || (mode !== 'intro' && !canLook())) return;
  sound.unlock();
  labOpen = true;
  const intro = document.getElementById('intro');
  const fromIntro = !intro.hidden;
  intro.hidden = true;
  controls.enabled = false;
  renderHud();
  await lab.open();
  labOpen = false;
  intro.hidden = !fromIntro;
  controls.enabled = mode === 'explore' || mode === 'over';
  refresh();
}
document.getElementById('lab-open').addEventListener('click', openLab);
document.getElementById('intro-lab').addEventListener('click', openLab);

document.body.classList.add('intro');
// The title screen's choices: the map (a reload, so the monument behind the
// title changes), how many play and their names, remembered for next time.
const SETUP_KEY = 'vantage-setup';
let setup = { count: 1, names: [] };
try {
  setup = { ...setup, ...JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}') };
} catch {
  // No storage: the defaults will do.
}
const saveSetup = () => {
  try {
    localStorage.setItem(SETUP_KEY, JSON.stringify(setup));
  } catch {
    // Remembered for this visit only.
  }
};

const mapChoice = document.getElementById('map-choice');
mapChoice.replaceChildren(
  ...MAPS.map((level) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = level.name.replace(/^The /, '');
    button.setAttribute('aria-pressed', String(level === LEVEL));
    button.addEventListener('click', () => {
      if (level === LEVEL) return;
      const url = new URL(window.location.href);
      url.searchParams.set('map', level.id);
      window.location.assign(url);
    });
    return button;
  }),
);
document.getElementById('map-blurb').textContent = LEVEL.blurb;

function renderSetup() {
  for (const button of document.querySelectorAll('#player-count [data-count]')) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.count) === setup.count));
  }
  const names = document.getElementById('player-names');
  names.replaceChildren(
    ...Array.from({ length: setup.count }, (_, i) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 16;
      input.placeholder = setup.count === 1 ? 'Your name' : `Player ${i + 1}`;
      input.value = setup.names[i] ?? '';
      input.setAttribute('aria-label', setup.count === 1 ? 'Your name' : `Player ${i + 1}'s name`);
      input.addEventListener('input', () => {
        setup.names[i] = input.value;
        saveSetup();
      });
      return input;
    }),
  );
}
for (const button of document.querySelectorAll('#player-count [data-count]')) {
  button.addEventListener('click', () => {
    setup.count = Math.min(MAX_PLAYERS, Number(button.dataset.count));
    saveSetup();
    renderSetup();
  });
}
renderSetup();

// The best scores on a map, into a list; entries just saved are marked.
function renderScores(list, fresh = []) {
  const best = topScores(LEVEL.id);
  if (!best.length) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = 'No scores yet. Be the first.';
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(
    ...best.map((entry) => {
      const item = document.createElement('li');
      item.classList.toggle('new', fresh.some((f) => f.at === entry.at && f.name === entry.name));
      for (const [cls, text] of [
        ['place', `${entry.place}.`],
        ['name', entry.name],
        ['score', entry.score],
      ]) {
        const part = document.createElement('span');
        part.className = cls;
        part.textContent = text;
        item.append(part);
      }
      return item;
    }),
  );
}
renderScores(document.getElementById('intro-scores'));

document.getElementById('intro-play').addEventListener('click', () => {
  sound.unlock();
  players = createPlayers(Array.from({ length: setup.count }, (_, i) => setup.names[i] ?? ''), LEVEL);
  seated = seat(game, players, null, 0);
  game.turnsLeft = turnsFor(LEVEL, players.length);
  renderMissions();
  document.getElementById('intro').hidden = true;
  document.body.classList.remove('intro');
  mode = 'explore';
  const title = players.length > 1 ? `${players[0].name}: earn your first letters` : 'Earn your first letters';
  animateTo(OVERHEAD, () => earnLetters(title));
});

const muteButton = document.getElementById('mute');
const showMute = () => {
  muteButton.textContent = sound.muted ? 'Sound off' : 'Sound on';
  muteButton.setAttribute('aria-pressed', String(sound.muted));
};
muteButton.addEventListener('click', () => {
  sound.unlock();
  sound.toggleMute();
  showMute();
});
showMute();
// Any interaction may start the audio; browsers refuse it before one.
window.addEventListener('pointerdown', () => sound.unlock(), { once: true });

refresh();
let frame = 0;
let lastTime = 0;
renderer.setAnimationLoop((time) => {
  const dt = Math.min(0.05, (time - (lastTime || time)) / 1000);
  lastTime = time;
  // While another screen has the page, the monument behind it barely moves.
  if ((chamber.isOpen() || lab.isOpen()) && frame++ % 20) return;
  if (mode === 'intro' && !labOpen) {
    // Orbit controls report the change, which refreshes the glow.
    camera.position.sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), INTRO_SPIN * dt).add(controls.target);
    controls.update();
  }
  if (snap) stepSnap(performance.now());
  if (swinging) stepSwing(performance.now());
  view.animate(time / 1000);
  traveller.update(time / 1000);
  renderer.render(scene, camera);
});

// Lets browser tests find tiles on screen.
if (import.meta.env.DEV) {
  window.vantage = {
    game,
    slotOnScreen(key) {
      const point = new THREE.Vector3(...board.slots.get(key).center).project(camera);
      return { x: ((point.x + 1) / 2) * window.innerWidth, y: ((1 - point.y) / 2) * window.innerHeight };
    },
    mode: () => mode,
    lookFrom: (dir) => animateTo(dir),
  };
}
