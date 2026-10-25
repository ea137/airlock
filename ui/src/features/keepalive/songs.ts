// A song for each place, written out by Hop Count's composer (music.ts)
// from a motif, a key, a mode, a groove and a progression, and played on
// its synth (audio.ts). Each boss gets the darker, faster take on its
// chapter's song that the composer makes.

import type { Song } from '../game/zones';

export const SONGS: Record<string, Song> = {
  loopback: { root: 60, mode: 'major', bpm: 92, motif: 3, groove: 7, progression: 9 },
  calm: { root: 57, mode: 'dorian', bpm: 76, motif: 7, groove: 7, progression: 6 },
  crontab: { root: 62, mode: 'mixolydian', bpm: 120, motif: 6, groove: 0, progression: 0 },
  stacks: { root: 55, mode: 'dorian', bpm: 100, motif: 1, groove: 3, progression: 4 },
  buffer: { root: 65, mode: 'lydian', bpm: 84, motif: 7, groove: 7, progression: 6 },
  ports: { root: 52, mode: 'phrygian', bpm: 80, motif: 5, groove: 5, progression: 2 },
  null: { root: 58, mode: 'harmonic', bpm: 112, motif: 9, groove: 6, progression: 10 },
  home: { root: 60, mode: 'major', bpm: 104, motif: 11, groove: 4, progression: 5 },
  title: { root: 64, mode: 'minor', bpm: 88, motif: 4, groove: 7, progression: 3 },
};

export const CHAPTER_SONG = ['loopback', 'crontab', 'stacks', 'buffer', 'ports', 'null', 'home'] as const;

export function songFor(name: string): Song {
  return SONGS[name] ?? SONGS.loopback ?? { root: 60, mode: 'major', bpm: 96, motif: 0, groove: 0, progression: 0 };
}
