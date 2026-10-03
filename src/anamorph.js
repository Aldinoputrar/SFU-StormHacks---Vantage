import * as THREE from 'three';
import { screenBasis } from './geometry.js';

// Anamorphic bonus markers. A label is cut into shards, and each shard is
// pushed a different distance along the viewing direction. An orthographic
// camera ignores movement along its own direction, so from that one
// viewpoint the shards reassemble into the label; from anywhere else they
// scatter like debris.

const COLUMNS = 6;
const ROWS = 3;
const WIDTH = 2.4;
const HEIGHT = 1;
const COLORS = { TW: '#d1495b', DW: '#e9849a', TL: '#2b7bb9', DL: '#6fb0dc' };

function labelTexture(text, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 200;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(6, 6, canvas.width - 12, canvas.height - 12, 36);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 84px system-ui, sans-serif';
  const fit = Math.min(1, (canvas.width - 60) / ctx.measureText(text).width);
  ctx.font = `bold ${Math.floor(84 * fit)}px system-ui, sans-serif`;
  ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Deterministic pseudo-random number in [0, 1), so markers scatter the same
// way on every load.
function scatter(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// A marker for the tile at center, readable from direction dir.
export function createAnamorph({ center, dir, kind, label, seed }) {
  const { right, up } = screenBasis(dir);
  const [r, u, d] = [right, up, dir].map((v) => new THREE.Vector3(...v));
  // Sits just above the tile on screen, pointing down at it.
  const origin = new THREE.Vector3(...center).addScaledVector(u, 1.05).addScaledVector(d, 0.5);
  const material = new THREE.MeshBasicMaterial({
    map: labelTexture(`${label} ▾`, COLORS[kind]),
    transparent: true,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const orientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, d));

  const group = new THREE.Group();
  const w = WIDTH / COLUMNS;
  const h = HEIGHT / ROWS;
  for (let row = 0; row < ROWS; row++) {
    for (let column = 0; column < COLUMNS; column++) {
      const geometry = new THREE.PlaneGeometry(w, h);
      const uv = geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (column + uv.getX(i)) / COLUMNS, (row + uv.getY(i)) / ROWS);
      }
      const shard = new THREE.Mesh(geometry, material);
      shard.quaternion.copy(orientation);
      shard.position
        .copy(origin)
        .addScaledVector(r, -WIDTH / 2 + (column + 0.5) * w)
        .addScaledVector(u, -HEIGHT / 2 + (row + 0.5) * h)
        .addScaledVector(d, 4 * scatter(seed * 97 + row * COLUMNS + column));
      shard.renderOrder = 2;
      group.add(shard);
    }
  }
  return group;
}
