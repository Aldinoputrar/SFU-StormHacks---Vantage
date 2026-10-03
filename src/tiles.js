import * as THREE from 'three';
import { LETTER_VALUES } from './structure.js';

const TILE_GAP = 0.06;
const textureCache = new Map();

function letterTexture(letter) {
  if (textureCache.has(letter)) return textureCache.get(letter);

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = letter ? '#f6deb0' : '#e9e2d6';
  ctx.fillRect(0, 0, size, size);

  if (letter) {
    ctx.fillStyle = '#3b3346';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 150px system-ui, sans-serif';
    ctx.fillText(letter, size / 2, size / 2 + 8);
    ctx.font = 'bold 48px system-ui, sans-serif';
    ctx.fillText(String(LETTER_VALUES[letter] ?? ''), size - 40, size - 36);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  textureCache.set(letter, texture);
  return texture;
}

// Builds one strip: a stone platform under a row of tiles.
export function buildStrip(strip) {
  const group = new THREE.Group();
  group.name = strip.id;

  const dir = new THREE.Vector3(...strip.dir);
  const start = new THREE.Vector3(...strip.start);

  const stone = new THREE.MeshStandardMaterial({ color: '#b9a7c9', roughness: 0.9 });
  const tileGeometry = new THREE.BoxGeometry(1 - TILE_GAP, 0.18, 1 - TILE_GAP);
  const blockGeometry = new THREE.BoxGeometry(1, 1, 1);

  [...strip.letters].forEach((char, i) => {
    const letter = char.trim();
    const cell = start.clone().addScaledVector(dir, i);

    const block = new THREE.Mesh(blockGeometry, stone);
    block.position.copy(cell);
    group.add(block);

    const face = new THREE.MeshStandardMaterial({ map: letterTexture(letter), roughness: 0.6 });
    const side = new THREE.MeshStandardMaterial({ color: letter ? '#e2c48e' : '#d6cfc3' });
    // BoxGeometry material order: +x, -x, +y, -y, +z, -z. Letters face up.
    const tile = new THREE.Mesh(tileGeometry, [side, side, face, side, side, side]);
    tile.position.copy(cell).add(new THREE.Vector3(0, 0.59, 0));
    tile.userData = { stripId: strip.id, index: i, letter };
    group.add(tile);
  });

  return group;
}
