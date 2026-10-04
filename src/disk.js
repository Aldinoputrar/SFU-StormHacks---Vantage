import * as THREE from 'three';
import {
  FLAT,
  HYPERBOLIC,
  IDENTITY,
  SPHERICAL,
  apply,
  compose,
  invert,
  normalized,
  recentre,
  tilingMirror,
  toCentre,
} from './hyperbolic.js';

// Draws a plane of constant curvature in a disk: the hyperbolic plane in the
// Poincaré disk, the flat plane, or the sphere by stereographic projection
// (see hyperbolic.js). On it go a triangle tiling, geodesic segments and
// round markers, all in world coordinates. A Möbius view (world -> screen)
// says where the player is looking from. Shared by the Hyperbolic Chamber
// and the Lab.

const SIDES = 3; // triangles, with this many at each corner in each geometry:
// eight on the hyperbolic plane (45° corners), six on the flat plane (60°)
// and four on the sphere (90°: an octahedron, so the whole world is eight
// tiles). Even counts, so the tiles two-colour.
export const MEETING = { [HYPERBOLIC]: 8, [FLAT]: 6, [SPHERICAL]: 4 };
const PALETTES = {
  [HYPERBOLIC]: { a: '#fce8d6', b: '#f5ccbf', edge: '#9e85b8' },
  [FLAT]: { a: '#e3f1ea', b: '#c9e4d8', edge: '#7fa894' },
  [SPHERICAL]: { a: '#e9e4f7', b: '#d3caef', edge: '#8a78bf' },
};
const MAX_SEGMENTS = 12;
const MAX_MARKERS = 14;
export const DISK_SCALE = 0.48; // the disk's radius, as a share of the canvas's smaller side

