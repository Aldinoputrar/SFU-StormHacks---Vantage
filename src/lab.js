import { MEETING, createDisk } from './disk.js';
import {
  FLAT,
  HYPERBOLIC,
  IDENTITY,
  SPHERICAL,
  compose,
  distance,
  normalized,
  polar,
  radiusAt,
  stride,
  triangle,
  turnAtCentre,
} from './hyperbolic.js';

// The Hyperbolic Lab: walk freely on the hyperbolic plane and find out what
// curvature does, then switch to the flat plane or the sphere and try the
// same things. The player always stands at the centre of the disk and the
// world slides past, one pure translation at a time, so the player never
// turns. Even so, unless the world is flat:
//   - a "square" (four equal legs, four right turns) does not close up,
//   - triangle corners do not add up to 180°, the difference being its area,
//   - walking a loop and coming home turns the world by the area enclosed
//     (holonomy), which a north arrow painted at home makes visible.

const SPEED = 1.4; // units of distance per second
const HOME = [0, 0];
const ARROW = 0.9; // the north arrow's length
const PLAYER_RADIUS = 0.14;
const CORNER_RADIUS = 0.11;
const CORNER_COLORS = ['#f2777a', '#35b394', '#8c70d8'];
const TRAIL_STEP = 0.06; // record the path every this far
const TRAIL_MAX = 4000;
const SQUARE_SIDE = 1.2;
const HOME_RADIUS = 0.25; // this close to home counts as back
const LOOP_LENGTH = 2.5; // walked at least this far before a return counts as a loop
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

const degrees = (radians) => Math.round((radians * 180) / Math.PI);
const signedDegrees = (radians) => {
  const d = degrees(radians);
  return d > 0 ? `${d}° anticlockwise` : d < 0 ? `${-d}° clockwise` : '0°';
};
const tileAngle = (K) => degrees((2 * Math.PI) / MEETING[K]);

// What to say about each geometry.
const GEOMETRIES = {
  [HYPERBOLIC]: {
    name: 'Hyperbolic',
    intro: () =>
      `The hyperbolic plane, infinite, in a Poincaré disk. Every floor tile is the same size; the plane only looks squeezed towards the rim, which is infinitely far away. Each tile has three ${tileAngle(HYPERBOLIC)}° corners: ${3 * tileAngle(HYPERBOLIC)}° in all.`,
    square: (gap) =>
      `Four equal sides, four right-angle turns, and you are ${gap} from home. To close up here, a square's corners would have to be sharper than 90°.`,
    triangle: (sum, area) =>
      `= <strong>${sum}°</strong>, less than a flat triangle's 180°. The ${180 - sum}° missing is its area: <strong>${area}</strong>.`,
  },
  [FLAT]: {
    name: 'Flat',
    intro: () =>
      `The ordinary flat plane, drawn the same way, for comparison. Nothing is squeezed: tiles are the same size everywhere on screen, and each has three ${tileAngle(FLAT)}° corners, 180° in all.`,
    square: () => 'Four equal sides, four right-angle turns, and you are back home. Only in flat space does a square close.',
    triangle: (sum, area) => `= <strong>${sum}°</strong>, always, however big. Its area is <strong>${area}</strong>.`,
  },
  [SPHERICAL]: {
    name: 'Spherical',
    intro: () =>
      `The surface of a ball, seen from above your head: the rim is your horizon, a quarter of the way round the world. Tiles look bigger towards it. Eight tiles cover the whole world, each with three ${tileAngle(SPHERICAL)}° corners: ${3 * tileAngle(SPHERICAL)}° in all.`,
    square: (gap) =>
      `Four equal sides, four right-angle turns, and you are ${gap} from home. To close up on a sphere, a square's corners would have to be wider than 90°.`,
    triangle: (sum, area) =>
      `= <strong>${sum}°</strong>, more than a flat triangle's 180°. The extra ${sum - 180}° is its area: <strong>${area}</strong>.`,
  },
};

const $ = (id) => document.getElementById(id);

