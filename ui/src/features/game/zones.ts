// The zones of the network the packet crosses. The first ten are chosen by
// hand, so twists and bugs arrive one or two at a time; after that each zone
// is drawn from the seed, never with the same twists as the one before.
// A zone is four hops: three levels and a core with a boss.

import { hash, Rng } from './rng';

export type Twist = 'ice' | 'lowgrav' | 'wind' | 'conv' | 'spring' | 'move' | 'switch' | 'beat' | 'flip' | 'water' | 'dark' | 'chase';
export type Foe = 'crawler' | 'zip' | 'moth' | 'flea' | 'worm' | 'virus' | 'spammer' | 'cron' | 'leak' | 'phish';
export type BossKind = 'hopper' | 'swooper' | 'charger' | 'burrower' | 'swarm';
export type Backdrop = 'board' | 'cables' | 'waves' | 'tunnel' | 'clouds' | 'racks' | 'fiber' | 'tapes' | 'flames' | 'stars';
export type Mode = 'major' | 'minor' | 'dorian' | 'mixolydian' | 'phrygian' | 'lydian' | 'harmonic';

export type Song = {
  /** Root note as a MIDI number. */
  root: number;
  mode: Mode;
  bpm: number;
  motif: number;
  groove: number;
  progression: number;
};

export type Zone = {
  index: number;
  name: string;
  backdrop: Backdrop;
  /** Which of the skin's colour variants the zone takes. */
  hue: number;
  twists: Twist[];
  ground: Foe[];
  air: Foe[];
  boss: BossKind;
  power: 'ping' | 'fan';
  song: Song;
  /** Difficulty, 1 to 5. */
  tier: number;
  /** What each of the first three hops is: a run to the right, or a climb up. */
  kinds: ('run' | 'climb')[];
  hint: string;
};

export const HOPS_PER_ZONE = 4;

/** What a zone's twist is called on its title card. */
export const TWIST_HINT: Record<Twist, string> = {
  ice: 'ICY FLOORS',
  lowgrav: 'LOW GRAVITY',
  wind: 'WIND GUSTS',
  conv: 'CONVEYORS',
  spring: 'SPRINGS',
  move: 'LIFTS',
  switch: 'ON/OFF SWITCHES',
  beat: 'BEAT BLOCKS',
  flip: 'FLIPPED GRAVITY',
  water: 'SWIM',
  dark: 'LIGHTS OUT',
  chase: 'RUN! THE PURGE',
};

type Named = Omit<Zone, 'index' | 'tier' | 'hint'>;

const NAMED: Named[] = [
  {
    name: 'LOCALHOST',
    backdrop: 'board',
    hue: 0,
    twists: [],
    ground: ['crawler', 'crawler', 'zip'],
    air: ['moth'],
    boss: 'hopper',
    power: 'ping',
    song: { root: 60, mode: 'major', bpm: 138, motif: 0, groove: 0, progression: 0 },
    kinds: ['run', 'run', 'run'],
  },
  {
    name: 'LAN',
    backdrop: 'cables',
    hue: 1,
    twists: ['conv'],
    ground: ['crawler', 'zip', 'zip'],
    air: ['moth'],
    boss: 'swooper',
    power: 'ping',
    song: { root: 62, mode: 'mixolydian', bpm: 144, motif: 1, groove: 1, progression: 1 },
    kinds: ['run', 'run', 'run'],
  },
  {
    name: 'WI-FI',
    backdrop: 'waves',
    hue: 2,
    twists: ['wind', 'spring'],
    ground: ['flea', 'crawler', 'zip'],
    air: ['moth', 'moth'],
    boss: 'charger',
    power: 'fan',
    song: { root: 65, mode: 'lydian', bpm: 132, motif: 2, groove: 2, progression: 2 },
    kinds: ['run', 'climb', 'run'],
  },
  {
    name: 'TAILNET',
    backdrop: 'tunnel',
    hue: 3,
    twists: ['dark', 'switch'],
    ground: ['worm', 'virus', 'crawler'],
    air: ['moth'],
    boss: 'burrower',
    power: 'ping',
    song: { root: 57, mode: 'dorian', bpm: 126, motif: 3, groove: 3, progression: 3 },
    kinds: ['run', 'run', 'climb'],
  },
  {
    name: 'CLOUD',
    backdrop: 'clouds',
    hue: 4,
    twists: ['lowgrav', 'move'],
    ground: ['flea', 'spammer', 'crawler'],
    air: ['moth', 'moth'],
    boss: 'swarm',
    power: 'fan',
    song: { root: 67, mode: 'major', bpm: 120, motif: 4, groove: 4, progression: 4 },
    kinds: ['run', 'climb', 'run'],
  },
  {
    name: 'DATACENTER',
    backdrop: 'racks',
    hue: 5,
    twists: ['ice', 'beat'],
    ground: ['zip', 'cron', 'crawler', 'worm'],
    air: ['moth'],
    boss: 'hopper',
    power: 'ping',
    song: { root: 59, mode: 'minor', bpm: 150, motif: 5, groove: 5, progression: 5 },
    kinds: ['run', 'run', 'climb'],
  },
  {
    name: 'BACKBONE',
    backdrop: 'fiber',
    hue: 6,
    twists: ['chase', 'conv'],
    ground: ['worm', 'crawler', 'virus', 'zip'],
    air: ['moth'],
    boss: 'charger',
    power: 'fan',
    song: { root: 64, mode: 'phrygian', bpm: 160, motif: 6, groove: 6, progression: 6 },
    kinds: ['run', 'run', 'run'],
  },
  {
    name: 'DEEP ARCHIVE',
    backdrop: 'tapes',
    hue: 7,
    twists: ['water'],
    ground: ['crawler', 'zip'],
    air: ['phish', 'phish'],
    boss: 'swooper',
    power: 'ping',
    song: { root: 55, mode: 'dorian', bpm: 112, motif: 7, groove: 7, progression: 7 },
    kinds: ['run', 'run', 'run'],
  },
  {
    name: 'FIREWALL',
    backdrop: 'flames',
    hue: 8,
    twists: ['flip', 'switch'],
    ground: ['virus', 'spammer', 'cron', 'worm'],
    air: ['moth'],
    boss: 'burrower',
    power: 'ping',
    song: { root: 62, mode: 'harmonic', bpm: 156, motif: 8, groove: 1, progression: 8 },
    kinds: ['run', 'run', 'run'],
  },
  {
    name: 'SATELLITE',
    backdrop: 'stars',
    hue: 9,
    twists: ['lowgrav', 'dark', 'beat'],
    ground: ['flea', 'virus', 'spammer', 'zip'],
    air: ['moth', 'moth'],
    boss: 'swarm',
    power: 'fan',
    song: { root: 63, mode: 'lydian', bpm: 140, motif: 9, groove: 2, progression: 9 },
    kinds: ['run', 'climb', 'run'],
  },
];

