import * as THREE from 'three';
import { faceOf, slotKey } from './board.js';
import { LETTER_VALUES } from './level.js';

const TILE_SIZE = 0.84;
const HEIGHT = { empty: 0.02, fixed: 0.09, pending: 0.09 };
const COLORS = {
  stone: '#b9a7c9', // blocks whose run gives no colour
  fixed: '#fff3dc',
  fixedSide: '#e8cfa4',
  fixedInk: '#4a3f57',
  pending: '#fffbe9',
  pendingSide: '#f2df9f',
  pendingInk: '#2b6c8a',
};

// Empty tiles are a pale inset of the block they sit on.
const tint = (color, toward, amount) => `#${new THREE.Color(color).lerp(new THREE.Color(toward), amount).getHexString()}`;
// Bonus squares, coloured as on a Scrabble board.
const BONUS_COLORS = { DL: '#5ba4d6', TL: '#1f6f9f', DW: '#ec9c9c', TW: '#d1495b' };
const GLOW = {
  aligned: { color: new THREE.Color('#1fbfae'), base: 0.4, pulse: 0.2, speed: 3 },
  selected: { color: new THREE.Color('#ffae00'), base: 0.15, pulse: 0, speed: 0 },
  cursor: { color: new THREE.Color('#ff8a00'), base: 0.55, pulse: 0.3, speed: 6 },
};

const textures = new Map();
function faceTexture(style, letter, bonus, stone) {
  const key = `${style}:${letter}:${bonus ?? ''}:${style === 'empty' ? stone : ''}`;
  if (textures.has(key)) return textures.get(key);

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  if (style === 'empty' && bonus) {
    ctx.fillStyle = BONUS_COLORS[bonus];
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 112px system-ui, sans-serif';
    ctx.fillText(bonus, size / 2, size / 2 + 6);
  } else if (style === 'empty') {
    ctx.fillStyle = tint(stone, '#ffffff', 0.3);
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = tint(stone, '#4a3f57', 0.18);
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

// Materials shared by colour.
const materials = new Map();
function material(color, roughness = 0.9) {
  if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness }));
  return materials.get(color);
}
const sideMaterial = (style, stone) =>
  style === 'empty' ? material(tint(stone, '#ffffff', 0.15)) : material(COLORS[`${style}Side`], 0.7);

const vec = (a) => new THREE.Vector3(...a);

// Draws the board: stone blocks with a tile on every exposed face.
export class BoardView {
  constructor(board, scene, bonuses = new Map()) {
    this.scene = scene;
    this.bonuses = bonuses; // slot key -> bonus kind, drawn on empty tiles
    this.group = new THREE.Group();
    this.tiles = new Map();
    this.pickables = [];
    this.highlights = new Map();
    // Made for this board and released by dispose. Textures and the materials
    // shared by colour are cached for the whole page, so they are kept.
    this.ownedGeometries = new Set();
    this.ownedMaterials = new Set();

    const blockGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.ownedGeometries.add(blockGeometry);
    this.stoneOf = (cell) => board.colors.get(cell.join(',')) ?? COLORS.stone;
    for (const cell of board.cells) {
      const block = new THREE.Mesh(blockGeometry, material(this.stoneOf(cell), 0.95));
      block.position.set(...cell);
      block.userData.cell = cell;
      this.group.add(block);
      this.pickables.push(block);
    }

    // The letter is drawn on the box's +y face, so +y points out of the block.
    const tileGeometry = new THREE.BoxGeometry(TILE_SIZE, 1, TILE_SIZE);
    this.ownedGeometries.add(tileGeometry);
    for (const slot of board.slots.values()) {
      const face = new THREE.MeshStandardMaterial({ roughness: 0.65 });
      this.ownedMaterials.add(face);
      const materials = [null, null, face, null, null, null];
      const mesh = new THREE.Mesh(tileGeometry, materials);
      mesh.userData.slot = slot.key;
      const tile = { slot, mesh, face, materials, style: null, letter: null, right: null };
      this.tiles.set(slot.key, tile);
      this.setTile(slot.key, '', 'empty');
      this.orient(tile, vec(slot.axes[0]));
      this.group.add(mesh);
      this.pickables.push(mesh);
    }

    scene.add(this.group);
  }

  // Safe to call more than once.
  dispose() {
    this.scene.remove(this.group);
    for (const geometry of this.ownedGeometries) geometry.dispose();
    for (const material of this.ownedMaterials) material.dispose();
    this.ownedGeometries.clear();
    this.ownedMaterials.clear();
    this.group.clear();
    this.tiles.clear();
    this.pickables = [];
    this.highlights = new Map();
  }

  setTile(key, letter, style) {
    const tile = this.tiles.get(key);
    if (tile.style === style && tile.letter === letter) return;
    tile.style = style;
    tile.letter = letter;
    const stone = this.stoneOf(tile.slot.cell);
    tile.face.map = faceTexture(style, letter, style === 'empty' ? this.bonuses.get(key) : null, stone);
    tile.face.needsUpdate = true;
    for (const i of [0, 1, 3, 4, 5]) tile.materials[i] = sideMaterial(style, stone);

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
  // Always the visible surface: a covered tile is chosen in the word strip
  // instead, so a click never goes through a block in front.
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
