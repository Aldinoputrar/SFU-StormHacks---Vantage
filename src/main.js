import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STRIPS } from './structure.js';
import { buildStrip } from './tiles.js';

const VIEW_HEIGHT = 18; // world units visible vertically at zoom 1
const TARGET = new THREE.Vector3(4, 3, 3);
const ISO_DIRECTION = new THREE.Vector3(1, 1, 1).normalize();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#f3ece2');

// Orthographic, so things at different depths can appear to touch.
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 200);
function resize() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.left = (-VIEW_HEIGHT * aspect) / 2;
  camera.right = (VIEW_HEIGHT * aspect) / 2;
  camera.top = VIEW_HEIGHT / 2;
  camera.bottom = -VIEW_HEIGHT / 2;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
resize();
window.addEventListener('resize', resize);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.copy(TARGET);

function snapToIsometric() {
  camera.position.copy(TARGET).addScaledVector(ISO_DIRECTION, 40);
  camera.zoom = 1;
  camera.updateProjectionMatrix();
  controls.update();
}
// Start slightly off the magic angle so the player has to find it.
camera.position.copy(TARGET).add(new THREE.Vector3(30, 18, 14));
controls.update();
document.getElementById('snap').addEventListener('click', snapToIsometric);

scene.add(new THREE.HemisphereLight('#fff6e8', '#8a7a99', 1.6));
const sun = new THREE.DirectionalLight('#ffffff', 1.4);
sun.position.set(10, 20, 6);
scene.add(sun);

for (const strip of STRIPS) scene.add(buildStrip(strip));

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
