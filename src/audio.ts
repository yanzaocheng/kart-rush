/** All sound is synthesized with WebAudio – no asset files needed. */
export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private engOsc1!: OscillatorNode;
  private engOsc2!: OscillatorNode;
  private engFilter!: BiquadFilterNode;
  private engGain!: GainNode;
  private driftGain!: GainNode;
  private driftFilter!: BiquadFilterNode;
  private boostGain!: GainNode;
  private noiseBuf!: AudioBuffer;
  private musicTimer = 0;
  private nextNote = 0;
  private step = 0;
  musicOn = true;

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.22;
    this.musicBus.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // engine
    this.engOsc1 = ctx.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc2 = ctx.createOscillator();
    this.engOsc2.type = 'square';
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 4;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    this.engOsc1.connect(this.engFilter);
    this.engOsc2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.sfx);
    this.engOsc1.start();
    this.engOsc2.start();

    // drift screech (looping band-passed noise)
    const dn = ctx.createBufferSource();
    dn.buffer = this.noiseBuf;
    dn.loop = true;
    this.driftFilter = ctx.createBiquadFilter();
    this.driftFilter.type = 'bandpass';
    this.driftFilter.frequency.value = 1800;
    this.driftFilter.Q.value = 6;
    this.driftGain = ctx.createGain();
    this.driftGain.gain.value = 0;
    dn.connect(this.driftFilter).connect(this.driftGain).connect(this.sfx);
    dn.start();

    // boost roar
    const bn = ctx.createBufferSource();
    bn.buffer = this.noiseBuf;
    bn.loop = true;
    const bf = ctx.createBiquadFilter();
    bf.type = 'lowpass';
    bf.frequency.value = 900;
    this.boostGain = ctx.createGain();
    this.boostGain.gain.value = 0;
    bn.connect(bf).connect(this.boostGain).connect(this.sfx);
    bn.start();
  }

  setEngine(speedNorm: number, throttle: number, drift: number, boost: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // fake gear shifts for a lively engine note
    const gears = 4;
    const g = Math.min(gears - 1, Math.floor(speedNorm * gears));
    const within = speedNorm * gears - g;
    const rpm = 0.35 + within * 0.65;
    const f = 55 + rpm * 95 + g * 12 + boost * 30;
    this.engOsc1.frequency.setTargetAtTime(f, t, 0.05);
    this.engOsc2.frequency.setTargetAtTime(f * 0.5 + 1.5, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(400 + rpm * 1400 + throttle * 600 + boost * 800, t, 0.05);
    this.engGain.gain.setTargetAtTime(0.1 + throttle * 0.08 + speedNorm * 0.05, t, 0.08);
    this.driftGain.gain.setTargetAtTime(drift * 0.12, t, 0.05);
    this.driftFilter.frequency.setTargetAtTime(1500 + speedNorm * 900, t, 0.1);
    this.boostGain.gain.setTargetAtTime(boost * 0.25, t, 0.1);
  }

  silenceEngine() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.engGain.gain.setTargetAtTime(0, t, 0.2);
    this.driftGain.gain.setTargetAtTime(0, t, 0.05);
    this.boostGain.gain.setTargetAtTime(0, t, 0.1);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, slideTo?: number, bus?: AudioNode) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(bus ?? this.sfx);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType, when = 0, bus?: AudioNode) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(bus ?? this.sfx);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  beep(high = false) {
    this.tone(high ? 880 : 440, high ? 0.6 : 0.25, 'square', 0.18);
    if (high) this.tone(1320, 0.6, 'triangle', 0.1);
  }

  nitro() {
    this.noise(0.9, 0.5, 1200, 'bandpass');
    this.tone(200, 0.5, 'sawtooth', 0.12, 0, 700);
  }

  mini(level: number) {
    this.tone(level > 1 ? 660 : 520, 0.25, 'triangle', 0.18, 0, level > 1 ? 1200 : 900);
    this.noise(0.4, 0.2, 2000, 'bandpass');
  }

  pad() {
    this.tone(300, 0.35, 'sawtooth', 0.1, 0, 900);
    this.noise(0.4, 0.25, 1500, 'highpass');
  }

  hit(strength: number) {
    const v = Math.min(0.6, strength / 25);
    this.noise(0.25, v, 500, 'lowpass');
    this.tone(90, 0.2, 'square', v * 0.4, 0, 50);
  }

  bump() {
    this.noise(0.15, 0.25, 700, 'lowpass');
  }

  pickup() {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.13, i * 0.05));
  }

  gain() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'square', 0.08, i * 0.06));
  }

  lap(final: boolean) {
    const notes = final ? [659, 784, 988, 1319] : [523, 659, 784];
    notes.forEach((f, i) => this.tone(f, 0.25, 'square', 0.1, i * 0.1));
  }

  fanfare(win: boolean) {
    const notes = win ? [523, 659, 784, 1047, 784, 1047] : [392, 440, 523, 494];
    notes.forEach((f, i) => this.tone(f, 0.35, 'square', 0.12, i * 0.14));
    notes.forEach((f, i) => this.tone(f / 2, 0.35, 'triangle', 0.12, i * 0.14));
  }

  // ---------- item sounds ----------
  launch() {
    this.noise(0.6, 0.35, 900, 'bandpass');
    this.tone(180, 0.5, 'sawtooth', 0.12, 0, 520);
  }

  explode(v = 1) {
    this.noise(0.8, 0.7 * v, 400, 'lowpass');
    this.tone(110, 0.5, 'square', 0.25 * v, 0, 35);
  }

  throwIt() {
    this.tone(400, 0.25, 'sine', 0.15, 0, 900);
  }

  splash(v = 1) {
    this.noise(0.6, 0.5 * v, 1800, 'bandpass');
    [900, 1300, 700].forEach((f, i) => this.tone(f, 0.12, 'sine', 0.12 * v, 0.05 + i * 0.06, f * 0.5));
  }

  drop() {
    this.tone(300, 0.15, 'triangle', 0.12, 0, 180);
  }

  spinOut() {
    this.tone(700, 0.8, 'square', 0.1, 0, 120);
    this.noise(0.5, 0.25, 1500, 'bandpass');
  }

  bubbled() {
    [500, 700, 950, 1250].forEach((f, i) => this.tone(f, 0.2, 'sine', 0.14, i * 0.08, f * 1.4));
  }

  shieldUp() {
    this.tone(500, 0.4, 'triangle', 0.14, 0, 1500);
    this.tone(750, 0.4, 'sine', 0.1, 0.05, 2000);
  }

  block() {
    this.tone(1600, 0.35, 'triangle', 0.15, 0, 800);
    this.noise(0.2, 0.2, 3000, 'highpass');
  }

  itemGet() {
    [660, 880, 1320].forEach((f, i) => this.tone(f, 0.1, 'square', 0.08, i * 0.04));
  }

  lockBeep() {
    this.tone(1400, 0.08, 'square', 0.09);
  }

  // ---------- background music: tiny step sequencer ----------
  private readonly bpm = 148;
  // chord roots (A minor – F – C – G), 16 steps each
  private readonly roots = [57, 53, 48, 55];
  private readonly arp = [0, 7, 12, 7, 3, 7, 12, 15, 0, 7, 12, 7, 3, 7, 15, 12];
  private readonly melody = [
    12, -1, 15, -1, 19, -1, 17, 15, 12, -1, 10, -1, 12, -1, -1, -1,
    12, -1, 15, -1, 19, -1, 22, 19, 17, -1, 15, -1, 17, -1, -1, -1,
    15, -1, 19, -1, 24, -1, 22, 19, 19, -1, 17, -1, 15, -1, 12, -1,
    14, -1, 17, -1, 19, -1, 17, 14, 12, -1, -1, -1, 14, -1, -1, -1,
  ];

  startMusic() {
    if (!this.ctx) return;
    if (this.musicTimer) return;
    this.nextNote = this.ctx.currentTime + 0.1;
    this.step = 0;
    this.musicTimer = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = 0;
  }

  toggleMusic(): boolean {
    this.musicOn = !this.musicOn;
    if (this.musicBus) this.musicBus.gain.value = this.musicOn ? 0.22 : 0;
    return this.musicOn;
  }

  private schedule() {
    if (!this.ctx) return;
    const dur16 = 60 / this.bpm / 4;
    while (this.nextNote < this.ctx.currentTime + 0.12) {
      const when = this.nextNote - this.ctx.currentTime;
      const s = this.step % 64;
      const bar = Math.floor(s / 16);
      const root = this.roots[bar];
      const minor = bar === 0; // Am is minor, others treated major-ish via arp
      const off = this.arp[s % 16];
      const adj = !minor && (off === 3 || off === 15) ? off + 1 : off;
      const mtf = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
      // arp
      this.tone(mtf(root + 12 + adj), dur16 * 0.9, 'square', 0.05, when, undefined, this.musicBus);
      // bass on 8ths
      if (s % 2 === 0) this.tone(mtf(root - 12 + (s % 4 === 2 ? 12 : 0)), dur16 * 1.8, 'triangle', 0.35, when, undefined, this.musicBus);
      // melody
      const m = this.melody[s];
      if (m >= 0) this.tone(mtf(57 + m + 12), dur16 * 1.9, 'sawtooth', 0.06, when, undefined, this.musicBus);
      // drums
      if (s % 4 === 0) this.tone(150, 0.18, 'sine', 0.8, when, 40, this.musicBus);
      if (s % 8 === 4) this.noise(0.14, 0.35, 1800, 'bandpass', when, this.musicBus);
      if (s % 2 === 1) this.noise(0.04, 0.12, 8000, 'highpass', when, this.musicBus);
      this.nextNote += dur16;
      this.step++;
    }
  }
}
