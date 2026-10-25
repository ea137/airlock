// The game's sound, made in WebAudio with no files: a handful of voices
// that live as long as the game (oscillators whose pitch and volume are
// scheduled note by note), a scheduler that writes the next fraction of a
// second of the song each frame, and the effects.
//
// iOS: the context starts on the first touch or key in the game, plays as
// "ambient" (so the silent switch silences it), and is suspended whenever
// the game is paused or hidden.

import { advance, BASS, type Cursor, compose, DRUM_HAT, DRUM_KICK, DRUM_OPEN, DRUM_SNARE, DRUMS, HARMONY, type Jingle, LEAD, type Score, stepSeconds } from './music';
import type { Song } from './zones';

type Wave = 'pulse12' | 'pulse25' | 'pulse50' | 'triangle' | 'saw' | 'sine' | 'steps' | 'fm';

export type Timbre = {
  lead: Wave;
  harmony: Wave;
  bass: Wave;
  /** A second lead oscillator this many cents off (0 for none). */
  detune: number;
  /** Lowpass on the lead, in Hz (0 for none), and how much it opens on each note. */
  cutoff: number;
  sweep: number;
  /** Echo: delay in seconds and how much comes back (0 for none). */
  echo: number;
  feedback: number;
  attack: number;
  release: number;
  crunch: boolean;
  vibrato: number;
};

const PLAIN: Timbre = { lead: 'pulse25', harmony: 'pulse12', bass: 'triangle', detune: 0, cutoff: 0, sweep: 0, echo: 0, feedback: 0, attack: 0.004, release: 0.04, crunch: true, vibrato: 0 };

export const TIMBRES: Record<string, Timbre> = {
  gameboy: { ...PLAIN, bass: 'steps' },
  handheld: { ...PLAIN, bass: 'steps' },
  boot: { ...PLAIN, lead: 'saw', harmony: 'pulse25', cutoff: 1400, sweep: 2600, release: 0.06, vibrato: 6 },
  teletext: { ...PLAIN, lead: 'pulse50', harmony: 'pulse50', bass: 'pulse50', release: 0.01 },
  matrix: { ...PLAIN, lead: 'pulse25', harmony: 'triangle', bass: 'saw', cutoff: 2200, sweep: 800, echo: 0.27, feedback: 0.35, crunch: false },
  workstation: { ...PLAIN, lead: 'fm', harmony: 'fm', bass: 'triangle', attack: 0.01, release: 0.08, crunch: false, vibrato: 4 },
  vector: { ...PLAIN, lead: 'saw', harmony: 'saw', bass: 'saw', detune: 9, cutoff: 2600, sweep: 1600, echo: 0.33, feedback: 0.4, attack: 0.01, release: 0.12, crunch: false },
  hacker: { ...PLAIN, lead: 'saw', harmony: 'pulse25', bass: 'saw', detune: 14, cutoff: 3200, sweep: 2400, echo: 0.2, feedback: 0.3, release: 0.05, crunch: false },
  current: { ...PLAIN, lead: 'triangle', harmony: 'sine', bass: 'sine', cutoff: 3000, sweep: 400, echo: 0.24, feedback: 0.22, attack: 0.012, release: 0.14, crunch: false, vibrato: 3 },
};

function midiHz(note: number): number {
  return 440 * 2 ** ((note - 69) / 12);
}

function pulseWave(ctx: AudioContext, duty: number): PeriodicWave {
  const n = 48;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let k = 1; k < n; k += 1) imag[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
  return ctx.createPeriodicWave(real, imag);
}

/** A triangle in 16 steps, like a console's wave channel. */
function steppedTriangle(ctx: AudioContext): PeriodicWave {
  const n = 32;
  const samples = 64;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  const table: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const tri = i < samples / 2 ? i / (samples / 2) : 2 - i / (samples / 2);
    table.push(Math.round(tri * 15) / 7.5 - 1);
  }
  for (let k = 1; k < n; k += 1) {
    let re = 0;
    let im = 0;
    table.forEach((value, i) => {
      re += value * Math.cos((2 * Math.PI * k * i) / samples);
      im += value * Math.sin((2 * Math.PI * k * i) / samples);
    });
    real[k] = (re * 2) / samples;
    imag[k] = (im * 2) / samples;
  }
  return ctx.createPeriodicWave(real, imag);
}

