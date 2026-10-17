// Procedural sound effects (Web Audio, no audio files).
//
// Every sound is synthesised from oscillators and filtered noise. Sounds that
// happen somewhere in the world (other players' shots and footsteps, bombs,
// glass) take a `pos` and go through an HRTF PannerNode, so they are placed in
// 3D around the listener (the camera) and get duller with distance. Local
// sounds (your own gun, UI blips) go straight to the master bus.
// The master gain follows the volume setting.
import { getSettings } from '../settings';

const GUN = {
  pistol: { crack: 2600, body: 900, q: 1.1, dur: 0.11, gain: 0.34, thump: 170, thumpDur: 0.07, tail: 0.18 },
  rifle: { crack: 1900, body: 650, q: 0.9, dur: 0.09, gain: 0.32, thump: 120, thumpDur: 0.08, tail: 0.24 },
  shotgun: { crack: 900, body: 320, q: 0.6, dur: 0.3, gain: 0.5, thump: 70, thumpDur: 0.2, tail: 0.45 },
  sniper: { crack: 3800, body: 520, q: 0.7, dur: 0.22, gain: 0.5, thump: 60, thumpDur: 0.32, tail: 0.9, snap: true },
};

const STEP = {
  iron: { filter: 'bandpass', freq: 2300, q: 4, gain: 0.22, ring: 340, ringGain: 0.05, dur: 0.07 },
  titanium: { filter: 'bandpass', freq: 2900, q: 5, gain: 0.2, ring: 520, ringGain: 0.05, dur: 0.07 },
  wood: { filter: 'lowpass', freq: 900, q: 1.4, gain: 0.32, ring: 150, ringGain: 0.08, dur: 0.08 },
  glass: { filter: 'highpass', freq: 4200, q: 0.8, gain: 0.12, ring: 2400, ringGain: 0.02, dur: 0.05 },
  rubber: { filter: 'lowpass', freq: 260, q: 0.7, gain: 0.34, ring: 70, ringGain: 0.08, dur: 0.1 },
  struct: { filter: 'lowpass', freq: 520, q: 0.8, gain: 0.3, ring: 95, ringGain: 0.07, dur: 0.08 },
};

