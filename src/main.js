import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import wordsUrl from '../node_modules/word-list/words.txt?url';
import { buildBoard, chainsForView, isJoined, nearestVantage } from './board.js';
import { createDictionary } from './dictionary.js';
import { BONUS_KINDS } from './bonuses.js';
import {
  cancelPending,
  createGame,
  currentLevel,
  letterAt,
  placeTile,
  playWord,
  turnTurntable,
  undoTile,
} from './game.js';
import { createHud } from './hud.js';
import { BROKEN_CUBE } from './level.js';
import { BoardView } from './scene.js';
import { turntableCells, turntableOf } from './turntable.js';

const SNAP_ANGLE = THREE.MathUtils.degToRad(10); // release this close to a vantage and the camera snaps
const HINT_ANGLE = THREE.MathUtils.degToRad(20);
const SNAP_MS = 350;
const TURN_MS = 500;
const ISOMETRIC = [1, 1, 1];
const REVEAL_TURN = THREE.MathUtils.degToRad(40); // how far reveal swings the camera
const REVEAL_HOLD_MS = 1200;

let board = buildBoard(BROKEN_CUBE);
const game = createGame(BROKEN_CUBE, board);

// The word list is large, so it loads in the background while players explore.
let isWord = null;
fetch(wordsUrl)
  .then((response) => {
    if (!response.ok) throw new Error(`Dictionary request failed: ${response.status}`);
    return response.text();
  })
  .then((text) => (isWord = createDictionary(text)))
  .catch(() => setMessage('Could not load the dictionary. Check your connection and reload.', 'error'));

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f3ece2');
scene.add(new THREE.HemisphereLight('#fff6e8', '#8a7a99', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.4);
sun.position.set(10, 20, 6);
scene.add(sun);
// Undersides hold letters too, so light them from below.
const fill = new THREE.DirectionalLight('#ffffff', 0.9);
fill.position.set(-6, -12, -8);
scene.add(fill);

let view;
// (Re)draws the board, e.g. after the turntable turns.
function drawBoard() {
  view?.dispose();
  const level = currentLevel(game);
  const turntable = { cells: turntableCells(level), pivot: turntableOf(level).start };
  view = new BoardView(board, scene, turntable, game.bonuses);
  for (const [key, letter] of game.letters) if (board.slots.has(key)) view.setTile(key, letter, 'fixed');
}
drawBoard();


const bounds = new THREE.Box3();
for (const cell of board.cells) bounds.expandByPoint(new THREE.Vector3(...cell));
const target = bounds.getCenter(new THREE.Vector3());
const viewHeight = bounds.getSize(new THREE.Vector3()).length() * 0.9;

// Orthographic, so things at different depths can appear to touch.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 200);
function resize() {
  const aspect = window.innerWidth / window.innerHeight;
  const height = aspect < 1 ? viewHeight / aspect : viewHeight;
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
// Start away from every vantage point so the player has to find them.
camera.position.copy(target).add(new THREE.Vector3(1, 0.6, 0.3).setLength(40));
controls.update();

const viewDir = () => camera.position.clone().sub(controls.target).normalize().toArray();

let mode = 'explore'; // 'explore' | 'placing' | 'over'
let current = chainsForView(board, viewDir()); // every line, as seen from the camera
let selection = null; // { chain, cursor, clicked } while placing
let lockedDir = null;
let snap = null;
let revealing = false; // showing how far apart joined strips really are
let turning = null; // turntable animation in progress
let message = null;
let messageTimer;
const isBusy = () => Boolean(snap || revealing || turning);

const hud = createHud({
  onRack: placeFromRack,
  onPlay: play,
  onUndo: undo,
  onCancel: exitPlacing,
  onIso: () => mode === 'explore' && !isBusy() && animateTo(ISOMETRIC),
  onReveal: reveal,
  onTurn: turn,
  onPattern: selectPatternSlot,
  onSwitchLine: () => {
    if (selection && !game.pending.length && !isBusy()) selectSlot(selection.clicked, true);
  },
});

// Dashed lines across each hidden gap, drawn while revealing.
const ghosts = new THREE.Group();
scene.add(ghosts);
const ghostMaterial = new THREE.LineDashedMaterial({
  color: '#1fbfae',
  dashSize: 0.25,
  gapSize: 0.15,
  depthTest: false,
});

function setMessage(text, tone = 'info') {
  message = { text, tone };
  clearTimeout(messageTimer);
  messageTimer = setTimeout(() => {
    message = null;
    renderHud();
  }, 4000);
  renderHud();
}

function refresh() {
  if (mode !== 'placing' && !revealing) current = chainsForView(board, viewDir());
  view.orientLetters(camera);

  const highlights = new Map();
  for (const chain of current.chains.filter(isJoined)) {
    for (const key of chain.slots) highlights.set(key, 'aligned');
  }
  if (selection) {
    for (const key of selection.chain.slots) highlights.set(key, 'selected');
    const cursor = selection.chain.slots[selection.cursor];
    if (cursor) highlights.set(cursor, 'cursor');
  }
  view.setHighlights(highlights);
  view.setFocus(selection?.chain.slots ?? []);
  renderHud();
}

function renderHud() {
  let headline;
  let hint = '';
  let pattern = null;

  if (revealing) {
    headline = 'Behind the illusion';
    hint = 'The dashed lines show how far apart the joined strips really are';
  } else if (mode === 'over') {
    headline = `Run complete: ${game.score} points`;
    const words = game.history.filter((move) => move.type === 'word').length;
    hint = `You played ${words} word${words === 1 ? '' : 's'}. Orbit around to admire them.`;
  } else if (mode === 'placing' && selection) {
    const { chain } = selection;
    const surfaces = new Set(chain.slotLines).size;
    const { bonuses } = game;
    headline = chain.cyclic
      ? `Endless loop of ${chain.slots.length} tiles: words can wrap around`
      : `Line of ${chain.slots.length} tiles${surfaces > 1 ? ` across ${surfaces} surfaces` : ''}`;
    hint = 'Type or tap letters · Enter to play · Backspace to undo · Esc to cancel';
    pattern = chain.slots.map((key, i) => ({
      letter: letterAt(game, key),
      pending: game.pending.some((tile) => tile.slot === key),
      cursor: i === selection.cursor,
      joint: i > 0 && chain.slotLines[i] !== chain.slotLines[i - 1],
      bonus: !letterAt(game, key) ? (bonuses.get(key) ?? null) : null,
      covered: chain.hiddenSlots?.includes(key) ?? false,
    }));
    if (chain.hiddenSlots?.length) {
      hint = 'The full row stays playable under other blocks. Click a square above to place there.';
    }
    const reachable = chain.slots.filter((key) => !game.letters.has(key) && bonuses.has(key));
    if (reachable.length) {
      headline += ` · ${reachable.map((key) => bonuses.get(key)).join(', ')} in reach`;
    }
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
      hint = 'Click a glowing tile to play along it · Reveal to see the trick';
    } else {
      headline = near && near.angle < HINT_ANGLE ? 'Something lines up nearby…' : 'Find where the strips line up';
      hint = 'Drag to orbit · Click any tile to start a word';
    }
  }

  const busy = isBusy();
  const canReveal = !busy && mode !== 'placing' && current.chains.some(isJoined);
  const canTurn = !busy && mode === 'explore';
  const canSwitch = mode === 'placing' && selection && lineOptions(selection.clicked).length > 1;
  hud.render({
    game, placing: mode === 'placing', busy, canPlace: mode === 'placing' && Boolean(selection) && !busy,
    canIso: !busy && mode === 'explore', canReveal, canTurn, canSwitch,
    headline, hint, pattern, message,
  });
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
    controls.enabled = mode !== 'placing' && !revealing && !turning;
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

// Swings the camera away from the vantage point and back, with dashed lines
// across every hidden gap, so the player sees the strips come apart.
function reveal() {
  const joined = current.chains.filter(isJoined);
  if (isBusy() || mode === 'placing' || !joined.length) return;
  revealing = true;
  for (const chain of joined) drawGhosts(chain);
  const home = viewDir();
  const away = new THREE.Vector3(...home).applyAxisAngle(new THREE.Vector3(0, 1, 0), REVEAL_TURN).toArray();
  animateTo(away, () =>
    setTimeout(
      () =>
        animateTo(home, () => {
          revealing = false;
          for (const ghost of ghosts.children) ghost.geometry.dispose();
          ghosts.clear();
          controls.enabled = mode !== 'placing';
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
    const ends = [chain.slots[i], chain.slots[j]].map((key) => {
      const slot = board.slots.get(key);
      return new THREE.Vector3(...slot.center).addScaledVector(new THREE.Vector3(...slot.normal), 0.1);
    });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ends), ghostMaterial);
    line.computeLineDistances();
    line.renderOrder = 1;
    ghosts.add(line);
  }
}

// Spends a turn turning the turntable a quarter turn, animating it first.
function turn() {
  if (mode !== 'explore' || snap || revealing || turning) return;
  turning = { start: performance.now() };
  controls.enabled = false;
  renderHud();
}

function stepTurn(now) {
  const t = Math.min(1, (now - turning.start) / TURN_MS);
  view.spinTurntable((Math.PI / 2) * (1 - (1 - t) ** 3));
  if (t < 1) return;
  turning = null;
  const turned = turnTurntable(game, board);
  board = buildBoard(currentLevel(game));
  drawBoard();
  mode = game.turnsLeft > 0 ? 'explore' : 'over';
  controls.enabled = true;
  setMessage(
    turned ? 'The turntable turned. New lines may line up now.' : 'The ledge cannot turn here without covering a letter or hitting another block.',
    turned ? 'success' : 'error',
  );
  refresh();
}

function lockView(key) {
  if (mode !== 'explore' || snap || revealing || turning) return;
  snapIfNear(() => {
    mode = 'placing';
    controls.enabled = false;
    lockedDir = viewDir();
    current = chainsForView(board, lockedDir, undefined, true);
    selection = null;
    if (key) selectSlot(key);
    else refresh();
  });
}

function exitPlacing() {
  if (mode !== 'placing' || isBusy()) return;
  for (const key of cancelPending(game)) view.setTile(key, '', 'empty');
  selection = null;
  lockedDir = null;
  mode = game.turnsLeft > 0 ? 'explore' : 'over';
  controls.enabled = true;
  refresh();
}

// Picks a line through the slot: a joined one if there is one, then the
// longest. Choosing the same slot again switches to its other line.
function lineOptions(key) {
  return (current.bySlot.get(key) ?? [])
    .filter((chain) => chain.slots.length >= 2)
    .sort((a, b) => isJoined(b) - isJoined(a) || b.slots.length - a.slots.length);
}

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

function selectPatternSlot(index) {
  if (mode !== 'placing' || !selection || isBusy()) return;
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
  if (mode === 'over' || isBusy()) return;
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
  if (mode !== 'placing' || isBusy()) return;
  const key = undoTile(game);
  if (!key) return;
  view.setTile(key, '', 'empty');
  if (selection) selection.cursor = selection.chain.slots.indexOf(key);
  refresh();
}

function play() {
  if (mode !== 'placing' || !selection || isBusy()) return;
  if (!isWord) {
    setMessage('Still loading the dictionary…', 'error');
    return;
  }
  const result = playWord(game, selection.chain, lockedDir, isWord);
  if (result.error) {
    setMessage(result.error, 'error');
    return;
  }
  for (const tile of result.placed) {
    view.setTile(tile.slot, tile.letter, 'fixed');
  }
  setMessage(`${result.word}: ${describePoints(result.points)}`, 'success');
  exitPlacing();
}

function describePoints({ letters, wordMultiplier, surfaces, bingo, bonuses, total }) {
  let sum = `${letters}`;
  if (wordMultiplier > 1) sum += ` × ${wordMultiplier} word bonus`;
  if (surfaces > 1) sum += ` × ${surfaces} surfaces`;
  if (bingo) sum += ` + ${bingo} for using all seven tiles`;
  const found = bonuses.length ? ` (${bonuses.map((kind) => BONUS_KINDS[kind].name).join(', ')})` : '';
  return sum === String(total) ? `${total} points${found}` : `${sum} = ${total} points${found}`;
}

const raycaster = new THREE.Raycaster();
const pointerDown = new THREE.Vector2();
renderer.domElement.addEventListener('pointerdown', (event) => pointerDown.set(event.clientX, event.clientY));
renderer.domElement.addEventListener('pointerup', (event) => {
  if (snap || revealing || turning || pointerDown.distanceTo(new THREE.Vector2(event.clientX, event.clientY)) > 6) return;
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
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  // Enter still submits after clicking the word strip or rack; other buttons
  // retain native keyboard activation, and Space always activates a button.
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

refresh();
renderer.setAnimationLoop((time) => {
  if (snap) stepSnap(performance.now());
  if (turning) stepTurn(performance.now());
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