const MARKER_STYLES = { gem: 0, player: 1, star: 2 };

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
  uniform float uK;              // curvature: -1 hyperbolic, 0 flat, +1 spherical
  uniform vec2 uMirror;          // tiling mirror: circle (centre on the real axis, radius), or flat line x = uMirror.x
  uniform float uSides;
  uniform vec3 uTileA, uTileB, uEdge;
  uniform float uFlip;           // 1 when recentring has swapped the two tile colours

  // Geodesic segments. Each starts at from (world) and, seen from there with
  // from slid to the centre, runs straight out to seen.
  uniform int uSegments;
  uniform vec2 uSegFrom[${MAX_SEGMENTS}];
  uniform vec2 uSegSeen[${MAX_SEGMENTS}];
  uniform vec3 uSegColor[${MAX_SEGMENTS}];
  uniform float uSegReveal[${MAX_SEGMENTS}]; // 0..1: how much of it to draw
  uniform float uSegDashed[${MAX_SEGMENTS}]; // 1: a dash every half unit of distance

  // Round markers: a centre (world), a true radius, a colour, a style
  // (0 gem, 1 player, 2 star) and an optional ring colour (alpha 0: none).
  uniform int uMarkers;
  uniform vec2 uMarkAt[${MAX_MARKERS}];
  uniform float uMarkRadius[${MAX_MARKERS}];
  uniform vec3 uMarkColor[${MAX_MARKERS}];
  uniform float uMarkStyle[${MAX_MARKERS}];
  uniform vec4 uMarkRing[${MAX_MARKERS}];

  const float PI = 3.14159265;

  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  vec2 cdiv(vec2 a, vec2 b) { return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / dot(b, b); }
  float atanh1(float x) { return 0.5 * log((1.0 + x) / (1.0 - x)); }
  // Slides a to the centre: (w - a) / (1 + K ā w).
  vec2 centred(vec2 w, vec2 a) { return cdiv(w - a, vec2(1.0, 0.0) + uK * cmul(vec2(a.x, -a.y), w)); }
  // Distance from the centre to a point drawn at radius r.
  float fromCentre(float r) {
    if (uK < -0.5) return 2.0 * atanh1(min(r, 0.999999));
    if (uK > 0.5) return 2.0 * atan(r);
    return 2.0 * r;
  }
  float gdist(vec2 w, vec2 a) { return fromCentre(length(centred(w, a))); }

  void main() {
    vec2 s = (vUv - 0.5) * uSize / (${DISK_SCALE} * min(uSize.x, uSize.y));
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
      if (uK > -0.5 && uK < 0.5) {
        // Flat: the edge is a straight line; reflect across it.
        if (z.x <= uMirror.x) break;
        z.x = 2.0 * uMirror.x - z.x;
      } else {
        // Curved: the edge is a circle; reflecting across it is inversion.
        // The central tile is outside the hyperbolic mirror and inside the
        // spherical one.
        vec2 d = z - centre;
        float dd = dot(d, d);
        if (uK < 0.0 ? dd >= rr : dd <= rr) break;
        z = centre + d * (rr / dd);
      }
      crossings += 1.0;
    }
    vec3 color = mod(crossings + uFlip, 2.0) < 0.5 ? uTileA : uTileB;
    float edge = uK > -0.5 && uK < 0.5 ? abs(z.x - uMirror.x) : abs(length(z - centre) - uMirror.y);
    float edgeWidth = 0.008;
    float edgeAa = fwidth(edge) + 1e-5;
    color = mix(uEdge, color, smoothstep(edgeWidth, edgeWidth + edgeAa, edge));
    color *= 1.0 - 0.18 * r * r; // the rim sinks away

    for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
      if (i >= uSegments) break;
      vec2 a = uSegFrom[i];
      vec2 u = centred(w, a);
      float scale = 2.0 / max(1.0 + uK * dot(u, u), 1e-4);
      vec2 v = uSegSeen[i];
      float len = length(v);
      vec2 dir = v / max(len, 1e-6);
      float along = dot(u, dir);
      float across = abs(u.x * dir.y - u.y * dir.x) * scale;
      if (along > 0.0 && along < len * uSegReveal[i] && across < 0.035) {
        float dash = fract(fromCentre(along) / 0.5);
        if (uSegDashed[i] < 0.5 || dash < 0.6) color = mix(color, uSegColor[i] * 0.8, 0.9);
      }
    }

    for (int i = 0; i < ${MAX_MARKERS}; i++) {
      if (i >= uMarkers) break;
      float d = gdist(w, uMarkAt[i]);
      float size = uMarkRadius[i];
      vec3 tint = uMarkColor[i];
      if (d < size) {
        if (uMarkStyle[i] < 0.5) {
          color = d > 0.82 * size ? tint * 0.6 : mix(tint * 1.18, tint * 0.78, d / size);
        } else if (uMarkStyle[i] < 1.5) {
          color = d > 0.75 * size ? vec3(0.29, 0.25, 0.34) : tint;
        } else {
          // A five-pointed star, measured in the marker's own frame: k is 1
          // at each point and 0 halfway between them.
          vec2 u = centred(w, uMarkAt[i]);
          float f = (atan(u.y, u.x) - PI / 2.0) / (2.0 * PI / 5.0);
          float k = 1.0 - 2.0 * abs(f - floor(f + 0.5));
          float reach = size * (0.42 + 0.58 * k);
          if (d < reach) color = d > reach - 0.18 * size ? tint * 0.72 : tint;
        }
      } else if (d < 1.4 * size && uMarkRing[i].a > 0.0) {
        color = mix(color, uMarkRing[i].rgb, uMarkRing[i].a);
      }
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

const color = (c) => new THREE.Color(c);
// The floor's colours go to the shader as they are written, without colour
// management, so they match the page's CSS exactly.
const rgb = (hex) => new THREE.Vector3(...[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255));

export function createDisk(canvas, { curvature = HYPERBOLIC } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const uniforms = {
    uK: { value: curvature },
    uSize: { value: new THREE.Vector2(1, 1) },
    uA: { value: new THREE.Vector2(1, 0) },
    uB: { value: new THREE.Vector2() },
    uC: { value: new THREE.Vector2() },
    uD: { value: new THREE.Vector2(1, 0) },
    uMirror: { value: new THREE.Vector2() },
    uSides: { value: SIDES },
    uTileA: { value: new THREE.Vector3() },
    uTileB: { value: new THREE.Vector3() },
    uEdge: { value: new THREE.Vector3() },
    uFlip: { value: 0 },
    uSegments: { value: 0 },
    uSegFrom: { value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector2()) },
    uSegSeen: { value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Vector2(0.1, 0)) },
    uSegColor: { value: Array.from({ length: MAX_SEGMENTS }, () => new THREE.Color()) },
    uSegReveal: { value: Array(MAX_SEGMENTS).fill(1) },
    uSegDashed: { value: Array(MAX_SEGMENTS).fill(1) },
    uMarkers: { value: 0 },
    uMarkAt: { value: Array.from({ length: MAX_MARKERS }, () => new THREE.Vector2()) },
    uMarkRadius: { value: Array(MAX_MARKERS).fill(0.1) },
    uMarkColor: { value: Array.from({ length: MAX_MARKERS }, () => new THREE.Color()) },
    uMarkStyle: { value: Array(MAX_MARKERS).fill(0) },
    uMarkRing: { value: Array.from({ length: MAX_MARKERS }, () => new THREE.Vector4()) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let view = IDENTITY; // world -> screen
  let K = curvature;
  let size = { width: 1, height: 1 }; // the canvas in CSS pixels, as of the last resize

  function useCurvature(k) {
    K = k;
    uniforms.uK.value = k;
    const mirror = tilingMirror(SIDES, MEETING[k], k);
    if (k) uniforms.uMirror.value.set(mirror.centre, mirror.radius);
    else uniforms.uMirror.value.set(mirror.line, 0);
    const palette = PALETTES[k];
    uniforms.uTileA.value.copy(rgb(palette.a));
    uniforms.uTileB.value.copy(rgb(palette.b));
    uniforms.uEdge.value.copy(rgb(palette.edge));
    uniforms.uFlip.value = 0;
  }
  useCurvature(curvature);

  const disk = {
    get view() {
      return view;
    },
    set view(m) {
      view = m;
    },
    get curvature() {
      return K;
    },
    set curvature(k) {
      useCurvature(k);
    },
    toScreen: (z) => apply(view, z),
    toWorld: (z) => apply(invert(view), z),

    // Keeps the numbers small on long walks (see recentre in hyperbolic.js):
    // if the point at the centre of the screen has left the central tile,
    // the world is shifted by a symmetry of the floor that brings it back.
    // Returns that symmetry, which the caller must apply to every world
    // point it holds, or null if nothing moved.
    recentre() {
      const moved = recentre(apply(invert(view), [0, 0]), SIDES, MEETING[K], K);
      if (!moved) return null;
      view = normalized(compose(view, invert(moved.map)));
      if (moved.steps % 2) uniforms.uFlip.value = 1 - uniforms.uFlip.value;
      return moved.map;
    },

    resize() {
      const box = canvas.getBoundingClientRect();
      size = { width: box.width, height: box.height };
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(box.width, box.height, false);
      renderer.getDrawingBufferSize(uniforms.uSize.value);
    },

    // The disk's centre and radius on the page, in CSS pixels.
    frame() {
      const box = canvas.getBoundingClientRect();
      return { box, scale: DISK_SCALE * Math.min(box.width, box.height) };
    },

    // The point of the screen disk under a pointer event.
    pointAt(event) {
      const { box, scale } = disk.frame();
      return [(event.clientX - box.left - box.width / 2) / scale, -(event.clientY - box.top - box.height / 2) / scale];
    },

    // Where a world point is drawn, in CSS pixels from the canvas's corner.
    // Called for every point of every path each frame, so it uses the size
    // from the last resize rather than asking the page for layout.
    // With onScreen, z is already a point of the screen disk.
    pixelOf(z, onScreen = false) {
      const scale = DISK_SCALE * Math.min(size.width, size.height);
      const [x, y] = onScreen ? z : disk.toScreen(z);
      return [size.width / 2 + x * scale, size.height / 2 - y * scale];
    },

    // segments: [{ from, to, color, reveal = 1, dashed = true }] in world coordinates
    setSegments(segments) {
      uniforms.uSegments.value = Math.min(segments.length, MAX_SEGMENTS);
      segments.slice(0, MAX_SEGMENTS).forEach(({ from, to, color: c, reveal = 1, dashed = true }, i) => {
        uniforms.uSegFrom.value[i].set(...from);
        uniforms.uSegSeen.value[i].set(...apply(toCentre(from, K), to));
        uniforms.uSegColor.value[i].copy(color(c));
        uniforms.uSegReveal.value[i] = reveal;
        uniforms.uSegDashed.value[i] = dashed ? 1 : 0;
      });
    },

    // markers: [{ at, radius, color, style = 'gem', ring = null, ringAlpha = 1 }] in world coordinates
    setMarkers(markers) {
      uniforms.uMarkers.value = Math.min(markers.length, MAX_MARKERS);
      markers.slice(0, MAX_MARKERS).forEach(({ at, radius: size, color: c, style = 'gem', ring = null, ringAlpha = 1 }, i) => {
        uniforms.uMarkAt.value[i].set(...at);
        uniforms.uMarkRadius.value[i] = size;
        uniforms.uMarkColor.value[i].copy(color(c));
        uniforms.uMarkStyle.value[i] = MARKER_STYLES[style];
        const ringColor = color(ring ?? '#000000');
        uniforms.uMarkRing.value[i].set(ringColor.r, ringColor.g, ringColor.b, ring ? ringAlpha : 0);
      });
    },

    render() {
      const [a, b, c, d] = invert(view);
      uniforms.uA.value.set(...a);
      uniforms.uB.value.set(...b);
      uniforms.uC.value.set(...c);
      uniforms.uD.value.set(...d);
      renderer.render(scene, camera);
    },

    setAnimationLoop: (loop) => renderer.setAnimationLoop(loop),
  };
  return disk;
}