export function makeSfx(game) {
  let master = null;
  let noiseBuffer = null;
  let volume = getSettings().volume;
  const ensure = () => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (!game.audio) game.audio = new AudioCtx();
    if (game.audio.state === 'suspended') game.audio.resume().catch?.(() => {});
    if (!master) {
      master = game.audio.createGain();
      master.gain.value = volume;
      const comp = game.audio.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      master.connect(comp);
      comp.connect(game.audio.destination);
      noiseBuffer = game.audio.createBuffer(1, game.audio.sampleRate, game.audio.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    }
    return game.audio;
  };

  // Output node for one sound. pos → 3D panner (+ distance lowpass);
  // pan → simple stereo; nothing → master.
  const output = (ctx, opts = {}) => {
    if (opts.pos && ctx.createPanner) {
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = opts.ref || 2.5;
      panner.rolloffFactor = opts.rolloff || 1.1;
      panner.maxDistance = 120;
      const { x, y, z } = opts.pos;
      if (panner.positionX) {
        panner.positionX.value = x;
        panner.positionY.value = y;
        panner.positionZ.value = z;
      } else {
        panner.setPosition(x, y, z);
      }
      const cam = game.camera?.position;
      const dist = cam ? Math.hypot(x - cam.x, y - cam.y, z - cam.z) : 0;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(900, 18000 / (1 + dist * 0.12));
      lp.connect(panner);
      panner.connect(master);
      return lp;
    }
    if (opts.pan && ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      panner.connect(master);
      return panner;
    }
    return master;
  };

  const tone = ({ type = 'sine', freq, freqTo, dur, delay = 0, gain, attack = 0.002 }, out) => {
    const ctx = ensure();
    if (!ctx || gain <= 0) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t + dur);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp);
    amp.connect(out || output(ctx));
    osc.start(t);
    osc.stop(t + dur + 0.03);
  };

  const noise = ({ filter = 'bandpass', freq, freqTo, q = 1, dur, delay = 0, gain, attack = 0.003 }, out) => {
    const ctx = ensure();
    if (!ctx || gain <= 0) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter;
    biquad.frequency.setValueAtTime(freq, t);
    if (freqTo) biquad.frequency.exponentialRampToValueAtTime(Math.max(20, freqTo), t + dur);
    biquad.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(gain, t + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(biquad);
    biquad.connect(amp);
    amp.connect(out || output(ctx));
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  };

  // Run a sound recipe through one shared output (one panner per sound).
  const play = (opts, recipe) => {
    const ctx = ensure();
    if (!ctx) return;
    const out = output(ctx, opts);
    recipe(out, opts.gain ?? 1);
  };
  const click = (freq, delay, gain, out) => noise({ filter: 'bandpass', freq, q: 3, dur: 0.035, delay, gain }, out);
  const vary = (amount = 0.08) => 1 + (Math.random() - 0.5) * amount * 2;

  const legacy = (opts) => {
    if (typeof opts === 'number') return { gain: opts / 0.04 };
    return opts || {};
  };

  return {
    setVolume(v) {
      volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (master && game.audio) master.gain.setTargetAtTime(volume, game.audio.currentTime, 0.02);
    },
    get volume() {
      return volume;
    },
    updateListener(camera) {
      const ctx = game.audio;
      if (!ctx || !camera) return;
      const l = ctx.listener;
      const p = camera.position;
      const f = camera.getWorldDirection(game._sfxDir || (game._sfxDir = camera.position.clone()));
      if (l.positionX) {
        l.positionX.value = p.x;
        l.positionY.value = p.y;
        l.positionZ.value = p.z;
        l.forwardX.value = f.x;
        l.forwardY.value = f.y;
        l.forwardZ.value = f.z;
        l.upX.value = 0;
        l.upY.value = 1;
        l.upZ.value = 0;
      } else if (l.setPosition) {
        l.setPosition(p.x, p.y, p.z);
        l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
      }
    },
    // Per-weapon gunshot: crack + body + low thump + room tail.
    shot(rawKind = 'pistol', rawOpts = {}) {
      const opts = typeof rawKind === 'number' ? { gain: rawKind / 0.04 } : legacy(rawOpts);
      const kind = typeof rawKind === 'number' ? 'rifle' : rawKind;
      const spec = GUN[kind] || GUN.rifle;
      const far = opts.pos ? 1.4 : 1;
      play(opts, (out, g) => {
        const v = vary(0.05);
        noise({ filter: 'bandpass', freq: spec.crack * v, freqTo: spec.crack * 0.35, q: spec.q, dur: spec.dur, gain: spec.gain * g }, out);
        noise({ filter: 'lowpass', freq: spec.body * 2, freqTo: spec.body * 0.5, q: 0.7, dur: spec.dur * 1.6, gain: spec.gain * 0.6 * g }, out);
        tone({ type: 'sine', freq: spec.thump * v, freqTo: spec.thump * 0.4, dur: spec.thumpDur, gain: 0.24 * g }, out);
        noise({ filter: 'lowpass', freq: 1400, freqTo: 220, q: 0.5, dur: spec.tail * far, delay: 0.02, gain: spec.gain * 0.14 * g, attack: 0.03 }, out);
        if (spec.snap) noise({ filter: 'highpass', freq: 5000, dur: 0.04, gain: 0.3 * g }, out);
        if (kind === 'shotgun') click(1800, 0.32, 0.08 * g, out); // pump
      });
    },
    // Footstep that depends on the surface underfoot.
    step(rawOpts = {}) {
      const opts = legacy(rawOpts);
      const spec = STEP[opts.material] || STEP.struct;
      play(opts, (out, g) => {
        const v = vary(0.12);
        noise({ filter: spec.filter, freq: spec.freq * v, freqTo: spec.freq * 0.45, q: spec.q, dur: spec.dur, gain: spec.gain * g }, out);
        tone({ type: 'sine', freq: spec.ring * v, freqTo: spec.ring * 0.7, dur: spec.dur * 0.9, gain: spec.ringGain * g }, out);
      });
    },
    land(rawOpts = {}) {
      const opts = legacy(rawOpts);
      play(opts, (out, g) => {
        noise({ filter: 'lowpass', freq: 320, freqTo: 90, dur: 0.16, gain: 0.4 * g }, out);
        tone({ type: 'sine', freq: 80, freqTo: 45, dur: 0.12, gain: 0.12 * g }, out);
      });
    },
    reloadStart(kind = 'pistol') {
      const slow = kind === 'sniper' || kind === 'shotgun' ? 1.4 : 1;
      play({}, (out) => {
        click(3200, 0, 0.18, out); // mag release
        noise({ filter: 'bandpass', freq: 1500, q: 2, dur: 0.12, delay: 0.06, gain: 0.08 }, out); // mag slide out
        tone({ type: 'triangle', freq: 210, freqTo: 140, dur: 0.06, delay: 0.16 * slow, gain: 0.05 }, out);
        click(2200, 0.32 * slow, 0.14, out);
      });
    },
    reloadEnd() {
      play({}, (out) => {
        click(2600, 0, 0.22, out); // mag seat
        noise({ filter: 'bandpass', freq: 1100, q: 2, dur: 0.09, delay: 0.1, gain: 0.14 }, out); // slide pull
        click(3400, 0.21, 0.2, out); // slide release
      });
    },
    empty: () => play({}, (out) => click(4200, 0, 0.16, out)),
    equip: () => play({}, (out) => {
      click(2400, 0, 0.12, out);
      tone({ type: 'triangle', freq: 620, dur: 0.04, gain: 0.03, delay: 0.03 }, out);
    }),
    cash: () => play({}, (out) => {
      tone({ type: 'sine', freq: 1320, dur: 0.08, gain: 0.06 }, out);
      tone({ type: 'sine', freq: 1760, dur: 0.16, gain: 0.06, delay: 0.07 }, out);
      noise({ filter: 'highpass', freq: 6000, dur: 0.1, gain: 0.03 }, out);
    }),
    reward: (win) => play({}, (out) => {
      const notes = win ? [988, 1319, 1568, 2093] : [988, 1175];
      notes.forEach((freq, i) => tone({ type: 'sine', freq, dur: 0.14, gain: 0.06, delay: 0.5 + i * 0.08 }, out));
      noise({ filter: 'highpass', freq: 6000, dur: 0.18, gain: 0.03, delay: 0.5 }, out);
    }),
    // Bomb sticks to something: magnetic clunk.
    stick: (pos) => play(pos ? { pos } : {}, (out) => {
      noise({ filter: 'bandpass', freq: 1200, q: 3, dur: 0.06, gain: 0.2 }, out);
      tone({ type: 'square', freq: 880, dur: 0.05, gain: 0.04, delay: 0.04 }, out);
    }),
    // Bomb fuse beep (faster and higher when about to blow).
    beep: (pos, urgent) => play(pos ? { pos, ref: 2 } : {}, (out) => {
      tone({ type: 'square', freq: urgent ? 2100 : 1500, dur: 0.05, gain: 0.05 }, out);
    }),
    // Hitmarker: short metallic tick; headshots add a bright ping.
    hit: (head) => play({}, (out) => {
      noise({ filter: 'bandpass', freq: 5200, q: 6, dur: 0.03, gain: 0.12 }, out);
      tone({ type: 'triangle', freq: head ? 1900 : 1300, dur: 0.07, gain: 0.08 }, out);
      if (head) tone({ type: 'sine', freq: 2700, dur: 0.09, gain: 0.06, delay: 0.04 }, out);
    }),
    kill: () => play({}, (out) => {
      tone({ type: 'triangle', freq: 1100, dur: 0.08, gain: 0.08 }, out);
      tone({ type: 'triangle', freq: 1650, dur: 0.12, gain: 0.08, delay: 0.07 }, out);
      tone({ type: 'sine', freq: 2200, dur: 0.18, gain: 0.05, delay: 0.14 }, out);
    }),
    miss: () => play({}, (out) => tone({ type: 'triangle', freq: 380, freqTo: 140, dur: 0.05, gain: 0.02 }, out)),
    // Skin gun: un-skin = rising shimmer, re-skin = falling sweep + solid thunk.
    unskin: (pos) => play(pos ? { pos } : {}, (out) => {
      tone({ type: 'sine', freq: 240, freqTo: 980, dur: 0.16, gain: 0.06 }, out);
      noise({ filter: 'bandpass', freq: 2000, freqTo: 7000, q: 2, dur: 0.18, gain: 0.05 }, out);
    }),
    reskin: (pos) => play(pos ? { pos } : {}, (out) => {
      tone({ type: 'sine', freq: 820, freqTo: 170, dur: 0.14, gain: 0.06 }, out);
      noise({ filter: 'lowpass', freq: 700, freqTo: 150, dur: 0.12, delay: 0.1, gain: 0.12 }, out);
      tone({ type: 'sine', freq: 110, freqTo: 70, dur: 0.1, delay: 0.1, gain: 0.08 }, out);
    }),
    swipe: () => play({}, (out) => tone({ type: 'sine', freq: 340, freqTo: 120, dur: 0.08, gain: 0.045 }, out)),
    error: () => play({}, (out) => tone({ type: 'square', freq: 180, freqTo: 70, dur: 0.14, gain: 0.045 }, out)),
    // Glass shatter: noise burst + a cloud of random high tinkles.
    shatter: (pos) => play(pos ? { pos } : {}, (out) => {
      noise({ filter: 'highpass', freq: 2500, dur: 0.25, gain: 0.3 }, out);
      noise({ filter: 'bandpass', freq: 6000, q: 1.5, dur: 0.5, delay: 0.02, gain: 0.12 }, out);
      for (let i = 0; i < 9; i += 1) {
        tone({
          type: 'sine', freq: 2500 + Math.random() * 4500, dur: 0.05 + Math.random() * 0.12,
          delay: Math.random() * 0.4, gain: 0.025 + Math.random() * 0.03,
        }, out);
      }
    }),
    // Explosion: sharp crack, low rumble, sub drop and debris crackle.
    blast: (pos) => play(pos ? { pos, ref: 5, rolloff: 0.8 } : {}, (out) => {
      noise({ filter: 'lowpass', freq: 4000, freqTo: 300, q: 0.5, dur: 0.18, gain: 0.5 }, out);
      noise({ filter: 'lowpass', freq: 1200, freqTo: 60, q: 0.6, dur: 1.1, gain: 0.6 }, out);
      tone({ type: 'sine', freq: 95, freqTo: 32, dur: 0.7, gain: 0.32 }, out);
      tone({ type: 'square', freq: 60, freqTo: 40, dur: 0.18, gain: 0.05 }, out);
      for (let i = 0; i < 6; i += 1) {
        noise({ filter: 'bandpass', freq: 1500 + Math.random() * 2500, q: 4, dur: 0.04, delay: 0.15 + Math.random() * 0.5, gain: 0.08 }, out);
      }
    }),
    spawn: () => play({}, (out) => {
      tone({ type: 'sine', freq: 440, freqTo: 880, dur: 0.25, gain: 0.05 }, out);
      tone({ type: 'sine', freq: 660, freqTo: 1320, dur: 0.25, gain: 0.04, delay: 0.05 }, out);
    }),
    round: (win) => play({}, (out) => {
      if (win) {
        tone({ type: 'sine', freq: 523, dur: 0.18, gain: 0.06 }, out);
        tone({ type: 'sine', freq: 784, dur: 0.22, gain: 0.06, delay: 0.14 }, out);
      } else {
        tone({ type: 'sine', freq: 392, dur: 0.18, gain: 0.06 }, out);
        tone({ type: 'sine', freq: 196, dur: 0.24, gain: 0.06, delay: 0.14 }, out);
      }
    }),
  };
}
