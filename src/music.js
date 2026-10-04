// Background music, composed on the fly with the Web Audio API so there is no
// file to load or license. A slow loop of four chords (Cmaj7, Am7, Fmaj7, G6)
// under a music-box melody that wanders up and down a pentatonic scale: a
// bass note on the first beat, a soft arpeggio, a held chord that changes
// every bar, and a little echo. Nothing is held for long, so there is no
// constant drone; the chords keep the tune moving.
//
// createMusic(ctx, out) knows nothing of the page. schedule(until) queues
// every note that starts before `until` (seconds on ctx's clock), so a
// real-time player calls it on a timer and a test can render a stretch
// offline in one go.

const BPM = 68;
const BEAT = 60 / BPM;
const STEP = BEAT / 2; // eighth notes
const STEPS_PER_BAR = 8;

const midi = (n) => 440 * 2 ** ((n - 69) / 12);
// Chord tones (MIDI), root first, one chord per bar.
const CHORDS = [
  { bass: 36, tones: [48, 52, 55, 59] }, // Cmaj7
  { bass: 33, tones: [45, 48, 52, 55] }, // Am7
  { bass: 29, tones: [41, 45, 48, 52] }, // Fmaj7
  { bass: 31, tones: [43, 47, 50, 52] }, // G6
];
// C major pentatonic across two octaves, for the melody.
const SCALE = [72, 74, 76, 79, 81, 84, 86, 88, 91];
// The arpeggio climbs and falls through the chord's tones.
const ARPEGGIO = [0, 1, 2, 3, 2, 1, 2, 1];

export function createMusic(ctx, out, random = Math.random) {
  // Everything passes through a soft echo, which gives the notes room.
  const bus = ctx.createGain();
  const delay = ctx.createDelay(1);
  const feedback = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  delay.delayTime.value = BEAT * 0.75;
  feedback.gain.value = 0.34;
  tone.type = 'lowpass';
  tone.frequency.value = 2600;
  bus.connect(out);
  bus.connect(delay);
  delay.connect(tone).connect(feedback).connect(delay);
  tone.connect(out);

  let step = 0;
  let time = 0; // when the next step starts
  let walk = 3; // where the melody is on SCALE

  // One note: an oscillator through its own envelope, to the bus.
  function note(freq, start, { type = 'sine', gain = 0.1, attack = 0.01, length = 0.6, to = bus } = {}) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(0, start);
    env.gain.linearRampToValueAtTime(gain, start + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, start + attack + length);
    osc.connect(env).connect(to);
    osc.start(start);
    osc.stop(start + attack + length + 0.05);
  }

  // A music-box note: a fundamental with a bright overtone that fades fast.
  function bell(freq, start, gain, length) {
    note(freq, start, { type: 'sine', gain, length });
    note(freq * 3, start, { type: 'sine', gain: gain * 0.18, length: length * 0.3 });
  }

  function playStep(at, n) {
    const bar = Math.floor(n / STEPS_PER_BAR);
    const beat = n % STEPS_PER_BAR;
    const chord = CHORDS[bar % CHORDS.length];

    if (beat === 0) {
      note(midi(chord.bass + 12), at, { type: 'triangle', gain: 0.08, attack: 0.02, length: BEAT * 2.4 });
      // The chord an octave up, swelling in softly and gone again before the
      // next bar: a shimmer under the bells, not a low hum.
      for (const tone of chord.tones) note(midi(tone + 12), at, { type: 'sine', gain: 0.022, attack: 0.5, length: BEAT * 3 });
    }
    if (beat === 4) note(midi(chord.bass + 19), at, { type: 'triangle', gain: 0.05, attack: 0.02, length: BEAT * 1.4 });

    // The arpeggio, on every eighth note, an octave above the chord.
    const arp = chord.tones[ARPEGGIO[beat] % chord.tones.length] + 12;
    bell(midi(arp), at, 0.08, 0.9);

    // The melody: usually a step or two up or down, sometimes resting, and
    // always landing on a calm note at the start of a bar.
    if (beat % 2 === 0 && (beat === 0 || random() < 0.7)) {
      walk = Math.max(0, Math.min(SCALE.length - 1, walk + Math.round((random() - 0.5) * 3.4)));
      bell(midi(SCALE[walk]), at, beat === 0 ? 0.16 : 0.12, beat === 0 ? 1.8 : 1.1);
    }
  }

  return {
    // Starts the music at `when`, on ctx's clock.
    start(when = ctx.currentTime + 0.3) {
      step = 0;
      time = when;
    },
    schedule(until) {
      while (time < until) {
        playStep(time, step);
        time += STEP;
        step++;
      }
    },
  };
}
