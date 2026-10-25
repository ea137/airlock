// Everyone who speaks or stands about: the name the dialogue shows, the
// sprite drawn for them, and the paint their name is written in.

import type { Paint } from './art';

export type Person = { name: string; art: string; colour: Paint };

export const CAST: Record<string, Person> = {
  echo: { name: 'Echo', art: 'echo', colour: 'accentLight' },
  gran: { name: 'Gran', art: 'gran', colour: 'dangerLight' },
  cron: { name: 'Cron', art: 'cron', colour: 'cron' },
  sudo: { name: 'Sudo', art: 'sudo', colour: 'sudoLight' },
  float: { name: 'Float', art: 'float', colour: 'floatLight' },
  tel: { name: 'Tel', art: 'tel', colour: 'telLight' },
  mailer: { name: 'Mailer', art: 'mailer', colour: 'accentLight' },
  mote: { name: 'Mote', art: 'mote', colour: 'accentLight' },
  defunct: { name: 'Defunct', art: 'defunct', colour: 'dim' },
  lru: { name: 'Lru', art: 'lru', colour: 'warn' },
  hop: { name: 'Packet', art: 'hop', colour: 'accentLight' },
  init: { name: 'Init', art: 'init', colour: 'light' },
  alarm: { name: 'Alarm', art: 'alarm', colour: 'dangerLight' },
  swap: { name: 'Swap', art: 'swap', colour: 'light' },
  buoy: { name: 'Buoy', art: 'buoy', colour: 'dangerLight' },
  gopher: { name: 'Gopher', art: 'gopher', colour: 'warn' },
  finger: { name: 'Finger', art: 'finger', colour: 'light' },
  ftp: { name: 'FTP', art: 'ftp', colour: 'warn' },
  farhost: { name: 'Far Host', art: 'farhost', colour: 'ok' },
  watchdog: { name: 'Watchdog', art: 'watchdog', colour: 'danger' },
  oom: { name: 'OOM Killer', art: 'oom', colour: 'danger' },
  spinlock: { name: 'Spinlock', art: 'spinlock', colour: 'cron' },
  jitter: { name: 'Jitter', art: 'jitter', colour: 'float' },
  spoofer: { name: 'Spoofer', art: 'sudo', colour: 'danger' },
  sys: { name: 'System', art: '', colour: 'danger' },
  pip: { name: 'Pip', art: 'folk', colour: 'hueLight' },
  nib: { name: 'Nib', art: 'folk2', colour: 'cronLight' },
  tock: { name: 'Tock', art: 'folk2', colour: 'cronLight' },
  stub: { name: 'Stub', art: 'folk', colour: 'hueLight' },
  byte: { name: 'Byte', art: 'folk', colour: 'hueLight' },
  ttl: { name: 'TTL', art: 'folk2', colour: 'cronLight' },
};

export const SPEAKERS: ReadonlySet<string> = new Set(Object.keys(CAST));

export function personOf(id: string): Person {
  return CAST[id] ?? { name: id, art: 'folk', colour: 'light' };
}