class Voice {
  readonly osc: OscillatorNode;
  readonly twin: OscillatorNode | null = null;
  readonly mod: OscillatorNode | null = null;
  readonly modGain: GainNode | null = null;
  readonly filter: BiquadFilterNode | null = null;
  readonly gain: GainNode;

  constructor(
    ctx: AudioContext,
    wave: Wave,
    out: AudioNode,
    waves: Record<string, PeriodicWave>,
    private readonly timbre: Timbre,
    lead: boolean,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    let into: AudioNode = this.gain;
    if (lead && timbre.cutoff > 0) {
      this.filter = ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = timbre.cutoff;
      this.filter.Q.value = 4;
      this.filter.connect(this.gain);
      into = this.filter;
    }
    this.gain.connect(out);
    this.osc = ctx.createOscillator();
    this.setWave(this.osc, wave, waves);
    this.osc.connect(into);
    this.osc.start();
    if (lead && timbre.detune !== 0) {
      this.twin = ctx.createOscillator();
      this.setWave(this.twin, wave, waves);
      this.twin.detune.value = timbre.detune;
      this.twin.connect(into);
      this.twin.start();
    }
    if (wave === 'fm') {
      this.mod = ctx.createOscillator();
      this.mod.type = 'sine';
      this.modGain = ctx.createGain();
      this.modGain.gain.value = 0;
      this.mod.connect(this.modGain);
      this.modGain.connect(this.osc.frequency);
      this.mod.start();
    }
  }

  private setWave(osc: OscillatorNode, wave: Wave, waves: Record<string, PeriodicWave>): void {
    const table = waves[wave];
    if (table) osc.setPeriodicWave(table);
    else osc.type = wave === 'saw' ? 'sawtooth' : wave === 'triangle' ? 'triangle' : 'sine';
  }

  note(note: number, at: number, length: number, volume: number): void {
    const hz = midiHz(note);
    const t = this.timbre;
    this.osc.frequency.setValueAtTime(hz, at);
    this.twin?.frequency.setValueAtTime(hz, at);
    if (t.vibrato > 0 && length > 0.18) {
      this.osc.frequency.setValueAtTime(hz, at + 0.12);
      this.osc.frequency.linearRampToValueAtTime(hz * 2 ** (t.vibrato / 1200), at + 0.16);
      this.osc.frequency.linearRampToValueAtTime(hz, at + 0.2);
    }
    if (this.mod && this.modGain) {
      this.mod.frequency.setValueAtTime(hz * 2, at);
      this.modGain.gain.setValueAtTime(hz * 1.6, at);
      this.modGain.gain.exponentialRampToValueAtTime(hz * 0.3, at + Math.max(0.05, length));
    }
    if (this.filter) {
      this.filter.frequency.setValueAtTime(t.cutoff + t.sweep, at);
      this.filter.frequency.exponentialRampToValueAtTime(Math.max(200, t.cutoff), at + Math.min(0.25, length));
    }
    const g = this.gain.gain;
    const end = at + Math.max(0.02, length - t.release * 0.5);
    g.cancelScheduledValues(at);
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(volume, at + t.attack);
    g.setValueAtTime(volume * 0.8, Math.max(at + t.attack, end - 0.01));
    g.linearRampToValueAtTime(0, end + t.release);
  }

  slide(from: number, to: number, at: number, length: number, volume: number): void {
    this.osc.frequency.cancelScheduledValues(at);
    this.osc.frequency.setValueAtTime(from, at);
    this.osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + length);
    const g = this.gain.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(volume, at);
    g.linearRampToValueAtTime(0, at + length);
  }

  silence(at: number): void {
    this.gain.gain.cancelScheduledValues(at);
    this.gain.gain.setValueAtTime(0, at);
  }

  stop(): void {
    for (const osc of [this.osc, this.twin, this.mod]) {
      try {
        osc?.stop();
      } catch {
        // Already stopped.
      }
    }
  }
}

const TONES = [LEAD, HARMONY, BASS];
const POWER_UP = [72, 76, 79, 84, 88, 91, 96];
const FALL = [76, 71, 67, 64, 60, 55];
const SPARKLE = [96, 100, 103, 108];
const ONE_UP = [76, 79, 88, 84, 86, 91];
const DOWN_PIPE = [62, 57, 52];

