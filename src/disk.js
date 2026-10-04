import * as THREE from 'three';
import { IDENTITY, apply, invert, tilingMirror, toCentre } from './hyperbolic.js';

// Draws the hyperbolic plane in the Poincaré disk: a {3, 8} triangle tiling,
// geodesic segments and round markers, all in world coordinates. A Möbius
// view (world -> screen) says where the player is looking from. Shared by the
// Hyperbolic Chamber and the Hyperbolic Lab.

const SIDES = 3; // triangles...
const MEETING = 8; // ...eight at each corner: small tiles, and an even count so they two-colour
const MAX_SEGMENTS = 8;
const MAX_MARKERS = 8;
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
  uniform vec2 uMirror;          // tiling mirror circle: centre on the real axis, radius
  uniform float uSides;

  // Geodesic segments. Each starts at from (world) and, seen from there with
  // from slid to the centre, runs straight out to seen.
  uniform int uSegments;
  uniform vec2 uSegFrom[${MAX_SEGMENTS}];
  uniform vec2 uSegSeen[${MAX_SEGMENTS}];
  uniform vec3 uSegColor[${MAX_SEGMENTS}];
  uniform float uSegReveal[${MAX_SEGMENTS}]; // 0..1: how much of it to draw
  uniform float uSegDashed[${MAX_SEGMENTS}]; // 1: a dash every half unit of distance

  // Round markers: a centre (world), a hyperbolic radius, a colour, a style
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
  float acosh1(float x) { return log(x + sqrt(max(x * x - 1.0, 0.0))); }
  float atanh1(float x) { return 0.5 * log((1.0 + x) / (1.0 - x)); }
  float hdist(vec2 p, vec2 q) {
    vec2 d = p - q;
    return acosh1(1.0 + 2.0 * dot(d, d) / max((1.0 - dot(p, p)) * (1.0 - dot(q, q)), 1e-9));
  }

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

    for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
      if (i >= uSegments) break;
      vec2 a = uSegFrom[i];
      vec2 u = cdiv(w - a, vec2(1.0, 0.0) - cmul(vec2(a.x, -a.y), w));
      float scale = 2.0 / max(1.0 - dot(u, u), 1e-4);
      vec2 v = uSegSeen[i];
      float len = length(v);
      vec2 dir = v / max(len, 1e-6);
      float along = dot(u, dir);
      float across = abs(u.x * dir.y - u.y * dir.x) * scale;
      if (along > 0.0 && along < len * uSegReveal[i] && across < 0.035) {
        float dash = fract(2.0 * atanh1(min(along, 0.999)) / 0.5);
        if (uSegDashed[i] < 0.5 || dash < 0.6) color = mix(color, uSegColor[i] * 0.8, 0.9);
      }
    }

    for (int i = 0; i < ${MAX_MARKERS}; i++) {
      if (i >= uMarkers) break;
      float d = hdist(w, uMarkAt[i]);
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
          vec2 a = uMarkAt[i];
          vec2 u = cdiv(w - a, vec2(1.0, 0.0) - cmul(vec2(a.x, -a.y), w));
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

export function createDisk(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const { centre, radius } = tilingMirror(SIDES, MEETING);
  const uniforms = {
    uSize: { value: new THREE.Vector2(1, 1) },
    uA: { value: new THREE.Vector2(1, 0) },
    uB: { value: new THREE.Vector2() },
    uC: { value: new THREE.Vector2() },
    uD: { value: new THREE.Vector2(1, 0) },
    uMirror: { value: new THREE.Vector2(centre, radius) },
    uSides: { value: SIDES },
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

  const disk = {
    get view() {
      return view;
    },
    set view(m) {
      view = m;
    },
    toScreen: (z) => apply(view, z),
    toWorld: (z) => apply(invert(view), z),

    resize() {
      const box = canvas.getBoundingClientRect();
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
    pixelOf(z) {
      const { box, scale } = disk.frame();
      const [x, y] = disk.toScreen(z);
      return [box.width / 2 + x * scale, box.height / 2 - y * scale];
    },

    // segments: [{ from, to, color, reveal = 1, dashed = true }] in world coordinates
    setSegments(segments) {
      uniforms.uSegments.value = Math.min(segments.length, MAX_SEGMENTS);
      segments.slice(0, MAX_SEGMENTS).forEach(({ from, to, color: c, reveal = 1, dashed = true }, i) => {
        uniforms.uSegFrom.value[i].set(...from);
        uniforms.uSegSeen.value[i].set(...apply(toCentre(from), to));
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
