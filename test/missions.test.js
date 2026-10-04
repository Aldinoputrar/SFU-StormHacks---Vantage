import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MISSIONS, completeMissions, pickMissions } from '../src/missions.js';
import { mulberry32 } from '../src/random.js';

const turn = (overrides = {}) => ({
  word: 'TABLE',
  placed: [{ slot: 'x', letter: 'T' }],
  cyclic: false,
  onBridge: false,
  points: { surfaces: 2, total: 14, bonuses: [] },
  ...overrides,
});

test('every run gets three different missions, always including crossing the gap', () => {
  const random = mulberry32(3);
  for (let i = 0; i < 50; i++) {
    const missions = pickMissions(random);
    assert.equal(missions.length, 3);
    assert.equal(missions[0].id, 'cross');
    assert.equal(new Set(missions.map(({ id }) => id)).size, 3);
  }
});

test('a word completes the missions it meets, once', () => {
  const missions = MISSIONS.map(({ id, text }) => ({ id, text, done: false }));
  const done = completeMissions(missions, { turn: turn({ word: 'QUARTZ', placed: [{ letter: 'Q' }], points: { surfaces: 2, total: 48, bonuses: ['TW'] } }) });
  assert.deepEqual(done.map(({ id }) => id).sort(), ['big', 'bonus', 'cross', 'long', 'rare']);
  assert.deepEqual(completeMissions(missions, { turn: turn() }), []);
  assert.deepEqual(completeMissions(missions, { chamber: 2 }), []);
  assert.deepEqual(completeMissions(missions, { chamber: 3 }).map(({ id }) => id), ['chamber']);
  assert.deepEqual(completeMissions(missions, { turn: turn({ cyclic: true, onBridge: true }) }).map(({ id }) => id).sort(), ['bridge', 'loop']);
});
