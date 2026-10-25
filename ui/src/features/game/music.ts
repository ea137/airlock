// The zones' songs, written out note by note when a zone starts. Each is
// built from a short hand-written motif in the zone's key, mode and groove:
// an intro, the tune (A), the tune again with a second voice (A'), a
// contrasting middle (B) and the tune once more with a fill (A''), then
// back to A. The boss gets a darker, faster take on the same motif. Four
// voices like an old console: two pulses (lead and harmony), a triangle
// bass, and noise drums.

import type { Mode, Song } from './zones';

export const STEPS_PER_BAR = 16;

const SCALES: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};

/** Chord roots per bar, as scale degrees from 0. */
const PROGRESSIONS = [
  [0, 4, 5, 3],
  [0, 6, 3, 0],
  [0, 3, 4, 4],
  [5, 3, 0, 4],
  [0, 5, 3, 4],
  [0, 2, 3, 4],
  [0, 6, 5, 6],
  [0, 3, 6, 2],
  [0, 4, 0, 6],
  [3, 4, 0, 0],
  [0, 1, 3, 4],
  [5, 4, 3, 4],
];

/** One bar of tune each: [step, length, scale steps above the chord's root]. */
const MOTIFS: [number, number, number][][] = [
  [[0, 2, 0], [2, 2, 2], [4, 2, 4], [6, 2, 2], [8, 3, 4], [12, 2, 5], [14, 2, 4]],
  [[0, 3, 4], [3, 1, 3], [4, 2, 2], [6, 2, 0], [8, 4, 2], [12, 4, -1]],
  [[0, 1, 0], [1, 1, 2], [2, 2, 4], [4, 4, 7], [10, 2, 6], [12, 4, 4]],
  [[0, 2, 4], [3, 1, 4], [4, 2, 5], [6, 2, 4], [8, 2, 2], [10, 2, 0], [12, 4, 2]],
  [[0, 4, 7], [4, 2, 6], [6, 2, 4], [8, 6, 2], [14, 2, 4]],
  [[0, 1, 0], [2, 1, 0], [3, 1, 2], [4, 2, 4], [6, 1, 2], [8, 2, 0], [10, 2, -1], [12, 4, 0]],
  [[0, 2, 0], [2, 1, 2], [3, 1, 3], [4, 2, 4], [6, 2, 7], [8, 2, 6], [10, 2, 4], [12, 2, 3], [14, 2, 2]],
  [[0, 6, 4], [6, 2, 3], [8, 6, 2], [14, 2, 0]],
  [[0, 2, 7], [2, 2, 4], [4, 2, 5], [6, 2, 2], [8, 2, 4], [10, 2, 0], [12, 2, 1], [14, 2, -1]],
  [[0, 3, 2], [3, 3, 4], [6, 2, 6], [8, 4, 7], [12, 2, 6], [14, 2, 4]],
  [[0, 1, 4], [1, 1, 4], [2, 2, 5], [4, 2, 4], [6, 2, 2], [8, 1, 4], [9, 1, 4], [10, 2, 5], [12, 4, 7]],
  [[0, 2, 0], [2, 2, 4], [4, 2, 2], [6, 2, 5], [8, 2, 4], [10, 2, 7], [12, 4, 6]],
];

/** Drum patterns, a bar each: kick, snare, hat ('x' hit, 'o' open hat). */
const GROOVES: [string, string, string][] = [
  ['x...x...x...x...', '....x.......x...', 'x.x.x.x.x.x.x.x.'],
  ['x.....x.x.......', '....x.......x...', 'xxxxxxxxxxxxxxxx'],
  ['x.....x...x.....', '....x.......x..x', 'x..x..x..x..x..x'],
  ['x.......x.x.....', '........x.......', 'x.x.x.x.x.x.x.x.'],
  ['x...x...x...x...', '....x.......x...', '..o...o...o...o.'],
  ['x.x.......x.....', '....x..x.x..x...', 'x.x.x.x.x.x.x.x.'],
  ['x..x..x.x..x..x.', '....x.......x...', 'xxxxxxxxxxxxxxxx'],
  ['x.......x.......', '............x...', '....x.......x...'],
];

