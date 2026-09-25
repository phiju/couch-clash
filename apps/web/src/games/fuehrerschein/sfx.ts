/**
 * Small synthesized sounds for the Führerschein show (no extra files):
 * a rubber-stamp thump and a "hup hup" for the driving-school intro.
 * Host only, through the audio engine's effects bus; silent if audio is locked.
 */
import { getAudioEngine } from "../../lib/audio/engine";

function out() {
  const engine = getAudioEngine();
  const ctx = engine.context;
  const bus = engine.effectsOutput;
  return engine.unlocked && ctx && bus ? { ctx, bus } : null;
}

/** Thump + paper slap. */
export function playStamp(passed: boolean) {
  const o = out();
  if (!o) return;
  const { ctx, bus } = o;
  const t = ctx.currentTime;
  const thump = ctx.createOscillator();
  const thumpGain = ctx.createGain();
  thump.frequency.setValueAtTime(passed ? 150 : 120, t);
  thump.frequency.exponentialRampToValueAtTime(45, t + 0.16);
  thumpGain.gain.setValueAtTime(0.9, t);
  thumpGain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  thump.connect(thumpGain).connect(bus);
  thump.start(t);
  thump.stop(t + 0.25);
  // Paper slap: a short burst of filtered noise.
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.08), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1800;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.5;
  src.connect(filter).connect(noiseGain).connect(bus);
  src.start(t);
}

/** Two short honks of an old car horn. */
export function playHorn() {
  const o = out();
  if (!o) return;
  const { ctx, bus } = o;
  for (const start of [0, 0.22]) {
    const t = ctx.currentTime + start;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.02);
    gain.gain.setValueAtTime(0.18, t + 0.14);
    gain.gain.linearRampToValueAtTime(0, t + 0.18);
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1400;
    for (const f of [392, 494]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + 0.2);
    }
    filter.connect(gain).connect(bus);
  }
}
