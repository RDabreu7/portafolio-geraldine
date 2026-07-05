/**
 * Sonidos UI — original synthesized interaction sounds, two selectable palettes:
 *  · 'lunar'   — soft crystal bells, long moonlit echo (C# minor pentatonic)
 *  · 'galaxia' — bright celesta star-plinks, sparkly runs, cosmic whoosh (major pentatonic)
 * All audio is generated with Web Audio; no files. Exposed as window.SonidosUI.
 * Switch at runtime: SonidosUI.setVariante('lunar' | 'galaxia').
 */
(function () {
  const VARIANTES = {
    lunar: {
      scale: [554.37, 622.25, 740.0, 830.61, 987.77, 1108.73], // C# minor pent
      partials: [[1, 1], [2.0, 0.32], [2.99, 0.12]],           // sine bell
      type: 'sine',
      attack: 0.008, delayTime: 0.34, feedback: 0.38, wet: 0.4, lowpass: 2400,
      durMul: 1
    },
    galaxia: {
      scale: [1046.5, 1174.66, 1318.51, 1567.98, 1760.0, 2093.0], // C major pent, celesta register
      partials: [[1, 1], [2.0, 0.45], [4.0, 0.18], [5.04, 0.08]], // glockenspiel-like
      type: 'triangle',
      attack: 0.003, delayTime: 0.22, feedback: 0.26, wet: 0.3, lowpass: 5200,
      durMul: 0.55
    },
    zelda: {
      scale: [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66], // D major pent — heroic, warm
      partials: [[1, 1], [2.0, 0.35], [3.0, 0.15]],             // harp pluck
      type: 'sine',
      attack: 0.004, delayTime: 0.28, feedback: 0.32, wet: 0.34, lowpass: 3400,
      durMul: 0.85
    }
  };

  class Sonidos {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.variante = 'galaxia';
      this._lastHover = 0;
      this._lastTick = 0;
    }

    get _v() { return VARIANTES[this.variante] || VARIANTES.lunar; }

    setVariante(name) {
      if (VARIANTES[name]) { this.variante = name; this._retune(); }
    }

    // Lazily builds the context + echo network (must follow a user gesture)
    _ensure() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(ctx.destination);
      this.delay = ctx.createDelay(1.5);
      const fb = ctx.createGain();
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
      this.wet = ctx.createGain();
      this.delay.connect(lp); lp.connect(fb); fb.connect(this.delay);
      this.delay.connect(this.wet); this.wet.connect(this.master);
      this._fb = fb; this._lp = lp;
      this._retune();
      return ctx;
    }

    // Applies the active palette's echo character
    _retune() {
      if (!this.ctx) return;
      const v = this._v;
      this.delay.delayTime.value = v.delayTime;
      this._fb.gain.value = v.feedback;
      this._lp.frequency.value = v.lowpass;
      this.wet.gain.value = v.wet;
    }

    // One tuned partial stack using the active palette's timbre
    _bell(freq, t0, dur, vol, pan) {
      const ctx = this.ctx, v = this._v;
      const out = ctx.createGain();
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (p) { p.pan.value = pan || 0; out.connect(p); p.connect(this.master); p.connect(this.delay); }
      else { out.connect(this.master); out.connect(this.delay); }
      for (const [mult, amp] of v.partials) {
        const o = ctx.createOscillator();
        o.type = mult === 1 ? v.type : 'sine';
        o.frequency.value = freq * mult;
        o.detune.value = (Math.random() - 0.5) * 6;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol * amp, t0 + v.attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * (mult === 1 ? 1 : 0.55));
        o.connect(g); g.connect(out);
        o.start(t0); o.stop(t0 + dur + 0.1);
      }
    }

    // Breathy sustained flute tone with gentle vibrato — zelda's ocarina voice
    _ocarina(freq, t0, dur, vol, pan) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
      const lfoG = ctx.createGain(); lfoG.gain.value = freq * 0.008;
      lfo.connect(lfoG); lfoG.connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + 0.09);
      g.gain.setValueAtTime(vol, t0 + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      o.connect(g);
      if (p) { p.pan.value = pan || 0; g.connect(p); p.connect(this.master); p.connect(this.delay); }
      else { g.connect(this.master); g.connect(this.delay); }
      o.start(t0); o.stop(t0 + dur + 0.1);
      lfo.start(t0); lfo.stop(t0 + dur + 0.1);
    }

    // Airy filtered-noise sweep ("launch" whoosh) — galaxia flourishes
    _whoosh(t0, dur, from, to, vol) {
      const ctx = this.ctx;
      const len = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource(); src.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.2;
      bp.frequency.setValueAtTime(from, t0);
      bp.frequency.exponentialRampToValueAtTime(to, t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(bp); bp.connect(g); g.connect(this.master); g.connect(this.delay);
      src.start(t0); src.stop(t0 + dur);
    }

    _note(i, opts) {
      if (!this.enabled) return;
      const ctx = this._ensure();
      if (!ctx || ctx.state !== 'running') return;
      const v = this._v;
      const { dur = 1.4, vol = 0.05, delay = 0, pan = 0, oct = 1 } = opts || {};
      const f = v.scale[((i % v.scale.length) + v.scale.length) % v.scale.length] * oct;
      this._bell(f, ctx.currentTime + delay, dur * v.durMul, vol, pan);
    }

    /* ---- Vocabulary (same API for both palettes) ---- */

    hover() {
      const now = performance.now();
      if (now - this._lastHover < 140) return;
      this._lastHover = now;
      if (this.variante === 'zelda') {
        // Single soft harp pluck
        this._note(Math.floor(Math.random() * 4), { vol: 0.02, dur: 0.7, pan: (Math.random() - 0.5) * 0.6 });
      } else if (this.variante === 'galaxia') {
        // Single star-bit plink, random high pitch
        this._note(Math.floor(Math.random() * 5), { vol: 0.02, dur: 0.55, pan: (Math.random() - 0.5) * 0.7 });
      } else {
        this._note(Math.floor(Math.random() * 3) + 2, { vol: 0.022, dur: 0.9, pan: (Math.random() - 0.5) * 0.6 });
      }
    }

    click() {
      if (this.variante === 'zelda') {
        // Menu-select pluck: quick perfect fourth up
        this._note(1, { vol: 0.045, dur: 0.5 });
        this._note(4, { vol: 0.032, dur: 0.6, delay: 0.06 });
        return;
      }
      if (this.variante === 'galaxia') {
        // Two quick ascending plinks — collecting a star bit
        this._note(2, { vol: 0.045, dur: 0.45 });
        this._note(4, { vol: 0.035, dur: 0.55, delay: 0.055 });
      } else {
        this._note(1, { vol: 0.05, dur: 0.7 });
        this._note(3, { vol: 0.028, dur: 1.0, delay: 0.045 });
      }
    }

    open() {
      if (this.variante === 'zelda') {
        // "Secret discovered" style zig-zag run (original melody)
        [0, 2, 1, 3, 2, 5].forEach((n, k) => this._note(n, { vol: 0.042 - k * 0.003, dur: 0.55, delay: k * 0.07, pan: -0.35 + k * 0.14 }));
        return;
      }
      if (this.variante === 'galaxia') {
        // Fast five-note ascending run + soft rising whoosh (launch feel)
        [0, 1, 2, 3, 4].forEach((n, k) => this._note(n, { vol: 0.04 - k * 0.004, dur: 0.7, delay: k * 0.055, pan: -0.4 + k * 0.2 }));
        if (this.ctx && this.ctx.state === 'running') this._whoosh(this.ctx.currentTime, 0.5, 500, 3400, 0.02);
      } else {
        [0, 2, 4].forEach((n, k) => this._note(n, { vol: 0.05 - k * 0.008, dur: 1.6, delay: k * 0.085, pan: -0.3 + k * 0.3 }));
      }
    }

    close() {
      if (this.variante === 'zelda') {
        [5, 3, 0].forEach((n, k) => this._note(n, { vol: 0.035, dur: 0.65, delay: k * 0.08, pan: 0.3 - k * 0.3 }));
        return;
      }
      if (this.variante === 'galaxia') {
        [4, 2, 0].forEach((n, k) => this._note(n, { vol: 0.035, dur: 0.6, delay: k * 0.06, pan: 0.3 - k * 0.3 }));
      } else {
        [4, 1].forEach((n, k) => this._note(n, { vol: 0.042, dur: 1.2, delay: k * 0.09, pan: 0.2 - k * 0.4 }));
      }
    }

    tick(dir) {
      const now = performance.now();
      if (now - this._lastTick < 90) return;
      this._lastTick = now;
      if (this.variante === 'zelda') {
        this._note(dir > 0 ? 3 : 1, { vol: 0.032, dur: 0.45, pan: dir > 0 ? 0.4 : -0.4 });
        return;
      }
      if (this.variante === 'galaxia') {
        this._note(dir > 0 ? 4 : 1, { vol: 0.032, dur: 0.4, pan: dir > 0 ? 0.4 : -0.4 });
      } else {
        this._note(dir > 0 ? 3 : 2, { vol: 0.035, dur: 0.5, pan: dir > 0 ? 0.35 : -0.35 });
      }
    }

    theme(dark) {
      if (this.variante === 'zelda') {
        const ctx = this._ensure();
        if (!ctx || ctx.state !== 'running' || !this.enabled) return;
        // Soft ocarina call: night = low falling, day = bright rising
        if (dark) { this._ocarina(587.33, ctx.currentTime, 0.8, 0.03, -0.15); this._ocarina(440.0, ctx.currentTime + 0.28, 1.0, 0.028, 0.15); }
        else { this._ocarina(659.25, ctx.currentTime, 0.7, 0.03, -0.15); this._ocarina(880.0, ctx.currentTime + 0.24, 0.9, 0.028, 0.15); }
        return;
      }
      if (this.variante === 'galaxia') {
        if (dark) { [3, 1].forEach((n, k) => this._note(n, { vol: 0.04, dur: 0.7, delay: k * 0.08, oct: 0.5 })); }
        else { [1, 3, 5].forEach((n, k) => this._note(n, { vol: 0.035, dur: 0.6, delay: k * 0.06 })); }
      } else {
        if (dark) { this._note(4, { vol: 0.045, dur: 1.3 }); this._note(0, { vol: 0.035, dur: 1.6, delay: 0.1, oct: 0.5 }); }
        else { this._note(2, { vol: 0.045, dur: 1.1 }); this._note(5, { vol: 0.035, dur: 1.4, delay: 0.1 }); }
      }
    }

    lantern() {
      const ctx = this._ensure();
      if (!ctx || ctx.state !== 'running' || !this.enabled) return;
      const t0 = ctx.currentTime;
      if (this.variante === 'zelda') {
        // Long ocarina note with vibrato + harp shimmer settling around it
        this._ocarina(587.33, t0, 2.2, 0.045, 0);
        [0, 2, 4, 5].forEach((n, k) => this._note(n, { vol: 0.026, dur: 1.2, delay: 0.6 + k * 0.18, pan: (k - 1.5) * 0.3 }));
        return;
      }
      if (this.variante === 'galaxia') {
        // Launch star: big whoosh up + sparkle shower raining down
        this._whoosh(t0, 1.1, 300, 4200, 0.045);
        [5, 4, 3, 2, 1, 0].forEach((n, k) => this._note(n, { vol: 0.028, dur: 0.8, delay: 0.45 + k * 0.09, pan: (Math.random() - 0.5) * 0.8 }));
      } else {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 138.59;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(0.07, t0 + 0.9);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.6);
        o.connect(g); g.connect(this.master); g.connect(this.delay);
        o.start(t0); o.stop(t0 + 2.8);
        [5, 3, 4].forEach((n, k) => this._note(n, { vol: 0.03, dur: 1.8, delay: 0.5 + k * 0.22, pan: (k - 1) * 0.4 }));
      }
    }
  }

  window.SonidosUI = new Sonidos();
})();
