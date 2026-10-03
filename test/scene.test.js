import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as THREE from 'three';
import { buildBoard, slotKey } from '../src/board.js';
import { BoardView } from '../src/scene.js';

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

test('a focused line can be picked through a covering ledge, and clearing restores normal picking', () => {
  const view = new BoardView(board, new THREE.Scene());
  try {
    view.group.updateMatrixWorld(true);
    assert.equal(view.pick(rayAbove()), upper);

    view.setFocus([lower]);
    view.group.updateMatrixWorld(true);
    assert.equal(view.pick(rayAbove()), lower);
    assert.equal(view.pick(rayAbove(2)), uncovered);

    view.setFocus(null);
    assert.equal(view.pick(rayAbove()), upper);
    assert.equal(view.tiles.get(lower).overlay.visible, false);
  } finally {
    view.dispose();
  }
});

test('focused tiles keep their letters and highlights while ordinary tile materials stay solid', () => {
  const view = new BoardView(board, new THREE.Scene());
  try {
    const tile = view.tiles.get(lower);
    const side = tile.materials[0];
    view.setFocus([lower]);
    const overlay = tile.overlay;
    const emptyTexture = overlay.material.map;
    assert.equal(overlay.material.depthTest, false);
    assert.equal(overlay.material.depthWrite, false);
    assert.ok(overlay.renderOrder > tile.mesh.renderOrder);
    assert.equal(tile.face.depthTest, true);
    assert.equal(side.depthTest, true);

    view.setTile(lower, 'A', 'pending');
    assert.notEqual(overlay.material.map, emptyTexture);
    assert.equal(overlay.material.map, tile.face.map);
    view.setHighlights(new Map([[lower, 'cursor']]));
    view.animate(0);
    assert.ok(overlay.material.emissiveIntensity > 0);
    assert.equal(overlay.material.emissiveIntensity, tile.face.emissiveIntensity);

    view.setHighlights(new Map());
    view.setFocus([]);
    assert.equal(overlay.material.emissiveIntensity, 0);
    assert.equal(overlay.visible, false);
    view.setFocus([lower]);
    assert.equal(overlay.visible, true);
    assert.equal(overlay.material.map, tile.face.map);
  } finally {
    view.dispose();
  }
});

test('disposing a board releases owned resources once and preserves shared textures and sides', () => {
  const scene = new THREE.Scene();
  const view = new BoardView(board, scene);
  view.setFocus([lower]);
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
