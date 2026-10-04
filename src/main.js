import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import wordsUrl from '../node_modules/word-list/words.txt?url';
import { createSound } from './audio.js';
import { buildBoard, chainsForView, isJoined, nearestVantage } from './board.js';
import { BONUS_KINDS } from './bonuses.js';
import { normalize, screenBasis } from './geometry.js';
import { createChamber } from './chamber.js';
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
  undoTile,
} from './game.js';
import { createHud } from './hud.js';
import { createLab } from './lab.js';
import { MONUMENT, VIEWS } from './level.js';
import { placementDirection, placementOptions } from './placement.js';
import { BoardView } from './scene.js';

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

const board = buildBoard(MONUMENT);
const game = createGame(MONUMENT, board);
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

const view = new BoardView(board, scene, game.bonuses);
for (const [key, letter] of game.letters) view.setTile(key, letter, 'fixed');

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
let message = null;
let messageTimer;
// The camera is moving, a screen is over the monument or words are being
// checked.
const busy = () =>
  Boolean(snap || revealing) || labOpen || mode === 'intro' || mode === 'chamber' || mode === 'checking';
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
      const home = joined.find((chain) => chain.slots.map((key) => letterAt(game, key) || '.').join('') === '.......ABLE');
      if (!game.history.length && home) {
        hint =
          'ABLE floats blocks away, yet from here the plaza row runs straight into it. Click the glowing tile just before A and type T, C or S (or start four back for LOVE).';
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
    canSwitch,
    switchLabel,
    headline,
    hint,
    pattern,
    message,
  });
  document.getElementById('lab-open').disabled = !canLook();
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
const compassDots = board.vantages.map((vantage) => {
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  const [cx, cy] = compassPoint(vantage.dir);
  dot.setAttribute('cx', cx);
  dot.setAttribute('cy', cy);
  dot.setAttribute('r', 6);
  dot.setAttribute('class', 'vantage');
  dot.addEventListener('click', () => canLook() && animateTo(vantage.dir));
  compassVantages.append(dot);
  return { dot, vantage };
});

function drawCompass() {
  const dir = viewDir();
  const [cx, cy] = compassPoint(dir);
  compassYou.setAttribute('cx', cx);
  compassYou.setAttribute('cy', cy);
  const near = nearestVantage(board, dir);
  for (const { dot, vantage } of compassDots) {
    const here = near?.vantage === vantage && current.chains.some(isJoined);
    dot.classList.toggle('here', here);
    dot.classList.toggle('near', !here && near?.vantage === vantage && near.angle < HINT_ANGLE);
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
  const { score, skipped } = await chamber.play({ title, skippable: chamberStats.rounds > 0 });
  if (!skipped) {
    chamberStats.right += score;
    chamberStats.rounds += 3;
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
  for (const tile of placed) view.setTile(tile.slot, tile.letter, 'fixed');
  sound.word(points.total);
  const sources = [...new Set(results.map((result) => result.source))].join(' + ');
  setMessage(`${word}: ${describePoints(points)} · checked with ${sources}`, 'success', 7000);
  exitPlacing();
  if (mode !== 'over') await earnLetters('Earn letters for your next word');
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
  await earnLetters('Earn new letters');
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
  document.getElementById('summary-points').textContent = game.score;
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
      item.querySelector('.word').textContent = turn.word;
      item.querySelector('.detail').textContent = `${turn.points.total} pts${detail}`;
      return item;
    }),
  );
  document.getElementById('summary').hidden = false;
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
document.getElementById('intro-play').addEventListener('click', () => {
  sound.unlock();
  document.getElementById('intro').hidden = true;
  document.body.classList.remove('intro');
  mode = 'explore';
  animateTo(OVERHEAD, () => earnLetters('Earn your first letters'));
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
  view.animate(time / 1000);
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
