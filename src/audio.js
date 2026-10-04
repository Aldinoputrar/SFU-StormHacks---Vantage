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

export function createSound({ onChange = () => {} } = {}) {
  let ctx = null;
  let master = null;
  let ambience = null;
  let musicTimer = null;
  let nextNote = 0;
  let melodyIndex = 0;
  let muted = loadMuted();
  let available = Boolean(window.AudioContext ?? window.webkitAudioContext);

  async function unlock() {
    if (!available) return false;
    try {
      if (!ctx) {
        const Context = window.AudioContext ?? window.webkitAudioContext;
        ctx = new Context({ latencyHint: 'playback' });
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 0.6;
        master.connect(ctx.destination);
        ctx.addEventListener('statechange', updatePlayback);
        startPad();
      }
      // Chrome may create a suspended context even during the first gesture.
      // Resume the new context too, and allow later gestures to retry.
      if (ctx.state !== 'running') await ctx.resume();
      updatePlayback();
      return ctx.state === 'running';
    } catch {
      if (!ctx) available = false;
      updatePlayback();
      return false;
    }
  }

  function updatePlayback() {
    if (ctx?.state === 'running' && !muted) startMusic();
    else {
      clearInterval(musicTimer);
      musicTimer = null;
    }
    onChange();
  }

  function setMuted(value) {
    muted = Boolean(value);
    try {
      localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    } catch {
      // Storage can be refused; the setting then lasts for this visit.
    }
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.6, ctx.currentTime, 0.05);
    updatePlayback();
    return muted;
  }

  // One note: an oscillator through its own envelope.
  function tone(freq, { type = 'sine', at = 0, attack = 0.005, decay = 0.4, gain = 0.2, to = null, output = master } = {}) {
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
    osc.connect(env).connect(output);
    osc.onended = () => { osc.disconnect(); env.disconnect(); };
    osc.start(start);
    osc.stop(start + attack + decay + 0.05);
  }

  // A bell: a fundamental with a quieter, faster-fading overtone.
  function bell(freq, at = 0, gain = 0.16, decay = 1.1, output = master) {
    tone(freq, { at, gain, decay, output });
    tone(freq * 2.76, { at, gain: gain * 0.25, decay: decay * 0.4, output });
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
    source.onended = () => { source.disconnect(); filter.disconnect(); env.disconnect(); };
    source.start(start);
  }

  // A warm chord with a slow breath, audible under the sparse bell melody.
  function startPad() {
    const pad = ctx.createGain();
    pad.gain.value = 0.09;
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
      depth.gain.value = 0.15;
      const voice = ctx.createGain();
      voice.gain.value = 0.3;
      lfo.connect(depth).connect(voice.gain);
      osc.connect(voice).connect(pad);
      osc.start();
      lfo.start();
    }

    // A soft echo gives background bells space without clouding game cues.
    ambience = ctx.createGain();
    ambience.connect(master);
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.45;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.22;
    const wet = ctx.createGain();
    wet.gain.value = 0.25;
    ambience.connect(delay).connect(wet).connect(master);
    delay.connect(feedback).connect(delay);
  }

  // Schedule a little ahead on the audio clock so the melody stays smooth
  // while the player orbits, visits the chamber, or opens the lab.
  function startMusic() {
    if (musicTimer !== null) return;
    const melody = [0, 2, 4, 2, 1, 3, 2, null, 0, 2, 4, 5, 4, 3, 1, null];
    nextNote = ctx.currentTime + 0.15;
    const schedule = () => {
      if (ctx.state !== 'running' || muted) return;
      if (nextNote < ctx.currentTime) nextNote = ctx.currentTime + 0.15;
      while (nextNote < ctx.currentTime + 0.8) {
        const note = melody[melodyIndex++ % melody.length];
        if (note !== null) bell(SCALE[note] / 2, nextNote - ctx.currentTime, 0.075, 2.8, ambience);
        nextNote += 2.4;
      }
    };
    musicTimer = setInterval(schedule, 250);
    schedule();
  }

  return {
    unlock,
    get muted() {
      return muted;
    },
    get playing() {
      return !muted && ctx?.state === 'running';
    },
    get available() { return available; },
    setMuted,
    toggleMute: () => setMuted(!muted),

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
