import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSound } from '../src/audio.js';

function audioBrowser(t, { rejectResume = false, muted = false } = {}) {
  const originals = new Map(['window', 'localStorage', 'setInterval', 'clearInterval'].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)],
  ));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const timers = new Map();
  let timerId = 0;
  globalThis.setInterval = (callback) => { timers.set(++timerId, callback); return timerId; };
  globalThis.clearInterval = (id) => timers.delete(id);
  const storage = new Map([['vantage-muted', muted ? '1' : '0']]);
  globalThis.localStorage = { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  const contexts = [];
  const param = () => ({
    value: 0,
    setValueAtTime(value) { this.value = value; },
    linearRampToValueAtTime(value) { this.value = value; },
    exponentialRampToValueAtTime(value) { this.value = value; },
    setTargetAtTime(value) { this.value = value; },
  });
  class Context {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.nodes = [];
      this.destination = {};
      this.resumeCalls = 0;
      this.rejectResume = rejectResume;
      contexts.push(this);
    }
    node(kind) {
      const node = {
        kind, gain: param(), frequency: param(), detune: param(), delayTime: param(),
        connections: [],
        connect(target) { this.connections.push(target); return target; },
        disconnect() {}, start() { this.started = true; }, stop() {},
      };
      this.nodes.push(node);
      return node;
    }
    createGain() { return this.node('gain'); }
    createOscillator() { return this.node('oscillator'); }
    createDelay() { return this.node('delay'); }
    addEventListener(event, callback) { if (event === 'statechange') this.onStateChange = callback; }
    async resume() {
      this.resumeCalls++;
      if (this.rejectResume) throw new Error('Gesture required');
      this.state = 'running';
      this.onStateChange?.();
    }
  }
  globalThis.window = { AudioContext: Context };
  return { contexts, timers, storage };
}

test('the first gesture resumes a newly suspended context and starts background music once', async (t) => {
  const { contexts, timers } = audioBrowser(t);
  const sound = createSound();
  assert.equal(sound.playing, false);
  assert.equal(await sound.unlock(), true);
  const [ctx] = contexts;
  assert.equal(ctx.resumeCalls, 1);
  assert.equal(sound.playing, true);
  assert.equal(timers.size, 1);
  assert.ok(ctx.nodes.filter((node) => node.kind === 'oscillator' && node.started).length > 6);
  const nodes = ctx.nodes.length;
  await sound.unlock();
  assert.equal(contexts.length, 1);
  assert.equal(ctx.nodes.length, nodes);
  assert.equal(timers.size, 1);
});

test('a blocked resume is handled and a later gesture retries successfully', async (t) => {
  const { contexts, timers } = audioBrowser(t, { rejectResume: true });
  const sound = createSound();
  assert.equal(await sound.unlock(), false);
  assert.equal(sound.playing, false);
  assert.equal(timers.size, 0);
  contexts[0].rejectResume = false;
  assert.equal(await sound.unlock(), true);
  assert.equal(contexts[0].resumeCalls, 2);
  assert.equal(sound.playing, true);
  assert.equal(timers.size, 1);
});

test('mute persists, silences the output, and restarts music after unmuting or interruption', async (t) => {
  const { contexts, timers, storage } = audioBrowser(t, { muted: true });
  let updates = 0;
  const sound = createSound({ onChange: () => updates++ });
  await sound.unlock();
  const [ctx] = contexts;
  const master = ctx.nodes.find((node) => node.connections.includes(ctx.destination));
  assert.equal(master.gain.value, 0);
  assert.equal(timers.size, 0);
  sound.setMuted(false);
  assert.equal(master.gain.value, 0.6);
  assert.equal(timers.size, 1);
  sound.toggleMute();
  assert.equal(master.gain.value, 0);
  assert.equal(storage.get('vantage-muted'), '1');
  assert.equal(timers.size, 0);
  sound.setMuted(false);
  ctx.state = 'interrupted';
  ctx.onStateChange();
  assert.equal(sound.playing, false);
  assert.equal(timers.size, 0);
  await sound.unlock();
  assert.equal(sound.playing, true);
  assert.equal(timers.size, 1);
  assert.ok(updates > 4);
});

test('browsers without Web Audio report sound unavailable', async (t) => {
  audioBrowser(t);
  globalThis.window = {};
  const sound = createSound();
  assert.equal(sound.available, false);
  assert.equal(await sound.unlock(), false);
  assert.equal(sound.playing, false);
});