export function createLab({ sound } = {}) {
  const root = $('lab');
  const canvas = $('lab-canvas');
  const trailCanvas = $('lab-trail');
  const labels = $('lab-labels');
  const readout = $('lab-readout');
  const triangleText = $('lab-triangle');
  const status = $('lab-status');
  const goals = $('lab-goals');
  const intro = $('lab-intro');
  const switches = [...document.querySelectorAll('#lab-geometry [data-curvature]')];

  let disk = null;
  let K = HYPERBOLIC;
  let north = polar(radiusAt(ARROW, K), Math.PI / 2); // the arrow's tip
  let trail = []; // world positions the player has passed through
  let corners = []; // world positions of up to three triangle corners
  let walked = 0;
  let sinceHome = 0; // distance walked since last leaving home
  let wasHome = true;
  let lastLoop = null; // { turn } of the last loop walked back home
  const held = new Set(); // headings of the walking keys held down
  let pointer = null; // { point, from, start, moved } while the floor is pressed
  let script = null; // the square walk: { legs, leg, left }
  let last = 0;
  let onClose = null;
  const done = new Set();

  const player = () => disk.toWorld([0, 0]);

  function setup() {
    disk = createDisk(canvas, { curvature: K });
    disk.setAnimationLoop((time) => {
      if (root.hidden) return;
      const dt = Math.min(0.25, (time - (last || time)) / 1000);
      last = time;
      step(dt);
      draw();
      disk.render();
    });

    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      const point = disk.pointAt(event);
      pointer = { point, from: point, start: performance.now(), moved: false };
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!pointer) return;
      pointer.point = disk.pointAt(event);
      const slid = Math.hypot(pointer.point[0] - pointer.from[0], pointer.point[1] - pointer.from[1]);
      if (slid > 0.04 || performance.now() - pointer.start > 180) pointer.moved = true;
    });
    const release = (event) => {
      if (!pointer) return;
      const tapped = !pointer.moved && performance.now() - pointer.start < 180;
      const point = disk.pointAt(event);
      pointer = null;
      if (tapped && Math.hypot(...point) < 1) dropCorner(disk.toWorld(point));
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', () => (pointer = null));

    window.addEventListener('keydown', (event) => {
      if (root.hidden) return;
      if (event.key === 'Escape') return close();
      const heading = KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (heading === undefined || event.target.closest?.('button')) return;
      held.add(heading);
      script = null;
      event.preventDefault();
    });
    window.addEventListener('keyup', (event) => {
      const heading = KEYS[event.key.length === 1 ? event.key.toLowerCase() : event.key];
      if (heading !== undefined) held.delete(heading);
    });
    window.addEventListener('blur', () => held.clear());
    window.addEventListener('resize', () => !root.hidden && resize());

    $('lab-close').addEventListener('click', close);
    $('lab-reset').addEventListener('click', reset);
    $('lab-square').addEventListener('click', walkSquare);
    for (const button of switches) {
      button.addEventListener('click', () => useGeometry(Number(button.dataset.curvature)));
    }
    useGeometry(K);
  }

  // Switches between the hyperbolic plane, the flat plane and the sphere,
  // starting again from home.
  function useGeometry(k) {
    K = k;
    disk.curvature = k;
    north = polar(radiusAt(ARROW, k), Math.PI / 2);
    intro.textContent = GEOMETRIES[k].intro();
    for (const button of switches) button.setAttribute('aria-pressed', String(Number(button.dataset.curvature) === k));
    reset();
  }

  function resize() {
    disk.resize();
    const box = trailCanvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio, 2);
    trailCanvas.width = box.width * ratio;
    trailCanvas.height = box.height * ratio;
  }

  // Moves the player dt seconds' worth: along the square walk, towards a
  // pressed point of the floor, or along the keys held down.
  function step(dt) {
    let heading = null;
    let length = SPEED * dt;
    if (script) {
      heading = script.legs[script.leg];
      length = Math.min(length, script.left);
      script.left -= length;
      move(heading, length);
      if (script.left <= 1e-9) {
        script.leg++;
        script.left = SQUARE_SIDE;
        if (script.leg === script.legs.length) finishSquare();
      }
      return;
    } else if (pointer && (pointer.moved || performance.now() - pointer.start > 180)) {
      const [x, y] = pointer.point;
      if (Math.hypot(x, y) > 0.06) heading = Math.atan2(y, x);
      pointer.moved = true;
    } else if (held.size) {
      let x = 0;
      let y = 0;
      for (const h of held) {
        x += Math.cos(h);
        y += Math.sin(h);
      }
      if (Math.hypot(x, y) > 1e-6) heading = Math.atan2(y, x);
    }
    if (heading === null || length <= 0) return;
    move(heading, length);
  }

  function move(heading, length) {
    disk.view = normalized(compose(stride(heading, length, K), disk.view));
    walked += length;
    sinceHome += length;
    const here = player();
    if (!trail.length || distance(trail.at(-1), here, K) > TRAIL_STEP) {
      trail.push(here);
      if (trail.length > TRAIL_MAX) trail.shift();
    }
    if (walked > 3) tick('walk');
    checkHome(here);
  }

  // Coming home after a long enough walk closes a loop: the north arrow has
  // turned by the area the loop enclosed.
  function checkHome(here) {
    const home = distance(here, HOME, K) < HOME_RADIUS;
    if (home && !wasHome && sinceHome > LOOP_LENGTH && !script) {
      lastLoop = { turn: turnAtCentre(disk.view) };
      tick('loop');
      sound?.snap();
    }
    if (!home && wasHome) sinceHome = 0;
    wasHome = home;
  }

  function dropCorner(at) {
    if (corners.length === 3) corners = [];
    corners.push(at);
    sound?.place(corners.length);
    if (corners.length === 3) tick('triangle');
  }

  function walkSquare() {
    reset();
    script = { legs: [Math.PI / 2, 0, -Math.PI / 2, Math.PI], leg: 0, left: SQUARE_SIDE };
    status.textContent = `Walking a square: ${SQUARE_SIDE} up, ${SQUARE_SIDE} right, ${SQUARE_SIDE} down, ${SQUARE_SIDE} left…`;
    sound?.walk();
  }

  function finishSquare() {
    script = null;
    const gap = distance(player(), HOME, K);
    status.textContent = GEOMETRIES[K].square(gap.toFixed(2));
    tick('square');
    if (gap < 0.01) sound?.right();
    else sound?.wrong();
  }

  function reset() {
    disk.view = IDENTITY;
    trail = [];
    corners = [];
    walked = 0;
    sinceHome = 0;
    wasHome = true;
    lastLoop = null;
    script = null;
    status.textContent = '';
  }

  function tick(goal) {
    if (done.has(goal)) return;
    done.add(goal);
    goals.querySelector(`[data-goal="${goal}"]`)?.classList.add('done');
  }

  function draw() {
    const here = player();
    disk.setSegments([
      { from: HOME, to: north, color: '#d1495b', dashed: false },
      ...corners.flatMap((corner, i) =>
        corners.length === 3 ? [{ from: corner, to: corners[(i + 1) % 3], color: '#4a3f57', dashed: false }] : [],
      ),
    ]);
    disk.setMarkers([
      { at: HOME, radius: 0.16, color: '#f4b942', style: 'star' },
      { at: north, radius: 0.07, color: '#d1495b' },
      ...corners.map((at, i) => ({ at, radius: CORNER_RADIUS, color: CORNER_COLORS[i] })),
      { at: here, radius: PLAYER_RADIUS, color: '#ffffff', style: 'player' },
    ]);
    drawTrail();
    drawReadout(here);
  }

  // The path walked, drawn as short straight pieces between nearby points,
  // which is close enough to the geodesics between them. On the sphere the
  // path can go over the horizon, so it is clipped to the disk and broken
  // where it leaves the visible hemisphere.
  function drawTrail() {
    const ctx = trailCanvas.getContext('2d');
    const ratio = trailCanvas.width / trailCanvas.getBoundingClientRect().width || 1;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, trailCanvas.width, trailCanvas.height);
    if (trail.length < 2) return;
    const { box, scale } = disk.frame();
    ctx.save();
    ctx.beginPath();
    ctx.arc(box.width / 2, box.height / 2, scale, 0, 2 * Math.PI);
    ctx.clip();
    ctx.strokeStyle = 'rgba(43, 108, 138, 0.75)';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    let drawing = false;
    for (const z of [...trail, player()]) {
      const [sx, sy] = disk.toScreen(z);
      if (!(Math.hypot(sx, sy) < 1.5)) {
        drawing = false;
        continue;
      }
      const [x, y] = disk.pixelOf(z);
      if (drawing) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      drawing = true;
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawReadout(here) {
    const fromHome = distance(here, HOME, K);
    const home = fromHome < HOME_RADIUS;
    const rows = [
      ['From home', fromHome.toFixed(2)],
      ['Walked', walked.toFixed(1)],
    ];
    if (lastLoop) {
      rows.push(['Last loop turned the world', signedDegrees(lastLoop.turn)]);
      rows.push(
        K
          ? ['…so it enclosed an area of', Math.abs(lastLoop.turn).toFixed(2)]
          : ['Flat space has no curvature', 'so loops never turn it'],
      );
    } else if (home) {
      rows.push(['North arrow', signedDegrees(turnAtCentre(disk.view))]);
    }
    const html = rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
    if (readout.innerHTML !== html) readout.innerHTML = html;

    if (corners.length === 3) {
      const { angles, sum, area } = triangle(...corners, K);
      const text = `Angles ${angles.map(degrees).join('° + ')}° ${GEOMETRIES[K].triangle(degrees(sum), area.toFixed(2))}`;
      if (triangleText.innerHTML !== text) triangleText.innerHTML = text;
      if (labels.childElementCount !== 3) {
        labels.replaceChildren(
          ...CORNER_COLORS.map((color) => {
            const label = document.createElement('span');
            label.style.setProperty('--crystal', color);
            return label;
          }),
        );
      }
      corners.forEach((corner, i) => {
        const [x, y] = disk.pixelOf(corner);
        const label = labels.children[i];
        label.textContent = `${degrees(angles[i])}°`;
        label.style.left = `${x}px`;
        label.style.top = `${y}px`;
        label.hidden = !(Math.hypot(...disk.toScreen(corner)) < 1);
      });
    } else {
      const text = corners.length
        ? `Click ${3 - corners.length} more corner${corners.length === 2 ? '' : 's'} to close the triangle.`
        : 'Click the floor three times to drop the corners of a triangle.';
      if (triangleText.textContent !== text) triangleText.textContent = text;
      if (labels.childElementCount) labels.replaceChildren();
    }
  }

  function close() {
    if (root.hidden) return;
    root.hidden = true;
    held.clear();
    pointer = null;
    script = null;
    onClose?.();
  }

  // Opens the lab; resolves when the player leaves it.
  function open() {
    root.hidden = false;
    if (!disk) setup();
    resize();
    last = 0;
    return new Promise((resolve) => (onClose = resolve));
  }

  return { open, isOpen: () => !root.hidden };
}
