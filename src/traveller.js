import * as THREE from 'three';

// A little traveller in the spirit of Monument Valley. They stand on a tile,
// and when a word is played they walk along it, one tile per step. Every
// face of every block holds tiles, so they walk on walls and undersides too,
// always upright to the face beneath them.
//
// Crossing the gap between two joined strips, they move in a straight line
// through 3D space from one strip's end to the other's start. That gap is
// parallel to the view the word was played from, so on screen the step looks
// exactly like any other, while in 3D they step through thin air.

const STEP_S = 0.24; // per tile
const HOP = 0.12; // how high each step bounces
const LIFT = 0.1; // how far above a tile's face they stand

const vec = (a) => new THREE.Vector3(...a);

function figure() {
  const group = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: '#fdfbf7', roughness: 0.6 });
  const hat = new THREE.MeshStandardMaterial({ color: '#e8735f', roughness: 0.55 });
  const skin = new THREE.MeshStandardMaterial({ color: '#fbe3cf', roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.36, 20), cloth);
  body.position.y = 0.18;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.085, 18, 12), skin);
  head.position.y = 0.42;
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.2, 18), hat);
  cap.position.y = 0.56;
  group.add(body, head, cap);
  group.scale.setScalar(1.6); // big enough to follow across the monument
  group.traverse((mesh) => (mesh.renderOrder = 3));
  return group;
}

export class Traveller {
  constructor(scene) {
    this.group = figure();
    this.scene = scene;
    scene.add(this.group);
    this.slot = null; // the slot they stand on
    this.walk = null; // { points, normals, start, onDone } while walking
    this.spin = 0;
  }

  // The point above a slot's face where they stand, and the face's normal.
  static spot(slot) {
    return { at: vec(slot.center).addScaledVector(vec(slot.normal), LIFT), normal: vec(slot.normal) };
  }

  standOn(slot) {
    this.slot = slot;
    this.walk = null;
    const { at, normal } = Traveller.spot(slot);
    this.place(at, normal, null);
  }

  // Walks along a list of slots in order, then calls onDone. Returns how
  // long the walk takes, in seconds, so callers can wait for it.
  walkAlong(slots, onDone) {
    if (!slots.length) return 0;
    const spots = slots.map(Traveller.spot);
    this.walk = { spots, start: performance.now() / 1000, onDone };
    this.slot = slots.at(-1);
    return STEP_S * Math.max(1, spots.length - 1) + 0.2;
  }

  // Up is the face's normal; forward is the way they are heading, flattened
  // onto the face.
  place(at, up, heading) {
    this.group.position.copy(at);
    const forward = (heading ?? new THREE.Vector3(1, 0, 0).applyAxisAngle(up, this.spin)).clone();
    forward.addScaledVector(up, -forward.dot(up));
    if (forward.lengthSq() < 1e-6) forward.set(up.y, up.z, up.x).cross(up);
    forward.normalize();
    const side = new THREE.Vector3().crossVectors(up, forward);
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, forward));
  }

  update(time) {
    if (!this.walk) {
      // Standing still: a gentle bob.
      if (!this.slot) return;
      const { at, normal } = Traveller.spot(this.slot);
      at.addScaledVector(normal, 0.015 * Math.sin(time * 2.4));
      this.spin = Math.sin(time * 0.5) * 0.6;
      this.place(at, normal, null);
      return;
    }
    const { spots, start, onDone } = this.walk;
    const progress = Math.max(0, (time - start) / STEP_S);
    const i = Math.min(spots.length - 1, Math.floor(progress));
    if (i >= spots.length - 1) {
      this.walk = null;
      const last = spots.at(-1);
      this.place(last.at, last.normal, null);
      onDone?.();
      return;
    }
    const t = progress - i;
    const a = spots[i];
    const b = spots[i + 1];
    const up = a.normal.clone().lerp(b.normal, t).normalize();
    const at = a.at.clone().lerp(b.at, t).addScaledVector(up, HOP * Math.sin(Math.PI * t));
    this.place(at, up, b.at.clone().sub(a.at));
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((mesh) => {
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    });
  }
}