/** The voices, in the order the player schedules them. */
export const LEAD = 0;
export const HARMONY = 1;
export const BASS = 2;
export const DRUMS = 3;

export const DRUM_KICK = 1;
export const DRUM_SNARE = 2;
export const DRUM_HAT = 3;
export const DRUM_OPEN = 4;

/**
 * A song as flat arrays, one slot per step and voice: the MIDI note that
 * starts there (0 for none), how many steps it lasts, and how loud. Drums
 * hold a drum number instead of a note.
 */
export type Score = {
  bpm: number;
  length: number;
  /** Where it loops back to after the end (past the intro). */
  loopFrom: number;
  note: Uint8Array[];
  len: Uint8Array[];
  vel: Float32Array[];
};

function blank(length: number): Score {
  const make = <T>(create: (n: number) => T) => [create(length), create(length), create(length), create(length)];
  return {
    bpm: 120,
    length,
    loopFrom: 0,
    note: make((n) => new Uint8Array(n)),
    len: make((n) => new Uint8Array(n)),
    vel: make((n) => new Float32Array(n)),
  };
}

function put(score: Score, voice: number, step: number, note: number, len: number, vel: number): void {
  if (step < 0 || step >= score.length || note <= 0) return;
  const notes = score.note[voice];
  const lens = score.len[voice];
  const vels = score.vel[voice];
  if (!notes || !lens || !vels) return;
  notes[step] = Math.max(1, Math.min(127, Math.round(note)));
  lens[step] = Math.max(1, Math.min(255, len));
  vels[step] = vel;
}

/** A pitch from a scale degree (any whole number, octaves included). */
function pitch(root: number, scale: number[], degree: number): number {
  const octave = Math.floor(degree / scale.length);
  const at = ((degree % scale.length) + scale.length) % scale.length;
  return root + octave * 12 + (scale[at] ?? 0);
}

type Variation = 'plain' | 'answer' | 'high' | 'rhythm' | 'cadence';

function melodyBar(score: Score, at: number, root: number, scale: number[], chord: number, motif: [number, number, number][], vary: Variation, vel: number): void {
  if (vary === 'cadence') {
    // Land home: a held chord tone, then the root.
    put(score, LEAD, at, pitch(root, scale, chord + 2), 6, vel);
    put(score, LEAD, at + 6, pitch(root, scale, chord + 1), 2, vel * 0.9);
    put(score, LEAD, at + 8, pitch(root, scale, 7), 8, vel);
    return;
  }
  for (const [step, len, offset] of motif) {
    let degree = chord + offset;
    let start = step;
    if (vary === 'answer') degree = chord + (offset === 0 ? 0 : 7 - offset);
    if (vary === 'high') degree += 2;
    if (vary === 'rhythm') start = (step + 2) % STEPS_PER_BAR;
    put(score, LEAD, at + start, pitch(root, scale, degree + 7), Math.min(len, STEPS_PER_BAR - start), vel);
  }
}