const PREFIX = ['EDGE', 'MESH', 'SHADOW', 'LEGACY', 'QUANTUM', 'ORBIT', 'CACHE', 'KERNEL', 'PROXY', 'ROOT', 'VAPOR', 'NEON', 'COLD', 'ECHO', 'HYPER', 'NULL'];
const SUFFIX = ['RELAY', 'GRID', 'VAULT', 'STACK', 'LINK', 'PORT', 'HUB', 'NODE', 'ZONE', 'MAZE', 'SPIRE', 'DEPTHS', 'FORGE', 'RING'];
const BACKDROPS: Backdrop[] = ['board', 'cables', 'waves', 'tunnel', 'clouds', 'racks', 'fiber', 'tapes', 'flames', 'stars'];
const MODES: Mode[] = ['major', 'minor', 'dorian', 'mixolydian', 'phrygian', 'lydian', 'harmonic'];
const BOSSES: BossKind[] = ['hopper', 'swooper', 'charger', 'burrower', 'swarm'];
const ALL_TWISTS: Twist[] = ['ice', 'lowgrav', 'wind', 'conv', 'spring', 'move', 'switch', 'beat', 'flip', 'water', 'dark', 'chase'];
const GROUND_FOES: Foe[] = ['crawler', 'zip', 'flea', 'worm', 'virus', 'spammer', 'cron'];

/** Twists that don't make sense together. */
function clash(a: Twist, b: Twist): boolean {
  const pair = (x: Twist, y: Twist) => (a === x && b === y) || (a === y && b === x);
  return (
    (a === 'water' && b !== 'dark') ||
    (b === 'water' && a !== 'dark') ||
    pair('chase', 'flip') ||
    pair('chase', 'switch') ||
    pair('ice', 'conv')
  );
}

function generated(seed: number, index: number, previous: Twist[]): Named {
  const rng = new Rng(hash(seed, index, 0x2077));
  const name = `${rng.pick(PREFIX)} ${rng.pick(SUFFIX)}`;
  // Later zones combine more twists; none repeats from the zone before.
  const count = index < 14 ? 2 : rng.chance(0.45) ? 3 : 2;
  const pool = rng.shuffle(ALL_TWISTS.filter((twist) => !previous.includes(twist)));
  const twists: Twist[] = [];
  for (const twist of pool) {
    if (twists.length >= count) break;
    if (twists.every((chosen) => !clash(chosen, twist))) twists.push(twist);
  }
  const water = twists.includes('water');
  const ground = rng.shuffle(GROUND_FOES).slice(0, 3 + rng.int(2));
  const signature = ground[0] ?? 'crawler';
  const climbs = twists.some((twist) => twist === 'spring' || twist === 'move' || twist === 'beat' || twist === 'lowgrav' || twist === 'switch');
  const kinds: ('run' | 'climb')[] = ['run', 'run', 'run'];
  if (climbs && !water) kinds[1 + rng.int(2)] = 'climb';
  return {
    name,
    backdrop: BACKDROPS[(index * 7 + rng.int(3)) % BACKDROPS.length] ?? 'board',
    hue: index % 10,
    twists,
    ground: [signature, ...ground],
    air: water ? ['phish', 'phish'] : ['moth'],
    boss: BOSSES[(index + rng.int(4)) % BOSSES.length] ?? 'hopper',
    power: rng.chance(0.5) ? 'ping' : 'fan',
    song: {
      root: 55 + rng.int(12),
      mode: rng.pick(MODES),
      bpm: 116 + rng.int(9) * 6,
      motif: rng.int(12),
      groove: rng.int(8),
      progression: rng.int(12),
    },
    kinds,
  };
}

/** The zone at `index` (from 1) for this game's seed. */
export function zoneFor(seed: number, index: number): Zone {
  let named: Named | undefined = NAMED[index - 1];
  if (!named) {
    // Each generated zone avoids its predecessor's twists, so walk the chain.
    let previous: Twist[] = NAMED[NAMED.length - 1]?.twists ?? [];
    for (let at = NAMED.length + 1; at <= index; at += 1) {
      named = generated(seed, at, previous);
      previous = named.twists;
    }
  }
  const base = named ?? generated(seed, index, []);
  const tier = Math.min(5, 1 + Math.floor((index - 1) * 0.5));
  const hint = base.twists.length === 0 ? 'STAY IN THE PACKET' : base.twists.map((twist) => TWIST_HINT[twist]).join(' + ');
  return { ...base, index, tier, hint };
}
