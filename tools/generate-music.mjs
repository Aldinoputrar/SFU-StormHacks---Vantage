// Generate our own calm soundtrack: no external download or licensing needed.
// Run: node tools/generate-music.mjs
import { mkdir, writeFile } from 'node:fs/promises';

const sampleRate = 22050;
const beat = 2.4;
const melody = [0, 2, 4, 2, 1, 3, 2, null, 0, 2, 4, 5, 4, 3, 1, null];
const scale = [261.63, 293.66, 329.63, 392, 440, 523.25];
const duration = melody.length * beat;
const samples = Math.round(duration * sampleRate);
const wav = Buffer.alloc(44 + samples * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(samples * 2, 40);

let energy = 0;
let peak = 0;
for (let i = 0; i < samples; i++) {
  const time = i / sampleRate;
  let value = 0;
  // A soft, warm chord, with harmonics that remain audible on laptop speakers.
  for (const freq of [130.81, 196, 261.63]) {
    const phase = time * freq * Math.PI * 2;
    value += 0.055 * (Math.sin(phase) + 0.18 * Math.sin(phase * 2)) * (0.8 + 0.2 * Math.sin(time * 0.3));
  }
  for (let note = 0; note < melody.length; note++) {
    if (melody[note] === null) continue;
    for (const [echo, gain] of [[0, 0.24], [0.38, 0.055], [0.76, 0.025]]) {
      const age = time - (note * beat + 0.2 + echo);
      if (age < 0 || age > 6) continue;
      const envelope = (1 - Math.exp(-age / 0.045)) * Math.exp(-age / 1.4);
      const phase = scale[melody[note]] * age * Math.PI * 2;
      value += gain * envelope * (Math.sin(phase) + 0.2 * Math.sin(phase * 2) * Math.exp(-age));
    }
  }
  value *= Math.min(1, time / 0.6, (duration - time) / 0.6);
  peak = Math.max(peak, Math.abs(value));
  energy += value * value;
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + i * 2);
}
const directory = new URL('../public/audio/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('calm-background.wav', directory), wav);
console.log(`Generated ${duration.toFixed(1)}s music loop, peak ${peak.toFixed(3)}, RMS ${Math.sqrt(energy / samples).toFixed(3)} (${wav.length} bytes).`);