function bassBar(score: Score, at: number, root: number, scale: number[], chord: number, next: number, groove: number, vel: number): void {
  const low = (degree: number) => pitch(root - 24, scale, degree);
  switch (groove % 8) {
    case 0:
      for (let s = 0; s < 16; s += 2) put(score, BASS, at + s, low(chord) + (s % 4 === 2 ? 12 : 0), 2, vel);
      break;
    case 1:
      put(score, BASS, at, low(chord), 3, vel);
      put(score, BASS, at + 4, low(chord + 4), 2, vel);
      put(score, BASS, at + 6, low(chord) + 12, 2, vel);
      put(score, BASS, at + 8, low(chord), 3, vel);
      put(score, BASS, at + 12, low(chord + 4), 4, vel);
      break;
    case 2: {
      // A walk towards the next chord.
      const steps = [chord, chord + 1, chord + 2, next - 1];
      steps.forEach((degree, i) => put(score, BASS, at + i * 4, low(degree), 4, vel));
      break;
    }
    case 3:
      put(score, BASS, at, low(chord), 3, vel);
      put(score, BASS, at + 3, low(chord), 3, vel);
      put(score, BASS, at + 6, low(chord + 4), 2, vel);
      put(score, BASS, at + 10, low(chord), 2, vel);
      put(score, BASS, at + 12, low(chord + 2), 4, vel);
      break;
    case 4:
      for (let s = 0; s < 16; s += 1) put(score, BASS, at + s, low(chord + [0, 2, 4, 7][s % 4]!), 1, vel * 0.9);
      break;
    case 5:
      put(score, BASS, at, low(chord), 8, vel);
      put(score, BASS, at + 10, low(chord) + 12, 2, vel);
      put(score, BASS, at + 12, low(chord + 4), 4, vel);
      break;
    case 6:
      for (let s = 0; s < 16; s += 1) put(score, BASS, at + s, low(chord) + (s % 8 === 7 ? 12 : 0), 1, vel * (s % 4 === 0 ? 1 : 0.8));
      break;
    default:
      put(score, BASS, at, low(chord), 8, vel);
      put(score, BASS, at + 8, low(chord + 4), 8, vel);
      break;
  }
}

function harmonyBar(score: Score, at: number, root: number, scale: number[], chord: number, style: 'arp' | 'pads' | 'stabs', vel: number): void {
  const tone = (degree: number) => pitch(root, scale, degree);
  if (style === 'arp') {
    for (let s = 0; s < 16; s += 2) put(score, HARMONY, at + s, tone(chord + [0, 2, 4, 2][(s / 2) % 4]!), 2, vel);
  } else if (style === 'pads') {
    put(score, HARMONY, at, tone(chord + 2), 8, vel);
    put(score, HARMONY, at + 8, tone(chord + 4), 8, vel);
  } else {
    for (const s of [2, 6, 10, 14]) put(score, HARMONY, at + s, tone(chord + 4), 1, vel);
  }
}

function drumBar(score: Score, at: number, groove: number, fill: boolean, vel: number): void {
  const [kick, snare, hat] = GROOVES[groove % GROOVES.length] ?? GROOVES[0]!;
  for (let s = 0; s < 16; s += 1) {
    if (fill && s >= 12) {
      put(score, DRUMS, at + s, DRUM_SNARE, 1, vel * (0.6 + (s - 12) * 0.12));
      continue;
    }
    if (kick[s] === 'x') put(score, DRUMS, at + s, DRUM_KICK, 1, vel);
    else if (snare[s] === 'x') put(score, DRUMS, at + s, DRUM_SNARE, 1, vel);
    else if (hat[s] === 'x') put(score, DRUMS, at + s, DRUM_HAT, 1, vel * (s % 4 === 0 ? 0.7 : 0.45));
    else if (hat[s] === 'o') put(score, DRUMS, at + s, DRUM_OPEN, 1, vel * 0.6);
  }
}

