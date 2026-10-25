// What a listening port is, who can reach it, and whether it should worry
// you, in plain words. The hub decides the kind and the verdict; this says
// them.

import type { PortKind, PortView } from '../../lib/api';

export type PortStory = {
  /** What it is, by name: `Redis`, `SSH`, or the program's own name. */
  title: string;
  what: string;
  reach: string;
  verdict: { level: PortView['verdict']; headline: string; why: string };
  /** What to do about it, when there's something to do. */
  todo: string | null;
  /** A command for the laptop's terminal that does it. */
  command: string | null;
  /** How the phone can stop it, if it can. */
  stop: 'process' | 'container' | null;
};

const TITLES: Record<PortKind, string | null> = {
  airlock: 'Airlock',
  tailscale: 'Tailscale',
  ssh: 'SSH',
  dns: 'DNS',
  rpcbind: 'rpcbind',
  printing: 'Printing (CUPS)',
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  redis: 'Redis',
  mongodb: 'MongoDB',
  memcached: 'Memcached',
  dev: null,
  container: null,
  program: null,
  unknown: null,
};

const DATABASES: readonly PortKind[] = ['postgres', 'mysql', 'redis', 'mongodb', 'memcached'];

function what(port: PortView): string {
  switch (port.kind) {
    case 'airlock':
      return port.exposure === 'tailnet'
        ? 'Airlock: the page your phone opens, and its previews, served through Tailscale.'
        : "Airlock's own, on this laptop. Tailscale hands your phone's requests to it.";
    case 'tailscale':
      return 'Tailscale, the private network between your devices: how they find and reach each other.';
    case 'ssh':
      return 'SSH: it lets someone log in to this laptop from another computer and run commands.';
    case 'dns':
      return 'The DNS resolver: it turns names like github.com into addresses for your programs.';
    case 'rpcbind':
      return 'rpcbind: a directory for NFS, the old Unix way of sharing folders over a network.';
    case 'printing':
      return 'The printing service (CUPS): it lets your apps print, and can share printers.';
    case 'postgres':
      return 'A PostgreSQL database.';
    case 'mysql':
      return 'A MySQL or MariaDB database.';
    case 'redis':
      return 'Redis: an in-memory database, often a cache or a queue for an app.';
    case 'mongodb':
      return 'A MongoDB database.';
    case 'memcached':
      return 'Memcached: a cache for an app.';
    case 'dev':
      return `A dev server: one of your projects (${port.name}), served while you work on it.`;
    case 'container':
      return `A Docker container running ${port.image ?? 'an image'}.`;
    case 'program':
      return `${port.name}, one of your programs.`;
    case 'unknown':
      return "Something the system or another user runs, that Airlock doesn't recognise.";
  }
}

function reach(port: PortView, firewall: boolean | null): string {
  switch (port.exposure) {
    case 'laptop':
      return 'Only programs on this laptop can connect to it.';
    case 'tailnet':
      return 'Only your own devices on Tailscale can connect to it.';
    case 'all':
    case 'one': {
      const who =
        port.exposure === 'all'
          ? "Anyone on a network this laptop joins (your home Wi-Fi, a café's, an office's) can try to connect."
          : `Anyone on the network of ${port.address} can try to connect.`;
      if (port.owner === 'docker') return `${who} Docker's ports get past the laptop's firewall.`;
      if (firewall === true) return `${who} The firewall may block it, unless a rule lets it through.`;
      return `${who} The laptop's firewall is off, so nothing is in the way.`;
    }
  }
}

/** Publishing a container's port on this laptop only. */
function publishLocally(port: PortView): string {
  return `Publish it on this laptop only: in its docker-compose file or docker run, write "127.0.0.1:${port.port}:${port.port}" instead of "${port.port}:${port.port}", then recreate the container. Or stop it while you're not using it.`;
}

/** Why it's worth a look or a worry, and what to do. */
function advice(port: PortView): { why: string; todo: string | null; command: string | null } {
  const kind = port.kind;
  if (DATABASES.includes(kind)) {
    const why =
      kind === 'redis' || kind === 'memcached'
        ? 'It usually has no password, so anyone who reaches it can read or change everything in it. Scans for open ones are automated.'
        : "A database open to the network is only as safe as its password, and your apps on this laptop don't need it open.";
    const todo =
      port.owner === 'docker'
        ? publishLocally(port)
        : kind === 'redis'
          ? 'Keep it on this laptop: set "bind 127.0.0.1" in its configuration and restart it.'
          : 'Keep it on this laptop: set it to listen on 127.0.0.1 in its configuration and restart it.';
    return { why, todo, command: null };
  }
  switch (kind) {
    case 'ssh':
      return {
        why: "Anyone on the same network can try passwords. That's fine if you use it and your password is strong; Tailscale has its own SSH if you need one.",
        todo: "If you don't log in to this laptop from elsewhere, turn it off:",
        command: 'sudo systemctl disable --now ssh.socket ssh.service',
      };
    case 'rpcbind':
      return {
        why: 'Unless you share or mount NFS folders, it does nothing for you, and it answers anyone who asks.',
        todo: "If you don't use NFS, turn it off:",
        command: 'sudo systemctl disable --now rpcbind.service rpcbind.socket',
      };
    case 'printing':
      return {
        why: 'It shares your printers with the network.',
        todo: 'Turn off printer sharing in Settings, under Printers.',
        command: null,
      };
    case 'dns':
      return {
        why: "Answering other computers' lookups isn't its job.",
        todo: 'Check what started it; it should listen on this laptop only.',
        command: null,
      };
    case 'dev':
      return {
        why: "Dev servers aren't built to face a network: they show unfinished work, and some run whatever they're asked.",
        todo: "Start it without --host (or with --host 127.0.0.1) so it serves this laptop only. Airlock's preview still reaches it.",
        command: null,
      };
    case 'container':
      return { why: 'Whatever it serves is open to the network.', todo: publishLocally(port), command: null };
    case 'program':
      return {
        why: 'Make sure it is meant to be reached from other computers.',
        todo: 'If not, set it to listen on 127.0.0.1, or stop it.',
        command: null,
      };
    default:
      return {
        why: "If you don't know what it is, it's worth finding out.",
        todo: 'This shows which program holds it:',
        command: `sudo ss -tlnp 'sport = :${port.port}'`,
      };
  }
}

const HEADLINES: Record<PortView['verdict'], string> = {
  safe: 'Safe',
  look: 'Worth a look',
  worry: 'Worth fixing',
};

export function portStory(port: PortView, firewall: boolean | null): PortStory {
  const title = TITLES[port.kind] ?? port.name;
  const safe = port.verdict === 'safe';
  const help = safe ? null : advice(port);
  const why = help?.why ?? (port.exposure === 'laptop' ? 'Nothing outside this laptop can reach it.' : 'Only your own devices can reach it.');
  const stop =
    port.kind === 'airlock'
      ? null
      : port.owner === 'docker' && port.container
        ? 'container'
        : port.owner === 'you' && port.pid !== null && port.started !== null
          ? 'process'
          : null;
  return {
    title,
    what: what(port),
    reach: reach(port, firewall),
    verdict: { level: port.verdict, headline: HEADLINES[port.verdict], why },
    todo: help?.todo ?? null,
    command: help?.command ?? null,
    stop,
  };
}
