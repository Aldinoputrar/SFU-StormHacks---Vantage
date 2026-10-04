import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { buildBoard, chainsForView, slotKey } from '../src/board.js';
import { BoardView } from '../src/scene.js';
import { placementDirection, placementOptions } from '../src/placement.js';
import { createGame, placeTile } from '../src/game.js';
import { normalize } from '../src/geometry.js';

const previousDocument = globalThis.document;
before(() => {
  // CanvasTexture needs a canvas, but these scene/raycast tests do not need WebGL.
  globalThis.document = {
    createElement: () => ({
      getContext: () => ({
        fillRect() {}, fillText() {}, beginPath() {}, roundRect() {}, stroke() {},
      }),
    }),
  };
});
after(() => {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
});

const lower = slotKey([0, 0, 0], '+y');
const upper = slotKey([0, 2, 0], '+y');
const uncovered = slotKey([2, 0, 0], '+y');
const board = buildBoard({
  blocks: [
    { start: [0, 0, 0], dir: [1, 0, 0], length: 3 },
    { start: [0, 2, 0], dir: [1, 0, 0], length: 1 },
  ],
});

function rayAbove(x = 0) {
  return new THREE.Raycaster(new THREE.Vector3(x, 5, 0), new THREE.Vector3(0, -1, 0));
}

test('selecting a covered lower tile never redirects a click through the upper ledge', () => {
  const view = new BoardView(board, new THREE.Scene());
  try {
    view.group.updateMatrixWorld(true);
    assert.equal(view.pick(rayAbove()), upper);

    view.setTile(lower, 'C', 'pending');
    view.setHighlights(new Map([[lower, 'cursor']]));
    view.animate(0);
    view.group.updateMatrixWorld(true);
    assert.equal(view.pick(rayAbove()), upper);
    assert.equal(view.pick(rayAbove(2)), uncovered);

    view.setHighlights(new Map());
    assert.equal(view.pick(rayAbove()), upper);
  } finally {
    view.dispose();
  }
});

test('selected letters stay on their physical tile and remain occluded by covering geometry', () => {
  const view = new BoardView(board, new THREE.Scene());
  try {
    const tile = view.tiles.get(lower);
    const side = tile.materials[0];
    const emptyTexture = tile.face.map;
    assert.equal(tile.face.depthTest, true);
    assert.equal(side.depthTest, true);

    view.setTile(lower, 'A', 'pending');
    assert.notEqual(tile.face.map, emptyTexture);
    view.setHighlights(new Map([[lower, 'cursor']]));
    view.animate(0);
    assert.ok(tile.face.emissiveIntensity > 0);
    view.group.traverse((object) => {
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) if (material) assert.equal(material.depthTest, true);
    });
    assert.ok(tile.mesh.position.y < view.tiles.get(upper).mesh.position.y);

    view.setHighlights(new Map());
    assert.equal(tile.face.emissiveIntensity, 0);
  } finally {
    view.dispose();
  }
});

test('disposing a board releases owned resources once and preserves shared textures and sides', () => {
  const scene = new THREE.Scene();
  const view = new BoardView(board, scene);
  const disposals = new Map();
  for (const resource of [...view.ownedGeometries, ...view.ownedMaterials]) {
    disposals.set(resource, 0);
    resource.addEventListener('dispose', () => disposals.set(resource, disposals.get(resource) + 1));
  }
  const tile = view.tiles.get(lower);
  let sharedDisposals = 0;
  tile.face.map.addEventListener('dispose', () => sharedDisposals++);
  tile.materials[0].addEventListener('dispose', () => sharedDisposals++);

  view.dispose();
  view.dispose();
  assert.ok(!scene.children.includes(view.group));
  assert.ok([...disposals.values()].every((count) => count === 1));
  assert.equal(sharedDisposals, 0);
});

test('clicking a horizontal ledge over a vertical strip places CHAR across the upper platform', () => {
  const level = { seed: 1, turns: 12, words: [], blocks: [
    { start: [0, 0, 0], dir: [0, 0, 1], length: 4 },
    { start: [-1, 2, 0], dir: [1, 0, 0], length: 6 },
  ] };
  const board = buildBoard(level);
  const sceneView = new BoardView(board, new THREE.Scene());
  try {
    sceneView.setHighlights(new Map([[slotKey([0, 0, 0], '+y'), 'selected']]));
    sceneView.group.updateMatrixWorld(true);
    const clicked = sceneView.pick(rayAbove());
    assert.equal(clicked, slotKey([0, 2, 0], '+y'));
    const dir = normalize([0, 1, 0.001]);
    const options = placementOptions(board, chainsForView(board, dir, undefined, true), clicked, dir);
    const chain = options[0];
    assert.equal(placementDirection(board, chain, dir), 'Across →');
    const game = createGame(level, board);
    game.rack = [...'CHAR'];
    const start = chain.slots.indexOf(clicked);
    for (const key of chain.slots.slice(start, start + 4)) assert.ok(placeTile(game, key, 0));
    assert.deepEqual(game.pending.map(({ slot }) => slot), [0, 1, 2, 3].map((x) => slotKey([x, 2, 0], '+y')));
    assert.equal(game.pending.map(({ letter }) => letter).join(''), 'CHAR');
  } finally {
    sceneView.dispose();
  }
});

test('hover highlights glow like the others', () => {
  const view = new BoardView(board, new THREE.Scene());
  try {
    view.setHighlights(new Map([[lower, 'hover'], [uncovered, 'hoverAligned']]));
    view.animate(1);
    assert.ok(view.tiles.get(lower).face.emissiveIntensity > 0);
    assert.ok(view.tiles.get(uncovered).face.emissiveIntensity > view.tiles.get(lower).face.emissiveIntensity);
  } finally {
    view.dispose();
  }
});