/** Writes out a zone's song (or its boss take). */
export function compose(song: Song, boss = false): Score {
  const scale = SCALES[boss ? (song.mode === 'major' || song.mode === 'lydian' || song.mode === 'mixolydian' ? 'harmonic' : 'phrygian') : song.mode];
  const progression = boss ? [0, 1, 0, 6] : (PROGRESSIONS[song.progression % PROGRESSIONS.length] ?? PROGRESSIONS[0]!);
  const motif = MOTIFS[song.motif % MOTIFS.length] ?? MOTIFS[0]!;
  const contrast = MOTIFS[(song.motif + 5) % MOTIFS.length] ?? MOTIFS[1]!;
  const groove = boss ? 6 : song.groove;
  const root = boss ? song.root - 2 : song.root;
  // Intro 2 bars, then A, A', B, A'' of 8 bars each.
  const bars = 2 + 32;
  const score = blank(bars * STEPS_PER_BAR);
  score.bpm = boss ? Math.min(184, song.bpm + 22) : song.bpm;
  score.loopFrom = 2 * STEPS_PER_BAR;
  for (let bar = 0; bar < bars; bar += 1) {
    const at = bar * STEPS_PER_BAR;
    const chord = progression[bar % 4] ?? 0;
    const next = progression[(bar + 1) % 4] ?? 0;
    const section = bar < 2 ? 'intro' : (['A', "A'", 'B', "A''"] as const)[Math.floor((bar - 2) / 8)];
    const inPhrase = (bar - 2) % 8;
    drumBar(score, at, groove, inPhrase === 7, section === 'intro' ? 0.7 : 0.9);
    bassBar(score, at, root, scale, section === 'B' ? (progression[(bar + 2) % 4] ?? 0) : chord, next, section === 'B' ? groove + 3 : groove, 0.85);
    if (section === 'intro') {
      if (bar === 1) harmonyBar(score, at, root, scale, chord, 'stabs', 0.4);
      continue;
    }
    if (section === 'B') {
      const contrastChord = progression[(bar + 2) % 4] ?? 0;
      melodyBar(score, at, root, scale, contrastChord, contrast, inPhrase === 7 ? 'cadence' : inPhrase % 2 === 1 ? 'high' : 'plain', 0.8);
      harmonyBar(score, at, root, scale, contrastChord, 'pads', 0.35);
      continue;
    }
    const vary: Variation =
      inPhrase === 7 ? 'cadence' : inPhrase === 3 ? 'answer' : section === "A''" && inPhrase >= 4 ? 'high' : section === "A'" && inPhrase === 5 ? 'rhythm' : 'plain';
    melodyBar(score, at, root, scale, chord, motif, vary, 0.85);
    if (section === "A'") harmonyBar(score, at, root, scale, chord, 'arp', 0.32);
    else if (section === "A''") harmonyBar(score, at, root, scale, chord, 'stabs', 0.38);
  }
  return score;
}

/** Seconds per step at a tempo (four steps to a beat). */
export function stepSeconds(bpm: number): number {
  return 60 / bpm / 4;
}

/** Where a playing song is: the next step to schedule and when it sounds. */
export type Cursor = { step: number; time: number };

/**
 * Calls `play` for every step that sounds before `until`, in order, and
 * moves the cursor on; the song loops past its end. `speed` above 1 plays
 * faster (the lock's rush). Pure, so it can be tested without sound.
 */
export function advance(score: Score, cursor: Cursor, until: number, speed: number, play: (step: number, time: number, stepLength: number) => void): void {
  const length = stepSeconds(score.bpm) / speed;
  let guard = 0;
  while (cursor.time < until && guard < 512) {
    play(cursor.step, cursor.time, length);
    cursor.step += 1;
    if (cursor.step >= score.length) cursor.step = score.loopFrom;
    cursor.time += length;
    guard += 1;
  }
}

/** A short tune as [MIDI note, steps] pairs, played on the effects voice. */
export type Jingle = { bpm: number; notes: number[] };

export function jingle(kind: 'clear' | 'over' | 'boss' | 'life' | 'key', song: Song): Jingle {
  const scale = SCALES[song.mode];
  const r = song.root + 12;
  const p = (degree: number) => pitch(r, scale, degree);
  switch (kind) {
    case 'clear':
      return { bpm: 150, notes: [p(0), 1, p(2), 1, p(4), 1, p(7), 2, p(4), 1, p(7), 1, p(9), 2, p(11), 1, p(14), 6] };
    case 'boss':
      return { bpm: 140, notes: [p(4), 2, p(4), 1, p(4), 1, p(5), 2, p(6), 2, p(7), 8] };
    case 'over':
      return { bpm: 90, notes: [p(4), 2, p(3), 2, p(2), 2, p(1), 2, p(0), 3, p(-3), 6] };
    case 'life':
      return { bpm: 200, notes: [p(2), 1, p(4), 1, p(9), 1, p(7), 1, p(11), 1, p(14), 3] };
    default:
      return { bpm: 240, notes: [p(7), 1, p(9), 1, p(11), 1, p(14), 2] };
  }
}