class Noise {
  readonly source: AudioBufferSourceNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;

  constructor(ctx: AudioContext, buffer: AudioBuffer, out: AudioNode) {
    this.source = ctx.createBufferSource();
    this.source.buffer = buffer;
    this.source.loop = true;
    this.filter = ctx.createBiquadFilter();
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.filter);
    this.filter.connect(this.gain);
    this.gain.connect(out);
    this.source.start();
  }

  stop(): void {
    try {
      this.source.stop();
    } catch {
      // Already stopped.
    }
  }

  hit(at: number, type: BiquadFilterType, hz: number, length: number, volume: number): void {
    this.filter.type = type;
    this.filter.frequency.setValueAtTime(hz, at);
    const g = this.gain.gain;
    g.cancelScheduledValues(at);
    g.setValueAtTime(volume, at);
    g.exponentialRampToValueAtTime(0.0008, at + length);
    g.setValueAtTime(0, at + length + 0.005);
  }
}

export type Sfx =
  | 'jump'
  | 'stomp'
  | 'bit'
  | 'bump'
  | 'break'
  | 'power'
  | 'grow'
  | 'hurt'
  | 'die'
  | 'kick'
  | 'spring'
  | 'key'
  | 'life'
  | 'check'
  | 'flag'
  | 'shoot'
  | 'switch'
  | 'pipe'
  | 'splash'
  | 'bossHit'
  | 'bossDie'
  | 'beat'
  | 'swim'
  | 'flap'
  | 'pause'
  | 'item'
  | 'land';

type Bank = {
  music: GainNode;
  sfx: GainNode;
  voices: Voice[];
  kick: Voice;
  noise: Noise;
  fx: Voice;
  fx2: Voice;
  fxNoise: Noise;
};

/** Sets an AudioSession type where Safari offers it, so the silent switch is respected. */
function ambientSession(): void {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession) nav.audioSession.type = 'ambient';
  } catch {
    // Older Safari: nothing to set.
  }
}

export class Sound {
  private ctx: AudioContext | null = null;
  private bank: Bank | null = null;
  private master: GainNode | null = null;
  private timbreName = 'current';
  private score: Score | null = null;
  private readonly cursor: Cursor = { step: 0, time: 0 };
  private playing = false;
  muted = false;
  speed = 1;

