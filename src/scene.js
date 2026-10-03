import * as THREE from 'three';
import { faceOf, slotKey } from './board.js';
import { LETTER_VALUES } from './level.js';

const TILE_SIZE = 0.84;
const HEIGHT = { empty: 0.02, fixed: 0.09, pending: 0.09 };
const COLORS = {
  stone: '#b9a7c9',
  turntable: '#9fb7c9',
  empty: '#cabbd7',
  emptyEdge: '#a996bd',
  emptySide: '#c2b2d0',
  fixed: '#f6deb0',
  fixedSide: '#e2c48e',
  fixedInk: '#3b3346',
  pending: '#fff4cc',
  pendingSide: '#f0d98f',
  pendingInk: '#2b6c8a',
};
const GLOW = {
  aligned: { color: new THREE.Color('#1fbfae'), base: 0.4, pulse: 0.2, speed: 3 },
  selected: { color: new THREE.Color('#ffae00'), base: 0.15, pulse: 0, speed: 0 },
  cursor: { color: new THREE.Color('#ff8a00'), base: 0.55, pulse: 0.3, speed: 6 },
};

const textures = new Map();
function faceTexture(style, letter) {
  const key = `${style}:${letter}`;
  if (textures.has(key)) return textures.get(key);

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (style === 'empty') {
    ctx.fillStyle = COLORS.empty;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = COLORS.emptyEdge;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.roundRect(28, 28, size - 56, size - 56, 26);
    ctx.stroke();
  } else {
    ctx.fillStyle = COLORS[style];
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = COLORS[`${style}Ink`];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 150px system-ui, sans-serif';
    ctx.fillText(letter, size / 2, size / 2 + 8);
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.fillText(String(LETTER_VALUES[letter] ?? ''), size - 42, size - 38);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  textures.set(key, texture);
  return texture;
}

const sideMaterials = {
  empty: new THREE.MeshStandardMaterial({ color: COLORS.emptySide, roughness: 0.9 }),
  fixed: new THREE.MeshStandardMaterial({ color: COLORS.fixedSide, roughness: 0.7 }),
  pending: new THREE.MeshStandardMaterial({ color: COLORS.pendingSide, roughness: 0.7 }),
};

const vec = (a) => new THREE.Vector3(...a);

// Draws the board: stone blocks with a tile on every exposed face.
export class BoardView {
  // turntable: { cells, pivot } for the part that can turn, drawn in its own
  // colour so players can spot it.
  constructor(board, scene, turntable = null) {
    this.scene = scene;
    this.turntable = turntable;
    this.spinning = []; // turntable meshes with their resting pose
    this.group = new THREE.Group();
    this.tiles = new Map();
    this.pickables = [];
    this.highlights = new Map();

    const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
    const stone = new THREE.MeshStandardMaterial({ color: COLORS.stone, roughness: 0.95 });
    const turntableStone = new THREE.MeshStandardMaterial({ color: COLORS.turntable, roughness: 0.95 });
    const onTurntable = (cell) => Boolean(turntable?.cells.has(cell.join(',')));
    for (const cell of board.cells) {
      const block = new THREE.Mesh(blockGeometry, onTurntable(cell) ? turntableStone : stone);
      if (onTurntable(cell)) this.spinning.push(block);
      block.position.set(...cell);
      block.userData.cell = cell;
      this.group.add(block);
      this.pickables.push(block);
    }

    // The letter is drawn on the box's +y face, so +y points out of the block.
    const tileGeometry = new THREE.BoxGeometry(TILE_SIZE, 1, TILE_SIZE);
    for (const slot of board.slots.values()) {
      const face = new THREE.MeshStandardMaterial({ roughness: 0.65 });
      const materials = [null, null, face, null, null, null];
      const mesh = new THREE.Mesh(tileGeometry, materials);
      mesh.userData.slot = slot.key;
      const tile = { slot, mesh, face, materials, style: null, letter: null, right: null };
      this.tiles.set(slot.key, tile);
      this.setTile(slot.key, '', 'empty');
      this.orient(tile, vec(slot.axes[0]));
      if (onTurntable(slot.cell)) this.spinning.push(mesh);
      this.group.add(mesh);
      this.pickables.push(mesh);
    }

    scene.add(this.group);
  }

  dispose() {
    this.scene.remove(this.group);
  }

  // Turns the turntable's meshes by angle about the vertical axis through
  // its pivot, for animating a quarter turn before the board is rebuilt.
  spinTurntable(angle) {
    const pivot = new THREE.Vector3(...this.turntable.pivot);
    const spin = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    for (const mesh of this.spinning) {
      mesh.userData.rest ??= { position: mesh.position.clone(), quaternion: mesh.quaternion.clone() };
      const { position, quaternion } = mesh.userData.rest;
      mesh.position.copy(position).sub(pivot).applyQuaternion(spin).add(pivot);
      mesh.quaternion.copy(spin).multiply(quaternion);
    }
  }

  setTile(key, letter, style) {
    const tile = this.tiles.get(key);
    if (tile.style === style && tile.letter === letter) return;
    tile.style = style;
    tile.letter = letter;
    tile.face.map = faceTexture(style, letter);
    tile.face.needsUpdate = true;
    for (const i of [0, 1, 3, 4, 5]) tile.materials[i] = sideMaterials[style];

    const height = HEIGHT[style];
    const normal = vec(tile.slot.normal);
    tile.mesh.scale.set(1, height, 1);
    tile.mesh.position.copy(vec(tile.slot.center)).addScaledVector(normal, height / 2);
  }

  // kind: 'aligned' | 'selected' | 'cursor'
  setHighlights(highlights) {
    this.highlights = highlights;
    for (const [key, tile] of this.tiles) {
      if (!highlights.has(key)) tile.face.emissiveIntensity = 0;
    }
  }

  // Turns each letter in 90° steps so it reads upright from the camera.
  orientLetters(camera) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const normal = new THREE.Vector3();
    const letterUp = new THREE.Vector3();
    for (const tile of this.tiles.values()) {
      normal.set(...tile.slot.normal);
      const score = (right) => letterUp.crossVectors(normal, right).dot(up);
      let best = tile.right;
      let bestScore = score(best) + 0.1; // a little stickiness avoids flicker
      for (const axis of tile.slot.axes) {
        for (const sign of [1, -1]) {
          const right = vec(axis).multiplyScalar(sign);
          const s = score(right);
          if (s > bestScore) {
            best = right;
            bestScore = s;
          }
        }
      }
      if (best !== tile.right) this.orient(tile, best);
    }
  }

  orient(tile, right) {
    tile.right = right;
    const normal = vec(tile.slot.normal);
    const basis = new THREE.Matrix4().makeBasis(right, normal, right.clone().cross(normal));
    tile.mesh.quaternion.setFromRotationMatrix(basis);
  }

  // The slot under the ray, whether it hits the tile or the block around it.
  pick(raycaster) {
    const hit = raycaster.intersectObjects(this.pickables, false)[0];
    if (!hit) return null;
    if (hit.object.userData.slot) return hit.object.userData.slot;
    const key = slotKey(hit.object.userData.cell, faceOf(hit.face.normal.toArray()));
    return this.tiles.has(key) ? key : null;
  }

  animate(time) {
    for (const [key, kind] of this.highlights) {
      const glow = GLOW[kind];
      const face = this.tiles.get(key).face;
      face.emissive.copy(glow.color);
      face.emissiveIntensity = glow.base + glow.pulse * Math.sin(time * glow.speed);
    }
  }
}
