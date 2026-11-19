import { useState } from 'react';

// Reveal sounds, synthesized with Web Audio (no audio files).
// Browsers only allow audio after a user gesture; the "Reveal the games" click counts.

const KEY = 'fp-muted';

let muted = (() => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  c: AudioContext,
  freq: number,
  { delay = 0, dur = 0.1, gain = 0.1, type = 'sine' as OscillatorType, endFreq = freq } = {},
) {
  const t = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq !== freq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export type Outcome = 'win' | 'lose' | 'draw';

export const sound = {
  isMuted: () => muted,
  setMuted(m: boolean) {
    muted = m;
    try {
      localStorage.setItem(KEY, m ? '1' : '0');
    } catch {
      // Not saved; still applies for this page.
    }
  },
  /** Soft tick while numbers spin. */
  tick() {
    const c = audio();
    if (c) tone(c, 2200 + Math.random() * 400, { dur: 0.025, gain: 0.012, type: 'square' });
  },
  /** The coin passing edge-on while it flips. */
  coinTick() {
    const c = audio();
    if (c) tone(c, 2900 + Math.random() * 300, { dur: 0.035, gain: 0.025, type: 'triangle' });
  },
  /** The coin landing: a thud and a short metallic ring. */
  coinLand() {
    const c = audio();
    if (!c) return;
    tone(c, 160, { dur: 0.12, gain: 0.25, type: 'sine', endFreq: 70 });
    tone(c, 1850, { dur: 0.45, gain: 0.05, type: 'sine' });
    tone(c, 2780, { dur: 0.3, gain: 0.03, type: 'sine' });
  },
  /** The chosen game landing. */
  land() {
    const c = audio();
    if (!c) return;
    tone(c, 140, { dur: 0.18, gain: 0.3, type: 'sine', endFreq: 60 });
    tone(c, 880, { dur: 0.06, gain: 0.04, type: 'triangle' });
  },
  /** A final category landing. */
  slam() {
    const c = audio();
    if (!c) return;
    tone(c, 110, { dur: 0.25, gain: 0.35, type: 'triangle', endFreq: 55 });
    tone(c, 660, { dur: 0.12, gain: 0.05, type: 'square', endFreq: 440 });
  },
  /** A stat landing. */
  clack() {
    const c = audio();
    if (!c) return;
    tone(c, 190, { dur: 0.1, gain: 0.14, type: 'triangle', endFreq: 80 });
    tone(c, 1400, { dur: 0.03, gain: 0.025, type: 'square' });
  },
  // ---- draft

  /** Online: it just became your turn. A bright two-note chime. */
  yourTurn() {
    const c = audio();
    if (!c) return;
    tone(c, 660, { dur: 0.18, gain: 0.08, type: 'triangle' });
    tone(c, 990, { delay: 0.12, dur: 0.3, gain: 0.08, type: 'triangle' });
    tone(c, 1980, { delay: 0.12, dur: 0.25, gain: 0.015, type: 'sine' });
  },
  /** Your pick lands in your roster: a card slapped down. */
  pickMine() {
    const c = audio();
    if (!c) return;
    tone(c, 150, { dur: 0.16, gain: 0.26, type: 'sine', endFreq: 65 });
    tone(c, 950, { dur: 0.04, gain: 0.05, type: 'square' });
  },
  /** The other side's pick: lighter, so you can tell them apart without looking. */
  pickTheirs() {
    const c = audio();
    if (!c) return;
    tone(c, 240, { dur: 0.12, gain: 0.14, type: 'triangle', endFreq: 120 });
    tone(c, 1300, { dur: 0.03, gain: 0.02, type: 'square' });
  },
  /** Last seconds of your pick clock; higher as it gets closer. */
  clockTick(secondsLeft: number) {
    const c = audio();
    if (c) tone(c, 900 + (5 - secondsLeft) * 140, { dur: 0.05, gain: 0.035, type: 'square' });
  },
  /** Draft complete: rosters locked. */
  rostersLocked() {
    const c = audio();
    if (!c) return;
    tone(c, 110, { dur: 0.3, gain: 0.3, type: 'sine', endFreq: 60 });
    [330, 415, 494].forEach((f) => tone(c, f, { delay: 0.05, dur: 0.7, gain: 0.05, type: 'triangle' }));
  },

  /** End of the reveal. */
  swell(outcome: Outcome) {
    const c = audio();
    if (!c) return;
    const notes = outcome === 'win' ? [523, 659, 784, 1047] : outcome === 'lose' ? [392, 330, 294, 247] : [440, 554, 440];
    notes.forEach((f, i) => tone(c, f, { delay: i * 0.13, dur: 0.5 + i * 0.1, gain: 0.08, type: 'triangle' }));
    if (outcome === 'win') tone(c, 1047, { delay: 0.55, dur: 0.9, gain: 0.05, type: 'sine' });
  },
};

export function useMuted(): [boolean, (m: boolean) => void] {
  const [m, setM] = useState(sound.isMuted());
  return [
    m,
    (v: boolean) => {
      sound.setMuted(v);
      setM(v);
    },
  ];
}