  /** Starts (or wakes) the sound; call from a touch, click or key. */
  unlock(): void {
    try {
      if (!this.ctx) {
        ambientSession();
        const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Context) return;
        this.ctx = new Context();
        this.build();
        if (this.playing) this.cursor.time = this.ctx.currentTime + 0.05;
      }
      if (this.ctx.state !== 'running' && !this.muted) void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  setTimbre(name: string): void {
    if (name === this.timbreName) return;
    this.timbreName = name;
    if (this.ctx) this.build();
  }

  private build(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.master?.disconnect();
    const old = this.bank;
    if (old) {
      for (const voice of [...old.voices, old.kick, old.fx, old.fx2]) voice.stop();
      old.noise.stop();
      old.fxNoise.stop();
    }
    const timbre = TIMBRES[this.timbreName] ?? TIMBRES.current ?? PLAIN;
    const waves: Record<string, PeriodicWave> = {
      pulse12: pulseWave(ctx, 0.125),
      pulse25: pulseWave(ctx, 0.25),
      pulse50: pulseWave(ctx, 0.5),
      steps: steppedTriangle(ctx),
    };
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.55;
    const compressor = ctx.createDynamicsCompressor();
    master.connect(compressor);
    compressor.connect(ctx.destination);
    const music = ctx.createGain();
    music.gain.value = 0.5;
    music.connect(master);
    if (timbre.echo > 0) {
      const delay = ctx.createDelay(1);
      delay.delayTime.value = timbre.echo;
      const back = ctx.createGain();
      back.gain.value = timbre.feedback;
      const wet = ctx.createGain();
      wet.gain.value = 0.3;
      music.connect(delay);
      delay.connect(back);
      back.connect(delay);
      delay.connect(wet);
      wet.connect(master);
    }
    const sfx = ctx.createGain();
    sfx.gain.value = 0.55;
    sfx.connect(master);
    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let held = 0;
    for (let i = 0; i < length; i += 1) {
      // Crunchy noise holds each value a few samples, like a chip's shift register.
      if (!timbre.crunch || i % 3 === 0) held = Math.random() * 2 - 1;
      data[i] = held;
    }
    const voices = [
      new Voice(ctx, timbre.lead, music, waves, timbre, true),
      new Voice(ctx, timbre.harmony, music, waves, { ...timbre, cutoff: 0, detune: 0 }, false),
      new Voice(ctx, timbre.bass, music, waves, { ...timbre, cutoff: 0, detune: 0, vibrato: 0, attack: 0.003, release: 0.03 }, false),
    ];
    this.master = master;
    this.bank = {
      music,
      sfx,
      voices,
      kick: new Voice(ctx, 'sine', music, waves, { ...PLAIN, vibrato: 0 }, false),
      noise: new Noise(ctx, buffer, music),
      fx: new Voice(ctx, 'pulse25', sfx, waves, { ...PLAIN, vibrato: 0 }, false),
      fx2: new Voice(ctx, 'pulse50', sfx, waves, { ...PLAIN, vibrato: 0 }, false),
      fxNoise: new Noise(ctx, buffer, sfx),
    };
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ctx || !this.master) return;
    this.master.gain.setValueAtTime(muted ? 0 : 0.55, this.ctx.currentTime);
    if (muted) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && !this.muted && this.ctx.state !== 'running') {
      void this.ctx.resume().then(() => {
        if (this.ctx) this.cursor.time = Math.max(this.cursor.time, this.ctx.currentTime + 0.05);
      });
    }
  }

  playSong(song: Song, boss: boolean): void {
    this.score = compose(song, boss);
    this.cursor.step = 0;
    this.cursor.time = (this.ctx?.currentTime ?? 0) + 0.08;
    this.playing = true;
    this.speed = 1;
  }

  stopSong(): void {
    this.playing = false;
    const ctx = this.ctx;
    if (!ctx || !this.bank) return;
    for (const voice of this.bank.voices) voice.silence(ctx.currentTime);
  }

  /** Writes the next moments of the song; call every frame while playing. */
  pump(): void {
    const ctx = this.ctx;
    const bank = this.bank;
    const score = this.score;
    if (!ctx || !bank || !score || !this.playing || ctx.state !== 'running') return;
    // Back from a pause: start again from now rather than catch up.
    if (this.cursor.time < ctx.currentTime - 0.1) this.cursor.time = ctx.currentTime + 0.03;
    advance(score, this.cursor, ctx.currentTime + 0.15, this.speed, this.onStep);
  }

  private readonly onStep = (step: number, at: number, length: number): void => {
    if (this.score && this.bank) this.playStep(this.score, this.bank, step, at, length);
  };

  private playStep(score: Score, bank: Bank, step: number, at: number, length: number): void {
    for (const voice of TONES) {
      const note = score.note[voice]?.[step] ?? 0;
      if (note === 0) continue;
      const steps = score.len[voice]?.[step] ?? 1;
      const vel = score.vel[voice]?.[step] ?? 0.5;
      bank.voices[voice]?.note(note, at, steps * length, (voice === BASS ? 0.42 : voice === LEAD ? 0.24 : 0.14) * vel);
    }
    const drum = score.note[DRUMS]?.[step] ?? 0;
    const vel = score.vel[DRUMS]?.[step] ?? 0.5;
    if (drum === DRUM_KICK) bank.kick.slide(150, 42, at, 0.13, 0.75 * vel);
    else if (drum === DRUM_SNARE) bank.noise.hit(at, 'bandpass', 1800, 0.11, 0.42 * vel);
    else if (drum === DRUM_HAT) bank.noise.hit(at, 'highpass', 7000, 0.035, 0.22 * vel);
    else if (drum === DRUM_OPEN) bank.noise.hit(at, 'highpass', 6000, 0.12, 0.2 * vel);
  }

  playJingle(tune: Jingle): void {
    const ctx = this.ctx;
    const bank = this.bank;
    if (!ctx || !bank) return;
    this.stopSong();
    let at = ctx.currentTime + 0.03;
    const step = stepSeconds(tune.bpm);
    for (let i = 0; i + 1 < tune.notes.length; i += 2) {
      const note = tune.notes[i] ?? 60;
      const steps = tune.notes[i + 1] ?? 1;
      bank.fx2.note(note, at, steps * step * 0.95, 0.2);
      bank.fx.note(note - 12, at, steps * step * 0.9, 0.08);
      at += steps * step;
    }
  }

  sfx(kind: Sfx): void {
    const ctx = this.ctx;
    const bank = this.bank;
    if (!ctx || !bank || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005;
    const fx = bank.fx;
    const fx2 = bank.fx2;
    const noise = bank.fxNoise;
    switch (kind) {
      case 'jump':
        fx.slide(260, 620, t, 0.13, 0.2);
        break;
      case 'land':
        noise.hit(t, 'lowpass', 500, 0.05, 0.12);
        break;
      case 'stomp':
        noise.hit(t, 'lowpass', 1200, 0.06, 0.3);
        fx.slide(520, 140, t, 0.1, 0.22);
        break;
      case 'bit':
        fx2.note(84, t, 0.04, 0.16);
        fx2.note(91, t + 0.05, 0.12, 0.16);
        break;
      case 'bump':
        fx.slide(140, 90, t, 0.07, 0.25);
        break;
      case 'break':
        noise.hit(t, 'highpass', 900, 0.2, 0.35);
        fx.slide(300, 80, t, 0.12, 0.15);
        break;
      case 'item':
        fx.slide(330, 990, t, 0.35, 0.14);
        break;
      case 'power':
      case 'grow':
        POWER_UP.forEach((note, i) => fx2.note(note, t + i * 0.04, 0.04, 0.17));
        break;
      case 'hurt':
        fx.slide(700, 160, t, 0.35, 0.22);
        break;
      case 'die':
        this.stopSong();
        FALL.forEach((note, i) => fx2.note(note, t + 0.2 + i * 0.09, 0.08, 0.2));
        break;
      case 'kick':
        fx.slide(600, 950, t, 0.07, 0.2);
        break;
      case 'spring':
        fx.slide(180, 900, t, 0.24, 0.22);
        break;
      case 'key':
        SPARKLE.forEach((note, i) => fx2.note(note, t + i * 0.05, 0.06, 0.15));
        break;
      case 'life':
        ONE_UP.forEach((note, i) => fx2.note(note, t + i * 0.07, 0.06, 0.18));
        break;
      case 'check':
        fx2.note(79, t, 0.08, 0.18);
        fx2.note(86, t + 0.1, 0.2, 0.18);
        break;
      case 'flag':
        fx.slide(1200, 300, t, 0.6, 0.15);
        break;
      case 'shoot':
        fx.slide(1300, 500, t, 0.08, 0.15);
        break;
      case 'switch':
        noise.hit(t, 'highpass', 4000, 0.03, 0.25);
        fx2.note(81, t + 0.03, 0.05, 0.15);
        fx2.note(74, t + 0.09, 0.08, 0.15);
        break;
      case 'pipe':
        DOWN_PIPE.forEach((note, i) => fx.note(note, t + i * 0.08, 0.07, 0.2));
        break;
      case 'splash':
        noise.hit(t, 'bandpass', 2500, 0.06, 0.12);
        break;
      case 'bossHit':
        noise.hit(t, 'lowpass', 900, 0.25, 0.45);
        fx.slide(400, 60, t, 0.3, 0.3);
        break;
      case 'bossDie':
        noise.hit(t, 'lowpass', 1400, 1.2, 0.5);
        fx.slide(500, 40, t, 1.1, 0.28);
        break;
      case 'beat':
        noise.hit(t, 'highpass', 9000, 0.02, 0.08);
        break;
      case 'swim':
        fx.slide(300, 520, t, 0.08, 0.1);
        break;
      case 'flap':
        noise.hit(t, 'bandpass', 1200, 0.12, 0.18);
        break;
      case 'pause':
        fx2.note(88, t, 0.05, 0.15);
        fx2.note(81, t + 0.07, 0.07, 0.15);
        break;
    }
  }

  close(): void {
    this.playing = false;
    const ctx = this.ctx;
    this.ctx = null;
    this.bank = null;
    if (ctx) void ctx.close().catch(() => {});
  }
}
