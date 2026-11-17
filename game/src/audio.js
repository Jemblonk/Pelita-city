// Procedural sound: every effect is a WebAudio oscillator or filtered noise
// burst, so the game ships no audio files. Everything is guarded — with no
// AudioContext (Node harness, muted tab) every call is a silent no-op.
import { clamp } from './util.js';

export function createAudio() {
  const sys = {
    ctx: null,
    master: null,
    muted: false,
    engineOsc: null,
    engineGain: null,
    sirenTimer: 0,
    sirenOn: false,
    sirenOsc: null,
    sirenGain: null,
  };

  function ensure() {
    if (sys.ctx) {
      if (sys.ctx.state === 'suspended') sys.ctx.resume().catch(() => {});
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      sys.ctx = new AC();
      sys.master = sys.ctx.createGain();
      sys.master.gain.value = 0.35;
      sys.master.connect(sys.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function tone(freq, dur, type, vol, slideTo) {
    if (sys.muted || !ensure()) return;
    try {
      const t = sys.ctx.currentTime;
      const osc = sys.ctx.createOscillator();
      const g = sys.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      g.gain.setValueAtTime(vol || 0.2, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g);
      g.connect(sys.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch {
      // Audio must never break the game.
    }
  }

  function noise(dur, vol, filterFreq) {
    if (sys.muted || !ensure()) return;
    try {
      const t = sys.ctx.currentTime;
      const len = Math.max(1, Math.floor(sys.ctx.sampleRate * dur));
      const buf = sys.ctx.createBuffer(1, len, sys.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = sys.ctx.createBufferSource();
      src.buffer = buf;
      const filter = sys.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = filterFreq || 1200;
      const g = sys.ctx.createGain();
      g.gain.setValueAtTime(vol || 0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter);
      filter.connect(g);
      g.connect(sys.master);
      src.start(t);
    } catch {
      // ignore
    }
  }

  return {
    unlock() {
      ensure();
    },
    setMuted(m) {
      sys.muted = m;
      if (m) this.stopEngine();
    },
    get muted() {
      return sys.muted;
    },
    shoot() {
      noise(0.09, 0.5, 2600);
      tone(190, 0.07, 'square', 0.16, 70);
    },
    enemyShoot() {
      noise(0.07, 0.3, 2000);
    },
    punch() {
      noise(0.08, 0.4, 700);
      tone(110, 0.08, 'sine', 0.25, 55);
    },
    crash(strength) {
      noise(0.22, clamp(0.15 + strength * 0.4, 0.15, 0.6), 500);
      tone(70, 0.18, 'sine', 0.3, 35);
    },
    horn() {
      tone(340, 0.22, 'sawtooth', 0.14);
      tone(425, 0.22, 'sawtooth', 0.1);
    },
    pickup() {
      tone(660, 0.09, 'sine', 0.2);
      setTimeout(() => tone(880, 0.12, 'sine', 0.2), 70);
    },
    cash() {
      tone(990, 0.08, 'triangle', 0.2);
      setTimeout(() => tone(1320, 0.14, 'triangle', 0.2), 80);
    },
    missionDone() {
      [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => tone(f, 0.16, 'triangle', 0.22), i * 110));
    },
    busted() {
      tone(320, 0.5, 'sawtooth', 0.2, 160);
      setTimeout(() => tone(240, 0.6, 'sawtooth', 0.2, 120), 350);
    },
    door() {
      noise(0.06, 0.25, 900);
    },
    // Continuous engine hum while driving: one oscillator, pitch follows speed.
    engine(speedNorm) {
      if (sys.muted || !ensure()) return;
      try {
        if (!sys.engineOsc) {
          sys.engineOsc = sys.ctx.createOscillator();
          sys.engineGain = sys.ctx.createGain();
          sys.engineOsc.type = 'sawtooth';
          sys.engineGain.gain.value = 0;
          const filter = sys.ctx.createBiquadFilter();
          filter.type = 'lowpass';
          filter.frequency.value = 420;
          sys.engineOsc.connect(filter);
          filter.connect(sys.engineGain);
          sys.engineGain.connect(sys.master);
          sys.engineOsc.start();
        }
        const t = sys.ctx.currentTime;
        sys.engineOsc.frequency.setTargetAtTime(55 + speedNorm * 90, t, 0.08);
        sys.engineGain.gain.setTargetAtTime(0.05 + speedNorm * 0.05, t, 0.1);
      } catch {
        // ignore
      }
    },
    stopEngine() {
      if (sys.engineGain && sys.ctx) {
        try {
          sys.engineGain.gain.setTargetAtTime(0, sys.ctx.currentTime, 0.05);
        } catch {
          // ignore
        }
      }
    },
    // Two-tone siren wail while any cop is in pursuit; call every frame.
    siren(active, dt) {
      if (!active) {
        if (sys.sirenOsc && sys.ctx) {
          try {
            sys.sirenGain.gain.setTargetAtTime(0, sys.ctx.currentTime, 0.1);
          } catch {
            // ignore
          }
        }
        sys.sirenOn = false;
        return;
      }
      if (sys.muted || !ensure()) return;
      try {
        if (!sys.sirenOsc) {
          sys.sirenOsc = sys.ctx.createOscillator();
          sys.sirenGain = sys.ctx.createGain();
          sys.sirenOsc.type = 'triangle';
          sys.sirenGain.gain.value = 0;
          sys.sirenOsc.connect(sys.sirenGain);
          sys.sirenGain.connect(sys.master);
          sys.sirenOsc.start();
        }
        sys.sirenTimer += dt;
        const phase = (sys.sirenTimer % 1.2) / 1.2;
        const freq = phase < 0.5 ? 720 : 540;
        sys.sirenOsc.frequency.setTargetAtTime(freq, sys.ctx.currentTime, 0.03);
        sys.sirenGain.gain.setTargetAtTime(0.045, sys.ctx.currentTime, 0.1);
        sys.sirenOn = true;
      } catch {
        // ignore
      }
    },
  };
}
