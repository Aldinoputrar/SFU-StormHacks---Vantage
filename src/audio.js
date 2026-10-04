// Sound, synthesised with the Web Audio API so there are no files to load:
// soft bell tones on a pentatonic scale, in the spirit of Monument Valley.
// Browsers only allow audio after the player interacts, so nothing plays
// until unlock() is called from a click or key press.

const STORAGE_KEY = 'vantage-muted';
// A major pentatonic scale from C5, so any run of notes sounds consonant.
const SCALE = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];

function loadMuted() {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function createSound() {
  let ctx = null;
  let master = null;
  let pad = null;
  let muted = loadMuted();

  function unlock() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    const Context = window.AudioContext ?? window.webkitAudioContext;
    if (!Context) return;
    ctx = new Context();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ctx.destination);
    startPad();
  }

  // One note: an oscillator through its own envelope.
  function tone(freq, { type = 'sine', at = 0, attack = 0.005, decay = 0.4, gain = 0.2, to = null } = {}) {
    if (!ctx || muted) return;
    const start = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, start + attack + decay);
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
    osc.connect(env).connect(master);
    osc.start(start);
    osc.stop(start + attack + decay + 0.05);
  }

  // A bell: a fundamental with a quieter, faster-fading overtone.
  function bell(freq, at = 0, gain = 0.16, decay = 1.1) {
    tone(freq, { at, gain, decay });
    tone(freq * 2.76, { at, gain: gain * 0.25, decay: decay * 0.4 });
  }

  // A breath of filtered noise, for the world sliding past.
  function whoosh(duration = 1.2, gain = 0.06) {
    if (!ctx || muted) return;
    const length = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    const start = ctx.currentTime;
    filter.frequency.setValueAtTime(300, start);
    filter.frequency.exponentialRampToValueAtTime(1400, start + duration * 0.5);
    filter.frequency.exponentialRampToValueAtTime(400, start + duration);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + duration * 0.4);
    env.gain.linearRampToValueAtTime(0, start + duration);
    source.connect(filter).connect(env).connect(master);
    source.start(start);
  }

  // A quiet drone of two slightly detuned fifths that slowly breathes.
  function startPad() {
    pad = ctx.createGain();
    pad.gain.value = 0.035;
    pad.connect(master);
    for (const [freq, detune] of [
      [130.81, -4],
      [196, 3],
      [261.63, 6],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 0.07 + Math.random() * 0.05;
      depth.gain.value = 0.4;
      const voice = ctx.createGain();
      voice.gain.value = 0.5;
      lfo.connect(depth).connect(voice.gain);
      osc.connect(voice).connect(pad);
      osc.start();
      lfo.start();
    }
  }

  return {
    unlock,
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
      } catch {
        // Storage can be refused; the setting then lasts for this visit.
      }
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.05);
      return muted;
    },

    place: (i = 0) => tone(SCALE[i % 5] / 2, { type: 'triangle', decay: 0.18, gain: 0.22 }),
    undo: () => tone(392, { type: 'triangle', decay: 0.12, gain: 0.14, to: 300 }),
    error: () => {
      tone(196, { type: 'square', decay: 0.12, gain: 0.05 });
      tone(185, { type: 'square', at: 0.09, decay: 0.16, gain: 0.05 });
    },
    // Two strips meeting: a soft rising fifth.
    snap: () => {
      bell(SCALE[2], 0, 0.1, 0.9);
      bell(SCALE[6], 0.09, 0.08, 1.2);
    },
    // A word scored: a run up the scale, longer for bigger scores.
    word: (points) => {
      const notes = Math.min(SCALE.length, 3 + Math.floor(points / 8));
      for (let i = 0; i < notes; i++) bell(SCALE[i], i * 0.075, 0.12, 0.9);
    },
    right: () => {
      bell(SCALE[2], 0, 0.14);
      bell(SCALE[4], 0.1, 0.14);
      bell(SCALE[7], 0.2, 0.12, 1.4);
    },
    wrong: () => {
      bell(SCALE[3] / 2, 0, 0.12, 0.7);
      bell(SCALE[1] / 2, 0.14, 0.12, 0.9);
    },
    pick: () => tone(SCALE[4], { decay: 0.12, gain: 0.08 }),
    walk: () => whoosh(1.3, 0.05),
    reveal: () => {
      whoosh(1.6, 0.04);
      for (let i = 0; i < 5; i++) bell(SCALE[8 - i], i * 0.06, 0.05, 0.6);
    },
    // The end of a run: a slow arpeggio that settles.
    finish: () => [0, 2, 4, 5, 7].forEach((step, i) => bell(SCALE[step], i * 0.16, 0.12, 1.8)),
  };
}
